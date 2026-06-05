SIPG_FORMAT_RULES = {
    "title_l1": {
        "label": "一级标题",
        "font": "宋体",
        "size_pt": 16,
        "bold": True,
        "space_before_pt": 10,
        "space_after_pt": 10,
        "line_spacing": 1.5,
    },
    "title_l2": {
        "label": "二级标题",
        "font": "宋体",
        "size_pt": 14,
        "bold": True,
        "space_before_pt": 10,
        "space_after_pt": 10,
        "line_spacing": 1.5,
    },
    "title_l3": {
        "label": "三级/四级标题",
        "font": "宋体",
        "size_pt": 10.5,
        "bold": True,
        "space_before_pt": 10,
        "space_after_pt": 10,
        "line_spacing": 1.5,
    },
    "body": {
        "label": "正文",
        "font": "宋体",
        "size_pt": 10.5,
        "bold": False,
        "space_before_pt": 0,
        "space_after_pt": 0,
        "line_spacing": 1.5,
        "first_line_indent_pt": 21,
        "alignment": "JUSTIFY",
    },
    "toc": {
        "label": "目录",
        "font": "宋体",
        "size_pt": 10.5,
        "bold": False,
        "space_before_pt": 0,
        "space_after_pt": 0,
        "line_spacing": 1.5,
    },
}

FORBIDDEN_FIRST_LEVEL_HEADINGS = [
    "课题研究目标",
    "任务",
    "考核指标",
    "课题实施完成情况",
    "项目研究和成果情况",
    "研究工作主要进展",
    "课题研究的创新点",
    "成果的应用",
    "转化情况",
    "成果的经济",
    "社会效益",
    "项目的主要内容",
    "项目的主要成果",
    "各项目标达成情况",
    "经济指标完成情况",
]

FIRST_PERSON_TERMS = ["本项目", "本课题", "课题组", "我们", "我司", "我市", "我公司"]

PATENT_TERMS = [
    "权利要求书",
    "具体实施方式",
    "本实用新型",
    "本发明",
    "实施例",
    "附图说明",
    "技术领域",
    "发明内容",
]

SOFTWARE_MANUAL_TERMS = [
    "Docker",
    "Kubernetes",
    "K8s",
    "Spring Cloud",
    "Nacos",
    "Redis",
    "Vue",
    "登录",
    "点击",
    "菜单",
    "按钮",
    "用户管理",
    "角色管理",
    "权限管理",
    "模块",
    "技术栈",
    "系统部署",
]

REQUIRED_RESEARCH_SECTIONS = ["引言", "结论", "参考文献"]
