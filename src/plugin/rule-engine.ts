// @desc Detection Engine V2 — 基于物理模拟的多层级反作弊检测引擎
//
// 参考 NoCheatPlus (SurvivalFly) 和 GrimAC (PredictionEngine) 的成熟检测机制，
// 实现以下改进：
//
// 1. Minecraft 物理模拟（重力、摩擦力、跳跃力）
// 2. 坠落包络线验证（垂直速度是否符合物理规律）
// 3. 跳跃阶段追踪（区分起跳/空中/着地）
// 4. 优势累积模型（替换简单超出比例为 GrimAC 风格的累积+衰减）
// 5. TPS 感知（自动调整阈值）
// 6. 可配置灵敏度（strict/balanced/lenient）
// 7. 多层验证（L1极端检测 → L2物理验证 → L3统计验证 → L4基线验证）

import type { PlayerState, CheatDetection, CheatType, Confidence, Evidence } from '../contracts/index.js'
import { SpeedThresholdService } from './speed-threshold-service.js'

export interface RecentData {
  movements: Array<{
    x: number
    y: number
    z: number
    vx: number
    vy: number
    vz: number
    onGround: boolean
    timestamp: number
  }>
  combats: Array<{
    attackerId: string
    victimId: string
    distance: number
    angle: number
    cps: number
    hasLos: boolean
    timestamp: number
  }>
  blocks: Array<{
    action: 'break' | 'place'
    blockType: string
    speed: number
    timestamp: number
  }>
  actions: Array<{
    action: string
    state: boolean
    timestamp: number
  }>
}

// ══════════════════════════════════════════════════════════════════
//  Minecraft 物理常量（参考 NCP Magic.java + GrimAC PredictionEngine）
// ══════════════════════════════════════════════════════════════════

const PHYSICS = {
  /** 重力加速度 (blocks/tick²) */
  GRAVITY: 0.0834,
  /** 缓降效果重力 (blocks/tick²) */
  GRAVITY_SLOW_FALLING: 0.01,
  /** 垂直摩擦系数（每 tick 乘以） */
  VERTICAL_FRICTION: 0.98,
  /** 水平摩擦系数 - 地面 */
  HORIZONTAL_FRICTION_GROUND: 0.91,
  /** 水平摩擦系数 - 空中 (1.13+) */
  HORIZONTAL_FRICTION_AIR: 0.99,
  /** 跳跃初速度 (blocks/tick) */
  JUMP_VELOCITY: 0.42,
  /** 每级跳跃提升药水增加的跳跃速度 */
  JUMP_BOOST_PER_LEVEL: 0.1,
  /** 步行速度 (blocks/tick) */
  WALK_SPEED: 0.221,
  /** 疾跑倍率 */
  SPRINT_MULTIPLIER: 1.3,
  /** 每级速度药水倍率 */
  SPEED_EFFECT_MULTIPLIER: 0.2,
  /** 理想 TPS */
  IDEAL_TPS: 20,
  /** 每秒 tick 数 */
  TICKS_PER_SECOND: 20,
}

// ══════════════════════════════════════════════════════════════════
//  检测灵敏度配置
// ══════════════════════════════════════════════════════════════════

export type SensitivityLevel = 'strict' | 'balanced' | 'lenient'

export interface SensitivityConfig {
  /** 飞行检测：最小空中持续时间阈值 (毫秒) */
  flyMinAirTimeMs: number
  /** 飞行检测：垂直速度超出物理预测的容差 (blocks/s) */
  flyVerticalTolerance: number
  /** 飞行检测：坠落包络线容差 (blocks/s) — 针对 ~250ms 平均速度的容差 */
  flyEnvelopeTolerance: number
  /** 速度检测：优势累积触发阈值 */
  speedAdvantageThreshold: number
  /** 速度检测：优势衰减率（每 tick 乘以） */
  speedAdvantageDecay: number
  /** 速度检测：单次偏移即时触发阈值 */
  speedImmediateThreshold: number
  /** 速度检测：滑动窗口大小（秒） */
  speedWindowSeconds: number
  /** 速度检测：窗口内超标比例阈值 */
  speedExceedRatioThreshold: number
  /** TPS 低于此值时暂停检测 */
  tpsPauseThreshold: number
  /** TPS 低于此值时放宽阈值 */
  tpsRelaxThreshold: number
  /** TPS 放宽系数 */
  tpsRelaxFactor: number
  /** 最低置信度要求：低于此置信度的检测被过滤 */
  minConfidence: 'low' | 'medium' | 'high'
}

const SENSITIVITY_PRESETS: Record<SensitivityLevel, SensitivityConfig> = {
  strict: {
    flyMinAirTimeMs: 500,    // 0.5秒
    flyVerticalTolerance: 1.5,
    flyEnvelopeTolerance: 2.0,   // 平均速度容差 (blocks/s)
    speedAdvantageThreshold: 1.0,
    speedAdvantageDecay: 0.995,
    speedImmediateThreshold: 0.5,
    speedWindowSeconds: 3,
    speedExceedRatioThreshold: 0.3,
    tpsPauseThreshold: 14,
    tpsRelaxThreshold: 18,
    tpsRelaxFactor: 1.15,
    minConfidence: 'low',
  },
  balanced: {
    flyMinAirTimeMs: 1000,   // 1秒
    flyVerticalTolerance: 2.5,
    flyEnvelopeTolerance: 3.5,   // 平均速度容差 (blocks/s)
    speedAdvantageThreshold: 2.0,
    speedAdvantageDecay: 0.99,
    speedImmediateThreshold: 1.0,
    speedWindowSeconds: 5,
    speedExceedRatioThreshold: 0.4,
    tpsPauseThreshold: 14,
    tpsRelaxThreshold: 17,
    tpsRelaxFactor: 1.25,
    minConfidence: 'low',
  },
  lenient: {
    flyMinAirTimeMs: 2000,   // 2秒
    flyVerticalTolerance: 4.0,
    flyEnvelopeTolerance: 5.0,   // 平均速度容差 (blocks/s)
    speedAdvantageThreshold: 4.0,
    speedAdvantageDecay: 0.98,
    speedImmediateThreshold: 2.0,
    speedWindowSeconds: 8,
    speedExceedRatioThreshold: 0.5,
    tpsPauseThreshold: 12,
    tpsRelaxThreshold: 16,
    tpsRelaxFactor: 1.40,
    minConfidence: 'medium',
  },
}

// ══════════════════════════════════════════════════════════════════
//  跳跃阶段追踪器
// ══════════════════════════════════════════════════════════════════

enum JumpPhase {
  /** 着地 */
  GROUND = 0,
  /** 起跳（刚离开地面） */
  LIFTOFF = 1,
  /** 空中（2+ tick 离地） */
  AIRBORNE = 2,
}

interface PlayerMovementState {
  jumpPhase: JumpPhase
  /** 空中开始时间戳 (ms)，0 表示在地面上 */
  airStartMs: number
  /** 上一次的垂直速度 (blocks/tick) */
  lastVy: number
  /** 上一次着地的 y 坐标 */
  lastGroundY: number
  /** 优势累积（速度检测） */
  speedAdvantage: number
  /** 上一次合法位置 */
  lastValidX: number
  lastValidY: number
  lastValidZ: number
  /** 是否刚传送（传送后2 tick 内暂停检测） */
  teleportGraceTicks: number
  /** 是否刚受击退（击退后5 tick 内添加容差） */
  knockbackGraceTicks: number
  /** 上次处理到的 movement 时间戳，防止 speedAdvantage 双计 */
  lastProcessedMoveTimestamp: number
}

// ══════════════════════════════════════════════════════════════════
//  检测日志
// ══════════════════════════════════════════════════════════════════

interface DetectionLogEntry {
  timestamp: number
  type: 'threshold_change' | 'detection_result' | 'priority_suppression' | 'physics_violation'
  playerId?: string
  cheatType?: CheatType
  details: string
}

const detectionLog: DetectionLogEntry[] = []
const MAX_LOG_SIZE = 5000

function logDetection(entry: Omit<DetectionLogEntry, 'timestamp'>): void {
  detectionLog.push({ ...entry, timestamp: Date.now() })
  if (detectionLog.length > MAX_LOG_SIZE) {
    detectionLog.splice(0, detectionLog.length - MAX_LOG_SIZE)
  }
}

/** 获取检测日志 */
export function getDetectionLog(limit: number = 100): DetectionLogEntry[] {
  return detectionLog.slice(-limit)
}

// ══════════════════════════════════════════════════════════════════
//  互斥关系
// ══════════════════════════════════════════════════════════════════

const DETECTION_PRIORITY: CheatType[] = [
  'fly', 'speed', 'kill_aura', 'reach', 'auto_clicker', 'scaffold', 'x_ray',
]

const MUTEX_GROUPS: Map<CheatType, CheatType[]> = new Map([
  ['fly', ['speed']],
])

// ══════════════════════════════════════════════════════════════════
//  速度阈值服务
// ══════════════════════════════════════════════════════════════════

let thresholdService: SpeedThresholdService | null = null

export function initSpeedThresholdService(opts?: {
  cachePath?: string
  remoteUrl?: string
  refreshIntervalMs?: number
}): SpeedThresholdService {
  thresholdService = new SpeedThresholdService(opts)
  thresholdService.start()
  return thresholdService
}

export function getSpeedThresholdService(): SpeedThresholdService | null {
  return thresholdService
}

export function shutdownSpeedThresholdService(): void {
  if (thresholdService) {
    thresholdService.stop()
    thresholdService = null
  }
}

// ══════════════════════════════════════════════════════════════════
//  TPS 感知
// ══════════════════════════════════════════════════════════════════

let currentTPS: number = 20
let tpsUpdatedAt: number = Date.now()

/** 更新 TPS（由 Spigot 插件定期上报） */
export function updateTPS(tps: number): void {
  currentTPS = tps
  tpsUpdatedAt = Date.now()
}

/** 获取当前 TPS */
export function getCurrentTPS(): number {
  // 如果超过 30 秒没有更新，假设 TPS 正常
  if (Date.now() - tpsUpdatedAt > 30_000) return 20
  return currentTPS
}

/** 根据 TPS 计算阈值调整系数 */
function getTPSFactor(config: SensitivityConfig): number {
  const tps = getCurrentTPS()
  if (tps < config.tpsPauseThreshold) return -1 // 暂停检测
  if (tps < config.tpsRelaxThreshold) return config.tpsRelaxFactor
  return 1.0
}

// ══════════════════════════════════════════════════════════════════
//  物理模拟工具函数
// ══════════════════════════════════════════════════════════════════

/**
 * 计算给定 tick 后的理论垂直速度（坠落包络线）
 * 参考 NCP SurvivalFly.vDist 和 GrimAC PredictionEngineNormal
 *
 * @param initialVy 初始垂直速度 (blocks/tick)
 * @param ticks 经过的 tick 数
 * @returns 理论垂直速度
 */
function predictVerticalVelocity(initialVy: number, ticks: number): number {
  let vy = initialVy
  for (let i = 0; i < ticks; i++) {
    vy = (vy - PHYSICS.GRAVITY) * PHYSICS.VERTICAL_FRICTION
  }
  return vy
}

/**
 * 计算给定 tick 后的理论 Y 偏移
 * @param initialVy 初始垂直速度 (blocks/tick)
 * @param ticks 经过的 tick 数
 * @returns 理论 Y 偏移
 */
function predictYOffset(initialVy: number, ticks: number): number {
  let y = 0
  let vy = initialVy
  for (let i = 0; i < ticks; i++) {
    vy = (vy - PHYSICS.GRAVITY) * PHYSICS.VERTICAL_FRICTION
    y += vy
  }
  return y
}

/**
 * 计算理论最大跳跃高度
 * @param jumpBoostLevel 跳跃提升药水等级
 * @returns 最大跳跃高度 (blocks)
 */
function getMaxJumpHeight(jumpBoostLevel: number = 0): number {
  const jumpVel = PHYSICS.JUMP_VELOCITY + jumpBoostLevel * PHYSICS.JUMP_BOOST_PER_LEVEL
  // 跳跃高度 = sum of vy * friction^i - gravity * sum of friction^j
  let height = 0
  let vy = jumpVel
  while (vy > 0) {
    vy = (vy - PHYSICS.GRAVITY) * PHYSICS.VERTICAL_FRICTION
    if (vy > 0) height += vy
  }
  return height
}

/**
 * 计算理论最大起跳速度
 * @param jumpBoostLevel 跳跃提升药水等级
 */
function getJumpVelocity(jumpBoostLevel: number = 0): number {
  return PHYSICS.JUMP_VELOCITY + jumpBoostLevel * PHYSICS.JUMP_BOOST_PER_LEVEL
}

/**
 * 验证垂直速度是否符合坠落包络线
 * 参考 NCP SurvivalFly.enoughFrictionEnvelope
 *
 * @param currentVy 当前垂直速度 (blocks/s)
 * @param previousVy 上一次垂直速度 (blocks/s)
 * @param onGround 是否在地面
 * @param tolerance 容差 (blocks/s)
 * @returns 是否符合物理规律
 */
function validateVerticalEnvelope(
  currentVy: number,
  previousVy: number,
  onGround: boolean,
  tolerance: number,
): { valid: boolean; deviation: number } {
  // 转换为 blocks/tick
  const currentVyTick = currentVy / PHYSICS.TICKS_PER_SECOND
  const previousVyTick = previousVy / PHYSICS.TICKS_PER_SECOND

  if (onGround) {
    // 着地状态：vy 应接近 0 或为负（下落到地面）
    const valid = currentVyTick <= tolerance / PHYSICS.TICKS_PER_SECOND
    return { valid, deviation: Math.max(0, currentVyTick) }
  }

  // 空中状态：vy 应符合 (prevVy - gravity) * friction ± tolerance
  const predictedVyTick = (previousVyTick - PHYSICS.GRAVITY) * PHYSICS.VERTICAL_FRICTION
  const deviation = Math.abs(currentVyTick - predictedVyTick)
  const toleranceTick = tolerance / PHYSICS.TICKS_PER_SECOND

  return { valid: deviation <= toleranceTick, deviation: deviation * PHYSICS.TICKS_PER_SECOND }
}

// ══════════════════════════════════════════════════════════════════
//  辅助函数：获取最新动作状态
// ══════════════════════════════════════════════════════════════════

/**
 * 获取指定动作类型的最新状态。
 * 与 `some()` 不同，此函数只检查最新的动作条目，
 * 避免历史 `sprinting:true` 在当前 `sprinting:false` 时仍返回 true。
 */
function getLatestActionState(actions: RecentData['actions'], actionName: string): boolean {
  // 从后往前查找最新的匹配动作
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].action === actionName) {
      return actions[i].state
    }
  }
  return false
}

// ══════════════════════════════════════════════════════════════════
//  飞行检测 V2（基于物理模拟 + 坠落包络线 + 跳跃阶段追踪）
// ══════════════════════════════════════════════════════════════════

function checkFly(
  state: PlayerState,
  data: RecentData,
  moveState: PlayerMovementState,
  config: SensitivityConfig,
): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  // 攀爬排除
  if (getLatestActionState(data.actions, 'climbing')) return null

  // 鞘翅飞行排除
  if (getLatestActionState(data.actions, 'elytra_flying')) return null

  // 水中/游泳状态排除
  const isInWater = getLatestActionState(data.actions, 'in_water')
  const isSwimming = getLatestActionState(data.actions, 'swimming')
  if (isInWater || isSwimming) return null

  // 缓降效果排除
  const hasSlowFalling = getLatestActionState(data.actions, 'slow_falling')

  // 传送宽限期
  if (moveState.teleportGraceTicks > 0) return null

  // TPS 检查
  const tpsFactor = getTPSFactor(config)
  if (tpsFactor < 0) return null

  const now = Date.now()
  const recentMovements = data.movements.filter(m => now - m.timestamp < 10_000)
  if (recentMovements.length < 2) return null

  const tolerance = config.flyVerticalTolerance * tpsFactor
  const envelopeTolerance = config.flyEnvelopeTolerance * tpsFactor

  // ── L1: 极端飞行检测（瞬移级别） ──
  const maxVy = recentMovements.reduce((max, m) => Math.max(max, m.vy), 0)
  const absoluteMaxVy = (hasSlowFalling ? 2.0 : 10.0) * tpsFactor
  if (maxVy > absoluteMaxVy) {
    return {
      playerId: state.playerId,
      cheatType: 'fly',
      confidence: 'high',
      evidence: [
        { metric: 'extreme_vertical_speed', value: maxVy, threshold: absoluteMaxVy, duration: 0 },
      ],
      timestamp: now,
    }
  }

  // ── L2: 连续空中时间检测（基于时间戳） ──
  let airTimeMs = 0
  if (moveState.airStartMs > 0) {
    airTimeMs = now - moveState.airStartMs
  }
  const minAirTimeMs = config.flyMinAirTimeMs

  if (airTimeMs < minAirTimeMs) return null

  // ── L3: 坠落包络线验证 ──
  let envelopeViolations = 0
  let maxDeviation = 0
  let violationDuration = 0
  let violationStart = -1

  for (let i = 1; i < recentMovements.length; i++) {
    const prev = recentMovements[i - 1]
    const curr = recentMovements[i]

    if (curr.onGround) continue

    const { valid, deviation } = validateVerticalEnvelope(
      curr.vy, prev.vy, curr.onGround, envelopeTolerance,
    )

    if (!valid) {
      envelopeViolations++
      maxDeviation = Math.max(maxDeviation, deviation)
      if (violationStart === -1) violationStart = i
    } else {
      if (violationStart !== -1) {
        const start = recentMovements[violationStart].timestamp
        const end = recentMovements[i - 1].timestamp
        violationDuration = Math.max(violationDuration, end - start)
      }
      violationStart = -1
    }
  }

  if (violationStart !== -1) {
    const start = recentMovements[violationStart].timestamp
    violationDuration = Math.max(violationDuration, now - start)
  }

  // 需要同时满足：空中时间足够 + 包络线违规
  if (envelopeViolations === 0 && airTimeMs < minAirTimeMs * 2) return null

  // ── L4: 跳跃合理性验证 ──
  let jumpBoostLevel = 0
  if (getLatestActionState(data.actions, 'jump_boost_2')) {
    jumpBoostLevel = 2
  } else if (getLatestActionState(data.actions, 'jump_boost')) {
    jumpBoostLevel = 1
  }

  const maxJumpVel = getJumpVelocity(jumpBoostLevel)
  const maxJumpVelBlocksPerSec = maxJumpVel * PHYSICS.TICKS_PER_SECOND

  // 检查是否有不合理的上升（非跳跃导致的上升）
  const ascendingInAir = recentMovements.filter(m => m.vy > 0 && !m.onGround)
  const unreasonableAscend = ascendingInAir.filter(m => {
    return m.vy > maxJumpVelBlocksPerSec * 1.2
  })

  // ── 综合置信度判定 ──
  let score = 0

  // 空中时间得分
  if (airTimeMs >= minAirTimeMs * 4) score += 40
  else if (airTimeMs >= minAirTimeMs * 2) score += 25
  else if (airTimeMs >= minAirTimeMs) score += 15

  // 包络线违规得分
  if (envelopeViolations > 5) score += 30
  else if (envelopeViolations > 2) score += 20
  else if (envelopeViolations > 0) score += 10

  // 不合理上升得分
  if (unreasonableAscend.length > 3) score += 30
  else if (unreasonableAscend.length > 0) score += 15

  if (score < 20) return null

  let confidence: Confidence
  if (score < 40) confidence = 'low'
  else if (score < 65) confidence = 'medium'
  else confidence = 'high'

  // 最低置信度过滤
  if (confidence === 'low' && config.minConfidence !== 'low') return null
  if (confidence === 'medium' && config.minConfidence === 'high') return null

  return {
    playerId: state.playerId,
    cheatType: 'fly',
    confidence,
    evidence: [
      { metric: 'air_time_ms', value: airTimeMs, threshold: minAirTimeMs, duration: violationDuration },
      { metric: 'envelope_violations', value: envelopeViolations, threshold: 1, duration: violationDuration },
      { metric: 'max_envelope_deviation', value: maxDeviation, threshold: envelopeTolerance, duration: 0 },
      { metric: 'unreasonable_ascend_count', value: unreasonableAscend.length, threshold: 0, duration: 0 },
      { metric: 'detection_score', value: score, threshold: 20, duration: 0 },
    ],
    timestamp: now,
  }
}

// ══════════════════════════════════════════════════════════════════
//  速度检测 V2（优势累积 + 滑动窗口 + TPS 感知）
// ══════════════════════════════════════════════════════════════════

function checkSpeed(
  state: PlayerState,
  data: RecentData,
  moveState: PlayerMovementState,
  config: SensitivityConfig,
): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  // 水中/游泳状态排除
  const isInWater = getLatestActionState(data.actions, 'in_water')
  const isSwimming = getLatestActionState(data.actions, 'swimming')
  if (isInWater || isSwimming) return null

  // TPS 检查
  const tpsFactor = getTPSFactor(config)
  if (tpsFactor < 0) return null

  // 传送宽限期
  if (moveState.teleportGraceTicks > 0) return null

  const now = Date.now()
  const windowMs = config.speedWindowSeconds * 1000
  const recentMovements = data.movements.filter(m => now - m.timestamp < windowMs)
  if (recentMovements.length === 0) return null

  // ── 动态阈值：感知玩家 buff 状态 ──
  const isSprinting = getLatestActionState(data.actions, 'sprinting')
  let speedEffectLevel = 0
  if (getLatestActionState(data.actions, 'speed_effect_2')) {
    speedEffectLevel = 2
  } else if (getLatestActionState(data.actions, 'speed_effect')) {
    speedEffectLevel = 1
  }
  let beaconSpeedLevel = 0
  if (getLatestActionState(data.actions, 'beacon_speed_3')) {
    beaconSpeedLevel = 3
  } else if (getLatestActionState(data.actions, 'beacon_speed_2')) {
    beaconSpeedLevel = 2
  } else if (getLatestActionState(data.actions, 'beacon_speed')) {
    beaconSpeedLevel = 1
  }
  const isElytraFlying = getLatestActionState(data.actions, 'elytra_flying')
  const isRiptiding = getLatestActionState(data.actions, 'riptiding')
  const isInVehicle = getLatestActionState(data.actions, 'vehicle')
  let vehicleType = ''
  if (isInVehicle) {
    if (getLatestActionState(data.actions, 'vehicle_boat')) vehicleType = 'boat'
    else if (getLatestActionState(data.actions, 'vehicle_minecart')) vehicleType = 'minecart'
    else if (getLatestActionState(data.actions, 'vehicle_mount')) vehicleType = 'mount'
  }
  const isOnGround = recentMovements.length > 0
    ? recentMovements[recentMovements.length - 1].onGround
    : true

  // 从 SpeedThresholdService 获取动态阈值
  let threshold: number
  if (thresholdService) {
    threshold = thresholdService.getHorizontalThreshold({
      isSprinting,
      isOnGround,
      hasSpeedEffect: speedEffectLevel,
      hasBeaconSpeed: beaconSpeedLevel,
      isElytraFlying,
      isInVehicle,
      vehicleType,
      isRiptiding,
    })
  } else {
    if (isElytraFlying || isRiptiding || isInVehicle) return null
    threshold = isSprinting ? 9.1 : 5.6
  }

  if (!isFinite(threshold)) return null

  // 应用 TPS 调整
  threshold *= tpsFactor

  // ── L1: 极端速度检测（瞬移级别） ──
  const maxSpeed = recentMovements.reduce(
    (max, m) => Math.max(max, Math.sqrt(m.vx * m.vx + m.vz * m.vz)),
    0,
  )
  const absoluteMaxSpeed = 50 * tpsFactor
  if (maxSpeed > absoluteMaxSpeed) {
    return {
      playerId: state.playerId,
      cheatType: 'speed',
      confidence: 'high',
      evidence: [
        { metric: 'extreme_horizontal_speed', value: maxSpeed, threshold: absoluteMaxSpeed, duration: 0 },
      ],
      timestamp: now,
    }
  }

  // ── L2: 优势累积模型（GrimAC 风格） ──
  // 只处理上次检查之后的新 movement，避免双计
  let advantage = moveState.speedAdvantage
  let maxOffset = 0
  let exceedCount = 0
  const lastTs = moveState.lastProcessedMoveTimestamp

  for (const m of recentMovements) {
    // 跳过已处理过的 movement（时间戳 <= 上次处理的时间戳）
    if (m.timestamp <= lastTs) continue

    const horizontalSpeed = Math.sqrt(m.vx * m.vx + m.vz * m.vz)
    const offset = Math.max(0, horizontalSpeed - threshold)

    if (offset > 0) {
      advantage += offset * 0.1 // 缩放因子
      maxOffset = Math.max(maxOffset, offset)
      exceedCount++
    } else {
      // 正常移动时衰减优势
      advantage *= config.speedAdvantageDecay
    }
  }

  // 更新已处理时间戳为窗口内最新的
  const latestTimestamp = recentMovements[recentMovements.length - 1].timestamp
  if (latestTimestamp > lastTs) {
    moveState.lastProcessedMoveTimestamp = latestTimestamp
  }

  // 限制优势上限
  advantage = Math.min(advantage, config.speedAdvantageThreshold * 4)
  moveState.speedAdvantage = advantage

  // ── L3: 滑动窗口统计 ──
  // 重新统计全窗口超标比例（这是统计指标，不需要避免双计）
  const totalInWindow = recentMovements.length
  const exceedingInWindow = recentMovements.filter(
    m => Math.sqrt(m.vx * m.vx + m.vz * m.vz) > threshold,
  ).length
  const exceedRatio = totalInWindow > 0 ? exceedingInWindow / totalInWindow : 0

  // ── 综合判定 ──
  // 即时触发：单次偏移超过即时阈值
  const immediateTrigger = maxOffset > config.speedImmediateThreshold

  // 累积触发：优势累积超过阈值
  const cumulativeTrigger = advantage > config.speedAdvantageThreshold

  // 窗口触发：窗口内超标比例超过阈值
  const windowTrigger = exceedRatio > config.speedExceedRatioThreshold

  if (!immediateTrigger && !cumulativeTrigger && !windowTrigger) return null

  // ── 置信度判定 ──
  let confidence: Confidence
  if (immediateTrigger || advantage > config.speedAdvantageThreshold * 2) {
    confidence = 'high'
  } else if (cumulativeTrigger || exceedRatio > config.speedExceedRatioThreshold * 1.5) {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }

  // 最低置信度过滤
  if (confidence === 'low' && config.minConfidence !== 'low') return null
  if (confidence === 'medium' && config.minConfidence === 'high') return null

  return {
    playerId: state.playerId,
    cheatType: 'speed',
    confidence,
    evidence: [
      { metric: 'horizontal_speed', value: maxSpeed, threshold, duration: windowMs },
      { metric: 'speed_advantage', value: advantage, threshold: config.speedAdvantageThreshold, duration: 0 },
      { metric: 'max_offset', value: maxOffset, threshold: config.speedImmediateThreshold, duration: 0 },
      { metric: 'exceed_ratio', value: exceedRatio, threshold: config.speedExceedRatioThreshold, duration: windowMs },
      { metric: 'speed_effect_level', value: speedEffectLevel, threshold: 0, duration: 0 },
      { metric: 'beacon_speed_level', value: beaconSpeedLevel, threshold: 0, duration: 0 },
    ],
    timestamp: now,
  }
}

// ══════════════════════════════════════════════════════════════════
//  其他检测（保持原有逻辑，添加灵敏度配置）
// ══════════════════════════════════════════════════════════════════

function checkKillAura(state: PlayerState, data: RecentData): CheatDetection | null {
  const now = Date.now()
  const recentCombats = data.combats.filter(c => now - c.timestamp < 30_000)
  if (recentCombats.length < 3) return null

  let score = 0
  const evidence: Evidence[] = []

  const highAngleAttacks = recentCombats.filter(c => c.angle > 90)
  if (highAngleAttacks.length > 0) {
    const angleRatio = highAngleAttacks.length / recentCombats.length
    score += angleRatio * 40
    evidence.push({ metric: 'high_angle_attack_ratio', value: angleRatio, threshold: 0.3, duration: 30_000 })
  }

  const maxCps = recentCombats.reduce((max, c) => Math.max(max, c.cps), 0)
  if (maxCps > 15) {
    score += 25
    evidence.push({ metric: 'max_cps', value: maxCps, threshold: 15, duration: 30_000 })
  }

  if (state.hitRate > 0.95) {
    score += 20
    evidence.push({ metric: 'hit_rate', value: state.hitRate * 100, threshold: 95, duration: 30_000 })
  }

  const oneSecondWindows = new Map<number, Set<string>>()
  for (const c of recentCombats) {
    const windowKey = Math.floor(c.timestamp / 1000)
    let targets = oneSecondWindows.get(windowKey)
    if (!targets) { targets = new Set(); oneSecondWindows.set(windowKey, targets) }
    targets.add(c.victimId)
  }
  const maxTargetsInWindow = Array.from(oneSecondWindows.values()).reduce((max, s) => Math.max(max, s.size), 0)
  if (maxTargetsInWindow >= 3) {
    score += 25
    evidence.push({ metric: 'max_targets_per_second', value: maxTargetsInWindow, threshold: 3, duration: 1000 })
  }

  if (score < 30) return null

  let confidence: Confidence
  if (score < 50) confidence = 'low'
  else if (score < 75) confidence = 'medium'
  else confidence = 'high'

  return { playerId: state.playerId, cheatType: 'kill_aura', confidence, evidence, timestamp: now }
}

function checkXRay(state: PlayerState, data: RecentData): CheatDetection | null {
  const now = Date.now()
  const recentBlocks = data.blocks.filter(b => b.action === 'break' && now - b.timestamp < 300_000)
  if (recentBlocks.length < 20) return null

  const last100 = recentBlocks.slice(-100)
  const valuableTypes = new Set(['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'ancient_debris'])
  const valuableCount = last100.filter(b => valuableTypes.has(b.blockType)).length
  const ratio = valuableCount / last100.length
  if (ratio <= 0.15) return null

  const baseline = 0.025
  const deviation = ratio / baseline

  let confidence: Confidence
  if (deviation < 4) confidence = 'low'
  else if (deviation < 8) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId, cheatType: 'x_ray', confidence,
    evidence: [
      { metric: 'valuable_ore_ratio', value: ratio * 100, threshold: 15, duration: 300_000 },
      { metric: 'deviation_from_baseline', value: deviation, threshold: 6, duration: 300_000 },
    ],
    timestamp: now,
  }
}

function checkScaffold(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const now = Date.now()
  const recentBlocks = data.blocks.filter(b => b.action === 'place' && now - b.timestamp < 10_000)
  if (recentBlocks.length < 5) return null

  const oneSecondWindows = new Map<number, number>()
  for (const b of recentBlocks) {
    const windowKey = Math.floor(b.timestamp / 1000)
    oneSecondWindows.set(windowKey, (oneSecondWindows.get(windowKey) ?? 0) + 1)
  }

  const maxBlocksPerSec = Math.max(...oneSecondWindows.values())
  if (maxBlocksPerSec <= 6) return null

  const sustainedSeconds = Array.from(oneSecondWindows.values()).filter(v => v > 6).length

  let confidence: Confidence
  if (sustainedSeconds < 2) confidence = 'low'
  else if (sustainedSeconds < 4) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId, cheatType: 'scaffold', confidence,
    evidence: [
      { metric: 'max_blocks_per_second', value: maxBlocksPerSec, threshold: 6, duration: 10_000 },
      { metric: 'sustained_seconds', value: sustainedSeconds, threshold: 2, duration: 10_000 },
    ],
    timestamp: now,
  }
}

function checkAutoClicker(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const now = Date.now()
  const recentCombats = data.combats.filter(c => now - c.timestamp < 30_000)
  if (recentCombats.length < 5) return null

  const oneSecondWindows = new Map<number, { cps: number; count: number }>()
  for (const c of recentCombats) {
    const windowKey = Math.floor(c.timestamp / 1000)
    const existing = oneSecondWindows.get(windowKey)
    if (existing) { existing.cps = Math.max(existing.cps, c.cps); existing.count++ }
    else oneSecondWindows.set(windowKey, { cps: c.cps, count: 1 })
  }

  const highCpsWindows = Array.from(oneSecondWindows.entries())
    .filter(([, v]) => v.cps > 16)
    .sort(([a], [b]) => a - b)
  if (highCpsWindows.length === 0) return null

  let maxConsecutive = 1
  let consecutive = 1
  for (let i = 1; i < highCpsWindows.length; i++) {
    if (highCpsWindows[i][0] === highCpsWindows[i - 1][0] + 1) {
      consecutive++
      maxConsecutive = Math.max(maxConsecutive, consecutive)
    } else consecutive = 1
  }

  const sustainedMs = maxConsecutive * 1000
  if (sustainedMs < 10_000) return null

  const maxCps = Math.max(...highCpsWindows.map(([, v]) => v.cps))
  let confidence: Confidence
  if (maxCps < 20) confidence = 'low'
  else if (maxCps < 25) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId, cheatType: 'auto_clicker', confidence,
    evidence: [
      { metric: 'max_cps', value: maxCps, threshold: 16, duration: sustainedMs },
      { metric: 'sustained_duration', value: sustainedMs, threshold: 10_000, duration: sustainedMs },
    ],
    timestamp: now,
  }
}

function checkReach(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const now = Date.now()
  const recentCombats = data.combats.filter(c => now - c.timestamp < 30_000)
  if (recentCombats.length < 2) return null

  const reachViolations = recentCombats.filter(c => c.distance > 4.0)
  if (reachViolations.length === 0) return null

  const maxDistance = Math.max(...reachViolations.map(c => c.distance))
  const violationRatio = reachViolations.length / recentCombats.length

  let confidence: Confidence
  if (violationRatio < 0.3 || maxDistance < 4.5) confidence = 'low'
  else if (violationRatio < 0.6 || maxDistance < 5.0) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId, cheatType: 'reach', confidence,
    evidence: [
      { metric: 'max_attack_distance', value: maxDistance, threshold: 4.0, duration: 30_000 },
      { metric: 'violation_ratio', value: violationRatio, threshold: 0.3, duration: 30_000 },
    ],
    timestamp: now,
  }
}

// ══════════════════════════════════════════════════════════════════
//  评估入口
// ══════════════════════════════════════════════════════════════════

export function evaluate(
  playerId: string,
  playerState: PlayerState,
  recentData: RecentData,
): CheatDetection[] {
  // 使用默认 balanced 灵敏度（DetectionEngine 实例方法使用可配置灵敏度）
  return evaluateWithSensitivity(playerId, playerState, recentData, 'balanced', null)
}

function evaluateWithSensitivity(
  playerId: string,
  playerState: PlayerState,
  recentData: RecentData,
  sensitivity: SensitivityLevel,
  moveState: PlayerMovementState | null,
): CheatDetection[] {
  const config = SENSITIVITY_PRESETS[sensitivity]
  const detections: CheatDetection[] = []

  const flyResult = checkFly(playerState, recentData, moveState ?? createDefaultMoveState(), config)
  if (flyResult) detections.push(flyResult)

  const speedResult = checkSpeed(playerState, recentData, moveState ?? createDefaultMoveState(), config)
  if (speedResult) detections.push(speedResult)

  const killAuraResult = checkKillAura(playerState, recentData)
  if (killAuraResult) detections.push(killAuraResult)

  const xrayResult = checkXRay(playerState, recentData)
  if (xrayResult) detections.push(xrayResult)

  const scaffoldResult = checkScaffold(playerState, recentData)
  if (scaffoldResult) detections.push(scaffoldResult)

  const autoClickerResult = checkAutoClicker(playerState, recentData)
  if (autoClickerResult) detections.push(autoClickerResult)

  const reachResult = checkReach(playerState, recentData)
  if (reachResult) detections.push(reachResult)

  // 优先级互斥处理
  const suppressedTypes = new Set<CheatType>()
  for (const detection of detections) {
    const mutexTypes = MUTEX_GROUPS.get(detection.cheatType)
    if (mutexTypes) {
      for (const suppressed of mutexTypes) suppressedTypes.add(suppressed)
    }
  }

  const result = detections.filter(d => {
    if (suppressedTypes.has(d.cheatType)) {
      logDetection({
        type: 'priority_suppression',
        playerId,
        cheatType: d.cheatType,
        details: `Suppressed ${d.cheatType} detection due to higher-priority detection`,
      })
      return false
    }
    return true
  })

  for (const d of result) {
    logDetection({
      type: 'detection_result',
      playerId,
      cheatType: d.cheatType,
      details: `${d.cheatType} detected (confidence: ${d.confidence}, sensitivity: ${sensitivity})`,
    })
  }

  return result
}

function createDefaultMoveState(): PlayerMovementState {
  return {
    jumpPhase: JumpPhase.GROUND,
    airStartMs: 0,
    lastVy: 0,
    lastGroundY: 0,
    speedAdvantage: 0,
    lastValidX: 0,
    lastValidY: 0,
    lastValidZ: 0,
    teleportGraceTicks: 0,
    knockbackGraceTicks: 0,
    lastProcessedMoveTimestamp: 0,
  }
}

// ══════════════════════════════════════════════════════════════════
//  DetectionEngine 类（带冷却、信号融合、灵敏度配置、移动状态追踪）
// ══════════════════════════════════════════════════════════════════

export class DetectionEngine {
  private cooldowns = new Map<string, Map<CheatType, number>>()
  private cooldownMs: number
  private sensitivity: SensitivityLevel
  private moveStates = new Map<string, PlayerMovementState>()

  constructor(cooldownMs = 6000, sensitivity: SensitivityLevel = 'balanced') {
    this.cooldownMs = cooldownMs
    this.sensitivity = sensitivity
  }

  /** 设置冷却时间（毫秒） */
  setCooldownMs(ms: number): void {
    this.cooldownMs = ms
    console.log(`[DetectionEngine] Cooldown set to: ${ms}ms`)
  }

  /** 设置灵敏度 */
  setSensitivity(level: SensitivityLevel): void {
    this.sensitivity = level
    console.log(`[DetectionEngine] Sensitivity set to: ${level}`)
  }

  /** 获取当前灵敏度 */
  getSensitivity(): SensitivityLevel {
    return this.sensitivity
  }

  /** 获取灵敏度预设配置 */
  getSensitivityConfig(): SensitivityConfig {
    return SENSITIVITY_PRESETS[this.sensitivity]
  }

  /** 获取所有灵敏度预设 */
  getAllSensitivityPresets(): Record<SensitivityLevel, SensitivityConfig> {
    return { ...SENSITIVITY_PRESETS }
  }

  /** 更新玩家移动状态（每次收到移动数据时调用） */
  updateMovementState(playerId: string, movement: {
    x: number; y: number; z: number
    vx: number; vy: number; vz: number
    onGround: boolean
  }): void {
    let state = this.moveStates.get(playerId)
    if (!state) {
      state = createDefaultMoveState()
      state.lastValidX = movement.x
      state.lastValidY = movement.y
      state.lastValidZ = movement.z
      this.moveStates.set(playerId, state)
    }

    const now = Date.now()

    // 更新跳跃阶段
    if (movement.onGround) {
      state.jumpPhase = JumpPhase.GROUND
      state.airStartMs = 0  // 着地时重置空中计时
      state.lastGroundY = movement.y
      state.lastVy = movement.vy
      // 更新合法位置
      state.lastValidX = movement.x
      state.lastValidY = movement.y
      state.lastValidZ = movement.z
    } else {
      if (state.jumpPhase === JumpPhase.GROUND) {
        state.jumpPhase = JumpPhase.LIFTOFF
        state.airStartMs = now  // 刚离开地面，记录开始时间
      } else {
        state.jumpPhase = JumpPhase.AIRBORNE
        // airStartMs 保持不变，持续计时
      }
      state.lastVy = movement.vy
    }

    // 衰减宽限期
    if (state.teleportGraceTicks > 0) state.teleportGraceTicks--
    if (state.knockbackGraceTicks > 0) state.knockbackGraceTicks--
  }

  /** 标记玩家刚传送（暂停检测 2 tick） */
  markTeleport(playerId: string): void {
    const state = this.moveStates.get(playerId)
    if (state) state.teleportGraceTicks = 2
  }

  /** 标记玩家刚受击退（添加容差 5 tick） */
  markKnockback(playerId: string): void {
    const state = this.moveStates.get(playerId)
    if (state) state.knockbackGraceTicks = 5
  }

  /** 获取玩家移动状态 */
  getMovementState(playerId: string): PlayerMovementState | undefined {
    return this.moveStates.get(playerId)
  }

  evaluate(playerId: string, playerState: PlayerState, recentData: RecentData): CheatDetection[] {
    const moveState = this.moveStates.get(playerId) ?? createDefaultMoveState()
    const allDetections = evaluateWithSensitivity(playerId, playerState, recentData, this.sensitivity, moveState)
    const now = Date.now()

    const filtered: CheatDetection[] = []
    for (const detection of allDetections) {
      const playerCooldowns = this.cooldowns.get(playerId)
      const lastTime = playerCooldowns?.get(detection.cheatType)
      if (lastTime !== undefined && now - lastTime < this.cooldownMs) continue

      filtered.push(detection)

      let pc = this.cooldowns.get(playerId)
      if (!pc) { pc = new Map(); this.cooldowns.set(playerId, pc) }
      pc.set(detection.cheatType, now)
    }

    return this.fuseSignals(filtered)
  }

  /** 多信号融合 */
  private fuseSignals(detections: CheatDetection[]): CheatDetection[] {
    if (detections.length <= 1) return detections
    return detections.map(d => ({
      ...d,
      confidence: d.confidence === 'low' ? 'medium' as const : d.confidence === 'medium' ? 'high' as const : 'high' as const,
      evidence: [...d.evidence, { metric: 'multi_signal_fusion', value: detections.length, threshold: 2, duration: 0 }],
    }))
  }

  clearPlayer(playerId: string): void {
    this.cooldowns.delete(playerId)
    this.moveStates.delete(playerId)
  }

  destroy(): void {
    this.cooldowns.clear()
    this.moveStates.clear()
  }
}

export {
  checkFly, checkSpeed, checkKillAura, checkXRay,
  checkScaffold, checkAutoClicker, checkReach,
  PHYSICS, SENSITIVITY_PRESETS,
  predictVerticalVelocity, predictYOffset, getMaxJumpHeight, getJumpVelocity,
  validateVerticalEnvelope,
}
export type { SensitivityConfig as SensitivityConfigType, PlayerMovementState }
