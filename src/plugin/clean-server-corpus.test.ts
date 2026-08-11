import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlayerState } from '../contracts/index.js'
import { checkSpeed, initSpeedThresholdService, shutdownSpeedThresholdService, updateTPS, type PlayerMovementState, type RecentData } from './rule-engine.js'

const state: PlayerState = {
  playerId: 'clean-player', name: 'CleanPlayer', ip: '127.0.0.1', gameMode: 'survival', phase: 'normal',
  x: 0, y: 64, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, cps: 0, hitRate: 0,
  cheatRecordCount: 0, lastAlertTime: 0, monitoringEndTime: 0,
}

const CLEAN_CORPUS = [
  { name: 'normal walk', speed: 4.2, actions: [] },
  { name: 'sprint', speed: 5.5, actions: [{ action: 'sprinting', state: true }] },
  { name: 'speed one sprint', speed: 6.5, actions: [{ action: 'sprinting', state: true }, { action: 'speed_effect', state: true }] },
  { name: 'boat travel', speed: 16, actions: [{ action: 'vehicle_boat', state: true }, { action: 'vehicle', state: true }] },
]

describe('clean survival server false-positive corpus', () => {
  beforeEach(() => { initSpeedThresholdService(); updateTPS(20) })
  afterEach(() => shutdownSpeedThresholdService())

  for (const sample of CLEAN_CORPUS) {
    it(`does not flag ${sample.name}`, () => {
      const now = Date.now()
      const data: RecentData = {
        movements: Array.from({ length: 30 }, (_, index) => ({ x: index, y: 64, z: 0, vx: sample.speed, vy: 0, vz: 0, onGround: true, timestamp: now - (30 - index) * 50 })),
        combats: [], blocks: [],
        actions: sample.actions.map(action => ({ ...action, timestamp: now - 1_000 })),
      }
      const moveState: PlayerMovementState = {
        jumpPhase: 0, airStartMs: 0, lastVy: 0, lastGroundY: 64, speedAdvantage: 0,
        lastValidX: 0, lastValidY: 64, lastValidZ: 0, teleportGraceTicks: 0, knockbackGraceTicks: 0,
        lastProcessedMoveTimestamp: 0,
      }
      expect(checkSpeed(state, data, moveState)).toBeNull()
    })
  }
})
