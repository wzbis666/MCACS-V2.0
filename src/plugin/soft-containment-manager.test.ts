import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InvestigationCaseManager } from './investigation-case-manager.js'
import { SoftContainmentManager } from './soft-containment-manager.js'

describe('SoftContainmentManager', () => {
  let dataDir: string | undefined
  afterEach(() => { if (dataDir) rmSync(dataDir, { recursive: true, force: true }) })

  it('only kicks on dual-high independent evidence and applies 10/30 minute cooldowns', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'acs-soft-test-'))
    const cases = new InvestigationCaseManager(dataDir)
    const soft = new SoftContainmentManager(dataDir)
    const first = cases.recordDetection({ playerId: 'p', playerName: 'Steve', cheatType: 'fly', confidence: 'high', evidence: [], timestamp: 1_000 })!
    expect(soft.evaluate(first.investigationCase, 1_000)).toBeNull()
    const critical = cases.recordDetection({ playerId: 'p', playerName: 'Steve', cheatType: 'speed', confidence: 'high', evidence: [], timestamp: 2_000 })!
    const decision = soft.evaluate(critical.investigationCase, 2_000)!
    expect(decision.action.type).toBe('kick')
    expect(decision.cooldownUntil).toBe(2_000 + 10 * 60_000)
    expect(soft.evaluate(critical.investigationCase, 3_000)).toBeNull()
    const repeated = soft.evaluate(critical.investigationCase, decision.cooldownUntil + 1)!
    expect(repeated.repeat).toBe(true)
    expect(repeated.cooldownUntil).toBe(decision.cooldownUntil + 1 + 30 * 60_000)
  })
})
