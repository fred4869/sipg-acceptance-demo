from __future__ import annotations

import json
import re
import httpx
from typing import Optional

from .config import DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL, DASHSCOPE_MODEL, DASHSCOPE_REWRITE_MODEL


def dashscope_configured() -> bool:
    return bool(DASHSCOPE_API_KEY)


async def call_dashscope(messages: list[dict], *, model: Optional[str] = None, temperature: float = 0.2) -> dict:
    if not dashscope_configured():
        raise RuntimeError("DashScope 未配置")
    active_model = model or DASHSCOPE_MODEL
    payload = {
        "model": active_model,
        "messages": messages,
        "temperature": temperature,
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{DASHSCOPE_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {DASHSCOPE_API_KEY}", "Content-Type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    return {
        "enabled": True,
        "provider": "DashScope",
        "model": active_model,
        "content": data.get("choices", [{}])[0].get("message", {}).get("content", "").strip(),
    }


async def generate_ai_review(document: dict, format_issues: list[dict]) -> dict:
    content_sample = build_content_sample(document)
    prompt = {
        "document": {
            "filename": document["filename"],
            "title": document["title"],
            "fileType": document["fileType"],
            "stats": document["stats"],
            "headings": [heading["text"] for heading in document.get("headings", [])[:60]],
        },
        "formatIssueCount": len(format_issues),
        "formatIssueSamples": [
            {
                "title": issue["title"],
                "paragraphIndex": issue.get("paragraphIndex"),
                "actual": issue["actual"],
                "suggestion": issue["suggestion"],
            }
            for issue in format_issues[:8]
        ],
        "contentSample": content_sample,
    }
    result = await call_dashscope(
        [
            {
                "role": "system",
                "content": (
                    "你是上港集团科技创新项目研究报告审核专家。你负责审核研究报告是否像研究报告，"
                    "是否偏成专利说明书、软件系统说明书、操作手册或产品介绍，是否缺少研究方法、验证数据、"
                    "效益分析、结论和参考文献。所有 reportType 必须使用中文。"
                    "客户已确认的样例评分口径："
                    "《传统散货港口综合环保系统升级研究报告》严重偏成专利说明书，需重构，评分低于60；"
                    "《空箱调运平台验收材料之五研究报告》严重偏成软件系统/操作说明，需重构，评分低于60；"
                    "《轮胎吊锂电池供电系统远程监测研究报告》结构基本及格但研究深度不足，应按约70分、polish优化处理，"
                    "除非材料缺失到无法识别主体结构，不应判为严重不合格；其优化项原则上用medium或low，不要用high渲染成重大风险。"
                    "必须只输出合法JSON对象，不要输出Markdown代码块。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "请输出JSON，字段必须包含："
                    "diagnosis:{score:number,reportType:string,rewriteMode:string,summary:string}, "
                    "issues:[{category:string,severity:string,title:string,paragraphIndex:number|null,excerpt:string,expected:string,actual:string,suggestion:string}]。"
                    "category只能是structure/content/benefit，severity只能是high/medium/low。"
                    "rewriteMode只能是restructure或polish。文件严重偏题时score应低于60；基本合格但需优化时score约70。"
                    f"\n输入：{json.dumps(prompt, ensure_ascii=False)}"
                ),
            },
        ],
        model=DASHSCOPE_MODEL,
        temperature=0.1,
    )
    parsed = parse_json_object(result["content"])
    if parsed is None:
        raise RuntimeError("AI审核未返回合法JSON")
    result["parsed"] = parsed
    return result


async def generate_ai_rewrite(document: dict, issues: list[dict], diagnosis: dict) -> dict:
    content_sample = "\n".join(p["text"] for p in document["paragraphs"][:80])[:12000]
    prompt = {
        "document": {"filename": document["filename"], "title": document["title"], "diagnosis": diagnosis},
        "issues": [{"title": issue["title"], "actual": issue["actual"], "suggestion": issue["suggestion"]} for issue in issues[:16]],
        "contentSample": content_sample,
    }
    result = await call_dashscope(
        [
            {
                "role": "system",
                "content": (
                    "你是上港集团科技创新项目研究报告优化专家。请基于输入材料，输出专业、克制、"
                    "可用于验收材料草稿的中文优化建议和改写片段。不要编造不存在的数据。"
                    "必须只输出一个合法JSON对象，不要输出Markdown代码块。"
                ),
            },
            {
                "role": "user",
                "content": (
                    "请按研究报告体例输出JSON，字段必须包含："
                    "summary:string, intro:string, background:string, outline:string[], "
                    "sections:[{title:string,before:string,after:string}], conclusion:string, dataNeeded:string[], references:string[]。"
                    "sections至少3项，after必须是可直接放入研究报告的改写段落。"
                    f"\n输入：{json.dumps(prompt, ensure_ascii=False)}"
                ),
            },
        ],
        model=DASHSCOPE_REWRITE_MODEL,
        temperature=0.25,
    )
    parsed = parse_json_object(result["content"])
    if parsed is None:
        raise RuntimeError("AI改写未返回合法JSON")
    result["parsed"] = parsed
    return result


async def generate_ai_benefit(payload: dict, document: Optional[dict] = None) -> dict:
    result = await call_dashscope(
        [
            {"role": "system", "content": "你是科技项目验收效益分析撰写助手。所有效益结论必须有数据、公式、假设或明确标注需人工确认；表达要客观审慎但体现项目价值。"},
            {"role": "user", "content": f"请生成效益分析，包含经济效益、运营效益、安全/环保效益、推广价值、计算口径、需补充数据。\n项目材料摘要：{(document or {}).get('title','')}\n输入数据：{payload}"},
        ],
        model=DASHSCOPE_REWRITE_MODEL,
        temperature=0.2,
    )
    if not result["content"]:
        raise RuntimeError("AI效益分析返回为空")
    return result


def build_content_sample(document: dict) -> list[dict]:
    paragraphs = []
    for paragraph in document.get("paragraphs", [])[:120]:
        text = paragraph.get("text", "")
        if not text:
            continue
        paragraphs.append(
            {
                "index": paragraph.get("index"),
                "kind": paragraph.get("kind"),
                "level": paragraph.get("level"),
                "text": text[:600],
            }
        )
    return paragraphs


def parse_json_object(text: str) -> Optional[dict]:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    candidates = [cleaned]
    match = re.search(r"\{.*\}", cleaned, flags=re.S)
    if match:
        candidates.append(match.group(0))
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None
