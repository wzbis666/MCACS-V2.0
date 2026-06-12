import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  BanEntry,
  WhitelistEntry,
  CheatRecord,
  ServerStats,
  CheatType,
  RecordsQuery,
} from '../contracts/index.js'
import type { RecordStore } from './record-store.js'

const DURATION_MAP: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
  permanent: Infinity,
}

export class BanManager {
  private bans = new Map<string, BanEntry>()
  private whitelist = new Map<string, WhitelistEntry>()
  private recordStore: RecordStore
  private bansFile: string
  private whitelistFile: string

  constructor(recordStore: RecordStore, dataDir: string) {
    this.recordStore = recordStore
    this.bansFile = `${dataDir}/bans.jsonl`
    this.whitelistFile = `${dataDir}/whitelist.jsonl`

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    this.loadBans()
    this.loadWhitelist()
  }

  banPlayer(playerId: string, playerName: string, reason: string, duration: string, source?: string): BanEntry {
    const now = Date.now()
    const durationMs = DURATION_MAP[duration] ?? DURATION_MAP['24h']

    // 检查是否已存在同一玩家的封禁记录（可能是另一种 playerId 格式）
    const existingKey = this.findBanKey(playerId)
    if (existingKey) {
      const existing = this.bans.get(existingKey)!
      // 更新现有记录
      existing.reason = reason
      existing.duration = duration
      existing.bannedAt = now
      existing.expiresAt = durationMs === Infinity ? null : now + durationMs
      existing.active = true
      existing.source = source ?? 'anticheat'
      existing.playerName = playerName
      // 如果新 playerId 是 UUID 格式而旧的是 npcId 格式，迁移到 UUID 格式 key
      if (existingKey !== playerId && !BanManager.isNpcIdFormat(playerId) && BanManager.isNpcIdFormat(existingKey)) {
        existing.playerId = playerId
        this.bans.delete(existingKey)
        this.bans.set(playerId, existing)
      }
      this.persistBan({ ...existing })
      return existing
    }

    const entry: BanEntry = {
      playerId,
      playerName,
      reason,
      duration,
      bannedAt: now,
      expiresAt: durationMs === Infinity ? null : now + durationMs,
      active: true,
      source: source ?? 'anticheat',
    }

    this.bans.set(playerId, entry)
    this.persistBan(entry)

    return entry
  }

  /** 将 npcId 格式 (player_XXXXXXXX) 转换为可能的 UUID 前缀 */
  private static npcIdToPrefix(npcId: string): string | null {
    const match = npcId.match(/^player_([0-9a-f]{8})$/i)
    return match ? match[1].toLowerCase() : null
  }

  /** 判断 playerId 是否为 npcId 格式 */
  private static isNpcIdFormat(playerId: string): boolean {
    return playerId.startsWith('player_')
  }

  /** 根据 playerId 查找 Map 中对应的 key（兼容 UUID 和 npcId 两种格式） */
  private findBanKey(playerId: string): string | null {
    // 1. 精确匹配
    if (this.bans.has(playerId)) return playerId

    // 2. 如果是 npcId 格式 (player_XXXXXXXX)，查找以该前缀开头的 UUID
    if (BanManager.isNpcIdFormat(playerId)) {
      const prefix = BanManager.npcIdToPrefix(playerId)
      if (prefix) {
        for (const key of this.bans.keys()) {
          if (key.toLowerCase().startsWith(prefix)) return key
        }
      }
    }

    // 3. 如果是 UUID 格式，查找对应的 npcId 格式
    const npcId = `player_${playerId.slice(0, 8)}`
    if (this.bans.has(npcId)) return npcId

    return null
  }

  /** 查找同一玩家的所有封禁 key（包括 UUID 和 npcId 格式） */
  private findAllBanKeys(playerId: string): string[] {
    const keys: string[] = []
    if (this.bans.has(playerId)) keys.push(playerId)

    const prefix = BanManager.isNpcIdFormat(playerId)
      ? BanManager.npcIdToPrefix(playerId)
      : playerId.slice(0, 8).toLowerCase()

    if (prefix) {
      for (const key of this.bans.keys()) {
        if (key !== playerId && key.toLowerCase().startsWith(prefix)) {
          keys.push(key)
        }
      }
    }

    // UUID 格式也检查对应的 npcId
    if (!BanManager.isNpcIdFormat(playerId)) {
      const npcId = `player_${playerId.slice(0, 8)}`
      if (this.bans.has(npcId) && !keys.includes(npcId)) keys.push(npcId)
    }

    return keys
  }

  unbanPlayer(playerId: string, unbanSource?: string): boolean {
    // 查找同一玩家的所有封禁记录（兼容 UUID 和 npcId 格式）
    const allKeys = this.findAllBanKeys(playerId)
    if (allKeys.length === 0) return false

    let unbanned = false
    for (const key of allKeys) {
      const entry = this.bans.get(key)
      if (!entry) continue
      entry.active = false
      entry.unbannedAt = Date.now()
      entry.unbanSource = unbanSource ?? 'admin'
      this.bans.delete(key)
      this.persistBan({ ...entry })
      unbanned = true
    }
    return unbanned
  }

  isBanned(playerId: string): boolean {
    const key = this.findBanKey(playerId)
    if (!key) return false
    const entry = this.bans.get(key)!
    if (!entry.active) return false
    if (entry.expiresAt && entry.expiresAt < Date.now()) return false
    return true
  }

  /** 检查并清理过期封禁（由定时器调用） */
  checkAndExpireBans(): number {
    let expired = 0
    for (const [playerId, entry] of this.bans) {
      if (entry.active && entry.expiresAt && entry.expiresAt < Date.now()) {
        entry.active = false
        this.bans.delete(playerId)
        this.persistBan(entry)
        expired++
      }
    }
    return expired
  }

  addWhitelist(playerId: string, playerName: string, reason?: string): void {
    const entry: WhitelistEntry = {
      playerId,
      playerName,
      addedAt: Date.now(),
      reason,
    }

    this.whitelist.set(playerId, entry)
    this.persistWhitelist(entry)
  }

  removeWhitelist(playerId: string): boolean {
    const existed = this.whitelist.has(playerId)
    if (existed) {
      this.whitelist.delete(playerId)
      // 持久化移除记录（标记 active=false 写入 JSONL）
      this.persistWhitelist({ playerId, playerName: '', addedAt: Date.now(), reason: 'removed', active: false })
    }
    return existed
  }

  isWhitelisted(playerId: string): boolean {
    return this.whitelist.has(playerId)
  }

  addRecord(record: CheatRecord): void {
    this.recordStore.append(record)
  }

  getRecords(query: RecordsQuery): CheatRecord[] {
    return this.recordStore.query(query)
  }

  getStats(onlinePlayerCount: number): ServerStats {
    const allRecords = this.recordStore.query({})
    const alertsByType: Record<CheatType, number> = {
      fly: 0,
      speed: 0,
      kill_aura: 0,
      x_ray: 0,
      scaffold: 0,
      auto_clicker: 0,
      reach: 0,
    }

    for (const record of allRecords) {
      if (record.cheatType in alertsByType) {
        alertsByType[record.cheatType as CheatType]++
      }
    }

    return {
      onlinePlayers: onlinePlayerCount,
      totalPlayers:
        allRecords.length > 0 ? new Set(allRecords.map(r => r.playerId)).size : 0,
      activeAlerts: allRecords.filter(r => Date.now() - r.timestamp < 300_000).length,
      alertsByType,
      totalBans: Array.from(this.bans.values()).filter(b => b.active).length,
      whitelistCount: this.whitelist.size,
    }
  }

  getActiveBans(): BanEntry[] {
    return Array.from(this.bans.values()).filter(b => {
      if (!b.active) return false
      if (b.expiresAt !== null && Date.now() > b.expiresAt) {
        b.active = false
        return false
      }
      return true
    })
  }

  getWhitelist(): WhitelistEntry[] {
    return Array.from(this.whitelist.values())
  }

  private loadBans(): void {
    if (!existsSync(this.bansFile)) return

    const content = readFileSync(this.bansFile, 'utf-8')
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as BanEntry
        if (entry.active) {
          if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            entry.active = false
            continue
          }
          this.bans.set(entry.playerId, entry)
        } else {
          // 解封记录：从 Map 中移除对应的封禁条目
          this.bans.delete(entry.playerId)
        }
      } catch {
        // skip malformed entries
      }
    }
  }

  private loadWhitelist(): void {
    if (!existsSync(this.whitelistFile)) return

    const content = readFileSync(this.whitelistFile, 'utf-8')
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as WhitelistEntry & { active?: boolean }
        if (entry.active === false) {
          // 移除记录：从 Map 中删除
          this.whitelist.delete(entry.playerId)
        } else {
          this.whitelist.set(entry.playerId, entry)
        }
      } catch {
        // skip malformed entries
      }
    }
  }

  private persistBan(entry: BanEntry): void {
    const dir = dirname(this.bansFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(this.bansFile, JSON.stringify(entry) + '\n', 'utf-8')
  }

  private persistWhitelist(entry: WhitelistEntry): void {
    const dir = dirname(this.whitelistFile)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(this.whitelistFile, JSON.stringify(entry) + '\n', 'utf-8')
  }
}
