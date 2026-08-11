import type { CheatType } from '../contracts/index.js'

/** Map Grim check families into the existing dashboard/case taxonomy. */
export function mapGrimCheckToCheatType(checkName: string): CheatType {
  const check = checkName.toLowerCase()

  if (check.includes('reach')) return 'reach'
  if (check.includes('place') || check.includes('scaffold')) return 'scaffold'
  if (check.includes('autoclick')) return 'auto_clicker'
  if (check.includes('aim') || check.includes('hitbox') || check.includes('interact')) return 'kill_aura'
  if (check.includes('timer') || check.includes('sprint') || check.includes('noslow')) return 'speed'
  return 'fly'
}
