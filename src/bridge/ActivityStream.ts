// @desc NPC activity log and thinking stream — buffers thinking deltas and emits activity/status events
import type { GameEvent } from './game-event.js'
import type { CheatType } from '../contracts/anticheat-events.js'

const MAX_ACTIVITY_LOG = 500

const CHEAT_TYPE_ICONS: Record<CheatType, string> = {
  fly: 'arrow-up',
  speed: 'zap',
  kill_aura: 'target',
  x_ray: 'eye',
  scaffold: 'layers',
  auto_clicker: 'mouse-pointer',
  reach: 'move',
}

const CHEAT_TYPE_MESSAGES: Record<CheatType, string> = {
  fly: '飞行作弊检测',
  speed: '加速作弊检测',
  kill_aura: 'KillAura检测',
  x_ray: 'X-Ray透视检测',
  scaffold: 'Scaffold搭桥检测',
  auto_clicker: 'AutoClicker连点检测',
  reach: 'Reach攻击距离检测',
}

/** Manages the activity log panel: emits activity entries and streams thinking text in batches */
export class ActivityStream {
  private thinkingBuffers = new Map<string, string>()
  private thinkingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private activityLog: GameEvent[] = []
  private emitFn: (events: GameEvent[]) => void

  constructor(emitFn: (events: GameEvent[]) => void) {
    this.emitFn = emitFn
  }

  private nowHHMM(): string {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  private cacheActivity(event: GameEvent): void {
    this.activityLog.push(event)
    if (this.activityLog.length > MAX_ACTIVITY_LOG) this.activityLog.shift()
  }

  getActivityReplayEvents(): GameEvent[] {
    return this.activityLog.slice()
  }

  /** Emit an activity log entry with icon, message, and timestamp */
  emitActivity(npcId: string, icon: string, message: string, noStatus?: boolean): void {
    const ev: GameEvent = { type: 'npc_activity', npcId, icon, message, time: this.nowHHMM() }
    if (noStatus) (ev as any).status = null
    this.cacheActivity(ev)
    this.emitFn([ev])
  }

  /** Mark the most recent activity entry for an NPC as success or failure */
  emitActivityStatus(npcId: string, success: boolean): void {
    for (let i = this.activityLog.length - 1; i >= 0; i--) {
      const cached = this.activityLog[i]
      if (cached.type === 'npc_activity' && 'npcId' in cached && (cached as any).npcId === npcId && (cached as any).status === undefined) {
        (cached as any).status = success
        break
      }
    }
    const ev: GameEvent = { type: 'npc_activity_status', npcId, success }
    this.cacheActivity(ev)
    this.emitFn([ev])
  }

  /** Emit a cheat detection activity */
  emitCheatActivity(npcId: string, cheatType: CheatType, confidence: string): void {
    const icon = CHEAT_TYPE_ICONS[cheatType] || 'alert-triangle'
    const message = `${CHEAT_TYPE_MESSAGES[cheatType]} [${confidence}]`
    this.emitActivity(npcId, icon, message)
  }

  private startThinkingStream(npcId: string): void {
    if (this.thinkingFlushTimers.has(npcId)) return
    const ev: GameEvent = { type: 'npc_activity', npcId, icon: 'brain', message: '', time: this.nowHHMM() }
    this.cacheActivity(ev)
    this.emitFn([ev])
    const timer = setInterval(() => {
      const buf = this.thinkingBuffers.get(npcId)
      if (buf && buf.length > 0) {
        const streamEv: GameEvent = { type: 'npc_activity_stream', npcId, delta: buf }
        this.cacheActivity(streamEv)
        this.emitFn([streamEv])
        this.thinkingBuffers.set(npcId, '')
      }
    }, 500)
    this.thinkingFlushTimers.set(npcId, timer)
  }

  /** Buffer a thinking text delta; starts a periodic flush stream if not already running */
  appendThinkingDelta(npcId: string, delta: string): void {
    if (!delta && !this.thinkingFlushTimers.has(npcId)) return
    const buf = this.thinkingBuffers.get(npcId) ?? ''
    this.thinkingBuffers.set(npcId, buf + delta)
    if (!this.thinkingFlushTimers.has(npcId)) {
      this.startThinkingStream(npcId)
    }
  }

  /** Flush any buffered thinking text and emit stream-end marker */
  flushThinking(npcId: string): void {
    const timer = this.thinkingFlushTimers.get(npcId)
    if (!timer) return
    clearInterval(timer)
    this.thinkingFlushTimers.delete(npcId)
    const buf = this.thinkingBuffers.get(npcId)
    if (buf && buf.length > 0) {
      const streamEv: GameEvent = { type: 'npc_activity_stream', npcId, delta: buf }
      this.cacheActivity(streamEv)
      this.emitFn([streamEv])
    }
    this.thinkingBuffers.set(npcId, '')
    const endEv: GameEvent = { type: 'npc_activity_stream_end', npcId }
    this.cacheActivity(endEv)
    this.emitFn([endEv])
  }

  /** Return the icon name for a given cheat type */
  cheatActivityIcon(cheatType: CheatType): string {
    return CHEAT_TYPE_ICONS[cheatType] || 'alert-triangle'
  }

  /** Return the description for a given cheat type */
  cheatActivityMsg(cheatType: CheatType): string {
    return CHEAT_TYPE_MESSAGES[cheatType] || `作弊检测: ${cheatType}`
  }
}
