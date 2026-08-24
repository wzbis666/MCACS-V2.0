import type { InvestigationCaseSummary, InvestigationDecision } from '../types.js'
import { CHEAT_TYPE_LABELS } from '../types.js'

type FetchCases = () => Promise<InvestigationCaseSummary[]>
type FocusCase = (investigationCase: InvestigationCaseSummary) => void
type ReviewCase = (caseId: string, decision: InvestigationDecision) => Promise<void>

const RISK_LABELS = {
  medium: '持续观察',
  high: '优先复核',
  critical: '立即调查',
} as const

export class CasePanel {
  private readonly root: HTMLDivElement
  private readonly toggle: HTMLButtonElement
  private readonly list: HTMLDivElement
  private readonly count: HTMLSpanElement
  private readonly cases = new Map<string, InvestigationCaseSummary>()
  private fetchCases: FetchCases | null = null
  private focusCase: FocusCase | null = null
  private reviewCase: ReviewCase | null = null

  constructor() {
    this.installStyles()

    this.toggle = document.createElement('button')
    this.toggle.id = 'case-desk-toggle'
    this.toggle.type = 'button'
    this.toggle.setAttribute('aria-label', '打开调查案件台')
    this.toggle.innerHTML = '<span class="case-desk-pulse"></span><span>调查案件</span><strong>0</strong>'

    this.root = document.createElement('div')
    this.root.id = 'case-desk'
    this.root.setAttribute('aria-label', '调查案件台')
    this.root.innerHTML = `
      <header class="case-desk-header">
        <div>
          <small>FIELD INVESTIGATION</small>
          <h2>调查案件台 <span id="case-desk-count">0</span></h2>
        </div>
        <div class="case-desk-actions">
          <button type="button" data-case-action="refresh" title="刷新案件">↻</button>
          <button type="button" data-case-action="close" title="关闭案件台">×</button>
        </div>
      </header>
      <div class="case-desk-intro">系统只提交中高可信信号，最终判断由管理员完成。点击案件卡可打开离线证据回放。</div>
      <div id="case-desk-list" class="case-desk-list"></div>
    `

    this.list = this.root.querySelector('#case-desk-list')!
    this.count = this.root.querySelector('#case-desk-count')!
    document.body.append(this.toggle, this.root)

    this.toggle.addEventListener('click', () => this.open())
    this.root.querySelector('[data-case-action="close"]')?.addEventListener('click', () => this.close())
    this.root.querySelector('[data-case-action="refresh"]')?.addEventListener('click', () => void this.refresh())
    this.list.addEventListener('click', event => this.handleListClick(event))
    this.render()
  }

  setOnFetch(callback: FetchCases): void {
    this.fetchCases = callback
  }

  setOnFocus(callback: FocusCase): void {
    this.focusCase = callback
  }

  setOnReview(callback: ReviewCase): void {
    this.reviewCase = callback
  }

  async refresh(): Promise<void> {
    if (!this.fetchCases) return
    const cases = await this.fetchCases()
    this.cases.clear()
    for (const investigationCase of cases) {
      this.cases.set(investigationCase.id, this.normalize(investigationCase))
    }
    this.render()
  }

  upsert(investigationCase: InvestigationCaseSummary): void {
    const normalized = this.normalize(investigationCase)
    if (normalized.status === 'confirmed' || normalized.status === 'dismissed') {
      this.cases.delete(normalized.id)
    } else {
      this.cases.set(normalized.id, normalized)
    }
    this.render()
  }

  open(): void {
    this.root.classList.add('visible')
    this.toggle.classList.add('hidden')
  }

  close(): void {
    this.root.classList.remove('visible')
    this.toggle.classList.remove('hidden')
  }

  isVisible(): boolean {
    return this.root.classList.contains('visible')
  }

  destroy(): void {
    this.root.remove()
    this.toggle.remove()
  }

  private handleListClick(event: MouseEvent): void {
    const target = event.target as HTMLElement
    const card = target.closest<HTMLElement>('[data-case-id]')
    if (!card) return
    const investigationCase = this.cases.get(card.dataset.caseId ?? '')
    if (!investigationCase) return

    const decision = target.closest<HTMLButtonElement>('[data-decision]')?.dataset.decision as InvestigationDecision | undefined
    if (decision) {
      void this.reviewCase?.(investigationCase.id, decision)
      return
    }
    this.focusCase?.(investigationCase)
  }

  private render(): void {
    const cases = [...this.cases.values()]
      .sort((a, b) => b.riskScore - a.riskScore || b.updatedAt - a.updatedAt)
    this.count.textContent = String(cases.length)
    const toggleCount = this.toggle.querySelector('strong')
    if (toggleCount) toggleCount.textContent = String(cases.length)
    this.toggle.classList.toggle('has-cases', cases.length > 0)

    if (cases.length === 0) {
      this.list.innerHTML = `
        <div class="case-desk-empty">
          <span>✓</span>
          <strong>暂无待审核案件</strong>
          <p>城镇保持安静，低可信异常正在后台自动衰减。</p>
        </div>
      `
      return
    }

    this.list.innerHTML = cases.map(investigationCase => {
      const cheats = investigationCase.suspectedCheats
        .map(type => CHEAT_TYPE_LABELS[type] ?? type)
        .join(' · ')
      return `
        <article class="case-desk-card risk-${investigationCase.riskLevel}" data-case-id="${this.escape(investigationCase.id)}">
          <div class="case-desk-card-top">
            <span class="case-risk-index">${investigationCase.riskScore}</span>
            <div>
              <strong>${this.escape(investigationCase.playerName)}</strong>
              <small>${this.escape(cheats)}</small>
            </div>
            <span class="case-risk-label">${RISK_LABELS[investigationCase.riskLevel]}</span>
          </div>
          <div class="case-meter"><i style="width:${investigationCase.confidenceScore}%"></i></div>
          <div class="case-desk-meta">
            <span>可信度 ${investigationCase.confidenceScore}</span>
            <span>${investigationCase.signalCount} 条信号</span>
            <span>${this.formatTime(investigationCase.updatedAt)}</span>
          </div>
          <div class="case-desk-review">
            <button type="button" data-decision="dismiss">排除</button>
            <button type="button" data-decision="monitor">继续观察</button>
            <button type="button" data-decision="confirm" class="confirm">确认异常</button>
          </div>
        </article>
      `
    }).join('')
  }

  private normalize(investigationCase: InvestigationCaseSummary): InvestigationCaseSummary {
    return {
      ...investigationCase,
      signalCount: investigationCase.signalCount ?? investigationCase.signals?.length ?? 0,
    }
  }

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private installStyles(): void {
    if (document.getElementById('case-desk-styles')) return
    const style = document.createElement('style')
    style.id = 'case-desk-styles'
    style.textContent = `
      #case-desk-toggle {
        position: fixed; right: 20px; bottom: 22px; z-index: 32;
        display: flex; align-items: center; gap: 9px; padding: 11px 16px;
        color: #e0e6f0; background: rgba(10, 10, 18, 0.96);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        font: 600 12px/1 'Segoe UI', system-ui, -apple-system, sans-serif; letter-spacing: .04em;
        cursor: pointer; transition: transform .2s ease, border-color .2s ease, opacity .2s ease;
      }
      #case-desk-toggle:hover { transform: translateY(-2px); border-color: rgba(69, 231, 150, 0.5); }
      #case-desk-toggle.hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
      #case-desk-toggle strong { min-width: 22px; padding: 4px 7px; color: #0a0a12; background: #45E796; border-radius: 10px; font-size: 12px; }
      #case-desk-toggle .case-desk-pulse { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.25); }
      #case-desk-toggle.has-cases .case-desk-pulse { background: #ff4757; box-shadow: 0 0 0 5px rgba(255,71,87,.15); animation: casePulse 2s ease-in-out infinite; }
      @keyframes casePulse { 50% { box-shadow: 0 0 0 9px rgba(255,71,87,0); } }
      #case-desk {
        position: fixed; right: 18px; bottom: 18px; z-index: 31; width: min(390px, calc(100vw - 36px)); max-height: min(680px, calc(100vh - 36px));
        display: flex; flex-direction: column; overflow: hidden; opacity: 0; pointer-events: none; transform: translateY(18px) scale(.98);
        color: #e0e6f0; background: rgba(10, 10, 18, 0.96);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        transition: opacity .24s ease, transform .24s ease;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      }
      #case-desk.visible { opacity: 1; pointer-events: auto; transform: none; }
      .case-desk-header { position: relative; display: flex; justify-content: space-between; gap: 16px; padding: 16px 20px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
      .case-desk-header small { color: #45E796; font: 11px/1.4 'Segoe UI', system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
      .case-desk-header h2 { margin-top: 4px; color: #fff; font: 600 18px/1.2 'Segoe UI', system-ui, -apple-system, sans-serif; letter-spacing: .02em; }
      .case-desk-header h2 span { margin-left: 6px; color: #45E796; }
      .case-desk-actions { display: flex; gap: 5px; }
      .case-desk-actions button { width: 30px; height: 30px; color: rgba(255,255,255,0.5); background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; cursor: pointer; font-size: 16px; transition: all 0.2s; }
      .case-desk-actions button:hover { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(69, 231, 150, 0.3); }
      .case-desk-intro { padding: 10px 20px; color: #6a6a8a; background: rgba(69, 231, 150, 0.04); border-bottom: 1px solid rgba(255,255,255,.04); font-size: 11px; line-height: 1.6; }
      .case-desk-list { position: relative; overflow-y: auto; padding: 12px; scrollbar-width: thin; scrollbar-color: rgba(69,231,150,0.3) transparent; }
      .case-desk-list::-webkit-scrollbar { width: 4px; }
      .case-desk-list::-webkit-scrollbar-thumb { background: rgba(69,231,150,0.3); border-radius: 2px; }
      .case-desk-empty { padding: 52px 18px; text-align: center; color: #6a6a8a; }
      .case-desk-empty span { display: grid; place-items: center; width: 44px; height: 44px; margin: 0 auto 14px; color: #45E796; border: 1px solid rgba(69,231,150,.35); border-radius: 50%; font-size: 18px; }
      .case-desk-empty strong { display: block; color: #e0e6f0; font-weight: 600; font-size: 14px; }
      .case-desk-empty p { max-width: 250px; margin: 8px auto 0; font-size: 11px; line-height: 1.6; }
      .case-desk-card { position: relative; margin-bottom: 9px; padding: 14px; overflow: hidden; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.08); border-left: 3px solid #45E796; border-radius: 8px; cursor: pointer; transition: background .18s ease, transform .18s ease; }
      .case-desk-card:hover { background: rgba(255,255,255,.06); transform: translateX(-2px); }
      .case-desk-card.risk-critical { border-left-color: #ff4757; }
      .case-desk-card.risk-medium { border-left-color: #ffa502; }
      .case-desk-card-top { display: grid; grid-template-columns: 38px 1fr auto; align-items: center; gap: 10px; }
      .case-risk-index { display: grid; place-items: center; width: 36px; height: 36px; color: #0a0a12; background: #45E796; border-radius: 8px; font: 700 14px/1 'Segoe UI', system-ui, sans-serif; }
      .risk-critical .case-risk-index { background: #ff4757; }
      .risk-medium .case-risk-index { background: #ffa502; color: #0a0a12; }
      .case-desk-card-top strong { display: block; color: #fff; font: 600 14px/1.3 'Segoe UI', system-ui, -apple-system, sans-serif; }
      .case-desk-card-top small { display: block; max-width: 175px; margin-top: 3px; overflow: hidden; color: #6a6a8a; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      .case-risk-label { color: #45E796; font-size: 10px; letter-spacing: .04em; font-weight: 600; }
      .risk-critical .case-risk-label { color: #ff4757; }
      .risk-medium .case-risk-label { color: #ffa502; }
      .case-meter { height: 3px; margin: 11px 0 8px; overflow: hidden; background: rgba(255,255,255,.06); border-radius: 2px; }
      .case-meter i { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #2da66e, #45E796); }
      .case-desk-meta { display: flex; justify-content: space-between; color: #6a6a8a; font-size: 10px; }
      .case-desk-review { display: grid; grid-template-columns: .8fr 1.2fr 1.2fr; gap: 5px; margin-top: 12px; }
      .case-desk-review button { padding: 7px 6px; color: rgba(255,255,255,0.6); background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; font: 10px/1 'Segoe UI', system-ui, sans-serif; cursor: pointer; transition: all 0.2s; }
      .case-desk-review button:hover { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(69,231,150,.3); }
      .case-desk-review button.confirm { color: #45E796; background: rgba(69,231,150,.1); border-color: rgba(69,231,150,.25); font-weight: 600; }
      .case-desk-review button.confirm:hover { background: rgba(69,231,150,.18); border-color: rgba(69,231,150,.5); }
      @media (prefers-color-scheme: light) {
        #case-desk-toggle { color: #1a1f2e; background: rgba(240,244,250,.88); border-color: rgba(60,80,140,.15); box-shadow: 0 8px 32px rgba(0,0,0,.1); }
        #case-desk-toggle:hover { border-color: rgba(45,166,110,.5); }
        #case-desk-toggle strong { color: #fff; background: #2da66e; }
        #case-desk { color: #1a1f2e; background: rgba(240,244,250,.88); border-color: rgba(60,80,140,.15); box-shadow: 0 8px 32px rgba(0,0,0,.1); }
        .case-desk-header { border-bottom-color: rgba(60,80,140,.1); }
        .case-desk-header small { color: #2da66e; }
        .case-desk-header h2 { color: #1a1f2e; }
        .case-desk-header h2 span { color: #2da66e; }
        .case-desk-actions button { color: rgba(60,80,140,.5); background: rgba(0,0,0,.04); border-color: rgba(60,80,140,.15); }
        .case-desk-actions button:hover { color: #1a1f2e; border-color: rgba(45,166,110,.4); }
        .case-desk-intro { color: #5a6478; background: rgba(45,166,110,.06); }
        .case-desk-empty { color: #5a6478; }
        .case-desk-empty span { color: #2da66e; border-color: rgba(45,166,110,.35); }
        .case-desk-empty strong { color: #1a1f2e; }
        .case-desk-card { background: rgba(0,0,0,.03); border-color: rgba(60,80,140,.1); }
        .case-desk-card:hover { background: rgba(0,0,0,.05); }
        .case-desk-card-top strong { color: #1a1f2e; }
        .case-desk-card-top small { color: #5a6478; }
        .case-desk-meta { color: #5a6478; }
        .case-desk-review button { color: rgba(60,80,140,.6); background: rgba(0,0,0,.03); border-color: rgba(60,80,140,.15); }
        .case-desk-review button:hover { color: #1a1f2e; border-color: rgba(45,166,110,.4); }
        .case-desk-review button.confirm { color: #2da66e; background: rgba(45,166,110,.1); border-color: rgba(45,166,110,.25); }
      }
    `
    document.head.appendChild(style)
  }
}
