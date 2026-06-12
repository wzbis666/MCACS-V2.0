# ============================================================
# Minecraft AntiCheat System — Docker 多阶段构建
# 适用场景：在 Docker 中运行检测引擎 + 前端面板
# ============================================================

# ── 阶段 1: 构建前端 ──
FROM node:18-alpine AS frontend-builder
WORKDIR /app/town-frontend
COPY town-frontend/package.json town-frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY town-frontend/ ./
RUN npx vite build --outDir dist

# ── 阶段 2: 运行环境 ──
FROM node:18-alpine
LABEL org.opencontainers.image.title="Minecraft AntiCheat"
LABEL org.opencontainers.image.description="Minecraft Spigot anti-cheat monitoring system with 3D visualization"
LABEL org.opencontainers.image.version="0.1.0"

RUN apk add --no-cache tini

WORKDIR /app

# 安装后端依赖
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# 复制后端源码
COPY tsconfig.json ./
COPY src/ ./src/
COPY penalty-config.yml ./

# 复制构建好的前端静态文件
COPY --from=frontend-builder /app/town-frontend/dist ./public

# 数据持久化目录
RUN mkdir -p /app/data

EXPOSE 55211 55210

ENV NODE_ENV=production
ENV ACS_AUTH_SECRET=""

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "src/plugin/index.ts"]