// @desc Player state machine and structured state for the anti-cheat system

import type { CheatType, Confidence, PlayerPhase } from './anticheat-events.js'

export interface PlayerState {
  playerId: string
  name: string
  ip: string
  gameMode: string
  phase: PlayerPhase
  // Real-time data
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  onGround: boolean
  cps: number
  hitRate: number
  // Tracking
  cheatRecordCount: number
  lastAlertTime: number
  monitoringEndTime: number
  // Workstation (monitor station) assignment
  stationId?: string
}

export interface PlayerStateSnapshot {
  playerId: string
  name: string
  phase: PlayerPhase
  position: { x: number; y: number; z: number }
  cheatRecordCount: number
  activeAlerts: Array<{
    cheatType: CheatType
    confidence: Confidence
    timestamp: number
  }>
}

export interface CheatRecord {
  id: string
  playerId: string
  playerName: string
  cheatType: CheatType
  confidence: Confidence
  evidence: Array<{ metric: string; value: number; threshold: number; duration: number }>
  action: string
  actionResult: string
  timestamp: number
}

export interface BanEntry {
  playerId: string
  playerName: string
  reason: string
  duration: string // '1h' | '6h' | '24h' | '7d' | '30d' | 'permanent'
  bannedAt: number
  expiresAt: number | null // null = permanent
  active: boolean
  source?: string // 操作人（'anticheat' = 自动, 'admin:xxx' = 管理员）
  unbannedAt?: number // 解封时间戳
  unbanSource?: string // 解封操作人
}

export interface WhitelistEntry {
  playerId: string
  playerName: string
  addedAt: number
  reason?: string
  /** 标记为移除记录（JSONL 持久化用），不活跃时表示已移除 */
  active?: boolean
}

export interface ServerStats {
  onlinePlayers: number
  totalPlayers: number
  activeAlerts: number
  alertsByType: Record<CheatType, number>
  totalBans: number
  whitelistCount: number
}
