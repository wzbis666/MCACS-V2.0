import type { WsServer } from './ws-server.js'
import type { PlayerTracker } from './player-tracker.js'
import type { AlertManager } from './alert-manager.js'
import type { BanManager } from './ban-manager.js'
import type { RecordStore } from './record-store.js'
import type { ActionDispatcher } from './action-dispatcher.js'
import type { VPManager } from './vp-manager.js'
import type { PenaltyEngine } from './penalty-engine.js'
import type { IPTracker } from './ip-tracker.js'
import type { AppealManager } from './appeal-manager.js'
import type { BaselineTracker } from './baseline-tracker.js'
import type { VerificationGate } from './verification.js'

export interface Runtime {
  wsServer: WsServer
  playerTracker: PlayerTracker
  alertManager: AlertManager
  banManager: BanManager
  recordStore: RecordStore
  actionDispatcher: ActionDispatcher
  vpManager: VPManager
  penaltyEngine: PenaltyEngine
  ipTracker: IPTracker
  appealManager: AppealManager
  baselineTracker: BaselineTracker
  verificationGate: VerificationGate
}

let runtime: Runtime | null = null

export function setRuntime(r: Runtime): void {
  runtime = r
}

export function getRuntime(): Runtime | null {
  return runtime
}
