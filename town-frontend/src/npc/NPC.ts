// NPC — PlayerNPC with agentshire-style capsule model, 7-state phase machine,
// GlowRing, DOM label, speech bubble, freeze effect, particles, Promise-based movement

import * as THREE from 'three'
import type { PlayerPhase } from '../types.js'
import { PHASE_COLORS } from '../types.js'

// ── Glow color palette ──
const GLOW_COLORS: Record<string, number> = {
  gold: 0xffd700,
  cyan: 0x3b82f6,
  yellow: 0xffcc00,
  green: 0x44ff44,
  red: 0xff4444,
  gray: 0x888888,
}

// ── Shared temp vectors for label projection ──
const _labelWorldPos = new THREE.Vector3()
const _labelNDC = new THREE.Vector3()

export class NPC {
  public readonly npcId: string
  public name: string
  public role: string
  public phase: PlayerPhase = 'normal'
  public color: number
  public isInActiveScene: boolean = true
  /** 是否处于关押状态（punishing 后被踢出服务器，NPC 保留在关押区） */
  public detained: boolean = false

  // ── Three.js hierarchy ──
  public readonly mesh: THREE.Group
  private readonly modelRoot: THREE.Group
  private bodyMesh: THREE.Mesh | null = null
  private headMesh: THREE.Mesh | null = null
  private glowRing: THREE.Mesh | null = null

  // ── DOM label ──
  private labelElement: HTMLDivElement | null = null
  private label: string
  private readonly labelYOffset = 2.0

  // ── Speech bubble ──
  private speechSprite: THREE.Sprite | null = null
  private speechCanvas: HTMLCanvasElement | null = null
  private speechTexture: THREE.CanvasTexture | null = null
  private speechTimer: number = 0
  private speechActive: boolean = false

  // ── Freeze effect ──
  private freezeMesh: THREE.Mesh | null = null
  private isFrozen: boolean = false
  /** Collision check callback — returns true if position is blocked */
  private collisionCheck: ((x: number, z: number) => boolean) | null = null
  /** Whether collision checking is active (disabled during escort) */
  private collisionEnabled: boolean = true

  // ── Particle system for confirmed phase ──
  private particleSystem: THREE.Points | null = null
  private particlePositions: Float32Array = new Float32Array(0)
  private particleVelocities: Float32Array = new Float32Array(0)
  private particleAlphas: Float32Array = new Float32Array(0)
  private particleCount: number = 0

  // ── Movement ──
  private targetPos: THREE.Vector3 | null = null
  private speed: number = 3
  private isMoving: boolean = false
  private moveResolve: ((result: 'arrived' | 'interrupted') => void) | null = null

  // ── Animation ──
  private currentAnimation: string = 'idle'
  private animationTime: number = 0
  private bobPhase: number = 0
  private mixer: THREE.AnimationMixer | null = null
  private idleAction: THREE.AnimationAction | null = null
  private walkAction: THREE.AnimationAction | null = null
  private currentAction: THREE.AnimationAction | null = null
  private useGlbModel: boolean = false

  // ── Smooth turning ──
  private desiredRotationY: number | null = null
  private readonly smoothTurnSpeed: number = 8

  // ── Ban animation ──
  private banTimer: number = 0
  private banActive: boolean = false
  private banOriginalX: number = 0

  // ── Flashing for punishing phase ──
  private flashTimer: number = 0
  private isFlashing: boolean = false

  // ── Fade out ──
  private fadeActive: boolean = false
  private fadeTimer: number = 0
  private fadeDuration: number = 1.0

  // ── Emoji ──
  private currentEmoji: string | null = null

  // ── Warning indicator ──
  private warningActive: boolean = false
  private warningTimer: number = 0
  private warningSprite: THREE.Sprite | null = null
  private warningCanvas: HTMLCanvasElement | null = null
  private warningTexture: THREE.CanvasTexture | null = null

  // ── Status indicator sprite ──
  private statusSprite: THREE.Sprite | null = null
  private statusCanvas: HTMLCanvasElement | null = null
  private statusTexture: THREE.CanvasTexture | null = null

  constructor(config: {
    id: string
    name: string
    color: number
    role: string
    label?: string
    spawn: { x: number; y: number; z: number }
    glbModel?: THREE.Group
  }) {
    this.npcId = config.id
    this.name = config.name
    this.color = config.color
    this.role = config.role
    this.label = config.label ?? config.name

    // Root group (positioned in world)
    this.mesh = new THREE.Group()
    this.mesh.userData = { npcId: this.npcId }

    // Model root (child of mesh, for local model transforms)
    this.modelRoot = new THREE.Group()
    this.mesh.add(this.modelRoot)

    // Use GLB model if provided, otherwise fallback to capsule
    if (config.glbModel) {
      this.applyGlbModel(config.glbModel)
    } else {
      this.buildFallbackModel()
    }

    // Position
    this.mesh.position.set(config.spawn.x, config.spawn.y, config.spawn.z)
  }

  // ══════════════════════════════════════════════════════════════════
  //  Model construction
  // ══════════════════════════════════════════════════════════════════

  private applyGlbModel(model: THREE.Group): void {
    this.useGlbModel = true

    // Scale model to target height
    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const targetHeight = 1.6
    const scale = maxDim > 0 ? targetHeight / maxDim : 1
    const yOffset = -box.min.y * scale

    model.scale.setScalar(scale)
    model.position.y = yOffset
    model.rotation.y = 0

    model.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    this.modelRoot.add(model)

    // Setup animation mixer
    const clips = model.animations ?? []
    if (clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model)
      for (const clip of clips) {
        const name = clip.name.toLowerCase()
        if (name.includes('walk') || name.includes('run')) {
          this.walkAction = this.mixer.clipAction(clip)
        } else if (name.includes('idle') || name.includes('stand') || name.includes('breath')) {
          this.idleAction = this.mixer.clipAction(clip)
        }
      }
      // Fallback: first clip = idle, second = walk
      if (!this.idleAction && clips.length > 0) this.idleAction = this.mixer.clipAction(clips[0])
      if (!this.walkAction && clips.length > 1) this.walkAction = this.mixer.clipAction(clips[1])

      if (this.idleAction) {
        this.idleAction.play()
        this.currentAction = this.idleAction
      }
    }
  }

  private crossFadeTo(action: THREE.AnimationAction): void {
    if (!this.mixer || action === this.currentAction) return
    if (this.currentAction) this.currentAction.fadeOut(0.3)
    action.reset().fadeIn(0.3).play()
    this.currentAction = action
  }
  private buildFallbackModel(): void {
    // Capsule body
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.8, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.color,
      roughness: 0.6,
      metalness: 0.1,
    })
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    this.bodyMesh.position.y = 0.7
    this.bodyMesh.castShadow = true
    this.modelRoot.add(this.bodyMesh)

    // Sphere head (slightly lighter than body)
    const headColor = new THREE.Color(this.color)
    headColor.lerp(new THREE.Color(0xffffff), 0.25)

    const headGeo = new THREE.SphereGeometry(0.3, 16, 16)
    const headMat = new THREE.MeshStandardMaterial({
      color: headColor,
      roughness: 0.5,
      metalness: 0.1,
    })
    this.headMesh = new THREE.Mesh(headGeo, headMat)
    this.headMesh.position.y = 1.4
    this.headMesh.castShadow = true
    this.modelRoot.add(this.headMesh)

    // Glow ring at feet
    this.createGlowRing()
  }

  private createGlowRing(): void {
    const ringGeo = new THREE.TorusGeometry(0.4, 0.05, 8, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
    this.glowRing = new THREE.Mesh(ringGeo, ringMat)
    this.glowRing.rotation.x = -Math.PI / 2
    this.glowRing.position.y = 0.02
    this.glowRing.visible = false
    this.mesh.add(this.glowRing)
  }

  // ══════════════════════════════════════════════════════════════════
  //  Phase transitions
  // ══════════════════════════════════════════════════════════════════

  transitionTo(phase: PlayerPhase): void {
    if (this.phase === phase) return

    // Reset detained when transitioning to normal or monitoring
    if (phase === 'normal' || phase === 'monitoring') {
      this.detained = false
    }

    this.phase = phase

    // 标记关押状态
    if (phase === 'punishing') {
      this.detained = true
    }

    // 关押中的 NPC 进入 offline 时，保持红色半透明视觉而非灰色
    const isDetainedOffline = this.detained && phase === 'offline'
    const effectiveColor = isDetainedOffline ? PHASE_COLORS['punishing'] : PHASE_COLORS[phase]

    // Body color tint
    if (this.bodyMesh) {
      const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
      bodyMat.color.setHex(effectiveColor)

      const shouldBeTransparent = phase === 'offline' || isDetainedOffline
      bodyMat.transparent = shouldBeTransparent
      bodyMat.opacity = isDetainedOffline ? 0.7 : phase === 'offline' ? 0.4 : 1.0
    }

    // Head color tint (lighter blend)
    if (this.headMesh) {
      const headMat = this.headMesh.material as THREE.MeshStandardMaterial
      const blended = new THREE.Color(effectiveColor)
      blended.lerp(new THREE.Color(0xffffff), 0.25)
      headMat.color.copy(blended)
      const shouldBeTransparent = phase === 'offline' || isDetainedOffline
      headMat.transparent = shouldBeTransparent
      headMat.opacity = isDetainedOffline ? 0.7 : phase === 'offline' ? 0.4 : 1.0
    }

    // GlowRing by phase
    const glowMapping: Record<PlayerPhase, string> = {
      normal: 'none',
      suspicious: 'yellow',
      investigating: 'cyan',
      confirmed: 'red',
      punishing: 'red',
      monitoring: 'green',
      offline: isDetainedOffline ? 'red' : 'none',
    }
    this.setGlow(glowMapping[phase])

    // Flashing for punishing (keep flashing for detained offline too)
    this.isFlashing = phase === 'punishing' || isDetainedOffline

    // Particles for confirmed phase
    if (phase === 'confirmed') {
      this.initParticles()
    } else {
      this.removeParticles()
    }

    // Status indicator
    this.updateStatusIndicator(phase)

    // Animation override by phase
    const animMapping: Partial<Record<PlayerPhase, string>> = {
      suspicious: 'idle',
      investigating: 'walk',
      confirmed: 'idle',
      punishing: 'idle',  // 不再自动播放 ban_animation，由押送流程控制
      monitoring: 'walk',
      offline: 'idle',
    }
    if (animMapping[phase]) {
      this.playAnimation(animMapping[phase]!)
    }
  }

  /** Set collision check callback — returns true if position is inside a building/blocked area */
  setCollisionCheck(check: (x: number, z: number) => boolean): void {
    this.collisionCheck = check
  }

  /** Enable or disable collision checking (disable during escort to allow path through buildings) */
  setCollisionEnabled(enabled: boolean): void {
    this.collisionEnabled = enabled
  }

  // ══════════════════════════════════════════════════════════════════
  //  GlowRing control
  // ══════════════════════════════════════════════════════════════════

  setGlow(color: string): void {
    if (!this.glowRing) return
    if (color === 'none') {
      this.glowRing.visible = false
      const mat = this.glowRing.material as THREE.MeshBasicMaterial
      mat.opacity = 0
      return
    }
    const hex = GLOW_COLORS[color]
    if (hex === undefined) return
    const mat = this.glowRing.material as THREE.MeshBasicMaterial
    mat.color.setHex(hex)
    mat.opacity = 0.7
    this.glowRing.visible = true
  }

  // ══════════════════════════════════════════════════════════════════
  //  Movement (Promise-based)
  // ══════════════════════════════════════════════════════════════════

  moveTo(target: { x: number; z: number }, speed?: number): Promise<'arrived' | 'interrupted'> {
    return new Promise((resolve) => {
      if (this.moveResolve) this.finishMove('interrupted')
      this.isMoving = true
      this.moveResolve = resolve
      this.speed = speed ?? 3
      this.targetPos = new THREE.Vector3(target.x, 0, target.z)
      this.transitionToAnim('walking')
    })
  }

  async walkPath(waypoints: Array<{ x: number; z: number }>, speed?: number): Promise<void> {
    for (const wp of waypoints) {
      const result = await this.moveTo(wp, speed)
      if (result === 'interrupted') break
    }
  }

  private finishMove(result: 'arrived' | 'interrupted'): void {
    if (this.moveResolve) {
      const resolve = this.moveResolve
      this.moveResolve = null
      this.isMoving = false
      this.targetPos = null
      this.transitionToAnim('idle')
      resolve(result)
    }
  }

  /** Internal animation transition (doesn't affect phase) */
  private transitionToAnim(anim: string): void {
    this.currentAnimation = anim
    this.animationTime = 0
  }

  // ══════════════════════════════════════════════════════════════════
  //  Visibility
  // ══════════════════════════════════════════════════════════════════

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }

  // ══════════════════════════════════════════════════════════════════
  //  DOM label (3D→2D projected)
  // ══════════════════════════════════════════════════════════════════

  createLabel(container: HTMLElement): void {
    const el = document.createElement('div')
    el.className = 'npc-label'
    Object.assign(el.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      willChange: 'transform',
      color: '#ffffff',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'sans-serif',
      textShadow: '0 0 4px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      userSelect: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    })
    const textSpan = document.createElement('span')
    textSpan.textContent = this.label
    el.appendChild(textSpan)
    container.appendChild(el)
    this.labelElement = el
  }

  updateLabel(camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (!this.labelElement) return
    if (!this.mesh.visible) {
      this.labelElement.style.display = 'none'
      return
    }

    this.mesh.getWorldPosition(_labelWorldPos)
    _labelWorldPos.y += this.labelYOffset
    _labelNDC.copy(_labelWorldPos).project(camera)

    if (_labelNDC.z > 1 || Math.abs(_labelNDC.x) > 1.1 || Math.abs(_labelNDC.y) > 1.1) {
      this.labelElement.style.display = 'none'
      return
    }

    const el = renderer.domElement
    const screenX = (_labelNDC.x * 0.5 + 0.5) * el.clientWidth
    const screenY = (-_labelNDC.y * 0.5 + 0.5) * el.clientHeight

    this.labelElement.style.display = ''
    this.labelElement.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -100%)`
  }

  // ══════════════════════════════════════════════════════════════════
  //  Speech bubble (Canvas Sprite)
  // ══════════════════════════════════════════════════════════════════

  showSpeechBubble(text: string): void {
    if (this.speechActive && this.speechSprite) {
      this.dismissSpeechBubble()
    }

    const lines = this.wrapText(text, 28)
    const displayLines = lines.slice(0, 3)
    if (displayLines.length < lines.length) {
      const last = displayLines[displayLines.length - 1]
      displayLines[displayLines.length - 1] = last.length > 25 ? last.substring(0, 25) + '...' : last + '...'
    }

    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 96
    this.speechCanvas = canvas

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 256, 96)

    // Background bubble
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.beginPath()
    ctx.roundRect(8, 4, 240, 72, 10)
    ctx.fill()

    // Border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(8, 4, 240, 72, 10)
    ctx.stroke()

    // Tail
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.beginPath()
    ctx.moveTo(115, 76)
    ctx.lineTo(128, 92)
    ctx.lineTo(141, 76)
    ctx.closePath()
    ctx.fill()

    // Text
    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#1a1a2e'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    for (let i = 0; i < displayLines.length; i++) {
      ctx.fillText(displayLines[i], 18, 12 + i * 20)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    this.speechTexture = texture

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.position.y = 2.4
    sprite.scale.set(3.2, 1.2, 1)
    this.speechSprite = sprite
    this.modelRoot.add(sprite)

    this.speechActive = true
    this.speechTimer = 3.0
  }

  private dismissSpeechBubble(): void {
    if (this.speechSprite) {
      this.modelRoot.remove(this.speechSprite)
      this.speechSprite.material.dispose()
      this.speechSprite = null
    }
    if (this.speechTexture) {
      this.speechTexture.dispose()
      this.speechTexture = null
    }
    if (this.speechCanvas) {
      this.speechCanvas.remove()
      this.speechCanvas = null
    }
    this.speechActive = false
    this.speechTimer = 0
  }

  private wrapText(text: string, maxChars: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''
    for (const word of words) {
      if (currentLine.length + word.length + 1 > maxChars) {
        if (currentLine) lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word
      }
    }
    if (currentLine) lines.push(currentLine)
    return lines
  }

  // ══════════════════════════════════════════════════════════════════
  //  Freeze effect
  // ══════════════════════════════════════════════════════════════════

  setFrozen(frozen: boolean): void {
    this.isFrozen = frozen
    if (frozen && !this.freezeMesh) {
      const freezeGeo = new THREE.CapsuleGeometry(0.35, 0.9, 8, 16)
      const freezeMat = new THREE.MeshBasicMaterial({
        color: 0x00bfff,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
      })
      this.freezeMesh = new THREE.Mesh(freezeGeo, freezeMat)
      this.freezeMesh.position.y = 0.7
      this.modelRoot.add(this.freezeMesh)
    } else if (!frozen && this.freezeMesh) {
      this.modelRoot.remove(this.freezeMesh)
      this.freezeMesh.geometry.dispose()
      ;(this.freezeMesh.material as THREE.Material).dispose()
      this.freezeMesh = null
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Particle system for confirmed phase
  // ══════════════════════════════════════════════════════════════════

  private initParticles(): void {
    if (this.particleSystem) return

    this.particleCount = 25
    this.particlePositions = new Float32Array(this.particleCount * 3)
    this.particleVelocities = new Float32Array(this.particleCount * 3)
    this.particleAlphas = new Float32Array(this.particleCount)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3))

    // Circle texture for particles
    const pCanvas = document.createElement('canvas')
    pCanvas.width = 16
    pCanvas.height = 16
    const pCtx = pCanvas.getContext('2d')!
    pCtx.fillStyle = '#ff3333'
    pCtx.beginPath()
    pCtx.arc(8, 8, 6, 0, Math.PI * 2)
    pCtx.fill()
    const pTexture = new THREE.CanvasTexture(pCanvas)

    const mat = new THREE.PointsMaterial({
      color: 0xff3333,
      size: 0.12,
      map: pTexture,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.particleSystem = new THREE.Points(geo, mat)
    this.modelRoot.add(this.particleSystem)

    for (let i = 0; i < this.particleCount; i++) {
      this.resetParticle(i)
    }
  }

  private resetParticle(i: number): void {
    const i3 = i * 3
    this.particlePositions[i3] = (Math.random() - 0.5) * 0.8
    this.particlePositions[i3 + 1] = Math.random() * 0.2
    this.particlePositions[i3 + 2] = (Math.random() - 0.5) * 0.8
    this.particleVelocities[i3] = (Math.random() - 0.5) * 0.1
    this.particleVelocities[i3 + 1] = 0.3 + Math.random() * 0.5
    this.particleVelocities[i3 + 2] = (Math.random() - 0.5) * 0.1
    this.particleAlphas[i] = 0.5 + Math.random() * 0.5
  }

  private removeParticles(): void {
    if (this.particleSystem) {
      this.modelRoot.remove(this.particleSystem)
      this.particleSystem.geometry.dispose()
      const mat = this.particleSystem.material as THREE.PointsMaterial
      mat.dispose()
      if (mat.map) mat.map.dispose()
      this.particleSystem = null
    }
  }

  private updateParticles(delta: number): void {
    if (!this.particleSystem) return

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3
      this.particlePositions[i3] += this.particleVelocities[i3] * delta
      this.particlePositions[i3 + 1] += this.particleVelocities[i3 + 1] * delta
      this.particlePositions[i3 + 2] += this.particleVelocities[i3 + 2] * delta
      this.particleAlphas[i] -= delta * 0.3

      if (this.particleAlphas[i] <= 0 || this.particlePositions[i3 + 1] > 2.5) {
        this.resetParticle(i)
      }
    }

    this.particleSystem.geometry.attributes.position.needsUpdate = true
  }

  // ══════════════════════════════════════════════════════════════════
  //  Status indicator (Canvas Sprite above head)
  // ══════════════════════════════════════════════════════════════════

  private updateStatusIndicator(phase: PlayerPhase): void {
    // Remove existing
    if (this.statusSprite) {
      this.modelRoot.remove(this.statusSprite)
      this.statusSprite.material.dispose()
      this.statusSprite = null
    }
    if (this.statusTexture) {
      this.statusTexture.dispose()
      this.statusTexture = null
    }
    if (this.statusCanvas) {
      this.statusCanvas.remove()
      this.statusCanvas = null
    }

    let symbol = ''
    let color = '#ffffff'
    switch (phase) {
      case 'suspicious':
        symbol = '...'
        color = '#ffcc00'
        break
      case 'investigating':
        symbol = '◎'
        color = '#3b82f6'
        break
      case 'confirmed':
        symbol = '✕'
        color = '#ff4444'
        break
      case 'monitoring':
        symbol = '✓'
        color = '#44ff44'
        break
      default:
        return // no indicator for normal/punishing/offline
    }

    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    this.statusCanvas = canvas

    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 64, 64)
    ctx.font = 'bold 36px sans-serif'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(symbol, 32, 32)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    this.statusTexture = texture

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
    this.statusSprite = new THREE.Sprite(spriteMat)
    this.statusSprite.position.y = 2.0
    this.statusSprite.scale.set(0.5, 0.5, 1)
    this.modelRoot.add(this.statusSprite)
  }

  // ══════════════════════════════════════════════════════════════════
  //  Animation playback
  // ══════════════════════════════════════════════════════════════════

  playAnimation(name: string): void {
    this.currentAnimation = name
    this.animationTime = 0
    if (name === 'ban_animation') {
      this.banActive = true
      this.banTimer = 0
      this.banOriginalX = this.mesh.position.x
    }
    if (name === 'freeze') {
      this.setFrozen(true)
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Emoji
  // ══════════════════════════════════════════════════════════════════

  setEmoji(emoji: string | null): void {
    this.currentEmoji = emoji
    // Update label text if DOM label exists
    if (this.labelElement) {
      const textSpan = this.labelElement.querySelector('span')
      if (textSpan) {
        textSpan.textContent = emoji ? `${emoji} ${this.label}` : this.label
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Warning indicator (first-offense warning badge above NPC)
  // ══════════════════════════════════════════════════════════════════

  showWarning(cheatType: string): void {
    this.warningActive = true
    this.warningTimer = 0

    if (!this.warningCanvas) {
      this.warningCanvas = document.createElement('canvas')
      this.warningCanvas.width = 128
      this.warningCanvas.height = 64
    }

    const ctx = this.warningCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 128, 64)

    // 绘制警告背景
    ctx.fillStyle = 'rgba(255, 50, 50, 0.9)'
    ctx.roundRect(4, 4, 120, 56, 8)
    ctx.fill()

    // 绘制警告文字
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('⚠ ' + cheatType.toUpperCase(), 64, 28)

    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#ffcccc'
    ctx.fillText('WARNING', 64, 48)

    if (!this.warningTexture) {
      this.warningTexture = new THREE.CanvasTexture(this.warningCanvas)
      this.warningTexture.needsUpdate = true
    } else {
      this.warningTexture.needsUpdate = true
    }

    if (!this.warningSprite) {
      const material = new THREE.SpriteMaterial({
        map: this.warningTexture,
        transparent: true,
        depthTest: false,
      })
      this.warningSprite = new THREE.Sprite(material)
      this.warningSprite.scale.set(2.0, 1.0, 1.0)
      this.mesh.add(this.warningSprite)
    }

    // 位置在 NPC 头顶上方
    this.warningSprite.position.set(0, 2.8, 0)
  }

  hideWarning(): void {
    this.warningActive = false
    if (this.warningSprite) {
      this.mesh.remove(this.warningSprite)
      this.warningSprite.material.dispose()
      this.warningSprite = null
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Look at target
  // ══════════════════════════════════════════════════════════════════

  lookAtTarget(targetNpcId: string): void {
    // Handled externally by NPCManager to set desiredRotationY
  }

  // ══════════════════════════════════════════════════════════════════
  //  Position
  // ══════════════════════════════════════════════════════════════════

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone()
  }

  // ══════════════════════════════════════════════════════════════════
  //  Fade out
  // ══════════════════════════════════════════════════════════════════

  fadeOut(duration: number = 1.0): Promise<void> {
    return new Promise((resolve) => {
      this.fadeActive = true
      this.fadeTimer = 0
      this.fadeDuration = duration
      this._fadeResolve = resolve
    })
  }

  private _fadeResolve: ((value: void) => void) | null = null

  // ══════════════════════════════════════════════════════════════════
  //  Restore visual (reset to normal phase appearance)
  // ══════════════════════════════════════════════════════════════════

  restoreVisual(): void {
    // Reset detained flag
    this.detained = false

    // Reset body/head to original color
    if (this.bodyMesh) {
      const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
      bodyMat.color.setHex(this.color)
      bodyMat.transparent = false
      bodyMat.opacity = 1.0
      bodyMat.emissive.setHex(0x000000)
      bodyMat.emissiveIntensity = 0
    }
    if (this.headMesh) {
      const headMat = this.headMesh.material as THREE.MeshStandardMaterial
      const headColor = new THREE.Color(this.color)
      headColor.lerp(new THREE.Color(0xffffff), 0.25)
      headMat.color.copy(headColor)
      headMat.transparent = false
      headMat.opacity = 1.0
    }

    // Reset glow ring
    this.setGlow('none')

    // Reset scale
    this.mesh.scale.set(1, 1, 1)
    this.modelRoot.scale.set(1, 1, 1)

    // Reset flash
    this.isFlashing = false
    this.flashTimer = 0

    // Reset ban
    this.banActive = false
    this.banTimer = 0

    // Reset fade
    this.fadeActive = false
    this.fadeTimer = 0

    // Reset freeze
    this.setFrozen(false)

    // Remove particles
    this.removeParticles()

    // Remove status indicator
    if (this.statusSprite) {
      this.modelRoot.remove(this.statusSprite)
      this.statusSprite.material.dispose()
      this.statusSprite = null
    }
    if (this.statusTexture) {
      this.statusTexture.dispose()
      this.statusTexture = null
    }
    if (this.statusCanvas) {
      this.statusCanvas.remove()
      this.statusCanvas = null
    }

    // Reset phase
    this.phase = 'normal'
  }

  // ══════════════════════════════════════════════════════════════════
  //  Main update loop
  // ══════════════════════════════════════════════════════════════════

  update(deltaTime: number): void {
    this.animationTime += deltaTime

    // ── Update GLB animation mixer ──
    if (this.mixer) {
      this.mixer.update(deltaTime)
    }

    // ── Switch walk/idle animation for GLB models ──
    if (this.useGlbModel && this.mixer) {
      if (this.isMoving && this.walkAction && this.currentAction !== this.walkAction) {
        this.crossFadeTo(this.walkAction)
      } else if (!this.isMoving && this.idleAction && this.currentAction !== this.idleAction) {
        this.crossFadeTo(this.idleAction)
      }
    }

    // ── Speech bubble timer ──
    if (this.speechActive) {
      this.speechTimer -= deltaTime
      if (this.speechTimer <= 0) {
        this.dismissSpeechBubble()
      }
    }

    // ── Movement (blocked when frozen or collision) ──
    if (this.isMoving && this.targetPos && !this.isFrozen) {
      const pos = this.mesh.position
      const dx = this.targetPos.x - pos.x
      const dz = this.targetPos.z - pos.z
      const dist = Math.sqrt(dx * dx + dz * dz)

      if (dist < 0.1) {
        pos.x = this.targetPos.x
        pos.z = this.targetPos.z
        this.finishMove('arrived')
      } else {
        const step = Math.min(this.speed * deltaTime, dist)
        const nextX = pos.x + (dx / dist) * step
        const nextZ = pos.z + (dz / dist) * step

        // Collision check: if next position is inside a building, stop and arrive
        // Skip collision check during escort (collisionEnabled = false)
        if (this.collisionEnabled && this.collisionCheck && this.collisionCheck(nextX, nextZ)) {
          // Don't move into the building — arrive at current position
          this.finishMove('arrived')
        } else {
          pos.x = nextX
          pos.z = nextZ
          // Smooth turn toward movement direction
          this.desiredRotationY = Math.atan2(dx, dz)
        }
      }
    }

    // ── Smooth turning ──
    if (this.desiredRotationY !== null) {
      let current = this.mesh.rotation.y
      let delta = this.desiredRotationY - current
      if (delta > Math.PI) delta -= Math.PI * 2
      if (delta < -Math.PI) delta += Math.PI * 2
      if (Math.abs(delta) < 0.02) {
        this.mesh.rotation.y = this.desiredRotationY
        if (!this.isMoving) this.desiredRotationY = null
      } else {
        this.mesh.rotation.y = current + delta * Math.min(1, this.smoothTurnSpeed * deltaTime)
      }
    }

    // ── Walking bob animation for fallback model ──
    if (this.bodyMesh && this.headMesh) {
      this.bobPhase += deltaTime * (this.isMoving ? 8 : 2)
      const bobAmplitude = this.isMoving ? 0.08 : 0.03
      const bobOffset = Math.sin(this.bobPhase) * bobAmplitude
      this.bodyMesh.position.y = 0.7 + bobOffset
      this.headMesh.position.y = 1.4 + bobOffset
    }

    // ── Phase-specific animation overrides ──
    // Suspicious: idle at 0.5x speed (slower bob already handled by isMoving=false)
    // Investigating: walk (isMoving handles bob)
    // Monitoring: walk at 0.5x speed
    if (this.phase === 'monitoring' && this.isMoving) {
      // Halve the bob speed for monitoring
      if (this.bodyMesh && this.headMesh) {
        this.bobPhase -= deltaTime * 4 // subtract extra to halve
        const bobAmplitude = 0.04
        const bobOffset = Math.sin(this.bobPhase) * bobAmplitude
        this.bodyMesh.position.y = 0.7 + bobOffset
        this.headMesh.position.y = 1.4 + bobOffset
      }
    }

    // ── Confirmed phase: pulse effect ──
    if (this.phase === 'confirmed' && this.modelRoot) {
      const pulse = 1 + Math.sin(this.animationTime * 4) * 0.05
      this.modelRoot.scale.set(pulse, pulse, pulse)
    }

    // ── Ban animation ──
    if (this.banActive) {
      this.banTimer += deltaTime
      const shake = Math.sin(this.banTimer * 30) * 0.15
      this.mesh.position.x = this.banOriginalX + shake

      // Red flash on body
      if (this.bodyMesh) {
        const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
        const flashPhase = Math.sin(this.banTimer * 15)
        bodyMat.emissive.setHex(flashPhase > 0 ? 0xff0000 : 0x880000)
        bodyMat.emissiveIntensity = 0.5 + flashPhase * 0.3
      }

      // Scale down after 0.5s (shrink to 0.6x, not 0)
      if (this.banTimer > 0.5) {
        const scaleProgress = Math.max(0.6, 1 - (this.banTimer - 0.5) / 1.0 * 0.4)
        this.mesh.scale.set(scaleProgress, scaleProgress, scaleProgress)
      }

      // After 1.5s: stop animation, keep visible with "封禁中" state
      if (this.banTimer > 1.5) {
        this.banActive = false
        this.mesh.scale.set(0.6, 0.6, 0.6)
        // Keep visible — model stays in "封禁中" state (red semi-transparent)
        if (this.bodyMesh) {
          const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
          bodyMat.emissive.setHex(0x000000)
          bodyMat.emissiveIntensity = 0
          bodyMat.transparent = true
          bodyMat.opacity = 0.7
        }
        if (this.headMesh) {
          const headMat = this.headMesh.material as THREE.MeshStandardMaterial
          headMat.transparent = true
          headMat.opacity = 0.7
        }
        // Show "封禁中" label
        this.setEmoji('🔒')
      }
    }

    // ── Flashing for punishing phase (when not in ban animation) ──
    if (this.isFlashing && !this.banActive) {
      this.flashTimer += deltaTime
      const flash = Math.sin(this.flashTimer * 8) > 0
      if (this.bodyMesh) {
        const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
        bodyMat.emissive.setHex(flash ? 0xff0000 : 0x000000)
        bodyMat.emissiveIntensity = flash ? 0.5 : 0
      }
    } else if (!this.banActive && this.bodyMesh) {
      const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
      bodyMat.emissive.setHex(0x000000)
      bodyMat.emissiveIntensity = 0
    }

    // ── Freeze overlay pulse ──
    if (this.freezeMesh) {
      const freezeMat = this.freezeMesh.material as THREE.MeshBasicMaterial
      freezeMat.opacity = 0.2 + Math.sin(this.animationTime * 3) * 0.08
    }

    // ── Glow ring animation ──
    if (this.glowRing && this.glowRing.visible) {
      this.glowRing.rotation.z += deltaTime * 2
      const mat = this.glowRing.material as THREE.MeshBasicMaterial
      mat.opacity = 0.5 + Math.sin(this.animationTime * 3) * 0.2
    }

    // ── Warning indicator pulse ──
    if (this.warningActive && this.warningSprite) {
      this.warningTimer += deltaTime
      const pulse = 0.8 + Math.sin(this.warningTimer * 5) * 0.2
      this.warningSprite.scale.set(2.0 * pulse, 1.0 * pulse, 1.0)
      this.warningSprite.position.y = 2.8 + Math.sin(this.warningTimer * 3) * 0.1
    }

    // ── Update particles ──
    if (this.particleSystem) {
      this.updateParticles(deltaTime)
    }

    // ── Fade out ──
    if (this.fadeActive) {
      this.fadeTimer += deltaTime
      const progress = Math.min(this.fadeTimer / this.fadeDuration, 1)
      const opacity = 1 - progress
      const scale = 1 - progress * 0.3

      this.mesh.scale.set(scale, scale, scale)

      if (this.bodyMesh) {
        const bodyMat = this.bodyMesh.material as THREE.MeshStandardMaterial
        bodyMat.transparent = true
        bodyMat.opacity = opacity
      }
      if (this.headMesh) {
        const headMat = this.headMesh.material as THREE.MeshStandardMaterial
        headMat.transparent = true
        headMat.opacity = opacity
      }

      if (progress >= 1) {
        this.fadeActive = false
        this.mesh.visible = false
        if (this._fadeResolve) {
          this._fadeResolve()
          this._fadeResolve = null
        }
      }
    }

    // ── Custom animations ──
    switch (this.currentAnimation) {
      case 'attack': {
        if (this.bodyMesh) {
          const t = this.animationTime * 6
          this.bodyMesh.rotation.z = Math.sin(t * 0.5) * 0.1
          if (this.animationTime > 1.0) {
            this.currentAnimation = 'idle'
            this.bodyMesh.rotation.z = 0
          }
        }
        break
      }
      case 'mine': {
        if (this.bodyMesh && this.headMesh) {
          const mineBob = Math.sin(this.animationTime * 10) * 0.08
          this.bodyMesh.position.y = 0.5 + mineBob
          this.headMesh.position.y = 1.2 + mineBob
          if (this.animationTime > 2.0) {
            this.currentAnimation = 'idle'
          }
        }
        break
      }
      case 'look_around': {
        if (this.headMesh) {
          const look = Math.sin(this.animationTime * 2) * 0.5
          this.headMesh.rotation.y = look
        }
        break
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  Destroy / cleanup
  // ══════════════════════════════════════════════════════════════════

  destroy(): void {
    // Finish pending move
    if (this.moveResolve) {
      this.finishMove('interrupted')
    }

    // Speech bubble
    this.dismissSpeechBubble()

    // Particles
    this.removeParticles()

    // Freeze
    if (this.freezeMesh) {
      this.freezeMesh.geometry.dispose()
      ;(this.freezeMesh.material as THREE.Material).dispose()
      this.freezeMesh = null
    }

    // Status indicator
    if (this.statusSprite) {
      this.statusSprite.material.dispose()
      this.statusSprite = null
    }
    if (this.statusTexture) {
      this.statusTexture.dispose()
      this.statusTexture = null
    }
    if (this.statusCanvas) {
      this.statusCanvas.remove()
      this.statusCanvas = null
    }

    // Glow ring
    if (this.glowRing) {
      this.glowRing.geometry.dispose()
      ;(this.glowRing.material as THREE.Material).dispose()
      this.glowRing = null
    }

    // DOM label
    if (this.labelElement) {
      this.labelElement.remove()
      this.labelElement = null
    }

    // Fade resolve
    if (this._fadeResolve) {
      this._fadeResolve()
      this._fadeResolve = null
    }

    // Traverse and dispose all meshes
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }
}
