import { describe, expect, it } from 'vitest'
import { AlertManager } from './AlertManager.js'
import { EventTranslator } from './EventTranslator.js'
import { PlayerStateTracker } from './PlayerStateTracker.js'

const PLAYER_ID = '00000000-0000-0000-0000-000000000001'
const NPC_ID = 'player_00000000'

function createTranslator() {
  const tracker = new PlayerStateTracker()
  const translator = new EventTranslator(tracker, new AlertManager())
  translator.translate({
    type: 'player.join',
    playerId: PLAYER_ID,
    name: 'TestPlayer',
    ip: '127.0.0.1',
    gameMode: 'survival',
  })
  return { tracker, translator }
}

describe('EventTranslator player leave', () => {
  it('despawns a normal exit even when the previous phase was punishing', () => {
    const { tracker, translator } = createTranslator()
    tracker.updatePhase(PLAYER_ID, 'punishing')

    const events = translator.translate({
      type: 'player.leave',
      playerId: PLAYER_ID,
      reason: 'DISCONNECT',
      exitType: 'normal',
    })

    expect(events).toEqual([{ type: 'npc_despawn', npcId: NPC_ID }])
    expect(tracker.resolveNpcId(PLAYER_ID)).toBeUndefined()
  })

  it('keeps an explicitly cheat-banned player in the detention flow', () => {
    const { tracker, translator } = createTranslator()

    const events = translator.translate({
      type: 'player.leave',
      playerId: PLAYER_ID,
      reason: 'BANNED',
      exitType: 'cheat_ban',
    })

    expect(events).toEqual([
      { type: 'npc_phase', npcId: NPC_ID, phase: 'punishing' },
      { type: 'npc_phase', npcId: NPC_ID, phase: 'offline' },
    ])
    expect(tracker.resolveNpcId(PLAYER_ID)).toBe(NPC_ID)
  })
})
