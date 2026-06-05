FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY frontend ./frontend

RUN npm run build

FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PORT=8787

ARG INSTALL_LIBREOFFICE=false
RUN apt-get update \
  && if [ "$INSTALL_LIBREOFFICE" = "true" ]; then \
    apt-get install -y --no-install-recommends libreoffice-writer fonts-noto-cjk; \
  else \
    apt-get install -y --no-install-recommends antiword; \
  fi \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY .env.example ./.env.example

EXPOSE 8787

CMD ["sh", "-c", "python -m uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8787}"]
