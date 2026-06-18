// @desc Alert aggregation — merges same-player same-type alerts within a 5s window
import type { CheatType, Confidence } from '../contracts/anticheat-events.js'

export interface AggregatedAlert {
  id: string
  playerId: string
  cheatType: CheatType
  confidence: Confidence
  message: string
  count: number
  firstTimestamp: number
  lastTimestamp: number
}

const AGGREGATION_WINDOW_MS = 5000
const MAX_ALERTS = 1000

const CONFIDENCE_PRIORITY: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/** Aggregates alerts: same player + same type within 5s are merged; priority high > medium > low */
export class AlertManager {
  private alerts: AggregatedAlert[] = []
  private nextId = 0

  /** Add a new alert. Returns the aggregated alert (either new or merged). */
  addAlert(playerId: string, cheatType: CheatType, confidence: Confidence, message: string): AggregatedAlert {
    const now = Date.now()

    // Check for aggregatable alert
    for (const alert of this.alerts) {
      if (
        alert.playerId === playerId &&
        alert.cheatType === cheatType &&
        now - alert.lastTimestamp < AGGREGATION_WINDOW_MS
      ) {
        // Merge: upgrade confidence if higher, update message, increment count
        alert.count++
        alert.lastTimestamp = now
        if (CONFIDENCE_PRIORITY[confidence] > CONFIDENCE_PRIORITY[alert.confidence]) {
          alert.confidence = confidence
        }
        if (message) alert.message = message
        return alert
      }
    }

    // New alert
    const alert: AggregatedAlert = {
      id: `alert_${this.nextId++}`,
      playerId,
      cheatType,
      confidence,
      message,
      count: 1,
      firstTimestamp: now,
      lastTimestamp: now,
    }
    this.alerts.push(alert)

    // Trim to max
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(-MAX_ALERTS)
    }

    return alert
  }

  /** Check if an alert should be aggregated (exists within window) */
  shouldAggregate(playerId: string, cheatType: CheatType): boolean {
    const now = Date.now()
    return this.alerts.some(
      a => a.playerId === playerId && a.cheatType === cheatType && now - a.lastTimestamp < AGGREGATION_WINDOW_MS
    )
  }

  /** Get all active alerts, sorted by most recent first */
  getActiveAlerts(): AggregatedAlert[] {
    return [...this.alerts].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
  }

  /** Get alerts for a specific player */
  getAlertsByPlayer(playerId: string): AggregatedAlert[] {
    return this.alerts.filter(a => a.playerId === playerId).sort((a, b) => b.lastTimestamp - a.lastTimestamp)
  }

  /** Clear all alerts */
  clearAlerts(): void {
    this.alerts = []
  }

  /** Get alert count */
  get alertCount(): number {
    return this.alerts.length
  }
}
