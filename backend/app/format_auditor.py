from __future__ import annotations

import math
from typing import Optional

from .rules import SIPG_FORMAT_RULES


def audit_format(document: dict) -> list[dict]:
    if not document["stats"].get("hasFormatMetadata"):
        return [
            {
                "id": f"format-{document['id']}-metadata",
                "documentId": document["id"],
                "filename": document["filename"],
                "category": "format",
                "severity": "medium",
                "title": "无法执行精细格式审核",
                "paragraphIndex": None,
                "excerpt": document["filename"],
                "expected": "上传 .docx 或可转换的 .doc 文件",
                "actual": f"{document['fileType']} 文件缺少 Word 段落样式元数据",
                "suggestion": "现场建议上传 Word 源文件，以检查字体、字号、缩进、行距和标题层级。",
            }
        ]

    issues: list[dict] = []
    toc_mode = False
    for paragraph in document["paragraphs"]:
        text = paragraph["text"]
        if text in ("目录", "目 录"):
            toc_mode = True
            continue
        if text == "引言":
            toc_mode = False

        rule_key = expected_rule_key(paragraph, toc_mode)
        if not rule_key:
            continue
        rule = SIPG_FORMAT_RULES[rule_key]
        meta = paragraph.get("format", {})

        checks = [
            ("font", "字体", rule.get("font"), meta.get("font")),
            ("size_pt", "字号", rule.get("size_pt"), meta.get("sizePt")),
            ("bold", "加粗", rule.get("bold"), meta.get("bold")),
            ("space_before_pt", "段前", rule.get("space_before_pt"), meta.get("spaceBeforePt")),
            ("space_after_pt", "段后", rule.get("space_after_pt"), meta.get("spaceAfterPt")),
            ("line_spacing", "行距", rule.get("line_spacing"), meta.get("lineSpacing")),
        ]
        if rule_key == "body" and len(text) > 35:
            checks.extend(
                [
                    ("first_line_indent_pt", "首行缩进", rule.get("first_line_indent_pt"), meta.get("firstLineIndentPt")),
                    ("alignment", "对齐方式", rule.get("alignment"), meta.get("alignment")),
                ]
            )

        deviations = [format_deviation(label, expected, actual) for _key, label, expected, actual in checks if not matches_expected(_key, expected, actual)]
        deviations = [item for item in deviations if item]
        if deviations:
            issues.append(
                {
                    "id": f"format-{document['id']}-{paragraph['index']}",
                    "documentId": document["id"],
                    "filename": document["filename"],
                    "category": "format",
                    "severity": "low" if rule_key == "body" else "medium",
                    "title": f"{rule['label']}格式不符合上港标准",
                    "paragraphIndex": paragraph["index"],
                    "excerpt": text[:120],
                    "expected": describe_rule(rule),
                    "actual": "；".join(deviations),
                    "suggestion": f"将该段按“{rule['label']}”样式统一调整。",
                }
            )

    if document["stats"].get("figureCount", 0) + document["stats"].get("tableTitleCount", 0) > 5 and not has_list_title(document, ["插图清单", "附表清单", "插图目录", "插表目录"]):
        issues.append(
            {
                "id": f"format-{document['id']}-figure-list",
                "documentId": document["id"],
                "filename": document["filename"],
                "category": "format",
                "severity": "medium",
                "title": "图表较多但缺少插图/附表清单",
                "paragraphIndex": None,
                "excerpt": "图表数量超过 5 个",
                "expected": "插图和附表多于 5 个时，应编制插图清单和附表清单。",
                "actual": f"识别到图表标题 {document['stats'].get('figureCount', 0) + document['stats'].get('tableTitleCount', 0)} 个。",
                "suggestion": "在目录之后另起一页加入插图清单和附表清单。",
            }
        )

    if len(issues) > 28:
        visible = issues[:24]
        visible.append(
            {
                "id": f"format-{document['id']}-summary",
                "documentId": document["id"],
                "filename": document["filename"],
                "category": "format",
                "severity": "medium",
                "title": "格式问题数量较多，建议统一套用上港研究报告模板",
                "paragraphIndex": None,
                "excerpt": f"共识别到 {len(issues)} 处格式偏差。",
                "expected": "按上港科技报告正文格式统一套用标题、正文、目录和图表样式。",
                "actual": f"当前仅展示前 24 处典型问题，另有 {len(issues) - 24} 处同类问题。",
                "suggestion": "优先使用模板样式批量修正，再对标题层级和目录重新生成进行复核。",
            }
        )
        return visible

    return issues


def expected_rule_key(paragraph: dict, toc_mode: bool) -> Optional[str]:
    if toc_mode:
        return "toc"
    if paragraph["kind"] == "heading":
        level = paragraph.get("level") or 1
        if level == 1:
            return "title_l1"
        if level == 2:
            return "title_l2"
        return "title_l3"
    if paragraph["kind"] == "body" and len(paragraph["text"]) > 18:
        return "body"
    return None


def matches_expected(key: str, expected, actual) -> bool:
    if expected is None or actual is None:
        return True
    if key == "font":
        return str(expected).lower() in str(actual).lower() or str(actual).lower() in ("simsun", "宋体")
    if key in {"size_pt", "space_before_pt", "space_after_pt", "first_line_indent_pt"}:
        return math.isclose(float(expected), float(actual), abs_tol=1.2)
    if key == "line_spacing":
        return math.isclose(float(expected), float(actual), abs_tol=0.12)
    if key == "alignment":
        return str(actual).upper() in {str(expected).upper(), "JUSTIFY", "DISTRIBUTE"}
    return expected == actual


def format_deviation(label: str, expected, actual) -> str:
    if actual is None:
        return f"{label}未显式设置，期望{expected}"
    return f"{label}为{actual}，期望{expected}"


def describe_rule(rule: dict) -> str:
    parts = [f"字体{rule.get('font')}", f"字号{rule.get('size_pt')}pt"]
    parts.append("加粗" if rule.get("bold") else "不加粗")
    parts.append(f"段前{rule.get('space_before_pt')}磅")
    parts.append(f"段后{rule.get('space_after_pt')}磅")
    parts.append(f"{rule.get('line_spacing')}倍行距")
    if "first_line_indent_pt" in rule:
        parts.append("首行缩进2字符")
    return "，".join(parts)


def has_list_title(document: dict, titles: list[str]) -> bool:
    return any(any(title in paragraph["text"] for title in titles) for paragraph in document["paragraphs"][:80])
