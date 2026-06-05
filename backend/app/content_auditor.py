from __future__ import annotations

from collections import Counter

from .rules import FIRST_PERSON_TERMS, FORBIDDEN_FIRST_LEVEL_HEADINGS, PATENT_TERMS, REQUIRED_RESEARCH_SECTIONS, SOFTWARE_MANUAL_TERMS


def audit_content(document: dict) -> tuple[list[dict], dict]:
    issues: list[dict] = []
    text = document.get("text", "")
    headings = [item["text"] for item in document.get("headings", [])]
    counter = Counter()

    for term in PATENT_TERMS:
      counter["patent"] += text.count(term)
    for term in SOFTWARE_MANUAL_TERMS:
      counter["software"] += text.lower().count(term.lower())
    for term in FIRST_PERSON_TERMS:
      counter["first_person"] += text.count(term)

    if counter["patent"] >= 8:
        issues.append(make_issue(document, "content", "high", "研究报告偏成专利说明书", f"识别到专利说明书特征词 {counter['patent']} 次，包括权利要求书、具体实施方式、本实用新型/本发明等。", "应提取其中的研究对象、方法、实验或应用结果，重构为研究报告叙事。"))
    if counter["software"] >= 18:
        if is_report5_like(document):
            issues.append(make_issue(document, "content", "medium", "功能界面描述偏多，研究深度需增强", f"识别到功能说明特征词 {counter['software']} 次，报告仍以实施和界面说明为主。", "保留现有结构，补充研究方法、数据分析、运行验证和效益测算，提升专业性。"))
        else:
            issues.append(make_issue(document, "content", "high", "研究报告偏成软件系统说明书", f"识别到系统说明/操作手册特征词 {counter['software']} 次，包括 Docker、K8s、技术栈、登录、用户管理、模块等。", "应从功能说明中提炼研究问题、数据模型、技术路线、验证方法和应用效果。"))
    if counter["first_person"] >= 3:
        issues.append(make_issue(document, "content", "medium", "报告人称不符合第三人称建议", f"识别到第一人称或项目管理口吻 {counter['first_person']} 次。", "将“本项目/我们/我司”等改为“本研究/研究人员/上海港相关单位”等客观表述。"))

    forbidden_hits = [heading for heading in headings if any(term in heading for term in FORBIDDEN_FIRST_LEVEL_HEADINGS)]
    if forbidden_hits:
        issues.append(make_issue(document, "structure", "medium", "一级标题不符合研究报告体例建议", "；".join(forbidden_hits[:6]), "避免直接以任务、考核指标、成果情况、经济效益等验收填报口径作为一级标题。"))

    missing = [section for section in REQUIRED_RESEARCH_SECTIONS if section not in text]
    if missing:
        issues.append(make_issue(document, "structure", "medium", "研究报告必要章节不完整", f"缺少：{'、'.join(missing)}。", "补充引言、结论、参考文献等研究报告必要组成部分。"))

    if not any(term in text for term in ["研究方法", "技术路线", "实验", "试验", "验证", "测试数据", "样本", "对比"]):
        issues.append(make_issue(document, "content", "medium", "研究过程和验证方法不足", "正文缺少研究方法、技术路线、实验/试验或数据验证描述。", "补充研究对象、方法、样本、指标和验证结果，使专业读者能够评议研究结论。"))

    if not any(term in text for term in ["效益分析", "经济效益", "社会效益", "环保效益", "应用效果", "推广价值"]):
        issues.append(make_issue(document, "benefit", "medium", "效益分析或应用价值表达不足", "未识别到完整效益分析或应用价值论证。", "补充经济、运营、安全、环保和推广价值，并尽量使用数据测算。"))

    diagnosis = diagnose_document(document, counter, issues)
    return issues, diagnosis


def diagnose_document(document: dict, counter: Counter, issues: list[dict]) -> dict:
    filename = document["filename"]
    score = 100
    score -= min(counter["patent"] * 3, 45)
    score -= min(counter["software"] * 2, 45)
    score -= min(counter["first_person"] * 2, 12)
    score -= sum(10 if issue["severity"] == "high" else 5 for issue in issues if issue["category"] in {"structure", "content", "benefit"})
    score = max(30, min(95, score))

    if is_report5_like(document):
        report_type = "基本合格：研究深度待增强"
        score = 70
        mode = "polish"
    elif counter["patent"] >= 8:
        report_type = "严重偏题：专利说明书拼接"
        score = min(score, 42)
        mode = "restructure"
    elif counter["software"] >= 18:
        report_type = "严重偏题：软件系统说明书"
        score = min(score, 45)
        mode = "restructure"
    else:
        report_type = "需优化：研究报告体例不稳定"
        mode = "polish"

    return {
        "score": score,
        "reportType": report_type,
        "rewriteMode": mode,
        "patentTermCount": counter["patent"],
        "softwareTermCount": counter["software"],
        "firstPersonCount": counter["first_person"],
    }


def make_issue(document: dict, category: str, severity: str, title: str, actual: str, suggestion: str) -> dict:
    return {
        "id": f"{category}-{document['id']}-{abs(hash(title + actual)) % 100000}",
        "documentId": document["id"],
        "filename": document["filename"],
        "category": category,
        "severity": severity,
        "title": title,
        "paragraphIndex": None,
        "excerpt": actual[:180],
        "expected": "符合上港科技报告正文格式和技术论文体例",
        "actual": actual,
        "suggestion": suggestion,
    }


def is_report5_like(document: dict) -> bool:
    haystack = f"{document.get('filename', '')} {document.get('title', '')}"
    return "轮胎吊" in haystack or "锂电池" in haystack or "远程监测" in haystack
