import * as THREE from 'three'
import { NPC } from './NPC'
import { NpcRoaming } from './NpcRoaming'

/** NPC 间最小间距（低于此距离视为重叠） */
const NPC_MIN_DISTANCE = 0.8

export class NPCManager {
  private npcs: Map<string, NPC> = new Map()
  private roamings: Map<string, NpcRoaming> = new Map()
  private scene: THREE.Scene
  private labelContainer: HTMLElement
  private collisionCheck: ((x: number, z: number) => boolean) | null = null
  /** 建筑碰撞检查回调（单独保存，用于组合碰撞） */
  private buildingCollisionCheck: ((x: number, z: number) => boolean) | null = null

  constructor(scene: THREE.Scene, labelContainer: HTMLElement) {
    this.scene = scene
    this.labelContainer = labelContainer
  }

  /** Set collision check callback for all NPCs (checks buildings + other NPCs) */
  setCollisionCheck(check: (x: number, z: number) => boolean): void {
    this.buildingCollisionCheck = check
    // Create combined collision check: buildings + NPC proximity
    this.collisionCheck = (x: number, z: number) => {
      // Check buildings first
      if (check(x, z)) return true
      // Check NPC proximity (handled by the combined check below)
      return this.isTooCloseToOtherNpc(x, z, null)
    }
    // Apply to existing NPCs
    for (const npc of this.npcs.values()) {
      npc.setCollisionCheck(this.collisionCheck)
    }
  }

  /** Check if position (x, z) is too close to any NPC other than the excluded one */
  isTooCloseToOtherNpc(x: number, z: number, excludeNpcId: string | null): boolean {
    for (const [id, npc] of this.npcs) {
      if (id === excludeNpcId) continue
      if (!npc.mesh.visible) continue
      const pos = npc.getPosition()
      const dx = x - pos.x
      const dz = z - pos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < NPC_MIN_DISTANCE) return true
    }
    return false
  }

  /** Find a nearby position that doesn't overlap with other NPCs */
  findNonOverlappingPosition(x: number, z: number, excludeNpcId: string | null, maxAttempts: number = 8): { x: number; z: number } {
    if (!this.isTooCloseToOtherNpc(x, z, excludeNpcId)) return { x, z }

    // Try offset positions in a spiral pattern
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const angle = (attempt / maxAttempts) * Math.PI * 2
      const offsetDist = NPC_MIN_DISTANCE * (0.5 + attempt * 0.3)
      const testX = x + Math.cos(angle) * offsetDist
      const testZ = z + Math.sin(angle) * offsetDist
      if (!this.isTooCloseToOtherNpc(testX, testZ, excludeNpcId)) {
        // Also check building collision
        if (this.buildingCollisionCheck && this.buildingCollisionCheck(testX, testZ)) continue
        return { x: testX, z: testZ }
      }
    }
    // Fallback: return original position (best effort)
    return { x, z }
  }

  createNPC(config: { id: string; name: string; color: number; role: string; label?: string; spawn: { x: number; y: number; z: number }; glbModel?: THREE.Group }): NPC {
    const existing = this.npcs.get(config.id)
    if (existing) {
      this.scene.remove(existing.mesh)
      existing.destroy()
      this.npcs.delete(config.id)
      this.roamings.delete(config.id)
    }
    const npc = new NPC(config)
    this.scene.add(npc.mesh)
    npc.createLabel(this.labelContainer)
    // Inject collision check if available
    if (this.collisionCheck) {
      npc.setCollisionCheck(this.collisionCheck)
    }
    this.npcs.set(config.id, npc)

    // Start roaming (pass NPCManager reference for NPC-to-NPC collision avoidance)
    const roaming = new NpcRoaming(npc, this)
    this.roamings.set(config.id, roaming)

    return npc
  }

  get(id: string): NPC | undefined { return this.npcs.get(id) }
  getAll(): NPC[] { return Array.from(this.npcs.values()) }

  remove(id: string): void {
    const npc = this.npcs.get(id)
    if (!npc) return
    const inScene = npc.mesh.parent === this.scene
    console.log(`[NPCManager] remove: id=${id}, mesh.parent is scene=${inScene}`)
    this.scene.remove(npc.mesh)
    npc.destroy()
    this.npcs.delete(id)
    this.roamings.delete(id)
    console.log(`[NPCManager] remove complete: id=${id}`)
  }

  /** Pause roaming for a specific NPC (e.g. during escort or building entry) */
  pauseRoaming(id: string): void {
    this.roamings.get(id)?.pause()
  }

  /** Resume roaming for a specific NPC */
  resumeRoaming(id: string): void {
    this.roamings.get(id)?.resume()
  }

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer, activeScene?: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      npc.isInActiveScene = !activeScene || npc.mesh.parent === activeScene
      npc.mesh.userData.isInActiveScene = npc.isInActiveScene
      npc.update(dt)
      npc.updateLabel(camera, renderer)
    }

    // Update roaming behaviors
    for (const [id, roaming] of this.roamings) {
      const npc = this.npcs.get(id)
      if (npc && npc.mesh.visible && npc.isInActiveScene) {
        roaming.update(dt)
      }
    }
  }

  findNearestNPC(worldPos: THREE.Vector3, maxDist = 3): NPC | null {
    let best: NPC | null = null
    let bestDist = maxDist
    for (const npc of this.npcs.values()) {
      if (!npc.mesh.visible) continue
      if (!npc.isInActiveScene) continue
      const d = npc.getPosition().distanceTo(worldPos)
      if (d < bestDist) { bestDist = d; best = npc }
    }
    return best
  }

  setScene(scene: THREE.Scene): void {
    for (const npc of this.npcs.values()) {
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
    this.scene = scene
  }

  moveNpcsToScene(npcIds: string[], scene: THREE.Scene): void {
    for (const id of npcIds) {
      const npc = this.npcs.get(id)
      if (!npc) continue
      if (npc.mesh.parent) npc.mesh.parent.remove(npc.mesh)
      scene.add(npc.mesh)
    }
  }

  setAllVisible(visible: boolean): void {
    for (const npc of this.npcs.values()) npc.setVisible(visible)
  }

  destroy(): void {
    for (const npc of this.npcs.values()) {
      this.scene.remove(npc.mesh)
      npc.destroy()
    }
    this.npcs.clear()
    this.roamings.clear()
  }
}
