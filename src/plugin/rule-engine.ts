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

// ── 检测规则变更日志 ──

interface DetectionLogEntry {
  timestamp: number
  type: 'threshold_change' | 'detection_result' | 'priority_suppression'
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

/** 获取检测日志（供外部查询） */
export function getDetectionLog(limit: number = 100): DetectionLogEntry[] {
  return detectionLog.slice(-limit)
}

// ── 检测优先级定义 ──
// fly > speed > kill_aura > reach > auto_clicker > scaffold > x_ray

const DETECTION_PRIORITY: CheatType[] = [
  'fly',
  'speed',
  'kill_aura',
  'reach',
  'auto_clicker',
  'scaffold',
  'x_ray',
]

// 互斥关系：fly 检测触发时，speed 检测应被抑制
const MUTEX_GROUPS: Map<CheatType, CheatType[]> = new Map([
  ['fly', ['speed']],
])

// ── 速度阈值服务实例 ──

let thresholdService: SpeedThresholdService | null = null

/** 初始化速度阈值服务（由 index.ts 调用） */
export function initSpeedThresholdService(opts?: {
  cachePath?: string
  remoteUrl?: string
  refreshIntervalMs?: number
}): SpeedThresholdService {
  thresholdService = new SpeedThresholdService(opts)
  thresholdService.start()

  logDetection({
    type: 'threshold_change',
    details: `SpeedThresholdService initialized: v${thresholdService.getThresholds().version}`,
  })

  return thresholdService
}

/** 获取速度阈值服务实例 */
export function getSpeedThresholdService(): SpeedThresholdService | null {
  return thresholdService
}

/** 关闭速度阈值服务 */
export function shutdownSpeedThresholdService(): void {
  if (thresholdService) {
    thresholdService.stop()
    thresholdService = null
  }
}

function checkFly(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const isClimbing = data.actions.some(a => a.action === 'climbing' && a.state)
  if (isClimbing) return null

  // 鞘翅飞行排除
  const isElytraFlying = data.actions.some(a => a.action === 'elytra_flying' && a.state)
  if (isElytraFlying) return null

  const now = Date.now()
  const recentMovements = data.movements.filter(m => now - m.timestamp < 10_000)

  // 使用动态垂直速度阈值
  const verticalThreshold = thresholdService?.getVerticalThreshold() ?? 0.6

  let consecutiveStart = -1
  let maxDuration = 0

  for (let i = 0; i < recentMovements.length; i++) {
    const m = recentMovements[i]
    if (m.vy > verticalThreshold && !m.onGround) {
      if (consecutiveStart === -1) consecutiveStart = i
    } else {
      if (consecutiveStart !== -1) {
        const start = recentMovements[consecutiveStart].timestamp
        const end = recentMovements[i - 1].timestamp
        maxDuration = Math.max(maxDuration, end - start)
      }
      consecutiveStart = -1
    }
  }

  if (consecutiveStart !== -1) {
    const start = recentMovements[consecutiveStart].timestamp
    maxDuration = Math.max(maxDuration, now - start)
  }

  if (maxDuration < 500) return null

  let confidence: Confidence
  if (maxDuration < 2000) confidence = 'low'
  else if (maxDuration < 5000) confidence = 'medium'
  else confidence = 'high'

  const maxVy = recentMovements.reduce((max, m) => Math.max(max, m.vy), 0)

  return {
    playerId: state.playerId,
    cheatType: 'fly',
    confidence,
    evidence: [
      { metric: 'vertical_speed', value: maxVy, threshold: verticalThreshold, duration: maxDuration },
      { metric: 'flight_duration', value: maxDuration, threshold: 500, duration: maxDuration },
    ],
    timestamp: now,
  }
}

function checkSpeed(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const now = Date.now()
  const recentMovements = data.movements.filter(m => now - m.timestamp < 5000)
  if (recentMovements.length === 0) return null

  // ── 动态阈值：感知玩家 buff 状态 ──
  const isSprinting = data.actions.some(a => a.action === 'sprinting' && a.state)

  // 解析速度药水等级
  let speedEffectLevel = 0
  if (data.actions.some(a => a.action === 'speed_effect_2' && a.state)) {
    speedEffectLevel = 2
  } else if (data.actions.some(a => a.action === 'speed_effect' && a.state)) {
    speedEffectLevel = 1
  }

  // 解析信标速度等级
  let beaconSpeedLevel = 0
  if (data.actions.some(a => a.action === 'beacon_speed_3' && a.state)) {
    beaconSpeedLevel = 3
  } else if (data.actions.some(a => a.action === 'beacon_speed_2' && a.state)) {
    beaconSpeedLevel = 2
  } else if (data.actions.some(a => a.action === 'beacon_speed' && a.state)) {
    beaconSpeedLevel = 1
  }

  // 鞘翅飞行排除
  const isElytraFlying = data.actions.some(a => a.action === 'elytra_flying' && a.state)

  // 从 SpeedThresholdService 获取动态阈值
  let threshold: number
  if (thresholdService) {
    threshold = thresholdService.getHorizontalThreshold({
      isSprinting,
      hasSpeedEffect: speedEffectLevel,
      hasBeaconSpeed: beaconSpeedLevel,
      isElytraFlying,
    })
  } else {
    // 回退到硬编码阈值
    threshold = isSprinting ? 7.0 : 5.6
  }

  let maxExceedRatio = 0
  let exceedDuration = 0
  let exceedStart = -1

  for (let i = 0; i < recentMovements.length; i++) {
    const m = recentMovements[i]
    const horizontalSpeed = Math.sqrt(m.vx * m.vx + m.vz * m.vz)

    if (horizontalSpeed > threshold) {
      const ratio = horizontalSpeed / threshold
      maxExceedRatio = Math.max(maxExceedRatio, ratio)
      if (exceedStart === -1) exceedStart = i
    } else {
      if (exceedStart !== -1) {
        const start = recentMovements[exceedStart].timestamp
        const end = recentMovements[i - 1].timestamp
        exceedDuration = Math.max(exceedDuration, end - start)
      }
      exceedStart = -1
    }
  }

  if (exceedStart !== -1) {
    const start = recentMovements[exceedStart].timestamp
    exceedDuration = Math.max(exceedDuration, now - start)
  }

  if (maxExceedRatio <= 1) return null

  let confidence: Confidence
  if (maxExceedRatio < 1.2) confidence = 'low'
  else if (maxExceedRatio < 1.5) confidence = 'medium'
  else confidence = 'high'

  const maxSpeed = recentMovements.reduce(
    (max, m) => Math.max(max, Math.sqrt(m.vx * m.vx + m.vz * m.vz)),
    0,
  )

  return {
    playerId: state.playerId,
    cheatType: 'speed',
    confidence,
    evidence: [
      { metric: 'horizontal_speed', value: maxSpeed, threshold, duration: exceedDuration },
      { metric: 'exceed_ratio', value: maxExceedRatio, threshold: 1.0, duration: exceedDuration },
      { metric: 'speed_effect_level', value: speedEffectLevel, threshold: 0, duration: 0 },
      { metric: 'beacon_speed_level', value: beaconSpeedLevel, threshold: 0, duration: 0 },
    ],
    timestamp: now,
  }
}

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
    evidence.push({
      metric: 'high_angle_attack_ratio',
      value: angleRatio,
      threshold: 0.3,
      duration: 30_000,
    })
  }

  const maxCps = recentCombats.reduce((max, c) => Math.max(max, c.cps), 0)
  if (maxCps > 15) {
    score += 25
    evidence.push({
      metric: 'max_cps',
      value: maxCps,
      threshold: 15,
      duration: 30_000,
    })
  }

  if (state.hitRate > 0.95) {
    score += 20
    evidence.push({
      metric: 'hit_rate',
      value: state.hitRate * 100,
      threshold: 95,
      duration: 30_000,
    })
  }

  const oneSecondWindows = new Map<number, Set<string>>()
  for (const c of recentCombats) {
    const windowKey = Math.floor(c.timestamp / 1000)
    let targets = oneSecondWindows.get(windowKey)
    if (!targets) {
      targets = new Set()
      oneSecondWindows.set(windowKey, targets)
    }
    targets.add(c.victimId)
  }
  const maxTargetsInWindow = Array.from(oneSecondWindows.values()).reduce(
    (max, s) => Math.max(max, s.size),
    0,
  )
  if (maxTargetsInWindow >= 3) {
    score += 25
    evidence.push({
      metric: 'max_targets_per_second',
      value: maxTargetsInWindow,
      threshold: 3,
      duration: 1000,
    })
  }

  if (score < 30) return null

  let confidence: Confidence
  if (score < 50) confidence = 'low'
  else if (score < 75) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId,
    cheatType: 'kill_aura',
    confidence,
    evidence,
    timestamp: now,
  }
}

function checkXRay(state: PlayerState, data: RecentData): CheatDetection | null {
  const now = Date.now()
  const recentBlocks = data.blocks.filter(
    b => b.action === 'break' && now - b.timestamp < 300_000,
  )

  if (recentBlocks.length < 20) return null

  const last100 = recentBlocks.slice(-100)

  const valuableTypes = new Set([
    'diamond_ore',
    'deepslate_diamond_ore',
    'emerald_ore',
    'deepslate_emerald_ore',
    'ancient_debris',
  ])
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
    playerId: state.playerId,
    cheatType: 'x_ray',
    confidence,
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
  const recentBlocks = data.blocks.filter(
    b => b.action === 'place' && now - b.timestamp < 10_000,
  )

  if (recentBlocks.length < 5) return null

  const oneSecondWindows = new Map<number, number>()
  for (const b of recentBlocks) {
    const windowKey = Math.floor(b.timestamp / 1000)
    oneSecondWindows.set(windowKey, (oneSecondWindows.get(windowKey) ?? 0) + 1)
  }

  const maxBlocksPerSec = Math.max(...oneSecondWindows.values())
  const SCAFFOLD_THRESHOLD = 6

  if (maxBlocksPerSec <= SCAFFOLD_THRESHOLD) return null

  const sustainedSeconds = Array.from(oneSecondWindows.values()).filter(
    v => v > SCAFFOLD_THRESHOLD,
  ).length

  let confidence: Confidence
  if (sustainedSeconds < 2) confidence = 'low'
  else if (sustainedSeconds < 4) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId,
    cheatType: 'scaffold',
    confidence,
    evidence: [
      { metric: 'max_blocks_per_second', value: maxBlocksPerSec, threshold: SCAFFOLD_THRESHOLD, duration: 10_000 },
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

  const AUTO_CLICKER_CPS = 16
  const AUTO_CLICKER_DURATION = 10_000

  const oneSecondWindows = new Map<number, { cps: number; count: number }>()
  for (const c of recentCombats) {
    const windowKey = Math.floor(c.timestamp / 1000)
    const existing = oneSecondWindows.get(windowKey)
    if (existing) {
      existing.cps = Math.max(existing.cps, c.cps)
      existing.count++
    } else {
      oneSecondWindows.set(windowKey, { cps: c.cps, count: 1 })
    }
  }

  const highCpsWindows = Array.from(oneSecondWindows.entries())
    .filter(([, v]) => v.cps > AUTO_CLICKER_CPS)
    .sort(([a], [b]) => a - b)

  if (highCpsWindows.length === 0) return null

  let maxConsecutive = 1
  let consecutive = 1
  for (let i = 1; i < highCpsWindows.length; i++) {
    if (highCpsWindows[i][0] === highCpsWindows[i - 1][0] + 1) {
      consecutive++
      maxConsecutive = Math.max(maxConsecutive, consecutive)
    } else {
      consecutive = 1
    }
  }

  const sustainedMs = maxConsecutive * 1000
  if (sustainedMs < AUTO_CLICKER_DURATION) return null

  const maxCps = Math.max(...highCpsWindows.map(([, v]) => v.cps))

  let confidence: Confidence
  if (maxCps < 20) confidence = 'low'
  else if (maxCps < 25) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId,
    cheatType: 'auto_clicker',
    confidence,
    evidence: [
      { metric: 'max_cps', value: maxCps, threshold: AUTO_CLICKER_CPS, duration: sustainedMs },
      { metric: 'sustained_duration', value: sustainedMs, threshold: AUTO_CLICKER_DURATION, duration: sustainedMs },
    ],
    timestamp: now,
  }
}

function checkReach(state: PlayerState, data: RecentData): CheatDetection | null {
  if (state.gameMode === 'creative' || state.gameMode === 'spectator') return null

  const now = Date.now()
  const recentCombats = data.combats.filter(c => now - c.timestamp < 30_000)

  if (recentCombats.length < 2) return null

  const REACH_THRESHOLD = 4.0

  const reachViolations = recentCombats.filter(c => c.distance > REACH_THRESHOLD)
  if (reachViolations.length === 0) return null

  const maxDistance = Math.max(...reachViolations.map(c => c.distance))
  const violationRatio = reachViolations.length / recentCombats.length

  let confidence: Confidence
  if (violationRatio < 0.3 || maxDistance < 4.5) confidence = 'low'
  else if (violationRatio < 0.6 || maxDistance < 5.0) confidence = 'medium'
  else confidence = 'high'

  return {
    playerId: state.playerId,
    cheatType: 'reach',
    confidence,
    evidence: [
      { metric: 'max_attack_distance', value: maxDistance, threshold: REACH_THRESHOLD, duration: 30_000 },
      { metric: 'violation_ratio', value: violationRatio, threshold: 0.3, duration: 30_000 },
    ],
    timestamp: now,
  }
}

export function evaluate(
  playerId: string,
  playerState: PlayerState,
  recentData: RecentData,
): CheatDetection[] {
  const detections: CheatDetection[] = []

  const flyResult = checkFly(playerState, recentData)
  if (flyResult) detections.push(flyResult)

  const speedResult = checkSpeed(playerState, recentData)
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

  // ── 优先级互斥处理 ──
  // 当高优先级检测触发时，抑制其互斥组中的低优先级检测
  const suppressedTypes = new Set<CheatType>()
  for (const detection of detections) {
    const mutexTypes = MUTEX_GROUPS.get(detection.cheatType)
    if (mutexTypes) {
      for (const suppressed of mutexTypes) {
        suppressedTypes.add(suppressed)
      }
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

  // 记录检测结果
  for (const d of result) {
    logDetection({
      type: 'detection_result',
      playerId,
      cheatType: d.cheatType,
      details: `${d.cheatType} detected (confidence: ${d.confidence})`,
    })
  }

  return result
}

export class DetectionEngine {
  private cooldowns = new Map<string, Map<CheatType, number>>()
  private cooldownMs: number

  constructor(cooldownMs = 3000) {
    this.cooldownMs = cooldownMs
  }

  evaluate(playerId: string, playerState: PlayerState, recentData: RecentData): CheatDetection[] {
    const allDetections = evaluate(playerId, playerState, recentData)
    const now = Date.now()

    const filtered: CheatDetection[] = []
    for (const detection of allDetections) {
      const playerCooldowns = this.cooldowns.get(playerId)
      const lastTime = playerCooldowns?.get(detection.cheatType)

      if (lastTime !== undefined && now - lastTime < this.cooldownMs) {
        continue
      }

      filtered.push(detection)

      let pc = this.cooldowns.get(playerId)
      if (!pc) {
        pc = new Map()
        this.cooldowns.set(playerId, pc)
      }
      pc.set(detection.cheatType, now)
    }

    return this.fuseSignals(filtered)
  }

  /** 多信号融合：当同一玩家同时触发多种作弊类型时，提升整体置信度 */
  private fuseSignals(detections: CheatDetection[]): CheatDetection[] {
    if (detections.length <= 1) return detections

    // 多种作弊同时触发 → 所有检测的 confidence 提升 1 级
    return detections.map(d => ({
      ...d,
      confidence: d.confidence === 'low' ? 'medium' as const : d.confidence === 'medium' ? 'high' as const : 'high' as const,
      evidence: [...d.evidence, { metric: 'multi_signal_fusion', value: detections.length, threshold: 2, duration: 0 }],
    }))
  }

  clearPlayer(playerId: string): void {
    this.cooldowns.delete(playerId)
  }

  /** 关闭检测引擎，释放资源 */
  destroy(): void {
    this.cooldowns.clear()
  }
}

export { checkFly, checkSpeed, checkKillAura, checkXRay, checkScaffold, checkAutoClicker, checkReach }
