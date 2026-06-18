import type { CheatType, Confidence } from '../contracts/index.js'

const MAX_ALERTS = 1000
const AGGREGATION_WINDOW = 5000 // 5 seconds

export interface AggregatedAlert {
  playerId: string
  cheatType: CheatType
  confidence: Confidence
  message: string
  count: number
  firstSeen: number
  lastSeen: number
}

const CONFIDENCE_PRIORITY: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

function highestConfidence(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_PRIORITY[a] >= CONFIDENCE_PRIORITY[b] ? a : b
}

export class AlertManager {
  private alerts: AggregatedAlert[] = []

  addAlert(
    playerId: string,
    cheatType: CheatType,
    confidence: Confidence,
    message: string,
  ): AggregatedAlert {
    const now = Date.now()

    const existing = this.alerts.find(
      a =>
        a.playerId === playerId &&
        a.cheatType === cheatType &&
        now - a.lastSeen < AGGREGATION_WINDOW,
    )

    if (existing) {
      existing.count++
      existing.lastSeen = now
      existing.confidence = highestConfidence(existing.confidence, confidence)
      if (CONFIDENCE_PRIORITY[confidence] > CONFIDENCE_PRIORITY[existing.confidence]) {
        existing.message = message
      }
      return existing
    }

    const alert: AggregatedAlert = {
      playerId,
      cheatType,
      confidence,
      message,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    }

    this.alerts.push(alert)

    if (this.alerts.length > MAX_ALERTS) {
      this.alerts.sort((a, b) => {
        const priDiff = CONFIDENCE_PRIORITY[b.confidence] - CONFIDENCE_PRIORITY[a.confidence]
        if (priDiff !== 0) return priDiff
        return b.lastSeen - a.lastSeen
      })
      this.alerts = this.alerts.slice(0, MAX_ALERTS)
    }

    return alert
  }

  getActiveAlerts(): AggregatedAlert[] {
    const now = Date.now()
    return this.alerts
      .filter(a => now - a.lastSeen < 60_000)
      .sort((a, b) => {
        const priDiff = CONFIDENCE_PRIORITY[b.confidence] - CONFIDENCE_PRIORITY[a.confidence]
        if (priDiff !== 0) return priDiff
        return b.lastSeen - a.lastSeen
      })
  }

  getAlertsByPlayer(playerId: string): AggregatedAlert[] {
    return this.alerts
      .filter(a => a.playerId === playerId)
      .sort((a, b) => b.lastSeen - a.lastSeen)
  }

  clearAlerts(): void {
    this.alerts = []
  }
}
