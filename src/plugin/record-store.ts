import { appendFileSync, existsSync, readFileSync, renameSync, statSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CheatRecord, RecordsQuery } from '../contracts/index.js'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export class RecordStore {
  private filePath: string
  // 内存索引：playerId → 文件行号偏移列表
  private playerIndex = new Map<string, number[]>()
  // 缓存最近查询的记录（避免重复读取文件）
  private cache: CheatRecord[] | null = null
  private cacheLineCount = 0

  constructor(filePath: string) {
    this.filePath = filePath
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    if (!existsSync(filePath)) {
      appendFileSync(filePath, '')
    }
  }

  append(record: CheatRecord): void {
    this.rotateIfNeeded()
    const line = JSON.stringify(record) + '\n'
    appendFileSync(this.filePath, line, 'utf-8')
    // 更新缓存
    if (this.cache) {
      this.cache.push(record)
    }
    // 更新索引（使用数组索引而非行号）
    this.addToIndex(record.playerId, this.cache ? this.cache.length - 1 : 0)
    if (this.cache) {
      this.cacheLineCount++
    }
  }

  query(filter: RecordsQuery): CheatRecord[] {
    // 如果按 playerId 查询且有索引，优先使用索引
    if (filter.playerId && this.playerIndex.has(filter.playerId)) {
      return this.queryWithIndex(filter)
    }

    // 回退到全文件扫描
    return this.queryFullScan(filter)
  }

  count(filter: RecordsQuery): number {
    return this.query(filter).length
  }

  /** 获取所有记录（用于统计） */
  getAllRecords(): CheatRecord[] {
    if (this.cache) return this.cache
    this.cache = this.loadAllFromFile()
    return this.cache
  }

  /** 重建索引 */
  rebuildIndex(): void {
    this.playerIndex.clear()
    this.cache = null
    const records = this.loadAllFromFile()
    this.cache = records
    this.cacheLineCount = records.length

    for (let i = 0; i < records.length; i++) {
      this.addToIndex(records[i].playerId, i)
    }

    console.log(`[RecordStore] Index rebuilt: ${this.playerIndex.size} players, ${records.length} records`)
  }

  private addToIndex(playerId: string, arrayIndex: number): void {
    let indices = this.playerIndex.get(playerId)
    if (!indices) {
      indices = []
      this.playerIndex.set(playerId, indices)
    }
    indices.push(arrayIndex)
  }

  private queryWithIndex(filter: RecordsQuery): CheatRecord[] {
    const allRecords = this.getAllRecords()
    const indices = this.playerIndex.get(filter.playerId!) ?? []

    let records: CheatRecord[] = []
    for (const idx of indices) {
      if (idx < allRecords.length) {
        records.push(allRecords[idx])
      }
    }

    if (filter.cheatType) {
      records = records.filter(r => r.cheatType === filter.cheatType)
    }
    if (filter.from) {
      records = records.filter(r => r.timestamp >= filter.from!)
    }
    if (filter.to) {
      records = records.filter(r => r.timestamp <= filter.to!)
    }

    records.sort((a, b) => b.timestamp - a.timestamp)

    if (filter.limit && filter.limit > 0) {
      records = records.slice(0, filter.limit)
    }

    return records
  }

  private queryFullScan(filter: RecordsQuery): CheatRecord[] {
    const records = this.getAllRecords()

    let filtered = records
    if (filter.playerId) {
      filtered = filtered.filter(r => r.playerId === filter.playerId)
    }
    if (filter.cheatType) {
      filtered = filtered.filter(r => r.cheatType === filter.cheatType)
    }
    if (filter.from) {
      filtered = filtered.filter(r => r.timestamp >= filter.from!)
    }
    if (filter.to) {
      filtered = filtered.filter(r => r.timestamp <= filter.to!)
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp)

    if (filter.limit && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit)
    }

    return filtered
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
        // 轮转前清空缓存和索引
        this.cache = null
        this.playerIndex.clear()

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
