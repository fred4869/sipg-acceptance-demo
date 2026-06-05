# 上港 AI 文档审核与研究报告优化系统

面向上港科技创新项目验收材料的现场演示系统。新版本采用 `FastAPI + Python` 文档智能后端和 `React + Vite` 轻量工作台，重点展示研究报告的格式审核、内容偏题识别、AI 改写、效益分析生成和 Word 草稿导出。

## 功能

- 上传 `.doc`、`.docx`、`.pdf` 研究报告。
- 对 Word 文档执行字体、字号、加粗、段前段后、行距、缩进、标题层级等格式审核。
- 按上港科技报告正文格式识别结构和内容问题。
- 识别专利说明书拼接、软件系统说明书、操作手册、功能清单堆砌等偏题问题。
- 调用 DashScope 生成研究报告优化稿和效益分析草案。
- 导出符合研究报告结构的 Word 优化稿。

## 本地启动

```bash
pip install -r backend/requirements.txt
npm install
cp .env.example .env
npm run dev
```

访问：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8787`

## 环境变量

```bash
DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_MODEL=qwen3.6-flash
DASHSCOPE_REWRITE_MODEL=qwen3.7-max
DASHSCOPE_BENEFIT_MODEL=qwen3.6-plus
```

普通审核默认用 `DASHSCOPE_MODEL=qwen3.6-flash`，保证现场上传多文件时响应速度；研究报告重构默认用 `DASHSCOPE_REWRITE_MODEL=qwen3.7-max`，因为复杂偏题材料需要更强的长文重构能力；效益分析默认用 `DASHSCOPE_BENEFIT_MODEL=qwen3.6-plus`，本地验证已能稳定生成公式、假设和需确认项。如果账号权限或地域不支持对应模型，需要改成当前账号可调用的模型名。

## Docker 部署

```bash
docker build -t sipg-ai-document-review .
docker run -p 8787:8787 --env-file .env sipg-ai-document-review
```

默认镜像为 Zeabur 轻量构建，内置 `antiword`，`.doc` 文件执行文本级审核；`.docx` 文件支持完整格式审核。线上平台使用 Dockerfile 构建，不要额外执行 `npm update -g npm`。

如需要在线上也执行 `.doc → .docx` 并做精细格式审核，可在 Docker 构建参数中设置：

```bash
INSTALL_LIBREOFFICE=true
```

## API

- `POST /api/research-review`：上传研究报告文件，返回格式/结构/内容/效益问题。
- `POST /api/research-rewrite`：基于审核结果生成研究报告优化稿。
- `POST /api/benefit-analysis`：生成效益分析草案。
- `GET /api/research-runs/{runId}/documents/{documentId}/download`：下载 Word 优化稿。
- `GET /api/health`：健康检查和 DashScope 配置状态。

## 说明

客户真实文件不提交仓库，系统仅在上传后临时处理。第一版 Word 导出是优化稿草案，不承诺完整保留原文复杂排版和红线修订。
