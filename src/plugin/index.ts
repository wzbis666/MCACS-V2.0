import { randomUUID } from 'node:crypto'
import { WsServer } from './ws-server.js'
import { PlayerTracker } from './player-tracker.js'
import { AlertManager } from './alert-manager.js'
import { BanManager } from './ban-manager.js'
import { RecordStore } from './record-store.js'
import { ActionDispatcher } from './action-dispatcher.js'
import { EditorServe } from './editor-serve.js'
import { DetectionEngine, type RecentData, getCurrentTPS, initSpeedThresholdService, shutdownSpeedThresholdService, updateTPS } from './rule-engine.js'
import { MonitorBridge } from '../bridge/MonitorBridge.js'
import type { AdminAction } from '../bridge/MonitorBridge.js'
import { setRuntime, type Runtime } from './runtime.js'
import { PENALTY_THRESHOLDS, VPManager, type PenaltyThreshold } from './vp-manager.js'
import { PenaltyEngine } from './penalty-engine.js'
import { IPTracker } from './ip-tracker.js'
import { AppealManager } from './appeal-manager.js'
import { loadConfig, startConfigWatch, stopConfigWatch, type PenaltyConfig } from './penalty-config.js'
import { BannedNpcStore } from './banned-npc-store.js'
import { BaselineTracker } from './baseline-tracker.js'
import { VerificationGate } from './verification.js'
import { WarningTracker } from './warning-tracker.js'
import { InvestigationCaseManager, type InvestigationCase } from './investigation-case-manager.js'
import { OperationsSummaryManager } from './operations-summary-manager.js'
import { EvidenceBufferManager, type EvidenceContext } from './evidence-buffer-manager.js'
import { SoftContainmentManager } from './soft-containment-manager.js'
import { AdminCommandStore } from './admin-command-store.js'
import { resolveRuntimeMode } from './runtime-mode.js'
import { resolveStrategyPreset } from './strategy-presets.js'
import { mapGrimCheckToCheatType } from './grim-integration.js'
import type { AntiCheatEvent, SpigotAction, CheatDetection, PlayerPhase } from '../contracts/index.js'
import type { GameEvent } from '../bridge/game-event.js'

const DATA_DIR = './data'
const RECORDS_FILE = `${DATA_DIR}/cheat-records.jsonl`

const MAX_RECENT_MOVEMENTS = 200
const MAX_RECENT_COMBATS = 100
const MAX_RECENT_BLOCKS = 200
const MAX_RECENT_ACTIONS = 50

const recentDataMap = new Map<string, RecentData>()
const playerEvidenceContext = new Map<string, Omit<EvidenceContext, 'tps'>>()

function getEvidenceContext(playerId: string, update?: Partial<Omit<EvidenceContext, 'tps'>>): EvidenceContext {
  const previous = playerEvidenceContext.get(playerId) ?? { ping: null, statusEffects: [], exemptions: [] }
  const current = update ? {
    ping: update.ping ?? previous.ping,
    statusEffects: update.statusEffects ?? previous.statusEffects,
    exemptions: update.exemptions ?? previous.exemptions,
  } : previous
  playerEvidenceContext.set(playerId, current)
  return { tps: getCurrentTPS(), ...current }
}

function investigationCaseEvent(
  investigationCase: InvestigationCase,
  action: 'opened' | 'updated' | 'resolved',
  npcId?: string,
): GameEvent {
  return {
    type: 'investigation_case',
    action,
    caseId: investigationCase.id,
    playerId: investigationCase.playerId,
    npcId,
    playerName: investigationCase.playerName,
    status: investigationCase.status,
    riskLevel: investigationCase.riskLevel,
    riskScore: investigationCase.riskScore,
    confidenceScore: investigationCase.confidenceScore,
    suspectedCheats: investigationCase.suspectedCheats,
    signalCount: investigationCase.signals.length,
    updatedAt: investigationCase.updatedAt,
  }
}

function buildPenaltyThresholds(config: PenaltyConfig): PenaltyThreshold[] {
  return PENALTY_THRESHOLDS.map(threshold => ({
    ...threshold,
    vp: config.thresholds[threshold.level],
  }))
}

function buildVPManagerOptions(config: PenaltyConfig) {
  return {
    whitelistMultiplier: config.whitelistVPMultiplier,
    newPlayerGraceMinutes: config.newPlayerGraceMinutes,
    newPlayerVPMultiplier: config.newPlayerVPMultiplier,
    repeatOffenderWindowDays: config.repeatOffenderWindowDays,
    repeatDurationMultiplier: config.repeatDurationMultiplier,
    autoUpgradeOnNth: config.autoUpgradeOnNth,
    vpWeights: config.vpWeights,
    vpTypeMultipliers: config.vpTypeMultipliers,
    thresholds: buildPenaltyThresholds(config),
    decayIntervalMs: config.decayIntervalMinutes * 60_000,
    decayAmount: config.decayAmount,
    snapshotIntervalMs: config.snapshotIntervalMinutes * 60_000,
  }
}

function getOrCreateRecentData(playerId: string): RecentData {
  let data = recentDataMap.get(playerId)
  if (!data) {
    data = { movements: [], combats: [], blocks: [], actions: [] }
    recentDataMap.set(playerId, data)
  }
  return data
}

function trimRecentData(data: RecentData): void {
  if (data.movements.length > MAX_RECENT_MOVEMENTS) {
    data.movements = data.movements.slice(-MAX_RECENT_MOVEMENTS)
  }
  if (data.combats.length > MAX_RECENT_COMBATS) {
    data.combats = data.combats.slice(-MAX_RECENT_COMBATS)
  }
  if (data.blocks.length > MAX_RECENT_BLOCKS) {
    data.blocks = data.blocks.slice(-MAX_RECENT_BLOCKS)
  }
  if (data.actions.length > MAX_RECENT_ACTIONS) {
    data.actions = data.actions.slice(-MAX_RECENT_ACTIONS)
  }
}

async function main(): Promise<void> {
  const runtimeMode = resolveRuntimeMode()
  const strategyPreset = resolveStrategyPreset()
  const dashboardEnabled = runtimeMode === 'dashboard'
  const recordStore = new RecordStore(RECORDS_FILE)
  const banManager = new BanManager(recordStore, DATA_DIR)
  const playerTracker = new PlayerTracker()
  const alertManager = new AlertManager()

  // ── Penalty system ──
  let config = loadConfig()
  const detectionEngine = new DetectionEngine(config.warningDurationMs)
  const speedThresholdService = initSpeedThresholdService()
  const vpManager = new VPManager(DATA_DIR, buildVPManagerOptions(config))
  const penaltyEngine = new PenaltyEngine(vpManager, {
    enabled: config.enabled,
    actionRetryMax: config.actionRetryMax,
    actionRetryIntervalMs: config.actionRetryIntervalSeconds * 1000,
  })

  // ── IP 关联 & 申诉 ──
  const ipTracker = new IPTracker(config.ipSharedWeight)
  const appealManager = new AppealManager(DATA_DIR)
  const bannedNpcStore = new BannedNpcStore(DATA_DIR)
  // ── 基线建模 & 最终验证 ──
  const baselineTracker = new BaselineTracker()
  const verificationGate = new VerificationGate()
  // ── 首次警告追踪器 ──
  const warningTracker = new WarningTracker(DATA_DIR, {
    warningExpiryMs: config.strikeWindowMinutes * 60_000,
    secondOffenseBanDuration: config.secondOffenseBanDuration,
  })
  const investigationCaseManager = new InvestigationCaseManager(DATA_DIR)
  const operationsSummaryManager = new OperationsSummaryManager(DATA_DIR)
  const evidenceBufferManager = new EvidenceBufferManager(DATA_DIR)
  const softContainmentManager = new SoftContainmentManager(DATA_DIR)
  const adminCommandStore = new AdminCommandStore(DATA_DIR)
  for (const pendingCase of investigationCaseManager.getPendingCases()) {
    evidenceBufferManager.setInvestigating(pendingCase.playerId, true)
  }
  operationsSummaryManager.recordSnapshot(0, getCurrentTPS())
  let actionDispatcher: ActionDispatcher
  let monitorBridge: MonitorBridge

  // 启动配置热重载
  startConfigWatch((newConfig) => {
    config = newConfig
    vpManager.setConfig(buildVPManagerOptions(newConfig))
    penaltyEngine.setEnabled(newConfig.enabled)
    ipTracker.setSharedWeight(newConfig.ipSharedWeight)
    actionDispatcher.setRetryOptions({
      maxAttempts: newConfig.actionRetryMax,
      retryIntervalMs: newConfig.actionRetryIntervalSeconds * 1000,
    })
    detectionEngine.setCooldownMs(newConfig.warningDurationMs)
    warningTracker.setSecondOffenseBanDuration(newConfig.secondOffenseBanDuration)
    warningTracker.setWarningExpiryMs(newConfig.strikeWindowMinutes * 60_000)
    console.log(`[Main] Config reloaded: penalty ${newConfig.enabled ? 'ENABLED' : 'DISABLED'}, cooldown=${newConfig.warningDurationMs}ms, ban=${newConfig.secondOffenseBanDuration}`)
  })

  const wsServer = new WsServer({
    onSpigotEvent(event: AntiCheatEvent) {
      handleSpigotEvent(event)
    },

    onSpigotConnect() {
      // Spigot 重新连接时，同步所有活跃封禁到 Spigot
      // 确保即使之前 Spigot 离线时执行的封禁也能在服务器端生效
      const activeBans = banManager.getActiveBans()
      if (activeBans.length > 0) {
        console.log(`[Main] Spigot reconnected, syncing ${activeBans.length} active bans...`)
        for (const ban of activeBans) {
          actionDispatcher.dispatch({
            type: 'ban',
            playerId: ban.playerId,
            reason: ban.reason,
            duration: ban.duration,
          })
          console.log(`[Main] Synced ban: ${ban.playerName} (${ban.playerId}), reason=${ban.reason}, duration=${ban.duration}`)
        }
      }
    },

    onBrowserAction(action: SpigotAction) {
      // Map frontend action names to admin_action types for MonitorBridge
      const adminActionMap: Record<string, string> = {
        ban: 'admin_ban',
        unban: 'admin_unban',
        kick: 'admin_kick',
        freeze: 'admin_freeze',
        dismiss: 'admin_dismiss',
        whitelist: 'admin_whitelist',
        teleport: 'admin_teleport',
      }
      const adminType = adminActionMap[action.type] ?? action.type

      // 将 npcId 解析为真实 playerId (UUID) — 使用 MonitorBridge 的 tracker（player_XXXXXXXX 格式）
      let resolvedPlayerId = monitorBridge.resolvePlayerId(action.playerId) ?? action.playerId
      if (resolvedPlayerId !== action.playerId) {
        console.log(`[Main] onBrowserAction: resolved npcId=${action.playerId} → playerId=${resolvedPlayerId}`)
      }

      // 如果解析失败（玩家离线），尝试从 BanManager 中查找对应的 UUID 格式 playerId
      if (resolvedPlayerId === action.playerId && action.playerId.startsWith('player_')) {
        const bans = banManager.getActiveBans()
        const prefix = action.playerId.replace('player_', '').toLowerCase()
        const uuidMatch = bans.find(b => b.playerId.toLowerCase().startsWith(prefix))
        if (uuidMatch) {
          console.log(`[Main] onBrowserAction: resolved npcId=${action.playerId} → playerId=${uuidMatch.playerId} (from BanManager)`)
          resolvedPlayerId = uuidMatch.playerId
        }
      }

      // 检查 Spigot 是否在线 — 如果不在线，封禁/踢出等操作无法在服务器端执行
      const requiresSpigot = ['ban', 'unban', 'kick', 'freeze', 'whitelist', 'teleport'].includes(action.type)
      if (requiresSpigot && !wsServer.hasSpigotConnection) {
        console.warn(`[Main] onBrowserAction: Spigot not connected! Action '${action.type}' for ${resolvedPlayerId} will NOT be executed on server.`)
        // 仍然执行本地操作（BanManager 记录 + 视觉效果），但通知前端 Spigot 不在线
        wsServer.broadcastToBrowsers({
          type: 'game_events',
          events: [{
            type: 'alert_popup',
            playerId: resolvedPlayerId,
            npcId: action.playerId,
            cheatType: 'fly' as const,
            confidence: 'high' as const,
            message: `⚠ Spigot 服务器未连接，${action.type === 'ban' ? '封禁' : action.type === 'unban' ? '解封' : '操作'}指令未在服务器端执行`,
          }],
        })
      }

      // Process through MonitorBridge — handles both frontend visual effects
      // and sending Spigot actions (via sendSpigotAction callback)
      monitorBridge.processAdminAction({
        type: adminType,
        playerId: resolvedPlayerId,
        reason: action.reason,
        duration: action.duration,
        cheatType: action.cheatType,
      })

      // 管理员封禁时同步 BanManager
      if (action.type === 'ban') {
        const state = playerTracker.getPlayerState(resolvedPlayerId)
        banManager.banPlayer(
          resolvedPlayerId,
          state?.name ?? action.playerId,
          action.reason ?? 'Banned by Admin',
          action.duration ?? '24h',
          'admin',
        )
      }

      // 管理员解封时同步 BanManager + 清除 VP
      if (action.type === 'unban') {
        banManager.unbanPlayer(resolvedPlayerId, 'admin')
        penaltyEngine.adminDismiss(resolvedPlayerId)
        warningTracker.clearPlayer(resolvedPlayerId)
      }

      // 管理员 dismiss 时清除 VP
      if (adminType === 'admin_dismiss') {
        penaltyEngine.adminDismiss(resolvedPlayerId)
        warningTracker.clearPlayer(resolvedPlayerId)
      }
    },

    onBrowserConnect(ws) {
      const stateEvents = monitorBridge.getCurrentStateEvents()
      console.log(`[Main] New browser client connected, sending ${stateEvents.length} state events`)
      if (stateEvents.length > 0) {
        const msg = JSON.stringify({ type: 'game_events', events: stateEvents })
        console.log(`[Main] State sync payload: ${msg.slice(0, 500)}`)
        ws.send(msg)
      }
      // Send current stats
      const stats = monitorBridge.getStats()
      operationsSummaryManager.recordSnapshot(stats.onlinePlayers, getCurrentTPS())
      const banStats = banManager.getStats(stats.onlinePlayers)
      const mergedStats = {
        ...stats,
        totalBans: banStats.totalBans,
        whitelistCount: banStats.whitelistCount,
        totalPlayers: banStats.totalPlayers,
      }
      ws.send(JSON.stringify({ type: 'player_stats', ...mergedStats }))

      // Send VP data for all online players
      const vpEntries = vpManager.getAllEntries()
      if (vpEntries.length > 0) {
        const vpEvents = vpEntries.map(entry => ({
          type: 'vp_update' as const,
          playerId: entry.playerId,
          totalVP: entry.totalVP,
          vpByType: entry.vpByType,
        }))
        ws.send(JSON.stringify({ type: 'game_events', events: vpEvents }))
      }

      const pendingCases = investigationCaseManager.getPendingCases()
      if (pendingCases.length > 0) {
        ws.send(JSON.stringify({
          type: 'game_events',
          events: pendingCases.map(investigationCase => investigationCaseEvent(
            investigationCase,
            'opened',
            monitorBridge.resolveNpcId(investigationCase.playerId),
          )),
        }))
      }
    },
  })

  actionDispatcher = new ActionDispatcher(wsServer, {
    maxAttempts: config.actionRetryMax,
    retryIntervalMs: config.actionRetryIntervalSeconds * 1000,
    onAck: (_actionId: string, playerId: string) => {
      // 处罚确认执行后，正式重置 VP
      penaltyEngine.onPenaltyConfirmed(playerId)
    },
    onStatus: (actionId, status, result) => {
      if (status === 'delivered') adminCommandStore.markSent(actionId)
      if (status === 'executed') adminCommandStore.markSucceeded(actionId, result)
      if (status === 'failed') adminCommandStore.markFailed(actionId, result)
    },
  })

  monitorBridge = new MonitorBridge(
    (action: SpigotAction) => {
      actionDispatcher.dispatch(action)
    },
    (playerId: string) => {
      return banManager.isBanned(playerId)
    },
    bannedNpcStore,
  )

  // 从 BanManager 的活跃封禁记录中恢复缺失的 NPC 状态
  // 确保服务器重启后，即使 BannedNpcStore 为空，也能从 BanManager 恢复被封禁的 NPC
  const activeBans = banManager.getActiveBans()
  if (activeBans.length > 0) {
    monitorBridge.restoreFromBanEntries(activeBans.map(b => ({
      playerId: b.playerId,
      playerName: b.playerName,
      reason: b.reason,
      duration: b.duration,
      bannedAt: b.bannedAt,
    })))
  }

  monitorBridge.onEmit((events) => {
    wsServer.broadcastToBrowsers({ type: 'game_events', events })
    // Also push updated stats to all browsers
    const stats = monitorBridge.getStats()
    // Merge ban/whitelist data from BanManager
    const banStats = banManager.getStats(stats.onlinePlayers)
    const mergedStats = {
      ...stats,
      totalBans: banStats.totalBans,
      whitelistCount: banStats.whitelistCount,
      totalPlayers: banStats.totalPlayers,
    }
    wsServer.broadcastToBrowsers({ type: 'player_stats', ...mergedStats })
  })

  const editorServe = new EditorServe({
    banManager,
    playerTracker,
    recordStore,
    actionDispatcher,
    alertManager,
    appealManager,
    ipTracker,
    vpManager,
    investigationCaseManager,
    operationsSummaryManager,
    evidenceBufferManager,
    warningTracker,
    adminCommandStore,
    onInvestigationCaseChanged: (investigationCase) => {
      evidenceBufferManager.setInvestigating(
        investigationCase.playerId,
        investigationCase.status === 'open' || investigationCase.status === 'monitoring',
      )
      wsServer.broadcastToBrowsers({
        type: 'game_events',
        events: [investigationCaseEvent(
          investigationCase,
          'resolved',
          monitorBridge.resolveNpcId(investigationCase.playerId),
        )],
      })
    },
    resolvePlayerId: (npcId: string) => monitorBridge.resolvePlayerId(npcId),
    resolveNpcId: (playerId: string) => monitorBridge.resolveNpcId(playerId),
  })

  const runtime: Runtime = {
    wsServer,
    playerTracker,
    alertManager,
    banManager,
    recordStore,
    actionDispatcher,
    vpManager,
    penaltyEngine,
    ipTracker,
    appealManager,
    baselineTracker,
    verificationGate,
    warningTracker,
    investigationCaseManager,
    operationsSummaryManager,
    evidenceBufferManager,
    softContainmentManager,
    adminCommandStore,
  }
  setRuntime(runtime)

  function handleSpigotEvent(event: AntiCheatEvent): void {
    wsServer.broadcastEvent(event)

    if (dashboardEnabled) monitorBridge.processAntiCheatEvent(event)

    const now = Date.now()

    switch (event.type) {
      case 'system.init': {
        console.log(
          `[Main] Server initialized: ${event.serverId} (v${event.version}, max ${event.maxPlayers})`,
        )
        // 初始化 TPS
        if (event.tps) updateTPS(event.tps)
        operationsSummaryManager.recordSnapshot(
          playerTracker.getAllPlayerStates().length,
          event.tps ?? getCurrentTPS(),
          now,
        )
        break
      }

      case 'player.join': {
        playerTracker.registerPlayer(event.playerId, event.name, event.ip, event.gameMode)
        vpManager.registerPlayer(event.playerId, event.name)
        ipTracker.registerPlayer(event.playerId, event.ip)
        playerEvidenceContext.set(event.playerId, { ping: null, statusEffects: [], exemptions: [] })
        operationsSummaryManager.recordSnapshot(playerTracker.getAllPlayerStates().length, getCurrentTPS(), now)
        console.log(`[Main] Player joined: ${event.name} (${event.playerId})`)
        if (ipTracker.hasAssociations(event.playerId)) {
          console.log(`[Main] IP association detected: ${event.name} shares IP with ${ipTracker.getAssociatedPlayers(event.playerId).join(', ')}`)
        }
        break
      }

      case 'player.leave': {
        playerTracker.removePlayer(event.playerId)
        recentDataMap.delete(event.playerId)
        evidenceBufferManager.clearPlayer(event.playerId)
        playerEvidenceContext.delete(event.playerId)
        operationsSummaryManager.recordSnapshot(playerTracker.getAllPlayerStates().length, getCurrentTPS(), now)
        detectionEngine.clearPlayer(event.playerId)
        ipTracker.removePlayer(event.playerId)
        baselineTracker.removePlayer(event.playerId)
        // VP 数据保留，不删除
        console.log(`[Main] Player left: ${event.playerId} (${event.reason})`)
        break
      }

      case 'ban_executed': {
        // Spigot 确认封禁已执行，同步 BanManager
        const existingBan = banManager.getActiveBans().find(b => b.playerId === event.playerId && b.active)
        if (!existingBan) {
          banManager.banPlayer(event.playerId, event.name, event.reason, event.duration)
        }
        console.log(`[Main] Ban executed: ${event.name} (${event.playerId}), reason=${event.reason}, duration=${event.duration}`)
        break
      }

      case 'unban_executed': {
        // Spigot 确认解封已执行，同步 BanManager
        banManager.unbanPlayer(event.playerId)
        console.log(`[Main] Unban executed: ${event.name} (${event.playerId}), source=${event.source}`)
        break
      }

      case 'grim.violation': {
        handleGrimViolation(event)
        break
      }

      case 'player.move': {
        playerTracker.updatePosition(
          event.playerId,
          event.x,
          event.y,
          event.z,
          event.vx,
          event.vy,
          event.vz,
          event.onGround,
        )

        // 更新检测引擎的移动状态追踪
        detectionEngine.updateMovementState(event.playerId, {
          x: event.x, y: event.y, z: event.z,
          vx: event.vx, vy: event.vy, vz: event.vz,
          onGround: event.onGround,
        })

        const moveData = getOrCreateRecentData(event.playerId)
        moveData.movements.push({
          x: event.x,
          y: event.y,
          z: event.z,
          vx: event.vx,
          vy: event.vy,
          vz: event.vz,
          onGround: event.onGround,
          timestamp: now,
        })
        trimRecentData(moveData)
        evidenceBufferManager.recordMovement(event.playerId, {
          x: event.x,
          y: event.y,
          z: event.z,
          vx: event.vx,
          vy: event.vy,
          vz: event.vz,
          onGround: event.onGround,
        }, getEvidenceContext(event.playerId, {
          ping: event.ping,
          statusEffects: event.statusEffects,
          exemptions: event.exemptions,
        }), now)

        // 更新行为基线
        const speed = Math.sqrt(event.vx * event.vx + event.vy * event.vy + event.vz * event.vz)
        baselineTracker.updateBaseline(event.playerId, { speed })

        runDetection(event.playerId)
        break
      }

      case 'player.combat': {
        const combatData = getOrCreateRecentData(event.attackerId)
        combatData.combats.push({
          attackerId: event.attackerId,
          victimId: event.victimId,
          distance: event.distance,
          angle: event.angle,
          cps: event.cps,
          hasLos: event.hasLos,
          timestamp: now,
        })
        trimRecentData(combatData)
        evidenceBufferManager.recordEvent(event.attackerId, {
          type: 'combat',
          victimId: event.victimId,
          distance: event.distance,
          angle: event.angle,
          cps: event.cps,
          hasLos: event.hasLos,
          timestamp: now,
          ...getEvidenceContext(event.attackerId),
        })

        const attackerState = playerTracker.getPlayerState(event.attackerId)
        if (attackerState) {
          attackerState.cps = event.cps
        }

        // 更新行为基线
        baselineTracker.updateBaseline(event.attackerId, { cps: event.cps, hitRate: event.hasLos ? 1 : 0 })

        runDetection(event.attackerId)
        break
      }

      case 'player.block': {
        const blockData = getOrCreateRecentData(event.playerId)
        blockData.blocks.push({
          action: event.action,
          blockType: event.blockType,
          speed: event.speed,
          x: event.x,
          y: event.y,
          z: event.z,
          exposedFaces: event.exposedFaces,
          nearbyOres: event.nearbyOres,
          yaw: event.yaw,
          pitch: event.pitch,
          placedFace: event.placedFace,
          placementIntervalMs: event.placementIntervalMs,
          timestamp: now,
        })
        trimRecentData(blockData)
        evidenceBufferManager.recordEvent(event.playerId, {
          type: 'block',
          action: event.action,
          blockType: event.blockType,
          speed: event.speed,
          x: event.x,
          y: event.y,
          z: event.z,
          exposedFaces: event.exposedFaces,
          nearbyOres: event.nearbyOres,
          yaw: event.yaw,
          pitch: event.pitch,
          placedFace: event.placedFace,
          placementIntervalMs: event.placementIntervalMs,
          timestamp: now,
          ...getEvidenceContext(event.playerId),
        })

        runDetection(event.playerId)
        break
      }

      case 'player.action': {
        const actionData = getOrCreateRecentData(event.playerId)
        actionData.actions.push({
          action: event.action,
          state: event.state,
          timestamp: now,
        })
        trimRecentData(actionData)
        evidenceBufferManager.recordEvent(event.playerId, {
          type: 'action',
          action: event.action,
          state: event.state,
          timestamp: now,
          ...getEvidenceContext(event.playerId),
        })
        runDetection(event.playerId)
        break
      }

      case 'player.gamemode': {
        const state = playerTracker.getPlayerState(event.playerId)
        if (state) {
          state.gameMode = event.newMode
        }
        break
      }

      case 'action_executed': {
        // 处理动作执行结果 — 通过 ActionDispatcher 的 ack/nack 机制
        if (event.actionId) {
          if (event.result === 'success') {
            actionDispatcher.ack(event.actionId, event.message)
          } else if (event.result === 'failed') {
            actionDispatcher.nack(event.actionId, event.message)
          }
        }
        console.log(`[Main] Action executed: ${event.action} for ${event.playerId} — ${event.result}`)
        break
      }

      case 'detection':
      case 'alert':
      case 'penalty':
      case 'vp_update':
      case 'error':
        break

      case 'heartbeat': {
        if (event.tps) updateTPS(event.tps)
        operationsSummaryManager.recordSnapshot(
          playerTracker.getAllPlayerStates().length,
          event.tps ?? getCurrentTPS(),
          now,
        )
        break
      }
    }
  }

  function handleGrimViolation(event: Extract<AntiCheatEvent, { type: 'grim.violation' }>): void {
    const state = playerTracker.getPlayerState(event.playerId)
    if (!state) {
      console.warn(`[Grim] Ignoring signal for unknown player ${event.name} (${event.playerId})`)
      return
    }
    if (banManager.isWhitelisted(event.playerId) || banManager.isBanned(event.playerId)) return

    const cheatType = mapGrimCheckToCheatType(event.checkName)
    const confidence = event.severity === 'high' ? 'high' : 'medium'
    const evidence = [{
      metric: `grim:${event.checkName}`,
      value: event.violationLevel,
      threshold: event.threshold,
      duration: 0,
    }]
    const detectionEvent: AntiCheatEvent = {
      type: 'detection',
      playerId: event.playerId,
      cheatType,
      confidence,
      evidence,
    }
    if (dashboardEnabled) monitorBridge.processAntiCheatEvent(detectionEvent)

    const warningResult = event.severity === 'high'
      ? { isFirstWarning: false, isSecondOffense: true, warningCount: 2 }
      : warningTracker.recordDetection(
          event.playerId,
          state.name,
          cheatType,
          confidence,
          evidence,
        )
    const shouldBan = event.severity === 'high' || warningResult.isSecondOffense

    const caseUpdate = investigationCaseManager.recordDetection({
      playerId: event.playerId,
      playerName: state.name,
      cheatType,
      confidence,
      evidence,
      timestamp: event.timestamp,
      repeatOffense: shouldBan,
    })
    evidenceBufferManager.recordEvent(event.playerId, {
      type: 'detection',
      cheatType,
      confidence,
      evidence,
      timestamp: event.timestamp,
      ...getEvidenceContext(event.playerId),
    })
    if (caseUpdate) {
      if (caseUpdate.created) {
        operationsSummaryManager.recordCaseOpened(event.timestamp)
        evidenceBufferManager.beginCase(caseUpdate.investigationCase.id, event.playerId, event.timestamp)
      }
      wsServer.broadcastToBrowsers({
        type: 'game_events',
        events: [investigationCaseEvent(
          caseUpdate.investigationCase,
          caseUpdate.created ? 'opened' : 'updated',
          monitorBridge.resolveNpcId(event.playerId),
        )],
      })
    }

    const alertMessage = shouldBan
      ? `[Grim自动处罚] ${event.checkName} VL ${event.violationLevel} — 临时封禁1小时`
      : `[首次警告] Grim ${event.checkName} VL ${event.violationLevel} — 30分钟内再次检测将封禁1小时`
    const alertUpdate = alertManager.addAlert(event.playerId, cheatType, confidence, alertMessage)
    const alertEvent: AntiCheatEvent = {
      type: 'alert',
      playerId: event.playerId,
      cheatType,
      confidence,
      message: alertUpdate.alert.message,
    }
    wsServer.broadcastToBrowsers({ type: 'game_events', events: [detectionEvent, alertEvent] })

    banManager.addRecord({
      id: `${event.playerId}-grim-${event.checkName}-${event.timestamp}`,
      playerId: event.playerId,
      playerName: state.name,
      cheatType,
      confidence,
      evidence,
      action: shouldBan ? 'grim_temp_ban_1h' : 'first_warning',
      actionResult: shouldBan ? 'penalty_dispatched' : 'warning_dispatched',
      timestamp: event.timestamp,
    })
    state.cheatRecordCount++
    state.lastAlertTime = Date.now()

    if (!shouldBan) {
      actionDispatcher.dispatch({
        type: 'persistent_warning',
        actionId: `grim-warn-${randomUUID().slice(0, 8)}`,
        playerId: event.playerId,
        reason: `Grim检测到 ${event.checkName} 异常，请立即停止；30分钟内再次检测将封禁1小时`,
        cheatType,
        confidence,
      })
      playerTracker.updatePhase(event.playerId, 'suspicious')
      if (dashboardEnabled) monitorBridge.processPhaseChange(
        event.playerId,
        'suspicious',
        'grim_first_warning',
        0,
        cheatType,
      )
      console.log(`[Grim] First warning for ${state.name}: ${event.checkName} VL=${event.violationLevel}`)
      return
    }

    const reason = event.severity === 'high'
      ? `Grim高可信检测: ${event.checkName} (VL ${event.violationLevel})`
      : `Grim二次检测: ${event.checkName} (30分钟共享窗口)`
    actionDispatcher.dispatch({
      type: 'ban',
      actionId: `grim-ban-${randomUUID().slice(0, 8)}`,
      playerId: event.playerId,
      reason,
      duration: config.secondOffenseBanDuration,
      cheatType,
      confidence,
    })
    banManager.banPlayer(
      event.playerId,
      state.name,
      reason,
      config.secondOffenseBanDuration,
      'grim',
    )
    warningTracker.clearPlayer(event.playerId)
    vpManager.clearVP(event.playerId)
    playerTracker.updatePhase(event.playerId, 'punishing')
    operationsSummaryManager.recordAutomaticMeasure(event.timestamp)
    if (dashboardEnabled) monitorBridge.processPhaseChange(
      event.playerId,
      'punishing',
      event.severity === 'high' ? 'grim_high_confidence' : 'grim_second_detection',
      0,
      cheatType,
    )
    wsServer.broadcastToBrowsers({
      type: 'game_events',
      events: [{
        type: 'penalty',
        playerId: event.playerId,
        level: 'temporary',
        action: 'ban',
        cheatType,
        confidence,
        vp: 0,
        reason,
        autoGenerated: true,
      } satisfies AntiCheatEvent],
    })
    console.log(`[Grim] Temporary ban for ${state.name}: ${event.checkName}, duration=${config.secondOffenseBanDuration}`)
  }

  function runDetection(playerId: string): void {
    const state = playerTracker.getPlayerState(playerId)
    if (!state) return

    if (banManager.isWhitelisted(playerId)) return

    const recentData = recentDataMap.get(playerId)
    if (!recentData) return

    const detections = detectionEngine.evaluate(playerId, state, recentData)
      .filter(detection => strategyPreset.enabledDetectors.has(detection.cheatType))
      .filter(detection => config.detectionSource === 'legacy'
        || (config.legacyXrayEnabled && detection.cheatType === 'x_ray'))

    if (detections.length > 0) {
      for (const detection of detections) {
        const detectionEvent: AntiCheatEvent = {
          type: 'detection',
          playerId: detection.playerId,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          evidence: detection.evidence,
        }
        wsServer.broadcastEvent(detectionEvent)
        if (dashboardEnabled) monitorBridge.processAntiCheatEvent(detectionEvent)

        // ── 首次警告 / 二次封禁 判定 ──
        const warningResult = detection.confidence === 'low'
          ? { isFirstWarning: false, isSecondOffense: false, warningCount: 0 }
          : warningTracker.recordDetection(
              detection.playerId,
              state.name,
              detection.cheatType,
              detection.confidence,
              detection.evidence,
            )

        const caseUpdate = investigationCaseManager.recordDetection({
          playerId: detection.playerId,
          playerName: state.name,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          evidence: detection.evidence,
          timestamp: detection.timestamp,
          repeatOffense: warningResult.isSecondOffense,
        })
        evidenceBufferManager.recordEvent(detection.playerId, {
          type: 'detection',
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          evidence: detection.evidence,
          timestamp: detection.timestamp,
          ...getEvidenceContext(detection.playerId),
        })
        if (caseUpdate) {
          if (caseUpdate.created) {
            operationsSummaryManager.recordCaseOpened(detection.timestamp)
            evidenceBufferManager.beginCase(
              caseUpdate.investigationCase.id,
              detection.playerId,
              detection.timestamp,
            )
          }
          wsServer.broadcastToBrowsers({
            type: 'game_events',
            events: [investigationCaseEvent(
              caseUpdate.investigationCase,
              caseUpdate.created ? 'opened' : 'updated',
              monitorBridge.resolveNpcId(detection.playerId),
            )],
          })
          const containment = softContainmentManager.evaluate(caseUpdate.investigationCase, detection.timestamp)
          if (containment) {
            actionDispatcher.dispatch(containment.action)
            operationsSummaryManager.recordAutomaticMeasure(detection.timestamp)
            wsServer.broadcastEvent({
              type: 'alert',
              playerId: detection.playerId,
              cheatType: detection.cheatType,
              confidence: 'high',
              message: `[可恢复软处置] ${containment.reason}`,
            })
          }
        }

        // ── PenaltyEngine 评估（VP 积分系统并行运行） ──
        const isWhitelisted = banManager.isWhitelisted(playerId)
        const ipWeight = ipTracker.getSharedVPWeight(playerId)
        const penaltyResult = penaltyEngine.evaluate(
          detection.playerId,
          state.name,
          detection.cheatType,
          detection.confidence,
          isWhitelisted,
          ipWeight,
        )

        let penaltyApproved = false
        if (penaltyResult.triggered && penaltyResult.action) {
          const verification = verificationGate.verify(
            detection.playerId,
            detection.cheatType,
            detection.confidence,
            penaltyResult.totalVP,
            detections.map(d => ({
              playerId: d.playerId,
              cheatType: d.cheatType,
              confidence: d.confidence,
              evidence: d.evidence,
              timestamp: d.timestamp,
            })),
            baselineTracker.getBaseline(detection.playerId) ?? null,
          )
          penaltyApproved = verification.pass
          if (!verification.pass) {
            console.log(
              `[PenaltyEngine] Penalty for ${state.name} BLOCKED by verification: ${verification.reason}`,
            )
          }
        }

        // 广播 VP 更新
        const vpUpdateEvent: AntiCheatEvent = {
          type: 'vp_update',
          playerId: detection.playerId,
          totalVP: penaltyResult.totalVP,
          vpByType: vpManager.getEntry(detection.playerId)?.vpByType ?? { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 },
        }
        wsServer.broadcastToBrowsers({ type: 'game_events', events: [vpUpdateEvent] })

        // 同时发送 VP 更新到 Spigot（在游戏内 ActionBar 显示）
        actionDispatcher.dispatch({
          type: 'vp_update',
          actionId: `vp-${randomUUID().slice(0, 8)}`,
          playerId: detection.playerId,
          totalVP: penaltyResult.totalVP,
        })

        // 更新 Phase
        if (penaltyResult.targetPhase && (!penaltyResult.triggered || penaltyApproved)) {
          playerTracker.updatePhase(playerId, penaltyResult.targetPhase)
          if (dashboardEnabled) monitorBridge.processPhaseChange(
            detection.playerId,
            penaltyResult.targetPhase,
            penaltyApproved ? 'penalty' : 'detection',
            penaltyResult.totalVP,
            detection.cheatType,
          )
        }

        // ── 首次检测：立即发送警告到 Spigot ──
        if (warningResult.isFirstWarning && detection.confidence === 'high') {
          console.log(`[WarningTracker] First warning for ${state.name}: ${detection.cheatType} (${detection.confidence})`)

          // 立即发送持续警告到 Spigot（ActionBar 持续显示）
          actionDispatcher.dispatch({
            type: 'persistent_warning',
            actionId: `warn-${randomUUID().slice(0, 8)}`,
            playerId: detection.playerId,
            reason: `检测到 ${detection.cheatType} 作弊行为 (${detection.confidence}置信度)，请立即停止！再次检测将直接封禁`,
            cheatType: detection.cheatType,
            confidence: detection.confidence,
          })

          // 广播首次警告事件到前端
          // 前端告警
          const alertUpdate = alertManager.addAlert(
            detection.playerId,
            detection.cheatType,
            detection.confidence,
            `[首次警告] ${detection.cheatType} (${detection.confidence}) — 再次检测将直接封禁`,
          )
          const alertEvent: AntiCheatEvent = {
            type: 'alert',
            playerId: detection.playerId,
            cheatType: detection.cheatType,
            confidence: detection.confidence,
            message: alertUpdate.alert.message,
          }
          if (alertUpdate.created || alertUpdate.confidenceRaised) {
            wsServer.broadcastEvent(alertEvent)
          }

          // 更新 Phase 为 suspicious
          playerTracker.updatePhase(playerId, 'suspicious')
          if (dashboardEnabled) monitorBridge.processPhaseChange(
            detection.playerId,
            'suspicious',
            'first_warning',
            penaltyResult.totalVP,
            detection.cheatType,
          )
        }

        // 重复违规只提高案件风险，不再绕过管理员直接执行长期处罚。
        if (warningResult.isSecondOffense) {
          console.log(`[WarningTracker] Repeated signal for ${state.name}: ${detection.cheatType} — escalated investigation case`)
        }

        // ── VP 系统触发的处罚（原有逻辑） ──
        // 告警
        const alertUpdate = alertManager.addAlert(
          detection.playerId,
          detection.cheatType,
          detection.confidence,
          penaltyApproved
            ? `[自动处罚] ${penaltyResult.level} — ${detection.cheatType} (VP: ${penaltyResult.totalVP.toFixed(1)})`
            : `Detected ${detection.cheatType} (confidence: ${detection.confidence}, VP: ${penaltyResult.totalVP.toFixed(1)})`,
        )

        const alertEvent: AntiCheatEvent = {
          type: 'alert',
          playerId: detection.playerId,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          message: alertUpdate.alert.message,
        }
        if (alertUpdate.created || alertUpdate.confidenceRaised || penaltyApproved) {
          wsServer.broadcastEvent(alertEvent)
        }

        // 记录检测
        const record = {
          id: `${detection.playerId}-${detection.cheatType}-${detection.timestamp}`,
          playerId: detection.playerId,
          playerName: state.name,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          evidence: detection.evidence,
          action: penaltyApproved ? `auto_${penaltyResult.level}` : (warningResult.isFirstWarning && detection.confidence === 'high' ? 'first_warning' : warningResult.isSecondOffense ? 'repeat_signal' : 'detect'),
          actionResult: penaltyApproved ? 'penalty_dispatched' : (warningResult.isSecondOffense ? 'case_escalated' : 'recorded'),
          timestamp: detection.timestamp,
        }
        banManager.addRecord(record)

        state.cheatRecordCount++
        state.lastAlertTime = Date.now()

        // ── 执行自动处罚（VP 系统触发） ──
        if (penaltyApproved && penaltyResult.action) {
          operationsSummaryManager.recordAutomaticMeasure(detection.timestamp)
          penaltyEngine.markPenaltyDispatched(penaltyResult)
          console.log(
            `[PenaltyEngine] Auto-penalty: ${penaltyResult.level} for ${state.name} — ${penaltyResult.action.type} (VP: ${penaltyResult.totalVP.toFixed(1)})`,
          )

          // 处罚前先冻结玩家
          if (penaltyResult.action.type === 'ban' || penaltyResult.action.type === 'kick') {
            actionDispatcher.dispatch({
              type: 'freeze',
              actionId: `freeze-${randomUUID().slice(0, 8)}`,
              playerId: detection.playerId,
              reason: 'Pending penalty execution',
              duration: '30s',
            })
          }

          // 分发主动作到 Spigot
          actionDispatcher.dispatch(penaltyResult.action, penaltyResult.record?.penaltyId)

          // 分发附加动作
          for (const suppAction of penaltyResult.supplementaryActions) {
            console.log(
              `[PenaltyEngine] Supplementary action: ${suppAction.type} for ${state.name} (duration: ${suppAction.duration ?? 'N/A'})`,
            )
            actionDispatcher.dispatch(suppAction)
          }

          // 广播处罚事件到前端
          const penaltyEvent: AntiCheatEvent = {
            type: 'penalty',
            playerId: detection.playerId,
            level: penaltyResult.level!,
            action: penaltyResult.action.type,
            cheatType: detection.cheatType,
            confidence: detection.confidence,
            vp: penaltyResult.totalVP,
            reason: penaltyResult.action.reason ?? '',
            autoGenerated: true,
          }
          wsServer.broadcastToBrowsers({ type: 'game_events', events: [penaltyEvent] })

          // 同步 BanManager
          if (penaltyResult.action.type === 'ban') {
            banManager.banPlayer(
              detection.playerId,
              state.name,
              penaltyResult.action.reason ?? 'Auto-ban',
              penaltyResult.action.duration ?? '24h',
            )
            console.log(`[PenaltyEngine] BanManager synced: ban ${state.name} (${penaltyResult.action.duration ?? '24h'})`)
          } else if (penaltyResult.action.type === 'kick') {
            const banAction = penaltyResult.supplementaryActions.find(a => a.type === 'ban')
            if (banAction) {
              banManager.banPlayer(
                detection.playerId,
                state.name,
                banAction.reason ?? 'Auto-ban (kick+tempban)',
                banAction.duration ?? '5m',
              )
              console.log(`[PenaltyEngine] BanManager synced: temp-ban ${state.name} after kick (${banAction.duration ?? '5m'})`)
            }
          }

          // VP 触发封禁后清除警告记录
          warningTracker.clearPlayer(detection.playerId)
        }
      }
    }
  }

  /** 根据作弊严重程度确定封禁时长 */
  function getBanDurationBySeverity(cheatType: string, confidence: string): string {
    // 高严重度作弊：飞行、杀戮光环
    const highSeverity: string[] = ['fly', 'kill_aura']
    // 中严重度作弊：速度、距离、搭桥
    const mediumSeverity: string[] = ['speed', 'reach', 'scaffold']
    // 低严重度作弊：透视、自动点击
    // const lowSeverity: CheatType[] = ['x_ray', 'auto_clicker']

    if (highSeverity.includes(cheatType)) {
      return confidence === 'high' ? '7d' : confidence === 'medium' ? '24h' : '1h'
    }
    if (mediumSeverity.includes(cheatType)) {
      return confidence === 'high' ? '24h' : confidence === 'medium' ? '1h' : '5m'
    }
    // 低严重度
    return confidence === 'high' ? '1h' : confidence === 'medium' ? '5m' : '5m'
  }

  wsServer.start()
  editorServe.start()
  actionDispatcher.start()

  console.log('[Main] Minecraft Anti-Cheat system started')
  console.log('[Main] WebSocket: ws://localhost:55211')
  console.log('[Main] Editor: http://localhost:55210')
  console.log(`[Main] Auto-penalty: ${penaltyEngine.isEnabled() ? 'ENABLED' : 'DISABLED'}`)
  console.log(`[Main] Runtime mode: ${runtimeMode}, strategy preset: ${strategyPreset.name}`)

  // ── 档案数据 7 天自动覆盖 ──
  const RECORDS_RETENTION_DAYS = 7
  const runRecordsPrune = (): void => {
    try {
      const deleted = recordStore.pruneOlderThan(RECORDS_RETENTION_DAYS)
      if (deleted > 0) {
        console.log(`[Main] Records prune: removed ${deleted} records older than ${RECORDS_RETENTION_DAYS} days`)
      }
    } catch (err) {
      console.error('[Main] Records prune failed:', err)
    }
  }
  // 启动时执行一次，之后每小时执行一次
  runRecordsPrune()
  const pruneInterval = setInterval(runRecordsPrune, 60 * 60 * 1000)

  const shutdown = (): void => {
    console.log('[Main] Shutting down...')
    clearInterval(pruneInterval)
    stopConfigWatch()
    shutdownSpeedThresholdService()
    vpManager.destroy()
    warningTracker.destroy()
    monitorBridge.destroy()
    actionDispatcher.destroy()
    evidenceBufferManager.flushAll()
    wsServer.stop()
    editorServe.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[Main] Fatal error:', err)
  process.exit(1)
})
