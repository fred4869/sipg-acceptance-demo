from __future__ import annotations

import httpx
from typing import Optional

from .config import DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL, DASHSCOPE_MODEL, DASHSCOPE_REWRITE_MODEL


def dashscope_configured() -> bool:
    return bool(DASHSCOPE_API_KEY)


async def call_dashscope(messages: list[dict], *, model: Optional[str] = None, temperature: float = 0.2) -> str:
    if not dashscope_configured():
        raise RuntimeError("DashScope 未配置")
    payload = {
        "model": model or DASHSCOPE_MODEL,
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
    return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()


async def generate_ai_rewrite(document: dict, issues: list[dict], diagnosis: dict) -> str:
    content_sample = "\n".join(p["text"] for p in document["paragraphs"][:80])[:12000]
    prompt = {
        "document": {"filename": document["filename"], "title": document["title"], "diagnosis": diagnosis},
        "issues": [{"title": issue["title"], "actual": issue["actual"], "suggestion": issue["suggestion"]} for issue in issues[:16]],
        "contentSample": content_sample,
    }
    return await call_dashscope(
        [
            {"role": "system", "content": "你是上港集团科技创新项目研究报告优化专家。请基于输入材料，输出专业、克制、可用于验收材料草稿的中文优化建议和改写片段。不要编造不存在的数据。"},
            {"role": "user", "content": f"请按研究报告体例输出：1重构/优化思路，2推荐目录，3三段示例改写，4需要补充的数据。\n输入：{prompt}"},
        ],
        model=DASHSCOPE_REWRITE_MODEL,
        temperature=0.25,
    )


async def generate_ai_benefit(payload: dict, document: Optional[dict] = None) -> str:
    return await call_dashscope(
        [
            {"role": "system", "content": "你是科技项目验收效益分析撰写助手。所有效益结论必须有数据、公式、假设或明确标注需人工确认；表达要客观审慎但体现项目价值。"},
            {"role": "user", "content": f"请生成效益分析，包含经济效益、运营效益、安全/环保效益、推广价值、计算口径、需补充数据。\n项目材料摘要：{(document or {}).get('title','')}\n输入数据：{payload}"},
        ],
        model=DASHSCOPE_REWRITE_MODEL,
        temperature=0.2,
    )
