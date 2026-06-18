import * as THREE from 'three'
import { ParticlePool } from './ParticlePool'

export class WorkEffects {
  private scene: THREE.Scene
  private particles: ParticlePool

  constructor(scene: THREE.Scene, particles: ParticlePool) {
    this.scene = scene
    this.particles = particles
  }

  thinkingAura(position: THREE.Vector3): void {
    // Gold ring + warm rising particles
    this.particles.emitBurst(position.clone().add(new THREE.Vector3(0, 1.5, 0)), 8, {
      velocity: new THREE.Vector3(0.5, 2, 0.5),
      color: new THREE.Color(0xffcc00),
      size: 0.1,
      life: 1.0,
    })
  }

  workingStream(position: THREE.Vector3): void {
    // Falling colorful particle stream
    this.particles.emitBurst(position.clone().add(new THREE.Vector3(0, 2, 0)), 5, {
      velocity: new THREE.Vector3(0.3, -1, 0.3),
      color: new THREE.Color(0x3b82f6),
      size: 0.08,
      life: 0.8,
    })
  }

  searchRadar(position: THREE.Vector3): void {
    // 3 cyan expanding rings
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const ringGeo = new THREE.RingGeometry(0.1, 0.3, 32)
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x00d4ff, transparent: true, opacity: 0.8,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
        })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = -Math.PI / 2
        ring.position.copy(position)
        ring.position.y += 0.1
        this.scene.add(ring)

        const start = Date.now()
        const animate = () => {
          const t = (Date.now() - start) / 1000
          if (t > 1.0) {
            this.scene.remove(ring)
            ringGeo.dispose()
            ringMat.dispose()
            return
          }
          ring.scale.setScalar(1 + t * 8)
          ringMat.opacity = 0.8 * (1 - t)
          requestAnimationFrame(animate)
        }
        animate()
      }, i * 300)
    }
  }

  connectionBeam(from: THREE.Vector3, to: THREE.Vector3): void {
    const points = [from.clone().add(new THREE.Vector3(0, 1, 0)), to.clone().add(new THREE.Vector3(0, 1, 0))]
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    const mat = new THREE.LineBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending,
    })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)

    const start = Date.now()
    const animate = () => {
      const t = (Date.now() - start) / 1000
      if (t > 1.5) {
        this.scene.remove(line)
        geo.dispose()
        mat.dispose()
        return
      }
      mat.opacity = 0.6 * (1 - t / 1.5)
      requestAnimationFrame(animate)
    }
    animate()
  }

  progressRing(position: THREE.Vector3): void {
    const ringGeo = new THREE.TorusGeometry(0.5, 0.03, 8, 32)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.copy(position)
    ring.position.y += 1.5
    this.scene.add(ring)

    const start = Date.now()
    const animate = () => {
      const t = (Date.now() - start) / 1000
      if (t > 2.0) {
        this.scene.remove(ring)
        ringGeo.dispose()
        ringMat.dispose()
        return
      }
      ring.rotation.z += 0.05
      ringMat.opacity = 0.7 * (1 - t / 2.0)
      requestAnimationFrame(animate)
    }
    animate()
  }
}
