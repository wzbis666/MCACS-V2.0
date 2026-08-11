// StatsPanel — server statistics + records archive integrated panel

import type { ServerStats, CheatType, CheatRecordEntry, Confidence } from '../types.js'
import { CHEAT_TYPE_LABELS, CHEAT_TYPE_COLORS } from '../types.js'

const CHEAT_TYPES: CheatType[] = ['fly', 'speed', 'kill_aura', 'x_ray', 'scaffold', 'auto_clicker', 'reach']
const PAGE_SIZE = 20

type TabName = 'stats' | 'records'

export class StatsPanel {
  private panel: HTMLElement
  private onlineEl: HTMLElement
  private alertsEl: HTMLElement
  private bansEl: HTMLElement
  private whitelistEl: HTMLElement
  private barChartEl: HTMLElement
  private totalDetectionsEl: HTMLElement
  private sinceEl: HTMLElement
  private timelineEl: HTMLElement
  private collapsedOnlineEl: HTMLElement
  private collapsedAlertsEl: HTMLElement
  private isCollapsed: boolean = true
  private stats: ServerStats = {
    onlinePlayers: 0,
    totalPlayers: 0,
    activeAlerts: 0,
    alertsByType: { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 },
    totalBans: 0,
    whitelistCount: 0,
    totalPenalties: 0,
    autoPenalties: 0,
  }
  private previousAlertsByType: Record<CheatType, number> = { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 }
  private startTime: number = Date.now()
  private hourlyData: number[] = new Array(24).fill(0)

  // Tab state
  private activeTab: TabName = 'stats'
  private tabStats!: HTMLElement
  private tabRecords!: HTMLElement
  private statsContent!: HTMLElement
  private recordsContent!: HTMLElement

  // Records state
  private onFetchRecords: (() => Promise<CheatRecordEntry[]>) | null = null
  private allRecords: CheatRecordEntry[] = []
  private filteredRecords: CheatRecordEntry[] = []
  private recordsPage: number = 1
  private sortColumn: string = 'timestamp'
  private sortDir: 'asc' | 'desc' = 'desc'
  private filterCheatType: string = ''
  private filterConfidence: string = ''
  private filterDateFrom: string = ''
  private filterDateTo: string = ''

  constructor() {
    this.panel = document.getElementById('stats-panel')!
    this.onlineEl = document.getElementById('stat-online')!
    this.alertsEl = document.getElementById('stat-alerts')!
    this.bansEl = document.getElementById('stat-bans')!
    this.whitelistEl = document.getElementById('stat-whitelist')!
    this.barChartEl = document.getElementById('bar-chart')!
    this.totalDetectionsEl = document.getElementById('stat-total-detections')!
    this.sinceEl = document.getElementById('stat-since')!
    this.timelineEl = document.getElementById('hourly-timeline')!
    this.collapsedOnlineEl = document.getElementById('collapsed-online')!
    this.collapsedAlertsEl = document.getElementById('collapsed-alerts')!

    this.sinceEl.textContent = this.formatDateTime(this.startTime)
    this.initBarChart()
    this.initTimeline()
    this.initTabs()
    this.initCollapse()
  }

  setOnFetchRecords(fn: () => Promise<CheatRecordEntry[]>): void {
    this.onFetchRecords = fn
  }

  private initTabs(): void {
    // Create tab bar
    const tabBar = document.createElement('div')
    tabBar.className = 'stats-tab-bar'

    this.tabStats = document.createElement('button')
    this.tabStats.className = 'stats-tab active'
    this.tabStats.textContent = '统计'
    this.tabStats.addEventListener('click', (e) => {
      e.stopPropagation()
      this.switchTab('stats')
    })

    this.tabRecords = document.createElement('button')
    this.tabRecords.className = 'stats-tab'
    this.tabRecords.textContent = '档案'
    this.tabRecords.addEventListener('click', (e) => {
      e.stopPropagation()
      this.switchTab('records')
    })

    tabBar.appendChild(this.tabStats)
    tabBar.appendChild(this.tabRecords)

    // Create content wrappers
    this.statsContent = document.createElement('div')
    this.statsContent.className = 'stats-tab-content'
    // Move existing stats elements into this wrapper
    const existingChildren = Array.from(this.panel.children)
    for (const child of existingChildren) {
      if (child.id !== 'stats-collapsed-icon') {
        this.statsContent.appendChild(child)
      }
    }

    this.recordsContent = document.createElement('div')
    this.recordsContent.className = 'stats-tab-content hidden'
    this.recordsContent.innerHTML = this.buildRecordsHTML()

    // Insert tab bar and content wrappers
    const collapsedIcon = document.getElementById('stats-collapsed-icon')
    if (collapsedIcon) {
      collapsedIcon.after(tabBar)
    } else {
      this.panel.prepend(tabBar)
    }
    tabBar.after(this.statsContent, this.recordsContent)

    // Wire records events
    this.recordsContent.querySelector('.archive-filter-type')?.addEventListener('change', (e) => {
      this.filterCheatType = (e.target as HTMLSelectElement).value
      this.applyRecordsFilter()
    })
    this.recordsContent.querySelector('.archive-filter-confidence')?.addEventListener('change', (e) => {
      this.filterConfidence = (e.target as HTMLSelectElement).value
      this.applyRecordsFilter()
    })
    this.recordsContent.querySelector('.archive-filter-from')?.addEventListener('change', (e) => {
      this.filterDateFrom = (e.target as HTMLInputElement).value
      this.applyRecordsFilter()
    })
    this.recordsContent.querySelector('.archive-filter-to')?.addEventListener('change', (e) => {
      this.filterDateTo = (e.target as HTMLInputElement).value
      this.applyRecordsFilter()
    })

    // Sortable headers
    this.recordsContent.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset.sort!
        if (this.sortColumn === col) {
          this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          this.sortColumn = col
          this.sortDir = 'desc'
        }
        this.applyRecordsFilter()
      })
    })
  }

  private buildRecordsHTML(): string {
    return `
      <div class="archive-filters">
        <select class="archive-filter-type">
          <option value="">全部类型</option>
          <option value="fly">飞行作弊</option>
          <option value="speed">加速作弊</option>
          <option value="kill_aura">杀戮光环</option>
          <option value="x_ray">透视</option>
          <option value="scaffold">自动搭桥</option>
          <option value="auto_clicker">自动点击</option>
          <option value="reach">攻击距离</option>
        </select>
        <select class="archive-filter-confidence">
          <option value="">全部置信度</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <input type="date" class="archive-filter-from" title="起始日期" />
        <input type="date" class="archive-filter-to" title="结束日期" />
      </div>
      <div class="archive-table-container">
        <table class="archive-table">
          <thead>
            <tr>
              <th data-sort="playerName">玩家名称</th>
              <th data-sort="cheatType">作弊类型</th>
              <th data-sort="confidence">置信度</th>
              <th data-sort="action">操作</th>
              <th data-sort="timestamp">时间</th>
            </tr>
          </thead>
          <tbody class="archive-table-body"></tbody>
        </table>
      </div>
      <div class="archive-pagination"></div>
    `
  }

  private switchTab(tab: TabName): void {
    this.activeTab = tab
    this.tabStats.classList.toggle('active', tab === 'stats')
    this.tabRecords.classList.toggle('active', tab === 'records')
    this.statsContent.classList.toggle('hidden', tab !== 'stats')
    this.recordsContent.classList.toggle('hidden', tab !== 'records')

    if (tab === 'records') {
      this.panel.classList.add('records-mode')
      void this.fetchRecords()
    } else {
      this.panel.classList.remove('records-mode')
    }

    // Auto-expand if collapsed
    if (this.isCollapsed) {
      this.expand()
    }
  }

  private async fetchRecords(): Promise<void> {
    if (this.onFetchRecords) {
      try {
        this.allRecords = await this.onFetchRecords()
      } catch {
        this.allRecords = []
      }
    }
    this.applyRecordsFilter()
  }

  private applyRecordsFilter(): void {
    const cheatType = this.filterCheatType as CheatType | ''
    const confidence = this.filterConfidence as Confidence | ''
    const dateFrom = this.filterDateFrom ? new Date(this.filterDateFrom).getTime() : undefined
    const dateTo = this.filterDateTo ? new Date(this.filterDateTo).getTime() + 86400000 : undefined

    this.filteredRecords = this.allRecords.filter(r => {
      if (cheatType && r.cheatType !== cheatType) return false
      if (confidence && r.confidence !== confidence) return false
      if (dateFrom && r.timestamp < dateFrom) return false
      if (dateTo && r.timestamp > dateTo) return false
      return true
    })

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

    this.recordsPage = 1
    this.renderRecordsTable()
    this.renderRecordsPagination()
  }

  private renderRecordsTable(): void {
    const tbody = this.recordsContent.querySelector('.archive-table-body')!
    const start = (this.recordsPage - 1) * PAGE_SIZE
    const pageRecords = this.filteredRecords.slice(start, start + PAGE_SIZE)

    tbody.innerHTML = pageRecords.map(r => `
      <tr>
        <td>${this.escapeHtml(r.playerName ?? '---')}</td>
        <td style="color:${CHEAT_TYPE_COLORS[r.cheatType]}">${CHEAT_TYPE_LABELS[r.cheatType]}</td>
        <td><span class="confidence-badge ${r.confidence}">${r.confidence}</span></td>
        <td>${this.translateAction(r.action)}</td>
        <td>${this.formatDateTime(r.timestamp)}</td>
      </tr>
    `).join('')

    if (pageRecords.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#5a6478;padding:20px;">暂无记录</td></tr>'
    }
  }

  private renderRecordsPagination(): void {
    const paginationEl = this.recordsContent.querySelector('.archive-pagination')!
    const totalPages = Math.max(1, Math.ceil(this.filteredRecords.length / PAGE_SIZE))
    const currentPage = this.recordsPage

    paginationEl.innerHTML = ''

    const prevBtn = document.createElement('button')
    prevBtn.textContent = '‹'
    prevBtn.className = 'page-btn'
    prevBtn.disabled = currentPage <= 1
    prevBtn.addEventListener('click', () => { this.recordsPage = currentPage - 1; this.renderRecordsTable(); this.renderRecordsPagination() })
    paginationEl.appendChild(prevBtn)

    const maxButtons = 5
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2))
    const endPage = Math.min(totalPages, startPage + maxButtons - 1)
    startPage = Math.max(1, endPage - maxButtons + 1)

    for (let i = startPage; i <= endPage; i++) {
      const btn = document.createElement('button')
      btn.textContent = String(i)
      btn.className = `page-btn${i === currentPage ? ' active' : ''}`
      btn.addEventListener('click', () => { this.recordsPage = i; this.renderRecordsTable(); this.renderRecordsPagination() })
      paginationEl.appendChild(btn)
    }

    const nextBtn = document.createElement('button')
    nextBtn.textContent = '›'
    nextBtn.className = 'page-btn'
    nextBtn.disabled = currentPage >= totalPages
    nextBtn.addEventListener('click', () => { this.recordsPage = currentPage + 1; this.renderRecordsTable(); this.renderRecordsPagination() })
    paginationEl.appendChild(nextBtn)

    const info = document.createElement('span')
    info.className = 'page-info'
    info.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`
    paginationEl.appendChild(info)
  }

  private translateAction(action: string): string {
    const map: Record<string, string> = {
      detected: '已检测',
      banned: '已封禁',
      kicked: '已踢出',
    }
    return this.escapeHtml(map[action] ?? action)
  }

  private initCollapse(): void {
    // Click collapsed bar to expand
    this.panel.addEventListener('click', (e) => {
      if (this.isCollapsed) {
        e.stopPropagation()
        this.expand()
      }
    })

    // Esc key to collapse
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.isCollapsed) {
        this.collapse()
      }
    })

    // Click outside to collapse
    document.addEventListener('click', (e) => {
      if (!this.isCollapsed && !this.panel.contains(e.target as Node)) {
        this.collapse()
      }
    })
  }

  private expand(): void {
    this.isCollapsed = false
    this.panel.classList.remove('collapsed')
  }

  private collapse(): void {
    this.isCollapsed = true
    this.panel.classList.add('collapsed')
    // Reset to stats tab when collapsing
    if (this.activeTab === 'records') {
      this.switchTab('stats')
    }
  }

  private initBarChart(): void {
    for (const ct of CHEAT_TYPES) {
      const row = document.createElement('div')
      row.className = 'hbar-row'
      row.dataset.cheatType = ct

      const label = document.createElement('span')
      label.className = 'hbar-label'
      label.textContent = CHEAT_TYPE_LABELS[ct]

      const barContainer = document.createElement('div')
      barContainer.className = 'hbar-container'

      const bar = document.createElement('div')
      bar.className = 'hbar'
      bar.style.width = '0%'
      bar.style.background = CHEAT_TYPE_COLORS[ct]

      const valueEl = document.createElement('span')
      valueEl.className = 'hbar-value'
      valueEl.textContent = '0'

      const trendEl = document.createElement('span')
      trendEl.className = 'hbar-trend'
      trendEl.dataset.cheatType = ct

      barContainer.appendChild(bar)
      row.appendChild(label)
      row.appendChild(barContainer)
      row.appendChild(valueEl)
      row.appendChild(trendEl)
      this.barChartEl.appendChild(row)
    }
  }

  private initTimeline(): void {
    for (let i = 0; i < 24; i++) {
      const bar = document.createElement('div')
      bar.className = 'timeline-bar'
      bar.style.height = '2px'
      bar.title = `${i}:00`
      this.timelineEl.appendChild(bar)
    }
  }

  update(stats: ServerStats): void {
    this.previousAlertsByType = { ...this.stats.alertsByType }
    this.stats = stats
    this.render()
  }

  updatePartial(data: Partial<ServerStats>): void {
    this.previousAlertsByType = { ...this.stats.alertsByType }
    Object.assign(this.stats, data)
    this.render()
  }

  addHourlyAlert(): void {
    const hour = new Date().getHours()
    this.hourlyData[hour]++
    this.renderTimeline()
  }

  resetAlerts(): void {
    this.stats.activeAlerts = 0
    for (const ct of CHEAT_TYPES) {
      this.stats.alertsByType[ct] = 0
    }
    this.hourlyData = new Array(24).fill(0)
    this.render()
  }

  private render(): void {
    this.onlineEl.textContent = `${this.stats.onlinePlayers} / ${this.stats.totalPlayers}`
    this.alertsEl.textContent = String(this.stats.activeAlerts)
    this.bansEl.textContent = String(this.stats.totalBans)
    this.whitelistEl.textContent = String(this.stats.whitelistCount)

    // Update collapsed view values
    this.collapsedOnlineEl.textContent = String(this.stats.onlinePlayers)
    this.collapsedAlertsEl.textContent = String(this.stats.activeAlerts)

    const totalDetections = CHEAT_TYPES.reduce((sum, ct) => sum + (this.stats.alertsByType[ct] ?? 0), 0)
    this.totalDetectionsEl.textContent = String(totalDetections)

    const maxVal = Math.max(1, ...CHEAT_TYPES.map((ct) => this.stats.alertsByType[ct] ?? 0))
    for (const ct of CHEAT_TYPES) {
      const row = this.barChartEl.querySelector(`[data-cheat-type="${ct}"]`) as HTMLElement
      if (row) {
        const val = this.stats.alertsByType[ct] ?? 0
        const bar = row.querySelector('.hbar') as HTMLElement
        const valueEl = row.querySelector('.hbar-value') as HTMLElement
        const trendEl = row.querySelector('.hbar-trend') as HTMLElement

        const pct = Math.max(0, (val / maxVal) * 100)
        bar.style.width = `${pct}%`
        valueEl.textContent = String(val)

        // Trend indicator
        const prev = this.previousAlertsByType[ct] ?? 0
        if (val > prev) {
          trendEl.textContent = '▲'
          trendEl.className = 'hbar-trend up'
        } else if (val < prev) {
          trendEl.textContent = '▼'
          trendEl.className = 'hbar-trend down'
        } else {
          trendEl.textContent = '─'
          trendEl.className = 'hbar-trend neutral'
        }
      }
    }
  }

  private renderTimeline(): void {
    const maxHourly = Math.max(1, ...this.hourlyData)
    const bars = this.timelineEl.querySelectorAll('.timeline-bar')
    bars.forEach((bar, i) => {
      const h = Math.max(2, (this.hourlyData[i] / maxHourly) * 40)
      ;(bar as HTMLElement).style.height = `${h}px`
    })
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
