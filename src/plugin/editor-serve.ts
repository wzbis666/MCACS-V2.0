import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import type { BanManager } from './ban-manager.js'
import type { PlayerTracker } from './player-tracker.js'
import type { RecordStore } from './record-store.js'
import type { ActionDispatcher } from './action-dispatcher.js'
import type { AlertManager } from './alert-manager.js'
import type { AppealManager } from './appeal-manager.js'
import type { IPTracker } from './ip-tracker.js'
import type { VPManager } from './vp-manager.js'
import type { SpigotAction, RecordsQuery } from '../contracts/index.js'

const PORT = Number(process.env.ACS_HTTP_PORT ?? 55210)
const HOST = process.env.ACS_HTTP_HOST ?? '127.0.0.1'
const AUTH_SECRET = process.env.ACS_AUTH_SECRET ?? null

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
}

interface RouteContext {
  banManager: BanManager
  playerTracker: PlayerTracker
  recordStore: RecordStore
  actionDispatcher?: ActionDispatcher
  alertManager?: AlertManager
  appealManager?: AppealManager
  ipTracker?: IPTracker
  vpManager?: VPManager
  /** MonitorBridge 引用，用于 npcId→playerId 解析 */
  resolvePlayerId?: (npcId: string) => string | undefined
  /** MonitorBridge 引用，用于 playerId→npcId 解析 */
  resolveNpcId?: (playerId: string) => string | undefined
}

type JsonObject = Record<string, unknown>

export class EditorServe {
  private app: FastifyInstance | null = null
  private ctx: RouteContext
  private staticDir: string
  private authSecret: string | null

  constructor(ctx: RouteContext, staticDir?: string) {
    this.ctx = ctx
    this.staticDir = staticDir ?? join(process.cwd(), 'public')
    this.authSecret = AUTH_SECRET
  }

  start(): void {
    if (this.app) return

    const app = Fastify({ logger: false })
    this.app = app
    this.registerHooks(app)
    this.registerRoutes(app)

    void app.listen({ port: PORT, host: HOST })
      .then(() => {
        console.log(`[EditorServe] HTTP server listening on http://${HOST}:${PORT}`)
      })
      .catch((err: unknown) => {
        console.error('[EditorServe] Failed to start HTTP server:', err)
      })
  }

  stop(): void {
    if (this.app) {
      void this.app.close()
      this.app = null
    }
  }

  private registerHooks(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
      this.corsHeaders(reply)

      const path = this.getPath(request)
      if (!path.startsWith('/api/')) return

      if (request.method === 'OPTIONS') {
        reply.code(204).send()
        return
      }

      if (path === '/api/health' && request.method === 'GET') return

      if (!this.isAuthorized(request)) {
        reply.code(401).type('application/json').send({ error: 'Authentication required' })
      }
    })
  }

  private registerRoutes(app: FastifyInstance): void {
    app.get('/api/health', async (_request, reply) => {
      this.json(reply, { ok: true, service: 'minecraft-anticheat', timestamp: Date.now() })
    })

    app.route({
      method: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      url: '/api/*',
      handler: async (request, reply) => {
        await this.handleApi(request, reply)
      },
    })

    app.setNotFoundHandler((request, reply) => {
      const path = this.getPath(request)
      if (path.startsWith('/api/')) {
        this.json(reply, { error: 'Not found' }, 404)
        return
      }

      this.serveStatic(path, reply)
    })
  }

  private corsHeaders(reply: FastifyReply): void {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  private async handleApi(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const path = this.getPath(request)

    try {
      // GET /api/players
      if (path === '/api/players' && request.method === 'GET') {
        const players = this.ctx.playerTracker.getAllPlayerStates()
        this.json(reply, players)
        return
      }

      // GET /api/players/:uuid/records
      const recordsMatch = path.match(/^\/api\/players\/([^/]+)\/records$/)
      if (recordsMatch && request.method === 'GET') {
        const playerId = decodeURIComponent(recordsMatch[1])
        const records = this.ctx.recordStore.query({ playerId })
        this.json(reply, records)
        return
      }

      // GET /api/whitelist
      if (path === '/api/whitelist' && request.method === 'GET') {
        const whitelist = this.ctx.banManager.getWhitelist()
        this.json(reply, whitelist)
        return
      }

      // POST /api/ban — 封禁玩家（同时更新 BanManager + 发送 Spigot 动作）
      if (path === '/api/ban' && request.method === 'POST') {
        const { playerId, playerName, reason, duration } = await this.readJsonBody<{
          playerId: string
          playerName?: string
          reason?: string
          duration?: string
        }>(request)
        // 将 npcId 解析为真实 playerId (UUID)
        const resolvedId = this.ctx.resolvePlayerId?.(playerId) ?? playerId
        const entry = this.ctx.banManager.banPlayer(
          resolvedId,
          playerName ?? playerId,
          reason ?? 'Banned by Admin',
          duration ?? '24h',
        )
        // 同步发送封禁动作到 Spigot
        this.ctx.actionDispatcher?.dispatch({
          type: 'ban',
          playerId: resolvedId,
          reason: reason ?? 'Banned by Admin',
          duration: duration ?? '24h',
        })
        console.log(`[EditorServe] POST /api/ban: npcId=${playerId} → playerId=${resolvedId}`)
        this.json(reply, entry, 201)
        return
      }

      // POST /api/unban — 解封玩家（同时更新 BanManager + 发送 Spigot 动作）
      if (path === '/api/unban' && request.method === 'POST') {
        const { playerId } = await this.readJsonBody<{ playerId: string }>(request)
        // 将 npcId 解析为真实 playerId (UUID)
        const resolvedId = this.ctx.resolvePlayerId?.(playerId) ?? playerId
        const success = this.ctx.banManager.unbanPlayer(resolvedId)
        // 同步发送解封动作到 Spigot
        this.ctx.actionDispatcher?.dispatch({
          type: 'unban',
          playerId: resolvedId,
        })
        console.log(`[EditorServe] POST /api/unban: npcId=${playerId} → playerId=${resolvedId}`)
        this.json(reply, { success })
        return
      }

      // POST /api/whitelist
      if (path === '/api/whitelist' && request.method === 'POST') {
        const { playerId, playerName, action, reason } = await this.readJsonBody<{
          playerId: string
          playerName?: string
          action?: string
          reason?: string
        }>(request)
        // 将 npcId 解析为真实 playerId (UUID)
        const resolvedId = this.ctx.resolvePlayerId?.(playerId) ?? playerId
        if (action === 'remove') {
          this.ctx.banManager.removeWhitelist(resolvedId)
        } else {
          // 默认 action=add
          this.ctx.banManager.addWhitelist(resolvedId, playerName ?? playerId, reason)
          // 同步发送白名单动作到 Spigot
          this.ctx.actionDispatcher?.dispatch({
            type: 'whitelist_add',
            playerId: resolvedId,
          })
        }
        console.log(`[EditorServe] POST /api/whitelist: npcId=${playerId} → playerId=${resolvedId}, action=${action ?? 'add'}`)
        this.json(reply, { success: true })
        return
      }

      // GET /api/stats
      if (path === '/api/stats' && request.method === 'GET') {
        const onlineCount = this.ctx.playerTracker.getAllPlayerStates().length
        const stats = this.ctx.banManager.getStats(onlineCount)
        this.json(reply, stats)
        return
      }

      // POST /api/action — dispatch admin action (ban/kick/freeze/etc)
      if (path === '/api/action' && request.method === 'POST') {
        const { type, playerId, reason, duration } = await this.readJsonBody<{
          type?: SpigotAction['type']
          playerId?: string
          reason?: string
          duration?: string
        }>(request)

        if (!type || !playerId) {
          this.json(reply, { error: 'Missing required fields: type, playerId' }, 400)
          return
        }

        const action: SpigotAction = {
          type,
          playerId,
          reason,
          duration,
        }

        if (this.ctx.actionDispatcher) {
          this.ctx.actionDispatcher.dispatch(action)
          this.json(reply, { success: true, action })
        } else {
          this.json(reply, { error: 'ActionDispatcher not available' }, 503)
        }
        return
      }

      // GET /api/alerts — get active alerts
      if (path === '/api/alerts' && request.method === 'GET') {
        if (this.ctx.alertManager) {
          const alerts = this.ctx.alertManager.getActiveAlerts()
          this.json(reply, alerts)
        } else {
          this.json(reply, [])
        }
        return
      }

      // GET /api/bans — get active bans (with npcId for frontend matching)
      if (path === '/api/bans' && request.method === 'GET') {
        const bans = this.ctx.banManager.getActiveBans()
        // 为每个封禁记录附加 npcId，方便前端用 npcId 匹配
        const bansWithNpcId = bans.map(ban => ({
          ...ban,
          npcId: this.ctx.resolveNpcId?.(ban.playerId)
            ?? (ban.playerId.startsWith('player_') ? ban.playerId : `player_${ban.playerId.slice(0, 8)}`),
        }))
        this.json(reply, bansWithNpcId)
        return
      }

      // DELETE /api/bans/:playerId — unban player
      const bansMatch = path.match(/^\/api\/bans\/([^/]+)$/)
      if (bansMatch && request.method === 'DELETE') {
        const playerId = decodeURIComponent(bansMatch[1])
        const success = this.ctx.banManager.unbanPlayer(playerId)
        this.json(reply, { success })
        return
      }

      // GET /api/records — query all cheat records with optional filters
      if (path === '/api/records' && request.method === 'GET') {
        const url = this.getUrl(request)
        const query: RecordsQuery = {}
        const playerIdParam = url.searchParams.get('playerId')
        if (playerIdParam) query.playerId = playerIdParam
        const cheatTypeParam = url.searchParams.get('cheatType')
        if (cheatTypeParam) query.cheatType = cheatTypeParam
        const fromParam = url.searchParams.get('from')
        if (fromParam) query.from = Number(fromParam)
        const toParam = url.searchParams.get('to')
        if (toParam) query.to = Number(toParam)
        const limitParam = url.searchParams.get('limit')
        if (limitParam) query.limit = Number(limitParam)

        const records = this.ctx.recordStore.query(query)
        this.json(reply, records)
        return
      }

      // ── 申诉 API ──

      // GET /api/appeals — 获取申诉列表
      if (path === '/api/appeals' && request.method === 'GET') {
        if (this.ctx.appealManager) {
          const url = this.getUrl(request)
          const status = url.searchParams.get('status')
          let appeals
          if (status === 'pending') {
            appeals = this.ctx.appealManager.getPendingAppeals()
          } else {
            appeals = this.ctx.appealManager.getAllAppeals()
          }
          this.json(reply, appeals)
        } else {
          this.json(reply, [])
        }
        return
      }

      // POST /api/appeals — 提交申诉
      if (path === '/api/appeals' && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const { playerId, playerName, penaltyId, reason } = await this.readJsonBody<{
          playerId?: string
          playerName?: string
          penaltyId?: string
          reason?: string
        }>(request)
        if (!playerId || !penaltyId || !reason) {
          this.json(reply, { error: 'Missing required fields: playerId, penaltyId, reason' }, 400)
          return
        }
        const record = this.ctx.appealManager.submitAppeal(
          playerId,
          playerName ?? playerId,
          penaltyId,
          reason,
        )
        this.json(reply, record, 201)
        return
      }

      // POST /api/appeals/:appealId/approve — 批准申诉
      const approveMatch = path.match(/^\/api\/appeals\/([^/]+)\/approve$/)
      if (approveMatch && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const appealId = decodeURIComponent(approveMatch[1])
        const { reviewedBy, note } = await this.readJsonBody<{ reviewedBy?: string; note?: string }>(request)
        const record = this.ctx.appealManager.approveAppeal(appealId, reviewedBy ?? 'admin', note ?? '')
        if (record) {
          this.json(reply, record)
        } else {
          this.json(reply, { error: 'Appeal not found or already reviewed' }, 404)
        }
        return
      }

      // POST /api/appeals/:appealId/reject — 驳回申诉
      const rejectMatch = path.match(/^\/api\/appeals\/([^/]+)\/reject$/)
      if (rejectMatch && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const appealId = decodeURIComponent(rejectMatch[1])
        const { reviewedBy, note } = await this.readJsonBody<{ reviewedBy?: string; note?: string }>(request)
        const record = this.ctx.appealManager.rejectAppeal(appealId, reviewedBy ?? 'admin', note)
        if (record) {
          this.json(reply, record)
        } else {
          this.json(reply, { error: 'Appeal not found or already reviewed' }, 404)
        }
        return
      }

      // GET /api/appeals/stats — 申诉统计
      if (path === '/api/appeals/stats' && request.method === 'GET') {
        if (this.ctx.appealManager) {
          this.json(reply, this.ctx.appealManager.getStats())
        } else {
          this.json(reply, { total: 0, pending: 0, approved: 0, rejected: 0 })
        }
        return
      }

      // 申诉 API（简化版）

      // POST /api/appeal/submit — 简化版提交申诉
      if (path === '/api/appeal/submit' && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const { playerId, playerName, reason } = await this.readJsonBody<{
          playerId?: string
          playerName?: string
          reason?: string
        }>(request)
        if (!playerId || !reason) {
          this.json(reply, { error: 'playerId and reason are required' }, 400)
          return
        }
        const appeal = this.ctx.appealManager.submitAppeal(playerId, playerName ?? playerId, `simplified-${Date.now()}`, reason)
        this.json(reply, appeal)
        return
      }

      // GET /api/appeal/pending — 获取待处理申诉
      if (path === '/api/appeal/pending' && request.method === 'GET') {
        if (this.ctx.appealManager) {
          const appeals = this.ctx.appealManager.getPendingAppeals()
          this.json(reply, appeals)
        } else {
          this.json(reply, [])
        }
        return
      }

      // POST /api/appeal/approve — 批准申诉（含解封+清VP+发unban动作）
      if (path === '/api/appeal/approve' && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const { appealId, reviewerId, note } = await this.readJsonBody<{
          appealId?: string
          reviewerId?: string
          note?: string
        }>(request)
        if (!appealId || !reviewerId) {
          this.json(reply, { error: 'appealId and reviewerId are required' }, 400)
          return
        }
        const result = this.ctx.appealManager.approveAppeal(appealId, reviewerId, note ?? '', (playerId) => {
          this.ctx.banManager.unbanPlayer(playerId, 'appeal')
          this.ctx.vpManager?.clearVP(playerId)
          this.ctx.actionDispatcher?.dispatch({
            type: 'unban',
            actionId: `unban-appeal-${Date.now()}`,
            playerId,
            reason: 'Appeal approved',
          })
        })
        if (!result) {
          this.json(reply, { error: 'Appeal not found' }, 404)
          return
        }
        this.json(reply, result)
        return
      }

      // POST /api/appeal/reject — 驳回申诉
      if (path === '/api/appeal/reject' && request.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(reply, { error: 'AppealManager not available' }, 503)
          return
        }
        const { appealId, reviewerId, note } = await this.readJsonBody<{
          appealId?: string
          reviewerId?: string
          note?: string
        }>(request)
        if (!appealId || !reviewerId) {
          this.json(reply, { error: 'appealId and reviewerId are required' }, 400)
          return
        }
        const result = this.ctx.appealManager.rejectAppeal(appealId, reviewerId, note ?? '')
        if (!result) {
          this.json(reply, { error: 'Appeal not found' }, 404)
          return
        }
        this.json(reply, result)
        return
      }

      // ── IP 关联 API ──

      // GET /api/ip-associations/:playerId — 获取玩家 IP 关联信息
      const ipAssocMatch = path.match(/^\/api\/ip-associations\/([^/]+)$/)
      if (ipAssocMatch && request.method === 'GET') {
        if (!this.ctx.ipTracker) {
          this.json(reply, { error: 'IPTracker not available' }, 503)
          return
        }
        const playerId = decodeURIComponent(ipAssocMatch[1])
        const associates = this.ctx.ipTracker.getAssociatedPlayers(playerId)
        const ip = this.ctx.ipTracker.getPlayerIP(playerId)
        this.json(reply, { playerId, ip, associates, hasAssociations: associates.length > 0 })
        return
      }

      // GET /api/ip-stats — IP 关联统计
      if (path === '/api/ip-stats' && request.method === 'GET') {
        if (this.ctx.ipTracker) {
          this.json(reply, this.ctx.ipTracker.getStats())
        } else {
          this.json(reply, { totalIPs: 0, multiAccountIPs: 0 })
        }
        return
      }

      // GET /api/detection-log — 获取检测规则变更日志
      if (path === '/api/detection-log' && request.method === 'GET') {
        const { getDetectionLog } = await import('./rule-engine.js')
        const url = this.getUrl(request)
        const limitParam = url.searchParams.get('limit')
        const limit = limitParam ? parseInt(limitParam, 10) : 100
        this.json(reply, getDetectionLog(limit))
        return
      }

      // GET /api/speed-thresholds — 获取当前速度阈值配置
      if (path === '/api/speed-thresholds' && request.method === 'GET') {
        const { getSpeedThresholdService } = await import('./rule-engine.js')
        const service = getSpeedThresholdService()
        if (service) {
          this.json(reply, service.getThresholds())
        } else {
          this.json(reply, { error: 'SpeedThresholdService not initialized' }, 503)
        }
        return
      }

      this.json(reply, { error: 'Not found' }, 404)
    } catch (err) {
      console.error('[EditorServe] API error:', err)
      this.json(reply, { error: 'Internal server error' }, 500)
    }
  }

  private serveStatic(path: string, reply: FastifyReply): void {
    let filePath = join(this.staticDir, path === '/' ? 'index.html' : path)

    filePath = normalize(filePath)
    if (!filePath.startsWith(normalize(this.staticDir))) {
      reply.code(403).send('Forbidden')
      return
    }

    if (!existsSync(filePath)) {
      filePath = join(this.staticDir, 'index.html')
      if (!existsSync(filePath)) {
        reply.code(404).send('Not found')
        return
      }
    }

    try {
      let stat = statSync(filePath)
      if (stat.isDirectory()) {
        filePath = join(filePath, 'index.html')
        if (!existsSync(filePath)) {
          reply.code(404).send('Not found')
          return
        }
        stat = statSync(filePath)
      }

      if (!stat.isFile()) {
        reply.code(404).send('Not found')
        return
      }

      const ext = extname(filePath)
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

      const data = readFileSync(filePath)
      reply.code(200).type(contentType).send(data)
    } catch {
      reply.code(404).send('Not found')
    }
  }

  private json(reply: FastifyReply, data: unknown, status: number = 200): void {
    reply.code(status).type('application/json').send(data)
  }

  private isAuthorized(request: FastifyRequest): boolean {
    if (!this.authSecret) return true

    const authHeader = request.headers.authorization
    const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader
    const bearerToken = authValue?.startsWith('Bearer ') ? authValue.slice('Bearer '.length) : null
    if (bearerToken === this.authSecret) return true

    const url = this.getUrl(request)
    return url.searchParams.get('token') === this.authSecret
  }

  private getPath(request: FastifyRequest): string {
    return this.getUrl(request).pathname
  }

  private getUrl(request: FastifyRequest): URL {
    return new URL(request.url, `http://${HOST}:${PORT}`)
  }

  private async readJsonBody<T extends JsonObject>(request: FastifyRequest): Promise<T> {
    const body = request.body
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      return body as T
    }
    if (typeof body === 'string') {
      return JSON.parse(body) as T
    }
    if (Buffer.isBuffer(body)) {
      return JSON.parse(body.toString('utf-8')) as T
    }
    return {} as T
  }
}
