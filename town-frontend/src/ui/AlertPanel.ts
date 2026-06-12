// AlertPanel — real-time alert list UI with filtering, sound toggle, auto-scroll

import type { AlertEntry, CheatType, Confidence } from '../types.js'
import { CHEAT_TYPE_LABELS, CHEAT_TYPE_COLORS } from '../types.js'

const MAX_VISIBLE = 50

const FILTER_OPTIONS: { key: CheatType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'fly', label: CHEAT_TYPE_LABELS.fly },
  { key: 'speed', label: CHEAT_TYPE_LABELS.speed },
  { key: 'kill_aura', label: CHEAT_TYPE_LABELS.kill_aura },
  { key: 'x_ray', label: CHEAT_TYPE_LABELS.x_ray },
  { key: 'scaffold', label: CHEAT_TYPE_LABELS.scaffold },
  { key: 'auto_clicker', label: CHEAT_TYPE_LABELS.auto_clicker },
  { key: 'reach', label: CHEAT_TYPE_LABELS.reach },
]

export class AlertPanel {
  private container: HTMLElement
  private listEl: HTMLElement
  private countEl: HTMLElement
  private collapseBtn: HTMLElement
  private alerts: AlertEntry[] = []
  private onAlertClick: ((alert: AlertEntry) => void) | null = null
  private idCounter: number = 0
  private isCollapsed: boolean = true

  // Filtering
  private activeFilter: CheatType | 'all' = 'all'
  private filterBar: HTMLElement
  private filterButtons: Map<string, HTMLElement> = new Map()
  private countBadges: Map<string, HTMLElement> = new Map()

  // Sound toggle
  private soundMuted: boolean = false
  private soundToggleBtn: HTMLElement

  // Clear all
  private clearAllBtn: HTMLElement

  // Auto-scroll
  private autoScroll: boolean = true
  private autoScrollBtn: HTMLElement

  // Flash border
  private flashTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.container = document.getElementById('alert-panel')!
    this.listEl = document.getElementById('alert-list')!
    this.countEl = document.getElementById('alert-count')!
    this.collapseBtn = document.getElementById('alert-collapse')!
    this.filterBar = document.getElementById('alert-filters')!
    this.soundToggleBtn = document.getElementById('alert-sound-toggle')!
    this.clearAllBtn = document.getElementById('alert-clear-all')!
    this.autoScrollBtn = document.getElementById('alert-auto-scroll')!

    this.initFilterBar()
    this.initControls()
    this.initCollapse()
  }

  private initCollapse(): void {
    // Click collapsed bar to expand
    this.container.addEventListener('click', (e) => {
      if (this.isCollapsed) {
        e.stopPropagation()
        this.expand()
      }
    })

    // Click collapse button to collapse
    this.collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.collapse()
    })

    // Esc key to collapse
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.isCollapsed) {
        this.collapse()
      }
    })
  }

  private expand(): void {
    this.isCollapsed = false
    this.container.classList.remove('collapsed')
    this.collapseBtn.textContent = '◀'
  }

  private collapse(): void {
    this.isCollapsed = true
    this.container.classList.add('collapsed')
  }

  private initFilterBar(): void {
    for (const opt of FILTER_OPTIONS) {
      const btn = document.createElement('button')
      btn.className = `filter-btn${opt.key === 'all' ? ' active' : ''}`
      btn.dataset.filter = opt.key

      const label = document.createElement('span')
      label.textContent = opt.label
      btn.appendChild(label)

      if (opt.key !== 'all') {
        const badge = document.createElement('span')
        badge.className = 'filter-badge'
        badge.textContent = '0'
        btn.appendChild(badge)
        this.countBadges.set(opt.key, badge)
      }

      btn.addEventListener('click', () => this.setFilter(opt.key))
      this.filterBar.appendChild(btn)
      this.filterButtons.set(opt.key, btn)
    }
  }

  private initControls(): void {
    // Sound toggle
    this.soundToggleBtn.addEventListener('click', () => {
      this.soundMuted = !this.soundMuted
      this.soundToggleBtn.textContent = this.soundMuted ? '🔇' : '🔊'
      this.soundToggleBtn.classList.toggle('muted', this.soundMuted)
    })

    // Clear all
    this.clearAllBtn.addEventListener('click', () => this.clear())

    // Auto-scroll toggle
    this.autoScrollBtn.addEventListener('click', () => {
      this.autoScroll = !this.autoScroll
      this.autoScrollBtn.classList.toggle('active', this.autoScroll)
    })

    // Detect manual scroll
    this.listEl.addEventListener('scroll', () => {
      const atBottom = this.listEl.scrollHeight - this.listEl.scrollTop - this.listEl.clientHeight < 30
      if (!atBottom && this.autoScroll) {
        this.autoScroll = false
        this.autoScrollBtn.classList.remove('active')
      }
    })
  }

  private setFilter(filter: CheatType | 'all'): void {
    this.activeFilter = filter
    for (const [key, btn] of this.filterButtons) {
      btn.classList.toggle('active', key === filter)
    }
    this.renderAll()
  }

  isMuted(): boolean {
    return this.soundMuted
  }

  setOnAlertClick(callback: (alert: AlertEntry) => void): void {
    this.onAlertClick = callback
  }

  addAlert(playerId: string, playerName: string, cheatType: CheatType, confidence: Confidence, message: string): void {
    const alert: AlertEntry = {
      id: `alert_${++this.idCounter}`,
      playerId,
      playerName,
      cheatType,
      confidence,
      message,
      timestamp: Date.now(),
    }

    this.alerts.unshift(alert)
    if (this.alerts.length > MAX_VISIBLE) {
      this.alerts.pop()
    }

    this.updateCountBadges()
    this.countEl.textContent = String(this.getFilteredAlerts().length)

    // Only render if matches current filter
    if (this.activeFilter === 'all' || this.activeFilter === cheatType) {
      this.renderAlert(alert, true)
    }

    // Flash border on high confidence
    if (confidence === 'high') {
      this.flashBorder()
      // Auto-expand on high confidence alert
      if (this.isCollapsed) {
        this.expand()
      }
    }
  }

  private getFilteredAlerts(): AlertEntry[] {
    if (this.activeFilter === 'all') return this.alerts
    return this.alerts.filter((a) => a.cheatType === this.activeFilter)
  }

  private updateCountBadges(): void {
    const counts: Record<string, number> = { fly: 0, speed: 0, kill_aura: 0, x_ray: 0, scaffold: 0, auto_clicker: 0, reach: 0 }
    for (const a of this.alerts) {
      counts[a.cheatType] = (counts[a.cheatType] ?? 0) + 1
    }
    for (const [key, badge] of this.countBadges) {
      badge.textContent = String(counts[key] ?? 0)
    }
  }

  private flashBorder(): void {
    this.container.classList.add('flash-border')
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.container.classList.remove('flash-border')
    }, 1500)
  }

  private renderAlert(alert: AlertEntry, prepend: boolean): void {
    const el = document.createElement('div')
    el.className = `alert-item confidence-${alert.confidence}`
    if (alert.confidence === 'high') {
      el.classList.add('flash')
    }
    el.dataset.alertId = alert.id
    el.dataset.cheatType = alert.cheatType

    el.innerHTML = `
      <div class="alert-top">
        <span class="player-name">${this.escapeHtml(alert.playerName)}</span>
        <span class="cheat-type" style="color:${CHEAT_TYPE_COLORS[alert.cheatType]}">${CHEAT_TYPE_LABELS[alert.cheatType]}</span>
      </div>
      <div class="alert-msg">${this.escapeHtml(alert.message)}</div>
      <div class="alert-bottom">
        <span class="timestamp">${this.formatTime(alert.timestamp)}</span>
        <span class="confidence-badge ${alert.confidence}">${alert.confidence.toUpperCase()}</span>
      </div>
    `

    el.addEventListener('click', () => {
      if (this.onAlertClick) {
        this.onAlertClick(alert)
      }
    })

    if (prepend && this.listEl.firstChild) {
      this.listEl.insertBefore(el, this.listEl.firstChild)
    } else {
      this.listEl.appendChild(el)
    }

    // Remove excess items from DOM
    while (this.listEl.children.length > MAX_VISIBLE) {
      this.listEl.removeChild(this.listEl.lastChild!)
    }

    // Auto-scroll to top
    if (this.autoScroll) {
      this.listEl.scrollTop = 0
    }
  }

  private renderAll(): void {
    this.listEl.innerHTML = ''
    const filtered = this.getFilteredAlerts()
    for (const alert of filtered) {
      this.renderAlert(alert, false)
    }
    this.countEl.textContent = String(filtered.length)
  }

  private onClearCallback: (() => void) | null = null

  onClear(callback: () => void): void {
    this.onClearCallback = callback
  }

  clear(): void {
    this.alerts = []
    this.listEl.innerHTML = ''
    this.countEl.textContent = '0'
    this.updateCountBadges()
    if (this.onClearCallback) this.onClearCallback()
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  private formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
}
