from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .ai_service import dashscope_configured, generate_ai_benefit, generate_ai_rewrite
from .config import FRONTEND_DIST_DIR, OUTPUT_DIR, UPLOAD_DIR, ensure_runtime_dirs
from .content_auditor import audit_content
from .docx_exporter import export_rewrite_docx
from .document_parser import parse_document
from .format_auditor import audit_format
from .rewriter import build_benefit_fallback, build_fallback_rewrite


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
    }


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
        format_issues = audit_format(document)
        content_issues, diagnosis = audit_content(document)
        issues = format_issues + content_issues
        document["diagnosis"] = diagnosis
        document["issueCounts"] = summarize_issues(issues)
        documents.append(document)
        all_issues.extend(issues)

    summary = summarize_run(documents, all_issues)
    run = {"runId": run_id, "documents": documents, "issues": all_issues, "summary": summary, "rewrites": {}, "benefits": {}}
    RUNS[run_id] = run
    return sanitize_run(run)


@app.post("/api/research-rewrite")
async def research_rewrite(request: RewriteRequest) -> dict:
    run = get_run(request.runId)
    document = get_document(run, request.documentId)
    issues = [issue for issue in run["issues"] if issue["documentId"] == request.documentId]
    ai_text = None
    try:
        ai_text = await generate_ai_rewrite(document, issues, document["diagnosis"])
    except Exception as error:
        ai_text = f"AI改写暂不可用，已返回规则驱动草案。原因：{str(error)[:120]}"

    rewrite = build_fallback_rewrite(document, issues, document["diagnosis"], ai_text)
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
        content = await generate_ai_benefit(payload, document)
    except Exception as error:
        content = build_benefit_fallback(payload, document) + f"\n\nAI生成暂不可用，以上为规则驱动草案。原因：{str(error)[:120]}"

    result = {"content": content, "inputs": payload}
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


def summarize_run(documents: list[dict], issues: list[dict]) -> dict:
    scores = [doc["diagnosis"]["score"] for doc in documents] or [0]
    return {
        "documentCount": len(documents),
        "issueCount": len(issues),
        "averageScore": round(sum(scores) / len(scores)),
        "highCount": sum(1 for item in issues if item["severity"] == "high"),
        "mediumCount": sum(1 for item in issues if item["severity"] == "medium"),
        "lowCount": sum(1 for item in issues if item["severity"] == "low"),
        "formatCount": sum(1 for item in issues if item["category"] == "format"),
        "contentCount": sum(1 for item in issues if item["category"] in {"content", "structure"}),
        "benefitCount": sum(1 for item in issues if item["category"] == "benefit"),
    }


def sanitize_run(run: dict) -> dict:
    # Avoid returning huge full text repeatedly.
    cloned = json.loads(json.dumps(run, ensure_ascii=False))
    for document in cloned["documents"]:
        document.pop("text", None)
        document["paragraphs"] = document["paragraphs"][:240]
    return cloned


if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")
