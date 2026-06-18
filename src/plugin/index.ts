import { randomUUID } from 'node:crypto'
import { WsServer } from './ws-server.js'
import { PlayerTracker } from './player-tracker.js'
import { AlertManager } from './alert-manager.js'
import { BanManager } from './ban-manager.js'
import { RecordStore } from './record-store.js'
import { ActionDispatcher } from './action-dispatcher.js'
import { EditorServe } from './editor-serve.js'
import { DetectionEngine, type RecentData, initSpeedThresholdService, shutdownSpeedThresholdService, updateTPS } from './rule-engine.js'
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
import type { AntiCheatEvent, SpigotAction, CheatDetection, PlayerPhase } from '../contracts/index.js'

const DATA_DIR = './data'
const RECORDS_FILE = `${DATA_DIR}/cheat-records.jsonl`

const MAX_RECENT_MOVEMENTS = 200
const MAX_RECENT_COMBATS = 100
const MAX_RECENT_BLOCKS = 200
const MAX_RECENT_ACTIONS = 50

const recentDataMap = new Map<string, RecentData>()

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
  const recordStore = new RecordStore(RECORDS_FILE)
  const banManager = new BanManager(recordStore, DATA_DIR)
  const playerTracker = new PlayerTracker()
  const alertManager = new AlertManager()

  // ── Penalty system ──
  const config = loadConfig()
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
    secondOffenseBanDuration: config.secondOffenseBanDuration,
  })
  let actionDispatcher: ActionDispatcher
  let monitorBridge: MonitorBridge

  // 启动配置热重载
  startConfigWatch((newConfig) => {
    vpManager.setConfig(buildVPManagerOptions(newConfig))
    penaltyEngine.setEnabled(newConfig.enabled)
    ipTracker.setSharedWeight(newConfig.ipSharedWeight)
    actionDispatcher.setRetryOptions({
      maxAttempts: newConfig.actionRetryMax,
      retryIntervalMs: newConfig.actionRetryIntervalSeconds * 1000,
    })
    detectionEngine.setCooldownMs(newConfig.warningDurationMs)
    warningTracker.setSecondOffenseBanDuration(newConfig.secondOffenseBanDuration)
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
      }

      // 管理员 dismiss 时清除 VP
      if (adminType === 'admin_dismiss') {
        penaltyEngine.adminDismiss(resolvedPlayerId)
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
    },
  })

  actionDispatcher = new ActionDispatcher(wsServer, {
    maxAttempts: config.actionRetryMax,
    retryIntervalMs: config.actionRetryIntervalSeconds * 1000,
    onAck: (_actionId: string, playerId: string) => {
      // 处罚确认执行后，正式重置 VP
      penaltyEngine.onPenaltyConfirmed(playerId)
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
  }
  setRuntime(runtime)

  function handleSpigotEvent(event: AntiCheatEvent): void {
    wsServer.broadcastEvent(event)

    monitorBridge.processAntiCheatEvent(event)

    const now = Date.now()

    switch (event.type) {
      case 'system.init': {
        console.log(
          `[Main] Server initialized: ${event.serverId} (v${event.version}, max ${event.maxPlayers})`,
        )
        // 初始化 TPS
        if (event.tps) updateTPS(event.tps)
        break
      }

      case 'player.join': {
        playerTracker.registerPlayer(event.playerId, event.name, event.ip, event.gameMode)
        vpManager.registerPlayer(event.playerId, event.name)
        ipTracker.registerPlayer(event.playerId, event.ip)
        console.log(`[Main] Player joined: ${event.name} (${event.playerId})`)
        if (ipTracker.hasAssociations(event.playerId)) {
          console.log(`[Main] IP association detected: ${event.name} shares IP with ${ipTracker.getAssociatedPlayers(event.playerId).join(', ')}`)
        }
        break
      }

      case 'player.leave': {
        // 时序竞争修复：如果玩家有高 VP（正在被处罚），先更新 MonitorBridge phase 为 punishing
        // 防止 player_leave 在 penalty 事件之前被处理导致 NPC 被 despawn
        const vpEntry = vpManager.getEntry(event.playerId)
        if (vpEntry && vpEntry.totalVP >= 15) {
          const cheatType = vpEntry.lastCheatType ?? 'fly'
          monitorBridge.processPhaseChange(event.playerId, 'punishing', `auto-penalty (VP: ${vpEntry.totalVP.toFixed(1)})`, vpEntry.totalVP, cheatType)
          console.log(`[Main] Pre-marked punishing phase for leaving player: ${event.playerId} (VP: ${vpEntry.totalVP.toFixed(1)})`)
        }

        playerTracker.removePlayer(event.playerId)
        recentDataMap.delete(event.playerId)
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
          timestamp: now,
        })
        trimRecentData(blockData)

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
            actionDispatcher.ack(event.actionId)
          } else if (event.result === 'failed') {
            actionDispatcher.nack(event.actionId)
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
        break
      }
    }
  }

  function runDetection(playerId: string): void {
    const state = playerTracker.getPlayerState(playerId)
    if (!state) return

    if (banManager.isWhitelisted(playerId)) return

    const recentData = recentDataMap.get(playerId)
    if (!recentData) return

    const detections = detectionEngine.evaluate(playerId, state, recentData)

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
        monitorBridge.processAntiCheatEvent(detectionEvent)

        // ── 首次警告 / 二次封禁 判定 ──
        const warningResult = warningTracker.recordDetection(
          detection.playerId,
          state.name,
          detection.cheatType,
          detection.confidence,
          detection.evidence,
        )

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
        if (penaltyResult.targetPhase) {
          playerTracker.updatePhase(playerId, penaltyResult.targetPhase)
          monitorBridge.processPhaseChange(
            detection.playerId,
            penaltyResult.targetPhase,
            penaltyResult.triggered ? 'penalty' : 'detection',
            penaltyResult.totalVP,
            detection.cheatType,
          )
        }

        // ── 首次检测：立即发送警告到 Spigot ──
        if (warningResult.isFirstWarning) {
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
          const warningEvent: AntiCheatEvent = {
            type: 'alert',
            playerId: detection.playerId,
            cheatType: detection.cheatType,
            confidence: detection.confidence,
            message: `[首次警告] ${state.name}: ${detection.cheatType} (${detection.confidence}) — 再次检测将直接封禁`,
          }
          wsServer.broadcastEvent(warningEvent)

          // 前端告警
          const alert = alertManager.addAlert(
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
            message: alert.message,
          }
          wsServer.broadcastEvent(alertEvent)

          // 更新 Phase 为 suspicious
          playerTracker.updatePhase(playerId, 'suspicious')
          monitorBridge.processPhaseChange(
            detection.playerId,
            'suspicious',
            'first_warning',
            penaltyResult.totalVP,
            detection.cheatType,
          )
        }

        // ── 二次违规：立即踢出 + 封禁 ──
        if (warningResult.isSecondOffense && !penaltyResult.triggered) {
          console.log(`[WarningTracker] SECOND OFFENSE for ${state.name}: ${detection.cheatType} — immediate kick + ban!`)

          const banDuration = warningTracker.getSecondOffenseBanDuration()
          const banReason = `[AntiCheat] 二次违规自动封禁: ${detection.cheatType} (${detection.confidence})`
          const kickReason = `§c§l你已被踢出服务器\n§e原因: ${detection.cheatType} 作弊行为（二次违规）\n§e封禁时长: ${banDuration}\n§7冷却期结束后再次检测到作弊，已自动封禁`

          // 先冻结玩家
          actionDispatcher.dispatch({
            type: 'freeze',
            actionId: `freeze-${randomUUID().slice(0, 8)}`,
            playerId: detection.playerId,
            reason: 'Second offense — pending kick + ban',
            duration: '30s',
          })

          // 踢出玩家（附带明确提示信息）
          actionDispatcher.dispatch({
            type: 'kick',
            actionId: `kick-${randomUUID().slice(0, 8)}`,
            playerId: detection.playerId,
            reason: kickReason,
          })

          // 封禁玩家账号
          const banAction: SpigotAction = {
            type: 'ban',
            actionId: `ban-${randomUUID().slice(0, 8)}`,
            playerId: detection.playerId,
            reason: banReason,
            duration: banDuration,
          }
          actionDispatcher.dispatch(banAction)

          // 同步 BanManager
          banManager.banPlayer(
            detection.playerId,
            state.name,
            banReason,
            banDuration,
          )

          // 更新 Phase 为 punishing
          playerTracker.updatePhase(playerId, 'punishing')
          monitorBridge.processPhaseChange(
            detection.playerId,
            'punishing',
            'second_offense_ban',
            penaltyResult.totalVP,
            detection.cheatType,
          )

          // 广播封禁事件到前端
          const penaltyEvent: AntiCheatEvent = {
            type: 'penalty',
            playerId: detection.playerId,
            level: 'L2',
            action: 'kick_ban',
            cheatType: detection.cheatType,
            confidence: detection.confidence,
            vp: penaltyResult.totalVP,
            reason: `二次违规: 踢出+封禁 ${banDuration}`,
            autoGenerated: true,
          }
          wsServer.broadcastToBrowsers({ type: 'game_events', events: [penaltyEvent] })

          // 清除警告记录
          warningTracker.clearPlayer(detection.playerId)
        }

        // ── VP 系统触发的处罚（原有逻辑） ──
        // 告警
        const alert = alertManager.addAlert(
          detection.playerId,
          detection.cheatType,
          detection.confidence,
          penaltyResult.triggered
            ? `[自动处罚] ${penaltyResult.level} — ${detection.cheatType} (VP: ${penaltyResult.totalVP.toFixed(1)})`
            : `Detected ${detection.cheatType} (confidence: ${detection.confidence}, VP: ${penaltyResult.totalVP.toFixed(1)})`,
        )

        const alertEvent: AntiCheatEvent = {
          type: 'alert',
          playerId: detection.playerId,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          message: alert.message,
        }
        wsServer.broadcastEvent(alertEvent)

        // 记录检测
        const record = {
          id: `${detection.playerId}-${detection.cheatType}-${detection.timestamp}`,
          playerId: detection.playerId,
          playerName: state.name,
          cheatType: detection.cheatType,
          confidence: detection.confidence,
          evidence: detection.evidence,
          action: penaltyResult.triggered ? `auto_${penaltyResult.level}` : (warningResult.isFirstWarning ? 'first_warning' : warningResult.isSecondOffense ? 'second_offense_ban' : 'detect'),
          actionResult: penaltyResult.triggered ? 'penalty_dispatched' : (warningResult.isSecondOffense ? 'ban_dispatched' : 'recorded'),
          timestamp: detection.timestamp,
        }
        banManager.addRecord(record)

        state.cheatRecordCount++
        state.lastAlertTime = Date.now()

        // ── 执行自动处罚（VP 系统触发） ──
        if (penaltyResult.triggered && penaltyResult.action) {
          // 最终验证
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

          if (!verification.pass) {
            console.log(
              `[PenaltyEngine] Penalty for ${state.name} BLOCKED by verification: ${verification.reason}`,
            )
            continue
          }

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

  const shutdown = (): void => {
    console.log('[Main] Shutting down...')
    stopConfigWatch()
    shutdownSpeedThresholdService()
    vpManager.destroy()
    monitorBridge.destroy()
    actionDispatcher.destroy()
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
