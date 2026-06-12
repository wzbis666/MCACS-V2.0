import type { CheatType } from '../contracts/index.js'

export class DetectionCooldown {
  private cooldowns = new Map<string, Map<CheatType, number>>()

  isOnCooldown(playerId: string, cheatType: CheatType, cooldownMs: number): boolean {
    const playerCooldowns = this.cooldowns.get(playerId)
    if (!playerCooldowns) return false

    const lastTime = playerCooldowns.get(cheatType)
    if (lastTime === undefined) return false

    return Date.now() - lastTime < cooldownMs
  }

  markDetected(playerId: string, cheatType: CheatType): void {
    let playerCooldowns = this.cooldowns.get(playerId)
    if (!playerCooldowns) {
      playerCooldowns = new Map()
      this.cooldowns.set(playerId, playerCooldowns)
    }
    playerCooldowns.set(cheatType, Date.now())
  }

  clearPlayer(playerId: string): void {
    this.cooldowns.delete(playerId)
  }

  clear(): void {
    this.cooldowns.clear()
  }
}
