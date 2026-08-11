import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InvestigationCaseManager } from './investigation-case-manager.js'

describe('InvestigationCaseManager', () => {
  let dataDir: string | undefined

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  function createManager(): InvestigationCaseManager {
    dataDir = mkdtempSync(join(tmpdir(), 'acs-case-test-'))
    return new InvestigationCaseManager(dataDir)
  }

  it('keeps low-confidence signals out of the review queue', () => {
    const manager = createManager()
    const result = manager.recordDetection({
      playerId: 'player-1',
      playerName: 'Steve',
      cheatType: 'speed',
      confidence: 'low',
      evidence: [],
      timestamp: 100,
    })

    expect(result).toBeNull()
    expect(manager.getPendingCases()).toHaveLength(0)
  })

  it('aggregates independent signals into one higher-risk player case', () => {
    const manager = createManager()
    manager.recordDetection({
      playerId: 'player-1',
      playerName: 'Steve',
      cheatType: 'fly',
      confidence: 'high',
      evidence: [],
      timestamp: 100,
    })
    const update = manager.recordDetection({
      playerId: 'player-1',
      playerName: 'Steve',
      cheatType: 'speed',
      confidence: 'high',
      evidence: [],
      timestamp: 200,
    })

    expect(update?.created).toBe(false)
    expect(manager.getPendingCases()).toHaveLength(1)
    expect(update?.investigationCase.suspectedCheats).toEqual(['fly', 'speed'])
    expect(update?.investigationCase.riskLevel).toBe('critical')
  })

  it('persists review decisions across restarts', () => {
    const manager = createManager()
    const update = manager.recordDetection({
      playerId: 'player-1',
      playerName: 'Steve',
      cheatType: 'x_ray',
      confidence: 'medium',
      evidence: [],
      timestamp: 100,
    })!

    manager.reviewCase(update.investigationCase.id, 'dismiss', 'admin', 'legitimate cave mining')
    const reloaded = new InvestigationCaseManager(dataDir!)

    expect(reloaded.getCases('dismissed')).toHaveLength(1)
    expect(reloaded.getCases('dismissed')[0].reviewNote).toBe('legitimate cave mining')
  })

  it('reports review quality by case and detector', () => {
    let now = 1_000
    dataDir = mkdtempSync(join(tmpdir(), 'acs-case-test-'))
    const manager = new InvestigationCaseManager(dataDir, () => now)
    const confirmed = manager.recordDetection({
      playerId: 'player-1', playerName: 'Steve', cheatType: 'fly', confidence: 'high', evidence: [], timestamp: now,
    })!
    now += 5_000
    manager.reviewCase(confirmed.investigationCase.id, 'confirm', 'admin')
    const dismissed = manager.recordDetection({
      playerId: 'player-2', playerName: 'Alex', cheatType: 'fly', confidence: 'medium', evidence: [], timestamp: now,
    })!
    now += 15_000
    manager.reviewCase(dismissed.investigationCase.id, 'dismiss', 'admin')

    expect(manager.getQualityMetrics()).toMatchObject({
      reviewedCases: 2,
      confirmationRate: 0.5,
      dismissalRate: 0.5,
      averageHandlingTimeMs: 10_000,
      byDetector: { fly: { reviewedCases: 2, confirmationRate: 0.5 } },
    })
  })

  it('keeps active cases but expires resolved medium and high risk cases at different ages', () => {
    let now = 10_000
    dataDir = mkdtempSync(join(tmpdir(), 'acs-case-test-'))
    const manager = new InvestigationCaseManager(dataDir, () => now)
    const medium = manager.recordDetection({
      playerId: 'medium', playerName: 'Medium', cheatType: 'speed', confidence: 'medium', evidence: [], timestamp: now,
    })!
    manager.reviewCase(medium.investigationCase.id, 'dismiss', 'admin')
    const high = manager.recordDetection({
      playerId: 'high', playerName: 'High', cheatType: 'x_ray', confidence: 'high', evidence: [], timestamp: now,
    })!
    manager.reviewCase(high.investigationCase.id, 'confirm', 'admin')
    manager.recordDetection({
      playerId: 'active', playerName: 'Active', cheatType: 'fly', confidence: 'medium', evidence: [], timestamp: now,
    })

    now += 8 * 24 * 60 * 60 * 1000
    expect(new Set(manager.getCases().map(item => item.playerId))).toEqual(new Set(['active', 'high']))
    now += 23 * 24 * 60 * 60 * 1000
    expect(manager.getCases().map(item => item.playerId)).toEqual(['active'])
  })
})
