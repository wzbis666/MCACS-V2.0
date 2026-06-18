// EventDispatcher — route GameEvents to handlers

import type { GameEvent } from '../data/GameProtocol.js'
import type { MainScene } from '../game/MainScene.js'

export class EventDispatcher {
  private scene: MainScene

  constructor(scene: MainScene) {
    this.scene = scene
  }

  dispatch(event: GameEvent): void {
    switch (event.type) {
      // NPC lifecycle
      case 'npc_spawn':
        this.scene.onNpcSpawn(event.npcId, event.name, event.role, event.spawn)
        break
      case 'npc_despawn':
        console.log(`[EventDispatcher] dispatching npc_despawn: npcId=${event.npcId}`)
        this.scene.onNpcDespawn(event.npcId)
        break
      case 'npc_phase':
        this.scene.onNpcPhase(event.npcId, event.phase)
        break
      case 'npc_move_to':
        this.scene.onNpcMoveTo(event.npcId, event.target)
        break
      case 'npc_glow':
        this.scene.onNpcGlow(event.npcId, event.color)
        break
      case 'npc_emoji':
        this.scene.onNpcEmoji(event.npcId, event.emoji)
        break
      case 'npc_anim':
        this.scene.onNpcAnim(event.npcId, event.animation)
        break
      case 'npc_look_at':
        this.scene.onNpcLookAt(event.npcId, event.targetNpcId)
        break
      case 'npc_emote':
        this.scene.onNpcEmote(event.npcId, event.emote)
        break

      // Dialog / alerts
      case 'dialog_message':
        this.scene.onDialogMessage(event.npcId, event.text, event.isStreaming)
        break
      case 'alert_popup':
        this.scene.onAlertPopup(event.playerId, event.cheatType, event.confidence, event.message, event.npcId)
        break
      case 'player_stats': {
        // Global server stats (has onlinePlayers) vs per-NPC stats (has npcId)
        if ('onlinePlayers' in event) {
          this.scene.onServerStats(event as any)
        } else {
          this.scene.onPlayerStats((event as any).npcId, (event as any).stats)
        }
        break
      }

      // Scene / mode
      case 'mode_change':
        this.scene.onModeChange(event.mode)
        break
      case 'scene_switch':
        this.scene.onSceneSwitch(event.target)
        break
      case 'progress':
        this.scene.onProgress(event.current, event.total, event.label)
        break

      // Workstation
      case 'workstation_assign':
        this.scene.onWorkstationAssign(event.npcId, event.stationId)
        break
      case 'workstation_screen':
        this.scene.onWorkstationScreen(event.stationId, event.state)
        break
      case 'workstation_released':
        this.scene.onWorkstationReleased(event.npcId, event.stationId)
        break

      // VFX
      case 'fx':
        this.scene.onFx(event.effect, event.params)
        break

      // Ban animation
      case 'ban_animation':
        this.scene.onBanAnimation(event.npcId)
        break
      case 'freeze_effect':
        this.scene.onFreezeEffect(event.npcId)
        break
      case 'record_add':
        this.scene.onRecordAdd(event.playerId, event.cheatType, event.timestamp, event.npcId)
        break

      // World init
      case 'world_init':
        this.scene.onWorldInit(event.config)
        break
      case 'set_time':
        this.scene.onSetTime(event.action, event.hour)
        break
      case 'set_weather':
        this.scene.onSetWeather(event.action, event.weather)
        break

      // Building enter/leave
      case 'npc_building_enter':
        this.scene.onNpcBuildingEnter(event.npcId, event.buildingKey, event.stayDurationMs)
        break
      case 'npc_building_leave':
        this.scene.onNpcBuildingLeave(event.npcId, event.buildingKey, event.actualStayMs)
        break

      // Escort
      case 'npc_escorting':
        this.scene.onNpcEscorting(event.npcId, event.buildingKey)
        break

      // Activity
      case 'npc_activity':
        this.scene.onNpcActivity(event.npcId, event.icon, event.message, event.time)
        break
      case 'npc_activity_status':
        this.scene.onNpcActivityStatus(event.npcId, event.success)
        break
      case 'npc_activity_stream':
        this.scene.onNpcActivityStream(event.npcId, event.delta)
        break
      case 'npc_activity_stream_end':
        this.scene.onNpcActivityStreamEnd(event.npcId)
        break

      // Penalty & VP
      case 'phase_change':
        this.scene.onPhaseChange((event as any).playerId, (event as any).oldPhase, (event as any).newPhase, (event as any).reason, (event as any).vpTotal, (event as any).cheatType, (event as any).npcId)
        break
      case 'vp_update':
        this.scene.onVPUpdate((event as any).playerId, (event as any).totalVP, (event as any).vpByType)
        break
      case 'penalty':
        this.scene.onPenaltyEvent(event as any)
        break
    }
  }
}
