// BannedNpcStore — persists banned NPC states to survive server restarts
// When a player is banned and leaves the server, their NPC state must be
// preserved so that the frontend can restore the NPC model after page refresh
// or server restart.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PlayerPhase, CheatType } from '../contracts/index.js'

export interface BannedNpcState {
  playerId: string
  npcId: string
  name: string
  phase: PlayerPhase
  spawnX: number
  spawnZ: number
  buildingKey: string | null
  cheatType: CheatType | null
  bannedAt: number
  reason: string
  duration: string
}

export class BannedNpcStore {
  private states = new Map<string, BannedNpcState>()  // keyed by playerId
  private filePath: string

  constructor(dataDir: string) {
    this.filePath = `${dataDir}/banned-npcs.json`
    this.load()
  }

  /** Save a banned NPC state */
  add(state: BannedNpcState): void {
    this.states.set(state.playerId, state)
    this.persist()
  }

  /** Remove a banned NPC state (when player is unbanned) */
  remove(playerId: string): void {
    this.states.delete(playerId)
    this.persist()
  }

  /** Get a banned NPC state by playerId */
  get(playerId: string): BannedNpcState | undefined {
    return this.states.get(playerId)
  }

  /** Get all banned NPC states */
  getAll(): BannedNpcState[] {
    return [...this.states.values()]
  }

  /** Check if a player has a persisted banned NPC state */
  has(playerId: string): boolean {
    return this.states.has(playerId)
  }

  /** Clean up expired bans */
  cleanup(activePlayerIds: Set<string>): number {
    let removed = 0
    for (const [playerId, state] of this.states) {
      // Remove if player is back online (they've been unbanned and rejoined)
      if (activePlayerIds.has(playerId)) {
        this.states.delete(playerId)
        removed++
      }
    }
    if (removed > 0) this.persist()
    return removed
  }

  private load(): void {
    if (!existsSync(this.filePath)) return

    try {
      const content = readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(content) as BannedNpcState[]
      for (const state of data) {
        this.states.set(state.playerId, state)
      }
      console.log(`[BannedNpcStore] Loaded ${this.states.size} banned NPC states`)
    } catch (err) {
      console.warn('[BannedNpcStore] Failed to load:', err)
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const data = [...this.states.values()]
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[BannedNpcStore] Failed to persist:', err)
    }
  }
}
