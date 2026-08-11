import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CheatType, Confidence, Evidence } from '../contracts/index.js'

export type InvestigationCaseStatus = 'open' | 'monitoring' | 'confirmed' | 'dismissed'
export type InvestigationRiskLevel = 'medium' | 'high' | 'critical'
export type InvestigationDecision = 'confirm' | 'dismiss' | 'monitor'

export interface InvestigationSignal {
  id: string
  cheatType: CheatType
  confidence: Confidence
  evidence: Evidence[]
  timestamp: number
  repeatOffense: boolean
}

export interface InvestigationCase {
  id: string
  playerId: string
  playerName: string
  status: InvestigationCaseStatus
  riskLevel: InvestigationRiskLevel
  riskScore: number
  confidenceScore: number
  suspectedCheats: CheatType[]
  signals: InvestigationSignal[]
  openedAt: number
  updatedAt: number
  reviewedAt?: number
  reviewedBy?: string
  reviewNote?: string
}

export interface CaseUpdate {
  investigationCase: InvestigationCase
  created: boolean
}

export interface DetectorQualityMetric {
  reviewedCases: number
  confirmedCases: number
  dismissedCases: number
  confirmationRate: number | null
}

export interface CaseQualityMetrics {
  reviewedCases: number
  confirmedCases: number
  dismissedCases: number
  confirmationRate: number | null
  dismissalRate: number | null
  averageHandlingTimeMs: number | null
  byDetector: Partial<Record<CheatType, DetectorQualityMetric>>
}

const CONFIDENCE_SCORE: Record<Confidence, number> = {
  low: 25,
  medium: 60,
  high: 85,
}

const SURVIVAL_THREAT_SCORE: Record<CheatType, number> = {
  x_ray: 70,
  fly: 70,
  scaffold: 65,
  speed: 55,
  kill_aura: 60,
  reach: 55,
  auto_clicker: 40,
}

const MAX_SIGNALS_PER_CASE = 100
const MEDIUM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const HIGH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export class InvestigationCaseManager {
  private readonly filePath: string
  private readonly now: () => number
  private cases: InvestigationCase[] = []

  constructor(dataDir: string, now: () => number = Date.now) {
    mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'investigation-cases.json')
    this.now = now
    this.load()
    if (this.pruneExpired()) this.save()
  }

  recordDetection(input: {
    playerId: string
    playerName: string
    cheatType: CheatType
    confidence: Confidence
    evidence: Evidence[]
    timestamp: number
    repeatOffense?: boolean
  }): CaseUpdate | null {
    if (input.confidence === 'low') return null

    let investigationCase = this.cases.find(item =>
      item.playerId === input.playerId
      && (item.status === 'open' || item.status === 'monitoring'),
    )
    const created = !investigationCase

    if (!investigationCase) {
      investigationCase = {
        id: `case-${randomUUID()}`,
        playerId: input.playerId,
        playerName: input.playerName,
        status: 'open',
        riskLevel: 'medium',
        riskScore: 0,
        confidenceScore: 0,
        suspectedCheats: [],
        signals: [],
        openedAt: input.timestamp,
        updatedAt: input.timestamp,
      }
      this.cases.push(investigationCase)
    }

    investigationCase.playerName = input.playerName
    investigationCase.updatedAt = input.timestamp
    investigationCase.signals.push({
      id: `signal-${randomUUID()}`,
      cheatType: input.cheatType,
      confidence: input.confidence,
      evidence: input.evidence,
      timestamp: input.timestamp,
      repeatOffense: input.repeatOffense ?? false,
    })
    investigationCase.signals = investigationCase.signals.slice(-MAX_SIGNALS_PER_CASE)
    this.recalculate(investigationCase)
    this.save()

    return { investigationCase: this.clone(investigationCase), created }
  }

  getCases(status?: InvestigationCaseStatus): InvestigationCase[] {
    if (this.pruneExpired()) this.save()
    const items = status
      ? this.cases.filter(item => item.status === status)
      : this.cases
    return items
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(item => this.clone(item))
  }

  getPendingCases(): InvestigationCase[] {
    if (this.pruneExpired()) this.save()
    return this.cases
      .filter(item => item.status === 'open' || item.status === 'monitoring')
      .slice()
      .sort((a, b) => b.riskScore - a.riskScore || b.updatedAt - a.updatedAt)
      .map(item => this.clone(item))
  }

  reviewCase(
    caseId: string,
    decision: InvestigationDecision,
    reviewedBy: string,
    note: string = '',
  ): InvestigationCase | null {
    const investigationCase = this.cases.find(item => item.id === caseId)
    if (!investigationCase) return null

    investigationCase.status = decision === 'confirm'
      ? 'confirmed'
      : decision === 'dismiss'
        ? 'dismissed'
        : 'monitoring'
    const reviewedAt = this.now()
    investigationCase.reviewedAt = decision === 'monitor'
      ? investigationCase.reviewedAt
      : reviewedAt
    investigationCase.reviewedBy = reviewedBy
    investigationCase.reviewNote = note
    investigationCase.updatedAt = reviewedAt
    this.save()
    return this.clone(investigationCase)
  }

  dismissPlayerCases(playerId: string, reviewedBy: string, note: string): InvestigationCase[] {
    const dismissed: InvestigationCase[] = []
    for (const investigationCase of this.cases) {
      if (investigationCase.playerId !== playerId) continue
      if (investigationCase.status !== 'open' && investigationCase.status !== 'monitoring') continue

      investigationCase.status = 'dismissed'
      investigationCase.reviewedAt = this.now()
      investigationCase.reviewedBy = reviewedBy
      investigationCase.reviewNote = note
      investigationCase.updatedAt = investigationCase.reviewedAt
      dismissed.push(this.clone(investigationCase))
    }
    if (dismissed.length > 0) this.save()
    return dismissed
  }

  getStats(): {
    total: number
    pending: number
    confirmed: number
    dismissed: number
    monitoring: number
  } {
    if (this.pruneExpired()) this.save()
    return {
      total: this.cases.length,
      pending: this.cases.filter(item => item.status === 'open' || item.status === 'monitoring').length,
      confirmed: this.cases.filter(item => item.status === 'confirmed').length,
      dismissed: this.cases.filter(item => item.status === 'dismissed').length,
      monitoring: this.cases.filter(item => item.status === 'monitoring').length,
    }
  }

  getQualityMetrics(): CaseQualityMetrics {
    if (this.pruneExpired()) this.save()
    const reviewed = this.cases.filter(item => item.status === 'confirmed' || item.status === 'dismissed')
    const confirmed = reviewed.filter(item => item.status === 'confirmed')
    const dismissed = reviewed.filter(item => item.status === 'dismissed')
    const handlingTimes = reviewed
      .filter(item => item.reviewedAt !== undefined)
      .map(item => Math.max(0, item.reviewedAt! - item.openedAt))
    const byDetector: CaseQualityMetrics['byDetector'] = {}

    for (const investigationCase of reviewed) {
      for (const cheatType of new Set(investigationCase.suspectedCheats)) {
        const metric = byDetector[cheatType] ?? {
          reviewedCases: 0,
          confirmedCases: 0,
          dismissedCases: 0,
          confirmationRate: null,
        }
        metric.reviewedCases++
        if (investigationCase.status === 'confirmed') metric.confirmedCases++
        if (investigationCase.status === 'dismissed') metric.dismissedCases++
        metric.confirmationRate = metric.reviewedCases > 0
          ? metric.confirmedCases / metric.reviewedCases
          : null
        byDetector[cheatType] = metric
      }
    }

    return {
      reviewedCases: reviewed.length,
      confirmedCases: confirmed.length,
      dismissedCases: dismissed.length,
      confirmationRate: reviewed.length > 0 ? confirmed.length / reviewed.length : null,
      dismissalRate: reviewed.length > 0 ? dismissed.length / reviewed.length : null,
      averageHandlingTimeMs: handlingTimes.length > 0
        ? handlingTimes.reduce((total, duration) => total + duration, 0) / handlingTimes.length
        : null,
      byDetector,
    }
  }

  pruneExpired(timestamp: number = this.now()): boolean {
    const previousLength = this.cases.length
    this.cases = this.cases.filter(investigationCase => {
      if (investigationCase.status === 'open' || investigationCase.status === 'monitoring') return true
      const retentionMs = investigationCase.riskLevel === 'medium'
        ? MEDIUM_RETENTION_MS
        : HIGH_RETENTION_MS
      return timestamp - investigationCase.updatedAt <= retentionMs
    })
    return this.cases.length !== previousLength
  }

  private recalculate(investigationCase: InvestigationCase): void {
    const signals = investigationCase.signals
    const suspectedCheats = [...new Set(signals.map(signal => signal.cheatType))]
    const maxConfidence = Math.max(...signals.map(signal => CONFIDENCE_SCORE[signal.confidence]))
    const repeatBoost = signals.some(signal => signal.repeatOffense) ? 8 : 0
    const independentBoost = Math.min(16, Math.max(0, suspectedCheats.length - 1) * 8)
    const confidenceScore = Math.min(100, maxConfidence + repeatBoost + independentBoost)
    const threatScore = Math.max(...suspectedCheats.map(type => SURVIVAL_THREAT_SCORE[type]))
    let riskScore = Math.round(threatScore * 0.4 + confidenceScore * 0.6)

    if (suspectedCheats.length >= 2 && maxConfidence >= CONFIDENCE_SCORE.high) {
      riskScore = Math.min(100, riskScore + 10)
    }

    investigationCase.suspectedCheats = suspectedCheats
    investigationCase.confidenceScore = confidenceScore
    investigationCase.riskScore = riskScore
    investigationCase.riskLevel = riskScore >= 85
      ? 'critical'
      : riskScore >= 70
        ? 'high'
        : 'medium'
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (Array.isArray(parsed)) {
        this.cases = parsed.filter(item => item && typeof item.id === 'string') as InvestigationCase[]
      }
    } catch (error) {
      console.error('[InvestigationCaseManager] Failed to load cases:', error)
      this.cases = []
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cases, null, 2), 'utf-8')
  }

  private clone(investigationCase: InvestigationCase): InvestigationCase {
    return structuredClone(investigationCase)
  }
}
