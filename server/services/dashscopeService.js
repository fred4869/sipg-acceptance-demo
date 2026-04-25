const defaultBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export function isDashScopeConfigured() {
  return Boolean(process.env.DASHSCOPE_API_KEY)
}

export async function buildAiReview(packet, audit) {
  if (!isDashScopeConfigured()) {
    return fallbackReview(packet, audit, 'DashScope 未配置，返回规则摘要。')
  }

  const payload = {
    model: process.env.DASHSCOPE_MODEL || 'qwen-plus',
    messages: [
      {
        role: 'system',
        content: '你是科技项目验收材料合规审核助手。只基于用户给出的模拟材料和规则发现输出简洁、可执行的中文复核意见。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          project: packet.authoritativeProject,
          packetLabel: packet.label,
          pages: packet.pages.map((page) => ({
            pageNo: page.pageNo,
            title: page.title,
            fields: page.fields || {},
            sections: (page.sections || []).slice(0, 3)
          })),
          auditSummary: audit.summary,
          findings: audit.findings.map((finding) => ({
            severity: finding.severity,
            type: finding.type,
            pageNo: finding.pageNo,
            title: finding.title,
            detail: finding.detail,
            suggestion: finding.suggestion
          }))
        })
      }
    ],
    temperature: 0.2
  }

  try {
    const response = await fetch(`${process.env.DASHSCOPE_BASE_URL || defaultBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const message = await response.text()
      return fallbackReview(packet, audit, `DashScope 调用失败：${response.status} ${message.slice(0, 120)}`)
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content?.trim()
    return {
      enabled: true,
      provider: 'dashscope',
      model: payload.model,
      content: content || fallbackReview(packet, audit).content
    }
  } catch (error) {
    return fallbackReview(packet, audit, error.message || 'DashScope 调用失败')
  }
}

export async function buildAiParsingResult(packet, files = []) {
  const displayFiles = files.map((file) => String(file)).slice(0, 30)
  const extractedPages = (packet.pages || []).map((page) => ({
    pageNo: page.pageNo,
    title: page.title,
    sourceFile: page.sourceFile,
    fields: page.fields || {},
    tableTypes: [
      page.checklist ? '验收文件清单' : '',
      page.indicators ? '指标表' : '',
      page.usageRows ? '使用数据' : '',
      page.budgetRows ? '经费决算表' : '',
      page.assetRows ? '成果与资产清单' : '',
      page.evidenceRows ? '附件证据清单' : ''
    ].filter(Boolean)
  }))

  if (!isDashScopeConfigured()) {
    return fallbackParsingResult(packet, displayFiles, 'DashScope 未配置，返回本地解析摘要。')
  }

  const payload = {
    model: process.env.DASHSCOPE_MODEL || 'qwen-plus',
    messages: [
      {
        role: 'system',
        content: '你是企业科技项目验收材料解析助手。基于给出的模拟文件名和已抽取结构，输出简洁中文解析记录，说明识别到的文件类型、关键字段、表格和需要人工确认的解析点。不要输出 Markdown 表格。'
      },
      {
        role: 'user',
        content: JSON.stringify({
          packetLabel: packet.label,
          files: displayFiles,
          extractedPages
        })
      }
    ],
    temperature: 0.1
  }

  try {
    const response = await fetch(`${process.env.DASHSCOPE_BASE_URL || defaultBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const message = await response.text()
      return fallbackParsingResult(packet, displayFiles, `DashScope 解析调用失败：${response.status} ${message.slice(0, 120)}`)
    }

    const result = await response.json()
    return {
      enabled: true,
      provider: 'dashscope',
      model: payload.model,
      confidence: inferParseConfidence(packet),
      steps: buildParseSteps(packet, displayFiles, true),
      content: result.choices?.[0]?.message?.content?.trim() || fallbackParsingResult(packet, displayFiles).content
    }
  } catch (error) {
    return fallbackParsingResult(packet, displayFiles, error.message || 'DashScope 解析调用失败')
  }
}

function fallbackReview(packet, audit, reason = '') {
  const high = audit.findings.filter((finding) => finding.severity === 'high').slice(0, 3)
  const medium = audit.findings.filter((finding) => finding.severity === 'medium').slice(0, 3)
  const review = audit.findings.filter((finding) => finding.severity === 'review').slice(0, 2)
  const lines = [
    `${packet.label}当前规则审核结果为${audit.summary.riskLevel}，通过率 ${audit.summary.passRate}%。`,
    high.length ? `优先处理高风险项：${high.map((finding) => finding.title).join('；')}。` : '未发现确定性高风险项。',
    medium.length ? `随后补齐中风险项：${medium.map((finding) => finding.title).join('；')}。` : '中风险项已基本清零。',
    review.length ? `仍需人工复核：${review.map((finding) => finding.title).join('；')}。` : '暂无额外人工复核提示。'
  ]

  return {
    enabled: false,
    provider: 'fallback',
    model: '',
    reason,
    content: lines.join('\n')
  }
}

function fallbackParsingResult(packet, files, reason = '') {
  return {
    enabled: false,
    provider: 'fallback',
    model: '',
    reason,
    confidence: inferParseConfidence(packet),
    steps: buildParseSteps(packet, files, false),
    content: [
      `已识别 ${files.length} 个输入文件，生成 ${packet.pages?.length || 0} 页验收材料结构。`,
      `抽取权威字段：${packet.authoritativeProject?.projectNo || '未识别项目编号'} / ${packet.authoritativeProject?.projectName || '未识别项目名称'}。`,
      '本地解析已完成正文、字段表、指标表、经费表和附件证据表的结构化抽取；AI 解析不可用时保留确定性结果用于规则审核。'
    ].join('\n')
  }
}

function buildParseSteps(packet, files, aiEnabled) {
  return [
    { name: '文件读取', status: 'done', detail: `读取 ${files.length} 个 Word/PDF/Excel 文件` },
    { name: 'AI版面识别', status: aiEnabled ? 'done' : 'fallback', detail: aiEnabled ? '已调用 DashScope 识别文件类型、标题和表格边界' : 'DashScope 不可用，使用本地结构化解析' },
    { name: '字段抽取', status: 'done', detail: `抽取 ${packet.pages?.length || 0} 页材料、项目权威字段和业务表格` },
    { name: '规则审核', status: 'done', detail: '已进入齐套性、一致性、签章和内容规则检查' }
  ]
}

function inferParseConfidence(packet) {
  const pageCount = packet.pages?.length || 0
  if (pageCount >= 12) return 92
  if (pageCount >= 6) return 82
  if (pageCount >= 1) return 68
  return 35
}
