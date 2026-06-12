// @desc AppealManager — 申诉管理器
//
// 允许被封禁的玩家提交申诉，管理员审核后可回退处罚。
// 申诉记录持久化到 JSONL 文件。

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AppealRecord {
  appealId: string
  playerId: string
  playerName: string
  penaltyId: string
  reason: string       // 申诉理由
  status: 'pending' | 'approved' | 'rejected'
  submittedAt: number
  reviewedAt: number | null
  reviewedBy: string | null  // 管理员 ID
  reviewNote: string | null  // 审核备注
}

export class AppealManager {
  private appeals = new Map<string, AppealRecord>()
  private dataFile: string

  constructor(dataDir: string) {
    this.dataFile = `${dataDir}/appeals.jsonl`

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    this.loadAppeals()
  }

  /** 提交申诉 */
  submitAppeal(playerId: string, playerName: string, penaltyId: string, reason: string): AppealRecord {
    const appealId = `appeal-${playerId}-${Date.now()}`

    const record: AppealRecord = {
      appealId,
      playerId,
      playerName,
      penaltyId,
      reason,
      status: 'pending',
      submittedAt: Date.now(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: null,
    }

    this.appeals.set(appealId, record)
    this.persistAppeal(record)

    return record
  }

  /** 审核申诉（批准） */
  approveAppeal(
    appealId: string,
    reviewerId: string,
    reviewNote: string,
    onApprove?: (playerId: string) => void,
  ): AppealRecord | null {
    const record = this.appeals.get(appealId)
    if (!record || record.status !== 'pending') return null

    record.status = 'approved'
    record.reviewedAt = Date.now()
    record.reviewedBy = reviewerId
    record.reviewNote = reviewNote

    this.persistAppeal(record)

    if (record.status === 'approved' && onApprove) {
      onApprove(record.playerId)
    }

    return record
  }

  /** 审核申诉（驳回） */
  rejectAppeal(appealId: string, reviewedBy: string, note?: string): AppealRecord | null {
    const record = this.appeals.get(appealId)
    if (!record || record.status !== 'pending') return null

    record.status = 'rejected'
    record.reviewedAt = Date.now()
    record.reviewedBy = reviewedBy
    record.reviewNote = note ?? null

    this.persistAppeal(record)
    return record
  }

  /** 获取待审核申诉 */
  getPendingAppeals(): AppealRecord[] {
    return Array.from(this.appeals.values())
      .filter(a => a.status === 'pending')
      .sort((a, b) => a.submittedAt - b.submittedAt)
  }

  /** 获取玩家申诉历史 */
  getPlayerAppeals(playerId: string): AppealRecord[] {
    return Array.from(this.appeals.values())
      .filter(a => a.playerId === playerId)
      .sort((a, b) => b.submittedAt - a.submittedAt)
  }

  /** 获取所有申诉 */
  getAllAppeals(limit: number = 100): AppealRecord[] {
    return Array.from(this.appeals.values())
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .slice(0, limit)
  }

  /** 获取统计 */
  getStats(): { total: number; pending: number; approved: number; rejected: number } {
    let pending = 0, approved = 0, rejected = 0
    for (const a of this.appeals.values()) {
      if (a.status === 'pending') pending++
      else if (a.status === 'approved') approved++
      else if (a.status === 'rejected') rejected++
    }
    return { total: this.appeals.size, pending, approved, rejected }
  }

  private persistAppeal(record: AppealRecord): void {
    try {
      const dir = dirname(this.dataFile)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      appendFileSync(this.dataFile, JSON.stringify(record) + '\n', 'utf-8')
    } catch (err) {
      console.error('[AppealManager] Failed to persist appeal:', err)
    }
  }

  private loadAppeals(): void {
    if (!existsSync(this.dataFile)) return

    try {
      const content = readFileSync(this.dataFile, 'utf-8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line) as AppealRecord
          // 只保留最新状态
          this.appeals.set(record.appealId, record)
        } catch {
          // skip malformed
        }
      }
      console.log(`[AppealManager] Loaded ${this.appeals.size} appeals`)
    } catch (err) {
      console.error('[AppealManager] Failed to load appeals:', err)
    }
  }
}
