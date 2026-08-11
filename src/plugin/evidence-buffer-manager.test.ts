import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceBufferManager, type EvidenceContext } from './evidence-buffer-manager.js'

const context: EvidenceContext = { tps: 19.8, ping: 42, statusEffects: ['speed:1'], exemptions: [] }

describe('EvidenceBufferManager', () => {
  let dataDir: string | undefined
  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  function createManager(): EvidenceBufferManager {
    dataDir = mkdtempSync(join(tmpdir(), 'acs-evidence-test-'))
    return new EvidenceBufferManager(dataDir)
  }

  it('samples ordinary movement every three events and every event while investigating', () => {
    const manager = createManager()
    for (let i = 1; i <= 6; i++) {
      manager.recordMovement('player-1', { x: i, y: 64, z: 0, vx: 0, vy: 0, vz: 0, onGround: true }, context, i * 50)
    }
    manager.setInvestigating('player-1', true)
    for (let i = 7; i <= 9; i++) {
      manager.recordMovement('player-1', { x: i, y: 64, z: 0, vx: 0, vy: 0, vz: 0, onGround: true }, context, i * 50)
    }
    const snapshot = manager.beginCase('case-1', 'player-1', 500)
    expect(snapshot.events).toHaveLength(5)
  })

  it('persists the pre-window and finalizes the five second post-window', () => {
    const manager = createManager()
    manager.recordEvent('player-1', { type: 'action', action: 'sprint', state: true, timestamp: 10_000, ...context })
    manager.beginCase('case-1', 'player-1', 12_000)
    manager.recordEvent('player-1', { type: 'block', action: 'place', blockType: 'stone', speed: 1, timestamp: 16_000, ...context })
    manager.recordEvent('player-1', { type: 'action', action: 'sneak', state: true, timestamp: 17_100, ...context })

    const snapshot = manager.getCaseEvidence('case-1', 17_100)
    expect(snapshot).toMatchObject({ complete: true, windowStart: -8_000, windowEnd: 17_000 })
    expect(snapshot?.events.map(event => event.type)).toEqual(['action', 'block'])
    expect(snapshot?.byteSize).toBeLessThanOrEqual(100 * 1024)

    const reloaded = new EvidenceBufferManager(dataDir!)
    expect(reloaded.getCaseEvidence('case-1')?.events).toHaveLength(2)
  })
})
