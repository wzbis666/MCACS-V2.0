import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUCKET_MS = 60_000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

interface ActivityBucket {
  startedAt: number
  onlinePeak: number
  minTps: number | null
  casesOpened: number
  automaticMeasures: number
}

interface OperationsState {
  version: 1
  monitoringStartedAt: number
  lastViewedAt: number
  buckets: ActivityBucket[]
}

export interface OfflineSummary {
  from: number
  to: number
  durationMs: number
  onlinePeak: number
  casesOpened: number
  automaticMeasures: number
  minTps: number | null
  hasImportantActivity: boolean
}

/**
 * Persists compact, minute-level operations data for the next administrator shift.
 * A small server needs durable context, not a high-volume telemetry database.
 */
export class OperationsSummaryManager {
  private readonly filePath: string
  private readonly tempPath: string
  private readonly now: () => number
  private state: OperationsState

  constructor(dataDir: string, now: () => number = Date.now) {
    mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'operations-summary.json')
    this.tempPath = `${this.filePath}.tmp`
    this.now = now
    const currentTime = this.now()
    this.state = {
      version: 1,
      monitoringStartedAt: currentTime,
      lastViewedAt: currentTime,
      buckets: [],
    }
    this.load()
    this.prune(currentTime)
  }

  recordSnapshot(onlinePlayers: number, tps?: number, timestamp: number = this.now()): void {
    const bucket = this.getOrCreateBucket(timestamp)
    bucket.onlinePeak = Math.max(bucket.onlinePeak, Math.max(0, Math.floor(onlinePlayers)))
    if (tps !== undefined && Number.isFinite(tps)) {
      const normalizedTps = Math.max(0, Math.min(20, tps))
      bucket.minTps = bucket.minTps === null ? normalizedTps : Math.min(bucket.minTps, normalizedTps)
    }
    this.persist(timestamp)
  }

  recordCaseOpened(timestamp: number = this.now()): void {
    this.getOrCreateBucket(timestamp).casesOpened++
    this.persist(timestamp)
  }

  recordAutomaticMeasure(timestamp: number = this.now()): void {
    this.getOrCreateBucket(timestamp).automaticMeasures++
    this.persist(timestamp)
  }

  getOfflineSummary(timestamp: number = this.now()): OfflineSummary {
    const from = this.state.lastViewedAt
    const relevant = this.state.buckets.filter(bucket => bucket.startedAt + BUCKET_MS > from)
    const minTpsValues = relevant
      .map(bucket => bucket.minTps)
      .filter((value): value is number => value !== null)
    const summary: OfflineSummary = {
      from,
      to: timestamp,
      durationMs: Math.max(0, timestamp - from),
      onlinePeak: relevant.reduce((peak, bucket) => Math.max(peak, bucket.onlinePeak), 0),
      casesOpened: relevant.reduce((total, bucket) => total + bucket.casesOpened, 0),
      automaticMeasures: relevant.reduce((total, bucket) => total + bucket.automaticMeasures, 0),
      minTps: minTpsValues.length > 0 ? Math.min(...minTpsValues) : null,
      hasImportantActivity: false,
    }
    summary.hasImportantActivity = summary.casesOpened > 0
      || summary.automaticMeasures > 0
      || (summary.minTps !== null && summary.minTps < 18)
    return summary
  }

  acknowledgeViewed(timestamp: number = this.now()): OfflineSummary {
    const summary = this.getOfflineSummary(timestamp)
    this.state.lastViewedAt = Math.max(this.state.lastViewedAt, timestamp)
    this.state.buckets = []
    this.persist(timestamp)
    return summary
  }

  getLastViewedAt(): number {
    return this.state.lastViewedAt
  }

  private getOrCreateBucket(timestamp: number): ActivityBucket {
    const startedAt = Math.floor(timestamp / BUCKET_MS) * BUCKET_MS
    let bucket = this.state.buckets.find(item => item.startedAt === startedAt)
    if (!bucket) {
      bucket = { startedAt, onlinePeak: 0, minTps: null, casesOpened: 0, automaticMeasures: 0 }
      this.state.buckets.push(bucket)
      this.state.buckets.sort((a, b) => a.startedAt - b.startedAt)
    }
    return bucket
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<OperationsState>
      if (parsed.version === 1
        && typeof parsed.monitoringStartedAt === 'number'
        && typeof parsed.lastViewedAt === 'number'
        && Array.isArray(parsed.buckets)) {
        this.state = {
          version: 1,
          monitoringStartedAt: parsed.monitoringStartedAt,
          lastViewedAt: parsed.lastViewedAt,
          buckets: parsed.buckets.filter(this.isValidBucket),
        }
      }
    } catch (error) {
      console.error('[OperationsSummaryManager] Failed to load summary:', error)
    }
  }

  private readonly isValidBucket = (value: unknown): value is ActivityBucket => {
    if (!value || typeof value !== 'object') return false
    const bucket = value as Partial<ActivityBucket>
    return typeof bucket.startedAt === 'number'
      && typeof bucket.onlinePeak === 'number'
      && (bucket.minTps === null || typeof bucket.minTps === 'number')
      && typeof bucket.casesOpened === 'number'
      && typeof bucket.automaticMeasures === 'number'
  }

  private prune(timestamp: number): void {
    const cutoff = timestamp - RETENTION_MS
    this.state.buckets = this.state.buckets.filter(bucket => bucket.startedAt + BUCKET_MS >= cutoff)
  }

  private persist(timestamp: number): void {
    this.prune(timestamp)
    writeFileSync(this.tempPath, JSON.stringify(this.state, null, 2), 'utf-8')
    renameSync(this.tempPath, this.filePath)
  }
}
