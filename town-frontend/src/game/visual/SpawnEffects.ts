import * as THREE from 'three'
import { ParticlePool } from './ParticlePool'

export class SpawnEffects {
  private scene: THREE.Scene
  private particles: ParticlePool

  constructor(scene: THREE.Scene, particles: ParticlePool) {
    this.scene = scene
    this.particles = particles
  }

  summonShockwave(position: THREE.Vector3): void {
    // Gold light pillar
    const pillarGeo = new THREE.CylinderGeometry(0.3, 0.8, 4, 8)
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.copy(position)
    pillar.position.y += 2
    this.scene.add(pillar)

    // 30 particle burst
    this.particles.emitBurst(position, 30, {
      velocity: new THREE.Vector3(3, 5, 3),
      color: new THREE.Color(0xffd700),
      size: 0.2,
      life: 1.5,
    })

    // Animate and remove
    const start = Date.now()
    const animate = () => {
      const t = (Date.now() - start) / 1000
      if (t > 1.0) {
        this.scene.remove(pillar)
        pillar.geometry.dispose()
        pillarMat.dispose()
        return
      }
      pillarMat.opacity = 0.6 * (1 - t)
      pillar.scale.setScalar(1 + t * 2)
      requestAnimationFrame(animate)
    }
    animate()
  }

  errorLightning(position: THREE.Vector3): void {
    // Red lightning lines
    const points: THREE.Vector3[] = []
    let y = position.y + 3
    let x = position.x
    let z = position.z
    for (let i = 0; i < 8; i++) {
      points.push(new THREE.Vector3(x, y, z))
      x += (Math.random() - 0.5) * 0.5
      y -= 0.4
      z += (Math.random() - 0.5) * 0.5
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 1 })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)

    // 15 spark particles
    this.particles.emitBurst(position, 15, {
      velocity: new THREE.Vector3(4, 3, 4),
      color: new THREE.Color(0xff4444),
      size: 0.15,
      life: 0.8,
    })

    const start = Date.now()
    const animate = () => {
      const t = (Date.now() - start) / 1000
      if (t > 0.5) {
        this.scene.remove(line)
        geo.dispose()
        mat.dispose()
        return
      }
      mat.opacity = 1 - t * 2
      requestAnimationFrame(animate)
    }
    animate()
  }
}
