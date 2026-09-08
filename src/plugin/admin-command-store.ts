import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ActionType } from '../contracts/index.js'

export const ADMIN_COMMAND_TYPES = [
  'warning',
] as const satisfies readonly ActionType[]

export type AdminCommandType = typeof ADMIN_COMMAND_TYPES[number]
export type AdminCommandStatus = 'accepted' | 'sent' | 'succeeded' | 'failed' | 'unknown'

export interface AdminCommandInput {
  requestId: string
  serverId: string
  type: AdminCommandType
  playerId: string
  caseId?: string
  reason?: string
  duration?: string
}

export interface AdminCommand extends AdminCommandInput {
  commandId: string
  status: AdminCommandStatus
  createdAt: number
  updatedAt: number
  result?: string
}

export class CommandRequestConflictError extends Error {}

export class AdminCommandStore {
  private readonly filePath: string
  private readonly now: () => number
  private commands: AdminCommand[] = []

  constructor(dataDir: string, now: () => number = Date.now) {
    mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'admin-commands.json')
    this.now = now
    this.load()
  }

  create(input: AdminCommandInput): { command: AdminCommand; created: boolean } {
    const existing = this.commands.find(command => command.requestId === input.requestId)
    if (existing) {
      if (!this.sameRequest(existing, input)) {
        throw new CommandRequestConflictError(`requestId '${input.requestId}' was already used`)
      }
      return { command: structuredClone(existing), created: false }
    }

    const timestamp = this.now()
    const command: AdminCommand = {
      ...input,
      commandId: `cmd-${randomUUID()}`,
      status: 'accepted',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.commands.push(command)
    this.save()
    return { command: structuredClone(command), created: true }
  }

  get(commandId: string): AdminCommand | undefined {
    const command = this.commands.find(item => item.commandId === commandId)
    return command ? structuredClone(command) : undefined
  }

  list(limit: number = 100): AdminCommand[] {
    return this.commands.slice(-Math.max(1, limit)).reverse().map(command => structuredClone(command))
  }

  markSent(commandId: string): void {
    this.update(commandId, 'sent')
  }

  markSucceeded(commandId: string, result?: string): void {
    this.update(commandId, 'succeeded', result)
  }

  markFailed(commandId: string, result?: string): void {
    this.update(commandId, 'failed', result)
  }

  private update(commandId: string, status: AdminCommandStatus, result?: string): void {
    const command = this.commands.find(item => item.commandId === commandId)
    if (!command || command.status === 'succeeded' || command.status === 'failed' || command.status === 'unknown') return
    command.status = status
    command.updatedAt = this.now()
    if (result) command.result = result
    this.save()
  }

  private sameRequest(command: AdminCommand, input: AdminCommandInput): boolean {
    return command.serverId === input.serverId
      && command.type === input.type
      && command.playerId === input.playerId
      && command.caseId === input.caseId
      && command.reason === input.reason
      && command.duration === input.duration
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown
      if (Array.isArray(parsed)) {
        this.commands = parsed as AdminCommand[]
        let changed = false
        for (const command of this.commands) {
          if (command.status === 'accepted' || command.status === 'sent') {
            command.status = 'unknown'
            command.result = 'Engine restarted before final acknowledgement'
            command.updatedAt = this.now()
            changed = true
          }
        }
        if (changed) this.save()
      }
    } catch (err) {
      console.warn('[AdminCommandStore] Failed to load commands:', err)
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.commands, null, 2), 'utf-8')
  }
}
