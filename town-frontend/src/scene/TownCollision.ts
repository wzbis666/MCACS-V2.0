/** Plaza fountain centre shared by the fountain model and NPC collision checks. */
export const FOUNTAIN_CENTER = { x: 18, z: 13 } as const

/** Fountain base radius (1.6) plus clearance for a character model. */
export const FOUNTAIN_EXCLUSION_RADIUS = 2.2

/** Check whether a character centre would overlap the fountain/capybara area. */
export function isInsideFountainExclusionZone(x: number, z: number): boolean {
  const dx = x - FOUNTAIN_CENTER.x
  const dz = z - FOUNTAIN_CENTER.z
  return dx * dx + dz * dz <= FOUNTAIN_EXCLUSION_RADIUS * FOUNTAIN_EXCLUSION_RADIUS
}
