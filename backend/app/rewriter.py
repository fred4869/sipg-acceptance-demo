from __future__ import annotations

import re


def build_ai_rewrite(document: dict, diagnosis: dict, ai_result: dict) -> dict:
    parsed = ai_result.get("parsed")
    if not isinstance(parsed, dict):
        raise ValueError("AI改写结果缺少结构化JSON")

    outline = normalize_string_list(parsed.get("outline"))
    sections = normalize_sections(parsed.get("sections"))
    required_text = {
        "summary": clean_text(parsed.get("summary")),
        "intro": clean_text(parsed.get("intro")),
        "background": clean_text(parsed.get("background")),
        "conclusion": clean_text(parsed.get("conclusion")),
    }
    missing = [key for key, value in required_text.items() if not value]
    if missing or not outline or not sections:
        missing_fields = missing
        if not outline:
            missing_fields.append("outline")
        if not sections:
            missing_fields.append("sections")
        raise ValueError(f"AI改写结果字段不完整：{', '.join(missing_fields)}")

    return {
        "mode": diagnosis.get("rewriteMode"),
        **required_text,
        "outline": outline,
        "sections": sections,
        "dataNeeded": normalize_string_list(parsed.get("dataNeeded")),
        "references": normalize_string_list(parsed.get("references")),
        "ai": {
            "enabled": True,
            "provider": ai_result["provider"],
            "model": ai_result["model"],
            "usedStructuredOutput": True,
        },
    }


def clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        if isinstance(item, str):
            text = clean_text(item)
        elif isinstance(item, dict):
            text = clean_text(item.get("title") or item.get("name") or item.get("text"))
        else:
            text = ""
        if text:
            items.append(text)
    return items[:12]


def normalize_sections(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    sections = []
    for index, item in enumerate(value):
        if isinstance(item, str):
            title = f"AI改写片段{index + 1}"
            before = ""
            after = clean_text(item)
        elif isinstance(item, dict):
            title = clean_text(item.get("title")) or f"AI改写片段{index + 1}"
            before = clean_text(item.get("before") or item.get("source"))
            after = clean_text(item.get("after") or item.get("rewrite") or item.get("content"))
        else:
            continue
        if after:
            sections.append({"title": title, "before": before, "after": after})
    return sections[:6]
