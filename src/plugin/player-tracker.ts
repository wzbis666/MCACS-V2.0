import type { PlayerState, PlayerPhase } from '../contracts/index.js'

const STATION_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

export class PlayerTracker {
  private playerToNpc = new Map<string, string>()
  private npcToPlayer = new Map<string, string>()
  private playerStates = new Map<string, PlayerState>()
  private stationPool = new Map<string, string | null>()
  private npcCounter = 0

  constructor() {
    for (const id of STATION_IDS) {
      this.stationPool.set(id, null)
    }
  }

  registerPlayer(playerId: string, name: string, ip: string, gameMode: string): PlayerState {
    const npcId = `npc_${++this.npcCounter}`
    this.playerToNpc.set(playerId, npcId)
    this.npcToPlayer.set(npcId, playerId)

    const state: PlayerState = {
      playerId,
      name,
      ip,
      gameMode,
      phase: 'normal',
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      cps: 0,
      hitRate: 0,
      cheatRecordCount: 0,
      lastAlertTime: 0,
      monitoringEndTime: 0,
    }

    this.playerStates.set(playerId, state)
    return state
  }

  removePlayer(playerId: string): void {
    const state = this.playerStates.get(playerId)
    if (state?.stationId) {
      this.releaseStation(state.stationId)
    }

    const npcId = this.playerToNpc.get(playerId)
    if (npcId) {
      this.npcToPlayer.delete(npcId)
    }
    this.playerToNpc.delete(playerId)
    this.playerStates.delete(playerId)
  }

  updatePosition(
    playerId: string,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    onGround: boolean,
  ): void {
    const state = this.playerStates.get(playerId)
    if (!state) return
    state.x = x
    state.y = y
    state.z = z
    state.vx = vx
    state.vy = vy
    state.vz = vz
    state.onGround = onGround
  }

  updatePhase(playerId: string, phase: PlayerPhase): void {
    const state = this.playerStates.get(playerId)
    if (!state) return
    state.phase = phase
  }

  allocateStation(playerId: string): string | null {
    for (const [stationId, occupant] of this.stationPool) {
      if (occupant === null) {
        this.stationPool.set(stationId, playerId)
        const state = this.playerStates.get(playerId)
        if (state) state.stationId = stationId
        return stationId
      }
    }
    return null
  }

  releaseStation(stationId: string): void {
    const playerId = this.stationPool.get(stationId)
    if (playerId) {
      const state = this.playerStates.get(playerId)
      if (state) state.stationId = undefined
    }
    this.stationPool.set(stationId, null)
  }

  getPlayerState(playerId: string): PlayerState | undefined {
    return this.playerStates.get(playerId)
  }

  resolveNpcId(playerId: string): string | undefined {
    return this.playerToNpc.get(playerId)
  }

  resolvePlayerId(npcId: string): string | undefined {
    return this.npcToPlayer.get(npcId)
  }

  getAllPlayerStates(): PlayerState[] {
    return Array.from(this.playerStates.values())
  }
}
