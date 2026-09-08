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
      message: 'Player banned',
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

  it('translates Grim violation signals into the shared event contract', () => {
    const event = translateSpigotMessage({
      type: 'grim_violation',
      uuid: '00000000-0000-0000-0000-000000000003',
      name: 'LocalPlayer',
      checkName: 'Simulation',
      violationLevel: 20,
      severity: 'standard',
      threshold: 20,
      timestamp: 123456,
    })

    expect(event).toEqual({
      type: 'grim.violation',
      playerId: '00000000-0000-0000-0000-000000000003',
      name: 'LocalPlayer',
      checkName: 'Simulation',
      violationLevel: 20,
      severity: 'standard',
      threshold: 20,
      timestamp: 123456,
    })
  })
})
