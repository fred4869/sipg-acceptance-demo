import { useEffect, useMemo, useState } from 'react'

const severityLabel = {
  high: '高',
  medium: '中',
  low: '低',
  review: '复核'
}

const severityClass = {
  high: 'danger',
  medium: 'warning',
  low: 'notice',
  review: 'review'
}

export default function App() {
  const [packets, setPackets] = useState([])
  const [packetId, setPacketId] = useState('')
  const [packet, setPacket] = useState(null)
  const [audit, setAudit] = useState(null)
  const [inputMode, setInputMode] = useState('sample')
  const [activeView, setActiveView] = useState('overview')
  const [activePageId, setActivePageId] = useState('')
  const [loading, setLoading] = useState(false)
  const [packetsLoading, setPacketsLoading] = useState(true)
  const [error, setError] = useState('')
  const [aiReviews, setAiReviews] = useState({})
  const [aiLoading, setAiLoading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [secondSubmissionFiles, setSecondSubmissionFiles] = useState([])
  const [expandedPacketId, setExpandedPacketId] = useState('issue-demo')
  const [selectedSampleFiles, setSelectedSampleFiles] = useState({})
  const [parseStage, setParseStage] = useState('')
  const [comparisonRuns, setComparisonRuns] = useState([])
  const aiReviewKey = packet ? `${packet.id}:${(packet.materialFiles || []).join('|')}` : packetId
  const aiReview = aiReviews[aiReviewKey]

  useEffect(() => {
    let cancelled = false

    async function loadPackets() {
      try {
        const response = await fetch('/api/sample-packets')
        if (!response.ok) throw new Error('样例包列表加载失败')
        const payload = await response.json()
        if (!cancelled) {
          const nextPackets = payload.packets || []
          setPackets(nextPackets)
          setSelectedSampleFiles(Object.fromEntries(nextPackets.map((packet) => [
            packet.id,
            (packet.files || []).map((file) => file.path)
          ])))
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      } finally {
        if (!cancelled) setPacketsLoading(false)
      }
    }

    loadPackets()
    return () => {
      cancelled = true
    }
  }, [])

  const activePage = useMemo(() => {
    return packet?.pages?.find((page) => page.id === activePageId) || packet?.pages?.[0]
  }, [packet, activePageId])

  const findingsForPage = useMemo(() => {
    return audit?.findings?.filter((finding) => finding.pageId === activePageId) || []
  }, [audit, activePageId])
  const groupedFindings = useMemo(() => groupFindings(audit?.findings || []), [audit])
  const fixedPacketMeta = packets.find((item) => item.id === 'fixed-demo')

  async function generateAiReview() {
    if (!packet || !audit || aiLoading) return
    try {
      setAiLoading(true)
      const response = await fetch('/api/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packet, audit })
      })
      if (!response.ok) throw new Error('AI 复核意见生成失败')
      const payload = await response.json()
      const reviewKey = `${packet.id}:${(packet.materialFiles || []).join('|')}`
      setAiReviews((current) => ({ ...current, [reviewKey]: payload }))
    } catch (loadError) {
      const reviewKey = `${packet.id}:${(packet.materialFiles || []).join('|')}`
      setAiReviews((current) => ({
        ...current,
        [reviewKey]: { enabled: false, provider: 'fallback', content: loadError.message }
      }))
    } finally {
      setAiLoading(false)
    }
  }

  function openFinding(finding) {
    setActiveView('materials')
    setActivePageId(finding.pageId)
  }

  async function parseSample(nextPacketId, selectedPaths = selectedSampleFiles[nextPacketId] || []) {
    try {
      setLoading(true)
      setError('')
      setPacketId(nextPacketId)
      setParseStage('read')
      await wait(240)
      setParseStage('ai')
      const response = await fetch('/api/parse-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packetId: nextPacketId, selectedFiles: selectedPaths })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '样例材料解析失败')
      setParseStage('audit')
      await wait(260)
      setParseStage('result')
      await wait(180)
      openPacket(payload.packet, payload.audit)
      setComparisonRuns([])
      setSecondSubmissionFiles([])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
      setParseStage('')
    }
  }

  async function parseSelectedFiles() {
    if (!selectedFiles.length) {
      setError('请先选择材料文件或材料目录。')
      return
    }

    try {
      setLoading(true)
      setError('')
      setParseStage('read')
      await wait(240)
      const files = await Promise.all(selectedFiles.map(readBrowserFile))
      setParseStage('ai')
      const response = await fetch('/api/parse-uploaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '上传材料解析失败')
      setParseStage('audit')
      await wait(260)
      setParseStage('result')
      await wait(180)
      setPacketId(payload.packet.id)
      openPacket(payload.packet, payload.audit)
      setComparisonRuns([])
      setSecondSubmissionFiles([])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
      setParseStage('')
    }
  }

  function openPacket(nextPacket, nextAudit) {
    setPacket(nextPacket)
    setAudit(nextAudit)
    setActiveView('overview')
    setActivePageId(getInitialPageId(nextPacket, nextAudit))
  }

  async function generateComparison() {
    if (!packet || !audit || loading) return

    try {
      setLoading(true)
      setError('')
      setParseStage('read')
      await wait(220)
      setParseStage('ai')
      const fixedMeta = packets.find((item) => item.id === 'fixed-demo')
      const selectedPaths = selectedSampleFiles['fixed-demo'] || fixedMeta?.files?.map((file) => file.path) || []
      const response = await fetch('/api/parse-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packetId: 'fixed-demo', selectedFiles: selectedPaths })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '二次提交材料解析失败')
      setParseStage('audit')
      await wait(260)
      setComparisonRuns([
        { packet, audit },
        { packet: payload.packet, audit: payload.audit }
      ])
      setParseStage('result')
      await wait(160)
      setActiveView('compare')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
      setParseStage('')
    }
  }

  async function parseSecondSubmissionFiles() {
    if (!packet || !audit) return
    if (!secondSubmissionFiles.length) {
      setError('请先选择二次提交材料。')
      return
    }

    try {
      setLoading(true)
      setError('')
      setParseStage('read')
      await wait(240)
      const files = await Promise.all(secondSubmissionFiles.map(readBrowserFile))
      setParseStage('ai')
      const response = await fetch('/api/parse-uploaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '二次提交材料解析失败')
      setParseStage('audit')
      await wait(260)
      setComparisonRuns([
        { packet, audit },
        { packet: payload.packet, audit: payload.audit }
      ])
      setParseStage('result')
      await wait(160)
      setActiveView('compare')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
      setParseStage('')
    }
  }

  function toggleSampleFile(nextPacketId, filePath) {
    setSelectedSampleFiles((current) => {
      const selected = new Set(current[nextPacketId] || [])
      if (selected.has(filePath)) selected.delete(filePath)
      else selected.add(filePath)
      return { ...current, [nextPacketId]: Array.from(selected) }
    })
  }

  function selectAllSampleFiles(nextPacketId, files) {
    setSelectedSampleFiles((current) => ({
      ...current,
      [nextPacketId]: files.map((file) => file.path)
    }))
  }

  function selectRequiredSampleFiles(nextPacketId, files) {
    setSelectedSampleFiles((current) => ({
      ...current,
      [nextPacketId]: files.filter((file) => file.type === '验收正文').map((file) => file.path)
    }))
  }

  if (packetsLoading) {
    return <div className="loading-screen">正在加载审核入口...</div>
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">SIPG ACCEPTANCE COMPLIANCE</div>
          <h1>科技项目验收材料合规审核台</h1>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      <InputPanel
        packets={packets}
        packetId={packetId}
        inputMode={inputMode}
        selectedFiles={selectedFiles}
        loading={loading}
        parseStage={parseStage}
        onModeChange={setInputMode}
        onParseSample={parseSample}
        expandedPacketId={expandedPacketId}
        selectedSampleFiles={selectedSampleFiles}
        onExpandPacket={setExpandedPacketId}
        onToggleSampleFile={toggleSampleFile}
        onSelectAllSampleFiles={selectAllSampleFiles}
        onSelectRequiredSampleFiles={selectRequiredSampleFiles}
        onFilesChange={setSelectedFiles}
        onParseFiles={parseSelectedFiles}
      />

      {packet && audit && (
        <>
          <section className="summary-strip">
            <Metric label="风险等级" value={audit.summary.riskLevel} tone={audit.summary.riskLevel === '高风险' ? 'danger' : audit.summary.riskLevel === '中风险' ? 'warning' : 'safe'} />
            <Metric label="文件通过率" value={`${audit.summary.passRate}%`} tone="safe" />
            <Metric label="风险项" value={audit.summary.actionableCount} tone="warning" />
            <Metric label="高风险项" value={audit.summary.highCount} tone="danger" />
            <Metric label="中风险项" value={audit.summary.mediumCount} tone="warning" />
            <Metric label="人工复核" value={audit.summary.reviewCount} tone="review" />
          </section>

          <section className="project-card">
            <div>
              <span className="section-label">项目基准信息</span>
              <h2>{cleanDisplayText(packet.authoritativeProject.projectName)}</h2>
              <p>从立项文件和计划任务书抽取，用于核对封面、申请书、报告和经费表中的关键字段。</p>
            </div>
            <dl>
              <div><dt>项目编号</dt><dd>{cleanDisplayText(packet.authoritativeProject.projectNo)}</dd></div>
              <div><dt>承担单位</dt><dd>{cleanDisplayText(packet.authoritativeProject.owner)}</dd></div>
              <div><dt>项目负责人</dt><dd>{cleanDisplayText(packet.authoritativeProject.leader)}</dd></div>
              <div><dt>项目执行期</dt><dd>{cleanDisplayText(packet.authoritativeProject.period)}</dd></div>
              <div><dt>输入文件</dt><dd>{audit.fileSummary?.inputFiles || packet.materialFiles?.length || packet.pages.length} 个</dd></div>
            </dl>
          </section>

          <nav className="view-tabs" aria-label="审核视图">
            {[
              ['overview', '总览'],
              ['materials', '材料'],
              ['compare', '对比']
            ].map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                className={activeView === id ? 'view-tab active' : 'view-tab'}
                onClick={() => setActiveView(id)}
              >
                <strong>{label}</strong>
                {hint && <span>{hint}</span>}
              </button>
            ))}
          </nav>

          {activeView === 'overview' && (
            <OverviewPanel
              audit={audit}
              packet={packet}
              groupedFindings={groupedFindings}
              aiReview={aiReview}
              aiLoading={aiLoading}
              onGenerateAi={generateAiReview}
              onOpenFinding={openFinding}
            />
          )}

          {activeView === 'materials' && (
            <section className="workspace">
              <MaterialList
                audit={audit}
                activePageId={activePageId}
                onSelectPage={setActivePageId}
              />

              <section className="panel document-panel">
                <DocumentPage page={activePage} findings={findingsForPage} />
              </section>

              <FindingPanel
                findings={audit.findings}
                activePageId={activePageId}
                packet={packet}
                onOpenFinding={openFinding}
              />
            </section>
          )}

          {activeView === 'compare' && (
            <ComparePanel
              audit={audit}
              packet={packet}
              fixedPacketMeta={fixedPacketMeta}
              comparisonRuns={comparisonRuns}
              secondFiles={secondSubmissionFiles}
              loading={loading}
              onGenerateComparison={generateComparison}
              onSecondFilesChange={setSecondSubmissionFiles}
              onParseSecondFiles={parseSecondSubmissionFiles}
            />
          )}
        </>
      )}
    </main>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const parsePipeline = [
  ['read', '读取文件', ''],
  ['ai', 'AI抽取', ''],
  ['audit', '规则审核', ''],
  ['result', '生成结果', '']
]

function ParsePipeline({ activeStage }) {
  const activeIndex = Math.max(0, parsePipeline.findIndex(([id]) => id === activeStage))

  return (
    <div className="parse-pipeline">
      {parsePipeline.map(([id, label, detail], index) => (
        <div key={id} className={`parse-step ${index < activeIndex ? 'done' : ''} ${id === activeStage ? 'active' : ''}`}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
          {detail && <small>{detail}</small>}
        </div>
      ))}
    </div>
  )
}

function InputPanel({
  packets,
  packetId,
  inputMode,
  selectedFiles,
  loading,
  parseStage,
  expandedPacketId,
  selectedSampleFiles,
  onModeChange,
  onParseSample,
  onExpandPacket,
  onToggleSampleFile,
  onSelectAllSampleFiles,
  onSelectRequiredSampleFiles,
  onFilesChange,
  onParseFiles
}) {
  const primaryPacket = packets.find((item) => item.id === 'issue-demo') || packets[0]
  const primaryFiles = primaryPacket?.files || []
  const selectedPrimaryFiles = primaryPacket ? selectedSampleFiles[primaryPacket.id] || [] : []

  return (
    <section className="input-console">
      <div className="input-header">
        <div>
          <span className="section-label">审核输入</span>
          <h2>选择上传待审核材料</h2>
        </div>
        <div className="mode-toggle">
          <button type="button" className={inputMode === 'sample' ? 'active' : ''} onClick={() => onModeChange('sample')}>待审材料</button>
          <button type="button" className={inputMode === 'upload' ? 'active' : ''} onClick={() => onModeChange('upload')}>上传客户材料</button>
        </div>
      </div>

      {loading && <ParsePipeline activeStage={parseStage} />}

      {inputMode === 'sample' && (
        <section className="sample-case">
          <div className="case-header">
            <div>
              <span className="section-label">客户送审案例</span>
              <h3>当前提交</h3>
            </div>
            <div className="case-actions">
              <div className="case-total">
                <strong>{selectedPrimaryFiles.length}</strong>
                <span>已选 / {primaryFiles.length} 个文件</span>
              </div>
              <button
                type="button"
                className="primary-action case-submit"
                onClick={() => primaryPacket && onParseSample(primaryPacket.id, selectedPrimaryFiles)}
                disabled={loading || !primaryPacket || selectedPrimaryFiles.length === 0}
              >
                {loading ? 'AI预审中...' : '开始当前提交预审'}
              </button>
            </div>
          </div>

          <div className="sample-grid">
            {[primaryPacket].filter(Boolean).map((item) => {
              const files = item.files || []
              const selectedSet = new Set(selectedSampleFiles[item.id] || [])
              const isExpanded = expandedPacketId === item.id
              const pageCount = files.filter((file) => file.type === '验收正文').length
              const sourceCount = files.length - pageCount

              return (
                <article key={item.id} className={item.id === packetId ? 'sample-card active' : 'sample-card'}>
                  <div className="sample-card-header">
                    <div>
                      <span>{item.badge}</span>
                      <strong>{cleanDisplayText(item.label)}</strong>
                    </div>
                  </div>

                  <div className="sample-card-actions">
                    <button type="button" className="secondary-action compact-action" onClick={() => onExpandPacket(isExpanded ? '' : item.id)}>
                      {isExpanded ? '收起清单' : '查看清单'}
                    </button>
                    <button type="button" className="secondary-action compact-action" onClick={() => onSelectRequiredSampleFiles(item.id, files)}>
                      选择正文
                    </button>
                    <button type="button" className="secondary-action compact-action" onClick={() => onSelectAllSampleFiles(item.id, files)}>
                      选择全量
                    </button>
                  </div>

                  <div className="sample-file-summary">
                    <span>正文材料 {pageCount} 个</span>
                    <span>附件材料 {sourceCount} 个</span>
                  </div>

                  {isExpanded && (
                    <div className="sample-file-list">
                      {files.map((file) => (
                        <label className="sample-file-row" key={file.path}>
                          <input
                            type="checkbox"
                            checked={selectedSet.has(file.path)}
                            onChange={() => onToggleSampleFile(item.id, file.path)}
                          />
                          <span className={`file-type ${String(file.format || '').toLowerCase()}`}>{file.format || file.type}</span>
                          <strong>{cleanDisplayText(file.name)}</strong>
                          <small>{cleanDisplayText(file.displayPath || file.name)}</small>
                        </label>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      )}

      {inputMode === 'upload' && (
        <div className="upload-grid">
          <label className="upload-drop">
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              accept=".doc,.docx,.pdf,.xls,.xlsx"
              onChange={(event) => onFilesChange(Array.from(event.target.files || []))}
            />
            <strong>选择材料目录</strong>
          </label>
          <div className="upload-side">
            <label className="file-pick">
              <input
                type="file"
                multiple
                accept=".doc,.docx,.pdf,.xls,.xlsx"
                onChange={(event) => onFilesChange(Array.from(event.target.files || []))}
              />
              选择 Word / PDF / Excel 文件
            </label>
            <div className="upload-count">
              <span>已选文件</span>
              <strong>{selectedFiles.length}</strong>
            </div>
            <button type="button" className="primary-action" onClick={onParseFiles} disabled={loading || !selectedFiles.length}>
              {loading ? '解析中...' : '解析上传材料并审核'}
            </button>
            <div className="selected-file-list">
              {selectedFiles.map((file) => (
                <span key={file.webkitRelativePath || file.name}>{displayBrowserFileName(file.webkitRelativePath || file.name)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function OverviewPanel({ audit, packet, groupedFindings, aiReview, aiLoading, onGenerateAi, onOpenFinding }) {
  const mustFix = audit.findings.filter((finding) => finding.severity !== 'review')
  const fileSummary = audit.fileSummary || {}

  return (
    <section className="overview-grid">
      <div className="panel overview-panel">
        <div className="panel-title">
          <span className="section-label">整改优先级</span>
          <h2>{audit.summary.actionableCount} 个风险项，{audit.summary.reviewCount} 个人工复核</h2>
        </div>
        <div className="finding-groups">
          {Object.entries(groupedFindings).map(([severity, items]) => (
            <div className="finding-group" key={severity}>
              <span className={`severity ${severityClass[severity]}`}>{severityLabel[severity]}</span>
              <strong>{items.length} 项</strong>
              <small>{groupLabel(severity)}</small>
            </div>
          ))}
        </div>
        <div className="fix-list">
          {mustFix.map((finding, index) => (
            <button type="button" key={finding.id} onClick={() => onOpenFinding(finding)} className="fix-row">
              <span>{index + 1}</span>
              <strong>{finding.title}</strong>
              <small>{finding.type} · 第 {finding.pageNo} 页 · {finding.suggestion}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="panel ai-panel">
        <div className="panel-title">
          <span className="section-label">AI复核意见</span>
          <h2>生成整改摘要</h2>
        </div>
        <button type="button" className="primary-action" onClick={onGenerateAi} disabled={aiLoading}>
          {aiLoading ? '正在生成...' : aiReview ? '重新生成 AI 复核' : '生成 AI 复核意见'}
        </button>
        {aiReview ? (
          <>
            <p className="ai-content">{cleanDisplayText(aiReview.content)}</p>
            <p className="muted-small">已生成复核意见</p>
          </>
        ) : (
          <p className="empty-state">暂无复核意见。</p>
        )}
      </div>

      {packet.parseRun && (
        <div className="panel parse-result-panel">
          <div className="panel-title">
            <span className="section-label">AI材料解析</span>
            <h2>{packet.parseRun.confidence}% 抽取置信度</h2>
          </div>
          <div className="parse-run-steps">
            {packet.parseRun.steps?.map((step) => (
              <div key={step.name} className={`parse-run-step ${step.status}`}>
                <strong>{step.name}</strong>
                {step.detail && <span>{cleanDisplayText(step.detail)}</span>}
              </div>
            ))}
          </div>
          <p className="ai-content compact">{cleanDisplayText(packet.parseRun.content)}</p>
          <p className="muted-small">已完成材料解析</p>
        </div>
      )}

      <div className="panel file-panel">
        <div className="panel-title">
          <span className="section-label">解析文件</span>
          <h2>{fileSummary.inputFiles || packet.materialFiles?.length || 0} 个输入文件</h2>
        </div>
        <p className="muted-small">
          文件通过率按没问题文件数/总文件数计算：{fileSummary.passedFiles ?? 0} 个没问题，{fileSummary.failedFiles ?? 0} 个存在审核发现。
        </p>
        <div className="file-list">
          {(packet.materialFiles || []).map((file) => <span key={file}>{cleanDisplayText(file)}</span>)}
        </div>
      </div>
    </section>
  )
}

function MaterialList({ audit, activePageId, onSelectPage }) {
  return (
    <aside className="panel material-panel">
      <div className="panel-title">
        <span className="section-label">材料清单</span>
        <h2>{audit.materialStatus.length} 页材料包</h2>
      </div>
      <div className="material-list">
        {audit.materialStatus.map((material) => {
          const pageFindings = audit.findings.filter((finding) => finding.pageId === material.id)
          return (
            <button
              key={material.id}
              className={material.id === activePageId ? 'material-row active' : 'material-row'}
              type="button"
              onClick={() => onSelectPage(material.id)}
            >
              <span className={`dot ${material.conflict ? 'conflict' : material.provided ? 'ok' : 'missing'}`} />
              <strong>{cleanDisplayText(material.pageNo ? `${material.pageNo}. ${material.name}` : material.name)}</strong>
              <small>{material.status} · {pageFindings.length} 项发现</small>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function FindingPanel({ findings, activePageId, packet, onOpenFinding }) {
  const pageById = new Map((packet.pages || []).map((page) => [page.id, page]))
  const findingGroups = groupFindingsByFile(findings, packet, activePageId)

  return (
    <aside className="panel finding-panel">
      <div className="panel-title">
        <span className="section-label">审核发现</span>
        <h2>{findingGroups.length} 个文件 / {findings.length} 项</h2>
      </div>
      <div className="finding-list">
        {findingGroups.map((group) => (
          <section className={group.active ? 'finding-file-group active' : 'finding-file-group'} key={group.file}>
            <button type="button" className="finding-file-head" onClick={() => onOpenFinding(group.items[0])}>
              <strong>{cleanDisplayText(group.file)}</strong>
              <span>{group.items.length} 项</span>
            </button>
            {group.items.map((finding) => {
              const page = pageById.get(finding.pageId)
              const evidencePage = finding.evidencePageId ? pageById.get(finding.evidencePageId) : null
              return (
                <button
                  type="button"
                  key={finding.id}
                  className={finding.pageId === activePageId ? 'finding-card active' : 'finding-card'}
                  onClick={() => onOpenFinding(finding)}
                >
                  <div className="finding-head">
                    <span className={`severity ${severityClass[finding.severity]}`}>{severityLabel[finding.severity]}</span>
                    <span>{cleanDisplayText(finding.type)}</span>
                    <em>第 {finding.pageNo} 页</em>
                  </div>
                  <strong>{cleanDisplayText(finding.title)}</strong>
                  <p>{cleanDisplayText(finding.detail)}</p>
                  <small className="evidence-line">定位文件：{cleanDisplayText(page?.sourceFile || group.file)}</small>
                  {evidencePage && <small className="evidence-line">关联证据：{cleanDisplayText(evidencePage.sourceFile)}</small>}
                  <small className="evidence-line">建议：{cleanDisplayText(finding.suggestion)}</small>
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
  )
}

function ComparePanel({
  audit,
  packet,
  fixedPacketMeta,
  comparisonRuns,
  secondFiles,
  loading,
  onGenerateComparison,
  onSecondFilesChange,
  onParseSecondFiles
}) {
  const currentRun = comparisonRuns[0] || { packet, audit }
  const secondRun = comparisonRuns[1]
  const resolvedCount = secondRun ? Math.max(0, currentRun.audit.summary.actionableCount - secondRun.audit.summary.actionableCount) : 0
  const [leftPageId, setLeftPageId] = useState('')
  const [rightPageId, setRightPageId] = useState('')

  useEffect(() => {
    if (currentRun?.packet.pages?.length) setLeftPageId(currentRun.packet.pages[0].id)
    if (secondRun?.packet.pages?.length) setRightPageId(secondRun.packet.pages[0].id)
  }, [currentRun, secondRun])

  return (
    <>
      <section className="compare-grid">
        <div className="panel compare-panel">
          <div className="panel-title">
            <span className="section-label">当前提交</span>
            <h2>{cleanDisplayText(currentRun.packet.label)}</h2>
          </div>
          <Metric label="当前风险项" value={currentRun.audit.summary.actionableCount} tone="warning" />
          <Metric label="当前输入文件" value={currentRun.audit.fileSummary?.inputFiles || currentRun.packet.materialFiles?.length || 0} tone="safe" />
        </div>
        <div className="panel compare-panel second-submit-panel">
          <div className="panel-title">
            <span className="section-label">二次提交</span>
            <h2>{cleanDisplayText(secondRun?.packet.label || fixedPacketMeta?.label || '整改后再次提交')}</h2>
          </div>
          <label className="file-pick compare-file-pick">
            <input
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              accept=".doc,.docx,.pdf,.xls,.xlsx"
              onChange={(event) => onSecondFilesChange(Array.from(event.target.files || []))}
            />
            上传二次提交材料
          </label>
          <div className="compare-second-actions">
            <div className="upload-count compact-count">
              <span>已选文件</span>
              <strong>{secondFiles.length}</strong>
            </div>
            <button type="button" className="primary-action" onClick={onParseSecondFiles} disabled={loading || !secondFiles.length}>
              {loading ? '解析中...' : '提交二次预审'}
            </button>
          </div>
          <button type="button" className="secondary-action" onClick={onGenerateComparison} disabled={loading}>
            {loading ? '生成中...' : '使用补充材料样例'}
          </button>
          {!!secondFiles.length && (
            <div className="selected-file-list compact-selected-list">
              {secondFiles.map((file) => (
                <span key={file.webkitRelativePath || file.name}>{displayBrowserFileName(file.webkitRelativePath || file.name)}</span>
              ))}
            </div>
          )}
        </div>
        <div className="panel compare-panel">
          <div className="panel-title">
            <span className="section-label">当前效果</span>
            <h2>{secondRun ? '已生成对比' : currentRun.audit.summary.riskLevel}</h2>
          </div>
          <div className="compare-stats">
            <Metric label="当前文件通过率" value={`${currentRun.audit.summary.passRate}%`} tone="safe" />
            <Metric label="二次文件通过率" value={secondRun ? `${secondRun.audit.summary.passRate}%` : '待生成'} tone="safe" />
            <Metric label="已消除风险项" value={resolvedCount} tone="safe" />
          </div>
        </div>
      </section>

      {currentRun && secondRun && (
        <section className="compare-preview-grid">
          <SubmissionPreview
            title="当前提交预览"
            run={currentRun}
            selectedPageId={leftPageId}
            onSelectPage={setLeftPageId}
          />
          <SubmissionPreview
            title="补充提交预览"
            run={secondRun}
            selectedPageId={rightPageId}
            onSelectPage={setRightPageId}
          />
        </section>
      )}
    </>
  )
}

function SubmissionPreview({ title, run, selectedPageId, onSelectPage }) {
  const page = run.packet.pages.find((item) => item.id === selectedPageId) || run.packet.pages[0]
  const pageFindings = run.audit.findings.filter((finding) => finding.pageId === page?.id)

  return (
    <div className="panel submission-preview">
      <div className="panel-title">
        <span className="section-label">{title}</span>
        <h2>{run.audit.summary.riskLevel} · 文件通过率 {run.audit.summary.passRate}%</h2>
      </div>
      <div className="preview-layout">
        <div className="preview-page-list">
          {run.packet.pages.slice(0, 15).map((item) => {
            const count = run.audit.findings.filter((finding) => finding.pageId === item.id).length
            return (
              <button
                key={item.id}
                type="button"
                className={item.id === page?.id ? 'preview-page-row active' : 'preview-page-row'}
                onClick={() => onSelectPage(item.id)}
              >
                <strong>{cleanDisplayText(`${item.pageNo}. ${item.title}`)}</strong>
                <span>{count} 项发现</span>
              </button>
            )
          })}
        </div>
        <article className="preview-paper">
          <span>{cleanDisplayText(page?.sourceFile || '材料预览')}</span>
          <h3>{cleanDisplayText(page?.title)}</h3>
          {(page?.sections || []).slice(0, 3).map((section, index) => (
            <p key={`${page.id}-${index}`}>{cleanDisplayText(section)}</p>
          ))}
          <div className="preview-finding-list">
            {pageFindings.length ? pageFindings.slice(0, 4).map((finding) => (
              <div key={finding.id} className={`preview-finding ${severityClass[finding.severity]}`}>
                <strong>{cleanDisplayText(finding.title)}</strong>
                <small>{cleanDisplayText(finding.suggestion)}</small>
              </div>
            )) : <small className="empty-state">当前页未发现确定性问题。</small>}
          </div>
        </article>
      </div>
    </div>
  )
}

function DocumentPage({ page, findings }) {
  if (!page) return null

  return (
    <div className="document-page">
      <div className="doc-toolbar">
        <div>
          <span className="section-label">第 {page.pageNo} 页</span>
          <h2>{page.title}</h2>
          {page.sourceFile && <p className="source-file">解析来源：{page.sourceFile}</p>}
        </div>
        <div className="chip-row">
          {page.chips?.map((chip) => <span className="chip" key={chip}>{chip}</span>)}
        </div>
      </div>

      <OriginalPreview page={page} />

      <article className="paper">
        <div className="extract-label">抽取结果</div>
        <div className="watermark">材料预览</div>
        <h3>{cleanDisplayText(page.title)}</h3>
        {page.sections?.map((section, index) => (
          <p key={`${page.id}-section-${index}`}>{cleanDisplayText(section)}</p>
        ))}

        {page.checklist && <ChecklistTable rows={page.checklist} />}
        {page.indicators && <IndicatorTable rows={page.indicators} />}
        {page.usageRows && <KeyValueRows rows={page.usageRows} title="使用数据" />}
        {page.budgetRows && <BudgetTable rows={page.budgetRows} />}
        {page.assetRows && <AssetTable rows={page.assetRows} />}
        {page.evidenceRows && <EvidenceTable rows={page.evidenceRows} />}
        {page.fields && <FieldTable fields={page.fields} />}
      </article>

      <div className="page-findings">
        <h3>本页审核提示</h3>
        {findings.length ? findings.map((finding) => (
          <div key={finding.id} className={`inline-finding ${severityClass[finding.severity]}`}>
            <strong>{cleanDisplayText(finding.title)}</strong>
            <p>{cleanDisplayText(finding.suggestion)}</p>
          </div>
        )) : <p className="empty-state">本页未发现确定性问题。</p>}
      </div>
    </div>
  )
}

function OriginalPreview({ page }) {
  const type = previewType(page)

  return (
    <section className={`original-preview ${type}`}>
      <div className="original-preview-head">
        <span className="section-label">原文预览</span>
        <strong>{cleanDisplayText(page.sourceFile || page.title)}</strong>
      </div>
      {type === 'excel' ? <ExcelOriginal page={page} /> : <DocumentOriginal page={page} type={type} />}
    </section>
  )
}

function DocumentOriginal({ page, type }) {
  return (
    <div className={`original-document ${type}`}>
      <div className="original-page">
        <div className="original-file-bar">
          <span>{type === 'pdf' ? 'PDF' : 'Word'}</span>
          <strong>{cleanDisplayText(page.title)}</strong>
        </div>
        <h3>{cleanDisplayText(page.title)}</h3>
        {(page.sections || []).slice(0, 6).map((section, index) => (
          <p key={`${page.id}-original-${index}`}>{cleanDisplayText(section)}</p>
        ))}
        {page.fields && <OriginalFieldRows fields={page.fields} />}
      </div>
    </div>
  )
}

function ExcelOriginal({ page }) {
  const rows = originalSheetRows(page)

  return (
    <div className="original-sheet">
      <div className="sheet-toolbar">
        <span>Excel</span>
        <strong>{cleanDisplayText(page.title)}</strong>
      </div>
      <table>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`sheet-row-${rowIndex}`}>
              <th>{rowIndex + 1}</th>
              {row.map((cell, cellIndex) => (
                <td key={`sheet-cell-${rowIndex}-${cellIndex}`}>{cleanDisplayText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OriginalFieldRows({ fields }) {
  return (
    <div className="original-field-rows">
      {Object.entries(fields).map(([key, value]) => (
        <div key={key}>
          <span>{fieldLabel(key)}</span>
          <strong>{cleanDisplayText(value || '未填写')}</strong>
        </div>
      ))}
    </div>
  )
}

function ChecklistTable({ rows }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th>材料</th>
          <th>要求</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{cleanDisplayText(row.name)}</td>
            <td>{row.required ? '必交' : '若有'}</td>
            <td>{row.provided ? '已提供' : '缺失'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IndicatorTable({ rows }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th>指标</th>
          <th>目标</th>
          <th>测试数量 / 方法</th>
          <th>实测</th>
          <th>结论</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{cleanDisplayText(row.label)}</td>
            <td>{cleanDisplayText(row.target)}</td>
            <td>{cleanDisplayText(row.sampleSize || row.method || '未填写')}</td>
            <td>{cleanDisplayText(row.actual || '任务书指标')}</td>
            <td>{cleanDisplayText(row.passed || '比对基准')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function KeyValueRows({ rows, title }) {
  return (
    <table className="mini-table field-table">
      <caption>{title}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th>{cleanDisplayText(row.label)}</th>
            <td>{cleanDisplayText(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BudgetTable({ rows }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th>科目</th>
          <th>预算</th>
          <th>实际</th>
          <th>研发支出</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.item}>
            <td>{cleanDisplayText(row.item)}</td>
            <td>{cleanDisplayText(row.budget)}</td>
            <td>{cleanDisplayText(row.actual)}</td>
            <td>{cleanDisplayText(row.rd || '未填写')}</td>
            <td>{cleanDisplayText(row.note)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AssetTable({ rows }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th>类型</th>
          <th>名称</th>
          <th>证明材料</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.type}-${row.name}`}>
            <td>{cleanDisplayText(row.type)}</td>
            <td>{cleanDisplayText(row.name)}</td>
            <td>{cleanDisplayText(row.proof)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EvidenceTable({ rows }) {
  return (
    <table className="mini-table">
      <thead>
        <tr>
          <th>附件</th>
          <th>类型</th>
          <th>关联材料</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>{cleanDisplayText(row.name)}</td>
            <td>{cleanDisplayText(row.type)}</td>
            <td>{cleanDisplayText(row.linkedPage)}</td>
            <td>{cleanDisplayText(row.status)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FieldTable({ fields }) {
  return (
    <table className="mini-table field-table">
      <tbody>
        {Object.entries(fields).map(([key, value]) => (
          <tr key={key}>
            <th>{fieldLabel(key)}</th>
            <td>{cleanDisplayText(value || '未填写')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function previewType(page) {
  const source = `${page.sourceFile || ''} ${page.title || ''}`.toLowerCase()
  if (source.includes('.xlsx') || page.indicators || page.budgetRows || page.usageRows || page.evidenceRows) return 'excel'
  if (source.includes('.docx')) return 'word'
  return 'pdf'
}

function originalSheetRows(page) {
  if (page.indicators?.length) {
    return [
      ['指标', '目标', '样本量 / 方法', '实测', '结论'],
      ...page.indicators.map((row) => [row.label, row.target, row.sampleSize || row.method || '', row.actual || '', row.passed || ''])
    ]
  }
  if (page.budgetRows?.length) {
    return [
      ['科目', '预算', '实际', '研发支出', '备注'],
      ...page.budgetRows.map((row) => [row.item, row.budget, row.actual, row.rd || '', row.note])
    ]
  }
  if (page.usageRows?.length) {
    return [
      ['项目', '数据'],
      ...page.usageRows.map((row) => [row.label, row.value])
    ]
  }
  if (page.evidenceRows?.length) {
    return [
      ['附件', '类型', '关联材料', '状态'],
      ...page.evidenceRows.map((row) => [row.name, row.type, row.linkedPage, row.status])
    ]
  }
  if (page.checklist?.length) {
    return [
      ['材料', '要求', '状态'],
      ...page.checklist.map((row) => [row.name, row.required ? '必交' : '若有', row.provided ? '已提供' : '缺失'])
    ]
  }
  if (page.fields) {
    return [
      ['字段', '内容'],
      ...Object.entries(page.fields).map(([key, value]) => [fieldLabel(key), value || '未填写'])
    ]
  }
  return [
    ['标题', page.title || '材料'],
    ...((page.sections || []).slice(0, 8).map((section, index) => [`正文 ${index + 1}`, section]))
  ]
}

function fieldLabel(key) {
  const labels = {
    projectNo: '项目编号',
    projectName: '项目名称',
    owner: '承担单位',
    leader: '项目负责人',
    projectType: '项目类型',
    source: '来源',
    reportDate: '上报日期',
    applicant: '申请评审单位',
    period: '工作起止时间',
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

function getInitialPageId(packet, audit) {
  const firstActionable = audit?.findings?.find((finding) => finding.severity === 'high')
    || audit?.findings?.find((finding) => finding.severity === 'medium')
  return firstActionable?.pageId || packet.pages?.[0]?.id || 'approval'
}

function groupFindings(findings) {
  return {
    high: findings.filter((finding) => finding.severity === 'high'),
    medium: findings.filter((finding) => finding.severity === 'medium'),
    low: findings.filter((finding) => finding.severity === 'low'),
    review: findings.filter((finding) => finding.severity === 'review')
  }
}

function groupFindingsByFile(findings, packet, activePageId) {
  const pageById = new Map((packet.pages || []).map((page) => [page.id, page]))
  const groups = new Map()

  findings.forEach((finding) => {
    const page = pageById.get(finding.pageId)
    const evidencePage = finding.evidencePageId ? pageById.get(finding.evidencePageId) : null
    const file = page?.sourceFile || evidencePage?.sourceFile || `缺失材料 / ${finding.title.replace(/^缺少必交材料：/, '')}`

    if (!groups.has(file)) {
      groups.set(file, {
        file,
        firstPageNo: finding.pageNo || 999,
        pageIds: new Set(),
        items: []
      })
    }

    const group = groups.get(file)
    if (page?.id) group.pageIds.add(page.id)
    if (evidencePage?.id) group.pageIds.add(evidencePage.id)
    group.items.push(finding)
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      active: Boolean(activePageId && group.pageIds.has(activePageId))
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.firstPageNo - b.firstPageNo || a.file.localeCompare(b.file, 'zh-Hans-CN'))
}

function groupLabel(severity) {
  const labels = {
    high: '必须先改',
    medium: '建议补齐',
    low: '格式优化',
    review: '人工确认'
  }
  return labels[severity] || severity
}

function readBrowserFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        name: file.name,
        relativePath: file.webkitRelativePath || file.name,
        content: String(reader.result || '')
      })
    }
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`))
    reader.readAsText(file)
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function displayBrowserFileName(filePath = '') {
  const parts = String(filePath).replace(/\\/g, '/').split('/')
  const fileName = parts[parts.length - 1] || '验收材料'
  const title = fileName
    .replace(/^\d{2}-/, '')
    .replace(/\.(md|txt|csv|json|docx?|pdf|xlsx?)$/i, '')
    .replace(/^packet-structured$/i, 'AI抽取结构化结果')
  const ext = /\.(xls|xlsx|csv|json)$/i.test(fileName) ? '.xlsx' : /\.(doc|docx)$/i.test(fileName) ? '.docx' : /\.pdf$/i.test(fileName) ? '.pdf' : '.pdf'
  return `${title}${ext}`
}

function cleanDisplayText(value = '') {
  return String(value)
    .replace(/SIPG ACCEPTANCE COMPLIANCE DEMO/gi, 'SIPG ACCEPTANCE COMPLIANCE')
    .replace(/\bDashScope\b/g, 'AI服务')
    .replace(/\bProvider\s*:\s*[^\n]+/gi, '')
    .replace(/\bprovider\b/gi, '')
    .replace(/\bdemo\b/gi, '')
    .replace(/\bDemo\b/g, '')
    .replace(/\bDEMO\b/g, '')
    .replace(/本\s*不包含客户真实数据、真实签章、真实项目编号或真实人员信息；?/g, '')
    .replace(/当前\s*对真实[^。]*。/g, '')
    .replace(/当前\s*演示[^。]*。/g, '')
    .replace(/用于演示/g, '用于')
    .replace(/演示/g, '')
    .replace(/模拟实际应用单位/g, '应用单位')
    .replace(/模拟应用单位/g, '应用单位')
    .replace(/模拟单位/g, '单位')
    .replace(/模拟公章/g, '公章')
    .replace(/模拟盖章/g, '盖章')
    .replace(/模拟印章/g, '印章')
    .replace(/模拟签\/章/g, '签/章')
    .replace(/模拟软著受理通知/g, '软著受理通知')
    .replace(/模拟固定资产清单/g, '固定资产清单')
    .replace(/模拟文件：/g, '')
    .replace(/（模拟[^）]*）/g, '')
    .replace(/\(模拟[^)]*\)/g, '')
    .replace(/模拟/g, '')
    .replace(/样本背景/g, '业务背景')
    .replace(/样本/g, '')
    .replace(/公开资料抽象/g, '业务资料')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
