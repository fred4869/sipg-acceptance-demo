import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPacket } from './services/auditService.js'
import { buildAiParsingResult, buildAiReview, isDashScopeConfigured } from './services/dashscopeService.js'
import { buildPacketFromUploadedFiles, listFileBackedPackets, loadPacketFromFiles, loadPacketFromSelectedFiles } from './services/materialFileService.js'

dotenv.config({ path: new URL('../.env', import.meta.url) })

const app = express()
const port = Number(process.env.PORT || 8787)
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const frontendDistDir = path.resolve(serverDir, '../frontend/dist')
const frontendIndexFile = path.join(frontendDistDir, 'index.html')

app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'sipg-acceptance-demo', dashscope_configured: isDashScopeConfigured() })
})

app.get('/api/sample-packets', async (_req, res, next) => {
  try {
    res.json({ packets: await listFileBackedPackets() })
  } catch (error) {
    next(error)
  }
})

app.get('/api/sample-packets/:id', async (req, res, next) => {
  try {
    const packet = await loadPacketFromFiles(req.params.id)
    if (!packet) {
      res.status(404).json({ error: 'Sample packet not found' })
      return
    }

    res.json(packet)
  } catch (error) {
    next(error)
  }
})

app.post('/api/audit', async (req, res, next) => {
  try {
    const packet = req.body?.packet || await loadPacketFromSelectedFiles(req.body?.packetId, req.body?.selectedFiles || [])
    if (!packet) {
      res.status(400).json({ error: 'packet or packetId is required' })
      return
    }

    res.json(auditPacket(packet))
  } catch (error) {
    next(error)
  }
})

app.post('/api/parse-sample', async (req, res, next) => {
  try {
    const packet = await loadPacketFromSelectedFiles(req.body?.packetId, req.body?.selectedFiles || [])
    if (!packet) {
      res.status(400).json({ error: 'packetId is required' })
      return
    }

    const parseRun = await buildAiParsingResult(packet, packet.materialFiles || [])
    const audit = auditPacket(packet)
    res.json({ packet: { ...packet, parseRun }, audit })
  } catch (error) {
    next(error)
  }
})

app.post('/api/parse-uploaded', async (req, res, next) => {
  try {
    const files = req.body?.files
    if (!Array.isArray(files) || !files.length) {
      res.status(400).json({ error: 'files is required' })
      return
    }

    const packet = buildPacketFromUploadedFiles(files, `uploaded-${Date.now()}`)
    if (!packet) {
      res.status(400).json({ error: '未识别到可解析的材料文件。请上传 Word、PDF 或 Excel 格式的验收材料。' })
      return
    }

    const parseRun = await buildAiParsingResult(packet, packet.materialFiles || [])
    const audit = auditPacket(packet)
    res.json({ packet: { ...packet, parseRun }, audit })
  } catch (error) {
    next(error)
  }
})

app.post('/api/ai-review', async (req, res, next) => {
  try {
    const packet = req.body?.packet || await loadPacketFromFiles(req.body?.packetId)
    if (!packet) {
      res.status(400).json({ error: 'packet or packetId is required' })
      return
    }

    const audit = req.body?.audit || auditPacket(packet)
    res.json(await buildAiReview(packet, audit))
  } catch (error) {
    next(error)
  }
})

app.use(express.static(frontendDistDir, { index: false }))

app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
  res.sendFile(frontendIndexFile)
})

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: error.message || 'Internal server error' })
})

export default app

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)

if (isDirectRun && process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`sipg-acceptance-demo server listening on http://localhost:${port}`)
  })
}
