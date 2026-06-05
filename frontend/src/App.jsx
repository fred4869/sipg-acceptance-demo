import { useEffect, useMemo, useState } from 'react'

const severityText = { high: '高风险', medium: '中风险', low: '低风险' }
const categoryText = { format: '格式', structure: '结构', content: '内容', benefit: '效益' }

export default function App() {
  const [files, setFiles] = useState([])
  const [run, setRun] = useState(null)
  const [activeDocId, setActiveDocId] = useState('')
  const [activeIssueId, setActiveIssueId] = useState('')
  const [loadingStage, setLoadingStage] = useState('')
  const [error, setError] = useState('')
  const [rewriteLoading, setRewriteLoading] = useState(false)
  const [benefitLoading, setBenefitLoading] = useState(false)
  const [rewrites, setRewrites] = useState({})
  const [benefits, setBenefits] = useState({})
  const [benefitInputs, setBenefitInputs] = useState(defaultBenefitInputs)
  const [standards, setStandards] = useState(null)

  useEffect(() => {
    fetch('/api/audit-standards')
      .then((response) => response.json())
      .then(setStandards)
      .catch(() => setStandards(null))
  }, [])

  const activeDoc = useMemo(() => {
    return run?.documents?.find((document) => document.id === activeDocId) || run?.documents?.[0] || null
  }, [run, activeDocId])

  const activeIssues = useMemo(() => {
    return (run?.issues || []).filter((issue) => issue.documentId === activeDoc?.id)
  }, [run, activeDoc])

  const activeIssue = useMemo(() => {
    return activeIssues.find((issue) => issue.id === activeIssueId) || activeIssues[0] || null
  }, [activeIssues, activeIssueId])

  async function reviewFiles() {
    if (!files.length) {
      setError('请先选择 Word 或 PDF 文件。')
      return
    }

    const stageTimers = []
    try {
      setError('')
      setRun(null)
      setRewrites({})
      setBenefits({})
      setLoadingStage('upload')
      await wait(220)
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      setLoadingStage('parse')
      stageTimers.push(setTimeout(() => setLoadingStage('format'), 1000))
      stageTimers.push(setTimeout(() => setLoadingStage('audit'), 2200))
      stageTimers.push(setTimeout(() => setLoadingStage('aggregate'), 5200))
      const response = await fetch('/api/research-review', { method: 'POST', body: formData })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || payload.error || '审核失败')
      setLoadingStage('result')
      await wait(180)
      setRun(payload)
      setActiveDocId(payload.documents?.[0]?.id || '')
      setActiveIssueId('')
    } catch (reviewError) {
      setError(reviewError.message)
    } finally {
      stageTimers.forEach(clearTimeout)
      setLoadingStage('')
    }
  }

  async function generateRewrite() {
    if (!run || !activeDoc || rewriteLoading) return
    try {
      setRewriteLoading(true)
      setError('')
      const response = await fetch('/api/research-rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.runId, documentId: activeDoc.id })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || '优化稿生成失败')
      setRewrites((current) => ({ ...current, [activeDoc.id]: payload }))
    } catch (rewriteError) {
      setError(rewriteError.message)
    } finally {
      setRewriteLoading(false)
    }
  }

  async function generateBenefit() {
    if (benefitLoading) return
    try {
      setBenefitLoading(true)
      setError('')
      const response = await fetch('/api/benefit-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...benefitInputs,
          runId: run?.runId,
          documentId: activeDoc?.id,
          projectName: benefitInputs.projectName || activeDoc?.title || ''
        })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || '效益分析生成失败')
      setBenefits((current) => ({ ...current, [activeDoc?.id || 'standalone']: payload }))
    } catch (benefitError) {
      setError(benefitError.message)
    } finally {
      setBenefitLoading(false)
    }
  }

  const currentRewrite = activeDoc ? rewrites[activeDoc.id] : null
  const currentBenefit = activeDoc ? benefits[activeDoc.id] || benefits.standalone : benefits.standalone
  const auditStandards = run?.standards || standards

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <span className="eyebrow">SIPG AI DOCUMENT REVIEW</span>
          <h1>科技报告审核与优化工作台</h1>
          <p>现场上传研究报告，自动检查格式、结构和内容偏题问题，并生成优化稿与效益分析草案。</p>
        </div>
        <div className="hero-card">
          <span>当前能力</span>
          <strong>Word格式审核 · 研究报告改写 · 效益分析生成</strong>
        </div>
      </header>

      {error && <section className="error-banner">{error}</section>}

      <section className="upload-panel">
        <div className="upload-copy">
          <span className="section-label">上传审核</span>
          <h2>选择上港研究报告案例材料</h2>
          <p>支持 .doc、.docx、.pdf。Word 文件会读取段落样式，PDF 执行文本级内容审核。</p>
        </div>
        <label className="file-drop">
          <input
            type="file"
            multiple
            accept=".doc,.docx,.pdf"
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
          />
          <strong>选择文件</strong>
          <span>{files.length ? `${files.length} 个文件已选择` : '推荐现场上传文件 3 / 4 / 5'}</span>
        </label>
        <button className="primary-action" type="button" onClick={reviewFiles} disabled={!files.length || Boolean(loadingStage)}>
          {loadingStage ? '审核中...' : '开始AI审核'}
        </button>
      </section>

      {files.length > 0 && (
        <section className="file-strip">
          {files.map((file) => (
            <span key={`${file.name}-${file.size}`}>{file.name}</span>
          ))}
        </section>
      )}

      {loadingStage && <Pipeline activeStage={loadingStage} />}

      {auditStandards && (
        <AuditContext
          standards={auditStandards}
          processing={run?.processing}
          files={files}
          loadingStage={loadingStage}
        />
      )}

      {run && (
        <>
          <SummaryStrip run={run} />
          <DocumentTabs
            documents={run.documents}
            activeDocId={activeDoc?.id}
            onSelect={(id) => {
              setActiveDocId(id)
              setActiveIssueId('')
            }}
          />
          <section className="workspace">
            <DocumentPreview document={activeDoc} activeIssue={activeIssue} />
            <IssuePanel issues={activeIssues} activeIssueId={activeIssue?.id} onSelectIssue={setActiveIssueId} />
            <OptimizationPanel
              document={activeDoc}
              rewrite={currentRewrite}
              benefit={currentBenefit}
              benefitInputs={benefitInputs}
              rewriteLoading={rewriteLoading}
              benefitLoading={benefitLoading}
              onRewrite={generateRewrite}
              onBenefit={generateBenefit}
              onBenefitInputChange={setBenefitInputs}
            />
          </section>
        </>
      )}
    </main>
  )
}

function AuditContext({ standards, processing, files, loadingStage }) {
  const steps = processing || buildPendingProcessing(files, loadingStage, standards)
  return (
    <section className="audit-context">
      <div className="context-card process-card">
        <div className="context-title">
          <span className="section-label">处理过程</span>
          <h2>本次材料处理链路</h2>
        </div>
        <div className="process-list">
          {steps.map((step, index) => (
            <div key={`${step.name}-${index}`} className={`process-row ${step.status || ''}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.name}</strong>
                <p>{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="context-card standard-card">
        <div className="context-title">
          <span className="section-label">审核依据</span>
          <h2>规则标准与模型</h2>
        </div>
        <div className="standard-grid">
          <div className="standard-block">
            <strong>依据文件</strong>
            {standards.basis?.map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="standard-block">
            <strong>AI模型</strong>
            <span>内容审核：{standards.models?.contentReview}</span>
            <span>报告改写：{standards.models?.rewrite}</span>
            <span>效益分析：{standards.models?.benefit}</span>
          </div>
          <div className="standard-block wide">
            <strong>格式标准</strong>
            <div className="rule-chips">
              {standards.formatRules?.map((rule) => (
                <span key={rule.name}>{rule.name}：{rule.standard}</span>
              ))}
            </div>
          </div>
          <div className="standard-block wide">
            <strong>内容审核维度</strong>
            <div className="rule-chips">
              {standards.contentRules?.map((rule) => <span key={rule}>{rule}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function buildPendingProcessing(files, loadingStage, standards) {
  const fileText = files.length ? `已选择 ${files.length} 个待审核文件。` : '等待选择 Word 或 PDF 文件。'
  const modelText = standards?.models?.contentReview ? `内容审核将调用 DashScope ${standards.models.contentReview}。` : '内容审核将调用已配置的大模型。'
  return [
    { name: '文件接收', status: files.length ? 'done' : 'pending', detail: fileText },
    { name: '正文与格式解析', status: loadingStage === 'parse' ? 'active' : completedStage(loadingStage, 'parse') ? 'done' : 'pending', detail: 'Word 文件读取段落、标题、字体、字号、行距、缩进；PDF 执行文本级解析。' },
    { name: '格式标准比对', status: loadingStage === 'format' ? 'active' : completedStage(loadingStage, 'format') ? 'done' : 'pending', detail: '按上港科技报告正文格式逐段比对标题、正文、目录等样式。' },
    { name: 'AI内容结构审核', status: loadingStage === 'audit' ? 'active' : completedStage(loadingStage, 'audit') ? 'done' : 'pending', detail: modelText },
    { name: '问题归集定位', status: loadingStage === 'aggregate' || loadingStage === 'result' ? 'active' : 'pending', detail: '输出问题类型、风险等级、原文定位、标准要求和整改建议。' },
  ]
}

function completedStage(current, stage) {
  const order = ['upload', 'parse', 'format', 'audit', 'aggregate', 'result']
  return order.indexOf(current) > order.indexOf(stage)
}

function Pipeline({ activeStage }) {
  const steps = [
    ['upload', '读取文件'],
    ['parse', '解析格式与正文'],
    ['format', '格式标准比对'],
    ['audit', 'AI内容审核'],
    ['aggregate', '问题归集定位'],
    ['result', '生成结果']
  ]
  const activeIndex = steps.findIndex(([id]) => id === activeStage)
  return (
    <section className="pipeline">
      {steps.map(([id, label], index) => (
        <div key={id} className={`pipeline-step ${index < activeIndex ? 'done' : ''} ${id === activeStage ? 'active' : ''}`}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </section>
  )
}

function SummaryStrip({ run }) {
  return (
    <section className="summary-strip">
      <Metric label="综合评分" value={`${run.summary.averageScore}分`} tone={run.summary.averageScore < 60 ? 'danger' : run.summary.averageScore < 80 ? 'warning' : 'safe'} />
      <Metric label="审核文件" value={run.summary.documentCount} />
      <Metric label="问题总数" value={run.summary.issueCount} tone="warning" />
      <Metric label="高风险" value={run.summary.highCount} tone="danger" />
      <Metric label="格式问题" value={run.summary.formatCount} />
      <Metric label="内容结构" value={run.summary.contentCount} />
    </section>
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

function DocumentTabs({ documents, activeDocId, onSelect }) {
  return (
    <section className="document-tabs">
      {documents.map((document) => (
        <button
          key={document.id}
          type="button"
          className={document.id === activeDocId ? 'document-tab active' : 'document-tab'}
          onClick={() => onSelect(document.id)}
        >
          <strong>{document.filename}</strong>
          <span>{document.diagnosis.reportType} · {document.diagnosis.score}分 · {document.issueCounts.total}项</span>
          {document.ai?.enabled && <em>{document.ai.provider} · {document.ai.model}</em>}
        </button>
      ))}
    </section>
  )
}

function DocumentPreview({ document, activeIssue }) {
  if (!document) return null
  const activeIndex = activeIssue?.paragraphIndex
  return (
    <section className="panel document-preview">
      <div className="panel-title">
        <span className="section-label">原文定位</span>
        <h2>{document.title}</h2>
        <p>{document.filename} · {document.stats.paragraphCount} 段 · {document.stats.headingCount} 个标题</p>
      </div>
      <div className="doc-meta-row">
        {document.originalUrl && <a className="source-link" href={document.originalUrl} target="_blank" rel="noreferrer">查看/下载原文件</a>}
        {document.capabilities?.map((item) => <span key={item}>{item}</span>)}
      </div>
      {document.diagnosis?.summary && (
        <div className="doc-diagnosis">
          <strong>AI诊断摘要</strong>
          <p>{document.diagnosis.summary}</p>
        </div>
      )}
      {!!document.warnings?.length && (
        <div className="warning-box">
          {document.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      )}
      <div className="paragraph-list">
        {document.paragraphs.slice(0, 180).map((paragraph) => (
          <article
            key={paragraph.index}
            className={`${paragraph.kind === 'heading' ? 'paragraph heading' : 'paragraph'} ${paragraph.index === activeIndex ? 'active' : ''}`}
          >
            <span>{paragraph.kind === 'heading' ? `标题${paragraph.level || ''}` : `段落 ${paragraph.index + 1}`}</span>
            <p>{paragraph.text}</p>
            {paragraph.format?.font && (
              <small>{paragraph.format.font} / {paragraph.format.sizePt || '-'}pt / {paragraph.format.lineSpacing || '-'}倍行距</small>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function IssuePanel({ issues, activeIssueId, onSelectIssue }) {
  const grouped = groupByCategory(issues)
  return (
    <section className="panel issue-panel">
      <div className="panel-title">
        <span className="section-label">审核发现</span>
        <h2>{issues.length} 项问题</h2>
      </div>
      <div className="issue-groups">
        {Object.entries(grouped).map(([category, items]) => (
          <div className="issue-group" key={category}>
            <div className="issue-group-head">
              <strong>{categoryText[category] || category}</strong>
              <span>{items.length}项</span>
            </div>
            {items.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className={issue.id === activeIssueId ? 'issue-card active' : 'issue-card'}
                onClick={() => onSelectIssue(issue.id)}
              >
                <div>
                  <span className={`severity ${issue.severity}`}>{severityText[issue.severity] || issue.severity}</span>
                  <em>{issue.paragraphIndex === null || issue.paragraphIndex === undefined ? '全文' : `第${issue.paragraphIndex + 1}段`}</em>
                </div>
                <strong>{issue.title}</strong>
                <span className="issue-source">{issue.source === 'ai' ? `AI审核 · ${issue.aiModel || ''}` : '格式规则'}</span>
                <p><b>实际问题：</b>{issue.actual}</p>
                <p><b>标准要求：</b>{issue.expected}</p>
                <small><b>整改建议：</b>{issue.suggestion}</small>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function OptimizationPanel({
  document,
  rewrite,
  benefit,
  benefitInputs,
  rewriteLoading,
  benefitLoading,
  onRewrite,
  onBenefit,
  onBenefitInputChange
}) {
  return (
    <section className="panel optimization-panel">
      <div className="panel-title">
        <span className="section-label">AI优化</span>
        <h2>修改调整与效益分析</h2>
      </div>
      <button className="primary-action" type="button" onClick={onRewrite} disabled={!document || rewriteLoading}>
        {rewriteLoading ? '生成中...' : rewrite ? '重新生成优化稿' : '生成研究报告优化稿'}
      </button>
      {rewrite ? (
        <div className="rewrite-box">
          <AiBadge ai={rewrite.ai} />
          {rewrite.summary && <p className="ai-summary">{rewrite.summary}</p>}
          <h3>推荐目录</h3>
          <ol>
            {rewrite.outline?.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <h3>示例改写</h3>
          {rewrite.sections?.map((section) => (
            <article key={section.title} className="rewrite-section">
              <strong>{section.title}</strong>
              <p>{section.after}</p>
            </article>
          ))}
          {!!rewrite.dataNeeded?.length && (
            <>
              <h3>需补充数据</h3>
              <ul className="data-needed">
                {rewrite.dataNeeded.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          )}
          {rewrite.downloadUrl && <a className="download-link" href={rewrite.downloadUrl}>下载Word优化稿</a>}
        </div>
      ) : (
        <p className="empty-state">生成后将展示重构大纲、关键章节改写和Word草稿下载。</p>
      )}

      <div className="benefit-form">
        <h3>效益分析输入</h3>
        {benefitFields.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              value={benefitInputs[key] || ''}
              onChange={(event) => onBenefitInputChange((current) => ({ ...current, [key]: event.target.value }))}
              placeholder="可留空，AI会标注需补充"
            />
          </label>
        ))}
        <button className="secondary-action" type="button" onClick={onBenefit} disabled={benefitLoading}>
          {benefitLoading ? '生成中...' : '生成效益分析'}
        </button>
      </div>
      {benefit && (
        <div className="benefit-result">
          <AiBadge ai={benefit.ai} />
          <pre className="benefit-output">{benefit.content}</pre>
        </div>
      )}
    </section>
  )
}

function AiBadge({ ai }) {
  if (!ai?.enabled) return null
  return <span className="ai-badge">{ai.provider} · {ai.model}</span>
}

function groupByCategory(issues) {
  return issues.reduce((groups, issue) => {
    groups[issue.category] = groups[issue.category] || []
    groups[issue.category].push(issue)
    return groups
  }, {})
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const benefitFields = [
  ['projectName', '项目名称'],
  ['operationVolume', '作业量/样本量'],
  ['efficiencyGain', '效率提升'],
  ['laborSaving', '人工节约'],
  ['costSaving', '成本节约'],
  ['energySaving', '能耗/水耗变化'],
  ['safetyImpact', '安全影响'],
  ['environmentalImpact', '环保影响']
]

const defaultBenefitInputs = {
  projectName: '',
  operationVolume: '',
  efficiencyGain: '',
  laborSaving: '',
  costSaving: '',
  energySaving: '',
  safetyImpact: '',
  environmentalImpact: '',
  extraNotes: ''
}
