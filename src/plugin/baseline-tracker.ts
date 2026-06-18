// @desc BaselineTracker — 行为基线建模
//
// 为每个玩家建立行为基线（移动速度分布、CPS 分布等），
// 检测偏离基线的异常行为，作为规则引擎的补充检测手段。

export interface PlayerBaseline {
  playerId: string
  avgSpeed: number
  speedStdDev: number
  avgCps: number
  cpsStdDev: number
  avgHitRate: number
  oreRatio: number
  playTimeMinutes: number
  lastUpdated: number
  sampleCount: number
}

const MIN_SAMPLES_FOR_MATURE = 50

export class BaselineTracker {
  private baselines = new Map<string, PlayerBaseline>()

  /** 更新玩家基线 */
  updateBaseline(playerId: string, metrics: {
    speed?: number
    cps?: number
    hitRate?: number
    oreRatio?: number
  }): void {
    let baseline = this.baselines.get(playerId)
    if (!baseline) {
      baseline = {
        playerId,
        avgSpeed: 0,
        speedStdDev: 0,
        avgCps: 0,
        cpsStdDev: 0,
        avgHitRate: 0,
        oreRatio: 0,
        playTimeMinutes: 0,
        lastUpdated: Date.now(),
        sampleCount: 0,
      }
      this.baselines.set(playerId, baseline)
    }

    const n = baseline.sampleCount + 1
    const alpha = 1 / n // 简单移动平均

    if (metrics.speed !== undefined) {
      const delta = metrics.speed - baseline.avgSpeed
      baseline.avgSpeed += alpha * delta
      baseline.speedStdDev = Math.sqrt(
        (baseline.speedStdDev * baseline.speedStdDev * (n - 1) + delta * (metrics.speed - baseline.avgSpeed)) / n
      )
    }

    if (metrics.cps !== undefined) {
      const delta = metrics.cps - baseline.avgCps
      baseline.avgCps += alpha * delta
      baseline.cpsStdDev = Math.sqrt(
        (baseline.cpsStdDev * baseline.cpsStdDev * (n - 1) + delta * (metrics.cps - baseline.avgCps)) / n
      )
    }

    if (metrics.hitRate !== undefined) {
      baseline.avgHitRate += alpha * (metrics.hitRate - baseline.avgHitRate)
    }

    if (metrics.oreRatio !== undefined) {
      baseline.oreRatio += alpha * (metrics.oreRatio - baseline.oreRatio)
    }

    baseline.sampleCount = n
    baseline.lastUpdated = Date.now()
  }

  /** 获取偏离分数（0-1，越高越异常） */
  getDeviationScore(playerId: string, metrics: {
    speed?: number
    cps?: number
    hitRate?: number
  }): number {
    const baseline = this.baselines.get(playerId)
    if (!baseline || baseline.sampleCount < MIN_SAMPLES_FOR_MATURE) return 0

    let totalScore = 0
    let dimensions = 0

    if (metrics.speed !== undefined && baseline.speedStdDev > 0) {
      const zScore = Math.abs(metrics.speed - baseline.avgSpeed) / baseline.speedStdDev
      totalScore += Math.min(zScore / 5, 1) // z=5 → score=1
      dimensions++
    }

    if (metrics.cps !== undefined && baseline.cpsStdDev > 0) {
      const zScore = Math.abs(metrics.cps - baseline.avgCps) / baseline.cpsStdDev
      totalScore += Math.min(zScore / 5, 1)
      dimensions++
    }

    if (metrics.hitRate !== undefined) {
      const deviation = Math.abs(metrics.hitRate - baseline.avgHitRate)
      totalScore += Math.min(deviation * 2, 1)
      dimensions++
    }

    return dimensions > 0 ? totalScore / dimensions : 0
  }

  /** 基线是否足够成熟 */
  isBaselineMature(playerId: string): boolean {
    const baseline = this.baselines.get(playerId)
    return baseline !== undefined && baseline.sampleCount >= MIN_SAMPLES_FOR_MATURE
  }

  /** 获取玩家基线 */
  getBaseline(playerId: string): PlayerBaseline | undefined {
    return this.baselines.get(playerId)
  }

  /** 移除玩家基线 */
  removePlayer(playerId: string): void {
    this.baselines.delete(playerId)
  }
}
