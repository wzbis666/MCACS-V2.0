import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheatType, Confidence, Evidence, NearbyOreContext } from '../contracts/index.js'
import { analyzeXRay, type XRayAnalysis } from './xray-analyzer.js'
import { normalizePhysics, type PhysicsAnalysis } from './physics-normalizer.js'
import { analyzeScaffold, type ScaffoldAnalysis } from './scaffold-analyzer.js'

const BUFFER_WINDOW_MS = 20_000
const POST_CASE_WINDOW_MS = 5_000
const MAX_EVIDENCE_BYTES = 100 * 1024

export interface EvidenceContext {
  tps: number
  ping: number | null
  statusEffects: string[]
  exemptions: string[]
}

interface BaseSemanticEvent extends EvidenceContext {
  timestamp: number
}

export type SemanticEvidenceEvent =
  | (BaseSemanticEvent & { type: 'movement'; x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean })
  | (BaseSemanticEvent & { type: 'combat'; victimId: string; distance: number; angle: number; cps: number; hasLos: boolean })
  | (BaseSemanticEvent & { type: 'block'; action: 'break' | 'place'; blockType: string; speed: number; x?: number; y?: number; z?: number; exposedFaces?: number; nearbyOres?: NearbyOreContext[]; yaw?: number; pitch?: number; placedFace?: string; placementIntervalMs?: number })
  | (BaseSemanticEvent & { type: 'action'; action: string; state: boolean })
  | (BaseSemanticEvent & { type: 'detection'; cheatType: CheatType; confidence: Confidence; evidence: Evidence[] })

export interface CaseEvidenceSnapshot {
  version: 1
  caseId: string
  playerId: string
  capturedAt: number
  windowStart: number
  windowEnd: number
  complete: boolean
  events: SemanticEvidenceEvent[]
  byteSize: number
  xrayAnalysis?: XRayAnalysis | null
  physicsAnalysis?: PhysicsAnalysis | null
  scaffoldAnalysis?: ScaffoldAnalysis | null
}

interface PendingCapture {
  snapshot: CaseEvidenceSnapshot
  captureUntil: number
}

/** Maintains compact semantic history and freezes a bounded case replay snapshot. */
export class EvidenceBufferManager {
  private readonly evidenceDir: string
  private readonly buffers = new Map<string, SemanticEvidenceEvent[]>()
  private readonly movementSequence = new Map<string, number>()
  private readonly investigatingPlayers = new Set<string>()
  private readonly pendingCaptures = new Map<string, PendingCapture>()

  constructor(dataDir: string) {
    this.evidenceDir = join(dataDir, 'case-evidence')
    mkdirSync(this.evidenceDir, { recursive: true })
  }

  setInvestigating(playerId: string, investigating: boolean): void {
    if (investigating) this.investigatingPlayers.add(playerId)
    else this.investigatingPlayers.delete(playerId)
  }

  recordMovement(
    playerId: string,
    movement: Omit<Extract<SemanticEvidenceEvent, { type: 'movement' }>, keyof BaseSemanticEvent | 'type'>,
    context: EvidenceContext,
    timestamp: number,
  ): void {
    const sequence = (this.movementSequence.get(playerId) ?? 0) + 1
    this.movementSequence.set(playerId, sequence)
    if (!this.investigatingPlayers.has(playerId) && sequence % 3 !== 0) return
    this.append(playerId, { type: 'movement', timestamp, ...context, ...movement })
  }

  recordEvent(playerId: string, event: SemanticEvidenceEvent): void {
    this.append(playerId, event)
  }

  beginCase(caseId: string, playerId: string, timestamp: number): CaseEvidenceSnapshot {
    this.setInvestigating(playerId, true)
    const events = (this.buffers.get(playerId) ?? [])
      .filter(event => event.timestamp >= timestamp - BUFFER_WINDOW_MS && event.timestamp <= timestamp)
    const snapshot = this.boundSnapshot({
      version: 1,
      caseId,
      playerId,
      capturedAt: timestamp,
      windowStart: timestamp - BUFFER_WINDOW_MS,
      windowEnd: timestamp + POST_CASE_WINDOW_MS,
      complete: false,
      events: structuredClone(events),
      byteSize: 0,
    })
    this.pendingCaptures.set(caseId, { snapshot, captureUntil: timestamp + POST_CASE_WINDOW_MS })
    this.writeSnapshot(snapshot)
    return structuredClone(snapshot)
  }

  getCaseEvidence(caseId: string, timestamp: number = Date.now()): CaseEvidenceSnapshot | null {
    this.flushDue(timestamp)
    const pending = this.pendingCaptures.get(caseId)
    if (pending) return structuredClone(this.boundSnapshot(pending.snapshot))
    const filePath = this.getFilePath(caseId)
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as CaseEvidenceSnapshot
    } catch (error) {
      console.error(`[EvidenceBufferManager] Failed to load evidence ${caseId}:`, error)
      return null
    }
  }

  flushAll(timestamp: number = Date.now()): void {
    for (const pending of this.pendingCaptures.values()) {
      pending.snapshot.complete = timestamp >= pending.captureUntil
      this.writeSnapshot(this.boundSnapshot(pending.snapshot))
    }
    for (const [caseId, pending] of this.pendingCaptures) {
      if (pending.snapshot.complete) this.pendingCaptures.delete(caseId)
    }
  }

  clearPlayer(playerId: string): void {
    this.flushAll()
    this.buffers.delete(playerId)
    this.movementSequence.delete(playerId)
    this.investigatingPlayers.delete(playerId)
  }

  private append(playerId: string, event: SemanticEvidenceEvent): void {
    const buffer = this.buffers.get(playerId) ?? []
    buffer.push(event)
    const cutoff = event.timestamp - BUFFER_WINDOW_MS
    this.buffers.set(playerId, buffer.filter(item => item.timestamp >= cutoff))

    for (const pending of this.pendingCaptures.values()) {
      if (pending.snapshot.playerId !== playerId) continue
      if (event.timestamp > pending.snapshot.capturedAt && event.timestamp <= pending.captureUntil) {
        pending.snapshot.events.push(structuredClone(event))
      }
    }
    this.flushDue(event.timestamp)
  }

  private flushDue(timestamp: number): void {
    for (const [caseId, pending] of this.pendingCaptures) {
      if (timestamp < pending.captureUntil) continue
      pending.snapshot.complete = true
      this.writeSnapshot(this.boundSnapshot(pending.snapshot))
      this.pendingCaptures.delete(caseId)
    }
  }

  private boundSnapshot(snapshot: CaseEvidenceSnapshot): CaseEvidenceSnapshot {
    snapshot.physicsAnalysis = normalizePhysics(snapshot.events
      .filter((event): event is Extract<SemanticEvidenceEvent, { type: 'movement' }> => event.type === 'movement')
      .map(event => ({
        timestamp: event.timestamp, vx: event.vx, vy: event.vy, vz: event.vz,
        tps: event.tps, ping: event.ping, statusEffects: event.statusEffects, exemptions: event.exemptions,
      })))
    snapshot.scaffoldAnalysis = analyzeScaffold(snapshot.events
      .filter((event): event is Extract<SemanticEvidenceEvent, { type: 'block' }> => event.type === 'block'
        && event.action === 'place' && event.x !== undefined && event.y !== undefined && event.z !== undefined)
      .map(event => ({
        timestamp: event.timestamp, x: event.x!, y: event.y!, z: event.z!,
        yaw: event.yaw ?? 0, pitch: event.pitch ?? 0, placedFace: event.placedFace ?? 'UNKNOWN',
        placementIntervalMs: event.placementIntervalMs ?? 0,
      })))
    const miningSamples = snapshot.events
      .filter((event): event is Extract<SemanticEvidenceEvent, { type: 'block' }> => event.type === 'block'
        && event.action === 'break'
        && event.x !== undefined && event.y !== undefined && event.z !== undefined)
      .map(event => ({
        timestamp: event.timestamp,
        blockType: event.blockType,
        x: event.x!, y: event.y!, z: event.z!,
        exposedFaces: event.exposedFaces ?? 0,
        nearbyOres: event.nearbyOres ?? [],
      }))
    snapshot.xrayAnalysis = analyzeXRay(miningSamples)
    let events = snapshot.events.slice()
    let bounded = { ...snapshot, events, byteSize: 0 }
    let serialized = JSON.stringify(bounded)

    if (Buffer.byteLength(serialized, 'utf-8') > MAX_EVIDENCE_BYTES) {
      const essential = events.filter(event => event.type !== 'movement')
      const movements = events.filter(event => event.type === 'movement')
      let stride = 2
      do {
        events = [...essential, ...movements.filter((_, index) => index % stride === 0)]
          .sort((a, b) => a.timestamp - b.timestamp)
        bounded = { ...snapshot, events, byteSize: 0 }
        serialized = JSON.stringify(bounded)
        stride++
      } while (Buffer.byteLength(serialized, 'utf-8') > MAX_EVIDENCE_BYTES && stride <= movements.length + 1)
    }

    bounded.byteSize = Buffer.byteLength(JSON.stringify({ ...bounded, byteSize: 0 }), 'utf-8')
    snapshot.events = bounded.events
    snapshot.byteSize = bounded.byteSize
    return snapshot
  }

  private writeSnapshot(snapshot: CaseEvidenceSnapshot): void {
    const bounded = this.boundSnapshot(snapshot)
    const filePath = this.getFilePath(snapshot.caseId)
    const tempPath = `${filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(bounded), 'utf-8')
    renameSync(tempPath, filePath)
  }

  private getFilePath(caseId: string): string {
    const safeId = caseId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return join(this.evidenceDir, `${safeId}.json`)
  }
}
