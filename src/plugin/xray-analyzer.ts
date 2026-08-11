import type { NearbyOreContext } from '../contracts/index.js'

const HIGH_VALUE_ORES = new Set([
  'DIAMOND_ORE', 'DEEPSLATE_DIAMOND_ORE', 'EMERALD_ORE',
  'DEEPSLATE_EMERALD_ORE', 'ANCIENT_DEBRIS',
])

export interface MiningSample {
  timestamp: number
  blockType: string
  x: number
  y: number
  z: number
  exposedFaces: number
  nearbyOres: NearbyOreContext[]
}

export interface XRayAnalysis {
  sampleCount: number
  valuableHits: number
  valuableHitEfficiency: number
  shortestPathDeviation: number | null
  crossSampleAnomaly: number
  turnCount: number
  hiddenOreCount: number
  hiddenDirectionMatches: number
  trajectory: Array<{ x: number; y: number; z: number; timestamp: number; valuable: boolean }>
  oreContext: Array<{ type: string; x: number; y: number; z: number; exposed: boolean }>
  comparison: {
    normal: string
    suspicious: string
  }
}

export function analyzeXRay(samples: MiningSample[]): XRayAnalysis | null {
  if (samples.length === 0) return null
  const ordered = samples.slice().sort((a, b) => a.timestamp - b.timestamp)
  const valuableIndexes = ordered
    .map((sample, index) => HIGH_VALUE_ORES.has(sample.blockType.toUpperCase()) ? index : -1)
    .filter(index => index >= 0)
  const efficiency = valuableIndexes.length / ordered.length
  const baseline = 0.025
  const standardError = Math.sqrt(baseline * (1 - baseline) / Math.max(1, ordered.length))
  const anomaly = standardError > 0 ? Math.max(0, (efficiency - baseline) / standardError) : 0
  const deviations: number[] = []

  for (let valueIndex = 1; valueIndex < valuableIndexes.length; valueIndex++) {
    const startIndex = valuableIndexes[valueIndex - 1]
    const endIndex = valuableIndexes[valueIndex]
    let actualPath = 0
    for (let index = startIndex + 1; index <= endIndex; index++) {
      actualPath += distance(ordered[index - 1], ordered[index])
    }
    const shortestPath = distance(ordered[startIndex], ordered[endIndex])
    if (shortestPath > 0) deviations.push(Math.max(0, actualPath / shortestPath - 1))
  }

  let turnCount = 0
  let hiddenDirectionMatches = 0
  for (let index = 1; index < ordered.length - 1; index++) {
    const before = vector(ordered[index - 1], ordered[index])
    const after = vector(ordered[index], ordered[index + 1])
    if (angleDegrees(before, after) >= 45) turnCount++
  }
  for (let index = 0; index < ordered.length - 1; index++) {
    const next = vector(ordered[index], ordered[index + 1])
    const hiddenOres = ordered[index].nearbyOres.filter(ore => !ore.exposed)
    if (hiddenOres.some(ore => cosine(next, { x: ore.dx, y: ore.dy, z: ore.dz }) >= 0.82)) {
      hiddenDirectionMatches++
    }
  }

  const oreContext = new Map<string, XRayAnalysis['oreContext'][number]>()
  for (const sample of ordered) {
    for (const ore of sample.nearbyOres) {
      const item = { type: ore.type, x: sample.x + ore.dx, y: sample.y + ore.dy, z: sample.z + ore.dz, exposed: ore.exposed }
      oreContext.set(`${item.type}:${item.x}:${item.y}:${item.z}`, item)
    }
  }

  const deviation = deviations.length > 0
    ? deviations.reduce((total, value) => total + value, 0) / deviations.length
    : null
  return {
    sampleCount: ordered.length,
    valuableHits: valuableIndexes.length,
    valuableHitEfficiency: efficiency,
    shortestPathDeviation: deviation,
    crossSampleAnomaly: Math.min(99, anomaly),
    turnCount,
    hiddenOreCount: [...oreContext.values()].filter(ore => !ore.exposed).length,
    hiddenDirectionMatches,
    trajectory: ordered.map(sample => ({
      x: sample.x, y: sample.y, z: sample.z, timestamp: sample.timestamp,
      valuable: HIGH_VALUE_ORES.has(sample.blockType.toUpperCase()),
    })),
    oreContext: [...oreContext.values()],
    comparison: {
      normal: '分支挖矿通常保持规则间距，转向与已暴露洞穴或矿脉相关。',
      suspicious: '疑似追矿会连续朝未暴露高价值矿脉转向，并以接近最短路径命中。',
    },
  }
}

function distance(a: Pick<MiningSample, 'x' | 'y' | 'z'>, b: Pick<MiningSample, 'x' | 'y' | 'z'>): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}

function vector(a: Pick<MiningSample, 'x' | 'y' | 'z'>, b: Pick<MiningSample, 'x' | 'y' | 'z'>) {
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
}

function cosine(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const denominator = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)
  return denominator === 0 ? 0 : (a.x * b.x + a.y * b.y + a.z * b.z) / denominator
}

function angleDegrees(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.acos(Math.max(-1, Math.min(1, cosine(a, b)))) * 180 / Math.PI
}
