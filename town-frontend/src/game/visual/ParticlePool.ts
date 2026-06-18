import * as THREE from 'three'

export interface ParticleOpts {
  position: THREE.Vector3
  velocity: THREE.Vector3
  color: THREE.Color
  size: number
  life: number
  emissive?: number
}

export class ParticlePool {
  private pool: THREE.Points
  private positions: Float32Array
  private colors: Float32Array
  private sizes: Float32Array
  private alphas: Float32Array
  private velocities: Float32Array
  private lives: Float32Array
  private maxParticles: number
  private scene: THREE.Scene

  constructor(scene: THREE.Scene, maxParticles = 512) {
    this.scene = scene
    this.maxParticles = maxParticles
    this.positions = new Float32Array(maxParticles * 3)
    this.colors = new Float32Array(maxParticles * 3)
    this.sizes = new Float32Array(maxParticles)
    this.alphas = new Float32Array(maxParticles)
    this.velocities = new Float32Array(maxParticles * 3)
    this.lives = new Float32Array(maxParticles)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1))

    // Create circle texture
    const canvas = document.createElement('canvas')
    canvas.width = 32; canvas.height = 32
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
    const texture = new THREE.CanvasTexture(canvas)

    const mat = new THREE.PointsMaterial({
      size: 0.15,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
    })

    this.pool = new THREE.Points(geo, mat)
    this.pool.frustumCulled = false
    // Initialize all particles as dead (offscreen, zero alpha)
    for (let i = 0; i < maxParticles; i++) {
      this.lives[i] = 0
      this.positions[i * 3] = 0
      this.positions[i * 3 + 1] = -100
      this.positions[i * 3 + 2] = 0
    }
    scene.add(this.pool)
  }

  emit(opts: ParticleOpts): void {
    // Find a dead particle
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.lives[i] <= 0) {
        const i3 = i * 3
        this.positions[i3] = opts.position.x
        this.positions[i3 + 1] = opts.position.y
        this.positions[i3 + 2] = opts.position.z
        this.velocities[i3] = opts.velocity.x
        this.velocities[i3 + 1] = opts.velocity.y
        this.velocities[i3 + 2] = opts.velocity.z
        this.colors[i3] = opts.color.r
        this.colors[i3 + 1] = opts.color.g
        this.colors[i3 + 2] = opts.color.b
        this.sizes[i] = opts.size
        this.lives[i] = opts.life
        this.alphas[i] = 1.0
        return
      }
    }
  }

  emitBurst(origin: THREE.Vector3, count: number, opts: Partial<ParticleOpts>): void {
    for (let i = 0; i < count; i++) {
      this.emit({
        position: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.5, (Math.random() - 0.5) * 0.5)),
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * (opts.velocity?.x ?? 2),
          (Math.random() * 0.5 + 0.5) * (opts.velocity?.y ?? 3),
          (Math.random() - 0.5) * (opts.velocity?.z ?? 2)
        ),
        color: opts.color ?? new THREE.Color(0xffd700),
        size: opts.size ?? 0.15,
        life: opts.life ?? 1.0,
      })
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.lives[i] <= 0) continue
      this.lives[i] -= dt
      if (this.lives[i] <= 0) {
        this.positions[i * 3 + 1] = -100
        continue
      }
      const i3 = i * 3
      this.positions[i3] += this.velocities[i3] * dt
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt
      // Gravity
      this.velocities[i3 + 1] -= 2.0 * dt
      // Fade
      this.alphas[i] = Math.max(0, this.lives[i])
    }
    this.pool.geometry.attributes.position.needsUpdate = true
    this.pool.geometry.attributes.color.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.pool)
    this.pool.geometry.dispose()
    ;(this.pool.material as THREE.Material).dispose()
  }
}
