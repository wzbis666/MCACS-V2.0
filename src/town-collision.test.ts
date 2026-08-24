import { describe, expect, it } from 'vitest'

const collisionModulePath = '../town-frontend/src/scene/TownCollision.ts'

describe('capybara fountain exclusion zone', () => {
  it('blocks the fountain centre and points inside the character clearance', async () => {
    const {
      FOUNTAIN_CENTER,
      FOUNTAIN_EXCLUSION_RADIUS,
      isInsideFountainExclusionZone,
    } = await import(collisionModulePath)
    expect(isInsideFountainExclusionZone(FOUNTAIN_CENTER.x, FOUNTAIN_CENTER.z)).toBe(true)
    expect(isInsideFountainExclusionZone(
      FOUNTAIN_CENTER.x + FOUNTAIN_EXCLUSION_RADIUS - 0.01,
      FOUNTAIN_CENTER.z,
    )).toBe(true)
  })

  it('allows plaza positions outside the exclusion zone', async () => {
    const {
      FOUNTAIN_CENTER,
      FOUNTAIN_EXCLUSION_RADIUS,
      isInsideFountainExclusionZone,
    } = await import(collisionModulePath)
    expect(isInsideFountainExclusionZone(
      FOUNTAIN_CENTER.x + FOUNTAIN_EXCLUSION_RADIUS + 0.01,
      FOUNTAIN_CENTER.z,
    )).toBe(false)
    expect(isInsideFountainExclusionZone(18, 16)).toBe(false)
  })
})
