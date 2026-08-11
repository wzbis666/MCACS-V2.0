import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertManager } from './alert-manager.js'

describe('AlertManager', () => {
  afterEach(() => vi.useRealTimers())

  it('merges repeated player and detector alerts for one minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const manager = new AlertManager()
    manager.addAlert('player-1', 'speed', 'medium', 'medium signal')
    vi.advanceTimersByTime(45_000)
    const merged = manager.addAlert('player-1', 'speed', 'high', 'high signal')

    expect(manager.getActiveAlerts()).toHaveLength(1)
    expect(merged).toMatchObject({
      created: false,
      confidenceRaised: true,
      alert: { count: 2, confidence: 'high', message: 'high signal' },
    })
  })

  it('keeps alerts from different detectors separate', () => {
    const manager = new AlertManager()
    manager.addAlert('player-1', 'speed', 'medium', 'speed')
    manager.addAlert('player-1', 'fly', 'medium', 'fly')
    expect(manager.getActiveAlerts()).toHaveLength(2)
  })
})
