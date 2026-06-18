import { WebSocketServer, WebSocket } from 'ws'
import type { AntiCheatEvent, SpigotAction, SpigotMessage } from '../contracts/index.js'
import { translateSpigotMessage } from './event-translator.js'

const PORT = 55211
const HOST = process.env.ACS_WS_HOST ?? '0.0.0.0'
const HEARTBEAT_INTERVAL = 30_000
const AUTH_SECRET = process.env.ACS_AUTH_SECRET ?? null

export interface WsServerCallbacks {
  onSpigotEvent: (event: AntiCheatEvent) => void
  onBrowserAction: (action: SpigotAction) => void
  onBrowserConnect: (ws: WebSocket) => void
  onSpigotConnect?: () => void
}

export class WsServer {
  private wss: WebSocketServer | null = null
  private spigotWs: WebSocket | null = null
  private browserClients = new Set<WebSocket>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private callbacks: WsServerCallbacks
  private authSecret: string | null

  constructor(callbacks: WsServerCallbacks) {
    this.callbacks = callbacks
    this.authSecret = AUTH_SECRET
  }

  start(): void {
    this.wss = new WebSocketServer({ port: PORT, host: HOST })

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const path = url.pathname
      const ip = req.socket.remoteAddress ?? 'unknown'
      console.log(`[WsServer] New connection from ${ip}, path: "${path}"`)

      // 身份验证：如果设置了共享密钥，校验 URL 中的 token 参数
      if (this.authSecret) {
        const authHeader = req.headers.authorization
        const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
        const token = url.searchParams.get('token') ?? bearerToken
        if (token !== this.authSecret) {
          console.warn(`[WsServer] Auth failed for ${ip} — rejecting connection`)
          ws.close(4001, 'Authentication required')
          return
        }
      }

      if (path === '/spigot') {
        this.handleSpigotConnection(ws)
      } else {
        this.handleBrowserConnection(ws)
      }
    })

    console.log(`[WsServer] Listening on ws://${HOST}:${PORT}`)
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    if (this.spigotWs) {
      this.spigotWs.close()
      this.spigotWs = null
    }

    for (const client of this.browserClients) {
      client.close()
    }
    this.browserClients.clear()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
  }

  sendToSpigot(action: SpigotAction): void {
    if (!this.spigotWs || this.spigotWs.readyState !== WebSocket.OPEN) {
      console.warn('[WsServer] Spigot not connected, cannot send action:', action.type)
      return
    }
    this.spigotWs.send(JSON.stringify(action))
  }

  broadcastEvent(event: AntiCheatEvent): void {
    // Only forward events that Spigot needs to process.
    // Spigot's ActionExecutor only handles action commands (kick/ban/unban/etc),
    // not detection/alert/penalty/vp_update events which are backend-internal.
    const spigotRelevantTypes = new Set([
      'action_executed',  // ack/nack for actions
    ])
    if (spigotRelevantTypes.has(event.type) && this.spigotWs && this.spigotWs.readyState === WebSocket.OPEN) {
      this.spigotWs.send(JSON.stringify(event))
    }
  }

  broadcastToBrowsers(data: unknown): void {
    const message = JSON.stringify(data)
    for (const client of this.browserClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  get hasSpigotConnection(): boolean {
    return this.spigotWs !== null && this.spigotWs.readyState === WebSocket.OPEN
  }

  get browserClientCount(): number {
    return this.browserClients.size
  }

  private handleSpigotConnection(ws: WebSocket): void {
    if (this.spigotWs && this.spigotWs.readyState === WebSocket.OPEN) {
      console.warn('[WsServer] Replacing existing Spigot connection')
      this.spigotWs.close()
    }

    this.spigotWs = ws
    console.log('[WsServer] Spigot connected')

    this.startHeartbeat()

    // 通知上层 Spigot 已连接，可以同步未执行的封禁动作
    if (this.callbacks.onSpigotConnect) {
      this.callbacks.onSpigotConnect()
    }

    ws.on('message', (data: Buffer) => {
      try {
        const raw = JSON.parse(data.toString('utf-8')) as SpigotMessage
        const event = translateSpigotMessage(raw)
        if (event) {
          this.callbacks.onSpigotEvent(event)
        }
        // Only log non-high-frequency messages
        if (raw.type !== 'player_move' && raw.type !== 'heartbeat') {
          console.log(`[WsServer] Spigot message: type=${raw.type}`)
        }
      } catch (err) {
        console.error('[WsServer] Failed to parse Spigot message:', err)
      }
    })

    ws.on('close', () => {
      console.log('[WsServer] Spigot disconnected')
      this.spigotWs = null
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
    })

    ws.on('error', (err) => {
      console.error('[WsServer] Spigot connection error:', err)
      // 错误后标记断开，等待 Spigot 端重连
      this.spigotWs = null
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
    })
  }

  private handleBrowserConnection(ws: WebSocket): void {
    this.browserClients.add(ws)
    console.log(`[WsServer] Browser client connected (total: ${this.browserClients.size})`)

    this.callbacks.onBrowserConnect(ws)

    ws.on('message', (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString('utf-8'))

        if (parsed.type === 'admin_action') {
          const action: SpigotAction = {
            type: parsed.action ?? parsed.actionType ?? parsed.type,
            playerId: parsed.playerId,
            reason: parsed.reason,
            duration: parsed.duration,
          }
          this.callbacks.onBrowserAction(action)
        } else {
          const action = parsed as SpigotAction
          this.callbacks.onBrowserAction(action)
        }
      } catch (err) {
        console.error('[WsServer] Failed to parse browser action:', err)
      }
    })

    ws.on('close', () => {
      this.browserClients.delete(ws)
      console.log(`[WsServer] Browser client disconnected (total: ${this.browserClients.size})`)
    })

    ws.on('error', (err) => {
      console.error('[WsServer] Browser client error:', err)
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.spigotWs && this.spigotWs.readyState === WebSocket.OPEN) {
        this.spigotWs.ping()
      }
    }, HEARTBEAT_INTERVAL)
  }
}
