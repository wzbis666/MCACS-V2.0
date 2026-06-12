import * as THREE from 'three'
import type { TownLightingRefs } from '../../scene/TownBuilder'

interface LightingKeyframe {
  hour: number
  ambientColor: number
  ambientIntensity: number
  directionalColor: number
  directionalIntensity: number
  skyColor: number
  fogColor: number
  fogNear: number
  fogFar: number
  streetLightIntensity: number
  windowLightIntensity: number
}

const KEYFRAMES: LightingKeyframe[] = [
  // 03:00 Deep night
  { hour: 3, ambientColor: 0x0a0a20, ambientIntensity: 0.15, directionalColor: 0x1a1a40, directionalIntensity: 0.05, skyColor: 0x0a0a20, fogColor: 0x0a0a20, fogNear: 20, fogFar: 50, streetLightIntensity: 1.0, windowLightIntensity: 0.8 },
  // 05:00 Dawn
  { hour: 5, ambientColor: 0x4a3020, ambientIntensity: 0.3, directionalColor: 0xff8844, directionalIntensity: 0.3, skyColor: 0x4a3020, fogColor: 0x4a3020, fogNear: 25, fogFar: 55, streetLightIntensity: 0.5, windowLightIntensity: 0.3 },
  // 07:00 Morning
  { hour: 7, ambientColor: 0xc8d8f0, ambientIntensity: 0.5, directionalColor: 0xfff0d0, directionalIntensity: 0.7, skyColor: 0x87ceeb, fogColor: 0x87ceeb, fogNear: 35, fogFar: 70, streetLightIntensity: 0, windowLightIntensity: 0 },
  // 10:00 Late morning
  { hour: 10, ambientColor: 0xc8d8f0, ambientIntensity: 0.6, directionalColor: 0xfff8e8, directionalIntensity: 0.9, skyColor: 0x87ceeb, fogColor: 0x87ceeb, fogNear: 40, fogFar: 80, streetLightIntensity: 0, windowLightIntensity: 0 },
  // 12:00 Noon
  { hour: 12, ambientColor: 0xd0e0f8, ambientIntensity: 0.65, directionalColor: 0xffffff, directionalIntensity: 1.0, skyColor: 0x87ceeb, fogColor: 0x87ceeb, fogNear: 40, fogFar: 80, streetLightIntensity: 0, windowLightIntensity: 0 },
  // 14:00 Afternoon
  { hour: 14, ambientColor: 0xc8d8f0, ambientIntensity: 0.6, directionalColor: 0xfff8e8, directionalIntensity: 0.95, skyColor: 0x87ceeb, fogColor: 0x87ceeb, fogNear: 40, fogFar: 80, streetLightIntensity: 0, windowLightIntensity: 0 },
  // 17:30 Golden hour
  { hour: 17.5, ambientColor: 0xd0a060, ambientIntensity: 0.5, directionalColor: 0xff9944, directionalIntensity: 0.8, skyColor: 0xd08040, fogColor: 0xd08040, fogNear: 30, fogFar: 65, streetLightIntensity: 0.2, windowLightIntensity: 0.1 },
  // 18:30 Dusk
  { hour: 18.5, ambientColor: 0x603030, ambientIntensity: 0.3, directionalColor: 0xff6633, directionalIntensity: 0.4, skyColor: 0x402040, fogColor: 0x402040, fogNear: 25, fogFar: 55, streetLightIntensity: 0.7, windowLightIntensity: 0.5 },
  // 20:00 Night
  { hour: 20, ambientColor: 0x101030, ambientIntensity: 0.2, directionalColor: 0x202040, directionalIntensity: 0.1, skyColor: 0x0a0a20, fogColor: 0x0a0a20, fogNear: 20, fogFar: 50, streetLightIntensity: 1.0, windowLightIntensity: 0.8 },
  // 24:00 Midnight
  { hour: 24, ambientColor: 0x0a0a20, ambientIntensity: 0.15, directionalColor: 0x1a1a40, directionalIntensity: 0.05, skyColor: 0x0a0a20, fogColor: 0x0a0a20, fogNear: 20, fogFar: 50, streetLightIntensity: 1.0, windowLightIntensity: 0.8 },
]

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: number, b: number, t: number): THREE.Color {
  const ca = new THREE.Color(a)
  const cb = new THREE.Color(b)
  return new THREE.Color(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t))
}

export class TimeOfDayLighting {
  private lightingRefs: TownLightingRefs | null = null
  private scene: THREE.Scene
  private gameHour: number = 12 // Start at noon
  private timeSpeed: number = 1 / 60 // 1 game hour = 60 real seconds

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  setLightingRefs(refs: TownLightingRefs): void {
    this.lightingRefs = refs
  }

  setTime(hour: number): void {
    this.gameHour = hour % 24
  }

  setSpeed(speed: number): void {
    this.timeSpeed = speed
  }

  update(dt: number): void {
    // Advance game time
    this.gameHour += dt * this.timeSpeed
    if (this.gameHour >= 24) this.gameHour -= 24

    if (!this.lightingRefs) return

    // Find surrounding keyframes
    let prev = KEYFRAMES[KEYFRAMES.length - 1]
    let next = KEYFRAMES[0]
    for (let i = 0; i < KEYFRAMES.length; i++) {
      if (KEYFRAMES[i].hour > this.gameHour) {
        next = KEYFRAMES[i]
        prev = KEYFRAMES[i - 1] ?? KEYFRAMES[KEYFRAMES.length - 1]
        break
      }
      if (i === KEYFRAMES.length - 1) {
        prev = KEYFRAMES[i]
        next = KEYFRAMES[0]
      }
    }

    const range = next.hour > prev.hour ? next.hour - prev.hour : (next.hour + 24) - prev.hour
    const progress = range > 0 ? (this.gameHour - prev.hour + (this.gameHour < prev.hour ? 24 : 0)) / range : 0
    const t = smoothstep(Math.max(0, Math.min(1, progress)))

    // Apply interpolated values
    this.lightingRefs.ambient.color.copy(lerpColor(prev.ambientColor, next.ambientColor, t))
    this.lightingRefs.ambient.intensity = lerp(prev.ambientIntensity, next.ambientIntensity, t)

    this.lightingRefs.directional.color.copy(lerpColor(prev.directionalColor, next.directionalColor, t))
    this.lightingRefs.directional.intensity = lerp(prev.directionalIntensity, next.directionalIntensity, t)

    const skyColor = lerpColor(prev.skyColor, next.skyColor, t)
    this.scene.background = skyColor
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(lerpColor(prev.fogColor, next.fogColor, t))
      this.scene.fog.near = lerp(prev.fogNear, next.fogNear, t)
      this.scene.fog.far = lerp(prev.fogFar, next.fogFar, t)
    }

    // Street lights
    const streetIntensity = lerp(prev.streetLightIntensity, next.streetLightIntensity, t)
    for (const pl of this.lightingRefs.streetLightPoints) {
      pl.intensity = streetIntensity
    }

    // Window lights
    const windowIntensity = lerp(prev.windowLightIntensity, next.windowLightIntensity, t)
    for (const pl of this.lightingRefs.windowLights) {
      pl.intensity = windowIntensity
    }
  }

  getGameHour(): number {
    return this.gameHour
  }
}
