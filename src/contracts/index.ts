// @desc Public entry — re-exports all contract types

// Anti-cheat events
export type {
  CheatType,
  Confidence,
  ActionType,
  PlayerPhase,
  Evidence,
  CheatDetection,
  AntiCheatEvent,
} from './anticheat-events.js';

// Player state
export type {
  PlayerState,
  PlayerStateSnapshot,
  CheatRecord,
  BanEntry,
  WhitelistEntry,
  ServerStats,
} from './player-state.js';

// Actions
export type {
  SpigotAction,
  SpigotMessage,
  BanRequest,
  UnbanRequest,
  WhitelistRequest,
  RecordsQuery,
} from './actions.js'

// Penalty
export type {
  PenaltyLevel,
  PenaltyThreshold,
  VPEntry,
  PenaltyRecord,
} from '../plugin/vp-manager.js'
export {
  VP_WEIGHTS,
  VP_TYPE_MULTIPLIERS,
  PENALTY_THRESHOLDS,
  VPManager,
} from '../plugin/vp-manager.js'
export type {
  PenaltyResult,
} from '../plugin/penalty-engine.js'
export {
  PenaltyEngine,
} from '../plugin/penalty-engine.js';

// IP Tracker & Appeal
export type {
  IPEntry,
} from '../plugin/ip-tracker.js'
export {
  IPTracker,
} from '../plugin/ip-tracker.js'
export type {
  AppealRecord,
} from '../plugin/appeal-manager.js'
export {
  AppealManager,
} from '../plugin/appeal-manager.js'
