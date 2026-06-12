// MainScene — main Three.js scene for the anti-cheat town

import * as THREE from 'three'
import { NPCManager } from '../npc/NPCManager.js'
import { NPC } from '../npc/NPC.js'
import { TownBuilder } from '../scene/TownBuilder.js'
import { VehicleManager } from '../scene/VehicleManager.js'
import { AssetLoader } from '../scene/AssetLoader.js'
import { TownManagerNpc } from '../npc/TownManager.js'
import { CameraController } from './visual/CameraController.js'
import { TimeOfDayLighting } from './visual/TimeOfDayLighting.js'
import { WeatherEffects } from './visual/WeatherEffects.js'
import { PostProcessing } from './visual/PostProcessing.js'
import { VFXSystem } from './visual/VFXSystem.js'
import { EventDispatcher } from './EventDispatcher.js'
import { AlertPanel } from '../ui/AlertPanel.js'
import { PlayerDetailCard } from '../ui/PlayerDetailCard.js'
import { BanDialog } from '../ui/BanDialog.js'
import { UnbanDialog } from '../ui/UnbanDialog.js'
import { WhitelistDialog } from '../ui/WhitelistDialog.js'
import { StatsPanel } from '../ui/StatsPanel.js'
import { RecordsArchive } from '../ui/RecordsArchive.js'
import { PenaltyLogPanel } from '../ui/PenaltyLogPanel.js'
import { AlertSound } from '../audio/AlertSound.js'
import { AudioSystem, getAudioSystem } from '../audio/AudioSystem.js'
import { BGMManager } from '../audio/BGMManager.js'
import { AmbientSoundManager } from '../audio/AmbientSoundManager.js'
import type { PlayerPhase, Vec3, CheatType, Confidence, PlayerInfo, CheatRecordEntry, ServerStats, TimePeriod } from '../types.js'
import { PHASE_CSS_COLORS, CHEAT_TYPE_LABELS } from '../types.js'
import type { GameAction } from '../data/GameProtocol.js'

export class MainScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private cameraController: CameraController
  private clock: THREE.Clock
  private npcManager: NPCManager
  private townBuilder: TownBuilder
  private vehicleManager: VehicleManager
  private timeOfDayLighting: TimeOfDayLighting
  private weatherEffects: WeatherEffects
  private postProcessing: PostProcessing
  private vfxSystem: VFXSystem
  private eventDispatcher: EventDispatcher

  // UI
  private alertPanel: AlertPanel
  private playerDetailCard: PlayerDetailCard
  private banDialog: BanDialog
  private unbanDialog: UnbanDialog
  private whitelistDialog: WhitelistDialog
  private statsPanel: StatsPanel
  private recordsArchive: RecordsArchive
  private penaltyLogPanel!: PenaltyLogPanel
  private alertSound: AlertSound
  private audioSystem: AudioSystem
  private bgmManager: BGMManager
  private ambientSound: AmbientSoundManager

  // State
  private playerDataMap: Map<string, PlayerInfo> = new Map()
  private playerRecords: Map<string, CheatRecordEntry[]> = new Map()
  private sendAction: ((action: GameAction) => void) | null = null
  private apiBase = ''
  private currentMode: 'monitor' | 'life' = 'monitor'

  // AbortController for cancelling stale refreshPlayerDetail calls
  private refreshAbortController: AbortController | null = null

  // Camera follow
  private trackedPlayerId: string | null = null
  private isFollowing: boolean = false

  // Connection status
  private connDot: HTMLElement
  private connText: HTMLElement

  // Stats polling
  private statsPollTimer: number = 0
  private statsPollInterval: number = 5.0

  // Keyboard shortcuts
  private detectionPaused: boolean = false

  // Label container for NPC labels
  private labelContainer: HTMLElement

  // NPC click raycaster
  private npcRaycaster: THREE.Raycaster = new THREE.Raycaster()
  private clickMouse: THREE.Vector2 = new THREE.Vector2()

  private assetLoader: AssetLoader
  private townManager: TownManagerNpc | null = null

  private initPromise: Promise<void>

  constructor(container: HTMLElement) {
    // Create label container for NPC DOM labels
    this.labelContainer = document.createElement('div')
    this.labelContainer.id = 'npc-labels'
    Object.assign(this.labelContainer.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '5',
    })
    document.body.appendChild(this.labelContainer)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    container.appendChild(this.renderer.domElement)

    // Scene
    this.scene = new THREE.Scene()

    // Camera
    this.camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 200)

    // Camera Controller (replaces OrbitControls)
    this.cameraController = new CameraController(this.camera, this.renderer.domElement)

    // Clock
    this.clock = new THREE.Clock()

    // Asset Loader
    this.assetLoader = new AssetLoader()

    // Town Builder (built after assets load)
    this.townBuilder = new TownBuilder(this.scene)

    // Time of Day Lighting
    this.timeOfDayLighting = new TimeOfDayLighting(this.scene)

    // Weather Effects
    this.weatherEffects = new WeatherEffects(this.scene)

    // VFX System
    this.vfxSystem = new VFXSystem(this.scene)

    // Vehicle Manager (built after assets load)
    this.vehicleManager = new VehicleManager(this.scene)

    // Post Processing
    this.postProcessing = new PostProcessing(this.renderer, this.scene, this.camera)

    // NPC Manager (new API with labelContainer)
    this.npcManager = new NPCManager(this.scene, this.labelContainer)

    // Event dispatcher
    this.eventDispatcher = new EventDispatcher(this)

    // UI
    this.alertPanel = new AlertPanel()
    this.playerDetailCard = new PlayerDetailCard()
    this.banDialog = new BanDialog()
    this.unbanDialog = new UnbanDialog()
    this.whitelistDialog = new WhitelistDialog()
    this.statsPanel = new StatsPanel()
    this.recordsArchive = new RecordsArchive()
    this.penaltyLogPanel = new PenaltyLogPanel()
    this.alertSound = new AlertSound()
    this.audioSystem = getAudioSystem()
    this.bgmManager = new BGMManager()
    this.ambientSound = new AmbientSoundManager()

    // Connection status
    this.connDot = document.getElementById('conn-dot')!
    this.connText = document.getElementById('conn-text')!

    this.setupUICallbacks()
    this.setupCanvasClick()
    this.setupKeyboardShortcuts()
    this.setupResize(container)

    // Async: load assets then build scene
    this.initPromise = this.initScene()
  }

  get ready(): Promise<void> {
    return this.initPromise
  }

  private async initScene(): Promise<void> {
    await this.assetLoader.preload()

    this.townBuilder.build(this.assetLoader)
    const lightingRefs = this.townBuilder.getLightingRefs()
    if (lightingRefs) {
      this.timeOfDayLighting.setLightingRefs(lightingRefs)
    }

    // Inject collision check into NPCManager — prevents NPCs from walking into buildings
    this.npcManager.setCollisionCheck((x: number, z: number) => {
      return this.townBuilder.isInsideBuilding(x, z) !== null
    })

    this.vehicleManager.build(this.assetLoader)

    // Build town manager NPC
    this.townManager = new TownManagerNpc(this.scene, this.npcManager)
    this.townManager.build(this.assetLoader)

    // Initialize audio system
    await this.initAudio()
  }

  private async initAudio(): Promise<void> {
    await this.audioSystem.init()
    await this.audioSystem.preload()
    const actx = this.audioSystem.getAudioContext()
    const sfxGain = this.audioSystem.getSfxGain()
    if (actx && sfxGain) {
      await this.bgmManager.init(actx, sfxGain)
      this.ambientSound.init(actx, sfxGain)
    }
  }

  private setupUICallbacks(): void {
    this.alertPanel.setOnAlertClick((alert) => {
      const npc = this.npcManager.get(alert.playerId)
      if (npc) {
        const pos = npc.getPosition()
        this.cameraController.animateTo(new THREE.Vector3(pos.x, 0, pos.z))
      }
      const playerInfo = this.playerDataMap.get(alert.playerId)
      if (playerInfo) {
        const records = this.playerRecords.get(alert.playerId) ?? []
        this.playerDetailCard.show(playerInfo, records)
      }
    })

    this.alertPanel.onClear(() => {
      this.statsPanel.resetAlerts()
    })

    this.playerDetailCard.setOnAction((action, playerId, extra) => {
      if (action === 'ban') {
        this.banDialog.show(playerId)
      } else if (action === 'unban') {
        const info = this.playerDataMap.get(playerId)
        this.unbanDialog.show(
          playerId,
          info?.name,
          info?.banStatus?.isBanned ? {
            reason: info.banStatus.reason,
            duration: info.banStatus.duration,
            bannedAt: info.banStatus.bannedAt,
          } : undefined,
        )
      } else if (action === 'whitelist') {
        const info = this.playerDataMap.get(playerId)
        this.whitelistDialog.show(playerId, info?.name)
      }
    })

    this.playerDetailCard.setOnTrack((playerId) => {
      const info = this.playerDataMap.get(playerId)
      if (!info) return

      if (info.isTracked) {
        // Start tracking
        this.trackedPlayerId = playerId
        this.isFollowing = true
        const npc = this.npcManager.get(playerId)
        if (npc) {
          this.cameraController.follow(npc.mesh)
        }
      } else {
        // Stop tracking
        this.trackedPlayerId = null
        this.isFollowing = false
        this.cameraController.stopFollowing()
      }
    })

    this.playerDetailCard.setOnRefresh((playerId) => {
      this.refreshPlayerDetail(playerId)
    })

    this.playerDetailCard.setPositionProvider((playerId) => {
      const npc = this.npcManager.get(playerId)
      if (npc) {
        const pos = npc.getPosition()
        return { x: pos.x, y: pos.y, z: pos.z }
      }
      return null
    })

    this.banDialog.setOnConfirm((playerId, duration, reason) => {
      // 从玩家数据中提取最主要的作弊类型（VP 最高的类型）
      const banInfo = this.playerDataMap.get(playerId)
      let cheatType: string | undefined
      if (banInfo?.vpByType) {
        let maxVP = 0
        for (const [type, vp] of Object.entries(banInfo.vpByType)) {
          if (vp > maxVP) {
            maxVP = vp
            cheatType = type
          }
        }
      }
      this.sendAdminAction('ban', playerId, { duration, reason, ...(cheatType ? { cheatType } : {}) })
      // 更新本地封禁状态
      const info = this.playerDataMap.get(playerId)
      if (info) {
        info.banStatus = {
          isBanned: true,
          reason,
          duration,
          bannedAt: Date.now(),
          source: 'admin:web',
        }
        if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === playerId) {
          const records = this.playerRecords.get(playerId) ?? []
          this.playerDetailCard.show(info, records)
        }
      }
      this.alertSound.playBanSound()
      this.showToast('封禁指令已发送', 'success')
    })

    this.unbanDialog.setOnConfirm((playerId, reason) => {
      this.sendAdminAction('unban', playerId, { reason })
      // 取消可能还在进行中的 refreshPlayerDetail 请求，避免竞态覆盖
      this.refreshAbortController?.abort()
      // 更新本地封禁状态
      const info = this.playerDataMap.get(playerId)
      if (info) {
        info.banStatus = { isBanned: false }
        if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === playerId) {
          const records = this.playerRecords.get(playerId) ?? []
          this.playerDetailCard.show(info, records)
        }
      }
      this.showToast('解封指令已发送', 'success')
    })

    this.whitelistDialog.setOnConfirm((playerId, reason) => {
      this.sendAdminAction('whitelist', playerId, { reason })
      this.showToast('白名单指令已发送', 'success')
    })

    this.recordsArchive.setOnFetchRecords(async () => {
      try {
        const resp = await fetch(`${this.apiBase}/api/records`)
        if (resp.ok) {
          return await resp.json() as CheatRecordEntry[]
        }
      } catch { /* fallback */ }
      const allRecords: CheatRecordEntry[] = []
      for (const [playerId, records] of this.playerRecords) {
        const info = this.playerDataMap.get(playerId)
        for (const r of records) {
          allRecords.push({ ...r, playerName: info?.name ?? playerId })
        }
      }
      return allRecords
    })
  }

  private setupCanvasClick(): void {
    this.renderer.domElement.addEventListener('click', (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.clickMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.clickMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      this.npcRaycaster.setFromCamera(this.clickMouse, this.cameraController.getCamera())

      // Check NPC clicks
      const npcMeshes = this.npcManager.getAll().map(n => n.mesh)
      const intersects = this.npcRaycaster.intersectObjects(npcMeshes, true)
      if (intersects.length > 0) {
        // Find which NPC was clicked
        let clickedObj = intersects[0].object
        while (clickedObj.parent && !clickedObj.userData.npcId) {
          clickedObj = clickedObj.parent
        }
        const npcId = clickedObj.userData.npcId as string | undefined
        if (npcId) {
          const playerInfo = this.playerDataMap.get(npcId)
          if (playerInfo) {
            const records = this.playerRecords.get(npcId) ?? []
            this.playerDetailCard.show(playerInfo, records)
            // 异步从 API 获取完整数据（封禁状态 + 作弊记录详情）
            this.refreshPlayerDetail(npcId)
          }
          return
        }
      }

      // Fallback: for detained/banned NPCs that may be inside buildings
      // (raycast blocked by building geometry), use proximity-based detection
      const ray = this.npcRaycaster.ray
      const cameraPos = this.cameraController.getCamera().position
      for (const npc of this.npcManager.getAll()) {
        if (!npc.detained) continue
        const npcPos = npc.getPosition()
        // Project NPC position onto ray
        const npcDir = new THREE.Vector3().subVectors(npcPos, cameraPos)
        const rayDir = ray.direction.clone()
        const projLen = npcDir.dot(rayDir)
        if (projLen < 0) continue  // NPC is behind camera
        const closestOnRay = cameraPos.clone().add(rayDir.multiplyScalar(projLen))
        const distToRay = npcPos.distanceTo(closestOnRay)
        // If click is within 1.5 units of the NPC's projected position on ray
        if (distToRay < 1.5) {
          const npcId = npc.npcId
          const playerInfo = this.playerDataMap.get(npcId)
          if (playerInfo) {
            const records = this.playerRecords.get(npcId) ?? []
            this.playerDetailCard.show(playerInfo, records)
            this.refreshPlayerDetail(npcId)
          }
          return
        }
      }

      // Check building clicks (door markers)
      const doorMarkers = this.townBuilder.getDoorMarkers()
      for (const [buildingId, marker] of doorMarkers) {
        const doorIntersects = this.npcRaycaster.intersectObject(marker)
        if (doorIntersects.length > 0) {
          // Could open building-specific view
          return
        }
      }
    })
  }

  private setupKeyboardShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          this.detectionPaused = !this.detectionPaused
          break
        case '1': this.alertPanel['setFilter']('fly'); break
        case '2': this.alertPanel['setFilter']('speed'); break
        case '3': this.alertPanel['setFilter']('kill_aura'); break
        case '4': this.alertPanel['setFilter']('x_ray'); break
        case 'm': case 'M':
          document.getElementById('alert-sound-toggle')!.click()
          break
        case 'Escape':
          if (this.recordsArchive.isVisible()) this.recordsArchive.hide()
          else if (this.playerDetailCard.isVisible()) this.playerDetailCard.hide()
          else if (this.banDialog['overlay'].classList.contains('visible')) this.banDialog.hide()
          break
      }
    })
  }

  private setupResize(container: HTMLElement): void {
    const onResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      this.renderer.setSize(w, h)
      this.cameraController.resize(w, h)
      this.postProcessing.resize(w, h)
    }
    window.addEventListener('resize', onResize)
  }

  setSendAction(fn: (action: GameAction) => void): void {
    this.sendAction = fn
  }

  setApiBase(base: string): void {
    this.apiBase = base.replace(/\/$/, '')
  }

  getEventDispatcher(): EventDispatcher {
    return this.eventDispatcher
  }

  /** 显示操作结果 Toast 通知 */
  private showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const toast = document.createElement('div')
    const bgColor = type === 'success' ? 'rgba(46,213,115,0.9)' : type === 'error' ? 'rgba(231,76,60,0.9)' : 'rgba(69,170,242,0.9)'
    toast.textContent = message
    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: bgColor,
      color: '#fff',
      padding: '10px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '600',
      zIndex: '200',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s',
    })
    document.body.appendChild(toast)
    setTimeout(() => {
      toast.style.opacity = '0'
      setTimeout(() => toast.remove(), 300)
    }, 2500)
  }

  private sendAdminAction(action: 'ban' | 'unban' | 'whitelist', playerId: string, extra?: Record<string, string>): void {
    if (!this.sendAction) return
    const adminAction: GameAction = {
      type: 'admin_action',
      action,
      playerId,
      ...extra,
    }
    this.sendAction(adminAction)
  }

  /** 从后端 API 刷新玩家详情（封禁状态 + 作弊记录） */
  private async refreshPlayerDetail(playerId: string): Promise<void> {
    const info = this.playerDataMap.get(playerId)
    if (!info) return

    // 取消之前未完成的 refreshPlayerDetail 请求，避免竞态条件
    this.refreshAbortController?.abort()
    const abortController = new AbortController()
    this.refreshAbortController = abortController

    try {
      // 并行获取封禁状态和作弊记录
      const [banResp, recordsResp] = await Promise.allSettled([
        fetch(`${this.apiBase}/api/bans`, { signal: abortController.signal }),
        fetch(`${this.apiBase}/api/players/${encodeURIComponent(info.playerId ?? playerId)}/records`, { signal: abortController.signal }),
      ])

      // 如果请求已被取消，不再更新状态
      if (abortController.signal.aborted) return

      // 更新封禁状态
      if (banResp.status === 'fulfilled' && banResp.value.ok) {
        const bans = await banResp.value.json() as Array<{ playerId: string; playerName: string; reason: string; duration: string; bannedAt: number; expiresAt: number | null; active: boolean; source?: string; npcId?: string }>
        // 优先用 npcId 匹配（API 返回的 npcId 字段），兼容旧格式用 playerId 前缀匹配
        const myBan = bans.find((b: any) => {
          if (b.npcId && b.npcId === playerId) return true
          if (b.playerId === playerId || b.playerId === info.playerId) return true
          // 兜底：npcId 格式 player_XXXXXXXX → UUID 前缀匹配
          const prefix = playerId.replace('player_', '')
          if (prefix && b.playerId.startsWith(prefix)) return true
          return false
        })
        if (myBan && myBan.active) {
          info.banStatus = {
            isBanned: true,
            reason: myBan.reason,
            duration: myBan.duration,
            bannedAt: myBan.bannedAt,
            expiresAt: myBan.expiresAt,
            source: myBan.source,
          }
        } else {
          info.banStatus = { isBanned: false }
        }
      }

      // 更新作弊记录
      if (recordsResp.status === 'fulfilled' && recordsResp.value.ok) {
        const apiRecords = await recordsResp.value.json() as any[]
        const mappedRecords: CheatRecordEntry[] = apiRecords.map((r: any) => ({
          id: r.id ?? `r_${r.timestamp}`,
          cheatType: r.cheatType ?? 'fly',
          confidence: r.confidence ?? 'medium',
          timestamp: r.timestamp,
          action: r.action ?? '已检测',
          playerName: r.playerName,
          evidence: r.evidence,
          vp: r.vp,
        }))
        this.playerRecords.set(playerId, mappedRecords)
        info.cheatRecordCount = mappedRecords.length
      }

      // 如果请求已被取消，不再更新 UI
      if (abortController.signal.aborted) return

      // 刷新详情卡
      if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === playerId) {
        const records = this.playerRecords.get(playerId) ?? []
        this.playerDetailCard.show(info, records)
      }
    } catch (err: any) {
      // AbortError 是正常的取消，不需要警告
      if (err?.name !== 'AbortError') {
        console.warn('[MainScene] refreshPlayerDetail failed:', err)
      }
    }
  }

  setConnectionStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
    this.connDot.className = `dot ${status}`
    const labels: Record<string, string> = {
      connected: '已连接',
      disconnected: '未连接',
      connecting: '连接中...',
    }
    this.connText.textContent = labels[status]
  }

  // ── Event handlers (called by EventDispatcher) ──

  onNpcSpawn(npcId: string, name: string, role: string, spawn?: Vec3): void {
    const pos = spawn ?? { x: 18 + (Math.random() - 0.5) * 8, y: 0, z: 13 + (Math.random() - 0.5) * 6 }

    // Get a random character model for each NPC
    const glbModel = this.assetLoader.getRandomCharacterModel()

    const npc = this.npcManager.createNPC({
      id: npcId,
      name,
      color: 0x4a90d9,
      role,
      spawn: pos,
      glbModel: glbModel ?? undefined,
    })

    // Spawn VFX
    this.vfxSystem.spawn.summonShockwave(new THREE.Vector3(pos.x, 0, pos.z))

    if (!this.playerDataMap.has(npcId)) {
      this.playerDataMap.set(npcId, {
        playerId: npcId,
        name,
        ip: '---',
        gameMode: 'SURVIVAL',
        phase: 'normal',
        position: pos,
        speed: 0,
        cps: 0,
        hitRate: 0,
        cheatRecordCount: 0,
        evidence: [],
        phaseHistory: [],
        isTracked: false,
        totalVP: 0,
        vpByType: { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 },
        penaltyCount: 0,
        banStatus: { isBanned: false },
      })
    }
  }

  onNpcDespawn(npcId: string): void {
    console.log(`[MainScene] onNpcDespawn: npcId=${npcId}`)
    const npc = this.npcManager.get(npcId)
    const info = this.playerDataMap.get(npcId)

    // 核心防御：被封禁的玩家的 NPC 绝不能被 despawn
    // 管理员需要通过交互 NPC 来执行解封操作
    // 检查条件：(1) phase 为 punishing (2) NPC 标记为 detained (3) banStatus 显示封禁中
    const isPunishing = info?.phase === 'punishing' || npc?.phase === 'punishing'
    const isDetained = npc?.detained
    const isBanned = info?.banStatus?.isBanned

    if (isPunishing || isDetained || isBanned) {
      console.log(`[MainScene] onNpcDespawn: BLOCKING despawn for banned/detained NPC npcId=${npcId}, phase=${info?.phase}, detained=${npc?.detained}, isBanned=${isBanned}`)
      if (info) {
        info.phase = 'offline'
      }
      if (npc) {
        // 确保 detained 标志为 true，保持关押区漫游
        npc.detained = true
        npc.transitionTo('offline')
      }
      // NPC 保留在场景中，继续关押区漫游，管理员可交互
      return
    }

    // 防御：解封后的 NPC 处于 normal phase 但玩家仍离线，
    // 此时若收到延迟的 npc_despawn（如重连状态同步），不应移除
    // 检查 banStatus：如果玩家刚被解封（isBanned=false 且有历史记录），保留 NPC
    if (info && info.banStatus && !info.banStatus.isBanned && info.banStatus.bannedAt) {
      console.log(`[MainScene] onNpcDespawn: blocking despawn for recently-unbanned NPC npcId=${npcId}`)
      if (npc) {
        npc.transitionTo('offline')
      }
      info.phase = 'offline'
      return
    }

    // 正常退出：立即移除 NPC（1 秒内）
    console.log(`[MainScene] onNpcDespawn: normal exit, removing npcId=${npcId}`)
    if (npc) {
      this.npcManager.remove(npcId)
    }
    if (info) {
      info.phase = 'offline'
    }
    this.playerDataMap.delete(npcId)
  }

  onNpcPhase(npcId: string, phase: PlayerPhase): void {
    const info = this.playerDataMap.get(npcId)
    const oldPhase = info?.phase ?? 'normal'

    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.transitionTo(phase)

      // 被封禁的 NPC 转为 offline 时，设置 detained 标志
      // 确保页面刷新后 NPC 保留在关押区漫游
      const isBanned = info?.banStatus?.isBanned
      if (phase === 'offline' && (isBanned || npc.detained || oldPhase === 'punishing')) {
        npc.detained = true
      }

      // 解封：phase 回到 normal 时，清除 detained 标志和 emoji
      if (phase === 'normal' && oldPhase !== 'normal') {
        npc.detained = false
        npc.setEmoji(null)
      }

      // Set glow based on phase (detained offline NPCs keep red glow)
      const isDetainedOffline = npc.detained && phase === 'offline'
      const glowMap: Record<PlayerPhase, string> = {
        normal: 'none',
        suspicious: 'yellow',
        investigating: 'cyan',
        confirmed: 'red',
        punishing: 'red',
        monitoring: 'green',
        offline: isDetainedOffline ? 'red' : 'none',
      }
      npc.setGlow(glowMap[phase])
    }

    if (info) {
      if (oldPhase !== phase) {
        info.phaseHistory.push({
          from: oldPhase as PlayerPhase,
          to: phase,
          timestamp: Date.now(),
        })
      }
      info.phase = phase

      // 解封：phase 回到 normal 时，清除 banStatus
      if (phase === 'normal' && oldPhase !== 'normal') {
        info.banStatus = { isBanned: false }
      }
    }
    if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === npcId) {
      this.playerDetailCard.show(info!, this.playerRecords.get(npcId) ?? [])
    }
  }

  onNpcMoveTo(npcId: string, target: Vec3): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.moveTo({ x: target.x, z: target.z })
    }
    const info = this.playerDataMap.get(npcId)
    if (info) {
      info.position = target
    }
  }

  onNpcGlow(npcId: string, color: string | null): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.setGlow(color ?? 'none')
    }
  }

  onNpcEmoji(npcId: string, emoji: string | null): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.setEmoji(emoji)
    }
  }

  onNpcAnim(npcId: string, animation: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.playAnimation(animation)
    }
  }

  onNpcLookAt(npcId: string, targetNpcId: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.lookAtTarget(targetNpcId)
    }
  }

  onNpcEmote(npcId: string, _emote: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.playAnimation('look_around')
    }
  }

  onDialogMessage(npcId: string, text: string, _isStreaming: boolean): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.showSpeechBubble(text)
    }
  }

  onAlertPopup(playerId: string, cheatType: CheatType, confidence: Confidence, message: string, npcId?: string): void {
    const info = this.playerDataMap.get(playerId)
    const playerName = info?.name ?? playerId
    this.alertPanel.addAlert(playerId, playerName, cheatType, confidence, message)
    if (!this.alertPanel.isMuted()) {
      this.alertSound.playAlert(confidence)
    }
    this.audioSystem.play('alert')
    this.statsPanel.addHourlyAlert()

    // VFX for high confidence alerts
    if (confidence === 'high') {
      const npc = this.npcManager.get(playerId)
      if (npc) {
        const pos = npc.getPosition()
        this.vfxSystem.spawn.errorLightning(pos)
      }
    }
  }

  onServerStats(stats: ServerStats): void {
    this.statsPanel.update(stats)
  }

  onPlayerStats(npcId: string, stats: Record<string, number>): void {
    const info = this.playerDataMap.get(npcId)
    if (info) {
      if (stats.speed !== undefined) info.speed = stats.speed
      if (stats.cps !== undefined) info.cps = stats.cps
      if (stats.hitRate !== undefined) info.hitRate = stats.hitRate
      if (stats.x !== undefined) info.position.x = stats.x
      if (stats.y !== undefined) info.position.y = stats.y
      if (stats.z !== undefined) info.position.z = stats.z
    }
    if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === npcId) {
      this.playerDetailCard.updateStats(stats)
    }
  }

  onModeChange(mode: 'monitor' | 'life'): void {
    this.currentMode = mode
  }

  onSceneSwitch(_target: 'town' | 'office'): void {
    // Could switch between town and office view
  }

  onProgress(_current: number, _total: number, _label: string): void {
    // Could show a progress bar
  }

  onWorkstationAssign(npcId: string, stationId: string): void {
    const pos = this.townBuilder.getStationPosition(stationId)
    if (pos) {
      const npc = this.npcManager.get(npcId)
      if (npc) {
        npc.moveTo({ x: pos.x, z: pos.z })
      }
    }
    this.townBuilder.assignStation(stationId, npcId)
    const info = this.playerDataMap.get(npcId)
    if (info) {
      info.stationId = stationId
    }
  }

  onWorkstationScreen(stationId: string, state: Record<string, unknown>): void {
    this.townBuilder.updateScreenContent(stationId, state)
  }

  onWorkstationReleased(npcId: string, stationId: string): void {
    this.townBuilder.releaseStation(stationId)
    const info = this.playerDataMap.get(npcId)
    if (info) {
      info.stationId = undefined
    }
  }

  onFx(effect: string, params: Record<string, unknown>): void {
    // Route VFX effects
    const npcId = params.npcId as string | undefined
    const npc = npcId ? this.npcManager.get(npcId) : null
    const pos = npc ? npc.getPosition() : new THREE.Vector3(20, 0, 12)

    switch (effect) {
      case 'thinking_aura':
        this.vfxSystem.work.thinkingAura(pos)
        break
      case 'working_stream':
        this.vfxSystem.work.workingStream(pos)
        break
      case 'search_radar':
        this.vfxSystem.work.searchRadar(pos)
        break
      case 'connection_beam': {
        const targetId = params.targetId as string | undefined
        const targetNpc = targetId ? this.npcManager.get(targetId) : null
        const targetPos = targetNpc ? targetNpc.getPosition() : pos.clone().add(new THREE.Vector3(3, 0, 0))
        this.vfxSystem.work.connectionBeam(pos, targetPos)
        break
      }
      case 'fireworks':
        this.vfxSystem.celebration.deployFireworks(pos)
        break
      case 'confetti':
        this.vfxSystem.celebration.confetti(pos)
        break
      case 'light_pillar':
        this.vfxSystem.celebration.lightPillar(pos)
        break
    }
  }

  onBanAnimation(npcId: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.playAnimation('ban_animation')
      const pos = npc.getPosition()
      this.vfxSystem.spawn.errorLightning(pos)
    }
    if (!this.alertPanel.isMuted()) {
      this.alertSound.playBanSound()
    }
    this.audioSystem.play('ban')
  }

  onFreezeEffect(npcId: string): void {
    const npc = this.npcManager.get(npcId)
    if (npc) {
      npc.setGlow('cyan')
      npc.setFrozen(true)
    }
    this.audioSystem.play('freeze')
  }

  onRecordAdd(playerId: string, cheatType: CheatType, timestamp: number, npcId?: string): void {
    const records = this.playerRecords.get(playerId) ?? []
    records.unshift({
      id: `record_${Date.now()}_${records.length}`,
      cheatType,
      confidence: 'medium',
      timestamp,
      action: '已检测',
    })
    this.playerRecords.set(playerId, records.slice(0, 20))

    const info = this.playerDataMap.get(playerId)
    if (info) {
      info.cheatRecordCount = records.length
    }

    if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === playerId) {
      const playerInfo = this.playerDataMap.get(playerId)
      if (playerInfo) {
        this.playerDetailCard.show(playerInfo, records)
      }
    }

    // 异步从 API 获取完整记录（包含 evidence 和 vp）
    this.refreshPlayerDetail(playerId)
  }

  onPhaseChange(playerId: string, oldPhase: PlayerPhase, newPhase: PlayerPhase, reason: string, vpTotal: number, cheatType?: CheatType, npcId?: string): void {
    // 优先使用 npcId 查找 NPC 和 playerDataMap
    const effectiveNpcId = npcId ?? playerId
    const info = this.playerDataMap.get(effectiveNpcId)
    if (info) {
      info.phase = newPhase
      info.totalVP = vpTotal
      info.phaseHistory.push({ from: oldPhase, to: newPhase, timestamp: Date.now() })

      if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === effectiveNpcId) {
        const records = this.playerRecords.get(effectiveNpcId) ?? []
        this.playerDetailCard.show(info, records)
      }
    }

    // 处罚阶段：设置"封禁中"标签 + 播放动画
    // 押送由 npc_escorting 事件统一触发（从 MonitorBridge 发出）
    if (newPhase === 'punishing' && cheatType) {
      const npc = this.npcManager.get(effectiveNpcId)
      if (npc) {
        // 设置封禁中标签
        npc.setEmoji('🔒')
        npc.playAnimation('ban_animation')
      }
    }
  }

  onVPUpdate(playerId: string, totalVP: number, vpByType: Record<CheatType, number>): void {
    const info = this.playerDataMap.get(playerId)
    if (info) {
      info.totalVP = totalVP
      info.vpByType = vpByType

      if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === playerId) {
        const records = this.playerRecords.get(playerId) ?? []
        this.playerDetailCard.show(info, records)
      }
    }
  }

  onPenaltyEvent(data: { playerId: string; npcId?: string; level: string; action: string; cheatType: CheatType; confidence: Confidence; vp: number; reason: string; autoGenerated: boolean; duration?: string; bannedAt?: number }): void {
    console.log(`[MainScene] Penalty: ${data.level} for ${data.playerId} — ${data.action} (${data.cheatType})`)

    // playerId 可能是 npcId (player_XXXXXXXX) 或完整 UUID
    // 优先使用 npcId 字段（从状态同步事件中传入），再尝试直接查找，最后尝试前缀匹配
    let info: PlayerInfo | undefined
    let resolvedNpcId = data.npcId ?? data.playerId
    info = this.playerDataMap.get(resolvedNpcId)
    if (!info) {
      info = this.playerDataMap.get(data.playerId)
      if (info) resolvedNpcId = data.playerId
    }
    if (!info) {
      // 尝试在 playerDataMap 中找到匹配的条目
      for (const [npcId, playerInfo] of this.playerDataMap) {
        if (npcId.startsWith(data.playerId.slice(0, 8)) || data.playerId.startsWith(npcId.replace('player_', ''))) {
          info = playerInfo
          resolvedNpcId = npcId
          break
        }
      }
    }

    // 播放处罚音效
    this.alertSound.playBanSound()

    // 显示处罚通知（使用现有 alertPanel）
    const levelLabels: Record<string, string> = {
      L0: '警告', L1: '踢出', L2: '短期封禁', L3: '24h封禁', L4: '7天封禁', L5: '永久封禁',
    }
    const actionLabel = levelLabels[data.level] ?? data.level
    const autoLabel = data.autoGenerated ? '[自动]' : '[管理员]'
    const cheatLabels: Record<string, string> = {
      fly: '飞行', speed: '加速', kill_aura: '杀戮光环', x_ray: '透视', scaffold: '自动搭桥', auto_clicker: '自动点击', reach: '攻击距离',
    }
    const cheatLabel = cheatLabels[data.cheatType] ?? data.cheatType
    const message = `${autoLabel} ${actionLabel}: ${cheatLabel} (VP: ${data.vp.toFixed(1)})`

    // 在页面顶部显示处罚通知
    const toast = document.createElement('div')
    toast.className = `penalty-toast penalty-toast-${data.level === 'L0' ? 'warning' : 'error'}`
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 5000)

    // 添加到处罚日志面板
    this.penaltyLogPanel.addEntry({
      penaltyId: `penalty_${Date.now()}_${resolvedNpcId}`,
      playerId: resolvedNpcId,
      playerName: info?.name ?? resolvedNpcId,
      level: data.level as import('../types.js').PenaltyLevel,
      action: data.action,
      cheatType: data.cheatType,
      confidence: data.confidence,
      vp: data.vp,
      reason: data.reason,
      autoGenerated: data.autoGenerated,
      timestamp: Date.now(),
    })

    // 如果是封禁操作，更新玩家封禁状态 + 设置 detained 标志
    if (data.action === 'ban' && info) {
      const durationMap: Record<string, string> = {
        L2: '1h', L3: '24h', L4: '7d', L5: 'permanent',
      }
      info.banStatus = {
        isBanned: true,
        reason: data.reason,
        duration: data.duration ?? durationMap[data.level] ?? '24h',
        bannedAt: data.bannedAt ?? Date.now(),
        source: data.autoGenerated ? 'anticheat' : 'admin:web',
      }
      // 设置 NPC detained 标志，确保页面刷新后 NPC 保留在关押区
      const npc = this.npcManager.get(resolvedNpcId)
      if (npc) {
        npc.detained = true
        npc.setEmoji('🔒')
      }
      // 刷新详情卡
      if (this.playerDetailCard.isVisible() && this.playerDetailCard.getCurrentPlayerId() === resolvedNpcId) {
        const records = this.playerRecords.get(resolvedNpcId) ?? []
        this.playerDetailCard.show(info, records)
      }
    }
  }

  onWorldInit(config: Record<string, unknown>): void {
    if (config.maxPlayers) {
      this.statsPanel.updatePartial({ totalPlayers: config.maxPlayers as number })
    }
  }

  onSetTime(action: string, hour?: number): void {
    if (action === 'set' && hour !== undefined) {
      this.timeOfDayLighting.setTime(hour)
    }
  }

  onSetWeather(action: string, weather?: string): void {
    if (action === 'set' && weather) {
      this.weatherEffects.setWeather(weather as any)
    } else if (action === 'reset') {
      this.weatherEffects.setWeather('clear')
    }
  }

  onNpcBuildingEnter(npcId: string, buildingKey: string, stayDurationMs: number): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return
    // Pause roaming while in building
    this.npcManager.pauseRoaming(npcId)

    const info = this.playerDataMap.get(npcId)
    const isPunishing = info?.phase === 'punishing' || info?.banStatus?.isBanned || npc.detained

    if (isPunishing) {
      // 处罚中的 NPC：不隐藏模型，在建筑门外扇形区域漫游
      const doorMarker = this.townBuilder.getDoorMarker(buildingKey)
      if (doorMarker) {
        const doorPos = doorMarker.position
        npc.moveTo({ x: doorPos.x, z: doorPos.z }).then(() => {
          // 到达后开始门外扇形漫游
          this.startDetentionRoaming(npcId, doorPos.x, doorPos.z, buildingKey)
        })
      }
    } else {
      // 正常进入建筑：隐藏模型
      const doorMarker = this.townBuilder.getDoorMarker(buildingKey)
      if (doorMarker) {
        const doorPos = doorMarker.position
        npc.moveTo({ x: doorPos.x, z: doorPos.z }).then(() => {
          npc.setVisible(false)
        })
      } else {
        npc.setVisible(false)
      }
    }
    // Update detention zone state
    const playerName = info?.name ?? npcId
    this.townBuilder.addDetainedPlayer(buildingKey, playerName)
  }

  /** 处罚 NPC 在关押区建筑门外扇形区域漫游（不会进入建筑内部） */
  private startDetentionRoaming(npcId: string, doorX: number, doorZ: number, buildingKey?: string): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return

    // 计算建筑门朝向（门在建筑正面，朝向远离建筑中心的方向）
    // 建筑中心 X 坐标从 buildingKey 获取
    let doorDirX = 0  // 门朝向的 X 分量
    let doorDirZ = 1  // 门朝向的 Z 分量（默认朝 +Z，即朝外）
    if (buildingKey) {
      const bounds = this.townBuilder.getBuildingBounds(buildingKey)
      if (bounds) {
        const buildingCenterX = (bounds.minX + bounds.maxX) / 2
        const buildingCenterZ = (bounds.minZ + bounds.maxZ) / 2
        // 门朝向 = 从建筑中心指向门的方向
        const dx = doorX - buildingCenterX
        const dz = doorZ - buildingCenterZ
        const len = Math.sqrt(dx * dx + dz * dz)
        if (len > 0.01) {
          doorDirX = dx / len
          doorDirZ = dz / len
        }
      }
    }

    const RADIUS = 2.5
    const roam = () => {
      const n = this.npcManager.get(npcId)
      // 用 detained 标志而非 phase 判断，因为玩家被踢后 phase 会变为 offline
      if (!n || !n.detained) return

      // 在门前方扇形区域内随机选点（180度扇形，朝门外方向）
      const angle = (Math.random() - 0.5) * Math.PI  // -90° ~ +90°（半圆）
      const dist = 0.5 + Math.random() * (RADIUS - 0.5)  // 0.5 ~ 2.5 距离
      // 旋转门朝向角度
      const baseAngle = Math.atan2(doorDirX, doorDirZ)
      const finalAngle = baseAngle + angle
      const targetX = doorX + Math.sin(finalAngle) * dist
      const targetZ = doorZ + Math.cos(finalAngle) * dist

      // 二次碰撞检查：如果目标点仍在建筑内，重新生成
      if (this.townBuilder.isInsideBuilding(targetX, targetZ)) {
        // 退回门位置，稍后重试
        setTimeout(roam, 1000)
        return
      }

      n.moveTo({ x: targetX, z: targetZ }, 0.8).then(() => {
        // 到达后等待 2-5 秒，继续漫游
        setTimeout(roam, 2000 + Math.random() * 3000)
      })
    }
    // 首次延迟 1 秒开始
    setTimeout(roam, 1000)
  }

  onNpcBuildingLeave(npcId: string, buildingKey: string, actualStayMs: number): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return
    const doorMarker = this.townBuilder.getDoorMarker(buildingKey)
    if (doorMarker) {
      const doorPos = doorMarker.position
      npc.mesh.position.set(doorPos.x, 0, doorPos.z)
    }
    npc.setVisible(true)
    npc.restoreVisual()
    // Resume roaming after leaving building
    this.npcManager.resumeRoaming(npcId)
    // Update detention zone state
    const info = this.playerDataMap.get(npcId)
    const playerName = info?.name ?? npcId
    this.townBuilder.removeDetainedPlayer(buildingKey, playerName)
  }

  onNpcEscorting(npcId: string, buildingKey: string): void {
    const npc = this.npcManager.get(npcId)
    if (!npc) return

    // Pause roaming during escort
    this.npcManager.pauseRoaming(npcId)

    // Get door position for the building
    const doorMarker = this.townBuilder.getDoorMarker(buildingKey)
    const doorPos = doorMarker
      ? { x: doorMarker.position.x, z: doorMarker.position.z }
      : { x: 18, z: 13 }

    // Town manager escorts NPC to building, then NPC enters
    if (this.townManager) {
      this.townManager.escortNpcToBuilding(npcId, doorPos).then(() => {
        // After escort, trigger building enter
        this.onNpcBuildingEnter(npcId, buildingKey, 60_000)
      }).catch(() => {
        // Escort failed (e.g. already escorting), enter building directly
        this.onNpcBuildingEnter(npcId, buildingKey, 60_000)
      })
    } else {
      // Fallback: direct building enter
      this.onNpcBuildingEnter(npcId, buildingKey, 60_000)
    }
  }

  onNpcActivity(_npcId: string, _icon: string, _message: string, _time: string): void {}
  onNpcActivityStatus(_npcId: string, _success: boolean): void {}
  onNpcActivityStream(_npcId: string, _delta: string): void {}
  onNpcActivityStreamEnd(_npcId: string): void {}

  // ── Update loop ──

  start(): void {
    this.clock.start()
    this.animate()
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate())

    const delta = Math.min(this.clock.getDelta(), 0.1) // Cap delta to prevent large jumps

    // Update systems
    this.timeOfDayLighting.update(delta)
    this.weatherEffects.update(delta)
    this.vfxSystem.update(delta)
    this.vehicleManager.update(this.timeOfDayLighting.getGameHour(), this.timeOfDayLighting.getGameHour() < 6 || this.timeOfDayLighting.getGameHour() > 20, delta)
    this.npcManager.update(delta, this.cameraController.getCamera() as THREE.PerspectiveCamera, this.renderer)
    if (this.townManager) this.townManager.update(delta)
    this.townBuilder.update(delta)
    this.cameraController.update(delta)

    // Audio updates
    const period = this.hourToPeriod(this.timeOfDayLighting.getGameHour())
    const weather = this.weatherEffects.getWeather()
    this.bgmManager.update(delta, period)
    this.ambientSound.update(delta, weather, period)

    // Camera follow tracked player
    if (this.isFollowing && this.trackedPlayerId) {
      const npc = this.npcManager.get(this.trackedPlayerId)
      if (!npc) {
        this.cameraController.stopFollowing()
        this.isFollowing = false
        this.trackedPlayerId = null
      }
    }

    // Poll stats
    this.statsPollTimer += delta
    if (this.statsPollTimer >= this.statsPollInterval) {
      this.statsPollTimer = 0
      this.pollStats()
    }

    // Render with post-processing (sync active camera)
    this.postProcessing.updateCamera(this.cameraController.getCamera())
    this.postProcessing.render()
  }

  private async pollStats(): Promise<void> {
    try {
      const resp = await fetch(`${this.apiBase}/api/stats`)
      if (resp.ok) {
        const stats = await resp.json() as ServerStats
        this.statsPanel.update(stats)
      }
    } catch {
      // Silently ignore
    }
  }

  updateStats(stats: ServerStats): void {
    this.statsPanel.update(stats)
  }

  private hourToPeriod(hour: number): TimePeriod {
    if (hour >= 5 && hour < 7) return 'dawn'
    if (hour >= 7 && hour < 11) return 'morning'
    if (hour >= 11 && hour < 14) return 'noon'
    if (hour >= 14 && hour < 17) return 'afternoon'
    if (hour >= 17 && hour < 20) return 'dusk'
    return 'night'
  }

  dispose(): void {
    this.npcManager.destroy()
    this.vfxSystem.dispose()
    this.weatherEffects.dispose()
    this.cameraController.dispose()
    this.postProcessing.dispose()
    this.vehicleManager.dispose()
    this.renderer.dispose()
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }
}
