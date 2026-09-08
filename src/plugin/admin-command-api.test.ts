import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { WsServer } from './ws-server.js'
import { ActionDispatcher } from './action-dispatcher.js'
import { AdminCommandStore } from './admin-command-store.js'
import { EditorServe } from './editor-serve.js'

function createReply() {
  const state: { status: number; body?: unknown } = { status: 200 }
  const reply = {
    code(status: number) {
      state.status = status
      return this
    },
    type() {
      return this
    },
    send(body: unknown) {
      state.body = body
      return this
    },
  } as unknown as FastifyReply
  return { reply, state }
}

describe('admin command API', () => {
  let dataDir: string | undefined

  afterEach(() => {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
    dataDir = undefined
  })

  it('submits an idempotent command and exposes its persisted status', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'mcacs-command-api-test-'))
    const store = new AdminCommandStore(dataDir)
    const sendToSpigot = vi.fn(() => true)
    const dispatcher = new ActionDispatcher({ sendToSpigot } as unknown as WsServer, {
      onStatus: (actionId, status, result) => {
        if (status === 'delivered') store.markSent(actionId)
        if (status === 'executed') store.markSucceeded(actionId, result)
        if (status === 'failed') store.markFailed(actionId, result)
      },
    })
    const serve = new EditorServe({
      banManager: {},
      playerTracker: {},
      recordStore: {},
      actionDispatcher: dispatcher,
      adminCommandStore: store,
    } as never)
    const handleApi = (serve as unknown as {
      handleApi(request: FastifyRequest, reply: FastifyReply): Promise<void>
    }).handleApi.bind(serve)
    const body = {
      requestId: 'request-1',
      serverId: 'main-server',
      type: 'warning',
      playerId: '00000000-0000-0000-0000-000000000001',
      reason: 'MVP verification',
    }

    const first = createReply()
    await handleApi({ url: '/api/v1/commands', method: 'POST', body } as FastifyRequest, first.reply)
    expect(first.state.status).toBe(202)
    expect(first.state.body).toMatchObject({ command: { status: 'sent' }, duplicate: false })
    expect(sendToSpigot).toHaveBeenCalledOnce()

    const retry = createReply()
    await handleApi({ url: '/api/v1/commands', method: 'POST', body } as FastifyRequest, retry.reply)
    expect(retry.state.status).toBe(200)
    expect(retry.state.body).toMatchObject({ command: { status: 'sent' }, duplicate: true })
    expect(sendToSpigot).toHaveBeenCalledOnce()

    const commandId = (first.state.body as { command: { commandId: string } }).command.commandId
    dispatcher.ack(commandId, 'Warning sent')
    const get = createReply()
    await handleApi({ url: `/api/v1/commands/${commandId}`, method: 'GET' } as FastifyRequest, get.reply)
    expect(get.state.body).toMatchObject({ status: 'succeeded', result: 'Warning sent' })
  })
})
