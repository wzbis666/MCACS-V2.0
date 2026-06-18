import type { ActionType, AntiCheatEvent, SpigotMessage } from '../contracts/index.js'

// Spigot sends: uuid, attacker, victim
// Node expects: playerId, attackerId, victimId
// This helper normalizes field names from Spigot's naming convention.
function normalizePlayerId(msg: Record<string, unknown>): string {
  return String(msg.playerId ?? msg.uuid ?? '')
}

export function translateSpigotMessage(msg: SpigotMessage): AntiCheatEvent | null {
  const raw = msg as unknown as Record<string, unknown>

  switch (msg.type) {
    case 'server_start':
      return {
        type: 'system.init',
        serverId: String(msg.serverId ?? 'unknown'),
        maxPlayers: Number(msg.maxPlayers ?? 20),
        version: String(msg.version ?? '1.0.0'),
        tps: raw.tps !== undefined && raw.tps !== null ? Number(raw.tps) : undefined,
      }

    case 'player_join':
      return {
        type: 'player.join',
        playerId: normalizePlayerId(raw),
        name: String(msg.name ?? ''),
        ip: String(msg.ip ?? ''),
        gameMode: String(msg.gameMode ?? 'survival'),
      }

    case 'player_leave':
      return {
        type: 'player.leave',
        playerId: normalizePlayerId(raw),
        reason: String(msg.reason ?? 'disconnected'),
        exitType: (String(raw.exitType) === 'cheat_ban' ? 'cheat_ban' : 'normal') as 'normal' | 'cheat_ban',
      }

    case 'player_move':
      return {
        type: 'player.move',
        playerId: normalizePlayerId(raw),
        x: Number(msg.x ?? 0),
        y: Number(msg.y ?? 0),
        z: Number(msg.z ?? 0),
        vx: Number(msg.vx ?? 0),
        vy: Number(msg.vy ?? 0),
        vz: Number(msg.vz ?? 0),
        onGround: Boolean(msg.onGround),
      }

    case 'player_combat':
      return {
        type: 'player.combat',
        attackerId: String(raw.attackerId ?? raw.attacker ?? ''),
        victimId: String(raw.victimId ?? raw.victim ?? ''),
        distance: Number(msg.distance ?? 0),
        angle: Number(msg.angle ?? 0),
        cps: Number(msg.cps ?? 0),
        hasLos: Boolean(msg.hasLos),
      }

    case 'player_block':
      return {
        type: 'player.block',
        playerId: normalizePlayerId(raw),
        action: msg.action === 'place' ? 'place' : 'break',
        blockType: String(msg.blockType ?? ''),
        speed: Number(msg.speed ?? 0),
      }

    case 'player_action':
      return {
        type: 'player.action',
        playerId: normalizePlayerId(raw),
        action: String(msg.action ?? ''),
        state: Boolean(msg.state),
      }

    case 'game_mode_change':
      return {
        type: 'player.gamemode',
        playerId: normalizePlayerId(raw),
        oldMode: String(msg.oldMode ?? ''),
        newMode: String(msg.newMode ?? ''),
      }

    case 'action_executed':
      return {
        type: 'action_executed',
        playerId: normalizePlayerId(raw),
        action: String(raw.action ?? 'warning') as ActionType,
        actionId: raw.actionId === undefined ? undefined : String(raw.actionId),
        result: raw.result !== undefined ? String(raw.result) : raw.success === true ? 'success' : 'failed',
      }

    case 'heartbeat':
      return {
        type: 'heartbeat',
        tps: raw.tps !== undefined && raw.tps !== null ? Number(raw.tps) : undefined,
      }

    case 'ban_executed':
      return {
        type: 'ban_executed',
        playerId: normalizePlayerId(raw),
        name: String(raw.name ?? ''),
        reason: String(raw.reason ?? ''),
        duration: String(raw.duration ?? 'permanent'),
        source: String(raw.source ?? 'anticheat'),
      }

    case 'unban_executed':
      return {
        type: 'unban_executed',
        playerId: normalizePlayerId(raw),
        name: String(raw.name ?? ''),
        source: String(raw.source ?? 'anticheat'),
      }

    default:
      return null
  }
}
