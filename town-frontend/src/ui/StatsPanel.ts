// StatsPanel — server statistics display with horizontal bar chart, trends, timeline

import type { ServerStats, CheatType } from '../types.js'
import { CHEAT_TYPE_LABELS, CHEAT_TYPE_COLORS } from '../types.js'

const CHEAT_TYPES: CheatType[] = ['fly', 'speed', 'kill_aura', 'x_ray', 'scaffold', 'auto_clicker', 'reach']

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
    this.initCollapse()
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

  private formatDateTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  }
}
