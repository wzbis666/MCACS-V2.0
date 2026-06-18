// NpcRoaming — simplified random roaming for anti-cheat NPCs
// Inspired by agentshire's DailyBehavior, but much simpler:
// idle → walking → idle loop with random waypoints in the town plaza.

import * as THREE from 'three'
import type { NPC } from './NPC.js'
import type { NPCManager } from './NPCManager.js'

const WAYPOINTS = [
  { x: 18, z: 13 },   // plaza center / fountain
  { x: 15, z: 11 },   // plaza side A
  { x: 21, z: 11 },   // plaza side B
  { x: 15, z: 15 },   // plaza side C
  { x: 21, z: 15 },   // plaza side D
  { x: 18, z: 22.5 }, // road crossing
  { x: 8, z: 12 },    // sidewalk left
  { x: 28, z: 12 },   // sidewalk right
  { x: 10, z: 6 },    // near left buildings
  { x: 26, z: 6 },    // near right buildings
  { x: 18, z: 8 },    // mid plaza north
  { x: 18, z: 18 },   // mid plaza south
]

const IDLE_MIN_MS = 3000
const IDLE_MAX_MS = 8000
const WALK_SPEED = 2.0
const ARRIVAL_THRESHOLD = 0.3
const STUCK_TIMEOUT_MS = 15_000
const POSITION_JITTER = 1.5

type RoamingState = 'idle' | 'walking' | 'paused'

export class NpcRoaming {
  private npc: NPC
  private npcId: string
  private npcManager: NPCManager | null
  private state: RoamingState = 'idle'
  private idleTimer = 0
  private idleDuration = 0
  private walkToken = 0
  private stuckTimer = 0
  private paused = false

  constructor(npc: NPC, npcManager?: NPCManager) {
    this.npc = npc
    this.npcId = npc.npcId
    this.npcManager = npcManager ?? null
    this.pickNextIdleDuration()
  }

  pause(): void {
    this.paused = true
    this.state = 'paused'
    this.walkToken++
  }

  resume(): void {
    this.paused = false
    this.state = 'idle'
    this.idleTimer = 0
    this.pickNextIdleDuration()
  }

  isWalking(): boolean {
    return this.state === 'walking'
  }

  update(dt: number): void {
    if (this.paused) return

    const dtMs = dt * 1000

    switch (this.state) {
      case 'idle':
        this.idleTimer += dtMs
        if (this.idleTimer >= this.idleDuration) {
          this.startWalking()
        }
        break

      case 'walking':
        this.stuckTimer += dtMs
        if (this.stuckTimer > STUCK_TIMEOUT_MS) {
          this.recoverFromStuck()
        }
        break
    }
  }

  private startWalking(): void {
    let wp = this.pickRandomWaypoint()
    // NPC 间碰撞避免：如果目标点与其他 NPC 太近，使用非重叠位置
    if (this.npcManager) {
      wp = this.npcManager.findNonOverlappingPosition(wp.x, wp.z, this.npcId)
    }
    const token = ++this.walkToken
    this.state = 'walking'
    this.stuckTimer = 0

    this.npc.moveTo({ x: wp.x, z: wp.z }, WALK_SPEED).then((status) => {
      if (this.walkToken !== token || this.paused) return
      if (status === 'arrived') {
        this.state = 'idle'
        this.idleTimer = 0
        this.pickNextIdleDuration()
      }
    })
  }

  private pickRandomWaypoint(): { x: number; z: number } {
    const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)]
    return {
      x: wp.x + (Math.random() - 0.5) * POSITION_JITTER,
      z: wp.z + (Math.random() - 0.5) * POSITION_JITTER,
    }
  }

  private pickNextIdleDuration(): void {
    this.idleDuration = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS)
  }

  private recoverFromStuck(): void {
    this.walkToken++
    this.state = 'idle'
    this.idleTimer = 0
    this.pickNextIdleDuration()
    this.stuckTimer = 0
  }
}
