// TownManager — the "town manager" NPC that escorts cheating players to buildings
// A permanent NPC with GLB model + skeleton animation that patrols the plaza.

import * as THREE from 'three'
import type { AssetLoader } from '../scene/AssetLoader.js'
import type { NPCManager } from './NPCManager.js'

const DEFAULT_POSITION = { x: 18, y: 0, z: 13 }
const WALK_SPEED = 2.5
const ESCORT_SPEED = 2.0

const PATROL_WAYPOINTS = [
  { x: 18, z: 13 },
  { x: 15, z: 11 },
  { x: 21, z: 11 },
  { x: 21, z: 15 },
  { x: 15, z: 15 },
  { x: 18, z: 18 },
  { x: 18, z: 8 },
]

const IDLE_MIN_MS = 4000
const IDLE_MAX_MS = 10000

export class TownManagerNpc {
  private group: THREE.Group = new THREE.Group()
  private modelRoot: THREE.Group = new THREE.Group()
  private scene: THREE.Scene
  private npcManager: NPCManager

  // Animation
  private mixer: THREE.AnimationMixer | null = null
  private idleAction: THREE.AnimationAction | null = null
  private walkAction: THREE.AnimationAction | null = null
  private currentAction: THREE.AnimationAction | null = null

  // Patrol
  private patrolIndex = 0
  private patrolState: 'idle' | 'walking' = 'idle'
  private idleTimer = 0
  private idleDuration = 5000
  private isEscorting = false
  private walkAnimToken = 0

  // Y offset for model placement
  private yOffset = 0

  constructor(scene: THREE.Scene, npcManager: NPCManager) {
    this.scene = scene
    this.npcManager = npcManager
  }

  build(assets: AssetLoader): void {
    this.group.name = 'town_manager'
    this.modelRoot.name = 'manager_model_root'
    this.group.add(this.modelRoot)
    this.group.position.set(DEFAULT_POSITION.x, 0, DEFAULT_POSITION.z)
    this.scene.add(this.group)

    const model = assets.getCharacterModel('character-male-a')
    if (model) {
      this.applyModel(model)
    } else {
      console.warn('[TownManager] Character model not loaded, using fallback')
      this.createFallbackModel()
    }

    this.addBadge()
    this.pickNextIdleDuration()
  }

  private applyModel(model: THREE.Group): void {
    // Extract animations before adding to scene
    const clips = model.animations ?? []

    // Scale model to target height
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetHeight = 1.8
    const scale = maxDim > 0 ? targetHeight / maxDim : 1
    this.yOffset = -box.min.y * scale

    model.scale.setScalar(scale)
    model.position.y = this.yOffset
    model.rotation.y = 0

    model.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    this.modelRoot.add(model)

    // Setup animation mixer
    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model)
      this.bindAnimations(clips)

      // Start with idle
      if (this.idleAction) {
        this.idleAction.play()
        this.currentAction = this.idleAction
      } else if (clips.length > 0) {
        const fallback = this.mixer.clipAction(clips[0])
        fallback.play()
        this.currentAction = fallback
      }
    }
  }

  private bindAnimations(clips: THREE.AnimationClip[]): void {
    if (!this.mixer) return

    // Find walk and idle clips by name pattern
    for (const clip of clips) {
      const name = clip.name.toLowerCase()
      if (name.includes('walk') || name.includes('run')) {
        this.walkAction = this.mixer.clipAction(clip)
      } else if (name.includes('idle') || name.includes('stand') || name.includes('breath')) {
        this.idleAction = this.mixer.clipAction(clip)
      }
    }

    // Fallback: if no specific clips found, use first as idle, second as walk
    if (!this.idleAction && clips.length > 0) {
      this.idleAction = this.mixer.clipAction(clips[0])
    }
    if (!this.walkAction && clips.length > 1) {
      this.walkAction = this.mixer.clipAction(clips[1])
    }
  }

  private crossFadeTo(action: THREE.AnimationAction): void {
    if (!this.mixer || action === this.currentAction) return
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3)
    }
    action.reset().fadeIn(0.3).play()
    this.currentAction = action
  }

  private playIdle(): void {
    if (this.idleAction) this.crossFadeTo(this.idleAction)
  }

  private playWalk(): void {
    if (this.walkAction) this.crossFadeTo(this.walkAction)
  }

  private createFallbackModel(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.6, metalness: 0.1 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 8, 16), bodyMat)
    body.position.y = 0.7
    this.modelRoot.add(body)

    const headMat = new THREE.MeshStandardMaterial({ color: 0xf5d6a8, roughness: 0.7, metalness: 0 })
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), headMat)
    head.position.y = 1.7
    this.modelRoot.add(head)
  }

  private addBadge(): void {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.8 })
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 32), ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 2.2
    this.group.add(ring)

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 32
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.beginPath()
    ctx.roundRect(2, 2, 124, 28, 6)
    ctx.fill()
    ctx.font = 'bold 14px sans-serif'
    ctx.fillStyle = '#2ecc71'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('管理员', 64, 16)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.position.y = 2.6
    sprite.scale.set(1.2, 0.3, 1)
    this.group.add(sprite)
  }

  // ── Patrol behavior ──

  update(dt: number): void {
    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(dt)
    }

    if (this.isEscorting) return

    if (this.patrolState === 'idle') {
      this.idleTimer += dt * 1000
      if (this.idleTimer >= this.idleDuration) {
        this.startPatrolWalk()
      }
    }
  }

  private startPatrolWalk(): void {
    this.patrolIndex = (this.patrolIndex + 1) % PATROL_WAYPOINTS.length
    const wp = PATROL_WAYPOINTS[this.patrolIndex]
    const jitterX = (Math.random() - 0.5) * 1.5
    const jitterZ = (Math.random() - 0.5) * 1.5

    this.walkToPosition(wp.x + jitterX, wp.z + jitterZ, WALK_SPEED)
    this.playWalk()
    this.patrolState = 'walking'
  }

  private onPatrolArrived(): void {
    this.patrolState = 'idle'
    this.idleTimer = 0
    this.pickNextIdleDuration()
    this.playIdle()
  }

  private pickNextIdleDuration(): void {
    this.idleDuration = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS)
  }

  // ── Walk to position (replaces old requestAnimationFrame approach) ──

  private walkToPosition(x: number, z: number, speed: number): void {
    const token = ++this.walkAnimToken
    const startX = this.group.position.x
    const startZ = this.group.position.z
    const dx = x - startX
    const dz = z - startZ
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < 0.3) {
      this.onWalkStepComplete(token)
      return
    }

    // Face target
    this.group.rotation.y = Math.atan2(dx, dz)

    const duration = dist / speed
    const startTime = performance.now()

    const animate = () => {
      if (this.walkAnimToken !== token) return
      const elapsed = (performance.now() - startTime) / 1000
      const t = Math.min(elapsed / duration, 1)

      this.group.position.x = startX + dx * t
      this.group.position.z = startZ + dz * t

      if (t < 1) {
        requestAnimationFrame(animate)
      } else {
        this.onWalkStepComplete(token)
      }
    }

    requestAnimationFrame(animate)
  }

  private onWalkStepComplete(token: number): void {
    if (this.walkAnimToken !== token) return
    if (this.isEscorting) return
    this.onPatrolArrived()
  }

  // ── Escort ──

  async escortNpcToBuilding(npcId: string, doorPosition: { x: number; z: number }): Promise<void> {
    if (this.isEscorting) return
    this.isEscorting = true
    this.walkAnimToken++ // Cancel any ongoing patrol walk

    const npc = this.npcManager.get(npcId)
    if (!npc) {
      this.isEscorting = false
      this.onPatrolArrived()
      return
    }

    // Step 1: Walk to NPC
    const npcPos = npc.getPosition()
    this.playWalk()
    await this.walkToAsync(npcPos.x, npcPos.z, WALK_SPEED)

    // Step 2: Walk together to building door
    const escortPromise = npc.moveTo({ x: doorPosition.x, z: doorPosition.z }, ESCORT_SPEED)
    this.playWalk()
    await this.walkToAsync(doorPosition.x, doorPosition.z, WALK_SPEED)
    await escortPromise

    // Step 3: Return to plaza
    this.isEscorting = false
    this.playWalk()
    await this.walkToAsync(DEFAULT_POSITION.x, DEFAULT_POSITION.z, WALK_SPEED)
    this.onPatrolArrived()
  }

  async escortNpcFromBuilding(npcId: string, doorPosition: { x: number; z: number }): Promise<void> {
    if (this.isEscorting) return
    this.isEscorting = true
    this.walkAnimToken++

    const npc = this.npcManager.get(npcId)
    if (!npc) {
      this.isEscorting = false
      this.onPatrolArrived()
      return
    }

    // Walk to building door
    this.playWalk()
    await this.walkToAsync(doorPosition.x, doorPosition.z, WALK_SPEED)

    // Walk together to plaza center
    const escortPromise = npc.moveTo({ x: DEFAULT_POSITION.x, z: DEFAULT_POSITION.z }, ESCORT_SPEED)
    this.playWalk()
    await this.walkToAsync(DEFAULT_POSITION.x, DEFAULT_POSITION.z, WALK_SPEED)
    await escortPromise

    this.isEscorting = false
    this.onPatrolArrived()
  }

  /** Async version of walkTo — returns a promise that resolves when arrived */
  private walkToAsync(x: number, z: number, speed: number): Promise<void> {
    return new Promise((resolve) => {
      const startX = this.group.position.x
      const startZ = this.group.position.z
      const dx = x - startX
      const dz = z - startZ
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < 0.3) {
        resolve()
        return
      }

      this.group.rotation.y = Math.atan2(dx, dz)
      const duration = dist / speed
      const startTime = performance.now()
      const escortToken = this.walkAnimToken

      const animate = () => {
        const elapsed = (performance.now() - startTime) / 1000
        const t = Math.min(elapsed / duration, 1)

        this.group.position.x = startX + dx * t
        this.group.position.z = startZ + dz * t

        if (t < 1) {
          requestAnimationFrame(animate)
        } else {
          resolve()
        }
      }

      requestAnimationFrame(animate)
    })
  }

  getPosition(): { x: number; z: number } {
    return { x: this.group.position.x, z: this.group.position.z }
  }

  getIsEscorting(): boolean {
    return this.isEscorting
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    this.scene.remove(this.group)
  }
}
