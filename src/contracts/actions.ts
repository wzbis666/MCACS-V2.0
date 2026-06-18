// @desc Action types and protocol for Spigot ↔ Node communication

import type { ActionType } from './anticheat-events.js'

// Node → Spigot action messages
export interface SpigotAction {
  type: ActionType
  playerId: string
  actionId?: string // 唯一标识，用于追踪执行结果
  reason?: string
  duration?: string // for ban: '1h' | '6h' | '24h' | '7d' | '30d' | 'permanent'
  cheatType?: string // for ban: determines which detention building to send NPC to
  confidence?: string // for persistent_warning: confidence level
  totalVP?: number // for vp_update: current violation points
  x?: number // for teleport
  y?: number
  z?: number
}

// Spigot → Node raw messages (before translation)
export interface SpigotMessage {
  type: string
  [key: string]: unknown
}

// REST API request/response types
export interface BanRequest {
  playerId: string
  reason: string
  duration: string
}

export interface UnbanRequest {
  playerId: string
}

export interface WhitelistRequest {
  playerId: string
  action: 'add' | 'remove'
}

export interface RecordsQuery {
  playerId?: string
  cheatType?: string
  from?: number
  to?: number
  limit?: number
}
