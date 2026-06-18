// @desc SpeedThresholdService — 动态速度阈值服务
//
// 通过联网获取 Minecraft 各状态下的理论最大移动速度，
// 并定期更新。网络异常时使用本地缓存的最新阈值。
//
// Minecraft 1.20.4 理论速度参考（blocks/s，1 tick = 50ms = 20 ticks/s）：
//
//   ── 步行/疾跑 ──
//   步行:        4.317 blocks/s  (0.216 b/t)
//   疾跑:        5.612 blocks/s  (0.281 b/t)
//   疾跑+跳跃:   ~7.0  blocks/s  (含空中惯性)
//   冰面疾跑:    ~7.5  blocks/s  (摩擦系数 0.98)
//
//   ── 速度药水 ──
//   速度 I 行走:    5.18  blocks/s
//   速度 I 疾跑:    6.73  blocks/s
//   速度 II 疾跑:   7.86  blocks/s
//   速度 II+信标3:  ~20.0 blocks/s
//
//   ── 骑乘/载具 ──
//   矿车(充能轨):   8.0   blocks/s
//   船(水面):       8.4   blocks/s
//   船(蓝冰):       16.6  blocks/s
//   马(最快):       ~14.5 blocks/s
//
//   ── 特殊 ──
//   鞘翅(滑翔):     7.5~10  blocks/s
//   鞘翅(火箭):     ~67   blocks/s
//   激流 III(瞬间): ~200  blocks/s (极短暂)
//
// 阈值设定原则：
//   步行/疾跑/跳跃: 理论值 × 1.30 安全系数（考虑采样误差、TPS波动）
//   药水/信标:      理论值 × 1.25 安全系数
//   载具:           理论值 × 1.20 安全系数
//   鞘翅:           理论值 × 1.10 安全系数

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { setInterval, clearInterval } from 'node:timers'

// ── 速度阈值数据结构 ──

export interface SpeedThresholds {
  /** 版本标识（用于判断阈值是否需要更新） */
  version: string
  /** 最后更新时间（ISO 8601） */
  updatedAt: string
  /** 数据来源 */
  source: string

  /** 步行速度阈值 (blocks/s) — 理论 4.317 × 1.30 */
  walk: number
  /** 疾跑速度阈值 (blocks/s) — 理论 5.612 × 1.30 */
  sprint: number
  /** 疾跑+跳跃速度阈值 (blocks/s) — 理论 ~7.0 × 1.30 */
  sprintJump: number
  /** 冰面疾跑速度阈值 (blocks/s) — 理论 ~7.5 × 1.30 */
  iceSprint: number
  /** 速度 I 药水+疾跑阈值 (blocks/s) — 理论 6.73 × 1.25 */
  speed1Sprint: number
  /** 速度 II 药水+疾跑阈值 (blocks/s) — 理论 7.86 × 1.25 */
  speed2Sprint: number
  /** 速度 II+信标3级阈值 (blocks/s) — 理论 ~20.0 × 1.25 */
  speed2Beacon3: number
  /** 船速度阈值 (blocks/s) — 蓝冰 16.6 × 1.20 */
  boat: number
  /** 矿车速度阈值 (blocks/s) — 充能轨 8.0 × 1.20 */
  minecart: number
  /** 骑乘速度阈值 (blocks/s) — 最快马 ~14.5 × 1.20 */
  mount: number
  /** 垂直上升速度阈值 (blocks/s) — 非飞行 */
  verticalClimb: number
  /** 鞘翅水平速度阈值 (blocks/s) */
  elytraHorizontal: number
}

// ── 默认阈值（基于 Minecraft Wiki 数据 + 安全系数） ──

const DEFAULT_THRESHOLDS: SpeedThresholds = {
  version: '1.20.4-v2',
  updatedAt: new Date().toISOString(),
  source: 'builtin',

  // ── 步行/疾跑（×1.30 安全系数） ──
  walk: 5.6,            // 4.317 × 1.30
  sprint: 7.3,          // 5.612 × 1.30
  sprintJump: 9.1,      // ~7.0 × 1.30
  iceSprint: 9.8,       // ~7.5 × 1.30

  // ── 速度药水（×1.25 安全系数） ──
  speed1Sprint: 8.4,    // 6.73 × 1.25
  speed2Sprint: 9.8,    // 7.86 × 1.25
  speed2Beacon3: 25.0,  // ~20.0 × 1.25

  // ── 载具/骑乘（×1.20 安全系数） ──
  boat: 20.0,           // 16.6 (蓝冰) × 1.20
  minecart: 9.6,        // 8.0 × 1.20
  mount: 17.4,          // ~14.5 × 1.20

  // ── 垂直/鞘翅 ──
  verticalClimb: 1.5,   // 跳跃+药水上升（原 0.8 过低，正常跳跃 vy=8.4）
  elytraHorizontal: 75.0, // 鞘翅俯冲 × 1.10
}

// ── 远程阈值获取 URL（可配置） ──

const DEFAULT_REMOTE_URL = process.env.ACS_SPEED_THRESHOLDS_URL ?? ''

// ── 服务类 ──

export class SpeedThresholdService {
  private thresholds: SpeedThresholds
  private cachePath: string
  private remoteUrl: string
  private refreshIntervalMs: number
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private fetchInProgress = false

  constructor(opts?: {
    cachePath?: string
    remoteUrl?: string
    refreshIntervalMs?: number
  }) {
    this.cachePath = opts?.cachePath ?? './speed-thresholds-cache.json'
    this.remoteUrl = opts?.remoteUrl ?? DEFAULT_REMOTE_URL
    this.refreshIntervalMs = opts?.refreshIntervalMs ?? 3600_000 // 默认1小时

    // 1. 尝试从本地缓存加载
    this.thresholds = this.loadFromCache() ?? { ...DEFAULT_THRESHOLDS }
    console.log(`[SpeedThreshold] Loaded thresholds v${this.thresholds.version} (source: ${this.thresholds.source})`)
  }

  /** 启动定期刷新 */
  start(): void {
    if (this.refreshTimer) return
    if (!this.remoteUrl) {
      console.log('[SpeedThreshold] Remote auto-refresh disabled; using local cache/builtin thresholds')
      return
    }
    // 启动时立即尝试获取一次
    this.fetchRemote()
    this.refreshTimer = setInterval(() => this.fetchRemote(), this.refreshIntervalMs)
    console.log(`[SpeedThreshold] Auto-refresh every ${this.refreshIntervalMs / 1000}s from ${this.remoteUrl}`)
  }

  /** 停止定期刷新 */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /** 获取当前阈值 */
  getThresholds(): SpeedThresholds {
    return this.thresholds
  }

  /** 根据玩家状态获取适用的水平速度阈值 */
  getHorizontalThreshold(context: {
    isSprinting?: boolean
    isOnGround?: boolean
    hasSpeedEffect?: number  // 药水等级 0/1/2
    hasBeaconSpeed?: number  // 信标等级 0/1/2/3
    isElytraFlying?: boolean
    isInVehicle?: boolean
    vehicleType?: string     // 'boat' | 'minecart' | 'mount' | ''
    isRiptiding?: boolean
  }): number {
    const t = this.thresholds

    // 激流三叉戟 — 瞬间极高速度，跳过检测
    if (context.isRiptiding) {
      return Infinity
    }

    // 鞘翅飞行
    if (context.isElytraFlying) {
      return t.elytraHorizontal
    }

    // 载具/骑乘
    if (context.isInVehicle) {
      switch (context.vehicleType) {
        case 'boat': return t.boat
        case 'minecart': return t.minecart
        case 'mount': return t.mount
        default: return Math.max(t.boat, t.mount) // 未知载具取最大值
      }
    }

    // 信标+速度药水叠加
    if (context.hasSpeedEffect === 2 && context.hasBeaconSpeed === 3) {
      return t.speed2Beacon3
    }

    // 速度 II 药水
    if (context.hasSpeedEffect === 2) {
      return t.speed2Sprint
    }

    // 速度 I 药水
    if (context.hasSpeedEffect === 1) {
      return t.speed1Sprint
    }

    // 疾跑+跳跃（空中）— 使用更宽松的 sprintJump 阈值
    if (context.isSprinting && !context.isOnGround) {
      return t.sprintJump
    }

    // 普通疾跑
    if (context.isSprinting) {
      return t.sprint
    }

    // 步行
    return t.walk
  }

  /** 获取垂直速度阈值 */
  getVerticalThreshold(): number {
    return this.thresholds.verticalClimb
  }

  // ── 内部方法 ──

  /** 从远程获取最新阈值 */
  private async fetchRemote(): Promise<void> {
    if (this.fetchInProgress) return
    this.fetchInProgress = true

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)

      const response = await fetch(this.remoteUrl, { signal: controller.signal })
      clearTimeout(timeout)

      if (!response.ok) {
        console.warn(`[SpeedThreshold] Remote fetch failed: HTTP ${response.status}`)
        return
      }

      const data = await response.json() as SpeedThresholds

      // 验证数据完整性
      if (!this.validateThresholds(data)) {
        console.warn(`[SpeedThreshold] Remote data validation failed, keeping local cache`)
        return
      }

      // 版本相同则跳过
      if (data.version === this.thresholds.version) {
        return
      }

      const oldVersion = this.thresholds.version
      this.thresholds = { ...data, source: 'remote' }

      // 保存到本地缓存
      this.saveToCache(this.thresholds)

      console.log(`[SpeedThreshold] Updated: v${oldVersion} → v${data.version} (source: remote)`)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn(`[SpeedThreshold] Remote fetch timed out, using local cache (v${this.thresholds.version})`)
      } else {
        console.warn(`[SpeedThreshold] Remote fetch error: ${err.message}, using local cache (v${this.thresholds.version})`)
      }
    } finally {
      this.fetchInProgress = false
    }
  }

  /** 验证阈值数据完整性 */
  private validateThresholds(data: any): data is SpeedThresholds {
    if (!data || typeof data !== 'object') return false
    const required: (keyof SpeedThresholds)[] = [
      'version', 'walk', 'sprint', 'sprintJump', 'iceSprint',
      'speed1Sprint', 'speed2Sprint', 'speed2Beacon3',
      'boat', 'minecart', 'mount',
      'verticalClimb', 'elytraHorizontal',
    ]
    for (const key of required) {
      if (typeof data[key] !== 'number' && typeof data[key] !== 'string') return false
    }
    // 数值合理性检查：步行阈值应 > 0 且 < 100
    if (data.walk <= 0 || data.walk > 100) return false
    if (data.sprint <= data.walk) return false
    return true
  }

  /** 从本地缓存加载 */
  private loadFromCache(): SpeedThresholds | null {
    try {
      if (!existsSync(this.cachePath)) return null
      const content = readFileSync(this.cachePath, 'utf-8')
      const data = JSON.parse(content)
      if (this.validateThresholds(data)) {
        return { ...data, source: 'cache' }
      }
      console.warn(`[SpeedThreshold] Cache validation failed, using defaults`)
      return null
    } catch (err) {
      console.warn(`[SpeedThreshold] Cache load error: ${(err as Error).message}`)
      return null
    }
  }

  /** 保存到本地缓存 */
  private saveToCache(thresholds: SpeedThresholds): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(thresholds, null, 2), 'utf-8')
    } catch (err) {
      console.warn(`[SpeedThreshold] Cache save error: ${(err as Error).message}`)
    }
  }
}
