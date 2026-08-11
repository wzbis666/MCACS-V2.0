export interface MovementEnvironment {
  timestamp: number
  vx: number
  vy: number
  vz: number
  tps: number
  ping: number | null
  statusEffects: string[]
  exemptions: string[]
}

export interface PhysicsFrame {
  timestamp: number
  actualHorizontalSpeed: number
  legalHorizontalSpeed: number
  actualVerticalSpeed: number
  legalVerticalMin: number
  legalVerticalMax: number
  exemptions: string[]
}

export interface PhysicsAnalysis {
  frames: PhysicsFrame[]
  exceededFrames: number
  exemptedFrames: number
}

export function normalizePhysics(events: MovementEnvironment[]): PhysicsAnalysis | null {
  if (events.length === 0) return null
  const frames = events.map(event => {
    const tpsFactor = 20 / Math.max(10, Math.min(20, event.tps))
    const pingFactor = 1 + Math.min(0.25, Math.max(0, event.ping ?? 0) / 800)
    const speedLevel = effectLevel(event.statusEffects, 'speed')
    const jumpLevel = effectLevel(event.statusEffects, 'jump_boost')
    let horizontal = 5.8 * (1 + speedLevel * 0.2) * tpsFactor * pingFactor
    let verticalMin = -12 * tpsFactor
    let verticalMax = (8.4 + jumpLevel * 2) * tpsFactor
    if (event.statusEffects.some(effect => effect.startsWith('slow_falling'))) verticalMin = -2.5 * tpsFactor
    if (event.exemptions.includes('vehicle')) horizontal = Math.max(horizontal, 25)
    if (event.exemptions.includes('elytra')) { horizontal = Math.max(horizontal, 35); verticalMin = -20 }
    if (event.exemptions.includes('water') || event.exemptions.includes('swimming')) horizontal = Math.max(horizontal, 10)
    if (event.exemptions.includes('knockback_grace')) { horizontal += 12; verticalMax += 10 }
    if (event.exemptions.includes('teleport_grace')) { horizontal = 100; verticalMin = -100; verticalMax = 100 }
    return {
      timestamp: event.timestamp,
      actualHorizontalSpeed: Math.hypot(event.vx, event.vz),
      legalHorizontalSpeed: horizontal,
      actualVerticalSpeed: event.vy,
      legalVerticalMin: verticalMin,
      legalVerticalMax: verticalMax,
      exemptions: event.exemptions,
    }
  })
  return {
    frames,
    exceededFrames: frames.filter(frame => frame.actualHorizontalSpeed > frame.legalHorizontalSpeed
      || frame.actualVerticalSpeed < frame.legalVerticalMin
      || frame.actualVerticalSpeed > frame.legalVerticalMax).length,
    exemptedFrames: frames.filter(frame => frame.exemptions.length > 0).length,
  }
}

function effectLevel(effects: string[], name: string): number {
  const match = effects.find(effect => effect.startsWith(`${name}:`))
  if (!match) return 0
  const level = Number(match.split(':')[1])
  return Number.isFinite(level) ? Math.max(0, level) : 0
}
