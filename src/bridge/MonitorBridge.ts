// @desc MonitorBridge — central orchestrator for the Bridge layer
//
// Manages the MonitorBridge Phase state machine that drives NPC visualization
// in the 3D frontend. Translates AntiCheatEvents into GameEvents through the
// EventTranslator and coordinates phase transitions with timers for auto-decay.
//
// Phase flow:
//   normal → suspicious → investigating → confirmed → punishing → monitoring → normal

import type { AntiCheatEvent, CheatType, Confidence, PlayerPhase, SpigotAction, ActionType, ServerStats } from '../contracts/index.js'
import type { GameEvent } from './game-event.js'
import { PlayerStateTracker } from './PlayerStateTracker.js'
import { AlertManager } from './AlertManager.js'
import { EventTranslator } from './EventTranslator.js'
import { ActivityStream } from './ActivityStream.js'
import { NpcEventQueue } from './NpcEventQueue.js'
import { RouteManager } from './RouteManager.js'
import type { BannedNpcStore, BannedNpcState } from '../plugin/banned-npc-store.js'

const SUSPICIOUS_DECAY_MS = 60_000
const INVESTIGATING_DECAY_MS = 120_000
const MONITORING_DURATION_MS = 300_000

interface PlayerPhaseState {
  phase: PlayerPhase
  decayTimer: ReturnType<typeof setTimeout> | null
  monitoringTimer: ReturnType<typeof setTimeout> | null
  lastAlertTime: number
  currentBuildingKey: string | null
  buildingEnterTime: number | null
}

export interface AdminAction {
  type: string
  playerId?: string
  reason?: string
  duration?: string
  [key: string]: unknown
}

export class MonitorBridge {
  private readonly tracker = new PlayerStateTracker()
  private readonly alertManager = new AlertManager()
  private readonly routeManager: RouteManager
  private readonly translator: EventTranslator
  private readonly activityStream: ActivityStream
  private readonly eventQueue: NpcEventQueue
  private readonly playerStates = new Map<string, PlayerPhaseState>()
  private readonly emitFns: Array<(events: GameEvent[]) => void> = []
  private readonly sendSpigotAction: ((action: SpigotAction) => void) | null
  private readonly isPlayerBanned: ((playerId: string) => boolean) | null
  private readonly bannedNpcStore: BannedNpcStore | null

  constructor(sendSpigotAction?: (action: SpigotAction) => void, isPlayerBanned?: (playerId: string) => boolean, bannedNpcStore?: BannedNpcStore) {
    const emitter = (events: GameEvent[]) => this.emit(events)
    this.routeManager = new RouteManager(emitter)
    this.translator = new EventTranslator(this.tracker, this.alertManager, this.routeManager)
    this.activityStream = new ActivityStream(emitter)
    this.eventQueue = new NpcEventQueue(emitter)
    this.sendSpigotAction = sendSpigotAction ?? null
    this.isPlayerBanned = isPlayerBanned ?? null
    this.bannedNpcStore = bannedNpcStore ?? null

    // 从持久化存储恢复被封禁 NPC 的 tracker 映射
    this.restoreBannedNpcStates()
  }

  processAntiCheatEvent(event: AntiCheatEvent): void {
    switch (event.type) {
      case 'system.init':
        this.handleSystemInit(event)
        break
      case 'player.join':
        this.handlePlayerJoin(event)
        break
      case 'player.leave':
        this.handlePlayerLeave(event)
        break
      case 'detection':
        // Phase 由 PenaltyEngine 统一管理，detection 仅更新告警和活动流
        this.handleDetectionLight(event)
        break
      case 'action_executed':
        this.handleActionExecuted(event)
        break
      case 'unban_executed':
        // Spigot 确认解封已执行，将 NPC 从关押状态恢复为 normal
        this.transitionToNormal(event.playerId)
        break
      case 'alert':
        this.handleAlert(event)
        break
      case 'penalty':
        // 处罚事件直接触发 punishing Phase
        this.handlePenaltyEvent(event)
        break
      default:
        this.emit(this.translator.translate(event))
        break
    }
  }

  /** 外部指令 Phase 变更（PenaltyEngine 为单一真相源） */
  processPhaseChange(playerId: string, newPhase: PlayerPhase, reason: string, vpTotal: number, cheatType?: CheatType): void {
    const state = this.getOrCreateState(playerId)
    const oldPhase = state.phase

    if (oldPhase === newPhase) {
      // 同 Phase 时重置衰减定时器
      this.scheduleDecay(playerId, newPhase)
      return
    }

    // 使用真实的 cheatType（而非占位值）
    const resolvedCheatType: CheatType = cheatType ?? 'fly'
    const confidence: Confidence = vpTotal >= 30 ? 'high' : vpTotal >= 10 ? 'medium' : 'low'
    this.transitionPhase(playerId, oldPhase, newPhase, resolvedCheatType, confidence)

    // 广播 phase_change 事件到前端
    const npcId = this.tracker.resolveNpcId(playerId)
    if (npcId) {
      this.emit([{
        type: 'phase_change',
        playerId,
        npcId,
        oldPhase,
        newPhase,
        reason,
        vpTotal,
        cheatType,
      }])
    }
  }

  processWorldAction(action: { type: string; playerId?: string; cheatType?: string; [key: string]: unknown }): GameEvent[] {
    switch (action.type) {
      case 'admin_ban': {
        if (!action.playerId) return []
        const cheatType = action.cheatType as CheatType | undefined
        return this.transitionToPunishing(action.playerId as string, cheatType)
      }
      case 'admin_kick': {
        if (!action.playerId) return []
        const cheatType = action.cheatType as CheatType | undefined
        return this.transitionToPunishing(action.playerId as string, cheatType)
      }
      case 'admin_freeze': {
        if (!action.playerId) return []
        const npcId = this.tracker.resolveNpcId(action.playerId as string)
        if (!npcId) return []
        return [
          { type: 'npc_phase', npcId, phase: 'punishing' },
          { type: 'freeze_effect', npcId },
        ]
      }
      case 'admin_unban': {
        // 解封时立即将 NPC 从关押状态恢复为 normal
        if (!action.playerId) return []
        return this.transitionToNormal(action.playerId as string)
      }
      case 'admin_dismiss': {
        if (!action.playerId) return []
        return this.transitionToNormal(action.playerId as string)
      }
      case 'admin_whitelist': {
        // Whitelist is a server-side action, no visual effect needed on frontend
        if (!action.playerId) return []
        const npcId = this.tracker.resolveNpcId(action.playerId as string)
        if (!npcId) return []
        return [{ type: 'npc_glow', npcId, color: 'green' }]
      }
      case 'admin_teleport': {
        // Teleport is a server-side action, no visual effect needed on frontend
        return []
      }
      case 'switch_scene': {
        const target = (action.target as 'town' | 'office') ?? 'town'
        return [{ type: 'scene_switch', target }]
      }
      case 'switch_mode': {
        const mode = (action.mode as 'monitor' | 'life') ?? 'monitor'
        return [{ type: 'mode_change', mode }]
      }
      default:
        return []
    }
  }

  /** 将 npcId 解析为真实 playerId (UUID) */
  resolvePlayerId(npcId: string): string | undefined {
    return this.tracker.resolvePlayerId(npcId)
  }

  /** 将 playerId (UUID) 解析为 npcId */
  resolveNpcId(playerId: string): string | undefined {
    return this.tracker.resolveNpcId(playerId)
  }

  processAdminAction(action: AdminAction): GameEvent[] {
    const gameEvents = this.processWorldAction(action)

    // 将 npcId 解析为真实 playerId (UUID)
    const rawPlayerId = action.playerId ?? ''
    const resolvedPlayerId = this.tracker.resolvePlayerId(rawPlayerId) ?? rawPlayerId

    const spigotActionTypes = new Set(['admin_ban', 'admin_unban', 'admin_kick', 'admin_freeze', 'admin_whitelist', 'admin_teleport'])
    if (spigotActionTypes.has(action.type) && resolvedPlayerId && this.sendSpigotAction) {
      const spigotActionTypeMap: Record<string, ActionType> = {
        admin_ban: 'ban',
        admin_unban: 'unban',
        admin_kick: 'kick',
        admin_freeze: 'freeze',
        admin_whitelist: 'whitelist_add',
        admin_teleport: 'teleport',
      }
      const spigotAction: SpigotAction = {
        type: spigotActionTypeMap[action.type] ?? action.type,
        playerId: resolvedPlayerId,
        reason: action.reason,
        duration: action.duration,
      }
      console.log(`[MonitorBridge] processAdminAction: ${action.type} npcId=${action.playerId} → playerId=${resolvedPlayerId}`)
      this.sendSpigotAction(spigotAction)
    }

    if (action.type === 'admin_dismiss' && resolvedPlayerId && this.sendSpigotAction) {
      this.sendSpigotAction({
        type: 'unban',
        playerId: resolvedPlayerId,
        reason: action.reason ?? 'dismissed by admin',
      })
    }

    return gameEvents
  }

  getStats(): ServerStats {
    const onlinePlayers = this.tracker.getAllPlayerStates().length
    const activeAlerts = this.alertManager.getActiveAlerts()
    const alertsByType: Record<CheatType, number> = {
      fly: 0,
      speed: 0,
      kill_aura: 0,
      x_ray: 0,
      scaffold: 0,
      auto_clicker: 0,
      reach: 0,
    }
    for (const alert of activeAlerts) {
      if (alert.cheatType in alertsByType) {
        alertsByType[alert.cheatType as CheatType]++
      }
    }
    return {
      onlinePlayers,
      totalPlayers: onlinePlayers,
      activeAlerts: activeAlerts.length,
      alertsByType,
      totalBans: 0,
      whitelistCount: 0,
    }
  }

  onEmit(fn: (events: GameEvent[]) => void): void {
    this.emitFns.push(fn)
  }

  getPlayerStates() {
    return this.tracker.getAllPlayerStates()
  }

  getActiveAlerts() {
    return this.alertManager.getActiveAlerts()
  }

  /** Generate GameEvents representing the current state of all online players.
   *  Used to sync state when a browser reconnects.
   *  Includes detained/banned NPCs so they persist across client sessions. */
  getCurrentStateEvents(): GameEvent[] {
    const states = this.tracker.getAllPlayerStates()
    const events: GameEvent[] = []
    for (const state of states) {
      events.push({
        type: 'npc_spawn',
        npcId: state.npcId,
        name: state.name,
        role: 'player',
        category: 'player',
        spawn: state.spawn,
      })
      events.push({
        type: 'npc_phase',
        npcId: state.npcId,
        phase: state.phase,
      })
      // 被封禁的 NPC 需要额外发送完整状态
      if (state.phase === 'punishing' || state.phase === 'offline') {
        const isBanned = this.isPlayerBanned?.(state.playerId) ?? false
        if (isBanned || state.phase === 'punishing') {
          // 红色光效
          events.push({ type: 'npc_glow', npcId: state.npcId, color: 'red' })
          // 🔒 标签
          events.push({ type: 'npc_emoji', npcId: state.npcId, emoji: '🔒' })
          // penalty 事件携带封禁信息，前端据此设置 banStatus + detained
          const bannedState = this.bannedNpcStore?.get(state.playerId)
          events.push({
            type: 'penalty',
            playerId: state.playerId,
            npcId: state.npcId,
            level: 'L3',
            action: 'ban',
            cheatType: bannedState?.cheatType ?? 'fly',
            confidence: 'high',
            vp: 0,
            reason: bannedState?.reason ?? '封禁中',
            autoGenerated: false,
            duration: bannedState?.duration,
            bannedAt: bannedState?.bannedAt,
          })
          // 押送到关押建筑
          const buildingKey = bannedState?.buildingKey ?? this.cheatTypeToBuildingKey(bannedState?.cheatType ?? 'fly')
          events.push({ type: 'npc_escorting', npcId: state.npcId, buildingKey })
        }
      }
    }
    return events
  }

  getAlertsByPlayer(playerId: string) {
    return this.alertManager.getAlertsByPlayer(playerId)
  }

  destroy(): void {
    for (const state of this.playerStates.values()) {
      if (state.decayTimer) clearTimeout(state.decayTimer)
      if (state.monitoringTimer) clearTimeout(state.monitoringTimer)
    }
    this.playerStates.clear()
    this.tracker.clear()
    this.alertManager.clearAlerts()
    this.emitFns.length = 0
  }

  // ── Private handlers ──

  /** 从 BanManager 的活跃封禁记录中恢复缺失的 NPC 状态
   *  用于服务器重启后，BannedNpcStore 为空但 BanManager 有封禁记录的情况 */
  restoreFromBanEntries(entries: Array<{ playerId: string; playerName: string; reason: string; duration: string; bannedAt: number }>): void {
    // 去重：同一玩家可能同时有 npcId 格式和 UUID 格式的记录
    // 优先使用 UUID 格式（包含连字符的标准格式）
    const seenNpcIds = new Set<string>()
    const dedupedEntries: typeof entries = []
    // 先处理 UUID 格式的条目
    for (const entry of entries) {
      if (!entry.playerId.startsWith('player_')) {
        const npcId = `player_${entry.playerId.slice(0, 8)}`
        if (!seenNpcIds.has(npcId)) {
          seenNpcIds.add(npcId)
          dedupedEntries.push(entry)
        }
      }
    }
    // 再处理 npcId 格式的条目（仅当没有对应的 UUID 条目时才使用）
    for (const entry of entries) {
      if (entry.playerId.startsWith('player_')) {
        const npcId = entry.playerId
        if (!seenNpcIds.has(npcId)) {
          seenNpcIds.add(npcId)
          dedupedEntries.push(entry)
        }
      }
    }

    for (const entry of dedupedEntries) {
      // 检测 playerId 是完整 UUID 还是 npcId 格式 (player_XXXXXXXX)
      let playerId: string
      let npcId: string
      if (entry.playerId.startsWith('player_')) {
        // playerId 存储的是 npcId 格式，需要反向解析
        npcId = entry.playerId
        playerId = this.tracker.resolvePlayerId(npcId) ?? entry.playerId
      } else {
        // playerId 是完整 UUID
        playerId = entry.playerId
        npcId = `player_${playerId.slice(0, 8)}`
      }

      // 跳过已有映射的玩家（可能已在线或已从 BannedNpcStore 恢复）
      if (this.tracker.resolveNpcId(playerId)) continue

      // 使用默认 spawn 位置（城镇广场区域）
      const spawn = { x: 15 + Math.random() * 6, y: 0, z: 10 + Math.random() * 6 }

      // 注册 tracker 映射
      this.tracker.registerMapping(playerId, npcId, entry.playerName, spawn)
      this.tracker.updatePhase(playerId, 'offline')

      // 注册 MonitorBridge 内部 phase state
      this.playerStates.set(playerId, {
        phase: 'offline',
        decayTimer: null,
        monitoringTimer: null,
        lastAlertTime: Date.now(),
        currentBuildingKey: null,
        buildingEnterTime: null,
      })

      // 持久化到 BannedNpcStore
      this.bannedNpcStore?.add({
        playerId,
        npcId,
        name: entry.playerName,
        phase: 'offline',
        spawnX: spawn.x,
        spawnZ: spawn.z,
        buildingKey: null,
        cheatType: null,
        bannedAt: entry.bannedAt,
        reason: entry.reason,
        duration: entry.duration,
      })

      console.log(`[MonitorBridge] Restored banned NPC from BanManager: ${npcId} (${entry.playerName}), playerId=${playerId}`)
    }
  }

  /** 从持久化存储恢复被封禁 NPC 的 tracker 映射（服务器重启后调用） */
  private restoreBannedNpcStates(): void {
    if (!this.bannedNpcStore) return

    const bannedStates = this.bannedNpcStore.getAll()
    if (bannedStates.length === 0) return

    console.log(`[MonitorBridge] Restoring ${bannedStates.length} banned NPC states from persistence...`)

    for (const bs of bannedStates) {
      // 检查封禁是否仍然有效
      const isStillBanned = this.isPlayerBanned?.(bs.playerId) ?? true
      if (!isStillBanned) {
        // 封禁已过期，清除持久化状态
        this.bannedNpcStore.remove(bs.playerId)
        console.log(`[MonitorBridge] Restored NPC ${bs.npcId} but ban expired, removing`)
        continue
      }

      // 恢复 tracker 映射
      const spawn = { x: bs.spawnX, y: 0, z: bs.spawnZ }
      this.tracker.registerMapping(bs.playerId, bs.npcId, bs.name, spawn)
      this.tracker.updatePhase(bs.playerId, bs.phase)

      // 恢复 MonitorBridge 内部 phase state
      this.playerStates.set(bs.playerId, {
        phase: bs.phase,
        decayTimer: null,
        monitoringTimer: null,
        lastAlertTime: Date.now(),
        currentBuildingKey: bs.buildingKey,
        buildingEnterTime: bs.buildingKey ? Date.now() : null,
      })

      console.log(`[MonitorBridge] Restored banned NPC: ${bs.npcId} (${bs.name}), phase=${bs.phase}, building=${bs.buildingKey}`)
    }
  }

  private handleSystemInit(event: AntiCheatEvent & { type: 'system.init' }): void {
    this.emit(this.translator.translate(event))
  }

  private handlePlayerJoin(event: AntiCheatEvent & { type: 'player.join' }): void {
    const gameEvents = this.translator.translate(event)
    this.emit(gameEvents)

    this.playerStates.set(event.playerId, {
      phase: 'normal',
      decayTimer: null,
      monitoringTimer: null,
      lastAlertTime: Date.now(),
      currentBuildingKey: null,
      buildingEnterTime: null,
    })

    this.activityStream.emitActivity(
      this.tracker.resolveNpcId(event.playerId) ?? event.playerId,
      '👋',
      `${event.name} 加入了服务器`,
    )
  }

  private handlePlayerLeave(event: AntiCheatEvent & { type: 'player.leave' }): void {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    const state = this.playerStates.get(event.playerId)

    // 使用 exitType 作为主要判断依据（由 Spigot 端权威标记）
    // exitType='cheat_ban': 作弊封禁退出，NPC 必须保留
    // exitType='normal': 正常退出，NPC 应移除
    const isCheatBan = event.exitType === 'cheat_ban'

    // 兜底防御：即使 exitType 不正确，也通过其他信号判断
    const isPunishingPhase = state?.phase === 'punishing'
    const isBannedInManager = this.isPlayerBanned?.(event.playerId) ?? false
    const shouldKeepNpc = isCheatBan || isPunishingPhase || isBannedInManager

    if (shouldKeepNpc) {
      if (npcId) {
        this.activityStream.emitActivity(npcId, '🔒', `已被处罚，关押中`)
      }
      // 不删除 playerStates，不删除映射，不生成 npc_despawn
      // 改为发出 npc_phase(offline) 事件，前端保留 NPC 模型
      // 如果 phase 还不是 punishing，先强制转为 punishing（确保前端正确显示关押状态）
      if (state && state.phase !== 'punishing') {
        state.phase = 'punishing'
        this.tracker.updatePhase(event.playerId, 'punishing')
      }
      this.clearTimers(event.playerId)

      // 持久化被封禁 NPC 状态到磁盘（解决服务器重启后丢失问题）
      const trackerState = this.tracker.getAllPlayerStates().find(s => s.playerId === event.playerId)
      if (trackerState && this.bannedNpcStore) {
        this.bannedNpcStore.add({
          playerId: event.playerId,
          npcId: trackerState.npcId,
          name: trackerState.name,
          phase: 'offline',
          spawnX: trackerState.spawn.x,
          spawnZ: trackerState.spawn.z,
          buildingKey: state?.currentBuildingKey ?? null,
          cheatType: null,
          bannedAt: Date.now(),
          reason: event.reason ?? '封禁',
          duration: '24h',
        })
      }

      const gameEvents: GameEvent[] = npcId
        ? [
            { type: 'npc_phase', npcId, phase: 'punishing' },
            { type: 'npc_phase', npcId, phase: 'offline' },
          ]
        : []
      console.log(`[MonitorBridge] player.leave (cheat_ban): playerId=${event.playerId}, npcId=${npcId}, exitType=${event.exitType}, phase=${state?.phase}, isBanned=${isBannedInManager}, keeping NPC alive`)
      this.emit(gameEvents)
      return
    }

    // 正常退出流程：NPC 应在 1 秒内移除
    if (npcId) {
      this.activityStream.emitActivity(npcId, '🚪', `离开了服务器 (${event.reason})`)
    }

    this.clearTimers(event.playerId)
    this.playerStates.delete(event.playerId)
    const gameEvents = this.translator.translate(event)
    console.log(`[MonitorBridge] player.leave (normal): playerId=${event.playerId}, npcId=${npcId}, exitType=${event.exitType}, events=${JSON.stringify(gameEvents.map(e => e.type))}`)
    this.emit(gameEvents)
  }

  private handleDetectionLight(event: AntiCheatEvent & { type: 'detection' }): void {
    // Phase 由 PenaltyEngine 统一管理，这里仅更新告警和活动流
    const state = this.getOrCreateState(event.playerId)
    state.lastAlertTime = Date.now()

    this.alertManager.addAlert(event.playerId, event.cheatType, event.confidence, `检测到 ${event.cheatType} (${event.confidence})`)

    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (npcId) {
      this.emit([
        { type: 'alert_popup', playerId: event.playerId, npcId, cheatType: event.cheatType, confidence: event.confidence, message: `检测到 ${event.cheatType} (${event.confidence})` },
        { type: 'record_add', playerId: event.playerId, npcId, cheatType: event.cheatType, timestamp: Date.now() },
      ])
      this.activityStream.emitActivity(
        npcId,
        this.activityStream.cheatActivityIcon(event.cheatType),
        this.activityStream.cheatActivityMsg(event.cheatType),
      )
    }
  }

  private handlePenaltyEvent(event: AntiCheatEvent & { type: 'penalty' }): void {
    // 自动处罚事件 → 直接进入 punishing Phase
    const state = this.getOrCreateState(event.playerId)
    if (state.phase !== 'punishing') {
      this.transitionToPunishing(event.playerId, event.cheatType)
    }
  }

  private handleActionExecuted(event: AntiCheatEvent & { type: 'action_executed' }): void {
    const state = this.playerStates.get(event.playerId)

    if (event.action === 'ban' || event.action === 'kick') {
      this.transitionToPunishing(event.playerId)
    } else if (event.action === 'unban') {
      // 仅在非 normal 阶段时转换（避免与 processWorldAction 的 admin_unban 重复）
      if (state && state.phase !== 'normal') {
        this.transitionToNormal(event.playerId)
      }
    } else {
      this.emit(this.translator.translate(event))
    }
  }

  private handleAlert(event: AntiCheatEvent & { type: 'alert' }): void {
    const state = this.getOrCreateState(event.playerId)
    state.lastAlertTime = Date.now()

    this.emit(this.translator.translate(event))

    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (npcId) {
      this.activityStream.emitActivity(
        npcId,
        this.activityStream.cheatActivityIcon(event.cheatType),
        event.message,
      )
    }
  }

  // ── Phase transitions ──

  private transitionPhase(
    playerId: string,
    from: PlayerPhase,
    to: PlayerPhase,
    cheatType: CheatType,
    confidence: Confidence,
  ): void {
    const state = this.playerStates.get(playerId)
    if (!state) return

    this.clearTimers(playerId)

    // If leaving a building, emit npc_building_leave
    if (state.currentBuildingKey) {
      const actualStayMs = state.buildingEnterTime ? Date.now() - state.buildingEnterTime : 0
      const npcId = this.tracker.resolveNpcId(playerId)
      if (npcId) {
        this.emit([{
          type: 'npc_building_leave',
          npcId,
          buildingKey: state.currentBuildingKey,
          actualStayMs,
        }])
      }
      state.currentBuildingKey = null
      state.buildingEnterTime = null
    }

    state.phase = to
    this.tracker.updatePhase(playerId, to)

    const gameEvents = this.translator.translateDetectionToPhaseEvents(
      playerId,
      cheatType,
      confidence,
      to,
    )

    // Track building entry for investigating phase
    if (to === 'investigating') {
      const escortEvent = gameEvents.find(e => e.type === 'npc_escorting') as { type: 'npc_escorting'; buildingKey: string } | undefined
      if (escortEvent) {
        state.currentBuildingKey = escortEvent.buildingKey
        state.buildingEnterTime = Date.now()
      }
    }

    this.emit(gameEvents)

    this.scheduleDecay(playerId, to)
  }

  private transitionToPunishing(playerId: string, cheatType?: CheatType): GameEvent[] {
    const state = this.playerStates.get(playerId)
    if (!state) return []

    this.clearTimers(playerId)

    // If in a building, emit npc_building_leave before punishing
    const buildingLeaveEvents: GameEvent[] = []
    if (state.currentBuildingKey) {
      const actualStayMs = state.buildingEnterTime ? Date.now() - state.buildingEnterTime : 0
      const npcId = this.tracker.resolveNpcId(playerId)
      if (npcId) {
        buildingLeaveEvents.push({
          type: 'npc_building_leave',
          npcId,
          buildingKey: state.currentBuildingKey,
          actualStayMs,
        })
      }
      state.currentBuildingKey = null
      state.buildingEnterTime = null
    }

    state.phase = 'punishing'
    this.tracker.updatePhase(playerId, 'punishing')

    const npcId = this.tracker.resolveNpcId(playerId)
    if (!npcId) return buildingLeaveEvents

    // Map cheatType to buildingKey — default to 'fly_lab' if no cheatType
    const buildingKey = cheatType ? this.cheatTypeToBuildingKey(cheatType) : 'fly_lab'

    const events: GameEvent[] = [
      ...buildingLeaveEvents,
      { type: 'npc_phase', npcId, phase: 'punishing' },
    ]

    // Send escort event instead of ban_animation — admin NPC escorts to detention building
    if (buildingKey) {
      events.push({ type: 'npc_escorting', npcId, buildingKey })
      // 记录当前建筑，以便解封时能正确发出 npc_building_leave
      state.currentBuildingKey = buildingKey
      state.buildingEnterTime = Date.now()
    }

    // 持久化被封禁 NPC 状态到磁盘
    const trackerState = this.tracker.getAllPlayerStates().find(s => s.playerId === playerId)
    if (trackerState && this.bannedNpcStore) {
      this.bannedNpcStore.add({
        playerId,
        npcId,
        name: trackerState.name,
        phase: 'punishing',
        spawnX: trackerState.spawn.x,
        spawnZ: trackerState.spawn.z,
        buildingKey,
        cheatType: cheatType ?? null,
        bannedAt: Date.now(),
        reason: '封禁',
        duration: '24h',
      })
    }

    this.emit(events)

    this.scheduleMonitoring(playerId)
    return events
  }

  /** Map cheat type to detention building key */
  private cheatTypeToBuildingKey(cheatType: CheatType): string {
    const mapping: Record<CheatType, string> = {
      fly: 'fly_lab',
      speed: 'speed_lab',
      kill_aura: 'combat_lab',
      x_ray: 'xray_lab',
      scaffold: 'scaffold_lab',
      auto_clicker: 'autoclick_lab',
      reach: 'reach_lab',
    }
    return mapping[cheatType] ?? 'fly_lab'
  }

  private transitionToNormal(playerId: string): GameEvent[] {
    const state = this.playerStates.get(playerId)
    if (!state) return []

    this.clearTimers(playerId)
    state.phase = 'normal'
    this.tracker.updatePhase(playerId, 'normal')

    // 清除持久化的被封禁 NPC 状态
    this.bannedNpcStore?.remove(playerId)

    const npcId = this.tracker.resolveNpcId(playerId)
    if (!npcId) return []

    const events: GameEvent[] = []

    // If in a building, emit npc_building_leave
    if (state.currentBuildingKey) {
      const actualStayMs = state.buildingEnterTime ? Date.now() - state.buildingEnterTime : 0
      events.push({
        type: 'npc_building_leave',
        npcId,
        buildingKey: state.currentBuildingKey,
        actualStayMs,
      })
      state.currentBuildingKey = null
      state.buildingEnterTime = null
    }

    events.push({ type: 'npc_phase', npcId, phase: 'normal' })
    events.push({ type: 'npc_glow', npcId, color: null })

    this.emit(events)
    return events
  }

  private transitionToMonitoring(playerId: string): void {
    const state = this.playerStates.get(playerId)
    if (!state) return

    state.phase = 'monitoring'
    this.tracker.updatePhase(playerId, 'monitoring')

    const npcId = this.tracker.resolveNpcId(playerId)
    if (!npcId) return

    this.emit([
      { type: 'npc_phase', npcId, phase: 'monitoring' },
      { type: 'npc_glow', npcId, color: 'green' },
    ])

    this.scheduleMonitoring(playerId)
  }

  // ── Timer management ──

  private scheduleDecay(playerId: string, phase: PlayerPhase): void {
    const state = this.playerStates.get(playerId)
    if (!state) return

    let delay: number | null = null
    switch (phase) {
      case 'suspicious':
        delay = SUSPICIOUS_DECAY_MS
        break
      case 'investigating':
        delay = INVESTIGATING_DECAY_MS
        break
      default:
        return
    }

    state.decayTimer = setTimeout(() => {
      const currentState = this.playerStates.get(playerId)
      if (!currentState) return
      if (Date.now() - currentState.lastAlertTime >= delay!) {
        this.transitionToNormal(playerId)
      }
    }, delay)
  }

  private scheduleMonitoring(playerId: string): void {
    const state = this.playerStates.get(playerId)
    if (!state) return

    if (state.monitoringTimer) {
      clearTimeout(state.monitoringTimer)
    }

    state.monitoringTimer = setTimeout(() => {
      const currentState = this.playerStates.get(playerId)
      if (!currentState) return
      if (currentState.phase === 'punishing') {
        this.transitionToMonitoring(playerId)
      } else if (currentState.phase === 'monitoring') {
        this.transitionToNormal(playerId)
      }
    }, MONITORING_DURATION_MS)
  }

  private clearTimers(playerId: string): void {
    const state = this.playerStates.get(playerId)
    if (!state) return
    if (state.decayTimer) {
      clearTimeout(state.decayTimer)
      state.decayTimer = null
    }
    if (state.monitoringTimer) {
      clearTimeout(state.monitoringTimer)
      state.monitoringTimer = null
    }
  }

  private getOrCreateState(playerId: string): PlayerPhaseState {
    let state = this.playerStates.get(playerId)
    if (!state) {
      state = {
        phase: 'normal',
        decayTimer: null,
        monitoringTimer: null,
        lastAlertTime: Date.now(),
        currentBuildingKey: null,
        buildingEnterTime: null,
      }
      this.playerStates.set(playerId, state)
    }
    return state
  }

  private emit(events: GameEvent[]): void {
    if (events.length === 0) return
    for (const fn of this.emitFns) {
      fn(events)
    }
  }
}
