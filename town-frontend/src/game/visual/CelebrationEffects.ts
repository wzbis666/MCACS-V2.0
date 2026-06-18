import * as THREE from 'three'
import { ParticlePool } from './ParticlePool'

export class CelebrationEffects {
  private scene: THREE.Scene
  private particles: ParticlePool

  constructor(scene: THREE.Scene, particles: ParticlePool) {
    this.scene = scene
    this.particles = particles
  }

  deployFireworks(position: THREE.Vector3): void {
    // 5 consecutive fireworks
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const burstPos = position.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          3 + Math.random() * 2,
          (Math.random() - 0.5) * 4
        ))
        const hue = Math.random()
        const color = new THREE.Color().setHSL(hue, 1, 0.6)
        this.particles.emitBurst(burstPos, 20, {
          velocity: new THREE.Vector3(4, 4, 4),
          color,
          size: 0.2,
          life: 1.5,
        })
      }, i * 600)
    }
  }

  confetti(position: THREE.Vector3): void {
    // 200 colorful confetti in 10 batches
    const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff]
    for (let batch = 0; batch < 10; batch++) {
      setTimeout(() => {
        for (let i = 0; i < 20; i++) {
          this.particles.emit({
            position: position.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 6,
              3 + Math.random() * 2,
              (Math.random() - 0.5) * 6
            )),
            velocity: new THREE.Vector3(
              (Math.random() - 0.5) * 3,
              Math.random() * 2,
              (Math.random() - 0.5) * 3
            ),
            color: new THREE.Color(colors[Math.floor(Math.random() * colors.length)]),
            size: 0.1,
            life: 2.0,
          })
        }
      }, batch * 100)
    }
  }

  lightPillar(position: THREE.Vector3): void {
    const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, 8, 8)
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.copy(position)
    pillar.position.y += 4
    this.scene.add(pillar)

    const start = Date.now()
    const animate = () => {
      const t = (Date.now() - start) / 1000
      if (t > 1.5) {
        this.scene.remove(pillar)
        pillarGeo.dispose()
        pillarMat.dispose()
        return
      }
      pillarMat.opacity = 0.5 * (1 - t / 1.5)
      requestAnimationFrame(animate)
    }
    animate()
  }
}
