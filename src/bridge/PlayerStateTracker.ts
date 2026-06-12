// @desc Bidirectional playerId ↔ npcId mapping and monitor station allocation
import type { PlayerPhase } from '../contracts/anticheat-events.js'

export interface SpawnPosition {
  x: number
  y: number
  z: number
}

export interface PlayerNPCState {
  playerId: string
  npcId: string
  name: string
  phase: PlayerPhase
  spawn: SpawnPosition
  stationId?: string
}

const STATION_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

/** Maintains bidirectional playerId ↔ npcId mappings and allocates monitor station slots */
export class PlayerStateTracker {
  private playerToNpc = new Map<string, string>()
  private npcToPlayer = new Map<string, string>()
  private playerStates = new Map<string, PlayerNPCState>()
  private usedStations = new Set<string>()

  /** Resolve a playerId to its corresponding npcId */
  resolveNpcId(playerId: string): string | undefined {
    return this.playerToNpc.get(playerId)
  }

  /** Resolve an npcId to its corresponding playerId */
  resolvePlayerId(npcId: string): string | undefined {
    return this.npcToPlayer.get(npcId)
  }

  /** Register a bidirectional playerId ↔ npcId mapping with name and spawn position */
  registerMapping(playerId: string, npcId: string, name: string, spawn: SpawnPosition): void {
    this.playerToNpc.set(playerId, npcId)
    this.npcToPlayer.set(npcId, playerId)
    this.playerStates.set(npcId, { playerId, npcId, name, phase: 'normal', spawn })
  }

  /** Remove a mapping and associated state by playerId */
  removeMapping(playerId: string): void {
    const npcId = this.playerToNpc.get(playerId)
    if (npcId) {
      const state = this.playerStates.get(npcId)
      if (state?.stationId) {
        this.usedStations.delete(state.stationId)
      }
      this.npcToPlayer.delete(npcId)
      this.playerStates.delete(npcId)
    }
    this.playerToNpc.delete(playerId)
  }

  /** Remove a mapping by npcId */
  removeMappingByNpcId(npcId: string): void {
    const playerId = this.npcToPlayer.get(npcId)
    if (playerId) {
      this.removeMapping(playerId)
    }
  }

  /** Allocate the next available monitor station ID, or null if all in use */
  allocateStation(): string | null {
    for (const id of STATION_IDS) {
      if (!this.usedStations.has(id)) {
        this.usedStations.add(id)
        return id
      }
    }
    return null
  }

  /** Release a monitor station back to the pool */
  releaseStation(stationId: string): void {
    this.usedStations.delete(stationId)
  }

  /** Update the phase for a player's NPC (accepts playerId) */
  updatePhase(playerId: string, phase: PlayerPhase): void {
    const npcId = this.playerToNpc.get(playerId)
    if (!npcId) return
    const state = this.playerStates.get(npcId)
    if (state) state.phase = phase
  }

  /** Get the current phase for a player */
  getPhase(playerId: string): PlayerPhase | undefined {
    const npcId = this.playerToNpc.get(playerId)
    if (!npcId) return undefined
    return this.playerStates.get(npcId)?.phase
  }

  /** Get the station assigned to an NPC */
  getStationForNpc(npcId: string): string | undefined {
    return this.playerStates.get(npcId)?.stationId
  }

  /** Assign a station to an NPC */
  setStationForNpc(npcId: string, stationId: string): void {
    let state = this.playerStates.get(npcId)
    if (!state) {
      state = { npcId, playerId: this.npcToPlayer.get(npcId) ?? '', name: '', phase: 'normal', spawn: { x: 0, y: 0, z: 0 } }
      this.playerStates.set(npcId, state)
    }
    state.stationId = stationId
  }

  /** Get all NPC states */
  getAllPlayerStates(): PlayerNPCState[] {
    return [...this.playerStates.values()]
  }

  /** Reset all mappings, states, and station allocations */
  clear(): void {
    this.playerToNpc.clear()
    this.npcToPlayer.clear()
    this.playerStates.clear()
    this.usedStations.clear()
  }
}
