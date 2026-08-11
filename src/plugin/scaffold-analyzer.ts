export interface ScaffoldSample {
  timestamp: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  placedFace: string
  placementIntervalMs: number
}

export interface ScaffoldAnalysis {
  sampleCount: number
  rapidPlacements: number
  averageIntervalMs: number | null
  downwardLookRatio: number
  unusualFaceRatio: number
  path: Array<{ x: number; y: number; z: number; timestamp: number; yaw: number; pitch: number; placedFace: string }>
}

export function analyzeScaffold(samples: ScaffoldSample[]): ScaffoldAnalysis | null {
  if (samples.length === 0) return null
  const intervals = samples.map(sample => sample.placementIntervalMs).filter(value => value > 0)
  return {
    sampleCount: samples.length,
    rapidPlacements: intervals.filter(value => value < 120).length,
    averageIntervalMs: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null,
    downwardLookRatio: samples.filter(sample => sample.pitch >= 55).length / samples.length,
    unusualFaceRatio: samples.filter(sample => !['UP', 'NORTH', 'SOUTH', 'EAST', 'WEST'].includes(sample.placedFace)).length / samples.length,
    path: samples.map(sample => ({ ...sample })),
  }
}
