// @desc Dialog/event queue — guard period prevents bubble overwrites; phase events are buffered
import type { GameEvent } from './game-event.js'

const DIALOG_GUARD_MS = 2000

/** Queues dialog and phase events for an NPC, preventing rapid overwrites */
export class NpcEventQueue {
  private emitFn: (events: GameEvent[]) => void
  private dialogTimer: ReturnType<typeof setTimeout> | null = null
  private pendingDialog: GameEvent[] | null = null
  private pendingPhase: GameEvent[] | null = null
  private phaseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(emitFn: (events: GameEvent[]) => void) {
    this.emitFn = emitFn
  }

  /** Enqueue dialog events with a guard period */
  enqueueDialog(events: GameEvent[], textLength: number): void {
    const duration = Math.max(DIALOG_GUARD_MS, textLength * 50)

    if (this.dialogTimer) {
      // Overwrite pending dialog
      this.pendingDialog = events
      return
    }

    this.emitFn(events)
    this.dialogTimer = setTimeout(() => {
      this.dialogTimer = null
      if (this.pendingDialog) {
        const pending = this.pendingDialog
        this.pendingDialog = null
        this.emitFn(pending)
        this.dialogTimer = setTimeout(() => {
          this.dialogTimer = null
        }, duration)
      }
    }, duration)
  }

  /** Enqueue phase change events (immediate if no current phase transition) */
  enqueuePhase(events: GameEvent[]): void {
    if (this.phaseTimer) {
      this.pendingPhase = events
      return
    }

    this.emitFn(events)
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null
      if (this.pendingPhase) {
        const pending = this.pendingPhase
        this.pendingPhase = null
        this.emitFn(pending)
      }
    }, 300)
  }

  /** Flush all pending events immediately */
  flush(): void {
    if (this.dialogTimer) {
      clearTimeout(this.dialogTimer)
      this.dialogTimer = null
    }
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer)
      this.phaseTimer = null
    }
    if (this.pendingDialog) {
      this.emitFn(this.pendingDialog)
      this.pendingDialog = null
    }
    if (this.pendingPhase) {
      this.emitFn(this.pendingPhase)
      this.pendingPhase = null
    }
  }
}
