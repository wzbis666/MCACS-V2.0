import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SpigotAction } from '../contracts/index.js'
import type { InvestigationCase } from './investigation-case-manager.js'

const FIRST_COOLDOWN_MS = 10 * 60 * 1000
const REPEAT_COOLDOWN_MS = 30 * 60 * 1000

interface ContainmentState {
  playerId: string
  count: number
  lastTriggeredAt: number
  cooldownUntil: number
  caseId: string
}

export interface SoftContainmentDecision {
  action: SpigotAction
  cooldownUntil: number
  repeat: boolean
  reason: string
}

export class SoftContainmentManager {
  private readonly filePath: string
  private states = new Map<string, ContainmentState>()

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'soft-containment.json')
    this.load()
  }

  evaluate(investigationCase: InvestigationCase, timestamp: number = Date.now()): SoftContainmentDecision | null {
    const independentHighSignals = new Set(
      investigationCase.signals.filter(signal => signal.confidence === 'high').map(signal => signal.cheatType),
    ).size
    if (investigationCase.riskLevel !== 'critical'
      || investigationCase.riskScore < 85
      || investigationCase.confidenceScore < 85
      || independentHighSignals < 2) return null

    const previous = this.states.get(investigationCase.playerId)
    if (previous && timestamp < previous.cooldownUntil) return null
    const repeat = (previous?.count ?? 0) > 0
    const cooldownMs = repeat ? REPEAT_COOLDOWN_MS : FIRST_COOLDOWN_MS
    const reason = `双高独立证据软处置：风险 ${investigationCase.riskScore}，可信度 ${investigationCase.confidenceScore}，${independentHighSignals} 类独立高可信信号`
    const state: ContainmentState = {
      playerId: investigationCase.playerId,
      count: (previous?.count ?? 0) + 1,
      lastTriggeredAt: timestamp,
      cooldownUntil: timestamp + cooldownMs,
      caseId: investigationCase.id,
    }
    this.states.set(investigationCase.playerId, state)
    this.save()
    return {
      action: {
        type: 'kick',
        actionId: `soft-${randomUUID().slice(0, 8)}`,
        playerId: investigationCase.playerId,
        reason,
        duration: repeat ? '30m cooldown' : '10m cooldown',
      },
      cooldownUntil: state.cooldownUntil,
      repeat,
      reason,
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (Array.isArray(parsed)) {
        for (const state of parsed as ContainmentState[]) {
          if (state && typeof state.playerId === 'string') this.states.set(state.playerId, state)
        }
      }
    } catch (error) {
      console.error('[SoftContainmentManager] Failed to load state:', error)
    }
  }

  private save(): void {
    const tempPath = `${this.filePath}.tmp`
    writeFileSync(tempPath, JSON.stringify([...this.states.values()], null, 2), 'utf-8')
    renameSync(tempPath, this.filePath)
  }
}
