import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PenaltyEngine } from './penalty-engine.js'
import { VPManager } from './vp-manager.js'

describe('PenaltyEngine', () => {
  let dataDir: string | undefined
  let vpManager: VPManager | undefined

  afterEach(() => {
    vpManager?.destroy()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('records and resets VP only after a verified penalty is dispatched and acknowledged', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acs-penalty-test-'))
    vpManager = new VPManager(dataDir, { newPlayerGraceMinutes: 0 })
    const engine = new PenaltyEngine(vpManager)

    const result = engine.evaluate('player-1', 'TestPlayer', 'fly', 'high')

    expect(result.triggered).toBe(true)
    expect(vpManager.getPenaltyHistory('player-1')).toHaveLength(0)

    engine.markPenaltyDispatched(result)
    expect(vpManager.getPenaltyHistory('player-1')).toHaveLength(1)

    engine.onPenaltyConfirmed('player-1')
    expect(vpManager.getTotalVP('player-1')).toBe(3)
  })
})
