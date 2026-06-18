import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { RecordStore } from './record-store.js'
import type { CheatRecord } from '../contracts/index.js'

function makeRecord(playerId: string, timestamp: number): CheatRecord {
  return {
    id: `${playerId}-${timestamp}`,
    playerId,
    playerName: playerId,
    cheatType: 'fly',
    confidence: 'low',
    evidence: [],
    action: 'detect',
    actionResult: 'recorded',
    timestamp,
  }
}

describe('RecordStore', () => {
  it('returns distinct appended records when querying by playerId', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-record-store-'))
    const store = new RecordStore(path.join(testDir, 'records.jsonl'))

    store.append(makeRecord('player1', 1))
    store.append(makeRecord('player1', 2))

    expect(store.query({ playerId: 'player1' }).map(record => record.timestamp)).toEqual([2, 1])
    store.close()
  })

  it('keeps indexed queries correct after cache is loaded', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-record-store-'))
    const store = new RecordStore(path.join(testDir, 'records.jsonl'))

    store.append(makeRecord('player1', 1))
    store.getAllRecords()
    store.append(makeRecord('player1', 2))

    expect(store.query({ playerId: 'player1' }).map(record => record.timestamp)).toEqual([2, 1])
    store.close()
  })

  it('imports existing JSONL records into SQLite on first start', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-record-store-'))
    const filePath = path.join(testDir, 'records.jsonl')
    fs.writeFileSync(filePath, `${JSON.stringify(makeRecord('player1', 1))}\n${JSON.stringify(makeRecord('player2', 2))}\n`)

    const store = new RecordStore(filePath)

    expect(store.query({ playerId: 'player2' }).map(record => record.timestamp)).toEqual([2])
    expect(store.count({})).toBe(2)
    store.close()
  })

  it('persists appended records through the SQLite query store', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-record-store-'))
    const filePath = path.join(testDir, 'records.jsonl')
    const store = new RecordStore(filePath)

    store.append(makeRecord('player1', 1))
    store.append(makeRecord('player1', 2))
    store.close()

    const reloadedStore = new RecordStore(filePath)
    expect(reloadedStore.query({ playerId: 'player1' }).map(record => record.timestamp)).toEqual([2, 1])
    reloadedStore.close()
  })
})
