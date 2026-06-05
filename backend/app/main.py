from __future__ import annotations

import json
import mimetypes
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai_service import dashscope_configured, generate_ai_benefit, generate_ai_review, generate_ai_rewrite
from .config import DASHSCOPE_BENEFIT_MODEL, DASHSCOPE_MODEL, DASHSCOPE_REWRITE_MODEL, FRONTEND_DIST_DIR, OUTPUT_DIR, UPLOAD_DIR, ensure_runtime_dirs
from .docx_exporter import export_rewrite_docx
from .document_parser import parse_document
from .format_auditor import audit_format
from .rules import SIPG_FORMAT_RULES
from .rewriter import build_ai_rewrite


ensure_runtime_dirs()
app = FastAPI(title="SIPG AI Document Review", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

RUNS: dict[str, dict] = {}


class RewriteRequest(BaseModel):
    runId: str
    documentId: str


class BenefitRequest(BaseModel):
    runId: Optional[str] = None
    documentId: Optional[str] = None
    projectName: Optional[str] = None
    operationVolume: Optional[str] = None
    efficiencyGain: Optional[str] = None
    laborSaving: Optional[str] = None
    costSaving: Optional[str] = None
    energySaving: Optional[str] = None
    safetyImpact: Optional[str] = None
    environmentalImpact: Optional[str] = None
    extraNotes: Optional[str] = None


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "sipg-ai-document-review",
        "dashscope_configured": dashscope_configured(),
        "models": {
            "review": DASHSCOPE_MODEL,
            "rewrite": DASHSCOPE_REWRITE_MODEL,
            "benefit": DASHSCOPE_BENEFIT_MODEL,
        },
    }


@app.get("/api/audit-standards")
def audit_standards() -> dict:
    return build_audit_standards()


@app.post("/api/research-review")
async def research_review(files: list[UploadFile] = File(...)) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="请上传 Word 或 PDF 文件。")

    run_id = str(uuid.uuid4())
    run_dir = UPLOAD_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    documents = []
    all_issues = []
    for upload in files:
        safe_name = Path(upload.filename or "document").name
        target = run_dir / safe_name
        target.write_bytes(await upload.read())
        document = parse_document(target, safe_name)
        document["sourcePath"] = str(target)
        document["originalUrl"] = f"/api/research-runs/{run_id}/documents/{document['id']}/original"
        document["capabilities"] = build_document_capabilities(document)
        format_issues = audit_format(document)
        try:
            ai_review = await generate_ai_review(document, format_issues)
            content_issues, diagnosis = normalize_ai_review(document, ai_review)
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"AI审核失败：{str(error)[:180]}") from error
        issues = format_issues + content_issues
        attach_issue_locations(document, issues)
        document["diagnosis"] = diagnosis
        document["ai"] = ai_review_meta(ai_review)
        document["issueCounts"] = summarize_issues(issues)
        documents.append(document)
        all_issues.extend(issues)

    issue_groups = group_issues(all_issues)
    summary = summarize_run(documents, all_issues, issue_groups)
    for document in documents:
        document["issueGroupCount"] = sum(1 for group in issue_groups if group["documentId"] == document["id"])
    run = {
        "runId": run_id,
        "documents": documents,
        "issues": all_issues,
        "issueGroups": issue_groups,
        "summary": summary,
        "processing": build_processing_trace(documents, all_issues),
        "standards": build_audit_standards(),
        "rewrites": {},
        "benefits": {},
    }
    RUNS[run_id] = run
    return sanitize_run(run)


@app.post("/api/research-rewrite")
async def research_rewrite(request: RewriteRequest) -> dict:
    run = get_run(request.runId)
    document = get_document(run, request.documentId)
    issues = [issue for issue in run["issues"] if issue["documentId"] == request.documentId]
    try:
        ai_result = await generate_ai_rewrite(document, issues, document["diagnosis"])
        rewrite = build_ai_rewrite(document, document["diagnosis"], ai_result)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI改写失败：{str(error)[:180]}") from error
    output_path = OUTPUT_DIR / f"{request.runId}-{request.documentId}.docx"
    export_rewrite_docx(output_path, document, rewrite, run["benefits"].get(request.documentId, {}).get("content"))
    rewrite["downloadUrl"] = f"/api/research-runs/{request.runId}/documents/{request.documentId}/download"
    run["rewrites"][request.documentId] = rewrite
    return rewrite


@app.post("/api/benefit-analysis")
async def benefit_analysis(request: BenefitRequest) -> dict:
    run = RUNS.get(request.runId or "") if request.runId else None
    document = get_document(run, request.documentId) if run and request.documentId else None
    payload = request.model_dump()
    try:
        ai_result = await generate_ai_benefit(payload, document)
        content = ai_result["content"]
        ai_meta = {
            "enabled": True,
            "provider": ai_result["provider"],
            "model": ai_result["model"],
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI效益分析失败：{str(error)[:180]}") from error

    result = {"content": content, "inputs": payload, "ai": ai_meta}
    if run and document:
        run["benefits"][document["id"]] = result
        if document["id"] in run["rewrites"]:
            output_path = OUTPUT_DIR / f"{run['runId']}-{document['id']}.docx"
            export_rewrite_docx(output_path, document, run["rewrites"][document["id"]], content)
    return result


@app.get("/api/research-runs/{run_id}/documents/{document_id}/download")
def download_rewrite(run_id: str, document_id: str) -> FileResponse:
    path = OUTPUT_DIR / f"{run_id}-{document_id}.docx"
    if not path.exists():
        raise HTTPException(status_code=404, detail="尚未生成优化稿。")
    return FileResponse(path, filename="上港研究报告优化稿.docx", media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/api/research-runs/{run_id}/documents/{document_id}/original")
def download_original(run_id: str, document_id: str) -> FileResponse:
    run = get_run(run_id)
    document = get_document(run, document_id)
    path = Path(document.get("sourcePath", ""))
    if not path.exists():
        raise HTTPException(status_code=404, detail="原文件不存在或已过期。")
    media_type = mimetypes.guess_type(document["filename"])[0] or "application/octet-stream"
    return FileResponse(path, filename=document["filename"], media_type=media_type)


def get_run(run_id: str) -> dict:
    run = RUNS.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="审核任务不存在或已过期。")
    return run


def get_document(run: Optional[dict], document_id: Optional[str]) -> dict:
    if not run or not document_id:
        raise HTTPException(status_code=404, detail="文档不存在。")
    for document in run["documents"]:
        if document["id"] == document_id:
            return document
    raise HTTPException(status_code=404, detail="文档不存在。")


def summarize_issues(issues: list[dict]) -> dict:
    return {
        "total": len(issues),
        "high": sum(1 for item in issues if item["severity"] == "high"),
        "medium": sum(1 for item in issues if item["severity"] == "medium"),
        "low": sum(1 for item in issues if item["severity"] == "low"),
        "format": sum(1 for item in issues if item["category"] == "format"),
        "structure": sum(1 for item in issues if item["category"] == "structure"),
        "content": sum(1 for item in issues if item["category"] == "content"),
        "benefit": sum(1 for item in issues if item["category"] == "benefit"),
    }


def attach_issue_locations(document: dict, issues: list[dict]) -> None:
    paragraph_by_index = {paragraph["index"]: paragraph for paragraph in document.get("paragraphs", [])}
    for issue in issues:
        paragraph = paragraph_by_index.get(issue.get("paragraphIndex")) or find_paragraph_by_issue_text(document, issue)
        if paragraph and issue.get("paragraphIndex") is None:
            issue["paragraphIndex"] = paragraph["index"]
        page_no = paragraph.get("pageNo") if paragraph else 1
        issue["pageNo"] = page_no
        issue["pageLabel"] = f"第{page_no}页"
        if paragraph:
            issue["locationLabel"] = f"第{page_no}页 / 第{paragraph['index'] + 1}段"
        else:
            issue["locationLabel"] = f"第{page_no}页 / 全文"


def find_paragraph_by_issue_text(document: dict, issue: dict) -> Optional[dict]:
    candidates = [issue.get("excerpt", ""), issue.get("actual", "")]
    needles = []
    for candidate in candidates:
        cleaned = re.sub(r"\s+", "", candidate or "")
        if len(cleaned) >= 12:
            needles.append(cleaned[:28])
    if not needles:
        return None
    for paragraph in document.get("paragraphs", []):
        haystack = re.sub(r"\s+", "", paragraph.get("text", ""))
        if any(needle in haystack for needle in needles):
            return paragraph
    return None


def group_issues(issues: list[dict]) -> list[dict]:
    grouped: dict[tuple, dict] = {}
    for issue in issues:
        key = (issue["documentId"], issue["category"], issue["title"])
        group = grouped.setdefault(
            key,
            {
                "id": f"group-{issue['documentId']}-{issue['category']}-{abs(hash(issue['title'])) % 100000}",
                "documentId": issue["documentId"],
                "filename": issue["filename"],
                "category": issue["category"],
                "severity": issue["severity"],
                "title": issue["title"],
                "count": 0,
                "pageNos": [],
                "paragraphIndexes": [],
                "expected": issue.get("expected", ""),
                "suggestion": issue.get("suggestion", ""),
                "source": issue.get("source", "rule"),
                "aiModel": issue.get("aiModel", ""),
                "samples": [],
                "issueIds": [],
            },
        )
        group["count"] += 1
        group["severity"] = max_severity(group["severity"], issue["severity"])
        if issue.get("pageNo") and issue["pageNo"] not in group["pageNos"]:
            group["pageNos"].append(issue["pageNo"])
        if issue.get("paragraphIndex") is not None:
            group["paragraphIndexes"].append(issue["paragraphIndex"])
        if len(group["samples"]) < 3:
            group["samples"].append(
                {
                    "actual": issue.get("actual", ""),
                    "suggestion": issue.get("suggestion", ""),
                    "locationLabel": issue.get("locationLabel", ""),
                }
            )
        group["issueIds"].append(issue["id"])

    result = []
    for group in grouped.values():
        group["pageNos"].sort()
        group["paragraphIndexes"] = sorted(set(group["paragraphIndexes"]))
        group["pageLabel"] = format_page_range(group["pageNos"])
        result.append(group)
    severity_order = {"high": 0, "medium": 1, "low": 2}
    category_order = {"format": 0, "structure": 1, "content": 2, "benefit": 3}
    return sorted(result, key=lambda item: (severity_order.get(item["severity"], 9), category_order.get(item["category"], 9), item["title"]))


def max_severity(current: str, incoming: str) -> str:
    rank = {"low": 1, "medium": 2, "high": 3}
    return incoming if rank.get(incoming, 0) > rank.get(current, 0) else current


def format_page_range(page_nos: list[int]) -> str:
    if not page_nos:
        return "全文"
    if len(page_nos) == 1:
        return f"第{page_nos[0]}页"
    return f"第{page_nos[0]}-{page_nos[-1]}页" if page_nos == list(range(page_nos[0], page_nos[-1] + 1)) else "、".join(f"第{page}页" for page in page_nos[:4])


def normalize_ai_review(document: dict, ai_result: dict) -> tuple[list[dict], dict]:
    parsed = ai_result.get("parsed")
    if not isinstance(parsed, dict):
        raise ValueError("AI审核结果缺少结构化JSON")

    diagnosis_input = parsed.get("diagnosis")
    if not isinstance(diagnosis_input, dict):
        raise ValueError("AI审核结果缺少 diagnosis")
    diagnosis = {
        "score": normalize_score(diagnosis_input.get("score")),
        "reportType": normalize_text(diagnosis_input.get("reportType")),
        "rewriteMode": normalize_rewrite_mode(diagnosis_input.get("rewriteMode")),
        "summary": normalize_text(diagnosis_input.get("summary")),
        "aiProvider": ai_result["provider"],
        "aiModel": ai_result["model"],
    }
    missing_diagnosis = [key for key in ("reportType", "rewriteMode", "summary") if not diagnosis[key]]
    if missing_diagnosis:
        raise ValueError(f"AI审核 diagnosis 字段不完整：{', '.join(missing_diagnosis)}")

    raw_issues = parsed.get("issues")
    if not isinstance(raw_issues, list):
        raise ValueError("AI审核结果缺少 issues")
    issues = []
    for index, item in enumerate(raw_issues):
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        severity = item.get("severity")
        title = normalize_text(item.get("title"))
        actual = normalize_text(item.get("actual"))
        suggestion = normalize_text(item.get("suggestion"))
        if category not in {"structure", "content", "benefit"} or severity not in {"high", "medium", "low"} or not title or not actual or not suggestion:
            raise ValueError(f"AI审核第 {index + 1} 个问题字段不合法")
        issues.append(
            {
                "id": f"ai-{category}-{document['id']}-{index}",
                "documentId": document["id"],
                "filename": document["filename"],
                "category": category,
                "severity": severity,
                "title": title,
                "paragraphIndex": normalize_paragraph_index(item.get("paragraphIndex")),
                "excerpt": normalize_text(item.get("excerpt"))[:180],
                "expected": normalize_text(item.get("expected")) or "符合上港科技报告正文格式和技术论文体例",
                "actual": actual,
                "suggestion": suggestion,
                "source": "ai",
                "aiProvider": ai_result["provider"],
                "aiModel": ai_result["model"],
            }
        )
    return issues, diagnosis


def ai_review_meta(ai_result: dict) -> dict:
    return {
        "enabled": True,
        "provider": ai_result["provider"],
        "model": ai_result["model"],
    }


def build_document_capabilities(document: dict) -> list[str]:
    if document["stats"].get("hasFormatMetadata"):
        return ["Word精细格式审核", "正文结构解析", "AI内容结构审核", "原文件查看/下载"]
    if document.get("fileType") == "pdf":
        return ["PDF文本级解析", "AI内容结构审核", "原文件查看/下载"]
    return ["文本级解析", "AI内容结构审核", "原文件查看/下载"]


def normalize_score(value) -> int:
    try:
        return max(0, min(100, round(float(value))))
    except (TypeError, ValueError):
        match = re.search(r"\d+(?:\.\d+)?", str(value or ""))
        if not match:
            raise ValueError("AI审核 score 不合法")
        return max(0, min(100, round(float(match.group(0)))))


def normalize_rewrite_mode(value) -> str:
    if value in {"restructure", "polish"}:
        return value
    raise ValueError("AI审核 rewriteMode 不合法")


def normalize_paragraph_index(value):
    if value is None:
        return None
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def normalize_text(value) -> str:
    return str(value or "").strip()


def summarize_run(documents: list[dict], issues: list[dict], issue_groups: list[dict]) -> dict:
    scores = [doc["diagnosis"]["score"] for doc in documents] or [0]
    return {
        "documentCount": len(documents),
        "issueCount": len(issues),
        "issueGroupCount": len(issue_groups),
        "averageScore": round(sum(scores) / len(scores)),
        "highCount": sum(1 for item in issues if item["severity"] == "high"),
        "mediumCount": sum(1 for item in issues if item["severity"] == "medium"),
        "lowCount": sum(1 for item in issues if item["severity"] == "low"),
        "highGroupCount": sum(1 for item in issue_groups if item["severity"] == "high"),
        "mediumGroupCount": sum(1 for item in issue_groups if item["severity"] == "medium"),
        "lowGroupCount": sum(1 for item in issue_groups if item["severity"] == "low"),
        "formatCount": sum(1 for item in issues if item["category"] == "format"),
        "contentCount": sum(1 for item in issues if item["category"] in {"content", "structure"}),
        "benefitCount": sum(1 for item in issues if item["category"] == "benefit"),
    }


def build_processing_trace(documents: list[dict], issues: list[dict]) -> list[dict]:
    file_types = sorted({doc.get("fileType", "unknown") for doc in documents})
    has_format_metadata = sum(1 for doc in documents if doc.get("stats", {}).get("hasFormatMetadata"))
    format_issues = [issue for issue in issues if issue["category"] == "format"]
    ai_issues = [issue for issue in issues if issue.get("source") == "ai"]
    issue_groups = group_issues(issues)
    return [
        {
            "id": "upload",
            "name": "文件接收",
            "status": "done",
            "detail": f"已接收 {len(documents)} 个文件，类型：{', '.join(file_types) or '-'}。",
            "outputs": [
                {"label": "文件数量", "value": len(documents)},
                {"label": "文件类型", "value": "、".join(file_types) or "-"},
            ],
            "items": [
                {
                    "title": doc["filename"],
                    "meta": f"{doc.get('fileType', '-').upper()} · {doc.get('stats', {}).get('paragraphCount', 0)}段",
                    "body": "、".join(doc.get("capabilities", [])),
                }
                for doc in documents
            ],
        },
        {
            "id": "parse",
            "name": "正文与格式解析",
            "status": "done",
            "detail": f"{has_format_metadata} 个 Word 文件完成段落、标题、字体、字号、行距、缩进等格式元数据解析；其他文件执行文本级解析。",
            "outputs": [
                {"label": "精细格式文件", "value": has_format_metadata},
                {"label": "总段落数", "value": sum(doc.get("stats", {}).get("paragraphCount", 0) for doc in documents)},
                {"label": "总标题数", "value": sum(doc.get("stats", {}).get("headingCount", 0) for doc in documents)},
            ],
            "items": [
                {
                    "title": doc["filename"],
                    "meta": "可做精细格式审核" if doc.get("stats", {}).get("hasFormatMetadata") else "文本级审核",
                    "body": f"解析段落 {doc.get('stats', {}).get('paragraphCount', 0)} 个，标题 {doc.get('stats', {}).get('headingCount', 0)} 个，图题 {doc.get('stats', {}).get('figureCount', 0)} 个，表题 {doc.get('stats', {}).get('tableTitleCount', 0)} 个。",
                }
                for doc in documents
            ],
        },
        {
            "id": "format",
            "name": "格式标准比对",
            "status": "done",
            "detail": "按上港科技报告正文格式，对一级标题、二级标题、正文、目录和图表清单进行逐段比对。",
            "outputs": [
                {"label": "格式问题", "value": len(format_issues)},
                {"label": "覆盖标准", "value": "一级标题、二级标题、三级/四级标题、正文、目录"},
            ],
            "items": [
                {
                    "title": doc["filename"],
                    "meta": f"{count_doc_issues(format_issues, doc['id'])}项格式发现",
                    "body": first_issue_text(format_issues, doc["id"]) or "未发现典型格式偏差。",
                }
                for doc in documents
            ],
        },
        {
            "id": "audit",
            "name": "AI内容结构审核",
            "status": "done",
            "detail": f"调用 DashScope {DASHSCOPE_MODEL}，审核研究报告体例、偏题类型、研究方法、验证数据和效益分析完整性。",
            "outputs": [
                {"label": "审核模型", "value": DASHSCOPE_MODEL},
                {"label": "AI问题", "value": len(ai_issues)},
                {"label": "审核维度", "value": "体例偏题、研究方法、验证数据、效益分析、结论闭环"},
            ],
            "items": [
                {
                    "title": doc["filename"],
                    "meta": f"{doc.get('diagnosis', {}).get('score', '-')}分 · {doc.get('diagnosis', {}).get('reportType', '-')}",
                    "body": doc.get("diagnosis", {}).get("summary", ""),
                }
                for doc in documents
            ],
        },
        {
            "id": "aggregate",
            "name": "问题归集定位",
            "status": "done",
            "detail": f"已将 {len(issues)} 项发现归并为 {len(issue_groups)} 类问题，并关联文件、页码、段落范围和统一整改建议。",
            "outputs": [
                {"label": "问题类别", "value": len(issue_groups)},
                {"label": "高风险类", "value": sum(1 for item in issue_groups if item["severity"] == "high")},
                {"label": "中风险类", "value": sum(1 for item in issue_groups if item["severity"] == "medium")},
                {"label": "低风险类", "value": sum(1 for item in issue_groups if item["severity"] == "low")},
            ],
            "items": [
                {
                    "title": group["title"],
                    "meta": f"{group['filename']} · {group['severity']} · {group['category']} · {group['pageLabel']} · {group['count']}处",
                    "body": group["suggestion"],
                }
                for group in issue_groups[:8]
            ],
        },
        {
            "id": "result",
            "name": "结果生成",
            "status": "done",
            "detail": "生成文件级评分、报告类型、问题清单、原文定位、整改建议，并为后续优化稿和效益分析提供输入。",
            "outputs": [
                {"label": "平均评分", "value": round(sum(doc["diagnosis"]["score"] for doc in documents) / len(documents)) if documents else 0},
                {"label": "可生成优化稿", "value": len(documents)},
                {"label": "可生成效益分析", "value": len(documents)},
            ],
            "items": [
                {
                    "title": doc["filename"],
                    "meta": f"{doc.get('diagnosis', {}).get('rewriteMode', '-')} · {doc.get('issueCounts', {}).get('total', 0)}项问题",
                    "body": "可继续生成研究报告优化稿；如需效益分析，可补充作业量、效率、成本、能耗、安全环保等数据。",
                }
                for doc in documents
            ],
        },
    ]


def count_doc_issues(issues: list[dict], document_id: str) -> int:
    return sum(1 for issue in issues if issue["documentId"] == document_id)


def first_issue_text(issues: list[dict], document_id: str) -> str:
    for issue in issues:
        if issue["documentId"] == document_id:
            return f"{issue['title']}：{issue['actual']}"
    return ""


def build_audit_standards() -> dict:
    return {
        "basis": [
            "上港集团科技创新项目验收材料封面及清单要求",
            "上港科技报告正文格式要求",
            "科技项目研究报告常见结构：引言、研究目标、技术路线、实施验证、成果、效益分析、结论、参考文献",
        ],
        "models": {
            "contentReview": DASHSCOPE_MODEL,
            "rewrite": DASHSCOPE_REWRITE_MODEL,
            "benefit": DASHSCOPE_BENEFIT_MODEL,
        },
        "formatRules": [
            {
                "name": rule["label"],
                "standard": describe_format_rule(rule),
            }
            for rule in SIPG_FORMAT_RULES.values()
        ],
        "contentRules": [
            "识别是否偏成专利说明书、软件系统说明书、操作手册或产品介绍。",
            "检查是否具备研究问题、技术路线、研究方法、现场验证数据和结论闭环。",
            "检查功能描述是否被转化为研究性表达，而不是菜单、按钮、部署步骤堆砌。",
            "检查效益分析是否包含数据来源、计算口径、公式、假设和需补充数据。",
        ],
        "outputFields": [
            "问题类型、风险等级、定位段落、实际问题、标准要求、整改建议",
            "综合评分、报告类型、优化模式、AI诊断摘要",
            "优化大纲、示例改写、需补充数据、Word优化稿",
        ],
    }


def describe_format_rule(rule: dict) -> str:
    parts = [
        f"{rule.get('font')} {rule.get('size_pt')}pt",
        "加粗" if rule.get("bold") else "不加粗",
        f"段前{rule.get('space_before_pt')}磅",
        f"段后{rule.get('space_after_pt')}磅",
        f"{rule.get('line_spacing')}倍行距",
    ]
    if rule.get("first_line_indent_pt"):
        parts.append("首行缩进2字符")
    if rule.get("alignment"):
        parts.append("两端对齐")
    return "，".join(parts)


def sanitize_run(run: dict) -> dict:
    # Avoid returning huge full text repeatedly.
    cloned = json.loads(json.dumps(run, ensure_ascii=False))
    for document in cloned["documents"]:
        document.pop("text", None)
        document.pop("sourcePath", None)
        document["paragraphs"] = document["paragraphs"][:240]
    return cloned


if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")
