import * as THREE from 'three'
import { ParticlePool } from './ParticlePool'
import { SpawnEffects } from './SpawnEffects'
import { WorkEffects } from './WorkEffects'
import { CelebrationEffects } from './CelebrationEffects'

export class VFXSystem {
  public readonly particles: ParticlePool
  public readonly spawn: SpawnEffects
  public readonly work: WorkEffects
  public readonly celebration: CelebrationEffects

  constructor(scene: THREE.Scene) {
    this.particles = new ParticlePool(scene)
    this.spawn = new SpawnEffects(scene, this.particles)
    this.work = new WorkEffects(scene, this.particles)
    this.celebration = new CelebrationEffects(scene, this.particles)
  }

  update(dt: number): void {
    this.particles.update(dt)
  }

  dispose(): void {
    this.particles.dispose()
  }
}
