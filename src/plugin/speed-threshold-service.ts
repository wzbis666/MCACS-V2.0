// @desc SpeedThresholdService — 动态速度阈值服务
//
// 通过联网获取 Minecraft 各状态下的理论最大移动速度，
// 并定期更新。网络异常时使用本地缓存的最新阈值。
//
// Minecraft 1.20.4 理论速度参考（blocks/tick → blocks/s，1 tick = 50ms = 20 ticks/s）：
//   步行: 4.317 m/s (0.21586 b/t)
//   疾跑: 5.612 m/s (0.2806 b/t)
//   疾跑+跳跃: ~7.0 m/s
//   速度 II 药水+疾跑: ~14.0 m/s
//   速度 II+信标3级: ~20.0 m/s
//   飞行(创造): 10.92 m/s
//   鞘翅: ~67.0 m/s (俯冲)
//
// 阈值设定原则：取各合法状态下的理论上限 × 1.1 安全系数

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

  /** 步行速度阈值 (blocks/s) */
  walk: number
  /** 疾跑速度阈值 (blocks/s) */
  sprint: number
  /** 疾跑+跳跃速度阈值 (blocks/s) */
  sprintJump: number
  /** 速度 I 药水+疾跑阈值 (blocks/s) */
  speed1Sprint: number
  /** 速度 II 药水+疾跑阈值 (blocks/s) */
  speed2Sprint: number
  /** 速度 II+信标3级阈值 (blocks/s) */
  speed2Beacon3: number
  /** 垂直上升速度阈值 (blocks/s) — 非飞行 */
  verticalClimb: number
  /** 鞘翅水平速度阈值 (blocks/s) */
  elytraHorizontal: number
}

// ── 默认阈值（基于 Minecraft Wiki 数据 + 10% 安全系数） ──

const DEFAULT_THRESHOLDS: SpeedThresholds = {
  version: '1.20.4-v1',
  updatedAt: new Date().toISOString(),
  source: 'builtin',

  walk: 5.0,            // 4.317 × 1.15
  sprint: 6.5,          // 5.612 × 1.15
  sprintJump: 8.0,      // ~7.0 × 1.15
  speed1Sprint: 11.0,   // ~9.9 × 1.1
  speed2Sprint: 15.5,   // ~14.0 × 1.1
  speed2Beacon3: 22.0,  // ~20.0 × 1.1
  verticalClimb: 0.8,   // 跳跃+药水上升
  elytraHorizontal: 75.0, // 鞘翅俯冲 × 1.1
}

// ── 远程阈值获取 URL（可配置） ──

const DEFAULT_REMOTE_URL = 'https://raw.githubusercontent.com/minecraft-anticheat/speed-thresholds/main/thresholds-1.20.4.json'

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
    hasSpeedEffect?: number  // 药水等级 0/1/2
    hasBeaconSpeed?: number  // 信标等级 0/1/2/3
    isElytraFlying?: boolean
  }): number {
    const t = this.thresholds

    // 鞘翅飞行
    if (context.isElytraFlying) {
      return t.elytraHorizontal
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
      'version', 'walk', 'sprint', 'sprintJump',
      'speed1Sprint', 'speed2Sprint', 'speed2Beacon3',
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
