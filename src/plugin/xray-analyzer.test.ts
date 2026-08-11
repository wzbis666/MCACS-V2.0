import { describe, expect, it } from 'vitest'
import { analyzeXRay, type MiningSample } from './xray-analyzer.js'

function sample(index: number, blockType: string = 'STONE', oreDx?: number): MiningSample {
  return {
    timestamp: index * 100,
    blockType,
    x: index,
    y: 12,
    z: index > 4 ? 2 : 0,
    exposedFaces: 1,
    nearbyOres: oreDx === undefined ? [] : [{ type: 'DIAMOND_ORE', dx: oreDx, dy: 0, dz: 0, exposed: false }],
  }
}

describe('analyzeXRay', () => {
  it('explains valuable ore efficiency, hidden directions, turns and path deviation', () => {
    const samples = Array.from({ length: 12 }, (_, index) => sample(
      index,
      index === 4 || index === 10 ? 'DIAMOND_ORE' : 'STONE',
      index === 2 ? 3 : undefined,
    ))
    const analysis = analyzeXRay(samples)!
    expect(analysis.valuableHits).toBe(2)
    expect(analysis.valuableHitEfficiency).toBeCloseTo(2 / 12)
    expect(analysis.crossSampleAnomaly).toBeGreaterThan(1)
    expect(analysis.turnCount).toBeGreaterThan(0)
    expect(analysis.hiddenDirectionMatches).toBe(1)
    expect(analysis.shortestPathDeviation).not.toBeNull()
  })
})
