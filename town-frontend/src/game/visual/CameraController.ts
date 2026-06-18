import * as THREE from 'three'

// ── Patrol states ──
interface PatrolState {
  target: THREE.Vector3
  radius: number
  theta: number
  phi: number
}

const PATROL_STATES: PatrolState[] = [
  { target: new THREE.Vector3(20, 0, 12), radius: 24, theta: Math.PI / 4, phi: Math.PI / 3 },
  { target: new THREE.Vector3(10, 0, 8),  radius: 20, theta: Math.PI / 3, phi: Math.PI / 3.5 },
  { target: new THREE.Vector3(30, 0, 8),  radius: 20, theta: -Math.PI / 6, phi: Math.PI / 3.5 },
  { target: new THREE.Vector3(20, 0, 20), radius: 22, theta: Math.PI / 5, phi: Math.PI / 4 },
  { target: new THREE.Vector3(15, 0, 16), radius: 18, theta: Math.PI / 2.5, phi: Math.PI / 3 },
  { target: new THREE.Vector3(25, 0, 16), radius: 18, theta: -Math.PI / 8, phi: Math.PI / 3 },
  { target: new THREE.Vector3(20, 0, 10), radius: 28, theta: Math.PI / 6, phi: Math.PI / 4.5 },
]

const DEFAULT_TARGET = new THREE.Vector3(20, 0, 12)
const DEFAULT_RADIUS = 24
const DEFAULT_THETA = Math.PI / 4
const DEFAULT_PHI = Math.PI / 3

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Simple orbit camera controller.
 *
 * ── Mouse ──
 *   MMB drag          → Orbit (rotate around target)
 *   Shift + MMB drag  → Pan (move target)
 *   Wheel             → Zoom (toward cursor)
 *
 * ── Touch ──
 *   1-finger drag     → Orbit
 *   2-finger pinch    → Zoom + Pan
 */
export class CameraController {
  private perspCamera: THREE.PerspectiveCamera
  private orthoCamera: THREE.OrthographicCamera
  private domElement: HTMLElement

  // ── Spherical coordinates ──
  private target = DEFAULT_TARGET.clone()
  private radius = DEFAULT_RADIUS
  private theta = DEFAULT_THETA   // azimuth (horizontal, around Y)
  private phi = DEFAULT_PHI       // polar (vertical, from Y-axis down)

  private minRadius = 3
  private maxRadius = 80
  private minPhi = 0.05
  private maxPhi = Math.PI / 2 - 0.02

  // ── Smoothing ──
  private lerpSpeed = 0.1
  private smoothTarget = DEFAULT_TARGET.clone()
  private smoothRadius = DEFAULT_RADIUS
  private smoothTheta = DEFAULT_THETA
  private smoothPhi = DEFAULT_PHI

  // ── Interaction state ──
  private mode: 'none' | 'orbit' | 'pan' = 'none'
  private lastMouse = new THREE.Vector2()
  private rotateSpeed = 0.005
  private panSpeed = 0.0012

  // ── Projection ──
  private isOrthographic = false

  // ── Follow ──
  private followTarget: THREE.Object3D | null = null
  private isFollowing = false

  // ── Auto patrol ──
  private idleTimer = 0
  private idleThreshold = 5
  private patrolIndex = 0
  private isPatrolling = false

  // ── Animate to ──
  private animatingTo: { target: THREE.Vector3; radius: number; theta: number; phi: number; startTime: number; duration: number } | null = null

  // ── Focus target ──
  private focusTarget: THREE.Object3D | null = null

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.perspCamera = camera
    this.perspCamera.fov = 42
    this.perspCamera.updateProjectionMatrix()
    this.domElement = domElement

    const aspect = domElement.clientWidth / domElement.clientHeight
    const fs = 30
    this.orthoCamera = new THREE.OrthographicCamera(-fs * aspect / 2, fs * aspect / 2, fs / 2, -fs / 2, 0.1, 200)

    this.applyCameraPosition(true)

    // Mouse
    domElement.addEventListener('mousedown', this.onMouseDown)
    domElement.addEventListener('mousemove', this.onMouseMove)
    domElement.addEventListener('mouseup', this.onMouseUp)
    domElement.addEventListener('wheel', this.onWheel, { passive: false })
    domElement.addEventListener('contextmenu', (e) => e.preventDefault())

    // Touch
    domElement.addEventListener('touchstart', this.onTouchStart)
    domElement.addEventListener('touchmove', this.onTouchMove)
    domElement.addEventListener('touchend', this.onTouchEnd)
  }

  // ── Spherical ↔ Cartesian ──

  private sphericalToCartesian(r: number, theta: number, phi: number): THREE.Vector3 {
    return new THREE.Vector3(
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.cos(theta),
    )
  }

  private applyCameraPosition(immediate = false): void {
    const offset = this.sphericalToCartesian(this.smoothRadius, this.smoothTheta, this.smoothPhi)
    const desiredPos = this.smoothTarget.clone().add(offset)

    const cam = this.activeCamera()
    if (immediate) {
      cam.position.copy(desiredPos)
    } else {
      cam.position.lerp(desiredPos, this.lerpSpeed)
    }
    cam.lookAt(this.smoothTarget)

    // Sync both cameras
    if (!this.isOrthographic) {
      this.orthoCamera.position.copy(this.perspCamera.position)
      this.orthoCamera.quaternion.copy(this.perspCamera.quaternion)
    } else {
      this.perspCamera.position.copy(this.orthoCamera.position)
      this.perspCamera.quaternion.copy(this.orthoCamera.quaternion)
    }
  }

  private activeCamera(): THREE.Camera {
    return this.isOrthographic ? this.orthoCamera : this.perspCamera
  }

  // ── Mouse Events ──

  private onMouseDown = (e: MouseEvent): void => {
    // MMB
    if (e.button === 1) {
      e.preventDefault()
      if (e.shiftKey) {
        this.mode = 'pan'
      } else {
        this.mode = 'orbit'
      }
      this.lastMouse.set(e.clientX, e.clientY)
      this.resetIdle()
      return
    }

    // Right button → Orbit (convenience)
    if (e.button === 2 && !e.shiftKey) {
      this.mode = 'orbit'
      this.lastMouse.set(e.clientX, e.clientY)
      this.resetIdle()
      return
    }

    // Shift+Right → Pan (convenience)
    if (e.button === 2 && e.shiftKey) {
      this.mode = 'pan'
      this.lastMouse.set(e.clientX, e.clientY)
      this.resetIdle()
      return
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (this.mode === 'none') return

    const dx = e.clientX - this.lastMouse.x
    const dy = e.clientY - this.lastMouse.y
    this.lastMouse.set(e.clientX, e.clientY)

    switch (this.mode) {
      case 'orbit':
        this.theta -= dx * this.rotateSpeed
        this.phi = clamp(this.phi + dy * this.rotateSpeed, this.minPhi, this.maxPhi)
        break
      case 'pan':
        this.panCamera(dx, dy)
        break
    }

    this.resetIdle()
  }

  private onMouseUp = (): void => {
    this.mode = 'none'
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()

    // Zoom toward cursor
    const rect = this.domElement.getBoundingClientRect()
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const factor = e.deltaY > 0 ? 1.08 : 0.92
    const newRadius = clamp(this.radius * factor, this.minRadius, this.maxRadius)
    const actualFactor = newRadius / this.radius

    const cam = this.activeCamera()
    cam.updateMatrixWorld()
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam)
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(groundPlane, hit)

    if (hit) {
      const blend = 1 - actualFactor
      this.target.lerp(new THREE.Vector3(hit.x, 0, hit.z), blend * 0.5)
      this.target.y = 0
    }

    this.radius = newRadius
    this.resetIdle()
  }

  // ── Pan in camera screen-space ──

  private panCamera(dx: number, dy: number): void {
    const cam = this.activeCamera()
    cam.updateMatrixWorld()

    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)

    const scale = this.radius * this.panSpeed

    this.target.addScaledVector(right, -dx * scale)
    this.target.addScaledVector(up, dy * scale)
    this.target.y = 0
  }

  // ── Touch Events ──

  private lastTouchDist = 0
  private lastTouchCenter = new THREE.Vector2()
  private touchMode: 'none' | 'orbit' | 'pinch' = 'none'

  private onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) {
      this.touchMode = 'orbit'
      this.lastMouse.set(e.touches[0].clientX, e.touches[0].clientY)
    } else if (e.touches.length === 2) {
      this.touchMode = 'pinch'
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      this.lastTouchDist = Math.sqrt(dx * dx + dy * dy)
      this.lastTouchCenter.set(
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2,
      )
    }
    this.resetIdle()
  }

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchMode === 'orbit' && e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.lastMouse.x
      const dy = e.touches[0].clientY - this.lastMouse.y
      this.theta -= dx * this.rotateSpeed
      this.phi = clamp(this.phi + dy * this.rotateSpeed, this.minPhi, this.maxPhi)
      this.lastMouse.set(e.touches[0].clientX, e.touches[0].clientY)
    } else if (this.touchMode === 'pinch' && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (this.lastTouchDist > 0) {
        const scale = this.lastTouchDist / dist
        this.radius *= scale
        this.radius = clamp(this.radius, this.minRadius, this.maxRadius)
      }
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
      this.panCamera(cx - this.lastTouchCenter.x, cy - this.lastTouchCenter.y)
      this.lastTouchCenter.set(cx, cy)
      this.lastTouchDist = dist
    }
    this.resetIdle()
  }

  private onTouchEnd = (): void => {
    this.touchMode = 'none'
    this.lastTouchDist = 0
  }

  // ── Projection Toggle ──

  toggleProjection(): void {
    this.isOrthographic = !this.isOrthographic
    if (this.isOrthographic) {
      this.orthoCamera.position.copy(this.perspCamera.position)
      this.orthoCamera.quaternion.copy(this.perspCamera.quaternion)
    }
  }

  // ── Animate To ──

  private animateToSpherical(target: THREE.Vector3, radius: number, theta: number, phi: number, duration = 800): void {
    this.animatingTo = { target, radius, theta, phi, startTime: Date.now(), duration }
    this.isPatrolling = false
    this.resetIdle()
  }

  animateTo(target: THREE.Vector3, _offset?: THREE.Vector3, duration = 800): void {
    this.animateToSpherical(target.clone(), this.radius, this.theta, this.phi, duration)
  }

  // ── Follow ──

  follow(target: THREE.Object3D): void {
    this.followTarget = target
    this.isFollowing = true
    this.isPatrolling = false
    this.resetIdle()
  }

  stopFollowing(): void {
    this.followTarget = null
    this.isFollowing = false
  }

  setFocusTarget(target: THREE.Object3D | null): void {
    this.focusTarget = target
  }

  // ── Auto Patrol ──

  private resetIdle(): void {
    this.idleTimer = 0
    this.isPatrolling = false
  }

  private updatePatrol(_dt: number): void {
    // Auto patrol disabled — camera stays still when idle
  }

  // ── Update ──

  update(dt: number): void {
    // Follow target
    if (this.isFollowing && this.followTarget) {
      const pos = this.followTarget.position
      this.target.lerp(new THREE.Vector3(pos.x, 0, pos.z), 0.05)
    }

    // Animate to position
    if (this.animatingTo) {
      const elapsed = Date.now() - this.animatingTo.startTime
      const t = Math.min(1, elapsed / this.animatingTo.duration)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

      this.target.lerp(this.animatingTo.target, ease * 0.15)
      this.radius += (this.animatingTo.radius - this.radius) * ease * 0.15
      this.theta += (this.animatingTo.theta - this.theta) * ease * 0.15
      this.phi += (this.animatingTo.phi - this.phi) * ease * 0.15

      if (t >= 1) this.animatingTo = null
    }

    // Auto patrol
    this.updatePatrol(dt)

    // Smooth interpolation
    this.smoothTarget.lerp(this.target, this.lerpSpeed)
    this.smoothRadius += (this.radius - this.smoothRadius) * this.lerpSpeed
    this.smoothTheta += (this.theta - this.smoothTheta) * this.lerpSpeed
    this.smoothPhi += (this.phi - this.smoothPhi) * this.lerpSpeed

    this.applyCameraPosition()
  }

  getCamera(): THREE.Camera {
    return this.activeCamera()
  }

  resize(width: number, height: number): void {
    const aspect = width / height
    this.perspCamera.aspect = aspect
    this.perspCamera.updateProjectionMatrix()

    const fs = 30
    this.orthoCamera.left = -fs * aspect / 2
    this.orthoCamera.right = fs * aspect / 2
    this.orthoCamera.top = fs / 2
    this.orthoCamera.bottom = -fs / 2
    this.orthoCamera.updateProjectionMatrix()
  }

  dispose(): void {
    this.domElement.removeEventListener('mousedown', this.onMouseDown)
    this.domElement.removeEventListener('mousemove', this.onMouseMove)
    this.domElement.removeEventListener('mouseup', this.onMouseUp)
    this.domElement.removeEventListener('wheel', this.onWheel)
    this.domElement.removeEventListener('touchstart', this.onTouchStart)
    this.domElement.removeEventListener('touchmove', this.onTouchMove)
    this.domElement.removeEventListener('touchend', this.onTouchEnd)
  }
}
