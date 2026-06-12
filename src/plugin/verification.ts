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
    // 规则 1：低置信度 + 低 VP → 不执行处罚（仅记录）
    if (confidence === 'low' && vpTotal < 15) {
      return { pass: false, reason: 'Low confidence with insufficient VP' }
    }

    // 规则 2：基线不成熟时降低处罚等级
    if (baseline && baseline.sampleCount < 50 && vpTotal < 30) {
      return { pass: false, reason: 'Insufficient baseline data' }
    }

    // 规则 3：短时间内大量检测可能是误报风暴（>10次/分钟）
    const now = Date.now()
    const recentCount = recentDetections.filter(d => now - d.timestamp < 60_000).length
    if (recentCount > 10) {
      return { pass: false, reason: 'Detection storm — possible false positive' }
    }

    return { pass: true }
  }
}
