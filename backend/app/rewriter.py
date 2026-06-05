from __future__ import annotations

import re
from typing import Optional


def build_fallback_rewrite(document: dict, issues: list[dict], diagnosis: dict, ai_text: Optional[str] = None) -> dict:
    mode = diagnosis.get("rewriteMode")
    text = document.get("text", "")
    title = document.get("title") or document["filename"]

    if mode == "restructure" and diagnosis.get("patentTermCount", 0) >= 8:
        outline = ["散货港口环保治理需求分析", "综合环保系统技术路线", "智能喷淋与扬尘监测方法", "噪声治理与水循环利用", "应用效果与环境效益评价", "结论与推广建议"]
        intro = "本研究面向城区传统散货港口环保治理需求，围绕扬尘、噪声、水资源循环利用和周边环境协同治理等问题，分析综合环保系统升级的技术路径和应用成效。"
        background = "原始材料包含较多专利说明书内容，建议提取其中的传感监测、自动喷淋、移动覆盖、节流控制等技术要点，重构为研究对象、研究方法和应用验证。"
    elif mode == "restructure":
        outline = ["空箱调运业务痛点与研究目标", "平台总体架构与数据模型", "调运流程协同与接口设计", "关键业务场景验证", "应用效果与效益分析", "结论与推广价值"]
        intro = "本研究围绕港口空箱调运过程中的信息不对称、流程协同和数据共享问题，分析平台化治理的技术路径和业务价值。"
        background = "原始材料偏向系统部署和功能模块说明，建议弱化通用技术栈介绍，突出业务模型、数据流、协同机制和应用验证。"
    else:
        outline = ["研究背景与设备状态问题", "远程监测系统技术路线", "数据采集与状态诊断方法", "系统应用验证与运行效果", "效益分析与推广价值", "结论"]
        intro = "本研究针对轮胎吊锂电池供电系统运行年限长、状态感知不足和故障回溯困难等问题，构建远程监测方法并验证其应用价值。"
        background = "原始报告结构基本完整，但需要增强研究方法、数据分析和效益论证，使报告从实施总结提升为研究报告。"

    sections = [
        {
            "title": "研究问题重构",
            "before": first_match(text, ["项目的主要内容", "项目研究内容", "引言"]),
            "after": f"{intro} 研究重点不应停留在设备、菜单或专利部件说明，而应围绕业务痛点、技术路径、验证指标和应用成效展开。",
        },
        {
            "title": "技术路线优化",
            "before": first_match(text, ["技术架构", "技术栈", "具体实施", "说明书"]),
            "after": "建议按照“感知层数据采集、平台层数据治理、应用层业务协同、评价层指标验证”的逻辑描述技术路线，并说明各环节对研究目标的支撑关系。",
        },
        {
            "title": "效益表达优化",
            "before": first_match(text, ["经济指标完成情况", "效益", "应用效果"]),
            "after": "效益分析应以运行周期、作业量、人工投入、故障次数、能耗或水耗变化等数据为基础，给出计算口径和审慎结论，避免仅做定性描述。",
        },
    ]

    return {
        "mode": mode,
        "summary": ai_text or "已根据上港科技报告格式要求生成优化建议。DashScope 不可用时返回规则驱动的改写草案。",
        "intro": intro,
        "background": background,
        "outline": outline,
        "sections": sections,
        "conclusion": f"《{title}》建议按研究报告体例重新组织，补充研究方法、验证数据、应用效果和参考文献，形成可复核的验收研究报告。",
    }


def build_benefit_fallback(payload: dict, document: Optional[dict] = None) -> str:
    name = payload.get("projectName") or (document or {}).get("title") or "该项目"
    volume = payload.get("operationVolume") or "待补充"
    efficiency = payload.get("efficiencyGain") or "待测算"
    labor = payload.get("laborSaving") or "待确认"
    cost = payload.get("costSaving") or "待测算"
    return "\n".join(
        [
            f"{name}的效益分析建议采用“运行数据+计算口径+审慎结论”的方式表述。",
            f"运营效益方面，可基于运行周期内作业量（{volume}）和效率提升幅度（{efficiency}）测算等待时间减少、处理效率提升和异常闭环能力改善。",
            f"经济效益方面，可结合人工减少（{labor}）、维护成本变化、停机损失减少和直接成本节约（{cost}）进行年化折算。",
            "安全与管理效益方面，应结合故障预警、状态回放、异常留痕、流程协同等指标，说明项目对设备安全、作业稳定性和管理透明度的提升。",
            "上述结论需在正式验收材料中补充数据来源、统计周期、计算公式和业务部门确认意见。",
        ]
    )


def first_match(text: str, terms: list[str]) -> str:
    for term in terms:
        pos = text.find(term)
        if pos >= 0:
            return re.sub(r"\s+", " ", text[pos : pos + 260]).strip()
    return re.sub(r"\s+", " ", text[:260]).strip()
