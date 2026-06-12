// @desc EventTranslator — translates AntiCheatEvents into GameEvents for the 3D Frontend
//
// Each AntiCheatEvent type maps to one or more GameEvents that drive NPC
// visualization, alerts, and scene state in the monitoring frontend.

import type {
  AntiCheatEvent,
  CheatType,
  Confidence,
  PlayerPhase,
} from '../contracts/anticheat-events.js'
import type { GameEvent } from './game-event.js'
import type { PlayerStateTracker } from './PlayerStateTracker.js'
import type { AlertManager } from './AlertManager.js'
import type { RouteManager } from './RouteManager.js'

const SPEED_ANOMALY_THRESHOLD = 0.8
const COMBAT_ANOMALY_ANGLE = 90
const BLOCK_ANOMALY_SPEED = 5

const CONFIDENCE_GLOW: Record<Confidence, string> = {
  low: 'yellow',
  medium: 'orange',
  high: 'red',
}

const CHEAT_TYPE_TO_BUILDING: Record<CheatType, string> = {
  fly: 'fly_lab',
  speed: 'speed_lab',
  kill_aura: 'combat_lab',
  x_ray: 'xray_lab',
  scaffold: 'scaffold_lab',
  auto_clicker: 'autoclick_lab',
  reach: 'reach_lab',
}

export class EventTranslator {
  private readonly tracker: PlayerStateTracker
  private readonly alertManager: AlertManager
  private readonly routeManager: RouteManager

  constructor(
    tracker: PlayerStateTracker,
    alertManager: AlertManager,
    routeManager: RouteManager,
  ) {
    this.tracker = tracker
    this.alertManager = alertManager
    this.routeManager = routeManager
  }

  translate(event: AntiCheatEvent): GameEvent[] {
    switch (event.type) {
      case 'system.init':
        return this.translateSystemInit(event)
      case 'player.join':
        return this.translatePlayerJoin(event)
      case 'player.leave':
        return this.translatePlayerLeave(event)
      case 'player.move':
        return this.translatePlayerMove(event)
      case 'player.combat':
        return this.translatePlayerCombat(event)
      case 'player.block':
        return this.translatePlayerBlock(event)
      case 'player.action':
        return this.translatePlayerAction(event)
      case 'player.gamemode':
        return this.translatePlayerGamemode(event)
      case 'detection':
        // NOTE: detection 事件由 MonitorBridge.handleDetectionLight 直接处理，
        // translateDetection 保留供外部调用（如 translateDetectionToPhaseEvents）
        return this.translateDetection(event)
      case 'action_executed':
        return this.translateActionExecuted(event)
      case 'alert':
        return this.translateAlert(event)
      case 'error':
        return this.translateError(event)
      default:
        return []
    }
  }

  private translateSystemInit(event: AntiCheatEvent & { type: 'system.init' }): GameEvent[] {
    return [
      { type: 'world_init', config: { serverId: event.serverId, maxPlayers: event.maxPlayers, version: event.version } },
      { type: 'mode_change', mode: 'monitor' },
      { type: 'scene_switch', target: 'town' },
    ]
  }

  private translatePlayerJoin(event: AntiCheatEvent & { type: 'player.join' }): GameEvent[] {
    // Use player name as npcId (simple mapping: playerId → name-based npcId)
    const npcId = `player_${event.playerId.slice(0, 8)}`
    // Spawn NPC in town plaza center area (x:15-21, z:10-16)
    const spawnX = 15 + Math.random() * 6
    const spawnZ = 10 + Math.random() * 6
    const spawn = { x: spawnX, y: 0, z: spawnZ }
    this.tracker.registerMapping(event.playerId, npcId, event.name, spawn)
    return [
      {
        type: 'npc_spawn',
        npcId,
        name: event.name,
        role: 'player',
        category: 'player',
        spawn,
      },
      { type: 'npc_phase', npcId, phase: 'normal' },
    ]
  }

  private translatePlayerLeave(event: AntiCheatEvent & { type: 'player.leave' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    // 使用 exitType 作为主要判断依据（由 Spigot 端权威标记）
    if (event.exitType === 'cheat_ban') {
      // 作弊封禁退出：NPC 不应 despawn，保留在关押区漫游
      // 先标记为 punishing，再转为 offline
      this.tracker.updatePhase(event.playerId, 'punishing')
      return [
        { type: 'npc_phase', npcId, phase: 'punishing' },
        { type: 'npc_phase', npcId, phase: 'offline' },
      ]
    }

    // 兜底防御：即使 exitType=normal，如果 phase 是 punishing，仍保留
    const phase = this.tracker.getPhase(event.playerId)
    if (phase === 'punishing') {
      return [{ type: 'npc_phase', npcId, phase: 'offline' }]
    }

    // 正常退出：移除 NPC
    this.tracker.removeMapping(event.playerId)
    return [{ type: 'npc_despawn', npcId }]
  }

  private translatePlayerMove(event: AntiCheatEvent & { type: 'player.move' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    // Don't send raw Minecraft coords — the frontend NpcRoaming handles movement.
    // Only send visual hints for anomalies.
    const events: GameEvent[] = []

    const speed = Math.sqrt(event.vx * event.vx + event.vy * event.vy + event.vz * event.vz)
    if (speed > SPEED_ANOMALY_THRESHOLD) {
      events.push({ type: 'npc_glow', npcId, color: 'yellow' })
    }

    return events
  }

  private translatePlayerCombat(event: AntiCheatEvent & { type: 'player.combat' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.attackerId)
    if (!npcId) return []

    const events: GameEvent[] = [
      { type: 'npc_anim', npcId, animation: 'attack' },
    ]

    const victimNpcId = this.tracker.resolveNpcId(event.victimId)
    if (victimNpcId) {
      events.push({ type: 'npc_look_at', npcId, targetNpcId: victimNpcId })
    }

    // P2: Only produce visual hint (glow), NOT phase change.
    // Phase changes are driven exclusively by detection events from rule-engine.
    if (event.angle > COMBAT_ANOMALY_ANGLE || !event.hasLos) {
      events.push({ type: 'npc_glow', npcId, color: 'yellow' })
    }

    return events
  }

  private translatePlayerBlock(event: AntiCheatEvent & { type: 'player.block' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    const events: GameEvent[] = [
      { type: 'npc_anim', npcId, animation: event.action === 'break' ? 'mine' : 'place' },
    ]

    // P2: Only produce visual hint (glow), NOT phase change.
    if (event.speed > BLOCK_ANOMALY_SPEED) {
      events.push({ type: 'npc_glow', npcId, color: 'yellow' })
    }

    return events
  }

  private translatePlayerAction(event: AntiCheatEvent & { type: 'player.action' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    return [
      { type: 'npc_anim', npcId, animation: event.action },
    ]
  }

  private translatePlayerGamemode(event: AntiCheatEvent & { type: 'player.gamemode' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    return [
      { type: 'npc_emote', npcId, emote: `gamemode_${event.newMode}` },
    ]
  }

  translateDetectionToPhaseEvents(
    playerId: string,
    cheatType: CheatType,
    confidence: Confidence,
    targetPhase: PlayerPhase,
  ): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(playerId)
    if (!npcId) return []

    const events: GameEvent[] = [
      { type: 'npc_phase', npcId, phase: targetPhase },
      { type: 'npc_glow', npcId, color: CONFIDENCE_GLOW[confidence] },
      { type: 'alert_popup', playerId, cheatType, confidence, message: `检测到 ${cheatType} (${confidence})` },
      { type: 'record_add', playerId, cheatType, timestamp: Date.now() },
    ]

    if (targetPhase === 'investigating') {
      const buildingKey = CHEAT_TYPE_TO_BUILDING[cheatType]
      if (buildingKey) {
        // S1: Emit escort event instead of direct building enter.
        // Frontend will play escort animation, then emit npc_building_enter
        // when the NPC actually arrives at the building door.
        events.push({
          type: 'npc_escorting',
          npcId,
          buildingKey,
        })
      }
    }

    return events
  }

  private translateDetection(event: AntiCheatEvent & { type: 'detection' }): GameEvent[] {
    return this.translateDetectionToPhaseEvents(
      event.playerId,
      event.cheatType,
      event.confidence,
      this.confidenceToPhase(event.confidence),
    )
  }

  private translateActionExecuted(event: AntiCheatEvent & { type: 'action_executed' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    const events: GameEvent[] = [
      { type: 'npc_anim', npcId, animation: event.action },
    ]

    if (event.action === 'ban' || event.action === 'kick') {
      events.push({ type: 'npc_phase', npcId, phase: 'punishing' })
      events.push({ type: 'ban_animation', npcId })
    } else if (event.action === 'freeze') {
      events.push({ type: 'freeze_effect', npcId })
    } else if (event.action === 'unban') {
      events.push({ type: 'npc_phase', npcId, phase: 'normal' })
      events.push({ type: 'npc_glow', npcId, color: null })
    }

    return events
  }

  private translateAlert(event: AntiCheatEvent & { type: 'alert' }): GameEvent[] {
    const npcId = this.tracker.resolveNpcId(event.playerId)
    if (!npcId) return []

    const aggregated = this.alertManager.addAlert(
      event.playerId,
      event.cheatType,
      event.confidence,
      event.message,
    )

    return [
      { type: 'alert_popup', playerId: event.playerId, cheatType: event.cheatType, confidence: aggregated.confidence, message: event.message },
      { type: 'npc_glow', npcId, color: CONFIDENCE_GLOW[event.confidence] },
    ]
  }

  private translateError(event: AntiCheatEvent & { type: 'error' }): GameEvent[] {
    return [
      { type: 'fx', effect: 'error_flash', params: { message: event.message, recoverable: event.recoverable } },
    ]
  }

  private confidenceToPhase(confidence: Confidence): PlayerPhase {
    switch (confidence) {
      case 'low': return 'suspicious'
      case 'medium': return 'investigating'
      case 'high': return 'confirmed'
    }
  }
}
