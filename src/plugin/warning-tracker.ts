// @desc WarningTracker — 首次警告追踪器
//
// 追踪每个玩家的警告次数，实现分级处罚：
// - 首次检测到作弊：仅显示警告，记录作弊类型和时间
// - 第二次检测到同一玩家作弊：立即执行封禁

import type { CheatType, Confidence, Evidence } from '../contracts/index.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface WarningRecord {
  playerId: string
  playerName: string
  cheatType: CheatType
  confidence: Confidence
  evidence: Evidence[]
  timestamp: number
}

export interface PlayerWarningState {
  playerId: string
  playerName: string
  /** 累计警告次数 */
  warningCount: number
  /** 各作弊类型的警告次数 */
  warningByType: Record<CheatType, number>
  /** 警告记录列表 */
  warnings: WarningRecord[]
  /** 最后一次警告时间 */
  lastWarningTime: number
  /** 是否已收到首次警告（用于即时警告判断） */
  hasReceivedFirstWarning: boolean
}

export class WarningTracker {
  private playerStates = new Map<string, PlayerWarningState>()
  private dataDir: string
  /** 警告过期时间（毫秒）：超过此时间的警告不计入二次处罚 */
  private warningExpiryMs: number
  /** 最大保留警告记录数 */
  private maxWarningsPerPlayer: number
  /** 二次违规封禁时长 */
  private secondOffenseBanDuration: string

  constructor(dataDir: string, opts?: {
    warningExpiryMs?: number
    maxWarningsPerPlayer?: number
    secondOffenseBanDuration?: string
  }) {
    this.dataDir = dataDir
    this.warningExpiryMs = opts?.warningExpiryMs ?? 30 * 60 * 1000 // 默认30分钟
    this.maxWarningsPerPlayer = opts?.maxWarningsPerPlayer ?? 50
    this.secondOffenseBanDuration = opts?.secondOffenseBanDuration ?? '24h'
    this.loadFromDisk()
  }

  /** 获取二次违规封禁时长 */
  getSecondOffenseBanDuration(): string {
    return this.secondOffenseBanDuration
  }

  /** 设置二次违规封禁时长 */
  setSecondOffenseBanDuration(duration: string): void {
    this.secondOffenseBanDuration = duration
  }

  /**
   * 记录一次检测并返回警告决策
   * @returns isFirstWarning=true 表示首次警告，isSecondOffense=true 表示二次违规应立即封禁
   */
  recordDetection(
    playerId: string,
    playerName: string,
    cheatType: CheatType,
    confidence: Confidence,
    evidence: Evidence[],
  ): { isFirstWarning: boolean; isSecondOffense: boolean; warningCount: number } {
    let state = this.playerStates.get(playerId)
    if (!state) {
      state = {
        playerId,
        playerName,
        warningCount: 0,
        warningByType: { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 },
        warnings: [],
        lastWarningTime: 0,
        hasReceivedFirstWarning: false,
      }
      this.playerStates.set(playerId, state)
    }

    // 清理过期警告
    this.cleanExpiredWarnings(state)

    // 记录警告
    const warning: WarningRecord = {
      playerId,
      playerName,
      cheatType,
      confidence,
      evidence,
      timestamp: Date.now(),
    }

    state.warnings.push(warning)
    state.warningCount++
    state.warningByType[cheatType] = (state.warningByType[cheatType] ?? 0) + 1
    state.lastWarningTime = Date.now()

    // 限制记录数量
    if (state.warnings.length > this.maxWarningsPerPlayer) {
      state.warnings = state.warnings.slice(-this.maxWarningsPerPlayer)
    }

    const isFirstWarning = !state.hasReceivedFirstWarning
    state.hasReceivedFirstWarning = true

    // 二次违规判定：已收到首次警告后，再次检测到任何作弊行为
    const isSecondOffense = !isFirstWarning && state.warningCount >= 2

    this.saveToDisk()

    return { isFirstWarning, isSecondOffense, warningCount: state.warningCount }
  }

  /** 获取玩家警告状态 */
  getPlayerState(playerId: string): PlayerWarningState | undefined {
    return this.playerStates.get(playerId)
  }

  /** 获取玩家警告次数 */
  getWarningCount(playerId: string): number {
    return this.playerStates.get(playerId)?.warningCount ?? 0
  }

  /** 玩家是否已收到首次警告 */
  hasFirstWarning(playerId: string): boolean {
    return this.playerStates.get(playerId)?.hasReceivedFirstWarning ?? false
  }

  /** 清除玩家警告记录（封禁执行后调用） */
  clearPlayer(playerId: string): void {
    this.playerStates.delete(playerId)
    this.saveToDisk()
  }

  /** 重置玩家的首次警告标记（封禁到期后调用） */
  resetFirstWarning(playerId: string): void {
    const state = this.playerStates.get(playerId)
    if (state) {
      state.hasReceivedFirstWarning = false
      state.warningCount = 0
      state.warningByType = { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 }
      this.saveToDisk()
    }
  }

  /** 清理过期警告 */
  private cleanExpiredWarnings(state: PlayerWarningState): void {
    const cutoff = Date.now() - this.warningExpiryMs
    const before = state.warnings.length
    state.warnings = state.warnings.filter(w => w.timestamp > cutoff)
    // 重新计算计数
    if (state.warnings.length < before) {
      state.warningCount = state.warnings.length
      state.warningByType = { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 }
      for (const w of state.warnings) {
        state.warningByType[w.cheatType] = (state.warningByType[w.cheatType] ?? 0) + 1
      }
    }
  }

  /** 获取所有有警告记录的玩家 */
  getAllWarnedPlayers(): PlayerWarningState[] {
    return Array.from(this.playerStates.values())
  }

  // ── 持久化 ──

  private getFilePath(): string {
    return join(this.dataDir, 'warning-tracker.json')
  }

  private loadFromDisk(): void {
    const filePath = this.getFilePath()
    if (!existsSync(filePath)) return

    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (Array.isArray(data)) {
        for (const state of data) {
          this.playerStates.set(state.playerId, state)
        }
      }
    } catch (err) {
      console.error('[WarningTracker] Failed to load from disk:', err)
    }
  }

  private saveToDisk(): void {
    const filePath = this.getFilePath()
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true })
      }
      const data = Array.from(this.playerStates.values())
      writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[WarningTracker] Failed to save to disk:', err)
    }
  }

  /** 销毁时保存 */
  destroy(): void {
    this.saveToDisk()
  }
}
