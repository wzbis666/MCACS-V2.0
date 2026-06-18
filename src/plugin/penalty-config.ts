// @desc PenaltyConfig — 配置加载器，支持热重载
//
// 从 penalty-config.yml 加载配置，监听文件变更自动重载。
// 提供默认值兜底，确保配置缺失时系统仍可运行。

import { readFileSync, existsSync, watchFile, unwatchFile } from 'node:fs'
import type { CheatType, Confidence } from '../contracts/index.js'

export interface PenaltyConfig {
  enabled: boolean
  /** 警告显示时长（毫秒），同时作为检测冷却时间 */
  warningDurationMs: number
  /** 二次违规封禁时长（字符串格式：1h/24h/7d/permanent） */
  secondOffenseBanDuration: string
  vpWeights: Record<Confidence, number>
  vpTypeMultipliers: Record<CheatType, number>
  decayIntervalMinutes: number
  decayAmount: number
  snapshotIntervalMinutes: number
  thresholds: {
    L0: number
    L1: number
    L2: number
    L3: number
    L4: number
    L5: number
  }
  repeatOffenderWindowDays: number
  repeatDurationMultiplier: number
  autoUpgradeOnNth: number
  whitelistVPMultiplier: number
  newPlayerGraceMinutes: number
  newPlayerVPMultiplier: number
  actionRetryMax: number
  actionRetryIntervalSeconds: number
  ipSharedWeight: number
}

const DEFAULT_CONFIG: PenaltyConfig = {
  enabled: true,
  warningDurationMs: 6000,
  secondOffenseBanDuration: '24h',
  vpWeights: { low: 1, medium: 3, high: 8 },
  vpTypeMultipliers: {
    kill_aura: 1.5,
    fly: 1.2,
    speed: 1.2,
    reach: 1.3,
    x_ray: 1.0,
    scaffold: 1.0,
    auto_clicker: 0.8,
  },
  decayIntervalMinutes: 10,
  decayAmount: 1,
  snapshotIntervalMinutes: 5,
  thresholds: { L0: 5, L1: 15, L2: 30, L3: 60, L4: 100, L5: 150 },
  repeatOffenderWindowDays: 30,
  repeatDurationMultiplier: 1.5,
  autoUpgradeOnNth: 3,
  whitelistVPMultiplier: 2.0,
  newPlayerGraceMinutes: 5,
  newPlayerVPMultiplier: 0.5,
  actionRetryMax: 2,
  actionRetryIntervalSeconds: 30,
  ipSharedWeight: 0.7,
}

let currentConfig: PenaltyConfig = { ...DEFAULT_CONFIG }
let configPath: string | null = null
let watcherActive = false

/** 加载配置文件 */
export function loadConfig(filePath?: string): PenaltyConfig {
  configPath = filePath ?? './penalty-config.yml'

  if (!existsSync(configPath)) {
    console.log(`[PenaltyConfig] Config file not found: ${configPath}, using defaults`)
    return { ...DEFAULT_CONFIG }
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = parseYamlSimple(content)
    const config = mergeWithDefaults(parsed)
    currentConfig = config
    console.log(`[PenaltyConfig] Loaded from ${configPath}`)
    return config
  } catch (err) {
    console.error(`[PenaltyConfig] Failed to load config:`, err)
    return { ...DEFAULT_CONFIG }
  }
}

/** 获取当前配置 */
export function getConfig(): PenaltyConfig {
  return currentConfig
}

/** 启动文件监听，自动热重载 */
export function startConfigWatch(onReload?: (config: PenaltyConfig) => void): void {
  if (watcherActive || !configPath) return

  try {
    watchFile(configPath, { interval: 5000 }, () => {
      console.log(`[PenaltyConfig] Config file changed, reloading...`)
      const newConfig = loadConfig(configPath!)
      currentConfig = newConfig
      if (onReload) {
        onReload(newConfig)
      }
    })
    watcherActive = true
    console.log(`[PenaltyConfig] Watching ${configPath} for changes`)
  } catch (err) {
    console.error(`[PenaltyConfig] Failed to start config watch:`, err)
  }
}

/** 停止文件监听 */
export function stopConfigWatch(): void {
  if (watcherActive && configPath) {
    unwatchFile(configPath)
    watcherActive = false
  }
}

// ── 简易 YAML 解析器（不依赖第三方库） ──

function parseYamlSimple(content: string): Record<string, any> {
  const result: Record<string, any> = {}
  const stack: Array<{ obj: Record<string, any>; indent: number }> = [{ obj: result, indent: -1 }]

  for (const line of content.split('\n')) {
    // 跳过注释和空行
    const trimmed = line.replace(/#.*$/, '').trimEnd()
    if (trimmed.trim() === '' || trimmed.trim().startsWith('#')) continue

    const indent = line.length - line.trimStart().length
    const match = trimmed.trim().match(/^(\w[\w_-]*):\s*(.*)$/)
    if (!match) continue

    const key = match[1]
    const value = match[2].trim()

    // 回退到正确的嵌套层级
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }

    const current = stack[stack.length - 1].obj

    if (value === '') {
      // 新的嵌套对象
      const newObj: Record<string, any> = {}
      current[key] = newObj
      stack.push({ obj: newObj, indent })
    } else {
      // 键值对
      current[key] = parseValue(value)
    }
  }

  return result
}

function parseValue(value: string): any {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
  return value
}

function mergeWithDefaults(parsed: Record<string, any>): PenaltyConfig {
  const p = parsed.penalty ?? {}

  return {
    enabled: p.enabled ?? DEFAULT_CONFIG.enabled,
    warningDurationMs: p.warning_duration_ms ?? DEFAULT_CONFIG.warningDurationMs,
    secondOffenseBanDuration: p.second_offense_ban_duration ?? DEFAULT_CONFIG.secondOffenseBanDuration,
    vpWeights: {
      low: p.vp?.weights?.low ?? DEFAULT_CONFIG.vpWeights.low,
      medium: p.vp?.weights?.medium ?? DEFAULT_CONFIG.vpWeights.medium,
      high: p.vp?.weights?.high ?? DEFAULT_CONFIG.vpWeights.high,
    },
    vpTypeMultipliers: {
      kill_aura: p.vp?.type_multipliers?.kill_aura ?? DEFAULT_CONFIG.vpTypeMultipliers.kill_aura,
      fly: p.vp?.type_multipliers?.fly ?? DEFAULT_CONFIG.vpTypeMultipliers.fly,
      speed: p.vp?.type_multipliers?.speed ?? DEFAULT_CONFIG.vpTypeMultipliers.speed,
      reach: p.vp?.type_multipliers?.reach ?? DEFAULT_CONFIG.vpTypeMultipliers.reach,
      x_ray: p.vp?.type_multipliers?.x_ray ?? DEFAULT_CONFIG.vpTypeMultipliers.x_ray,
      scaffold: p.vp?.type_multipliers?.scaffold ?? DEFAULT_CONFIG.vpTypeMultipliers.scaffold,
      auto_clicker: p.vp?.type_multipliers?.auto_clicker ?? DEFAULT_CONFIG.vpTypeMultipliers.auto_clicker,
    },
    decayIntervalMinutes: p.vp?.decay?.interval_minutes ?? DEFAULT_CONFIG.decayIntervalMinutes,
    decayAmount: p.vp?.decay?.amount ?? DEFAULT_CONFIG.decayAmount,
    snapshotIntervalMinutes: p.vp?.snapshot_interval_minutes ?? DEFAULT_CONFIG.snapshotIntervalMinutes,
    thresholds: {
      L0: p.thresholds?.L0_warn ?? DEFAULT_CONFIG.thresholds.L0,
      L1: p.thresholds?.L1_kick ?? DEFAULT_CONFIG.thresholds.L1,
      L2: p.thresholds?.L2_ban_1h ?? DEFAULT_CONFIG.thresholds.L2,
      L3: p.thresholds?.L3_ban_24h ?? DEFAULT_CONFIG.thresholds.L3,
      L4: p.thresholds?.L4_ban_7d ?? DEFAULT_CONFIG.thresholds.L4,
      L5: p.thresholds?.L5_ban_permanent ?? DEFAULT_CONFIG.thresholds.L5,
    },
    repeatOffenderWindowDays: p.repeat_offender?.window_days ?? DEFAULT_CONFIG.repeatOffenderWindowDays,
    repeatDurationMultiplier: p.repeat_offender?.duration_multiplier ?? DEFAULT_CONFIG.repeatDurationMultiplier,
    autoUpgradeOnNth: p.repeat_offender?.auto_upgrade_on_nth ?? DEFAULT_CONFIG.autoUpgradeOnNth,
    whitelistVPMultiplier: p.whitelist_vp_multiplier ?? DEFAULT_CONFIG.whitelistVPMultiplier,
    newPlayerGraceMinutes: p.new_player_grace_minutes ?? DEFAULT_CONFIG.newPlayerGraceMinutes,
    newPlayerVPMultiplier: p.new_player_vp_multiplier ?? DEFAULT_CONFIG.newPlayerVPMultiplier,
    actionRetryMax: p.action_retry?.max_attempts ?? DEFAULT_CONFIG.actionRetryMax,
    actionRetryIntervalSeconds: p.action_retry?.interval_seconds ?? DEFAULT_CONFIG.actionRetryIntervalSeconds,
    ipSharedWeight: p.ip_shared_weight ?? DEFAULT_CONFIG.ipSharedWeight,
  }
}
