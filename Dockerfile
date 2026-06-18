# ============================================================
# Minecraft AntiCheat System — Docker 多阶段构建
# 适用场景：在 Docker 中运行检测引擎 + 前端面板
# ============================================================

# ── 阶段 1: 构建前端 ──
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/town-frontend
COPY town-frontend/package.json town-frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY town-frontend/ ./
RUN npx vite build --outDir dist

# ── 阶段 2: 构建后端 ──
FROM node:20-bookworm-slim AS backend-builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# ── 阶段 3: 运行环境 ──
FROM node:20-bookworm-slim
LABEL org.opencontainers.image.title="Minecraft AntiCheat"
LABEL org.opencontainers.image.description="Minecraft Paper anti-cheat monitoring system with 3D visualization"
LABEL org.opencontainers.image.version="0.1.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 复制后端构建产物与生产依赖
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY penalty-config.yml ./

# 复制构建好的前端静态文件
COPY --from=frontend-builder /app/town-frontend/dist ./public

# 数据持久化目录
RUN mkdir -p /app/data

EXPOSE 55211 55210

ENV NODE_ENV=production
ENV ACS_AUTH_SECRET=""
ENV ACS_HTTP_HOST=0.0.0.0

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/plugin/index.js"]
