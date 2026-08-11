import { describe, expect, it } from 'vitest'
import { analyzeScaffold } from './scaffold-analyzer.js'

describe('analyzeScaffold', () => {
  it('summarizes look angle, placement face, interval and path', () => {
    const analysis = analyzeScaffold([
      { timestamp: 100, x: 0, y: 64, z: 0, yaw: 0, pitch: 70, placedFace: 'DOWN', placementIntervalMs: 80 },
      { timestamp: 180, x: 1, y: 64, z: 0, yaw: 5, pitch: 72, placedFace: 'UP', placementIntervalMs: 80 },
    ])!
    expect(analysis).toMatchObject({ sampleCount: 2, rapidPlacements: 2, downwardLookRatio: 1, unusualFaceRatio: 0.5 })
    expect(analysis.averageIntervalMs).toBe(80)
    expect(analysis.path).toHaveLength(2)
  })
})
