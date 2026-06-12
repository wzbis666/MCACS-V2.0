import * as THREE from 'three'
import { AssetLoader } from './AssetLoader'

const CAR_MODELS = ['car_sedan', 'car_hatchback', 'car_taxi'] as const

const ROAD_Z_CENTER = 22.5
const LANE_OFFSET = 0.45
const LANE_RIGHT = ROAD_Z_CENTER - LANE_OFFSET
const LANE_LEFT = ROAD_Z_CENTER + LANE_OFFSET
const ROAD_Y = 0.06
const ROAD_X_MIN = 0
const ROAD_X_MAX = 40
const Z_JITTER = 0.1

interface TrafficDensity {
  startHour: number
  endHour: number
  intervalMin: number
  intervalMax: number
}

const TRAFFIC_TABLE: TrafficDensity[] = [
  { startHour: 0,  endHour: 5,  intervalMin: 25, intervalMax: 40 },
  { startHour: 5,  endHour: 7,  intervalMin: 5,  intervalMax: 9  },
  { startHour: 7,  endHour: 9,  intervalMin: 2,  intervalMax: 4  },
  { startHour: 9,  endHour: 12, intervalMin: 3,  intervalMax: 6  },
  { startHour: 12, endHour: 14, intervalMin: 2,  intervalMax: 5  },
  { startHour: 14, endHour: 17, intervalMin: 3,  intervalMax: 6  },
  { startHour: 17, endHour: 19, intervalMin: 2,  intervalMax: 4  },
  { startHour: 19, endHour: 22, intervalMin: 6,  intervalMax: 12 },
  { startHour: 22, endHour: 24, intervalMin: 15, intervalMax: 30 },
]

function getSpawnInterval(hour: number): number {
  for (const row of TRAFFIC_TABLE) {
    const inRange = row.endHour > row.startHour
      ? hour >= row.startHour && hour < row.endHour
      : hour >= row.startHour || hour < row.endHour
    if (inRange) {
      return row.intervalMin + Math.random() * (row.intervalMax - row.intervalMin)
    }
  }
  return 20
}

interface PooledVehicle {
  wrapper: THREE.Group
  active: boolean
  progress: number
  startX: number
  endX: number
  duration: number
  z: number
  headlight: THREE.PointLight
  taillightMat: THREE.MeshBasicMaterial
}

export class VehicleManager {
  private scene: THREE.Scene
  private group = new THREE.Group()
  private pool: PooledVehicle[] = []
  private templates: THREE.Group[] = []
  private yOffsets: number[] = []
  private spawnTimer = 2

  private static readonly POOL_SIZE = 6

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.group.name = 'vehicles'
    this.scene.add(this.group)
  }

  build(assets: AssetLoader): void {
    this.buildTemplates(assets)
    this.buildPool()
  }

  private buildTemplates(assets: AssetLoader): void {
    const windowMat = new THREE.MeshLambertMaterial({ color: 0x88bbdd })
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 })
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.5, 0.7)
    const cabinGeo = new THREE.BoxGeometry(0.8, 0.35, 0.6)
    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8)
    const fallbackColors = [0xcc3333, 0x3366cc, 0x44aa44]

    for (let i = 0; i < CAR_MODELS.length; i++) {
      const key = CAR_MODELS[i]
      const assetModel = assets.getPropModel(key)
      const template = new THREE.Group()
      let yOffset = 0

      if (assetModel) {
        assetModel.scale.setScalar(2.0)
        assetModel.rotation.y = Math.PI / 2
        assetModel.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })

        const box = new THREE.Box3().setFromObject(assetModel)
        yOffset = -box.min.y
        assetModel.position.y = yOffset

        template.add(assetModel)
      } else {
        const carMat = new THREE.MeshLambertMaterial({ color: fallbackColors[i] })
        const body = new THREE.Mesh(bodyGeo, carMat)
        body.position.set(0, 0.35, 0)
        body.castShadow = true
        template.add(body)

        const cabin = new THREE.Mesh(cabinGeo, windowMat)
        cabin.position.set(0, 0.72, 0)
        cabin.castShadow = true
        template.add(cabin)

        for (const ox of [-0.5, 0.5]) {
          for (const oz of [-0.3, 0.3]) {
            const wheel = new THREE.Mesh(wheelGeo, wheelMat)
            wheel.rotation.x = Math.PI / 2
            wheel.position.set(ox, 0.12, oz)
            template.add(wheel)
          }
        }
      }

      this.templates.push(template)
      this.yOffsets.push(yOffset)
    }
  }

  private buildPool(): void {
    for (let i = 0; i < VehicleManager.POOL_SIZE; i++) {
      const templateIdx = i % this.templates.length
      const wrapper = this.templates[templateIdx].clone()
      wrapper.visible = false
      this.group.add(wrapper)

      const headlight = new THREE.PointLight(0xffeeba, 0, 8)
      headlight.position.set(1.2, 0.6, 0)
      wrapper.add(headlight)

      const tailGeo = new THREE.PlaneGeometry(0.3, 0.15)
      const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0 })
      const tailMesh = new THREE.Mesh(tailGeo, taillightMat)
      tailMesh.position.set(-1.0, 0.5, 0)
      tailMesh.rotation.y = Math.PI
      wrapper.add(tailMesh)

      this.pool.push({
        wrapper,
        active: false,
        progress: 0,
        startX: 0,
        endX: 0,
        duration: 0,
        z: ROAD_Z_CENTER,
        headlight,
        taillightMat,
      })
    }
  }

  private getInactive(): PooledVehicle | null {
    return this.pool.find(v => !v.active) ?? null
  }

  private spawn(isNight: boolean): void {
    const vehicle = this.getInactive()
    if (!vehicle) return

    const goRight = Math.random() > 0.5
    vehicle.startX = goRight ? ROAD_X_MIN - 12 : ROAD_X_MAX + 12
    vehicle.endX = goRight ? ROAD_X_MAX + 12 : ROAD_X_MIN - 12
    vehicle.progress = 0
    vehicle.duration = 6 + Math.random() * 4
    const laneZ = goRight ? LANE_RIGHT : LANE_LEFT
    vehicle.z = laneZ + (Math.random() - 0.5) * Z_JITTER
    vehicle.active = true

    vehicle.wrapper.visible = true
    vehicle.wrapper.position.set(vehicle.startX, ROAD_Y, vehicle.z)
    vehicle.wrapper.rotation.y = goRight ? 0 : Math.PI

    vehicle.headlight.intensity = isNight ? 1.5 : 0
    vehicle.taillightMat.opacity = isNight ? 0.9 : 0
  }

  private recycle(vehicle: PooledVehicle): void {
    vehicle.active = false
    vehicle.wrapper.visible = false
  }

  update(gameHour: number, isNight: boolean, delta: number): void {
    const time = performance.now() / 1000

    // Spawn timer
    this.spawnTimer -= delta
    if (this.spawnTimer <= 0) {
      this.spawn(isNight)
      this.spawnTimer = getSpawnInterval(gameHour)
    }

    // Update active vehicles
    for (const v of this.pool) {
      if (!v.active) continue

      v.progress += delta / v.duration
      if (v.progress >= 1) {
        this.recycle(v)
        continue
      }

      const x = THREE.MathUtils.lerp(v.startX, v.endX, v.progress)
      const bump = Math.sin(time * 12 + v.startX) * 0.015
      v.wrapper.position.x = x
      v.wrapper.position.y = ROAD_Y + bump

      v.headlight.intensity = isNight ? 1.5 : 0
      v.taillightMat.opacity = isNight ? 0.9 : 0
    }
  }

  setNightMode(isNight: boolean): void {
    for (const v of this.pool) {
      if (!v.active) continue
      v.headlight.intensity = isNight ? 1.5 : 0
      v.taillightMat.opacity = isNight ? 0.9 : 0
    }
  }

  dispose(): void {
    this.pool = []
    this.templates = []
    this.yOffsets = []
    this.group.clear()
    this.scene.remove(this.group)
  }
}
