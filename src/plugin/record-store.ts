import Database from 'better-sqlite3'
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CheatRecord, RecordsQuery } from '../contracts/index.js'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

interface RecordRow {
  id: string
  playerId: string
  playerName: string
  cheatType: CheatRecord['cheatType']
  confidence: CheatRecord['confidence']
  evidence: string
  action: string
  actionResult: string
  timestamp: number
}

export class RecordStore {
  private filePath: string
  private dbPath: string
  private db: Database.Database

  constructor(filePath: string, dbPath?: string) {
    this.filePath = filePath
    this.dbPath = dbPath ?? RecordStore.deriveDbPath(filePath)

    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (!existsSync(filePath)) {
      appendFileSync(filePath, '')
    }

    this.db = new Database(this.dbPath)
    this.initDatabase()
    this.importAuditLogIfEmpty()
  }

  append(record: CheatRecord): void {
    this.rotateIfNeeded()
    appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf-8')
    this.insertRecord(record)
  }

  query(filter: RecordsQuery): CheatRecord[] {
    const where: string[] = []
    const params: Record<string, unknown> = {}

    if (filter.playerId) {
      where.push('playerId = @playerId')
      params.playerId = filter.playerId
    }
    if (filter.cheatType) {
      where.push('cheatType = @cheatType')
      params.cheatType = filter.cheatType
    }
    if (filter.from !== undefined) {
      where.push('timestamp >= @from')
      params.from = filter.from
    }
    if (filter.to !== undefined) {
      where.push('timestamp <= @to')
      params.to = filter.to
    }

    const limit = filter.limit && filter.limit > 0 ? Math.floor(filter.limit) : null
    if (limit) {
      params.limit = limit
    }

    const sql = [
      'SELECT id, playerId, playerName, cheatType, confidence, evidence, action, actionResult, timestamp',
      'FROM cheat_records',
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
      'ORDER BY timestamp DESC',
      limit ? 'LIMIT @limit' : '',
    ].filter(Boolean).join(' ')

    const rows = this.db.prepare(sql).all(params) as RecordRow[]
    return rows.map(row => this.rowToRecord(row))
  }

  count(filter: RecordsQuery): number {
    const where: string[] = []
    const params: Record<string, unknown> = {}

    if (filter.playerId) {
      where.push('playerId = @playerId')
      params.playerId = filter.playerId
    }
    if (filter.cheatType) {
      where.push('cheatType = @cheatType')
      params.cheatType = filter.cheatType
    }
    if (filter.from !== undefined) {
      where.push('timestamp >= @from')
      params.from = filter.from
    }
    if (filter.to !== undefined) {
      where.push('timestamp <= @to')
      params.to = filter.to
    }

    const sql = [
      'SELECT COUNT(*) AS count',
      'FROM cheat_records',
      where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    ].filter(Boolean).join(' ')

    const row = this.db.prepare(sql).get(params) as { count: number }
    return row.count
  }

  /** 获取所有记录（用于统计） */
  getAllRecords(): CheatRecord[] {
    return this.query({})
  }

  /** 从 JSONL 审计日志重建 SQLite 查询库 */
  rebuildIndex(): void {
    this.db.prepare('DELETE FROM cheat_records').run()
    const records = this.loadAllFromFile()
    this.importRecords(records)
    console.log(`[RecordStore] SQLite index rebuilt: ${records.length} records`)
  }

  close(): void {
    this.db.close()
  }

  private static deriveDbPath(filePath: string): string {
    return filePath.endsWith('.jsonl')
      ? filePath.replace(/\.jsonl$/i, '.sqlite')
      : `${filePath}.sqlite`
  }

  private initDatabase(): void {
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cheat_records (
        id TEXT PRIMARY KEY,
        playerId TEXT NOT NULL,
        playerName TEXT NOT NULL,
        cheatType TEXT NOT NULL,
        confidence TEXT NOT NULL,
        evidence TEXT NOT NULL,
        action TEXT NOT NULL,
        actionResult TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cheat_records_player_time
        ON cheat_records (playerId, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cheat_records_type_time
        ON cheat_records (cheatType, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cheat_records_time
        ON cheat_records (timestamp DESC);
    `)
  }

  private importAuditLogIfEmpty(): void {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM cheat_records').get() as { count: number }
    if (row.count > 0) return

    const records = this.loadAllFromFile()
    if (records.length === 0) return

    this.importRecords(records)
    console.log(`[RecordStore] Imported ${records.length} audit records into SQLite`)
  }

  private importRecords(records: CheatRecord[]): void {
    const insertMany = this.db.transaction((batch: CheatRecord[]) => {
      for (const record of batch) {
        this.insertRecord(record)
      }
    })
    insertMany(records)
  }

  private insertRecord(record: CheatRecord): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO cheat_records (
        id,
        playerId,
        playerName,
        cheatType,
        confidence,
        evidence,
        action,
        actionResult,
        timestamp
      ) VALUES (
        @id,
        @playerId,
        @playerName,
        @cheatType,
        @confidence,
        @evidence,
        @action,
        @actionResult,
        @timestamp
      )
    `).run({
      id: record.id,
      playerId: record.playerId,
      playerName: record.playerName,
      cheatType: record.cheatType,
      confidence: record.confidence,
      evidence: JSON.stringify(record.evidence),
      action: record.action,
      actionResult: record.actionResult,
      timestamp: record.timestamp,
    })
  }

  private rowToRecord(row: RecordRow): CheatRecord {
    return {
      id: row.id,
      playerId: row.playerId,
      playerName: row.playerName,
      cheatType: row.cheatType,
      confidence: row.confidence,
      evidence: this.parseEvidence(row.evidence),
      action: row.action,
      actionResult: row.actionResult,
      timestamp: row.timestamp,
    }
  }

  private parseEvidence(value: string): CheatRecord['evidence'] {
    try {
      return JSON.parse(value) as CheatRecord['evidence']
    } catch {
      return []
    }
  }

  private loadAllFromFile(): CheatRecord[] {
    if (!existsSync(this.filePath)) return []

    const content = readFileSync(this.filePath, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim().length > 0)

    const records: CheatRecord[] = []
    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as CheatRecord)
      } catch {
        // skip malformed lines
      }
    }

    return records
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath)) return

    try {
      const stats = statSync(this.filePath)
      if (stats.size >= MAX_FILE_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const rotatedPath = this.filePath.replace(/\.jsonl$/, `-${timestamp}.jsonl`)
        renameSync(this.filePath, rotatedPath)
        appendFileSync(this.filePath, '')
      }
    } catch {
      // if we can't stat the file, just continue
    }
  }
}
