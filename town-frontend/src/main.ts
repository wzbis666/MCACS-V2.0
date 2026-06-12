// main.ts — entry point for the anti-cheat town frontend

import { MainScene } from './game/MainScene.js'
import type { GameEvent } from './data/GameProtocol.js'
import { serializeAction, parseMessage } from './data/GameProtocol.js'
import type { GameAction } from './data/GameProtocol.js'

/** WebSocket 连接地址 — 可通过 VITE_WS_URL 环境变量覆盖（构建时注入） */
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:55211'
/** HTTP API 基础地址 — 可通过 VITE_API_BASE 环境变量覆盖（构建时注入） */
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:55210'

class Application {
  private scene: MainScene
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 50
  private shortcutHideTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const container = document.getElementById('canvas-container')!
    this.scene = new MainScene(container)
    this.scene.setApiBase(API_BASE)

    this.scene.setSendAction((action: GameAction) => {
      this.sendAction(action)
    })

    // Wait for assets to load before connecting WebSocket,
    // so that state sync events can be processed with loaded GLB models.
    this.scene.ready.then(() => {
      this.connect()
    })

    this.scene.start()
    this.initShortcutAutoHide()
  }

  private initShortcutAutoHide(): void {
    const hints = document.getElementById('shortcut-hints')!
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    // Auto-hide after 5 seconds
    hideTimer = setTimeout(() => {
      hints.classList.add('auto-hidden')
    }, 5000)

    // Show on hover, hide on leave
    hints.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
      hints.classList.remove('auto-hidden')
    })

    hints.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => {
        hints.classList.add('auto-hidden')
      }, 2000)
    })
  }

  private connect(): void {
    this.scene.setConnectionStatus('connecting')

    try {
      this.ws = new WebSocket(WS_URL)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.scene.setConnectionStatus('connected')
      this.reconnectAttempts = 0  // 重置重连计数
    }

    this.ws.onmessage = (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : ''
      const parsed = parseMessage(data)
      if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return

      // Handle game_events envelope: { type: 'game_events', events: GameEvent[] }
      if (parsed.type === 'game_events' && Array.isArray((parsed as any).events)) {
        for (const evt of (parsed as any).events) {
          if (evt && typeof evt === 'object' && 'type' in evt) {
            if (evt.type === 'npc_despawn') {
              console.log(`[WS] Received npc_despawn event:`, evt)
            }
            this.scene.getEventDispatcher().dispatch(evt as GameEvent)
          }
        }
      } else if (parsed.type === 'player_stats') {
        // Handle stats update
        this.scene.onServerStats(parsed as any)
      } else {
        this.scene.getEventDispatcher().dispatch(parsed as GameEvent)
      }
    }

    this.ws.onclose = () => {
      this.scene.setConnectionStatus('disconnected')
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.scene.setConnectionStatus('disconnected')
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[WS] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`)
      return
    }
    // 指数退避：3s, 6s, 12s, 24s... 最大 30s
    const delay = Math.min(3000 * Math.pow(1.5, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`[WS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private sendAction(action: GameAction): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeAction(action))
    }
  }
}

new Application()
