import { describe, expect, it } from 'vitest'
import { normalizePhysics } from './physics-normalizer.js'

describe('normalizePhysics', () => {
  it('expands the legal envelope for lag, effects, vehicles, knockback and teleport', () => {
    const base = normalizePhysics([{ timestamp: 1, vx: 8, vy: 0, vz: 0, tps: 20, ping: 0, statusEffects: [], exemptions: [] }])!
    const normalized = normalizePhysics([{ timestamp: 1, vx: 8, vy: 0, vz: 0, tps: 16, ping: 120, statusEffects: ['speed:2'], exemptions: ['vehicle', 'knockback_grace'] }])!
    const teleported = normalizePhysics([{ timestamp: 1, vx: 80, vy: 30, vz: 0, tps: 20, ping: 20, statusEffects: [], exemptions: ['teleport_grace'] }])!
    expect(base.exceededFrames).toBe(1)
    expect(normalized.frames[0].legalHorizontalSpeed).toBeGreaterThan(25)
    expect(normalized.exceededFrames).toBe(0)
    expect(teleported.exceededFrames).toBe(0)
  })
})
