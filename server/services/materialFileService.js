import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { samplePackets } from '../data/samplePackets.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const materialsDir = path.join(rootDir, 'materials')

const pageDefs = [
  ['approval', '批准立项文件摘录'],
  ['task-book', '计划任务书关键页'],
  ['cover', '验收材料封面'],
  ['checklist', '验收文件清单'],
  ['application', '科技项目评审申请书'],
  ['work-report', '工作报告'],
  ['research-outline', '研究报告目录与摘要'],
  ['architecture', '系统架构与数据流'],
  ['indicators', '关键功能与技术指标完成情况'],
  ['test-report', '产品测试/检测报告'],
  ['user-report', '项目成果用户使用报告'],
  ['benefit', '效益分析'],
  ['finance', '项目经费决算报告'],
  ['assets-ip', '成果、知识产权与固定资产清单'],
  ['appendix', '附件证据清单']
]

const pageIdByTitle = new Map(pageDefs.map(([id, title]) => [title, id]))
const requiredMaterials = pageDefs.map(([id, name]) => ({ id, name, required: true }))

const indicatorIdByLabel = new Map([
  ['闸口车辆号牌识别准确率', 'plate-accuracy'],
  ['异常事件平均推送时延', 'event-latency'],
  ['道口作业数据同步完整率', 'sync-rate'],
  ['异常事件闭环率', 'closed-loop-rate']
])

const evidenceIdByName = new Map([
  ['三项计划发文摘录.pdf', 'approval-pdf'],
  ['计划任务书关键页.docx', 'task-book-docx'],
  ['系统使用说明书.pdf', 'use-manual'],
  ['测试原始记录表.xlsx', 'test-raw-data'],
  ['作业协同看板截图.zip', 'system-screenshot'],
  ['预算科目调整审批流程.pdf', 'finance-approval'],
  ['软著受理通知书.pdf', 'ip-proof']
])

export async function listFileBackedPackets() {
  const dirs = await safeReadDir(materialsDir)
  const fileBacked = await Promise.all(
    dirs
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => packetOrder(a.name) - packetOrder(b.name) || a.name.localeCompare(b.name))
      .map(async (entry) => {
        const id = entry.name
        const fallback = findFallbackPacket(id)
        const packetDir = path.join(materialsDir, id)
        const pages = await listPageFiles(packetDir)
        const sourceFiles = await listSourceFiles(packetDir)
        const displayMeta = packetDisplayMeta(id, fallback)
        return {
          id,
          label: displayMeta.label,
          description: displayMeta.description,
          badge: displayMeta.badge,
          files: [...pages, ...sourceFiles],
          pageFiles: pages,
          sourceFiles
        }
      })
  )

  return fileBacked.length ? fileBacked : samplePackets.map((packet) => ({ id: packet.id, ...packetDisplayMeta(packet.id, packet) }))
}

export async function loadPacketFromSelectedFiles(id, selectedFiles = []) {
  if (!selectedFiles.length) return loadPacketFromFiles(id)

  const packetDir = path.join(materialsDir, id)
  const fallback = findFallbackPacket(id)
  const selectableFiles = await listSelectableFileMap(packetDir)
  const files = []

  for (const selectedFile of selectedFiles) {
    const relativePath = selectableFiles.get(selectedFile) || selectedFile
    const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '')
    const filePath = path.join(packetDir, safePath)
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) continue
    files.push({
      name: path.basename(filePath),
      relativePath: safePath,
      content: await fs.readFile(filePath, 'utf8')
    })
  }

  const hasMarkdownPages = files.some((file) => /^\d{2}-.+\.md$/i.test(path.basename(file.relativePath)))
  const parseFiles = hasMarkdownPages
    ? files.filter((file) => !file.relativePath.endsWith('packet-structured.json') && file.name !== 'packet-structured.json')
    : files

  const packet = buildPacketFromUploadedFiles(parseFiles, id)
  const displayMeta = packetDisplayMeta(id, fallback)
  if (!packet) {
    return {
      id,
      label: displayMeta.label,
      badge: displayMeta.badge,
      description: displayMeta.description,
      authoritativeProject: fallback?.authoritativeProject,
      requiredMaterials,
      industryNotes: fallback?.industryNotes || [],
      sources: fallback?.sources || [],
      materialFiles: files.map((file) => displayMaterialPath(file.relativePath)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
      pages: []
    }
  }

  return {
    ...packet,
    id,
    label: displayMeta.label,
    badge: displayMeta.badge,
    description: displayMeta.description,
    industryNotes: fallback?.industryNotes || packet.industryNotes,
    sources: fallback?.sources || packet.sources,
    materialFiles: files.map((file) => displayMaterialPath(file.relativePath)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }
}

function packetOrder(id) {
  if (id === 'issue-demo') return 1
  if (id === 'fixed-demo') return 2
  return 99
}

function packetDisplayMeta(id, fallback) {
  if (id === 'issue-demo') {
    return {
      label: '客户送审材料',
      badge: '待审核',
      description: '客户首次提交的一整包验收材料；系统不预设是否合规，解析后自动识别缺项、冲突和风险。'
    }
  }

  if (id === 'fixed-demo') {
    return {
      label: '客户二次提交材料',
      badge: '复审材料',
      description: '客户补充后的再次提交材料；仍按未知状态重新解析和审核，用于查看前后两次提交差异。'
    }
  }

  return {
    label: fallback?.label || id,
    badge: fallback?.badge || '待审核',
    description: fallback?.description || '待解析的客户材料包。'
  }
}

export async function loadPacketFromFiles(id) {
  const packetDir = path.join(materialsDir, id)
  const stat = await fs.stat(packetDir).catch(() => null)
  if (!stat?.isDirectory()) return findFallbackPacket(id)

  const fallback = findFallbackPacket(id)
  const displayMeta = packetDisplayMeta(id, fallback)
  const entries = (await fs.readdir(packetDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{2}-.+\.md$/.test(entry.name) && !entry.name.startsWith('00-'))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))

  const pages = []
  for (const entry of entries) {
    const filePath = path.join(packetDir, entry.name)
    const markdown = await fs.readFile(filePath, 'utf8')
    pages.push(parsePageMarkdown(markdown, entry.name, filePath))
  }

  const authoritativeProject = parseAuthoritativeProject(pages) || fallback?.authoritativeProject

  return {
    id,
    label: displayMeta.label,
    badge: displayMeta.badge,
    description: displayMeta.description,
    authoritativeProject,
    requiredMaterials,
    industryNotes: fallback?.industryNotes || [],
    sources: fallback?.sources || [],
    materialFiles: await listMaterialFiles(packetDir),
    pages
  }
}

export function buildPacketFromUploadedFiles(files, fallbackId = 'uploaded-demo') {
  const normalizedFiles = (files || [])
    .filter((file) => file?.name && typeof file.content === 'string')
    .map((file) => ({
      name: file.name,
      relativePath: file.relativePath || file.name,
      content: file.content
    }))

  const structured = normalizedFiles.find((file) => file.relativePath.endsWith('packet-structured.json') || file.name === 'packet-structured.json')
  if (structured) {
    try {
      const packet = JSON.parse(structured.content)
      return {
        ...packet,
        id: fallbackId,
        label: packet.label || '上传材料包',
        badge: '用户上传',
        description: '从用户上传的结构化材料包解析生成。',
        materialFiles: normalizedFiles.map((file) => displayMaterialPath(file.relativePath)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      }
    } catch {
      // Fall through to Markdown parsing.
    }
  }

  const markdownFiles = normalizedFiles
    .filter((file) => /^\d{2}-.+\.md$/i.test(path.basename(file.relativePath)) && !path.basename(file.relativePath).startsWith('00-'))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN'))

  if (!markdownFiles.length) {
    const officePages = buildPagesFromOfficeFiles(normalizedFiles)
    if (!officePages.length) return null

    return {
      id: fallbackId,
      label: '上传材料包',
      badge: '用户上传',
      description: '从用户上传的 Word/PDF/Excel 文件解析生成。',
      authoritativeProject: samplePackets[0].authoritativeProject,
      requiredMaterials,
      industryNotes: [
        '该材料包来自用户本地上传文件，系统已按文件名和AI解析流程生成材料结构。',
        '当前 demo 对真实 PDF/Word/Excel 的正文内容采用占位解析；后续可接入 OCR、Office 文档解析和表格抽取。'
      ],
      sources: [],
      materialFiles: normalizedFiles.map((file) => displayMaterialPath(file.relativePath)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
      pages: officePages
    }
  }

  const pages = markdownFiles.map((file) => parsePageMarkdown(file.content, path.basename(file.relativePath), file.relativePath))
  const authoritativeProject = parseAuthoritativeProject(pages) || samplePackets[0].authoritativeProject

  return {
    id: fallbackId,
    label: '上传材料包',
    badge: '用户上传',
    description: '从用户上传的 Word/PDF/Excel 文件解析生成。',
    authoritativeProject,
    requiredMaterials,
    industryNotes: [
      '该材料包来自用户本地上传文件，系统按文件内容重新解析并执行确定性审核规则。',
      '当前 demo 演示 Word/PDF/Excel 材料的解析流程；真实正文级 OCR、Office 文档解析和复杂表格抽取可作为下一阶段扩展。'
    ],
    sources: [],
    materialFiles: normalizedFiles.map((file) => displayMaterialPath(file.relativePath)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    pages
  }
}

function buildPagesFromOfficeFiles(files) {
  return files
    .filter((file) => /\.(pdf|docx?|xlsx?)$/i.test(file.relativePath))
    .map((file, index) => {
      const title = inferPageTitleFromFile(file.relativePath)
      const id = pageIdByTitle.get(title) || slugFromTitle(title)
      const pageDefIndex = pageDefs.findIndex(([pageId]) => pageId === id)
      return {
        id,
        pageNo: pageDefIndex >= 0 ? pageDefIndex + 1 : index + 1,
        title,
        status: 'provided',
        sourceFile: displayMaterialPath(file.relativePath),
        sections: [
          `已接收上传文件 ${displayFileName(file.relativePath)}。`,
          'demo 当前根据文件名完成材料类型识别，并交由 AI 解析步骤生成抽取摘要；正文级 OCR/Office 原文抽取可在下一阶段接入。'
        ],
        chips: ['用户上传', displayFormat(file.relativePath)]
      }
    })
    .sort((a, b) => a.pageNo - b.pageNo)
}

function inferPageTitleFromFile(relativePath = '') {
  const fileName = path.basename(relativePath).replace(/\.(pdf|docx?|xlsx?)$/i, '')
  const match = pageDefs.find(([, title]) => fileName.includes(title) || title.includes(fileName.replace(/^\d{2}-/, '')))
  return match?.[1] || fileName.replace(/^\d{2}-/, '') || '未分类上传材料'
}

async function listMaterialFiles(packetDir) {
  const files = []
  await walk(packetDir, files)
  return files
    .map((filePath) => path.relative(packetDir, filePath))
    .filter((relativePath) => !relativePath.startsWith('.'))
    .filter((relativePath) => !/^00-.+\.md$/i.test(path.basename(relativePath)))
    .map((relativePath) => displayMaterialPath(relativePath))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

async function listPageFiles(packetDir) {
  const entries = await safeReadDir(packetDir)
  return entries
    .filter((entry) => entry.isFile() && /^\d{2}-.+\.md$/.test(entry.name) && !entry.name.startsWith('00-'))
    .map((entry) => {
      const title = entry.name.replace(/^\d{2}-/, '').replace(/\.md$/, '')
      return {
        path: fileToken(entry.name),
        name: displayFileName(entry.name),
        displayPath: displayMaterialPath(entry.name),
        format: displayFormat(entry.name),
        type: '验收正文',
        selected: true
      }
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listSourceFiles(packetDir) {
  const sourceDir = path.join(packetDir, 'source-files')
  const entries = await safeReadDir(sourceDir)
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      path: fileToken(`source-files/${entry.name}`),
      name: displayFileName(`source-files/${entry.name}`),
      displayPath: displayMaterialPath(`source-files/${entry.name}`),
      format: displayFormat(`source-files/${entry.name}`),
      type: displayFormat(`source-files/${entry.name}`),
      selected: true
    }))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listSelectableFileMap(packetDir) {
  const entries = await safeReadDir(packetDir)
  const sourceEntries = await safeReadDir(path.join(packetDir, 'source-files'))
  const pairs = [
    ...entries
      .filter((entry) => entry.isFile() && /^\d{2}-.+\.md$/.test(entry.name) && !entry.name.startsWith('00-'))
      .map((entry) => [fileToken(entry.name), entry.name]),
    ...sourceEntries
      .filter((entry) => entry.isFile())
      .map((entry) => [fileToken(`source-files/${entry.name}`), `source-files/${entry.name}`])
  ]
  return new Map(pairs)
}

function fileToken(relativePath = '') {
  const normalized = String(relativePath).replace(/\\/g, '/')
  const prefix = normalized.startsWith('source-files/') ? 'attachment' : 'document'
  const title = path.basename(normalized)
    .replace(/^\d{2}-/, '')
    .replace(/\.(md|txt|csv|json)$/i, '')
    .replace(/^packet-structured$/i, 'AI抽取结构化结果')
  const pageNo = path.basename(normalized).match(/^(\d{2})-/)?.[1]
  return `${prefix}-${pageNo || slugFromTitle(title)}`
}

async function walk(currentDir, files) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath, files)
      continue
    }
    files.push(fullPath)
  }
}

function parsePageMarkdown(markdown, fileName, filePath) {
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1] || fileName.replace(/\.md$/, '')
  const title = firstHeading.replace(/^\d+\.\s*/, '').trim()
  const pageNo = Number(fileName.match(/^(\d{2})-/)?.[1] || firstHeading.match(/^(\d+)\./)?.[1] || 0)
  const id = pageIdByTitle.get(title) || slugFromTitle(title)
  const sections = parseBodySections(markdown)
  const fields = parseNamedTable(markdown, '抽取字段', '字段', '内容')
  const checklist = parseChecklist(markdown)
  const indicators = parseIndicators(markdown)
  const usageRows = parseKeyValueTable(markdown, '使用数据')
  const budgetRows = parseBudgetRows(markdown)
  const assetRows = parseAssetRows(markdown)
  const evidenceRows = parseEvidenceRows(markdown)

  const page = {
    id,
    pageNo,
    title,
    status: 'provided',
    sourceFile: displayMaterialPath(path.isAbsolute(filePath) ? path.relative(rootDir, filePath) : filePath),
    sections,
    chips: inferChips(id, title)
  }

  if (Object.keys(fields).length) page.fields = fields
  if (checklist.length) page.checklist = checklist
  if (indicators.length) page.indicators = indicators
  if (usageRows.length) page.usageRows = usageRows
  if (budgetRows.length) page.budgetRows = budgetRows
  if (assetRows.length) page.assetRows = assetRows
  if (evidenceRows.length) page.evidenceRows = evidenceRows

  if (id === 'work-report') page.coverage = extractListFromText(sections.join('\n'), '工作过程覆盖')
  if (id === 'research-outline') page.researchSections = extractListFromText(sections.join('\n'), '报告结构')

  return page
}

function parseBodySections(markdown) {
  const body = sectionAfter(markdown, '正文')
  if (!body) return []
  return body
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, ' ').trim())
    .filter((part) => part && !part.startsWith('|') && !part.startsWith('## '))
}

function parseAuthoritativeProject(pages) {
  const approval = pages.find((page) => page.id === 'approval')
  return approval?.fields && Object.keys(approval.fields).length ? approval.fields : null
}

function parseChecklist(markdown) {
  return parseTableAfterHeading(markdown, '验收文件清单').map((row) => ({
    id: pageIdByTitle.get(row['材料']) || slugFromTitle(row['材料']),
    name: row['材料'],
    required: row['要求'] === '必交',
    provided: row['状态'] === '已提供'
  }))
}

function parseIndicators(markdown) {
  return parseTableAfterHeading(markdown, '指标表').map((row) => ({
    id: indicatorIdByLabel.get(row['指标']) || slugFromTitle(row['指标']),
    label: row['指标'],
    target: row['目标'],
    sampleSize: row['样本量 / 方法'] === '未填写' ? '' : row['样本量 / 方法'],
    method: row['样本量 / 方法'] === '未填写' ? '' : row['样本量 / 方法'],
    actual: row['实测'] === '任务书指标' ? '' : row['实测'],
    passed: row['结论'] === '比对基准' ? '' : row['结论']
  }))
}

function parseKeyValueTable(markdown, heading) {
  return parseTableAfterHeading(markdown, heading).map((row) => ({
    label: row['项目'],
    value: row['数据']
  }))
}

function parseBudgetRows(markdown) {
  return parseTableAfterHeading(markdown, '经费决算表').map((row) => ({
    item: row['科目'],
    budget: row['预算'],
    actual: row['实际'],
    rd: row['研发支出'] === '未填写' ? '' : row['研发支出'],
    note: row['备注']
  }))
}

function parseAssetRows(markdown) {
  return parseTableAfterHeading(markdown, '成果与资产清单').map((row) => ({
    type: row['类型'],
    name: row['名称'],
    proof: row['证明材料']
  }))
}

function parseEvidenceRows(markdown) {
  return parseTableAfterHeading(markdown, '附件证据清单').map((row) => ({
    id: evidenceIdByName.get(row['附件']) || slugFromTitle(row['附件']),
    name: row['附件'],
    type: row['类型'],
    linkedPage: row['关联材料'],
    status: row['状态']
  }))
}

function parseNamedTable(markdown, heading, keyColumn, valueColumn) {
  return Object.fromEntries(
    parseTableAfterHeading(markdown, heading)
      .map((row) => [fieldKey(row[keyColumn]), row[valueColumn] === '未填写' ? '' : row[valueColumn]])
      .filter(([key]) => key)
  )
}

function parseTableAfterHeading(markdown, heading) {
  const section = sectionAfter(markdown, heading)
  if (!section) return []
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))

  if (lines.length < 2) return []
  const headers = splitTableRow(lines[0])
  return lines
    .slice(2)
    .map((line) => splitTableRow(line))
    .filter((cells) => cells.length === headers.length)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]])))
}

function sectionAfter(markdown, heading) {
  const regex = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, 'm')
  const match = regex.exec(markdown)
  if (!match) return ''
  const start = match.index + match[0].length
  const rest = markdown.slice(start)
  const next = rest.search(/^##\s+/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function extractListFromText(text, label) {
  const match = text.match(new RegExp(`${escapeRegExp(label)}：([^。]+)`))
  if (!match) return []
  return match[1].split('、').map((item) => item.trim()).filter(Boolean)
}

function inferChips(id, title) {
  if (id === 'approval' || id === 'task-book') return ['权威来源', '文件解析']
  if (id === 'appendix') return ['附件证据', '多文档解析']
  if (id === 'finance') return ['经费决算', '表格解析']
  if (id === 'test-report' || id === 'indicators') return ['指标核验', '任务书闭环']
  return [title.includes('报告') ? '验收报告' : '验收正文']
}

function fieldKey(label = '') {
  const keys = {
    项目编号: 'projectNo',
    项目名称: 'projectName',
    承担单位: 'owner',
    项目负责人: 'leader',
    项目执行期: 'period',
    项目类型: 'projectType',
    来源: 'source',
    上报日期: 'reportDate',
    申请评审单位: 'applicant',
    工作起止时间: 'period',
    申请评审时间: 'reviewMonth',
    联系人: 'contact',
    申请单位意见: 'unitOpinion',
    测试组织: 'testOrg',
    测试周期: 'testPeriod',
    测试组长签章: 'leaderSignature',
    测试结论: 'conclusion',
    应用单位: 'userDept',
    出具方: 'author',
    应用起止时间: 'usagePeriod',
    盖章: 'seal',
    计算过程: 'calculation',
    预算: 'budget',
    实际支出: 'actual',
    列入研发支出: 'rdExpense',
    财务章: 'financeSeal'
  }

  return keys[label] || ''
}

function slugFromTitle(title = '') {
  return title
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
}

function findFallbackPacket(id) {
  return samplePackets.find((packet) => packet.id === id)
}

async function safeReadDir(dir) {
  return fs.readdir(dir, { withFileTypes: true }).catch(() => [])
}

function displayFileName(relativePath = '') {
  return path.basename(displayMaterialPath(relativePath))
}

function displayMaterialPath(relativePath = '') {
  const normalized = String(relativePath).replace(/\\/g, '/')
  const baseName = path.basename(normalized)
  const rawTitle = baseName
    .replace(/^\d{2}-/, '')
    .replace(/\.(md|txt|csv|json|pdf|docx?|xlsx?)$/i, '')

  const title = rawTitle === 'packet-structured' ? 'AI抽取结构化结果' : rawTitle
  const folder = normalized.includes('/source-files/') || normalized.startsWith('source-files/') ? '附件材料' : '验收正文'
  return `${folder}/${title}${displayExtension(normalized)}`
}

function displayFormat(relativePath = '') {
  const ext = displayExtension(relativePath)
  if (ext === '.xlsx') return 'Excel'
  if (ext === '.docx') return 'Word'
  return 'PDF'
}

function displayExtension(relativePath = '') {
  const normalized = String(relativePath).replace(/\\/g, '/')
  if (/\.pdf$/i.test(normalized)) return '.pdf'
  if (/\.docx?$/i.test(normalized)) return '.docx'
  if (/\.xlsx?$/i.test(normalized)) return '.xlsx'
  if (/\.(csv|json)$/i.test(normalized)) return '.xlsx'
  if (/任务书|工作报告|研究报告|评审申请书|验收文件清单|经费决算|成果、知识产权|用户使用数据|经费决算表|附件证据清单/.test(normalized)) return '.docx'
  if (/测试指标结果|任务书指标|测试原始记录/.test(normalized)) return '.xlsx'
  return '.pdf'
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
