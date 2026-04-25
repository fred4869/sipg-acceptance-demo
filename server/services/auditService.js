const severityWeight = {
  high: 3,
  medium: 2,
  low: 1,
  review: 0
}

export function auditPacket(packet) {
  const findings = []
  const pages = packet.pages || []
  const pageById = new Map(pages.map((page) => [page.id, page]))
  const auth = packet.authoritativeProject

  addCompletenessFindings(packet, pageById, findings)
  addSourceEvidenceFindings(pageById, findings)
  addFieldFindings(auth, pageById, findings)
  addFormFindings(pageById, findings)
  addContentFindings(pageById, findings)
  addAttachmentFindings(pageById, findings)
  addManualReviewFindings(packet, findings)

  const totalRules = 30
  const blockingScore = findings.reduce((sum, finding) => sum + severityWeight[finding.severity], 0)
  const failedRules = findings.filter((finding) => finding.severity !== 'review').length
  const passRate = Math.max(0, Math.round(((totalRules - failedRules) / totalRules) * 100))
  const riskLevel = blockingScore >= 12 ? '高风险' : blockingScore >= 5 ? '中风险' : '低风险'

  return {
    packetId: packet.id,
    summary: {
      totalRules,
      failedRules,
      passRate,
      riskLevel,
      findingCount: findings.length,
      highCount: findings.filter((finding) => finding.severity === 'high').length,
      mediumCount: findings.filter((finding) => finding.severity === 'medium').length,
      reviewCount: findings.filter((finding) => finding.severity === 'review').length
    },
    findings: findings.sort((a, b) => {
      return severityWeight[b.severity] - severityWeight[a.severity] || a.pageNo - b.pageNo
    }),
    materialStatus: buildMaterialStatus(packet, pageById)
  }
}

function addCompletenessFindings(packet, pageById, findings) {
  packet.requiredMaterials.forEach((material) => {
    const page = pageById.get(material.id)
    const listed = pageById.get('checklist')?.checklist?.find((item) => item.id === material.id)
    if (material.required && !page) {
      findings.push({
        id: `missing-${material.id}`,
        severity: 'high',
        type: '材料齐套',
        pageId: material.id,
        pageNo: page?.pageNo || 2,
        title: `缺少必交材料：${material.name}`,
        detail: '系统类项目验收应提供该项材料，清单中显示未提供或未装订。',
        suggestion: '补齐材料后重新生成验收清单，并确保线上审批包和纸质装订包一致。'
      })
    }

    if (material.required && page && listed?.provided === false) {
      findings.push({
        id: `checklist-conflict-${material.id}`,
        severity: 'medium',
        type: '材料齐套',
        pageId: 'checklist',
        evidencePageId: material.id,
        pageNo: pageById.get('checklist')?.pageNo || 4,
        title: `验收清单与正文材料不一致：${material.name}`,
        detail: '正文中存在该材料，但验收文件清单标记为缺失，容易造成线上审批包与纸质装订包不一致。',
        suggestion: '重新生成验收文件清单，确保目录、线上上传材料和装订正文完全一致。'
      })
    }
  })
}

function addSourceEvidenceFindings(pageById, findings) {
  const approval = pageById.get('approval')
  const taskBook = pageById.get('task-book')
  if (!approval?.fields?.projectNo || !approval?.fields?.projectName) {
    findings.push({
      id: 'source-approval-fields',
      severity: 'high',
      type: '权威来源',
      pageId: 'approval',
      pageNo: approval?.pageNo || 1,
      title: '批准立项文件无法抽取完整权威字段',
      detail: '缺少项目编号或项目名称时，后续封面、申请书、报告封面无法可靠比对。',
      suggestion: '补充三项计划发文正文和该项目所在计划表页，作为字段比对来源。'
    })
  }

  if (!taskBook?.indicators?.length) {
    findings.push({
      id: 'source-task-indicators',
      severity: 'high',
      type: '权威来源',
      pageId: 'task-book',
      pageNo: taskBook?.pageNo || 2,
      title: '计划任务书缺少考核指标',
      detail: '未抽取到任务书指标时，测试报告和成果完成情况无法形成闭环审核。',
      suggestion: '补充计划任务书中主要技术指标、考核方式和执行期关键页。'
    })
  }
}

function addFieldFindings(auth, pageById, findings) {
  const fieldPages = ['cover', 'application']
  fieldPages.forEach((id) => {
    const page = pageById.get(id)
    if (!page?.fields) return

    compareField(page, 'projectName', auth.projectName, '项目名称', findings)
    compareField(page, 'leader', auth.leader, '项目负责人', findings)
    compareField(page, 'owner', auth.owner, '承担单位', findings)
    compareField(page, 'period', auth.period, '项目执行期', findings)
    compareField(page, 'projectNo', auth.projectNo, '项目编号', findings)
  })
}

function compareField(page, key, expected, label, findings) {
  const actual = page.fields[key]
  if (!actual || !expected || actual === expected) return

  findings.push({
    id: `field-${page.id}-${key}`,
    severity: key === 'projectName' || key === 'leader' ? 'high' : 'medium',
    type: '字段一致',
    pageId: page.id,
    pageNo: page.pageNo,
    title: `${label}与权威信息不一致`,
    detail: `当前为“${actual}”，权威信息为“${expected}”。`,
    suggestion: '按三项计划发文和计划任务书统一修正，避免简称、错字、负责人误填为 OA 填报人。'
  })
}

function addFormFindings(pageById, findings) {
  const application = pageById.get('application')
  if (!application?.fields?.unitOpinion) {
    findings.push({
      id: 'form-application-opinion',
      severity: 'medium',
      type: '形式签章',
      pageId: 'application',
      pageNo: application?.pageNo || 3,
      title: '评审申请书缺申请单位意见',
      detail: '申请评审单位意见未填写或未体现盖章。',
      suggestion: '补充“项目已完成，验收资料整理齐全，已具备验收条件”等意见并加盖模拟单位章。'
    })
  }

  const testReport = pageById.get('test-report')
  if (!testReport?.fields?.leaderSignature) {
    findings.push({
      id: 'form-test-signature',
      severity: 'medium',
      type: '形式签章',
      pageId: 'test-report',
      pageNo: testReport?.pageNo || 8,
      title: '测试/检测报告缺测试组长签章',
      detail: '模板要求测试、检测专家组组长签/章，并填写日期。',
      suggestion: '补充测试组长签章和测试日期；若非第三方测试，应说明由项目组组织测试。'
    })
  }

  const userReport = pageById.get('user-report')
  if (!userReport?.fields?.seal) {
    findings.push({
      id: 'form-user-seal',
      severity: 'high',
      type: '形式签章',
      pageId: 'user-report',
      pageNo: userReport?.pageNo || 9,
      title: '用户使用报告缺应用单位盖章',
      detail: '系统类项目成果使用报告应由实际应用部门出具并盖章。',
      suggestion: '由实际使用部门补充使用数据、应用评价和模拟应用单位盖章。'
    })
  }

  const finance = pageById.get('finance')
  if (!finance?.fields?.financeSeal) {
    findings.push({
      id: 'form-finance-seal',
      severity: 'high',
      type: '形式签章',
      pageId: 'finance',
      pageNo: finance?.pageNo || 11,
      title: '经费决算报告缺财务章',
      detail: '经费决算报告要求由项目承担单位财务部门出具，使用财务章而非公司公章。',
      suggestion: '补充资产财务部印章，并核对预算、实际支出、研发支出和结余说明。'
    })
  }
}

function addContentFindings(pageById, findings) {
  const indicators = pageById.get('indicators')
  const taskBook = pageById.get('task-book')
  const expectedIndicatorIds = new Set((taskBook?.indicators || []).map((item) => item.id))
  const actualIndicatorIds = new Set((indicators?.indicators || []).map((item) => item.id))

  expectedIndicatorIds.forEach((id) => {
    if (!actualIndicatorIds.has(id)) {
      const expected = taskBook.indicators.find((item) => item.id === id)
      findings.push({
        id: `content-missing-task-indicator-${id}`,
        severity: 'medium',
        type: '内容质量',
        pageId: 'indicators',
        pageNo: indicators?.pageNo || 9,
        title: `成果完成情况缺少任务书指标：${expected?.label || id}`,
        detail: '计划任务书中的考核指标没有在成果完成情况或测试报告中逐项闭环。',
        suggestion: '按任务书指标逐项补充目标值、样本量、实测值和结论。'
      })
    }
  })

  indicators?.indicators?.forEach((item, index) => {
    if (!/\d/.test(item.actual || '')) {
      findings.push({
        id: `content-indicator-${index}`,
        severity: 'medium',
        type: '内容质量',
        pageId: 'indicators',
        pageNo: indicators.pageNo,
        title: `技术指标缺少具体测试数值：${item.label}`,
        detail: `当前测试结果为“${item.actual}”，不满足模板中“给出具体数值”的要求。`,
        suggestion: '补充测试样本量、测试周期、实测数值和是否达到计划任务书指标。'
      })
    }

    if (!item.sampleSize) {
      findings.push({
        id: `content-indicator-sample-${index}`,
        severity: 'low',
        type: '内容质量',
        pageId: 'indicators',
        pageNo: indicators.pageNo,
        title: `技术指标缺少测试样本量：${item.label}`,
        detail: '仅给出实测结论，缺少样本量或测试周期时，审核人员难以判断测试结果是否充分。',
        suggestion: '补充抽样车次、流水条数、异常事件数量或连续测试周期。'
      })
    }
  })

  const testReport = pageById.get('test-report')
  if (testReport && !/\d/.test(testReport.fields?.conclusion || '')) {
    findings.push({
      id: 'content-test-conclusion',
      severity: 'medium',
      type: '内容质量',
      pageId: 'test-report',
      pageNo: testReport.pageNo,
      title: '测试结论过于宽泛',
      detail: '测试结论未列明主要指标的实测数值和达标情况。',
      suggestion: '按计划任务书指标逐项列出测试结果，例如识别准确率、推送时延、同步完整率。'
    })
  }

  const benefit = pageById.get('benefit')
  if (!benefit?.fields?.calculation) {
    findings.push({
      id: 'content-benefit-calculation',
      severity: 'medium',
      type: '内容质量',
      pageId: 'benefit',
      pageNo: benefit?.pageNo || 10,
      title: '效益分析缺少计算过程',
      detail: '当前只描述“效率提升”等结论，缺少时间、车次、人工或费用口径。',
      suggestion: '补充试运行周期、日均作业量、节约时间、人工减少或费用节约测算。'
    })
  }

  const userReport = pageById.get('user-report')
  if (userReport?.fields?.author?.includes('研发项目组')) {
    findings.push({
      id: 'content-user-author',
      severity: 'high',
      type: '内容质量',
      pageId: 'user-report',
      pageNo: userReport.pageNo,
      title: '用户使用报告疑似由研发方代拟',
      detail: `当前出具方为“${userReport.fields.author}”，模板要求由项目成果实际使用部门根据真实使用情况撰写。`,
      suggestion: '由实际应用单位补充试运行数据、应用评价和盖章，避免研发单位代写。'
    })
  }

  const missingUsageData = (userReport?.usageRows || []).filter((row) => /未统计|未填写|缺失/.test(row.value || ''))
  if (missingUsageData.length) {
    findings.push({
      id: 'content-user-usage-data',
      severity: 'medium',
      type: '内容质量',
      pageId: 'user-report',
      pageNo: userReport.pageNo,
      title: '用户使用报告缺少真实应用数据',
      detail: `缺少或未统计：${missingUsageData.map((row) => row.label).join('、')}。`,
      suggestion: '补充日均处理量、异常事件处理量、使用周期和应用效果数据，避免宽泛描述。'
    })
  }

  const finance = pageById.get('finance')
  const rowsWithoutRd = (finance?.budgetRows || []).filter((row) => !row.rd)
  if (rowsWithoutRd.length) {
    findings.push({
      id: 'content-finance-rd-expense',
      severity: 'medium',
      type: '内容质量',
      pageId: 'finance',
      pageNo: finance.pageNo,
      title: '经费决算表缺少列入研发支出口径',
      detail: `以下科目未列明研发支出金额：${rowsWithoutRd.map((row) => row.item).join('、')}。`,
      suggestion: '按预算、实际支出、列入研发支出和备注说明补齐决算表。'
    })
  }

  const financeRowsNeedApproval = (finance?.budgetRows || []).filter((row) => /超预算|调整/.test(row.note || ''))
  const appendix = pageById.get('appendix')
  const hasFinanceApproval = appendix?.evidenceRows?.some((row) => row.id === 'finance-approval' && row.status === '已提供')
  if (financeRowsNeedApproval.length && !hasFinanceApproval) {
    findings.push({
      id: 'content-finance-approval',
      severity: 'medium',
      type: '内容质量',
      pageId: 'finance',
      pageNo: finance.pageNo,
      title: '经费科目调整缺审批流程附件',
      detail: '决算表中存在超预算或科目调整说明，但附件证据中未见预算科目调整审批流程。',
      suggestion: '补充本单位财务或集团科信部审批流程确认单。'
    })
  }

  const workReport = pageById.get('work-report')
  const expectedCoverage = ['前期调研', '中期联调', '上线试运行', '验收准备']
  const missingCoverage = expectedCoverage.filter((item) => !workReport?.coverage?.some((value) => value.includes(item.replace('中期', '')) || value.includes(item)))
  if (missingCoverage.length) {
    findings.push({
      id: 'content-work-coverage',
      severity: 'low',
      type: '内容质量',
      pageId: 'work-report',
      pageNo: workReport?.pageNo || 4,
      title: '工作报告过程描述不完整',
      detail: `建议补充：${missingCoverage.join('、')}。`,
      suggestion: '按前期、中期、后期及上线使用情况组织工作报告正文。'
    })
  }

  const research = pageById.get('research-outline')
  const expectedSections = ['目录', '引言', '结论', '参考文献']
  const missingSections = expectedSections.filter((item) => !research?.researchSections?.includes(item))
  if (missingSections.length) {
    findings.push({
      id: 'content-research-sections',
      severity: 'low',
      type: '内容质量',
      pageId: 'research-outline',
      pageNo: research?.pageNo || 5,
      title: '研究报告结构缺少必要章节',
      detail: `当前缺少：${missingSections.join('、')}。`,
      suggestion: '补充结论和参考文献章节；项目金额较高时建议列入近五年文献。'
    })
  }
}

function addAttachmentFindings(pageById, findings) {
  const appendix = pageById.get('appendix')
  const missingRows = (appendix?.evidenceRows || []).filter((row) => row.status !== '已提供')
  missingRows.forEach((row) => {
    findings.push({
      id: `attachment-missing-${row.id}`,
      severity: row.id === 'test-raw-data' ? 'medium' : 'low',
      type: '附件证据',
      pageId: 'appendix',
      pageNo: appendix.pageNo,
      title: `附件证据缺失：${row.name}`,
      detail: `该附件用于支撑“${row.linkedPage}”，当前状态为“${row.status}”。`,
      suggestion: '补齐对应附件，或在验收正文中说明该附件不适用的原因。'
    })
  })

  const testReport = pageById.get('test-report')
  const hasRawData = appendix?.evidenceRows?.some((row) => row.id === 'test-raw-data' && row.status === '已提供')
  if (testReport?.indicators?.some((item) => /\d/.test(item.actual || '')) && !hasRawData) {
    findings.push({
      id: 'attachment-test-raw-data-required',
      severity: 'medium',
      type: '附件证据',
      pageId: 'appendix',
      pageNo: appendix?.pageNo || 15,
      title: '测试报告有数值但缺少原始记录表',
      detail: '测试报告列出实测数值时，应能追溯到测试原始记录、样本量和测试周期。',
      suggestion: '补充测试原始记录表或测试报告完整附件。'
    })
  }
}

function addManualReviewFindings(packet, findings) {
  findings.push({
    id: 'review-authenticity',
    severity: 'review',
    type: '人工复核',
    pageId: 'assets-ip',
    pageNo: 12,
    title: '知识产权证明和固定资产原件需人工复核',
    detail: 'demo 仅检查清单存在性，无法验证软著受理通知、固定资产入账和实物照片真实性。',
    suggestion: '正式版本应接入附件原文解析或由审核人员复核原件。'
  })

  if (packet.id === 'fixed-demo') {
    findings.push({
      id: 'review-finance-truth',
      severity: 'review',
      type: '人工复核',
      pageId: 'finance',
      pageNo: 11,
      title: '经费真实性和科目归集需财务复核',
      detail: '系统可做格式和字段检查，费用真实性、研发支出口径仍需财务部门确认。',
      suggestion: '后续可接入预算表、报销台账和审批流，形成自动交叉核验。'
    })
  }
}

function buildMaterialStatus(packet, pageById) {
  const checklist = pageById.get('checklist')?.checklist || []
  const conflictIds = new Set()
  packet.requiredMaterials.forEach((material) => {
    const listed = checklist.find((item) => item.id === material.id)
    const page = pageById.get(material.id)
    if (material.required && page && listed?.provided === false) conflictIds.add(material.id)
  })

  return packet.requiredMaterials.map((material) => {
    const listed = checklist.find((item) => item.id === material.id)
    const page = pageById.get(material.id)
    const hasConflict = conflictIds.has(material.id)
    return {
      ...material,
      pageNo: page?.pageNo,
      provided: Boolean(page),
      status: hasConflict ? '清单冲突' : Boolean(page) ? '已提供' : '缺失',
      conflict: hasConflict
    }
  })
}
