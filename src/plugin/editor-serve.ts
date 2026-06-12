import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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

const PORT = 55210

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

export class EditorServe {
  private server: ReturnType<typeof createServer> | null = null
  private ctx: RouteContext
  private staticDir: string

  constructor(ctx: RouteContext, staticDir?: string) {
    this.ctx = ctx
    this.staticDir = staticDir ?? join(process.cwd(), 'public')
  }

  start(): void {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.listen(PORT, () => {
      console.log(`[EditorServe] HTTP server listening on http://localhost:${PORT}`)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    const path = url.pathname

    if (path.startsWith('/api/')) {
      await this.handleApi(req, res, path)
      return
    }

    this.serveStatic(path, res)
  }

  private corsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    this.corsHeaders(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    try {
      // GET /api/players
      if (path === '/api/players' && req.method === 'GET') {
        const players = this.ctx.playerTracker.getAllPlayerStates()
        this.json(res, players)
        return
      }

      // GET /api/players/:uuid/records
      const recordsMatch = path.match(/^\/api\/players\/([^/]+)\/records$/)
      if (recordsMatch && req.method === 'GET') {
        const playerId = decodeURIComponent(recordsMatch[1])
        const records = this.ctx.recordStore.query({ playerId })
        this.json(res, records)
        return
      }

      // GET /api/whitelist
      if (path === '/api/whitelist' && req.method === 'GET') {
        const whitelist = this.ctx.banManager.getWhitelist()
        this.json(res, whitelist)
        return
      }

      // POST /api/ban — 封禁玩家（同时更新 BanManager + 发送 Spigot 动作）
      if (path === '/api/ban' && req.method === 'POST') {
        const body = await this.readBody(req)
        const { playerId, playerName, reason, duration } = JSON.parse(body)
        // 将 npcId 解析为真实 playerId (UUID)
        const resolvedId = this.ctx.resolvePlayerId?.(playerId) ?? playerId
        const entry = this.ctx.banManager.banPlayer(
          resolvedId,
          playerName ?? playerId,
          reason,
          duration,
        )
        // 同步发送封禁动作到 Spigot
        this.ctx.actionDispatcher?.dispatch({
          type: 'ban',
          playerId: resolvedId,
          reason: reason ?? 'Banned by Admin',
          duration: duration ?? '24h',
        })
        console.log(`[EditorServe] POST /api/ban: npcId=${playerId} → playerId=${resolvedId}`)
        this.json(res, entry, 201)
        return
      }

      // POST /api/unban — 解封玩家（同时更新 BanManager + 发送 Spigot 动作）
      if (path === '/api/unban' && req.method === 'POST') {
        const body = await this.readBody(req)
        const { playerId } = JSON.parse(body)
        // 将 npcId 解析为真实 playerId (UUID)
        const resolvedId = this.ctx.resolvePlayerId?.(playerId) ?? playerId
        const success = this.ctx.banManager.unbanPlayer(resolvedId)
        // 同步发送解封动作到 Spigot
        this.ctx.actionDispatcher?.dispatch({
          type: 'unban',
          playerId: resolvedId,
        })
        console.log(`[EditorServe] POST /api/unban: npcId=${playerId} → playerId=${resolvedId}`)
        this.json(res, { success })
        return
      }

      // POST /api/whitelist
      if (path === '/api/whitelist' && req.method === 'POST') {
        const body = await this.readBody(req)
        const { playerId, playerName, action, reason } = JSON.parse(body)
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
        this.json(res, { success: true })
        return
      }

      // GET /api/stats
      if (path === '/api/stats' && req.method === 'GET') {
        const onlineCount = this.ctx.playerTracker.getAllPlayerStates().length
        const stats = this.ctx.banManager.getStats(onlineCount)
        this.json(res, stats)
        return
      }

      // POST /api/action — dispatch admin action (ban/kick/freeze/etc)
      if (path === '/api/action' && req.method === 'POST') {
        const body = await this.readBody(req)
        const { type, playerId, reason, duration } = JSON.parse(body)

        if (!type || !playerId) {
          this.json(res, { error: 'Missing required fields: type, playerId' }, 400)
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
          this.json(res, { success: true, action })
        } else {
          this.json(res, { error: 'ActionDispatcher not available' }, 503)
        }
        return
      }

      // GET /api/alerts — get active alerts
      if (path === '/api/alerts' && req.method === 'GET') {
        if (this.ctx.alertManager) {
          const alerts = this.ctx.alertManager.getActiveAlerts()
          this.json(res, alerts)
        } else {
          this.json(res, [])
        }
        return
      }

      // GET /api/bans — get active bans (with npcId for frontend matching)
      if (path === '/api/bans' && req.method === 'GET') {
        const bans = this.ctx.banManager.getActiveBans()
        // 为每个封禁记录附加 npcId，方便前端用 npcId 匹配
        const bansWithNpcId = bans.map(ban => ({
          ...ban,
          npcId: this.ctx.resolveNpcId?.(ban.playerId)
            ?? (ban.playerId.startsWith('player_') ? ban.playerId : `player_${ban.playerId.slice(0, 8)}`),
        }))
        this.json(res, bansWithNpcId)
        return
      }

      // DELETE /api/bans/:playerId — unban player
      const bansMatch = path.match(/^\/api\/bans\/([^/]+)$/)
      if (bansMatch && req.method === 'DELETE') {
        const playerId = decodeURIComponent(bansMatch[1])
        const success = this.ctx.banManager.unbanPlayer(playerId)
        this.json(res, { success })
        return
      }

      // GET /api/records — query all cheat records with optional filters
      if (path === '/api/records' && req.method === 'GET') {
        const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
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
        this.json(res, records)
        return
      }

      // ── 申诉 API ──

      // GET /api/appeals — 获取申诉列表
      if (path === '/api/appeals' && req.method === 'GET') {
        if (this.ctx.appealManager) {
          const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
          const status = url.searchParams.get('status')
          let appeals
          if (status === 'pending') {
            appeals = this.ctx.appealManager.getPendingAppeals()
          } else {
            appeals = this.ctx.appealManager.getAllAppeals()
          }
          this.json(res, appeals)
        } else {
          this.json(res, [])
        }
        return
      }

      // POST /api/appeals — 提交申诉
      if (path === '/api/appeals' && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const body = await this.readBody(req)
        const { playerId, playerName, penaltyId, reason } = JSON.parse(body)
        if (!playerId || !penaltyId || !reason) {
          this.json(res, { error: 'Missing required fields: playerId, penaltyId, reason' }, 400)
          return
        }
        const record = this.ctx.appealManager.submitAppeal(
          playerId,
          playerName ?? playerId,
          penaltyId,
          reason,
        )
        this.json(res, record, 201)
        return
      }

      // POST /api/appeals/:appealId/approve — 批准申诉
      const approveMatch = path.match(/^\/api\/appeals\/([^/]+)\/approve$/)
      if (approveMatch && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const appealId = decodeURIComponent(approveMatch[1])
        const body = await this.readBody(req)
        const { reviewedBy, note } = JSON.parse(body)
        const record = this.ctx.appealManager.approveAppeal(appealId, reviewedBy ?? 'admin', note ?? '')
        if (record) {
          this.json(res, record)
        } else {
          this.json(res, { error: 'Appeal not found or already reviewed' }, 404)
        }
        return
      }

      // POST /api/appeals/:appealId/reject — 驳回申诉
      const rejectMatch = path.match(/^\/api\/appeals\/([^/]+)\/reject$/)
      if (rejectMatch && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const appealId = decodeURIComponent(rejectMatch[1])
        const body = await this.readBody(req)
        const { reviewedBy, note } = JSON.parse(body)
        const record = this.ctx.appealManager.rejectAppeal(appealId, reviewedBy ?? 'admin', note)
        if (record) {
          this.json(res, record)
        } else {
          this.json(res, { error: 'Appeal not found or already reviewed' }, 404)
        }
        return
      }

      // GET /api/appeals/stats — 申诉统计
      if (path === '/api/appeals/stats' && req.method === 'GET') {
        if (this.ctx.appealManager) {
          this.json(res, this.ctx.appealManager.getStats())
        } else {
          this.json(res, { total: 0, pending: 0, approved: 0, rejected: 0 })
        }
        return
      }

      // 申诉 API（简化版）

      // POST /api/appeal/submit — 简化版提交申诉
      if (path === '/api/appeal/submit' && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const body = await this.readBody(req)
        const { playerId, playerName, reason } = JSON.parse(body)
        if (!playerId || !reason) {
          this.json(res, { error: 'playerId and reason are required' }, 400)
          return
        }
        const appeal = this.ctx.appealManager.submitAppeal(playerId, playerName ?? playerId, `simplified-${Date.now()}`, reason)
        this.json(res, appeal)
        return
      }

      // GET /api/appeal/pending — 获取待处理申诉
      if (path === '/api/appeal/pending' && req.method === 'GET') {
        if (this.ctx.appealManager) {
          const appeals = this.ctx.appealManager.getPendingAppeals()
          this.json(res, appeals)
        } else {
          this.json(res, [])
        }
        return
      }

      // POST /api/appeal/approve — 批准申诉（含解封+清VP+发unban动作）
      if (path === '/api/appeal/approve' && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const body = await this.readBody(req)
        const { appealId, reviewerId, note } = JSON.parse(body)
        if (!appealId || !reviewerId) {
          this.json(res, { error: 'appealId and reviewerId are required' }, 400)
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
          this.json(res, { error: 'Appeal not found' }, 404)
          return
        }
        this.json(res, result)
        return
      }

      // POST /api/appeal/reject — 驳回申诉
      if (path === '/api/appeal/reject' && req.method === 'POST') {
        if (!this.ctx.appealManager) {
          this.json(res, { error: 'AppealManager not available' }, 503)
          return
        }
        const body = await this.readBody(req)
        const { appealId, reviewerId, note } = JSON.parse(body)
        if (!appealId || !reviewerId) {
          this.json(res, { error: 'appealId and reviewerId are required' }, 400)
          return
        }
        const result = this.ctx.appealManager.rejectAppeal(appealId, reviewerId, note ?? '')
        if (!result) {
          this.json(res, { error: 'Appeal not found' }, 404)
          return
        }
        this.json(res, result)
        return
      }

      // ── IP 关联 API ──

      // GET /api/ip-associations/:playerId — 获取玩家 IP 关联信息
      const ipAssocMatch = path.match(/^\/api\/ip-associations\/([^/]+)$/)
      if (ipAssocMatch && req.method === 'GET') {
        if (!this.ctx.ipTracker) {
          this.json(res, { error: 'IPTracker not available' }, 503)
          return
        }
        const playerId = decodeURIComponent(ipAssocMatch[1])
        const associates = this.ctx.ipTracker.getAssociatedPlayers(playerId)
        const ip = this.ctx.ipTracker.getPlayerIP(playerId)
        this.json(res, { playerId, ip, associates, hasAssociations: associates.length > 0 })
        return
      }

      // GET /api/ip-stats — IP 关联统计
      if (path === '/api/ip-stats' && req.method === 'GET') {
        if (this.ctx.ipTracker) {
          this.json(res, this.ctx.ipTracker.getStats())
        } else {
          this.json(res, { totalIPs: 0, multiAccountIPs: 0 })
        }
        return
      }

      // GET /api/detection-log — 获取检测规则变更日志
      if (path === '/api/detection-log' && req.method === 'GET') {
        const { getDetectionLog } = await import('./rule-engine.js')
        const parsedUrl = new URL(req.url ?? '/', `http://localhost`)
        const limitParam = parsedUrl.searchParams.get('limit')
        const limit = limitParam ? parseInt(limitParam, 10) : 100
        this.json(res, getDetectionLog(limit))
        return
      }

      // GET /api/speed-thresholds — 获取当前速度阈值配置
      if (path === '/api/speed-thresholds' && req.method === 'GET') {
        const { getSpeedThresholdService } = await import('./rule-engine.js')
        const service = getSpeedThresholdService()
        if (service) {
          this.json(res, service.getThresholds())
        } else {
          this.json(res, { error: 'SpeedThresholdService not initialized' }, 503)
        }
        return
      }

      this.json(res, { error: 'Not found' }, 404)
    } catch (err) {
      console.error('[EditorServe] API error:', err)
      this.json(res, { error: 'Internal server error' }, 500)
    }
  }

  private serveStatic(path: string, res: ServerResponse): void {
    let filePath = join(this.staticDir, path === '/' ? 'index.html' : path)

    filePath = normalize(filePath)
    if (!filePath.startsWith(normalize(this.staticDir))) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    if (!existsSync(filePath)) {
      filePath = join(this.staticDir, 'index.html')
      if (!existsSync(filePath)) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
    }

    try {
      const stat = statSync(filePath)
      if (stat.isDirectory()) {
        filePath = join(filePath, 'index.html')
      }

      const ext = extname(filePath)
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

      const data = readFileSync(filePath)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(data)
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
  }

  private json(res: ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status)
    res.end(JSON.stringify(data))
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }
}
