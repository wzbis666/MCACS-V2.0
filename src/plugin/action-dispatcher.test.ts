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
})
