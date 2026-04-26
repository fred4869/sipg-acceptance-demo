FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY frontend ./frontend
COPY server ./server
COPY materials ./materials
COPY scripts ./scripts

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/server ./server
COPY --from=builder /app/materials ./materials
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY .env.example ./.env.example

EXPOSE 8787

CMD ["npm", "run", "start"]
