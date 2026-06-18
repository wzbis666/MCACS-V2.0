// RecordsArchive — full-screen overlay showing cheat records with filtering, sorting, pagination, export

import type { CheatRecordEntry, CheatType, Confidence, RecordsArchiveFilter } from '../types.js'
import { CHEAT_TYPE_LABELS, CHEAT_TYPE_COLORS } from '../types.js'

const PAGE_SIZE = 20

export class RecordsArchive {
  private overlay: HTMLElement
  private closeBtn: HTMLElement
  private tableBody: HTMLElement
  private filterCheatType: HTMLSelectElement
  private filterConfidence: HTMLSelectElement
  private filterDateFrom: HTMLInputElement
  private filterDateTo: HTMLInputElement
  private paginationEl: HTMLElement
  private exportBtn: HTMLElement
  private records: CheatRecordEntry[] = []
  private filteredRecords: CheatRecordEntry[] = []
  private filter: RecordsArchiveFilter = { page: 1, pageSize: PAGE_SIZE }
  private sortColumn: string = 'timestamp'
  private sortDir: 'asc' | 'desc' = 'desc'
  private onFetchRecords: (() => Promise<CheatRecordEntry[]>) | null = null

  constructor() {
    this.overlay = document.getElementById('records-archive-overlay')!
    this.closeBtn = document.getElementById('archive-close')!
    this.tableBody = document.getElementById('archive-table-body')!
    this.filterCheatType = document.getElementById('archive-filter-type') as HTMLSelectElement
    this.filterConfidence = document.getElementById('archive-filter-confidence') as HTMLSelectElement
    this.filterDateFrom = document.getElementById('archive-filter-from') as HTMLInputElement
    this.filterDateTo = document.getElementById('archive-filter-to') as HTMLInputElement
    this.paginationEl = document.getElementById('archive-pagination')!
    this.exportBtn = document.getElementById('archive-export')!

    this.initEventListeners()
  }

  setOnFetchRecords(fn: () => Promise<CheatRecordEntry[]>): void {
    this.onFetchRecords = fn
  }

  private initEventListeners(): void {
    this.closeBtn.addEventListener('click', () => this.hide())
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })

    this.filterCheatType.addEventListener('change', () => this.applyFilter())
    this.filterConfidence.addEventListener('change', () => this.applyFilter())
    this.filterDateFrom.addEventListener('change', () => this.applyFilter())
    this.filterDateTo.addEventListener('change', () => this.applyFilter())

    this.exportBtn.addEventListener('click', () => this.exportCSV())

    // Sortable column headers
    const headers = this.overlay.querySelectorAll('th[data-sort]')
    headers.forEach((th) => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset.sort!
        if (this.sortColumn === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          this.sortColumn = col
          this.sortDir = 'desc'
        }
        this.applyFilter()
      })
    })
  }

  async show(): Promise<void> {
    this.overlay.classList.add('visible')
    await this.fetchRecords()
  }

  hide(): void {
    this.overlay.classList.remove('visible')
  }

  isVisible(): boolean {
    return this.overlay.classList.contains('visible')
  }

  private async fetchRecords(): Promise<void> {
    if (this.onFetchRecords) {
      try {
        this.records = await this.onFetchRecords()
      } catch {
        this.records = []
      }
    }
    this.applyFilter()
  }

  private applyFilter(): void {
    const cheatType = this.filterCheatType.value as CheatType | ''
    const confidence = this.filterConfidence.value as Confidence | ''
    const dateFrom = this.filterDateFrom.value ? new Date(this.filterDateFrom.value).getTime() : undefined
    const dateTo = this.filterDateTo.value ? new Date(this.filterDateTo.value).getTime() + 86400000 : undefined

    this.filter.cheatType = cheatType || undefined
    this.filter.confidence = confidence || undefined
    this.filter.dateFrom = dateFrom
    this.filter.dateTo = dateTo

    this.filteredRecords = this.records.filter((r) => {
      if (cheatType && r.cheatType !== cheatType) return false
      if (confidence && r.confidence !== confidence) return false
      if (dateFrom && r.timestamp < dateFrom) return false
      if (dateTo && r.timestamp > dateTo) return false
      return true
    })

    // Sort
    this.filteredRecords.sort((a, b) => {
      let cmp = 0
      switch (this.sortColumn) {
        case 'playerName':
          cmp = (a.playerName ?? '').localeCompare(b.playerName ?? '')
          break
        case 'cheatType':
          cmp = a.cheatType.localeCompare(b.cheatType)
          break
        case 'confidence':
          cmp = a.confidence.localeCompare(b.confidence)
          break
        case 'action':
          cmp = a.action.localeCompare(b.action)
          break
        case 'timestamp':
        default:
          cmp = a.timestamp - b.timestamp
          break
      }
      return this.sortDir === 'asc' ? cmp : -cmp
    })

    this.filter.page = 1
    this.renderTable()
    this.renderPagination()
  }

  private renderTable(): void {
    const page = this.filter.page ?? 1
    const start = (page - 1) * PAGE_SIZE
    const pageRecords = this.filteredRecords.slice(start, start + PAGE_SIZE)

    this.tableBody.innerHTML = pageRecords.map((r) => `
      <tr>
        <td>${this.escapeHtml(r.playerName ?? '---')}</td>
        <td style="color:${CHEAT_TYPE_COLORS[r.cheatType]}">${CHEAT_TYPE_LABELS[r.cheatType]}</td>
        <td><span class="confidence-badge ${r.confidence}">${r.confidence}</span></td>
        <td>${this.translateAction(r.action)}</td>
        <td>${this.formatDateTime(r.timestamp)}</td>
      </tr>
    `).join('')

    if (pageRecords.length === 0) {
      this.tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#5a6478;padding:20px;">暂无记录</td></tr>'
    }
  }

  private renderPagination(): void {
    const totalPages = Math.max(1, Math.ceil(this.filteredRecords.length / PAGE_SIZE))
    const currentPage = this.filter.page ?? 1

    this.paginationEl.innerHTML = ''

    // Prev button
    const prevBtn = document.createElement('button')
    prevBtn.textContent = '‹'
    prevBtn.className = 'page-btn'
    prevBtn.disabled = currentPage <= 1
    prevBtn.addEventListener('click', () => { this.filter.page = currentPage - 1; this.renderTable(); this.renderPagination() })
    this.paginationEl.appendChild(prevBtn)

    // Page buttons
    const maxButtons = 5
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2))
    const endPage = Math.min(totalPages, startPage + maxButtons - 1)
    startPage = Math.max(1, endPage - maxButtons + 1)

    for (let i = startPage; i <= endPage; i++) {
      const btn = document.createElement('button')
      btn.textContent = String(i)
      btn.className = `page-btn${i === currentPage ? ' active' : ''}`
      btn.addEventListener('click', () => { this.filter.page = i; this.renderTable(); this.renderPagination() })
      this.paginationEl.appendChild(btn)
    }

    // Next button
    const nextBtn = document.createElement('button')
    nextBtn.textContent = '›'
    nextBtn.className = 'page-btn'
    nextBtn.disabled = currentPage >= totalPages
    nextBtn.addEventListener('click', () => { this.filter.page = currentPage + 1; this.renderTable(); this.renderPagination() })
    this.paginationEl.appendChild(nextBtn)

    // Info
    const info = document.createElement('span')
    info.className = 'page-info'
    info.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`
    this.paginationEl.appendChild(info)
  }

  private exportCSV(): void {
    const headers = ['玩家名称', '作弊类型', '置信度', '操作', '时间戳']
    const rows = this.filteredRecords.map((r) => [
      r.playerName ?? '---',
      CHEAT_TYPE_LABELS[r.cheatType],
      r.confidence,
      r.action,
      new Date(r.timestamp).toISOString(),
    ])

    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cheat-records-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  private translateAction(action: string): string {
    const map: Record<string, string> = {
      detected: '已检测',
      banned: '已封禁',
      kicked: '已踢出',
    }
    const translated = map[action]
    return translated ? this.escapeHtml(translated) : this.escapeHtml(action)
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  private formatDateTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  }
}
