import type { CheatType } from '../contracts/index.js'

export type StrategyPresetName = 'survival' | 'pvp' | 'mixed'
export interface StrategyPreset {
  name: StrategyPresetName
  enabledDetectors: ReadonlySet<CheatType>
}

const ALL: CheatType[] = ['fly', 'speed', 'kill_aura', 'x_ray', 'scaffold', 'auto_clicker', 'reach']
const PRESETS: Record<StrategyPresetName, StrategyPreset> = {
  survival: { name: 'survival', enabledDetectors: new Set(['fly', 'speed', 'x_ray', 'scaffold', 'reach']) },
  pvp: { name: 'pvp', enabledDetectors: new Set(['fly', 'speed', 'kill_aura', 'auto_clicker', 'reach']) },
  mixed: { name: 'mixed', enabledDetectors: new Set(ALL) },
}

export function resolveStrategyPreset(value: string | undefined = process.env.ACS_PRESET): StrategyPreset {
  const name = value?.toLowerCase() as StrategyPresetName | undefined
  return name && name in PRESETS ? PRESETS[name] : PRESETS.survival
}
