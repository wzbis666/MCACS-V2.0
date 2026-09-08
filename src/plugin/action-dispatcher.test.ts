import { describe, expect, it, vi } from 'vitest'
import type { WsServer } from './ws-server.js'
import { ActionDispatcher } from './action-dispatcher.js'

function createWsServer(): WsServer {
  return {
    sendToSpigot: vi.fn(() => true),
  } as unknown as WsServer
}

describe('ActionDispatcher', () => {
  it('does not confirm a penalty when a regular action is acknowledged', () => {
    const onAck = vi.fn()
    const dispatcher = new ActionDispatcher(createWsServer(), { onAck })

    dispatcher.dispatch({
      type: 'vp_update',
      actionId: 'vp-1',
      playerId: 'player-1',
      totalVP: 12,
    })
    dispatcher.ack('vp-1')

    expect(onAck).not.toHaveBeenCalled()
    expect(dispatcher.getPendingCount()).toBe(0)
  })

  it('tracks queued, delivered, and executed action states', () => {
    const dispatcher = new ActionDispatcher(createWsServer())
    dispatcher.dispatch({ type: 'kick', actionId: 'kick-1', playerId: 'player-1' })
    expect(dispatcher.getActionAudit()[0].status).toBe('delivered')
    dispatcher.ack('kick-1')
    expect(dispatcher.getActionAudit()[0].status).toBe('executed')
  })

  it('confirms a penalty only when its primary action is acknowledged', () => {
    const onAck = vi.fn()
    const dispatcher = new ActionDispatcher(createWsServer(), { onAck })

    dispatcher.dispatch({
      type: 'ban',
      actionId: 'ban-1',
      playerId: 'player-1',
      reason: 'confirmed cheat',
      duration: '1h',
    }, 'penalty-1')
    dispatcher.ack('ban-1')

    expect(onAck).toHaveBeenCalledOnce()
    expect(onAck).toHaveBeenCalledWith('ban-1', 'player-1')
  })

  it('reports delivery and final execution states to persistent command tracking', () => {
    const onStatus = vi.fn()
    const dispatcher = new ActionDispatcher(createWsServer(), { onStatus })

    dispatcher.dispatch({ type: 'warning', actionId: 'cmd-1', playerId: 'player-1' })
    dispatcher.ack('cmd-1', 'Warning sent')

    expect(onStatus.mock.calls).toEqual([
      ['cmd-1', 'queued'],
      ['cmd-1', 'delivered'],
      ['cmd-1', 'executed', 'Warning sent'],
    ])
  })

  it('reports failure after the final rejected attempt', () => {
    const onStatus = vi.fn()
    const dispatcher = new ActionDispatcher(createWsServer(), { maxAttempts: 1, onStatus })

    dispatcher.dispatch({ type: 'kick', actionId: 'cmd-1', playerId: 'player-1' })
    dispatcher.nack('cmd-1', 'Player not found')

    expect(dispatcher.getActionAudit()[0].status).toBe('failed')
    expect(onStatus).toHaveBeenLastCalledWith('cmd-1', 'failed', 'Player not found')
  })
})
