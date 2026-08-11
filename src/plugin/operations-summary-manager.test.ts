import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationsSummaryManager } from './operations-summary-manager.js'

describe('OperationsSummaryManager', () => {
  let dataDir: string | undefined

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  function createManager(now: () => number): OperationsSummaryManager {
    dataDir = mkdtempSync(join(tmpdir(), 'acs-operations-test-'))
    return new OperationsSummaryManager(dataDir, now)
  }

  it('summarizes activity since the administrator last acknowledged the dashboard', () => {
    let now = 1_000_000
    const manager = createManager(() => now)
    manager.recordSnapshot(3, 19.6)
    now += 60_000
    manager.recordSnapshot(7, 17.4)
    manager.recordCaseOpened()
    manager.recordAutomaticMeasure()

    const summary = manager.getOfflineSummary(now + 5_000)
    expect(summary.onlinePeak).toBe(7)
    expect(summary.minTps).toBe(17.4)
    expect(summary.casesOpened).toBe(1)
    expect(summary.automaticMeasures).toBe(1)
    expect(summary.hasImportantActivity).toBe(true)
  })

  it('persists the last viewed boundary and starts a clean next shift', () => {
    let now = 2_000_000
    const manager = createManager(() => now)
    manager.recordCaseOpened()
    now += 120_000
    manager.acknowledgeViewed()

    const reloaded = new OperationsSummaryManager(dataDir!, () => now)
    expect(reloaded.getLastViewedAt()).toBe(now)
    expect(reloaded.getOfflineSummary()).toMatchObject({ casesOpened: 0, automaticMeasures: 0 })
  })
})
