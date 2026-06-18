// TownManager — the "town manager" NPC that escorts cheating players to buildings
// A permanent NPC with GLB model + skeleton animation that patrols the plaza.

import * as THREE from 'three'
import type { AssetLoader } from '../scene/AssetLoader.js'
import type { NPCManager } from './NPCManager.js'

const DEFAULT_POSITION = { x: 18, y: 0, z: 13 }
const WALK_SPEED = 2.5
/** 跟随距离：NPC 保持在管理员后方的距离（单位：场景单位） */
const FOLLOW_DISTANCE = 1.5
/** 避障检测半径：在此范围内检测 NPC 模型 */
const AVOIDANCE_DETECT_RADIUS = 2.5
/** 避障生效距离：低于此距离开始施加绕行力 */
const AVOIDANCE_ACTIVE_RADIUS = 1.5
/** 避障绕行强度系数 */
const AVOIDANCE_STRENGTH = 3.0
/** 路径平滑插值速度（越大转向越快，越小越平滑） */
const STEER_SMOOTHING = 5.0

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

  // 押送排队：当管理员正在押送时，新的押送请求排队等待
  private escortQueue: Array<{
    npcId: string
    doorPosition: { x: number; z: number }
    resolve: () => void
  }> = []

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

    this.walkToPositionWithAvoidance(wp.x + jitterX, wp.z + jitterZ, WALK_SPEED)
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

  // ── Walk to position with NPC avoidance steering ──

  private walkToPositionWithAvoidance(x: number, z: number, speed: number): void {
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

    // Initial facing direction
    this.group.rotation.y = Math.atan2(dx, dz)
    let lastTime = performance.now()

    const animate = () => {
      if (this.walkAnimToken !== token) return

      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now

      const curX = this.group.position.x
      const curZ = this.group.position.z

      // Vector to target
      const toTargetX = x - curX
      const toTargetZ = z - curZ
      const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ)

      if (distToTarget < 0.3) {
        this.onWalkStepComplete(token)
        return
      }

      // Desired direction
      const desiredDirX = toTargetX / distToTarget
      const desiredDirZ = toTargetZ / distToTarget

      // Compute avoidance steering
      const steer = this.computeAvoidanceSteering(curX, curZ, desiredDirX, desiredDirZ)

      // Combine
      let finalDirX = desiredDirX + steer.x
      let finalDirZ = desiredDirZ + steer.z
      const finalLen = Math.sqrt(finalDirX * finalDirX + finalDirZ * finalDirZ)
      if (finalLen > 0.01) {
        finalDirX /= finalLen
        finalDirZ /= finalLen
      }

      // Smooth rotation
      const targetAngle = Math.atan2(finalDirX, finalDirZ)
      const currentAngle = this.group.rotation.y
      let angleDiff = targetAngle - currentAngle
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      const smoothFactor = Math.min(1, STEER_SMOOTHING * dt)
      this.group.rotation.y = currentAngle + angleDiff * smoothFactor

      // Move
      const moveSpeed = speed * dt
      this.group.position.x += finalDirX * moveSpeed
      this.group.position.z += finalDirZ * moveSpeed

      requestAnimationFrame(animate)
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
    // 如果正在押送，排队等待
    if (this.isEscorting) {
      await new Promise<void>((resolve) => {
        this.escortQueue.push({ npcId, doorPosition, resolve })
      })
    }

    this.isEscorting = true
    this.walkAnimToken++ // Cancel any ongoing patrol walk

    const npc = this.npcManager.get(npcId)
    if (!npc) {
      this.isEscorting = false
      this.processEscortQueue()
      this.onPatrolArrived()
      return
    }

    // Step 1: Walk to NPC's current position (stop at FOLLOW_DISTANCE away, not on top of NPC)
    const npcPos = npc.getPosition()
    const step1StartX = this.group.position.x
    const step1StartZ = this.group.position.z
    const approachDx = npcPos.x - step1StartX
    const approachDz = npcPos.z - step1StartZ
    const approachDist = Math.sqrt(approachDx * approachDx + approachDz * approachDz)

    this.playWalk()
    if (approachDist > FOLLOW_DISTANCE) {
      // Walk to a point FOLLOW_DISTANCE away from the NPC
      const dirX = approachDx / approachDist
      const dirZ = approachDz / approachDist
      const targetX = npcPos.x - dirX * FOLLOW_DISTANCE
      const targetZ = npcPos.z - dirZ * FOLLOW_DISTANCE
      await this.walkToAsync(targetX, targetZ, WALK_SPEED, npcId)
    }

    // Re-check NPC still exists after walking
    const npcStillExists = this.npcManager.get(npcId)
    if (!npcStillExists) {
      this.isEscorting = false
      this.processEscortQueue()
      this.onPatrolArrived()
      return
    }

    // Step 2: Walk together to building door
    // 管理员在前引导，NPC 在后方保持 FOLLOW_DISTANCE 距离跟随
    // 押送期间禁用 NPC 碰撞检测，允许穿过建筑到达门位置
    npc.setCollisionEnabled(false)
    this.playWalk()

    // 计算管理员到门的方向
    const adminStartX = this.group.position.x
    const adminStartZ = this.group.position.z
    const dx = doorPosition.x - adminStartX
    const dz = doorPosition.z - adminStartZ
    const totalDist = Math.sqrt(dx * dx + dz * dz)

    if (totalDist > 0.3) {
      const dirX = dx / totalDist
      const dirZ = dz / totalDist

      // NPC 最终位置 = 门位置 - 方向 * FOLLOW_DISTANCE（在管理员后方）
      const npcFinalX = doorPosition.x - dirX * FOLLOW_DISTANCE
      const npcFinalZ = doorPosition.z - dirZ * FOLLOW_DISTANCE

      // 管理员和 NPC 同时移动（排除被押送 NPC 的避障）
      const escortPromise = npc.moveTo({ x: npcFinalX, z: npcFinalZ }, WALK_SPEED)
      await this.walkToAsync(doorPosition.x, doorPosition.z, WALK_SPEED, npcId)
      await escortPromise
    }

    // 押送完成，恢复碰撞检测
    npc.setCollisionEnabled(true)

    // Step 3: Return to plaza (avoid all NPCs including the one just escorted)
    this.isEscorting = false
    this.processEscortQueue()
    this.playWalk()
    await this.walkToAsync(DEFAULT_POSITION.x, DEFAULT_POSITION.z, WALK_SPEED)
    this.onPatrolArrived()
  }

  /** 处理排队中的押送请求 */
  private processEscortQueue(): void {
    if (this.escortQueue.length === 0) return
    const next = this.escortQueue.shift()!
    // 通知排队的请求可以继续
    next.resolve()
  }

  async escortNpcFromBuilding(npcId: string, doorPosition: { x: number; z: number }): Promise<void> {
    // 如果正在押送，排队等待
    if (this.isEscorting) {
      await new Promise<void>((resolve) => {
        this.escortQueue.push({ npcId, doorPosition, resolve })
      })
    }

    this.isEscorting = true
    this.walkAnimToken++

    const npc = this.npcManager.get(npcId)
    if (!npc) {
      this.isEscorting = false
      this.processEscortQueue()
      this.onPatrolArrived()
      return
    }

    // 计算门到广场的方向（用于确定"前方"和"后方"）
    const toPlazaDx = DEFAULT_POSITION.x - doorPosition.x
    const toPlazaDz = DEFAULT_POSITION.z - doorPosition.z
    const toPlazaDist = Math.sqrt(toPlazaDx * toPlazaDx + toPlazaDz * toPlazaDz)
    const dirToPlazaX = toPlazaDist > 0.01 ? toPlazaDx / toPlazaDist : 0
    const dirToPlazaZ = toPlazaDist > 0.01 ? toPlazaDz / toPlazaDist : 1

    // Step 1: 管理员走到门位置附近（门位置 + 朝广场方向偏移 FOLLOW_DISTANCE）
    // 这样管理员站在门的前方（朝广场方向），NPC在门位置，两者不重叠
    const adminDoorX = doorPosition.x + dirToPlazaX * FOLLOW_DISTANCE
    const adminDoorZ = doorPosition.z + dirToPlazaZ * FOLLOW_DISTANCE
    this.playWalk()
    await this.walkToAsync(adminDoorX, adminDoorZ, WALK_SPEED, npcId)

    // Step 2: 管理员在前引导，NPC 在后方保持 FOLLOW_DISTANCE 距离跟随
    npc.setCollisionEnabled(false)
    this.playWalk()

    const adminStartX = this.group.position.x
    const adminStartZ = this.group.position.z
    const dx = DEFAULT_POSITION.x - adminStartX
    const dz = DEFAULT_POSITION.z - adminStartZ
    const totalDist = Math.sqrt(dx * dx + dz * dz)

    if (totalDist > 0.3) {
      const dirX = dx / totalDist
      const dirZ = dz / totalDist

      // NPC 最终位置 = 广场中心 - 方向 * FOLLOW_DISTANCE（在管理员后方）
      const npcFinalX = DEFAULT_POSITION.x - dirX * FOLLOW_DISTANCE
      const npcFinalZ = DEFAULT_POSITION.z - dirZ * FOLLOW_DISTANCE

      const escortPromise = npc.moveTo({ x: npcFinalX, z: npcFinalZ }, WALK_SPEED)
      await this.walkToAsync(DEFAULT_POSITION.x, DEFAULT_POSITION.z, WALK_SPEED, npcId)
      await escortPromise
    }

    npc.setCollisionEnabled(true)

    this.isEscorting = false
    this.processEscortQueue()
    this.onPatrolArrived()
  }

  /** Async version of walkTo with NPC avoidance steering */
  private walkToAsync(x: number, z: number, speed: number, excludeNpcId?: string): Promise<void> {
    return new Promise((resolve) => {
      const startX = this.group.position.x
      const startZ = this.group.position.z
      const dx = x - startX
      const dz = z - startZ
      const totalDist = Math.sqrt(dx * dx + dz * dz)

      if (totalDist < 0.3) {
        resolve()
        return
      }

      // Initial facing direction
      this.group.rotation.y = Math.atan2(dx, dz)
      const escortToken = this.walkAnimToken
      let lastTime = performance.now()

      const animate = () => {
        if (this.walkAnimToken !== escortToken) return

        const now = performance.now()
        const dt = Math.min((now - lastTime) / 1000, 0.1) // cap delta to avoid jumps
        lastTime = now

        // Current position
        const curX = this.group.position.x
        const curZ = this.group.position.z

        // Vector to target
        const toTargetX = x - curX
        const toTargetZ = z - curZ
        const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ)

        // Arrived
        if (distToTarget < 0.3) {
          resolve()
          return
        }

        // Desired direction: toward target
        const desiredDirX = toTargetX / distToTarget
        const desiredDirZ = toTargetZ / distToTarget

        // Compute avoidance steering from nearby NPCs
        const steer = this.computeAvoidanceSteering(curX, curZ, desiredDirX, desiredDirZ, excludeNpcId)

        // Combine desired direction with avoidance steering
        let finalDirX = desiredDirX + steer.x
        let finalDirZ = desiredDirZ + steer.z
        const finalLen = Math.sqrt(finalDirX * finalDirX + finalDirZ * finalDirZ)
        if (finalLen > 0.01) {
          finalDirX /= finalLen
          finalDirZ /= finalLen
        }

        // Smooth rotation: interpolate current facing toward final direction
        const targetAngle = Math.atan2(finalDirX, finalDirZ)
        const currentAngle = this.group.rotation.y
        // Shortest angle difference
        let angleDiff = targetAngle - currentAngle
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
        const smoothFactor = Math.min(1, STEER_SMOOTHING * dt)
        this.group.rotation.y = currentAngle + angleDiff * smoothFactor

        // Move in the smoothed facing direction
        const moveSpeed = speed * dt
        this.group.position.x += finalDirX * moveSpeed
        this.group.position.z += finalDirZ * moveSpeed

        // Check if we've effectively reached the target
        const newDistToTarget = Math.sqrt(
          (x - this.group.position.x) ** 2 + (z - this.group.position.z) ** 2
        )
        if (newDistToTarget < 0.3) {
          resolve()
          return
        }

        requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
    })
  }

  /** Compute avoidance steering vector from nearby NPC models */
  private computeAvoidanceSteering(
    posX: number, posZ: number,
    dirX: number, dirZ: number,
    excludeNpcId?: string
  ): { x: number; z: number } {
    let steerX = 0
    let steerZ = 0

    // Check all NPCs in detection range
    for (const [id, npc] of this.npcManager.getAll().map(n => [n.npcId, n] as const)) {
      if (id === excludeNpcId) continue
      if (!npc.mesh.visible) continue

      const npcPos = npc.getPosition()
      const dx = posX - npcPos.x
      const dz = posZ - npcPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist >= AVOIDANCE_DETECT_RADIUS || dist < 0.01) continue

      // Compute avoidance force: stronger when closer
      const avoidanceFactor = Math.max(0, 1 - dist / AVOIDANCE_DETECT_RADIUS)
      const strength = avoidanceFactor * avoidanceFactor * AVOIDANCE_STRENGTH

      // Direction away from NPC
      const awayX = dx / dist
      const awayZ = dz / dist

      // Perpendicular component: choose the side that aligns better with current movement direction
      // This creates a smooth "go around" behavior instead of just pushing away
      const perp1X = -awayZ
      const perp1Z = awayX
      const perp2X = awayZ
      const perp2Z = -awayX

      // Choose the perpendicular direction that aligns with our desired direction
      const dot1 = perp1X * dirX + perp1Z * dirZ
      const dot2 = perp2X * dirX + perp2Z * dirZ
      const perpX = dot1 >= dot2 ? perp1X : perp2X
      const perpZ = dot1 >= dot2 ? perp1Z : perp2Z

      // Blend: push away + go around
      // When very close, push away more; when farther, go around more
      const pushRatio = dist < AVOIDANCE_ACTIVE_RADIUS ? 0.6 : 0.2
      const aroundRatio = 1 - pushRatio

      steerX += (awayX * pushRatio + perpX * aroundRatio) * strength
      steerZ += (awayZ * pushRatio + perpZ * aroundRatio) * strength
    }

    return { x: steerX, z: steerZ }
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
