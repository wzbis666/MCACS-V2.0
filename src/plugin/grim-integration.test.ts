import { describe, expect, it } from 'vitest'
import { mapGrimCheckToCheatType } from './grim-integration.js'

describe('mapGrimCheckToCheatType', () => {
  it.each([
    ['Reach', 'reach'],
    ['PositionPlace', 'scaffold'],
    ['AutoClickerA', 'auto_clicker'],
    ['Hitboxes', 'kill_aura'],
    ['TimerA', 'speed'],
    ['Simulation', 'fly'],
  ] as const)('maps %s to %s', (check, expected) => {
    expect(mapGrimCheckToCheatType(check)).toBe(expected)
  })
})
