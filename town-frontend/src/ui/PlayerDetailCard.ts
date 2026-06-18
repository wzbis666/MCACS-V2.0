// PlayerDetailCard — player detail popup with ban status, cheat records, evidence, phase timeline, tracking

import type { PlayerInfo, CheatRecordEntry, CheatType, Confidence, Evidence, PhaseTransition, PenaltyLevel, BanStatus } from '../types.js'
import { PHASE_CSS_COLORS, PHASE_LABELS, CONFIDENCE_LABELS, CHEAT_TYPE_LABELS, CHEAT_TYPE_COLORS, PENALTY_LEVEL_LABELS, PENALTY_LEVEL_COLORS } from '../types.js'

export class PlayerDetailCard {
  private card: HTMLElement
  private nameEl: HTMLElement
  private metaEl: HTMLElement
  private avatarEl: HTMLElement
  private bodyEl: HTMLElement
  private closeBtn: HTMLElement
  private currentPlayer: PlayerInfo | null = null
  private onAction: ((action: string, playerId: string, extra?: Record<string, string>) => void) | null = null
  private onTrack: ((playerId: string) => void) | null = null
  private onRefresh: ((playerId: string) => void) | null = null
  private positionUpdateTimer: ReturnType<typeof setInterval> | null = null
  private getPositionFn: ((playerId: string) => { x: number; y: number; z: number } | null) | null = null

  constructor() {
    this.card = document.getElementById('player-detail-card')!
    this.nameEl = document.getElementById('detail-name')!
    this.metaEl = document.getElementById('detail-meta')!
    this.avatarEl = document.getElementById('detail-avatar')!
    this.bodyEl = document.getElementById('detail-body')!
    this.closeBtn = document.getElementById('detail-close')!

    this.closeBtn.addEventListener('click', () => this.hide())
  }

  setOnAction(callback: (action: string, playerId: string, extra?: Record<string, string>) => void): void {
    this.onAction = callback
  }

  setOnTrack(callback: (playerId: string) => void): void {
    this.onTrack = callback
  }

  setOnRefresh(callback: (playerId: string) => void): void {
    this.onRefresh = callback
  }

  setPositionProvider(fn: (playerId: string) => { x: number; y: number; z: number } | null): void {
    this.getPositionFn = fn
  }

  show(player: PlayerInfo, records: CheatRecordEntry[] = []): void {
    this.currentPlayer = player

    // Avatar: first letter + phase color background
    const initial = player.name.charAt(0).toUpperCase() || '?'
    this.avatarEl.textContent = initial
    this.avatarEl.style.background = PHASE_CSS_COLORS[player.phase]

    // Name with status dot
    this.nameEl.innerHTML = ''
    this.nameEl.textContent = player.name
    this.nameEl.style.color = '#fff'
    const dot = document.createElement('span')
    dot.className = player.phase !== 'offline' ? 'card-status-dot online' : 'card-status-dot offline'
    this.nameEl.appendChild(dot)

    // Meta line: phase + game mode + ban status
    const banLabel = player.banStatus?.isBanned ? ' [已封禁]' : ''
    this.metaEl.textContent = `${PHASE_LABELS[player.phase] ?? player.phase} · ${player.gameMode}${banLabel}`
    if (player.banStatus?.isBanned) {
      this.metaEl.style.color = '#e74c3c'
    } else {
      this.metaEl.style.color = ''
    }

    this.bodyEl.innerHTML = `
      ${this.renderBanStatus(player.banStatus)}

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">UUID</div>
          <div class="info-value">${this.escapeHtml(player.playerId)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">IP</div>
          <div class="info-value">${this.escapeHtml(player.ip)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">游戏模式</div>
          <div class="info-value">${this.escapeHtml(player.gameMode)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">状态</div>
          <div class="info-value" style="color:${PHASE_CSS_COLORS[player.phase]}">${PHASE_LABELS[player.phase] ?? player.phase}</div>
        </div>
      </div>

      <div class="section-title">实时数据</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">坐标</div>
          <div class="info-value" data-stat="position">${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">速度</div>
          <div class="info-value" data-stat="speed">${player.speed.toFixed(2)} 格/秒</div>
        </div>
        <div class="info-item">
          <div class="info-label">点击速度</div>
          <div class="info-value" data-stat="cps">${player.cps.toFixed(1)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">命中率</div>
          <div class="info-value" data-stat="hitRate">${(player.hitRate * 100).toFixed(1)}%</div>
        </div>
      </div>

      ${this.renderEvidence(player.evidence)}

      <div class="section-title">违规积分 (VP)</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">总积分</div>
          <div class="info-value" data-stat="vp" style="color:${player.totalVP >= 30 ? '#e74c3c' : player.totalVP >= 5 ? '#e67e22' : '#2ed573'}">${player.totalVP.toFixed(1)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">处罚次数</div>
          <div class="info-value">${player.penaltyCount}</div>
        </div>
        <div class="info-item">
          <div class="info-label">推荐处罚</div>
          <div class="info-value" style="color:${PENALTY_LEVEL_COLORS[this.resolvePenaltyLevel(player.totalVP)]}">${PENALTY_LEVEL_LABELS[this.resolvePenaltyLevel(player.totalVP)]}</div>
        </div>
      </div>
      ${this.renderVPByType(player.vpByType)}

      ${this.renderPhaseTimeline(player.phaseHistory)}

      ${this.renderCheatRecords(records)}

      <div class="section-title">操作</div>
      <div class="action-buttons">
        <button class="action-btn danger" data-action="ban">封禁</button>
        <button class="action-btn success" data-action="unban">解封</button>
        <button class="action-btn" data-action="whitelist">白名单</button>
        <button class="action-btn track-btn" data-action="track">${player.isTracked ? '取消追踪' : '追踪'}</button>
        <button class="action-btn" data-action="refresh" style="margin-left:auto">刷新</button>
      </div>
    `

    // Wire action buttons
    const buttons = this.bodyEl.querySelectorAll('.action-btn')
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action
        if (action === 'track' && this.onTrack && this.currentPlayer) {
          this.currentPlayer.isTracked = !this.currentPlayer.isTracked
          this.onTrack(this.currentPlayer.playerId)
          btn.textContent = this.currentPlayer.isTracked ? '取消追踪' : '追踪'
        } else if (action === 'refresh' && this.onRefresh && this.currentPlayer) {
          this.onRefresh(this.currentPlayer.playerId)
        } else if (action === 'ban' && this.onAction && this.currentPlayer) {
          this.onAction('ban', this.currentPlayer.playerId)
        } else if (action === 'unban' && this.onAction && this.currentPlayer) {
          this.onAction('unban', this.currentPlayer.playerId)
        } else if (action === 'whitelist' && this.onAction && this.currentPlayer) {
          this.onAction('whitelist', this.currentPlayer.playerId)
        }
      })
    })

    this.card.classList.add('visible')
    this.startPositionUpdates()
  }

  private renderBanStatus(banStatus?: BanStatus): string {
    if (!banStatus || !banStatus.isBanned) return ''

    const durationLabel = this.formatDuration(banStatus.duration)
    const bannedAt = banStatus.bannedAt ? this.formatDateTime(banStatus.bannedAt) : '未知'
    const expiresAt = banStatus.expiresAt === null ? '永久' : banStatus.expiresAt ? this.formatDateTime(banStatus.expiresAt) : '未知'
    const sourceLabel = banStatus.source === 'anticheat' ? '系统自动' : banStatus.source?.startsWith('admin:') ? `管理员: ${banStatus.source.slice(6)}` : banStatus.source ?? '未知'

    return `
      <div class="ban-status-banner" style="background:rgba(231,76,60,0.15);border:1px solid rgba(231,76,60,0.4);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-size:16px;">🔒</span>
          <span style="color:#e74c3c;font-weight:600;font-size:14px;">该玩家已被封禁</span>
        </div>
        <div class="info-grid" style="gap:4px;">
          <div class="info-item">
            <div class="info-label">封禁原因</div>
            <div class="info-value" style="color:#e74c3c">${this.escapeHtml(banStatus.reason ?? '未指定')}</div>
          </div>
          <div class="info-item">
            <div class="info-label">封禁时长</div>
            <div class="info-value">${durationLabel}</div>
          </div>
          <div class="info-item">
            <div class="info-label">封禁时间</div>
            <div class="info-value">${bannedAt}</div>
          </div>
          <div class="info-item">
            <div class="info-label">到期时间</div>
            <div class="info-value">${expiresAt}</div>
          </div>
          <div class="info-item">
            <div class="info-label">操作来源</div>
            <div class="info-value">${sourceLabel}</div>
          </div>
        </div>
      </div>
    `
  }

  private renderCheatRecords(records: CheatRecordEntry[]): string {
    if (records.length === 0) {
      return `
        <div class="section-title">作弊记录 (0)</div>
        <div style="font-size:12px;color:#5a6478;padding:8px 0;">暂无记录</div>
      `
    }

    const recordItems = records.slice(0, 15).map((r) => {
      const evidenceHtml = r.evidence && r.evidence.length > 0
        ? `<div class="record-evidence">
            ${r.evidence.map(e => {
              const ratio = e.threshold > 0 ? e.value / e.threshold : 0
              const color = ratio > 1.0 ? '#ff4757' : ratio > 0.8 ? '#ffa502' : '#2ed573'
              return `<span class="evidence-tag" style="color:${color}">${this.getMetricLabel(e.metric)}: ${e.value.toFixed(1)}/${e.threshold.toFixed(1)}</span>`
            }).join('')}
           </div>`
        : ''

      const vpTag = r.vp !== undefined ? `<span class="vp-tag" style="color:#e67e22;font-size:11px;">VP: ${r.vp.toFixed(1)}</span>` : ''

      return `
        <div class="record-item" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="color:${CHEAT_TYPE_COLORS[r.cheatType]};font-weight:600;font-size:13px;">${CHEAT_TYPE_LABELS[r.cheatType]}</span>
            <span class="confidence-badge ${r.confidence}" style="font-size:11px;">${CONFIDENCE_LABELS[r.confidence] ?? r.confidence}</span>
            <span style="color:#5a6478;font-size:11px;">${this.formatTime(r.timestamp)}</span>
            <span style="color:#8899aa;font-size:11px;">${this.escapeHtml(r.action)}</span>
            ${vpTag}
          </div>
          ${evidenceHtml}
        </div>
      `
    }).join('')

    return `
      <div class="section-title">作弊记录 (${records.length})</div>
      <div id="detail-records" style="max-height:240px;overflow-y:auto;">
        ${recordItems}
      </div>
    `
  }

  private getMetricLabel(metric: string): string {
    const labels: Record<string, string> = {
      speed: '速度',
      fly_height: '飞行高度',
      click_rate: '点击速率',
      hit_rate: '命中率',
      reach_distance: '攻击距离',
      block_place_rate: '搭桥速率',
      xray_anomaly: '透视异常',
      attack_angle: '攻击角度',
      attack_range: '攻击范围',
      cps: '点击速度',
      velocity: '速度向量',
      y_speed: '垂直速度',
      vertical_speed: '垂直速度',
      horizontal_speed: '水平速度',
      flight_duration: '飞行时长',
      exceed_ratio: '超速比',
      max_cps: '最大CPS',
      high_angle_attack_ratio: '异常角度比',
      max_targets_per_second: '每秒目标数',
      valuable_ore_ratio: '贵重矿石比',
      deviation_from_baseline: '偏差倍数',
      max_blocks_per_second: '每秒方块数',
      sustained_seconds: '持续秒数',
      max_consecutive_seconds: '连续秒数',
      speed_effect_level: '速度药水',
      beacon_speed_level: '信标速度',
    }
    return labels[metric] ?? metric
  }

  private formatDuration(duration?: string): string {
    if (!duration) return '未知'
    const map: Record<string, string> = {
      '5m': '5分钟',
      '1h': '1小时',
      '6h': '6小时',
      '24h': '24小时',
      '7d': '7天',
      '30d': '30天',
      'permanent': '永久',
    }
    return map[duration] ?? duration
  }

  private resolvePenaltyLevel(vp: number): PenaltyLevel {
    if (vp >= 150) return 'L5'
    if (vp >= 100) return 'L4'
    if (vp >= 60) return 'L3'
    if (vp >= 30) return 'L2'
    if (vp >= 15) return 'L1'
    if (vp >= 5) return 'L0'
    return 'L0'
  }

  private renderVPByType(vpByType: Record<CheatType, number>): string {
    const types: CheatType[] = ['fly', 'speed', 'kill_aura', 'x_ray', 'scaffold', 'auto_clicker', 'reach']
    const nonZero = types.filter(t => (vpByType[t] ?? 0) > 0)
    if (nonZero.length === 0) return ''

    return `
      <div class="vp-breakdown">
        ${nonZero.map(t => `
          <div class="vp-type-item">
            <span style="color:${CHEAT_TYPE_COLORS[t]}">${CHEAT_TYPE_LABELS[t]}</span>
            <span class="vp-value">${(vpByType[t] ?? 0).toFixed(1)}</span>
          </div>
        `).join('')}
      </div>
    `
  }

  private renderEvidence(evidence: Evidence[]): string {
    if (!evidence || evidence.length === 0) return ''

    return `
      <div class="section-title">证据</div>
      <div class="evidence-list">
        ${evidence.map((e) => {
          const ratio = e.threshold > 0 ? e.value / e.threshold : 0
          let color = '#2ed573'
          if (ratio > 1.0) color = '#ff4757'
          else if (ratio > 0.8) color = '#ffa502'

          return `
            <div class="evidence-item">
              <span class="evidence-metric">${this.getMetricLabel(e.metric)}</span>
              <span class="evidence-value" style="color:${color}">${e.value.toFixed(2)}</span>
              <span class="evidence-threshold">/ ${e.threshold.toFixed(2)}</span>
              <span class="evidence-duration">${e.duration.toFixed(1)}秒</span>
            </div>
          `
        }).join('')}
      </div>
    `
  }

  private renderPhaseTimeline(phaseHistory: PhaseTransition[]): string {
    if (!phaseHistory || phaseHistory.length === 0) return ''

    return `
      <div class="section-title">状态时间线</div>
      <div class="phase-timeline">
        ${phaseHistory.map((p) => `
          <div class="timeline-entry">
            <span class="timeline-from" style="color:${PHASE_CSS_COLORS[p.from]}">${PHASE_LABELS[p.from] ?? p.from}</span>
            <span class="timeline-arrow">→</span>
            <span class="timeline-to" style="color:${PHASE_CSS_COLORS[p.to]}">${PHASE_LABELS[p.to] ?? p.to}</span>
            <span class="timeline-time">${this.formatTime(p.timestamp)}</span>
          </div>
        `).join('')}
      </div>
    `
  }

  private startPositionUpdates(): void {
    this.stopPositionUpdates()
    this.positionUpdateTimer = setInterval(() => {
      if (!this.currentPlayer || !this.getPositionFn) return
      const pos = this.getPositionFn(this.currentPlayer.playerId)
      if (pos) {
        this.currentPlayer.position = pos
        const posEl = this.bodyEl.querySelector('[data-stat="position"]') as HTMLElement
        if (posEl) {
          posEl.textContent = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`
        }
      }
    }, 500)
  }

  private stopPositionUpdates(): void {
    if (this.positionUpdateTimer) {
      clearInterval(this.positionUpdateTimer)
      this.positionUpdateTimer = null
    }
  }

  updateStats(stats: Record<string, number>): void {
    if (!this.currentPlayer) return
    const speedEl = this.bodyEl.querySelector('[data-stat="speed"]') as HTMLElement
    if (speedEl) speedEl.textContent = (stats.speed ?? 0).toFixed(2) + ' 格/秒'

    const cpsEl = this.bodyEl.querySelector('[data-stat="cps"]') as HTMLElement
    if (cpsEl) cpsEl.textContent = (stats.cps ?? 0).toFixed(1)

    const hitRateEl = this.bodyEl.querySelector('[data-stat="hitRate"]') as HTMLElement
    if (hitRateEl) hitRateEl.textContent = ((stats.hitRate ?? 0) * 100).toFixed(1) + '%'
  }

  /** 更新封禁状态（不重新渲染整个卡片） */
  updateBanStatus(banStatus: BanStatus): void {
    if (!this.currentPlayer) return
    this.currentPlayer.banStatus = banStatus
    // 重新渲染以更新封禁状态和按钮
    const records = this.currentPlayer.cheatRecordCount > 0 ? [] : []
    this.show(this.currentPlayer, records)
  }

  hide(): void {
    this.stopPositionUpdates()
    this.card.classList.remove('visible')
    this.currentPlayer = null
  }

  isVisible(): boolean {
    return this.card.classList.contains('visible')
  }

  getCurrentPlayerId(): string | null {
    return this.currentPlayer?.playerId ?? null
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  private formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
  }

  private formatDateTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
}
