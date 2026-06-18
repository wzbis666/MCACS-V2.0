// @desc VerificationGate — 多维度验证器
//
// 在处罚执行前进行最终确认，防止误报风暴和基线不成熟时的误判。

import type { CheatType, Confidence, CheatDetection } from '../contracts/index.js'
import type { PlayerBaseline } from './baseline-tracker.js'

export interface VerificationResult {
  pass: boolean
  reason?: string
}

export class VerificationGate {
  /**
   * 验证检测结果是否可信
   */
  verify(
    playerId: string,
    cheatType: CheatType,
    confidence: Confidence,
    vpTotal: number,
    recentDetections: CheatDetection[],
    baseline: PlayerBaseline | null,
  ): VerificationResult {
    // 规则 1：低置信度 + 极低 VP → 不执行处罚（仅记录）
    // 放宽阈值：VP >= 5 即允许处罚（之前是 15，导致大量真实作弊无法被处罚）
    if (confidence === 'low' && vpTotal < 5) {
      return { pass: false, reason: 'Low confidence with insufficient VP' }
    }

    // 规则 2：基线不成熟时仅在极低VP时阻止处罚
    // 放宽：样本 < 30 且 VP < 10 才阻止（之前是 < 50 且 < 30，新玩家几乎不可能被处罚）
    if (baseline && baseline.sampleCount < 30 && vpTotal < 10) {
      return { pass: false, reason: 'Insufficient baseline data' }
    }

    // 规则 3：短时间内大量检测可能是误报风暴（>20次/分钟）
    // 放宽：从 10 提升到 20，避免正常连续检测被误判为风暴
    const now = Date.now()
    const recentCount = recentDetections.filter(d => now - d.timestamp < 60_000).length
    if (recentCount > 20) {
      return { pass: false, reason: 'Detection storm — possible false positive' }
    }

    return { pass: true }
  }
}
