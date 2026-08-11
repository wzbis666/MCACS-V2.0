import { describe, expect, it } from 'vitest'
import { resolveStrategyPreset } from './strategy-presets.js'
import { resolveRuntimeMode } from './runtime-mode.js'

describe('runtime deployment presets', () => {
  it('defaults to survival dashboard and supports explicit pvp, mixed and headless modes', () => {
    expect(resolveRuntimeMode(undefined)).toBe('dashboard')
    expect(resolveRuntimeMode('headless')).toBe('headless')
    expect(resolveStrategyPreset(undefined).name).toBe('survival')
    expect(resolveStrategyPreset('pvp').enabledDetectors.has('kill_aura')).toBe(true)
    expect(resolveStrategyPreset('mixed').enabledDetectors.size).toBe(7)
  })
})
