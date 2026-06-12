// @desc ActionDispatcher — 动作分发器（带消息队列、重试、ack/nack）
//
// 将 SpigotAction 通过 WebSocket 发送到 Spigot 插件。
// 支持消息确认机制：Spigot 执行成功后发送 action_executed，
// ActionDispatcher 收到后 ack；失败则 nack 并自动重试。

import type { SpigotAction } from '../contracts/index.js'
import type { WsServer } from './ws-server.js'

interface QueuedAction {
  action: SpigotAction
  timestamp: number
  attempts: number
  maxAttempts: number
  penaltyId?: string
}

export class ActionDispatcher {
  private wsServer: WsServer
  private actionLog: Array<{ action: SpigotAction; timestamp: number }> = []
  /** 待确认队列：actionId → QueuedAction */
  private pendingAcks = new Map<string, QueuedAction>()
  private retryIntervalMs: number
  private retryTimer: ReturnType<typeof setInterval> | null = null
  /** 动作确认回调：用于通知外部系统（如 PenaltyEngine）处罚已确认执行 */
  private onAckCallback: ((actionId: string, playerId: string) => void) | null = null

  constructor(wsServer: WsServer, opts?: { retryIntervalMs?: number; onAck?: (actionId: string, playerId: string) => void }) {
    this.wsServer = wsServer
    this.retryIntervalMs = opts?.retryIntervalMs ?? 15_000
    this.onAckCallback = opts?.onAck ?? null
  }

  /** 启动重试定时器 */
  start(): void {
    if (this.retryTimer) return
    this.retryTimer = setInterval(() => this.retryPending(), this.retryIntervalMs)
  }

  /** 分发动作 */
  dispatch(action: SpigotAction, penaltyId?: string): void {
    const timestamp = Date.now()
    this.actionLog.push({ action, timestamp })
    if (this.actionLog.length > 1000) {
      this.actionLog = this.actionLog.slice(-1000)
    }

    // 如果有 actionId，加入待确认队列
    if (action.actionId) {
      this.pendingAcks.set(action.actionId, {
        action,
        timestamp,
        attempts: 1,
        maxAttempts: 3,
        penaltyId,
      })
    }

    this.doSend(action)
  }

  /** 确认动作执行成功 */
  ack(actionId: string): void {
    const queued = this.pendingAcks.get(actionId)
    this.pendingAcks.delete(actionId)
    if (queued && this.onAckCallback) {
      this.onAckCallback(actionId, queued.action.playerId)
    }
  }

  /** 标记动作执行失败 */
  nack(actionId: string): void {
    const queued = this.pendingAcks.get(actionId)
    if (!queued) return
    queued.attempts++
    if (queued.attempts > queued.maxAttempts) {
      console.error(`[ActionDispatcher] Action ${actionId} failed after ${queued.maxAttempts} attempts, giving up`)
      this.pendingAcks.delete(actionId)
    }
    // 下次 retryPending() 会重试
  }

  /** 重试待确认的动作 */
  private retryPending(): void {
    const now = Date.now()
    for (const [actionId, queued] of this.pendingAcks) {
      // 超过 5 分钟的旧动作放弃
      if (now - queued.timestamp > 300_000) {
        this.pendingAcks.delete(actionId)
        continue
      }
      if (queued.attempts <= queued.maxAttempts) {
        console.log(`[ActionDispatcher] Retrying ${queued.action.type} (attempt ${queued.attempts}/${queued.maxAttempts})`)
        this.doSend(queued.action)
      }
    }
  }

  private doSend(action: SpigotAction): void {
    console.log(`[ActionDispatcher] Dispatching ${action.type} for player ${action.playerId}`)
    this.wsServer.sendToSpigot(action)
  }

  getRecentActions(limit: number = 50): Array<{ action: SpigotAction; timestamp: number }> {
    return this.actionLog.slice(-limit)
  }

  getPendingCount(): number {
    return this.pendingAcks.size
  }

  destroy(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
    this.pendingAcks.clear()
  }
}
