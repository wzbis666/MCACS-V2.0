import * as THREE from 'three'
import { NPC } from './NPC'
import { NpcRoaming } from './NpcRoaming'

export class NPCManager {
  private npcs: Map<string, NPC> = new Map()
  private roamings: Map<string, NpcRoaming> = new Map()
  private scene: THREE.Scene
  private labelContainer: HTMLElement
  private collisionCheck: ((x: number, z: number) => boolean) | null = null

  constructor(scene: THREE.Scene, labelContainer: HTMLElement) {
    this.scene = scene
    this.labelContainer = labelContainer
  }

  /** Set collision check callback for all NPCs */
  setCollisionCheck(check: (x: number, z: number) => boolean): void {
    this.collisionCheck = check
    // Apply to existing NPCs
    for (const npc of this.npcs.values()) {
      npc.setCollisionCheck(check)
    }
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

    // Start roaming
    const roaming = new NpcRoaming(npc)
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
