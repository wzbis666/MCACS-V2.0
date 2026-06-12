import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export class PostProcessing {
  private composer: EffectComposer
  private bloomPass: UnrealBloomPass
  private renderPass: RenderPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,  // strength
      0.3,  // radius
      0.85  // threshold
    )
    this.composer.addPass(this.bloomPass)
  }

  updateCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera
  }

  render(): void {
    this.composer.render()
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height)
  }

  setBloomStrength(strength: number): void {
    this.bloomPass.strength = strength
  }

  dispose(): void {
    this.composer.dispose()
  }
}
