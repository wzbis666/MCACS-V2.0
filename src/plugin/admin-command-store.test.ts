import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AdminCommandStore, CommandRequestConflictError } from './admin-command-store.js'

describe('AdminCommandStore', () => {
  let dataDir: string | undefined

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = undefined
  })

  function createStore(): AdminCommandStore {
    dataDir = mkdtempSync(join(tmpdir(), 'mcacs-command-test-'))
    return new AdminCommandStore(dataDir, () => 1_000)
  }

  it('persists a command and restores it after restart', () => {
    const store = createStore()
    const created = store.create({
      requestId: 'request-1',
      serverId: 'main-server',
      type: 'warning',
      playerId: 'player-1',
      reason: 'MVP verification',
    }).command
    store.markSent(created.commandId)
    store.markSucceeded(created.commandId, 'Warning sent')

    const restored = new AdminCommandStore(dataDir!)
    expect(restored.get(created.commandId)).toMatchObject({
      requestId: 'request-1',
      status: 'succeeded',
      result: 'Warning sent',
    })
  })

  it('returns the original command for an identical retry', () => {
    const store = createStore()
    const input = {
      requestId: 'request-1',
      serverId: 'main-server',
      type: 'warning' as const,
      playerId: 'player-1',
      reason: 'Confirmed case',
    }
    const first = store.create(input)
    const retried = store.create(input)

    expect(first.created).toBe(true)
    expect(retried.created).toBe(false)
    expect(retried.command.commandId).toBe(first.command.commandId)
  })

  it('marks an unfinished command unknown after engine restart', () => {
    const store = createStore()
    const command = store.create({
      requestId: 'request-1',
      serverId: 'main-server',
      type: 'warning',
      playerId: 'player-1',
    }).command
    store.markSent(command.commandId)

    const restored = new AdminCommandStore(dataDir!, () => 2_000)
    expect(restored.get(command.commandId)).toMatchObject({
      status: 'unknown',
      updatedAt: 2_000,
      result: 'Engine restarted before final acknowledgement',
    })
  })

  it('rejects requestId reuse with different command data', () => {
    const store = createStore()
    store.create({ requestId: 'request-1', serverId: 'main-server', type: 'warning', playerId: 'player-1' })

    expect(() => store.create({
      requestId: 'request-1',
      serverId: 'main-server',
      type: 'warning',
      playerId: 'player-1',
      reason: 'Different request data',
    })).toThrow(CommandRequestConflictError)
  })
})
