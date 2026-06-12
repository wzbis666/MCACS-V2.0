// @desc IPTracker — IP 关联检测，防止小号规避封禁
//
// 追踪同一 IP 下的多个账号，共享 VP 权重。
// 当同一 IP 的多个账号被检测时，VP 增量按比例累加到所有关联账号。

import type { CheatType, Confidence } from '../contracts/index.js'

export interface IPEntry {
  ip: string
  playerIds: Set<string>
  lastSeen: Map<string, number> // playerId → lastSeen timestamp
}

export class IPTracker {
  private ipMap = new Map<string, IPEntry>()
  private playerIpMap = new Map<string, string>() // playerId → ip
  // 同一 IP 的 VP 共享权重系数（0.7 表示关联账号的 VP 增量按 70% 累加）
  private sharedWeight: number

  constructor(sharedWeight: number = 0.7) {
    this.sharedWeight = sharedWeight
  }

  /** 注册玩家 IP */
  registerPlayer(playerId: string, ip: string): void {
    // 如果玩家之前有不同 IP，先从旧 IP 移除
    const oldIp = this.playerIpMap.get(playerId)
    if (oldIp && oldIp !== ip) {
      this.removePlayerFromIp(playerId, oldIp)
    }

    this.playerIpMap.set(playerId, ip)

    let entry = this.ipMap.get(ip)
    if (!entry) {
      entry = { ip, playerIds: new Set(), lastSeen: new Map() }
      this.ipMap.set(ip, entry)
    }
    entry.playerIds.add(playerId)
    entry.lastSeen.set(playerId, Date.now())
  }

  /** 移除玩家（清理 IP 关联数据，防止内存泄漏） */
  removePlayer(playerId: string): void {
    const ip = this.playerIpMap.get(playerId)
    if (!ip) return
    const ipEntry = this.ipMap.get(ip)
    if (ipEntry) {
      ipEntry.playerIds.delete(playerId)
      if (ipEntry.playerIds.size === 0) {
        this.ipMap.delete(ip)
      }
    }
    this.playerIpMap.delete(playerId)
  }

  /** 获取同一 IP 下的其他玩家 */
  getAssociatedPlayers(playerId: string): string[] {
    const ip = this.playerIpMap.get(playerId)
    if (!ip) return []

    const entry = this.ipMap.get(ip)
    if (!entry) return []

    return Array.from(entry.playerIds).filter(id => id !== playerId)
  }

  /** 检查是否有关联账号 */
  hasAssociations(playerId: string): boolean {
    return this.getAssociatedPlayers(playerId).length > 0
  }

  /** 获取 IP 关联的 VP 共享权重（累加模式：关联账号越多，VP 增量越大） */
  getSharedVPWeight(playerId: string): number {
    const associates = this.getAssociatedPlayers(playerId)
    if (associates.length === 0) return 1.0
    // 每个关联账号增加 sharedWeight（默认 0.7）的 VP 倍率
    // 例如：1 个关联账号 → 1.7x，2 个 → 2.4x
    return 1.0 + associates.length * this.sharedWeight
  }

  /** 获取玩家 IP */
  getPlayerIP(playerId: string): string | undefined {
    return this.playerIpMap.get(playerId)
  }

  /** 获取所有 IP 条目 */
  getAllIPEntries(): IPEntry[] {
    return Array.from(this.ipMap.values())
  }

  /** 获取 IP 统计 */
  getStats(): { totalIPs: number; multiAccountIPs: number } {
    let multiAccountIPs = 0
    for (const entry of this.ipMap.values()) {
      if (entry.playerIds.size > 1) multiAccountIPs++
    }
    return { totalIPs: this.ipMap.size, multiAccountIPs }
  }

  private removePlayerFromIp(playerId: string, ip: string): void {
    const entry = this.ipMap.get(ip)
    if (entry) {
      entry.playerIds.delete(playerId)
      entry.lastSeen.delete(playerId)
      if (entry.playerIds.size === 0) {
        this.ipMap.delete(ip)
      }
    }
  }
}
