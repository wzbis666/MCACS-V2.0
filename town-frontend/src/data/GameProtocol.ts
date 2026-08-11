// GameProtocol — re-exports GameEvent from bridge and defines GameAction types

export type {
  GameEvent,
} from '../../../src/bridge/game-event.js'

// ── GameAction: Frontend → Server messages ──

export type AdminActionType = 'ban' | 'unban' | 'whitelist'

export interface AdminAction {
  type: 'admin_action'
  action: AdminActionType
  playerId: string
  reason?: string
  duration?: string
}

export interface UserMessage {
  type: 'user_message'
  text: string
}

export interface AbortRequested {
  type: 'abort_requested'
  npcId: string
}

export interface NpcMoveCompleted {
  type: 'npc_move_completed'
  npcId: string
}

export interface WorkstationReleasedAction {
  type: 'workstation_released'
  npcId: string
  stationId: string
}

export type GameAction =
  | AdminAction
  | UserMessage
  | AbortRequested
  | NpcMoveCompleted
  | WorkstationReleasedAction

// ── WebSocket message envelope ──

export interface WSMessage {
  event?: unknown // GameEvent from server
  action?: GameAction // action to send to server
}

export function serializeAction(action: GameAction): string {
  return JSON.stringify(action)
}

export function parseMessage(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}
