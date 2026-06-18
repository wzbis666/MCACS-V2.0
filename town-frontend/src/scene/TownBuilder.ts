// TownBuilder — agentshire-style 3D town scene for anti-cheat monitoring
// 7 buildings mapped to 7 cheat types, GLTF models with procedural fallback

import * as THREE from 'three'
import { AssetLoader } from './AssetLoader'

/* ───────── Building Definitions ───────── */

interface BuildingDef {
  id: string
  name: string
  cheatType: string
  modelKey: string
  pos: [number, number, number]
  scale: number
  rotationY: number
  doorOffset: [number, number, number]
  size: [number, number, number]
  color: number
  roofColor: number
}

const BUILDINGS: BuildingDef[] = [
  { id: 'fly_lab',      name: '飞行关押区', cheatType: 'fly',          modelKey: 'building_A', pos: [3, 0, 4],  scale: 3.0, rotationY: 0, doorOffset: [0, 0.05, 14], size: [8, 12, 6], color: 0x6688aa, roofColor: 0x446688 },
  { id: 'speed_lab',    name: '速度关押区', cheatType: 'speed',        modelKey: 'building_B', pos: [3, 0, 10], scale: 1.8, rotationY: 0, doorOffset: [0, 0.05, 14], size: [3, 4, 3],  color: 0xf5f0e8, roofColor: 0x44aa44 },
  { id: 'combat_lab',   name: '战斗关押区', cheatType: 'kill_aura',    modelKey: 'building_C', pos: [3, 0, 16], scale: 1.8, rotationY: 0, doorOffset: [0, 0.05, 20], size: [3, 4, 3],  color: 0xf5f0e8, roofColor: 0x4488cc },
  { id: 'xray_lab',     name: '透视关押区', cheatType: 'x_ray',       modelKey: 'building_D', pos: [32, 0, 4], scale: 1.8, rotationY: 0, doorOffset: [0, 0.05, 8],  size: [3, 4, 3],  color: 0xf5f0e8, roofColor: 0xcc8844 },
  { id: 'scaffold_lab', name: '搭桥关押区', cheatType: 'scaffold',     modelKey: 'building_E', pos: [32, 0, 10], scale: 2.5, rotationY: 0, doorOffset: [0, 0.05, 17], size: [8, 4, 5],  color: 0xf0f0f0, roofColor: 0x888888 },
  { id: 'autoclick_lab',name: '点击关押区', cheatType: 'auto_clicker', modelKey: 'building_F', pos: [32, 0, 16], scale: 2.0, rotationY: 0, doorOffset: [0, 0.05, 21], size: [5, 3, 4],  color: 0xd4a574, roofColor: 0xaa7744 },
  { id: 'reach_lab',    name: '距离关押区', cheatType: 'reach',        modelKey: 'building_G', pos: [17.5, 0, 4], scale: 1.8, rotationY: 0, doorOffset: [0, 0.05, 8],  size: [3, 4, 3],  color: 0xf5f0e8, roofColor: 0xddaa44 },
]

/* ───────── Colors ───────── */

const GRASS_COLOR    = 0x7ec850
const SIDEWALK_COLOR = 0xc4b8a8
const PLAZA_COLOR    = 0xe8dcc8
const ROAD_COLOR     = 0x505050
const SKY_COLOR      = 0x87ceeb

/* ───────── Lighting Refs ───────── */

export interface TownLightingRefs {
  ambient: THREE.AmbientLight
  directional: THREE.DirectionalLight
  hemisphere: THREE.HemisphereLight
  streetLightPoints: THREE.PointLight[]
  windowLights: THREE.PointLight[]
}

/* ───────── TownBuilder ───────── */

export class TownBuilder {
  private scene: THREE.Scene
  private doorMarkers: Map<string, THREE.Mesh> = new Map()
  private buildingMeshes: Map<string, THREE.Mesh> = new Map()
  private townGroup = new THREE.Group()
  private lightingRefs: TownLightingRefs | null = null
  private screenAnimTime: number = 0
  private onBuildingClick: ((buildingId: string) => void) | null = null

  // Detention state
  private detainedPlayers: Map<string, string[]> = new Map() // buildingId -> player names
  private warningLights: Map<string, THREE.PointLight> = new Map()
  private warningLightMeshes: Map<string, THREE.Mesh> = new Map()
  private detentionBadges: Map<string, THREE.Sprite> = new Map()

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /* ───── Public API ───── */

  build(assets: AssetLoader): void {
    this.townGroup.name = 'town'
    this.scene.add(this.townGroup)

    this.buildSkyAndFog()
    this.buildLighting()
    this.buildGround()
    this.buildBuildings(assets)
    this.buildStreetLights(assets)
    this.buildTrees(assets)
    this.buildBenches(assets)
    this.buildFountain(assets)
    this.buildFlowerBeds()
    this.buildFireHydrants(assets)
  }

  getDoorMarker(buildingId: string): THREE.Mesh | undefined {
    return this.doorMarkers.get(buildingId)
  }

  getDoorMarkers(): Map<string, THREE.Mesh> {
    return this.doorMarkers
  }

  getLightingRefs(): TownLightingRefs | null {
    return this.lightingRefs
  }

  clear(): void {
    this.townGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat.dispose()
      }
    })
    this.scene.remove(this.townGroup)
    this.townGroup = new THREE.Group()
    this.doorMarkers.clear()
    this.buildingMeshes.clear()
  }

  update(delta: number): void {
    this.screenAnimTime += delta

    // Flash warning lights for buildings with detained players
    const flashIntensity = (Math.sin(this.screenAnimTime * 4) + 1) / 2 // 0~1 pulsing
    for (const [buildingId, light] of this.warningLights) {
      const players = this.detainedPlayers.get(buildingId)
      if (players && players.length > 0) {
        light.intensity = 0.5 + flashIntensity * 1.5
        const mesh = this.warningLightMeshes.get(buildingId)
        if (mesh) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 + flashIntensity * 0.6
        }
      } else {
        light.intensity = 0
        const mesh = this.warningLightMeshes.get(buildingId)
        if (mesh) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.1
        }
      }
    }
  }

  getBuildingByCheatType(cheatType: string): string | undefined {
    const def = BUILDINGS.find(b => b.cheatType === cheatType)
    return def?.id
  }

  /** Get the bounding box of a building in world coordinates (XZ plane only) */
  getBuildingBounds(buildingId: string): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    const def = BUILDINGS.find(b => b.id === buildingId)
    if (!def) return null
    const [bx, , bz] = def.pos
    const [w, , d] = def.size
    const halfW = (w * def.scale) / 2
    const halfD = (d * def.scale) / 2
    return {
      minX: bx - halfW,
      maxX: bx + halfW,
      minZ: bz - halfD,
      maxZ: bz + halfD,
    }
  }

  /** Check if a point is inside any building's bounding box (with optional padding) */
  isInsideBuilding(x: number, z: number, padding: number = 1.2): string | null {
    for (const def of BUILDINGS) {
      const [bx, , bz] = def.pos
      const [w, , d] = def.size
      const halfW = (w * def.scale) / 2 + padding
      const halfD = (d * def.scale) / 2 + padding
      if (x >= bx - halfW && x <= bx + halfW && z >= bz - halfD && z <= bz + halfD) {
        return def.id
      }
    }
    return null
  }

  /** Get the door position for a building */
  getDoorPosition(buildingId: string): { x: number; z: number } | null {
    const marker = this.doorMarkers.get(buildingId)
    if (!marker) return null
    return { x: marker.position.x, z: marker.position.z }
  }

  /* ───── Backward-compatible stubs ───── */

  setOnBuildingClick(callback: (buildingId: string) => void): void {
    this.onBuildingClick = callback
  }

  getBuildingMeshes(): THREE.Mesh[] {
    return Array.from(this.buildingMeshes.values())
  }

  assignStation(_stationId: string, _npcId: string): void {}
  getStationPosition(_stationId: string): { x: number; y: number; z: number } | null { return null }
  updateScreenContent(_stationId: string, _state: Record<string, unknown>): void {}

  /* ───── Detention Zone Management ───── */

  addDetainedPlayer(buildingId: string, playerName: string): void {
    const players = this.detainedPlayers.get(buildingId) ?? []
    if (!players.includes(playerName)) {
      players.push(playerName)
      this.detainedPlayers.set(buildingId, players)
    }
    this.updateDetentionBadge(buildingId)
  }

  removeDetainedPlayer(buildingId: string, playerName: string): void {
    const players = this.detainedPlayers.get(buildingId) ?? []
    const idx = players.indexOf(playerName)
    if (idx >= 0) {
      players.splice(idx, 1)
      this.detainedPlayers.set(buildingId, players)
    }
    this.updateDetentionBadge(buildingId)
  }

  getDetainedPlayers(buildingId: string): string[] {
    return this.detainedPlayers.get(buildingId) ?? []
  }

  private updateDetentionBadge(buildingId: string): void {
    const badge = this.detentionBadges.get(buildingId)
    if (!badge) return
    const players = this.detainedPlayers.get(buildingId) ?? []
    const count = players.length

    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, 128, 128)

    if (count > 0) {
      // Red circle with count
      ctx.fillStyle = '#ff4757'
      ctx.beginPath()
      ctx.arc(64, 64, 48, 0, Math.PI * 2)
      ctx.fill()

      // Glow effect
      ctx.shadowColor = '#ff4757'
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.shadowBlur = 0

      ctx.font = 'bold 40px sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(count), 64, 64)
    } else {
      // Dim circle with 0
      ctx.fillStyle = 'rgba(100, 100, 100, 0.4)'
      ctx.beginPath()
      ctx.arc(64, 64, 48, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = 'bold 36px sans-serif'
      ctx.fillStyle = 'rgba(200, 200, 200, 0.5)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('0', 64, 64)
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    ;(badge.material as THREE.SpriteMaterial).map = texture
    ;(badge.material as THREE.SpriteMaterial).needsUpdate = true
  }
  releaseStation(_stationId: string): void {}

  /* ───── Helpers ───── */

  private enableShadows(obj: THREE.Object3D): void {
    obj.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }

  private placeModel(
    model: THREE.Group,
    x: number, y: number, z: number,
    scale: number,
    rotationY = 0,
  ): void {
    model.position.set(x, y, z)
    model.scale.setScalar(scale)
    model.rotation.y = rotationY
    this.enableShadows(model)
    this.townGroup.add(model)
  }

  private darkenColor(color: number, factor: number): number {
    const r = ((color >> 16) & 0xff) * factor
    const g = ((color >> 8) & 0xff) * factor
    const b = (color & 0xff) * factor
    return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b)
  }

  /* ───────── Sky & Fog ───────── */

  private buildSkyAndFog(): void {
    this.scene.background = new THREE.Color(SKY_COLOR)
    this.scene.fog = new THREE.Fog(SKY_COLOR, 40, 80)
  }

  /* ───────── Lighting ───────── */

  private buildLighting(): void {
    const ambient = new THREE.AmbientLight(0xc8d8f0, 0.6)
    this.townGroup.add(ambient)

    const dir = new THREE.DirectionalLight(0xfff8e8, 1.0)
    dir.position.set(30, 30, -10)
    dir.castShadow = true
    dir.shadow.mapSize.set(2048, 2048)
    dir.shadow.camera.left = -30
    dir.shadow.camera.right = 30
    dir.shadow.camera.top = 30
    dir.shadow.camera.bottom = -30
    dir.shadow.camera.near = 1
    dir.shadow.camera.far = 80
    dir.shadow.bias = -0.001
    this.townGroup.add(dir)

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3a6020, 0.35)
    this.townGroup.add(hemi)

    this.lightingRefs = {
      ambient,
      directional: dir,
      hemisphere: hemi,
      streetLightPoints: [],
      windowLights: [],
    }
  }

  /* ───────── Ground ───────── */

  private buildGround(): void {
    const grassMat = new THREE.MeshLambertMaterial({ color: GRASS_COLOR })
    const sidewalkMat = new THREE.MeshLambertMaterial({ color: SIDEWALK_COLOR })
    const plazaMat = new THREE.MeshLambertMaterial({ color: PLAZA_COLOR })
    const roadMat = new THREE.MeshLambertMaterial({ color: ROAD_COLOR })
    const whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xf1c40f })

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), grassMat)
    grass.rotation.x = -Math.PI / 2
    grass.position.set(20, 0, 12)
    grass.receiveShadow = true
    this.townGroup.add(grass)

    const sidewalkPositions: [number, number, number, number, number][] = [
      [6, 0.05, 12, 1.5, 24],
      [10, 0.05, 12, 1, 24],
      [28, 0.05, 12, 1.5, 24],
      [19.375, 0.05, 21, 18.75, 1],
    ]
    const swGeo = new THREE.PlaneGeometry(1, 1)
    for (const [x, y, z, w, d] of sidewalkPositions) {
      const sw = new THREE.Mesh(swGeo, sidewalkMat)
      sw.rotation.x = -Math.PI / 2
      sw.scale.set(w, d, 1)
      sw.position.set(x, y, z)
      sw.receiveShadow = true
      this.townGroup.add(sw)
    }

    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), plazaMat)
    plaza.rotation.x = -Math.PI / 2
    plaza.position.set(18, 0.05, 13)
    plaza.receiveShadow = true
    this.townGroup.add(plaza)

    const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 2), roadMat)
    road.rotation.x = -Math.PI / 2
    road.position.set(20, 0.06, 22.5)
    road.receiveShadow = true
    this.townGroup.add(road)

    const lineGeo = new THREE.PlaneGeometry(2, 0.15)
    for (let i = 0; i < 5; i++) {
      const line = new THREE.Mesh(lineGeo, yellowMat)
      line.rotation.x = -Math.PI / 2
      line.position.set(16 + i * 2, 0.065, 22.5)
      this.townGroup.add(line)
    }

    const crossGeo = new THREE.PlaneGeometry(0.3, 2)
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(crossGeo, whiteMat)
      stripe.rotation.x = -Math.PI / 2
      stripe.position.set(18 + i * 0.6 - 1.5, 0.065, 22.5)
      this.townGroup.add(stripe)
    }
  }

  /* ───────── Buildings ───────── */

  private buildBuildings(assets: AssetLoader): void {
    const doorGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8)
    const doorMat = new THREE.MeshLambertMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.4,
      emissive: 0x00ffaa,
      emissiveIntensity: 0.5,
    })

    for (const def of BUILDINGS) {
      const [bx, , bz] = def.pos
      let buildingTopY = 0

      // Try GLTF model first
      const model = assets.getBuildingModel(def.modelKey)
      if (model) {
        this.placeModel(model, bx, 0, bz, def.scale, def.rotationY)

        // Compute actual top from bounding box
        const box = new THREE.Box3().setFromObject(model)
        buildingTopY = box.max.y

        // Window light inside model
        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe0a0, 0, 4, 2)
          pl.position.set(0, 0.95, 1.01)
          model.add(pl)
          this.lightingRefs.windowLights.push(pl)
        }
      } else {
        // Fallback: procedural boxes
        const [w, h, d] = def.size
        const bodyMat = new THREE.MeshLambertMaterial({ color: def.color })
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat)
        body.position.set(bx, h / 2, bz)
        body.castShadow = true
        body.receiveShadow = true
        body.userData = { buildingId: def.id }
        this.townGroup.add(body)
        this.buildingMeshes.set(def.id, body)

        const roofMat = new THREE.MeshLambertMaterial({ color: def.roofColor })
        const roofW = w + 0.4
        const roofD = d + 0.4
        const roofH = 1.2
        const roof = new THREE.Mesh(new THREE.BoxGeometry(roofW, roofH, roofD), roofMat)
        roof.position.set(bx, h + roofH / 2 - 0.1, bz)
        roof.castShadow = true
        this.townGroup.add(roof)

        const ridgeMat = new THREE.MeshLambertMaterial({ color: this.darkenColor(def.roofColor, 0.8) })
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(roofW * 0.3, 0.5, roofD + 0.2), ridgeMat)
        ridge.position.set(bx, h + roofH + 0.15, bz)
        ridge.castShadow = true
        this.townGroup.add(ridge)

        buildingTopY = h + roofH + 0.4 // top of ridge

        const windowMat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7 })
        const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), windowMat)
        windowMesh.position.set(bx, h * 0.65, bz + d / 2 + 0.01)
        this.townGroup.add(windowMesh)

        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe0a0, 0, 4, 2)
          pl.position.set(bx, h * 0.65, bz + d / 2 + 0.5)
          this.townGroup.add(pl)
          this.lightingRefs.windowLights.push(pl)
        }
      }

      // Door marker (always created)
      const [dx, dy, dz] = def.doorOffset
      const door = new THREE.Mesh(doorGeo, doorMat)
      door.position.set(dx === 0 ? bx : dx, dy, dz)
      door.name = `door_${def.id}`
      this.townGroup.add(door)
      this.doorMarkers.set(def.id, door)

      // Building sign
      this.createBuildingSign(def, buildingTopY)

      // Detention zone visual elements
      this.buildDetentionZone(def, buildingTopY)
    }
  }

  private buildDetentionZone(def: BuildingDef, topY: number): void {
    const [bx, , bz] = def.pos
    const [w, , d] = def.size

    // ── Warning light on top ──
    const lightMeshGeo = new THREE.SphereGeometry(0.15, 8, 8)
    const lightMeshMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.1,
    })
    const lightMesh = new THREE.Mesh(lightMeshGeo, lightMeshMat)
    lightMesh.position.set(bx, topY + 0.5, bz)
    this.townGroup.add(lightMesh)
    this.warningLightMeshes.set(def.id, lightMesh)

    const warningLight = new THREE.PointLight(0xff0000, 0, 5, 2)
    warningLight.position.set(bx, topY + 0.5, bz)
    this.townGroup.add(warningLight)
    this.warningLights.set(def.id, warningLight)

    // ── Detention count badge ──
    const badgeCanvas = document.createElement('canvas')
    badgeCanvas.width = 128
    badgeCanvas.height = 128
    const badgeCtx = badgeCanvas.getContext('2d')!
    badgeCtx.fillStyle = 'rgba(100, 100, 100, 0.4)'
    badgeCtx.beginPath()
    badgeCtx.arc(64, 64, 48, 0, Math.PI * 2)
    badgeCtx.fill()
    badgeCtx.font = 'bold 36px sans-serif'
    badgeCtx.fillStyle = 'rgba(200, 200, 200, 0.5)'
    badgeCtx.textAlign = 'center'
    badgeCtx.textBaseline = 'middle'
    badgeCtx.fillText('0', 64, 64)

    const badgeTexture = new THREE.CanvasTexture(badgeCanvas)
    badgeTexture.minFilter = THREE.LinearFilter
    const badgeMat = new THREE.SpriteMaterial({ map: badgeTexture, transparent: true, depthTest: false })
    const badge = new THREE.Sprite(badgeMat)
    badge.position.set(bx + w / 2 + 0.5, topY + 0.5, bz - d / 2 - 0.5)
    badge.scale.set(0.8, 0.8, 1)
    this.townGroup.add(badge)
    this.detentionBadges.set(def.id, badge)

    // Initialize empty detention list
    this.detainedPlayers.set(def.id, [])
  }

  private createBuildingSign(def: BuildingDef, topY: number): void {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!

    ctx.clearRect(0, 0, 256, 64)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.beginPath()
    ctx.roundRect(4, 4, 248, 56, 8)
    ctx.fill()

    const r = (def.color >> 16) & 0xff
    const g = (def.color >> 8) & 0xff
    const b = def.color & 0xff
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(4, 4, 248, 56, 8)
    ctx.stroke()

    const displayName = def.name.length > 10 ? def.name.substring(0, 9) + '..' : def.name
    ctx.font = 'bold 20px sans-serif'
    ctx.fillStyle = '#e0e6f0'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(displayName, 128, 32)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter

    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(spriteMat)
    const [bx, , bz] = def.pos
    sprite.position.set(bx, topY + 0.5, bz)
    sprite.scale.set(2.5, 0.625, 1)
    this.townGroup.add(sprite)
  }

  /* ───────── Street Lights ───────── */

  private buildStreetLights(assets: AssetLoader): void {
    const DEG = Math.PI / 180

    const lightDefs: Array<{ x: number; z: number; rotY: number }> = [
      { x: 7.5, z: 2,  rotY: 0 },
      { x: 7.5, z: 8,  rotY: 0 },
      { x: 7.5, z: 14, rotY: 0 },
      { x: 7.5, z: 20, rotY: 0 },
      { x: 26.5, z: 2,  rotY: -180 * DEG },
      { x: 26.5, z: 8,  rotY: -180 * DEG },
      { x: 26.5, z: 14, rotY: -180 * DEG },
      { x: 26.5, z: 20, rotY: -180 * DEG },
      { x: 13, z: 9.5,  rotY: 135 * DEG },
      { x: 13, z: 16.5, rotY: -135 * DEG },
      { x: 18, z: 9.5,  rotY: 90 * DEG },
      { x: 18, z: 16.5, rotY: -90 * DEG },
      { x: 23, z: 9.5,  rotY: 45 * DEG },
      { x: 23, z: 16.5, rotY: -45 * DEG },
    ]

    const poleMat = new THREE.MeshLambertMaterial({ color: 0x555555 })
    const bulbMat = new THREE.MeshLambertMaterial({ color: 0xffee88, emissive: 0xffdd44, emissiveIntensity: 0.6 })
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 3, 6)
    const bulbGeo = new THREE.SphereGeometry(0.15, 6, 6)

    for (const def of lightDefs) {
      const model = assets.getPropModel('streetlight')
      if (model) {
        this.placeModel(model, def.x, 0, def.z, 3.5, def.rotY)

        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe4b0, 0, 12, 2)
          pl.position.set(-0.22, 0.82, 0)
          model.add(pl)
          this.lightingRefs.streetLightPoints.push(pl)
        }
      } else {
        const pole = new THREE.Mesh(poleGeo, poleMat)
        pole.position.set(def.x, 1.5, def.z)
        pole.castShadow = true
        this.townGroup.add(pole)

        const bulb = new THREE.Mesh(bulbGeo, bulbMat)
        bulb.position.set(def.x, 3.15, def.z)
        this.townGroup.add(bulb)

        if (this.lightingRefs) {
          const pl = new THREE.PointLight(0xffe4b0, 0, 8, 2)
          pl.position.set(def.x, 3.15, def.z)
          this.townGroup.add(pl)
          this.lightingRefs.streetLightPoints.push(pl)
        }
      }
    }
  }

  /* ───────── Trees ───────── */

  private buildTrees(assets: AssetLoader): void {
    const treePositions: [number, number, boolean][] = [
      [8, 3, false], [8, 7, true], [8, 11, false], [8, 15, true],
      [13, 10, true], [23, 10, true], [13, 16, true], [23, 16, true],
      [25, 4, false], [25, 8, true], [25, 12, false], [25, 16, true],
      [12, 1, true], [22, 1, true],
      [5, 19, false], [10, 19, true], [15, 19, false], [25, 19, true], [30, 19, false], [35, 19, true],
    ]

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 })
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x55aa33 })
    const darkCrownMat = new THREE.MeshLambertMaterial({ color: 0x338822 })
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 6)
    const crownGeo = new THREE.SphereGeometry(0.8, 6, 5)
    const smallCrownGeo = new THREE.SphereGeometry(0.5, 6, 5)

    for (const [x, z, small] of treePositions) {
      const model = assets.getPropModel('bush')
      if (model) {
        this.placeModel(model, x, 0, z, small ? 5.0 : 7.0)
      } else {
        const trunk = new THREE.Mesh(trunkGeo, trunkMat)
        trunk.position.set(x, 0.75, z)
        trunk.castShadow = true
        this.townGroup.add(trunk)

        const geo = small ? smallCrownGeo : crownGeo
        const mat = small ? darkCrownMat : crownMat
        const crown = new THREE.Mesh(geo, mat)
        crown.position.set(x, small ? 1.9 : 2.2, z)
        crown.castShadow = true
        this.townGroup.add(crown)
      }
    }
  }

  /* ───────── Benches ───────── */

  private buildBenches(assets: AssetLoader): void {
    const benchPositions: [number, number][] = [
      [15, 11], [21, 11], [15, 15], [21, 15],
    ]

    const seatMat = new THREE.MeshLambertMaterial({ color: 0x8b6c42 })
    const legMat = new THREE.MeshLambertMaterial({ color: 0x444444 })
    const seatGeo = new THREE.BoxGeometry(1.2, 0.08, 0.4)
    const legGeo = new THREE.BoxGeometry(0.06, 0.35, 0.06)
    const backGeo = new THREE.BoxGeometry(1.2, 0.5, 0.06)

    for (const [x, z] of benchPositions) {
      const model = assets.getPropModel('bench')
      if (model) {
        this.placeModel(model, x, 0, z, 6.0)
      } else {
        const seat = new THREE.Mesh(seatGeo, seatMat)
        seat.position.set(x, 0.4, z)
        seat.castShadow = true
        this.townGroup.add(seat)

        const back = new THREE.Mesh(backGeo, seatMat)
        back.position.set(x, 0.65, z - 0.17)
        back.castShadow = true
        this.townGroup.add(back)

        for (const ox of [-0.5, 0.5]) {
          for (const oz of [-0.12, 0.12]) {
            const leg = new THREE.Mesh(legGeo, legMat)
            leg.position.set(x + ox, 0.175, z + oz)
            this.townGroup.add(leg)
          }
        }
      }
    }
  }

  /* ───────── Fountain ───────── */

  private buildFountain(assets: AssetLoader): void {
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb })

    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.3, 12), stoneMat)
    base.position.set(18, 0.15, 13)
    base.castShadow = true
    base.receiveShadow = true
    this.townGroup.add(base)

    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.5, 12), stoneMat)
    wall.position.set(18, 0.55, 13)
    this.townGroup.add(wall)

    const waterMat = new THREE.MeshLambertMaterial({ color: 0x4488cc, transparent: true, opacity: 0.6 })
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.05, 12), waterMat)
    water.position.set(18, 0.75, 13)
    this.townGroup.add(water)

    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x999999 })
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.0, 8), pillarMat)
    pillar.position.set(18, 1.05, 13)
    pillar.castShadow = true
    this.townGroup.add(pillar)

    // Capybara on fountain (agentshire style)
    const capybara = assets.getPropModel('capybara')
    if (capybara) {
      capybara.traverse(child => {
        if (!(child as THREE.Mesh).isMesh) return
        const mats = Array.isArray((child as THREE.Mesh).material)
          ? (child as THREE.Mesh).material as THREE.MeshStandardMaterial[]
          : [(child as THREE.Mesh).material as THREE.MeshStandardMaterial]
        for (const mat of mats) {
          if (mat.color) {
            const hsl = { h: 0, s: 0, l: 0 }
            mat.color.getHSL(hsl)
            mat.color.setHSL(hsl.h, Math.min(hsl.s * 1.6, 1.0), hsl.l)
          }
          if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace
          mat.roughness = Math.max((mat.roughness ?? 1) * 0.75, 0.35)
        }
      })
      const box = new THREE.Box3().setFromObject(capybara)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const targetSize = 4.0
      const scale = maxDim > 0 ? targetSize / maxDim : 8.0
      const yOffset = -box.min.y * scale
      this.placeModel(capybara, 18, 0.8 + yOffset, 13, scale)
    }
  }

  /* ───────── Flower Beds ───────── */

  private buildFlowerBeds(): void {
    const flowerColors = [0xff6688, 0xffaa33, 0xff44aa, 0xaa44ff, 0xffff44]
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x44882c })
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4)
    const petalGeo = new THREE.SphereGeometry(0.08, 5, 4)

    const bedCenters: [number, number][] = [
      [5, 4], [5, 8], [5, 13], [30, 5], [30, 11], [9, 17], [35, 14],
    ]

    for (const [cx, cz] of bedCenters) {
      for (let i = 0; i < 5; i++) {
        const fx = cx + (((cx * 7 + i * 13) % 11) - 5) * 0.1
        const fz = cz + (((cz * 3 + i * 7) % 11) - 5) * 0.1
        const colorIdx = (cx * 7 + cz * 3 + i) % flowerColors.length

        const stem = new THREE.Mesh(stemGeo, stemMat)
        stem.position.set(fx, 0.125, fz)
        this.townGroup.add(stem)

        const petalMat = new THREE.MeshLambertMaterial({
          color: flowerColors[colorIdx],
          emissive: flowerColors[colorIdx],
          emissiveIntensity: 0.15,
        })
        const petal = new THREE.Mesh(petalGeo, petalMat)
        petal.position.set(fx, 0.28, fz)
        this.townGroup.add(petal)
      }
    }
  }

  /* ───────── Fire Hydrants ───────── */

  private buildFireHydrants(assets: AssetLoader): void {
    const positions: [number, number][] = [
      [7, 21],
      [27, 21],
      [18, 21],
    ]

    const hydrantMat = new THREE.MeshLambertMaterial({ color: 0xcc2222 })
    const capMat = new THREE.MeshLambertMaterial({ color: 0xdd3333 })

    for (const [x, z] of positions) {
      const model = assets.getPropModel('firehydrant')
      if (model) {
        this.placeModel(model, x, 0, z, 3.5)
      } else {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 8), hydrantMat)
        body.position.set(x, 0.25, z)
        body.castShadow = true
        this.townGroup.add(body)

        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.1, 8), capMat)
        cap.position.set(x, 0.55, z)
        this.townGroup.add(cap)

        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 6), hydrantMat)
        nozzle.rotation.z = Math.PI / 2
        nozzle.position.set(x + 0.15, 0.35, z)
        this.townGroup.add(nozzle)
      }
    }
  }
}
