import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { SpeedThresholdService } from './speed-threshold-service.js'
import { checkSpeed, checkFly, initSpeedThresholdService, shutdownSpeedThresholdService, SENSITIVITY_PRESETS } from './rule-engine.js'
import type { PlayerMovementState } from './rule-engine.js'
import type { PlayerState, CheatDetection } from '../contracts/index.js'
import type { RecentData } from './rule-engine.js'

// ── 辅助函数 ──

function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerId: 'test-player',
    name: 'TestPlayer',
    ip: '127.0.0.1',
    gameMode: 'survival',
    phase: 'active' as any,
    x: 0, y: 64, z: 0,
    vx: 0, vy: 0, vz: 0,
    onGround: true,
    cps: 0,
    hitRate: 0,
    cheatRecordCount: 0,
    lastAlertTime: 0,
    monitoringEndTime: 0,
    ...overrides,
  }
}

function makeMovement(vx: number, vz: number, vy = 0, onGround = true, timestamp?: number) {
  return {
    x: 0, y: 64, z: 0,
    vx, vy, vz,
    onGround,
    timestamp: timestamp ?? Date.now(),
  }
}

function makeRecentData(
  movements: Array<{ vx: number; vz: number; vy?: number; onGround?: boolean; timestamp?: number }> = [],
  actions: Array<{ action: string; state: boolean }> = [],
): RecentData {
  const now = Date.now()
  return {
    movements: movements.map((m, i) => makeMovement(
      m.vx, m.vz, m.vy ?? 0, m.onGround ?? true,
      m.timestamp ?? now - (movements.length - i) * 250,
    )),
    combats: [],
    blocks: [],
    actions: actions.map(a => ({ ...a, timestamp: now })),
  }
}

function makeMoveState(overrides: Partial<PlayerMovementState> = {}): PlayerMovementState {
  return {
    jumpPhase: 0,        // GROUND
    airStartMs: 0,
    lastVy: 0,
    lastGroundY: 64,
    speedAdvantage: 0,
    lastValidX: 0,
    lastValidY: 64,
    lastValidZ: 0,
    teleportGraceTicks: 0,
    knockbackGraceTicks: 0,
    lastProcessedMoveTimestamp: 0,
    ...overrides,
  }
}

const BALANCED_CONFIG = SENSITIVITY_PRESETS.balanced

// ── 测试 ──

describe('SpeedThresholdService — 阈值优化', () => {
  let service: SpeedThresholdService

  beforeEach(() => {
    service = new SpeedThresholdService({ cachePath: '/tmp/acs-test-thresholds.json' })
  })

  it('步行阈值应大于理论步行速度 4.317 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.walk).toBeGreaterThan(4.317)
  })

  it('疾跑阈值应大于理论疾跑速度 5.612 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.sprint).toBeGreaterThan(5.612)
  })

  it('疾跑+跳跃阈值应大于理论疾跑跳跃速度 ~7.0 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.sprintJump).toBeGreaterThan(7.0)
  })

  it('速度I+疾跑阈值应大于理论速度 6.73 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.speed1Sprint).toBeGreaterThan(6.73)
  })

  it('速度II+疾跑阈值应大于理论速度 7.86 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.speed2Sprint).toBeGreaterThan(7.86)
  })

  it('船阈值应大于蓝冰船速度 16.6 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.boat).toBeGreaterThan(16.6)
  })

  it('矿车阈值应大于充能轨速度 8.0 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.minecart).toBeGreaterThan(8.0)
  })

  it('骑乘阈值应大于最快马速度 ~14.5 blocks/s', () => {
    const t = service.getThresholds()
    expect(t.mount).toBeGreaterThan(14.5)
  })

  it('垂直上升阈值应大于正常跳跃初速度', () => {
    // 正常跳跃 vy ≈ 8.4 blocks/s（0.42 b/t × 20）
    const t = service.getThresholds()
    expect(t.verticalClimb).toBeGreaterThan(0.8)
  })

  it('getHorizontalThreshold: 疾跑+空中应使用 sprintJump 阈值', () => {
    const sprintThreshold = service.getHorizontalThreshold({ isSprinting: true, isOnGround: true })
    const sprintJumpThreshold = service.getHorizontalThreshold({ isSprinting: true, isOnGround: false })
    expect(sprintJumpThreshold).toBeGreaterThan(sprintThreshold)
  })

  it('getHorizontalThreshold: 激流状态返回 Infinity', () => {
    const threshold = service.getHorizontalThreshold({ isRiptiding: true })
    expect(threshold).toBe(Infinity)
  })

  it('getHorizontalThreshold: 船载具使用 boat 阈值', () => {
    const threshold = service.getHorizontalThreshold({ isInVehicle: true, vehicleType: 'boat' })
    expect(threshold).toEqual(service.getThresholds().boat)
  })

  it('getHorizontalThreshold: 矿车载具使用 minecart 阈值', () => {
    const threshold = service.getHorizontalThreshold({ isInVehicle: true, vehicleType: 'minecart' })
    expect(threshold).toEqual(service.getThresholds().minecart)
  })

  it('getHorizontalThreshold: 骑乘使用 mount 阈值', () => {
    const threshold = service.getHorizontalThreshold({ isInVehicle: true, vehicleType: 'mount' })
    expect(threshold).toEqual(service.getThresholds().mount)
  })
})

describe('checkSpeed — 误判防护', () => {
  beforeEach(() => {
    initSpeedThresholdService({ cachePath: '/tmp/acs-test-rule-thresholds.json' })
  })

  afterEach(() => {
    shutdownSpeedThresholdService()
  })

  it('正常步行 (4.3 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 3.0, vz: 3.0 }],  // sqrt(9+9) ≈ 4.24
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('正常疾跑 (5.6 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 4.0, vz: 4.0 }],  // sqrt(16+16) ≈ 5.66
      [{ action: 'sprinting', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('疾跑+跳跃 (7.0 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 5.0, vz: 5.0, onGround: false }],  // sqrt(25+25) ≈ 7.07
      [{ action: 'sprinting', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('速度I+疾跑 (6.73 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 4.8, vz: 4.8 }],  // sqrt(23.04+23.04) ≈ 6.79
      [
        { action: 'sprinting', state: true },
        { action: 'speed_effect', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('速度II+疾跑 (7.86 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 5.6, vz: 5.6 }],  // sqrt(31.36+31.36) ≈ 7.92
      [
        { action: 'sprinting', state: true },
        { action: 'speed_effect_2', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('乘船 (8.4 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 6.0, vz: 6.0 }],  // sqrt(36+36) ≈ 8.49
      [
        { action: 'vehicle', state: true },
        { action: 'vehicle_boat', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('蓝冰船 (16.6 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 12.0, vz: 12.0 }],  // sqrt(144+144) ≈ 16.97
      [
        { action: 'vehicle', state: true },
        { action: 'vehicle_boat', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('骑马 (14.5 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 10.0, vz: 10.0 }],  // sqrt(100+100) ≈ 14.14
      [
        { action: 'vehicle', state: true },
        { action: 'vehicle_mount', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('矿车 (8.0 blocks/s) 不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 5.7, vz: 5.7 }],  // sqrt(32.49+32.49) ≈ 8.06
      [
        { action: 'vehicle', state: true },
        { action: 'vehicle_minecart', state: true },
      ],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('激流三叉戟状态不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 50.0, vz: 50.0 }],  // 极高速度
      [{ action: 'riptiding', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('鞘翅飞行不应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 30.0, vz: 30.0, onGround: false }],  // sqrt(900+900) ≈ 42.4
      [{ action: 'elytra_flying', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('明显作弊速度 (20 blocks/s 步行) 应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 14.0, vz: 14.0 }],  // sqrt(196+196) ≈ 19.8
      // 无任何 buff/载具状态
    )
    const result = checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)
    expect(result).not.toBeNull()
    expect(result!.cheatType).toBe('speed')
    expect(result!.confidence).toBe('high')
  })

  it('中等作弊速度 (8 blocks/s 步行) 应触发检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 5.7, vz: 5.7 }],  // sqrt(32.49+32.49) ≈ 8.06
      // 无疾跑状态 → 使用 walk 阈值 5.6
    )
    const result = checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)
    expect(result).not.toBeNull()
    expect(result!.cheatType).toBe('speed')
  })

  it('创造/旁观模式不触发检测', () => {
    const state = makePlayerState({ gameMode: 'creative' })
    const data = makeRecentData([{ vx: 50.0, vz: 50.0 }])
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('冰面疾跑 (7.5 blocks/s) 使用 sprintJump 阈值不应误判', () => {
    // 冰面疾跑时玩家通常不在地面（跳跃加速），sprintJump 阈值应覆盖
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 5.3, vz: 5.3, onGround: false }],  // sqrt(28.09+28.09) ≈ 7.49
      [{ action: 'sprinting', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })
})

describe('checkFly — 水中上浮误判防护', () => {
  beforeEach(() => {
    initSpeedThresholdService({ cachePath: '/tmp/acs-test-fly-water-thresholds.json' })
  })

  afterEach(() => {
    shutdownSpeedThresholdService()
  })

  it('水中上浮不应触发飞行检测', () => {
    const state = makePlayerState()
    // 水中上浮 vy ≈ 4.32 blocks/s (0.216 b/t × 20)，空中时间很长
    const data = makeRecentData(
      [
        { vx: 0, vz: 0, vy: 4.0, onGround: false },
        { vx: 0, vz: 0, vy: 4.2, onGround: false },
        { vx: 0, vz: 0, vy: 3.8, onGround: false },
      ],
      [{ action: 'in_water', state: true }],
    )
    // airStartMs = 3秒前，表示已在空中3秒
    const moveState = makeMoveState({ airStartMs: Date.now() - 3000, jumpPhase: 2 })
    expect(checkFly(state, data, moveState, BALANCED_CONFIG)).toBeNull()
  })

  it('游泳状态不应触发飞行检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [
        { vx: 2.0, vz: 2.0, vy: 2.0, onGround: false },
        { vx: 2.5, vz: 2.5, vy: 1.5, onGround: false },
      ],
      [{ action: 'swimming', state: true }],
    )
    const moveState = makeMoveState({ airStartMs: Date.now() - 2000, jumpPhase: 2 })
    expect(checkFly(state, data, moveState, BALANCED_CONFIG)).toBeNull()
  })

  it('水中游泳不应触发速度检测', () => {
    const state = makePlayerState()
    // 水中游泳水平速度可达 ~5.6 blocks/s
    const data = makeRecentData(
      [{ vx: 4.0, vz: 4.0, onGround: false }],  // sqrt(16+16) ≈ 5.66
      [{ action: 'swimming', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })

  it('水中状态不应触发速度检测', () => {
    const state = makePlayerState()
    const data = makeRecentData(
      [{ vx: 4.0, vz: 4.0, onGround: false }],
      [{ action: 'in_water', state: true }],
    )
    expect(checkSpeed(state, data, makeMoveState(), BALANCED_CONFIG)).toBeNull()
  })
})
