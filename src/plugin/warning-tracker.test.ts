import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WarningTracker } from './warning-tracker.js'

const createdDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const dir of createdDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createTracker(): WarningTracker {
  const dataDir = mkdtempSync(join(tmpdir(), 'mcacs-warning-'))
  createdDirs.push(dataDir)
  return new WarningTracker(dataDir, { warningExpiryMs: 30 * 60_000, secondOffenseBanDuration: '1h' })
}

describe('WarningTracker shared strike window', () => {
  it('shares strikes across cheat types and escalates the second signal', () => {
    const tracker = createTracker()
    const first = tracker.recordDetection('player', 'Player', 'fly', 'medium', [])
    const second = tracker.recordDetection('player', 'Player', 'reach', 'medium', [])

    expect(first).toMatchObject({ isFirstWarning: true, isSecondOffense: false, warningCount: 1 })
    expect(second).toMatchObject({ isFirstWarning: false, isSecondOffense: true, warningCount: 2 })
  })

  it('treats a signal after 30 minutes as a new first warning', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'))
    const tracker = createTracker()
    tracker.recordDetection('player', 'Player', 'fly', 'medium', [])

    vi.advanceTimersByTime(30 * 60_000 + 1)
    const afterExpiry = tracker.recordDetection('player', 'Player', 'speed', 'medium', [])

    expect(afterExpiry).toMatchObject({ isFirstWarning: true, isSecondOffense: false, warningCount: 1 })
  })
})
