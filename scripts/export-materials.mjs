import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { samplePackets } from '../server/data/samplePackets.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(rootDir, 'materials')

await fs.rm(outputDir, { recursive: true, force: true })
await fs.mkdir(outputDir, { recursive: true })

for (const packet of samplePackets) {
  const packetDir = path.join(outputDir, packet.id)
  await fs.mkdir(packetDir, { recursive: true })

  await fs.writeFile(path.join(packetDir, '00-材料包说明.md'), renderPacketIndex(packet), 'utf8')
  await exportSourceFiles(packet, packetDir)

  for (const page of packet.pages) {
    const fileName = `${String(page.pageNo).padStart(2, '0')}-${sanitizeFileName(page.title)}.md`
    await fs.writeFile(path.join(packetDir, fileName), renderPage(packet, page), 'utf8')
  }
}

async function exportSourceFiles(packet, packetDir) {
  const sourceDir = path.join(packetDir, 'source-files')
  await fs.mkdir(sourceDir, { recursive: true })

  await fs.writeFile(path.join(sourceDir, 'packet-structured.json'), JSON.stringify(packet, null, 2), 'utf8')

  const approval = packet.pages.find((page) => page.id === 'approval')
  const taskBook = packet.pages.find((page) => page.id === 'task-book')
  const indicators = packet.pages.find((page) => page.id === 'indicators')
  const userReport = packet.pages.find((page) => page.id === 'user-report')
  const finance = packet.pages.find((page) => page.id === 'finance')
  const appendix = packet.pages.find((page) => page.id === 'appendix')

  await fs.writeFile(path.join(sourceDir, '三项计划发文摘录.txt'), renderPlainPage(approval), 'utf8')
  await fs.writeFile(path.join(sourceDir, '计划任务书关键页.txt'), renderPlainPage(taskBook), 'utf8')
  await fs.writeFile(path.join(sourceDir, '任务书指标.csv'), toCsv(taskBook?.indicators || [], ['label', 'target', 'method']), 'utf8')
  await fs.writeFile(path.join(sourceDir, '测试指标结果.csv'), toCsv(indicators?.indicators || [], ['label', 'target', 'sampleSize', 'actual', 'passed']), 'utf8')
  await fs.writeFile(path.join(sourceDir, '用户使用数据.csv'), toCsv(userReport?.usageRows || [], ['label', 'value']), 'utf8')
  await fs.writeFile(path.join(sourceDir, '经费决算表.csv'), toCsv(finance?.budgetRows || [], ['item', 'budget', 'actual', 'rd', 'note']), 'utf8')
  await fs.writeFile(path.join(sourceDir, '附件证据清单.csv'), toCsv(appendix?.evidenceRows || [], ['name', 'type', 'linkedPage', 'status']), 'utf8')

  const providedEvidence = appendix?.evidenceRows?.filter((row) => row.status === '已提供') || []
  await Promise.all(providedEvidence.map((row) => {
    const safeName = sanitizeFileName(row.name.replace(/\.[^.]+$/, ''))
    return fs.writeFile(
      path.join(sourceDir, `${safeName}.txt`),
      [
        `模拟附件：${row.name}`,
        `附件类型：${row.type}`,
        `关联材料：${row.linkedPage}`,
        '',
        '本文件为 demo 演示附件文本版，用于模拟真实 PDF/Word/图片包经解析后的文本内容。'
      ].join('\n'),
      'utf8'
    )
  }))
}

console.log(`Exported ${samplePackets.length} packets to ${outputDir}`)

function renderPacketIndex(packet) {
  return [
    `# ${packet.label}`,
    '',
    `> ${packet.description}`,
    '',
    '## 项目信息',
    '',
    renderFields(packet.authoritativeProject),
    '',
    '## 材料清单',
    '',
    '| 页码 | 材料 |',
    '| --- | --- |',
    ...packet.pages.map((page) => `| ${page.pageNo} | ${page.title} |`),
    '',
    '## 样本说明',
    '',
    ...packet.industryNotes.map((note) => `- ${note}`),
    ''
  ].join('\n')
}

function renderPage(packet, page) {
  const lines = [
    `# ${page.pageNo}. ${page.title}`,
    '',
    `材料包：${packet.label}`,
    '',
    '> 本文件为 demo 演示模拟材料，不包含客户真实数据、真实签章、真实编号或真实人员信息。',
    ''
  ]

  if (page.chips?.length) {
    lines.push(`标签：${page.chips.join(' / ')}`, '')
  }

  if (page.sections?.length) {
    lines.push('## 正文', '')
    page.sections.forEach((section) => lines.push(section, ''))
  }

  if (page.fields) {
    lines.push('## 抽取字段', '', renderFields(page.fields), '')
  }

  if (page.checklist) {
    lines.push('## 验收文件清单', '', '| 材料 | 要求 | 状态 |', '| --- | --- | --- |')
    page.checklist.forEach((row) => {
      lines.push(`| ${row.name} | ${row.required ? '必交' : '若有'} | ${row.provided ? '已提供' : '缺失'} |`)
    })
    lines.push('')
  }

  if (page.indicators) {
    lines.push('## 指标表', '', '| 指标 | 目标 | 样本量 / 方法 | 实测 | 结论 |', '| --- | --- | --- | --- | --- |')
    page.indicators.forEach((row) => {
      lines.push(`| ${row.label} | ${row.target} | ${row.sampleSize || row.method || '未填写'} | ${row.actual || '任务书指标'} | ${row.passed || '比对基准'} |`)
    })
    lines.push('')
  }

  if (page.usageRows) {
    lines.push('## 使用数据', '', '| 项目 | 数据 |', '| --- | --- |')
    page.usageRows.forEach((row) => lines.push(`| ${row.label} | ${row.value} |`))
    lines.push('')
  }

  if (page.budgetRows) {
    lines.push('## 经费决算表', '', '| 科目 | 预算 | 实际 | 研发支出 | 备注 |', '| --- | --- | --- | --- | --- |')
    page.budgetRows.forEach((row) => lines.push(`| ${row.item} | ${row.budget} | ${row.actual} | ${row.rd || '未填写'} | ${row.note} |`))
    lines.push('')
  }

  if (page.assetRows) {
    lines.push('## 成果与资产清单', '', '| 类型 | 名称 | 证明材料 |', '| --- | --- | --- |')
    page.assetRows.forEach((row) => lines.push(`| ${row.type} | ${row.name} | ${row.proof} |`))
    lines.push('')
  }

  if (page.evidenceRows) {
    lines.push('## 附件证据清单', '', '| 附件 | 类型 | 关联材料 | 状态 |', '| --- | --- | --- | --- |')
    page.evidenceRows.forEach((row) => lines.push(`| ${row.name} | ${row.type} | ${row.linkedPage} | ${row.status} |`))
    lines.push('')
  }

  return lines.join('\n')
}

function renderPlainPage(page) {
  if (!page) return ''
  return [
    page.title,
    '',
    ...(page.sections || []),
    '',
    page.fields ? renderFields(page.fields) : '',
    page.indicators ? toCsv(page.indicators, ['label', 'target', 'method']) : ''
  ].join('\n')
}

function toCsv(rows, columns) {
  const header = columns.join(',')
  const body = rows.map((row) => columns.map((column) => csvCell(row[column] || '')).join(','))
  return [header, ...body].join('\n')
}

function csvCell(value) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function renderFields(fields) {
  return [
    '| 字段 | 内容 |',
    '| --- | --- |',
    ...Object.entries(fields).map(([key, value]) => `| ${fieldLabel(key)} | ${value || '未填写'} |`)
  ].join('\n')
}

function fieldLabel(key) {
  const labels = {
    projectNo: '项目编号',
    projectName: '项目名称',
    owner: '承担单位',
    leader: '项目负责人',
    period: '项目执行期',
    projectType: '项目类型',
    source: '来源',
    reportDate: '上报日期',
    applicant: '申请评审单位',
    reviewMonth: '申请评审时间',
    contact: '联系人',
    unitOpinion: '申请单位意见',
    testOrg: '测试组织',
    testPeriod: '测试周期',
    leaderSignature: '测试组长签章',
    conclusion: '测试结论',
    userDept: '应用单位',
    author: '出具方',
    usagePeriod: '应用起止时间',
    seal: '盖章',
    calculation: '计算过程',
    budget: '预算',
    actual: '实际支出',
    rdExpense: '列入研发支出',
    financeSeal: '财务章'
  }

  return labels[key] || key
}

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '-')
}
