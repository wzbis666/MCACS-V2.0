// @desc RouteManager — simplified waypoint-based movement and station assignment
//
// Provides direct NPC movement (no A* pathfinding) and monitor station
// destination scoring for the anti-cheat monitoring system.

import type { GameEvent } from './game-event.js'
import { MONITOR_STATIONS, MONITOR_STATION_Y, PLAZA_CENTER, SPAWN_ORIGIN } from './data/route-config.js'

export interface Position {
  x: number
  y: number
  z: number
}

export class RouteManager {
  private readonly emitFn: (events: GameEvent[]) => void

  constructor(emitFn: (events: GameEvent[]) => void) {
    this.emitFn = emitFn
  }

  moveNpcAndWait(npcId: string, target: Position): void {
    this.emitFn([{
      type: 'npc_move_to',
      npcId,
      target: { x: target.x, y: target.y, z: target.z },
    }])
  }

  moveToStation(npcId: string, stationId: string): boolean {
    const station = MONITOR_STATIONS[stationId]
    if (!station) return false

    this.moveNpcAndWait(npcId, {
      x: station.x,
      y: MONITOR_STATION_Y,
      z: station.z,
    })
    return true
  }

  moveToSpawn(npcId: string): void {
    this.moveNpcAndWait(npcId, {
      x: SPAWN_ORIGIN.x,
      y: MONITOR_STATION_Y,
      z: SPAWN_ORIGIN.z,
    })
  }

  moveToPlaza(npcId: string): void {
    this.moveNpcAndWait(npcId, {
      x: PLAZA_CENTER.x,
      y: MONITOR_STATION_Y,
      z: PLAZA_CENTER.z,
    })
  }

  findNearestStation(fromX: number, fromZ: number): string | null {
    let nearestId: string | null = null
    let nearestDist = Infinity

    for (const [id, pos] of Object.entries(MONITOR_STATIONS)) {
      const dist = Math.abs(fromX - pos.x) + Math.abs(fromZ - pos.z)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestId = id
      }
    }

    return nearestId
  }

  getStationPosition(stationId: string): Position | null {
    const station = MONITOR_STATIONS[stationId]
    if (!station) return null
    return { x: station.x, y: MONITOR_STATION_Y, z: station.z }
  }

  getSpawnPosition(): Position {
    return { x: SPAWN_ORIGIN.x, y: MONITOR_STATION_Y, z: SPAWN_ORIGIN.z }
  }

  getPlazaPosition(): Position {
    return { x: PLAZA_CENTER.x, y: MONITOR_STATION_Y, z: PLAZA_CENTER.z }
  }
}
