import type { OfflineSummary } from '../types.js'
import { CHEAT_TYPE_LABELS } from '../types.js'

type FetchSummary = () => Promise<OfflineSummary | null>
type AcknowledgeSummary = () => Promise<void>

export class ShiftBriefing {
  private readonly root: HTMLElement
  private readonly body: HTMLElement
  private fetchSummary: FetchSummary | null = null
  private acknowledgeSummary: AcknowledgeSummary | null = null
  private viewCases: (() => void) | null = null
  private summary: OfflineSummary | null = null

  constructor() {
    this.installStyles()
    this.root = document.createElement('section')
    this.root.id = 'shift-briefing'
    this.root.setAttribute('aria-live', 'polite')
    this.root.innerHTML = `
      <header class="shift-briefing-header">
        <div><small>SHIFT BRIEFING / 值班交接</small><h2>离线期间态势</h2></div>
        <span class="shift-briefing-seal">ACS</span>
      </header>
      <div class="shift-briefing-body"></div>
    `
    this.body = this.root.querySelector('.shift-briefing-body')!
    this.root.addEventListener('click', event => this.handleClick(event))
    document.body.appendChild(this.root)
  }

  setOnFetch(callback: FetchSummary): void {
    this.fetchSummary = callback
  }

  setOnAcknowledge(callback: AcknowledgeSummary): void {
    this.acknowledgeSummary = callback
  }

  setOnViewCases(callback: () => void): void {
    this.viewCases = callback
  }

  async refresh(): Promise<void> {
    if (!this.fetchSummary) return
    this.summary = await this.fetchSummary()
    if (!this.summary) return
    this.render()
    this.root.classList.add('visible')
  }

  destroy(): void {
    this.root.remove()
  }

  private handleClick(event: MouseEvent): void {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-briefing-action]')?.dataset.briefingAction
    if (action === 'cases') {
      this.viewCases?.()
      void this.acknowledge()
      return
    }
    if (action === 'acknowledge') {
      void this.acknowledge()
    }
  }

  private async acknowledge(): Promise<void> {
    const button = this.root.querySelector<HTMLButtonElement>('[data-briefing-action="acknowledge"]')
    if (button) button.disabled = true
    try {
      await this.acknowledgeSummary?.()
      this.root.classList.remove('visible')
    } catch (error) {
      console.error('[ShiftBriefing] Failed to acknowledge summary:', error)
      if (button) {
        button.disabled = false
        button.textContent = '重试确认'
      }
    }
  }

  private render(): void {
    if (!this.summary) return
    const summary = this.summary
    const quality = summary.quality
    const importance = summary.hasImportantActivity || summary.pendingCases > 0
    const statusLabel = importance ? '需要关注' : '运行平稳'
    const statusText = importance
      ? `${summary.pendingCases} 个案件仍待管理员判断。`
      : '未发现需要立即处理的异常。'

    this.body.innerHTML = `
      <div class="shift-briefing-status ${importance ? 'attention' : 'quiet'}">
        <span>${statusLabel}</span><p>${statusText}</p><time>${this.formatDuration(summary.durationMs)}未查看</time>
      </div>
      <div class="shift-briefing-grid">
        ${this.metric('在线峰值', String(summary.onlinePeak), '人')}
        ${this.metric('新建案件', String(summary.casesOpened), '件')}
        ${this.metric('自动措施', String(summary.automaticMeasures), '次')}
        ${this.metric('最低 TPS', summary.minTps === null ? '—' : summary.minTps.toFixed(1), '')}
      </div>
      <div class="shift-quality">
        <span>案件质量</span>
        <dl>
          <div><dt>确认率</dt><dd>${this.formatRate(quality?.confirmationRate)}</dd></div>
          <div><dt>驳回率</dt><dd>${this.formatRate(quality?.dismissalRate)}</dd></div>
          <div><dt>平均处理</dt><dd>${this.formatHandlingTime(quality?.averageHandlingTimeMs)}</dd></div>
        </dl>
      </div>
      ${this.renderDetectorQuality(summary)}
      <footer class="shift-briefing-actions">
        <button type="button" data-briefing-action="cases">进入案件台 <b>${summary.pendingCases}</b></button>
        <button type="button" class="acknowledge" data-briefing-action="acknowledge">简报已阅</button>
      </footer>
    `
  }

  private metric(label: string, value: string, unit: string): string {
    return `<div><small>${label}</small><strong>${value}</strong><span>${unit}</span></div>`
  }

  private renderDetectorQuality(summary: OfflineSummary): string {
    const entries = Object.entries(summary.quality?.byDetector ?? {})
      .filter(([, metric]) => metric && metric.reviewedCases > 0)
      .sort(([, a], [, b]) => (b?.reviewedCases ?? 0) - (a?.reviewedCases ?? 0))
      .slice(0, 4)
    if (entries.length === 0) return ''
    return `
      <div class="shift-detectors">
        <small>检测器确认率</small>
        ${entries.map(([type, metric]) => `
          <span>${CHEAT_TYPE_LABELS[type as keyof typeof CHEAT_TYPE_LABELS] ?? type}<b>${this.formatRate(metric?.confirmationRate)}</b></span>
        `).join('')}
      </div>
    `
  }

  private formatRate(value: number | null | undefined): string {
    return value === null || value === undefined ? '样本不足' : `${Math.round(value * 100)}%`
  }

  private formatHandlingTime(value: number | null | undefined): string {
    if (value === null || value === undefined) return '样本不足'
    const minutes = Math.max(1, Math.round(value / 60_000))
    return minutes < 60 ? `${minutes} 分钟` : `${(minutes / 60).toFixed(1)} 小时`
  }

  private formatDuration(value: number): string {
    const minutes = Math.max(0, Math.floor(value / 60_000))
    if (minutes < 1) return '不足 1 分钟'
    if (minutes < 60) return `${minutes} 分钟`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时`
    return `${Math.floor(hours / 24)} 天`
  }

  private installStyles(): void {
    if (document.getElementById('shift-briefing-styles')) return
    const style = document.createElement('style')
    style.id = 'shift-briefing-styles'
    style.textContent = `
      #shift-briefing { position: fixed; top: 72px; left: 50%; z-index: 35; width: min(620px, calc(100vw - 32px)); overflow: hidden; opacity: 0; pointer-events: none; transform: translate(-50%, -12px); color: #e0e6f0; background: rgba(10, 10, 18, 0.96); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); transition: opacity .25s ease, transform .25s ease; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
      #shift-briefing.visible { opacity: 1; pointer-events: auto; transform: translate(-50%, 0); }
      .shift-briefing-header { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 18px 22px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
      .shift-briefing-header small { color: #45E796; font: 11px/1.4 'Segoe UI', system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
      .shift-briefing-header h2 { margin: 4px 0 0; color: #fff; font: 600 20px/1.2 'Segoe UI', system-ui, -apple-system, sans-serif; letter-spacing: .02em; }
      .shift-briefing-seal { display: grid; place-items: center; width: 42px; height: 42px; color: #45E796; border: 1px solid rgba(69,231,150,.4); border-radius: 50%; font: 700 10px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .08em; }
      .shift-briefing-body { position: relative; padding: 16px 22px 20px; }
      .shift-briefing-status { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; margin-bottom: 13px; padding: 12px 14px; background: rgba(255,255,255,.03); border-left: 3px solid #2ed573; border-radius: 8px; }
      .shift-briefing-status.attention { border-left-color: #ffa502; background: rgba(255,165,2,.06); }
      .shift-briefing-status span { color: #e0e6f0; font: 600 12px/1 'Segoe UI', system-ui, sans-serif; }
      .shift-briefing-status p { margin: 0; color: #6a6a8a; font-size: 10px; }
      .shift-briefing-status time { color: #6a6a8a; font-size: 9px; }
      .shift-briefing-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid rgba(255,255,255,.08); border-radius: 8px; overflow: hidden; }
      .shift-briefing-grid > div { padding: 14px 12px 12px; border-right: 1px solid rgba(255,255,255,.06); }
      .shift-briefing-grid > div:last-child { border-right: 0; }
      .shift-briefing-grid small { display: block; color: #6a6a8a; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
      .shift-briefing-grid strong { display: inline-block; margin-top: 7px; color: #45E796; font: 600 24px/1 'Segoe UI', system-ui, sans-serif; }
      .shift-briefing-grid span { margin-left: 4px; color: #6a6a8a; font-size: 10px; }
      .shift-quality { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 18px; margin-top: 12px; padding: 12px 14px; background: rgba(255,255,255,.03); border-radius: 8px; }
      .shift-quality > span { color: #45E796; font: 600 11px/1 'Segoe UI', system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
      .shift-quality dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0; }
      .shift-quality dl div { display: flex; justify-content: space-between; gap: 6px; }
      .shift-quality dt { color: #6a6a8a; font-size: 10px; }
      .shift-quality dd { margin: 0; color: #e0e6f0; font-size: 10px; }
      .shift-detectors { display: flex; align-items: center; gap: 7px; margin-top: 8px; overflow-x: auto; }
      .shift-detectors > small { flex: 0 0 auto; margin-right: 3px; color: #6a6a8a; font-size: 10px; }
      .shift-detectors > span { flex: 0 0 auto; padding: 5px 8px; color: #6a6a8a; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 6px; font-size: 10px; }
      .shift-detectors b { margin-left: 6px; color: #45E796; font-weight: 500; }
      .shift-briefing-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 15px; }
      .shift-briefing-actions button { padding: 10px 14px; color: rgba(255,255,255,.6); background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; font: 11px/1 'Segoe UI', system-ui, sans-serif; cursor: pointer; transition: all .2s; }
      .shift-briefing-actions button:hover { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(69,231,150,.3); }
      .shift-briefing-actions button b { margin-left: 5px; color: #45E796; }
      .shift-briefing-actions .acknowledge { color: #0a0a12; background: #45E796; border-color: #45E796; font-weight: 600; }
      .shift-briefing-actions .acknowledge:hover { filter: brightness(1.1); }
      .shift-briefing-actions button:disabled { opacity: .45; cursor: wait; }
      @media (prefers-color-scheme: light) {
        #shift-briefing { color: #1a1f2e; background: rgba(240,244,250,.88); border-color: rgba(60,80,140,.15); box-shadow: 0 8px 32px rgba(0,0,0,.1); }
        .shift-briefing-header { border-bottom-color: rgba(60,80,140,.1); }
        .shift-briefing-header small { color: #2da66e; }
        .shift-briefing-header h2 { color: #1a1f2e; }
        .shift-briefing-seal { color: #2da66e; border-color: rgba(45,166,110,.4); }
        .shift-briefing-status { background: rgba(0,0,0,.03); }
        .shift-briefing-status span { color: #1a1f2e; }
        .shift-briefing-grid { border-color: rgba(60,80,140,.15); }
        .shift-briefing-grid > div { border-right-color: rgba(60,80,140,.08); }
        .shift-briefing-grid strong { color: #2da66e; }
        .shift-quality { background: rgba(0,0,0,.03); }
        .shift-quality > span { color: #2da66e; }
        .shift-quality dd { color: #1a1f2e; }
        .shift-detectors > span { background: rgba(0,0,0,.03); border-color: rgba(60,80,140,.15); }
        .shift-detectors b { color: #2da66e; }
        .shift-briefing-actions button { color: rgba(60,80,140,.6); background: rgba(0,0,0,.03); border-color: rgba(60,80,140,.15); }
        .shift-briefing-actions button:hover { border-color: rgba(45,166,110,.4); }
        .shift-briefing-actions .acknowledge { color: #fff; background: #2da66e; border-color: #2da66e; }
      }
      @media (max-width: 640px) { #shift-briefing { top: 54px; width: calc(100vw - 20px); } .shift-briefing-header { padding: 16px 17px 13px; } .shift-briefing-body { padding: 12px 14px 15px; } .shift-briefing-status { grid-template-columns: auto 1fr; } .shift-briefing-status time { grid-column: 1 / -1; } .shift-briefing-grid { grid-template-columns: repeat(2, 1fr); } .shift-briefing-grid > div:nth-child(2) { border-right: 0; } .shift-briefing-grid > div:nth-child(-n+2) { border-bottom: 1px solid rgba(255,255,255,.06); } .shift-quality { grid-template-columns: 1fr; gap: 8px; } }
    `
    document.head.appendChild(style)
  }
}
