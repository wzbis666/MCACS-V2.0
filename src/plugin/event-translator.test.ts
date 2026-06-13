import { describe, expect, it } from 'vitest'
import { translateSpigotMessage } from './event-translator.js'

describe('translateSpigotMessage', () => {
  it('translates Spigot action execution acknowledgements', () => {
    const event = translateSpigotMessage({
      type: 'action_executed',
      playerId: '00000000-0000-0000-0000-000000000001',
      action: 'ban',
      actionId: 'act-1',
      success: true,
      message: 'Player banned',
    })

    expect(event).toEqual({
      type: 'action_executed',
      playerId: '00000000-0000-0000-0000-000000000001',
      action: 'ban',
      actionId: 'act-1',
      result: 'success',
    })
  })

  it('normalizes failed action execution acknowledgements', () => {
    const event = translateSpigotMessage({
      type: 'action_executed',
      uuid: '00000000-0000-0000-0000-000000000002',
      action: 'kick',
      actionId: 'act-2',
      success: false,
    })

    expect(event).toMatchObject({
      type: 'action_executed',
      playerId: '00000000-0000-0000-0000-000000000002',
      action: 'kick',
      actionId: 'act-2',
      result: 'failed',
    })
  })
})
