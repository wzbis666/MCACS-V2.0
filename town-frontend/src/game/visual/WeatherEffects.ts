import * as THREE from 'three'

export type WeatherType = 'clear' | 'rain' | 'snow' | 'sandstorm' | 'fog' | 'aurora'

export class WeatherEffects {
  private scene: THREE.Scene
  private currentWeather: WeatherType = 'clear'
  private rainSystem: THREE.Points | null = null
  private snowSystem: THREE.Points | null = null
  private sandSystem: THREE.Points | null = null
  private fogMesh: THREE.Mesh | null = null
  private auroraMesh: THREE.Mesh | null = null

  private rainPositions: Float32Array = new Float32Array(0)
  private snowPositions: Float32Array = new Float32Array(0)
  private sandPositions: Float32Array = new Float32Array(0)

  private static readonly RAIN_COUNT = 8000
  private static readonly SNOW_COUNT = 4000
  private static readonly SAND_COUNT = 3000
  private static readonly AREA = 50

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  setWeather(weather: WeatherType): void {
    if (this.currentWeather === weather) return
    this.clearAll()
    this.currentWeather = weather

    switch (weather) {
      case 'rain': this.createRain(); break
      case 'snow': this.createSnow(); break
      case 'sandstorm': this.createSandstorm(); break
      case 'fog': this.createFog(); break
      case 'aurora': this.createAurora(); break
    }
  }

  private createRain(): void {
    const count = WeatherEffects.RAIN_COUNT
    this.rainPositions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * WeatherEffects.AREA
      this.rainPositions[i * 3 + 1] = Math.random() * 20
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * WeatherEffects.AREA
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0xaabbcc, size: 0.08, transparent: true, opacity: 0.6,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.rainSystem = new THREE.Points(geo, mat)
    this.rainSystem.frustumCulled = false
    this.scene.add(this.rainSystem)
  }

  private createSnow(): void {
    const count = WeatherEffects.SNOW_COUNT
    this.snowPositions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      this.snowPositions[i * 3] = (Math.random() - 0.5) * WeatherEffects.AREA
      this.snowPositions[i * 3 + 1] = Math.random() * 15
      this.snowPositions[i * 3 + 2] = (Math.random() - 0.5) * WeatherEffects.AREA
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.snowPositions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.12, transparent: true, opacity: 0.8,
      depthWrite: false,
    })
    this.snowSystem = new THREE.Points(geo, mat)
    this.snowSystem.frustumCulled = false
    this.scene.add(this.snowSystem)
  }

  private createSandstorm(): void {
    const count = WeatherEffects.SAND_COUNT
    this.sandPositions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      this.sandPositions[i * 3] = (Math.random() - 0.5) * WeatherEffects.AREA
      this.sandPositions[i * 3 + 1] = Math.random() * 8
      this.sandPositions[i * 3 + 2] = (Math.random() - 0.5) * WeatherEffects.AREA
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.sandPositions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0xd4a574, size: 0.15, transparent: true, opacity: 0.5,
      depthWrite: false,
    })
    this.sandSystem = new THREE.Points(geo, mat)
    this.sandSystem.frustumCulled = false
    this.scene.add(this.sandSystem)
  }

  private createFog(): void {
    const fogGeo = new THREE.PlaneGeometry(60, 20)
    const fogMat = new THREE.MeshBasicMaterial({
      color: 0xcccccc, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    })
    this.fogMesh = new THREE.Mesh(fogGeo, fogMat)
    this.fogMesh.position.set(20, 1, 12)
    this.fogMesh.rotation.x = -Math.PI / 2
    this.scene.add(this.fogMesh)
  }

  private createAurora(): void {
    const auroraGeo = new THREE.PlaneGeometry(40, 8, 20, 4)
    const auroraMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.15,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.auroraMesh = new THREE.Mesh(auroraGeo, auroraMat)
    this.auroraMesh.position.set(20, 15, 12)
    this.scene.add(this.auroraMesh)
  }

  private clearAll(): void {
    if (this.rainSystem) { this.scene.remove(this.rainSystem); this.rainSystem.geometry.dispose(); (this.rainSystem.material as THREE.Material).dispose(); this.rainSystem = null }
    if (this.snowSystem) { this.scene.remove(this.snowSystem); this.snowSystem.geometry.dispose(); (this.snowSystem.material as THREE.Material).dispose(); this.snowSystem = null }
    if (this.sandSystem) { this.scene.remove(this.sandSystem); this.sandSystem.geometry.dispose(); (this.sandSystem.material as THREE.Material).dispose(); this.sandSystem = null }
    if (this.fogMesh) { this.scene.remove(this.fogMesh); this.fogMesh.geometry.dispose(); (this.fogMesh.material as THREE.Material).dispose(); this.fogMesh = null }
    if (this.auroraMesh) { this.scene.remove(this.auroraMesh); this.auroraMesh.geometry.dispose(); (this.auroraMesh.material as THREE.Material).dispose(); this.auroraMesh = null }
  }

  update(dt: number): void {
    const A = WeatherEffects.AREA
    if (this.rainSystem && this.rainPositions) {
      for (let i = 0; i < WeatherEffects.RAIN_COUNT; i++) {
        const i3 = i * 3
        this.rainPositions[i3 + 1] -= 15 * dt // Fall speed
        this.rainPositions[i3] += 2 * dt // Wind
        if (this.rainPositions[i3 + 1] < 0) {
          this.rainPositions[i3] = (Math.random() - 0.5) * A
          this.rainPositions[i3 + 1] = 15 + Math.random() * 5
          this.rainPositions[i3 + 2] = (Math.random() - 0.5) * A
        }
      }
      this.rainSystem.geometry.attributes.position.needsUpdate = true
    }

    if (this.snowSystem && this.snowPositions) {
      for (let i = 0; i < WeatherEffects.SNOW_COUNT; i++) {
        const i3 = i * 3
        this.snowPositions[i3 + 1] -= 1.5 * dt
        this.snowPositions[i3] += Math.sin(Date.now() * 0.001 + i) * 0.5 * dt
        if (this.snowPositions[i3 + 1] < 0) {
          this.snowPositions[i3] = (Math.random() - 0.5) * A
          this.snowPositions[i3 + 1] = 12 + Math.random() * 3
          this.snowPositions[i3 + 2] = (Math.random() - 0.5) * A
        }
      }
      this.snowSystem.geometry.attributes.position.needsUpdate = true
    }

    if (this.sandSystem && this.sandPositions) {
      for (let i = 0; i < WeatherEffects.SAND_COUNT; i++) {
        const i3 = i * 3
        this.sandPositions[i3] += 5 * dt // Wind direction
        this.sandPositions[i3 + 1] += Math.sin(Date.now() * 0.002 + i) * 0.3 * dt
        if (this.sandPositions[i3] > A / 2) {
          this.sandPositions[i3] = -A / 2
          this.sandPositions[i3 + 1] = Math.random() * 8
          this.sandPositions[i3 + 2] = (Math.random() - 0.5) * A
        }
      }
      this.sandSystem.geometry.attributes.position.needsUpdate = true
    }

    if (this.auroraMesh) {
      this.auroraMesh.rotation.z += 0.002 * dt
      const positions = this.auroraMesh.geometry.attributes.position
      for (let i = 0; i < positions.count; i++) {
        const y = positions.getY(i)
        positions.setY(i, y + Math.sin(Date.now() * 0.001 + i * 0.3) * 0.005)
      }
      positions.needsUpdate = true
    }
  }

  getWeather(): WeatherType {
    return this.currentWeather
  }

  dispose(): void {
    this.clearAll()
  }
}
