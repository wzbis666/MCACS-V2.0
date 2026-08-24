// StartScreen — game-style entrance for the MCACS operations town

export type StartScreenStatus = 'loading' | 'ready' | 'online' | 'offline' | 'error'

interface StartScreenOptions {
  onStart: () => void
}

export class StartScreen {
  private readonly root: HTMLElement
  private readonly startButton: HTMLButtonElement
  private readonly statusDot: HTMLElement
  private readonly statusText: HTMLElement
  private readonly modal: HTMLElement
  private readonly modalTitle: HTMLElement
  private readonly modalBody: HTMLElement
  private readonly onStart: () => void
  private leaving = false
  private modalOpen = false

  constructor(options: StartScreenOptions) {
    this.onStart = options.onStart
    this.installStyles()

    this.root = document.createElement('section')
    this.root.id = 'start-screen'
    this.root.setAttribute('aria-label', 'MCACS 游戏启动界面')
    this.root.innerHTML = `
      <div class="start-screen-inner">
        <div class="start-brand">
          <div class="start-kicker"><span class="start-kicker-line"></span> MCACS / FIELD OPERATIONS</div>
          <div class="start-mark" aria-hidden="true"><span>ACS</span></div>
          <h1 class="start-title"><span>MCACS</span><small>反作弊行动中心</small></h1>
          <p class="start-lead">从异常信号到可追踪的处置，每一次判断都留下证据。</p>

          <nav class="start-menu" aria-label="启动菜单">
            <button type="button" class="start-menu-item primary" data-start-action="start">
              <span class="start-menu-index">01</span>
              <span class="start-menu-label"><b>开始值班</b><small>进入实时监控小镇</small></span>
              <span class="start-menu-arrow" aria-hidden="true">↗</span>
            </button>
            <button type="button" class="start-menu-item" data-start-action="controls">
              <span class="start-menu-index">02</span>
              <span class="start-menu-label"><b>操作说明</b><small>查看镜头与监控台操作</small></span>
              <span class="start-menu-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="start-menu-item" data-start-action="about">
              <span class="start-menu-index">03</span>
              <span class="start-menu-label"><b>关于 MCACS</b><small>查看行动中心信息</small></span>
              <span class="start-menu-arrow" aria-hidden="true">→</span>
            </button>
          </nav>

          <div class="start-status" role="status" aria-live="polite">
            <span class="start-status-dot" id="start-status-dot"></span>
            <span id="start-status-text">正在载入小镇</span>
            <span class="start-status-key">按 Enter 开始</span>
          </div>
        </div>

        <aside class="start-brief" aria-label="系统简报">
          <div class="start-brief-heading"><span>FIELD BRIEF</span><b>启动简报</b></div>
          <div class="start-brief-rule"></div>
          <div class="start-brief-item"><span class="brief-marker active"></span><div><b>7 条检测路线</b><small>Fly · Speed · X-Ray · Reach</small></div></div>
          <div class="start-brief-item"><span class="brief-marker"></span><div><b>证据时间线</b><small>捕获、回放、复核、留痕</small></div></div>
          <div class="start-brief-item"><span class="brief-marker"></span><div><b>可靠执行</b><small>ACK/NACK · 审计记录</small></div></div>
          <div class="start-brief-footer"><span>OPERATOR CONSOLE</span><strong>0.1.1</strong></div>
        </aside>
      </div>

      <div class="start-modal-backdrop" id="start-modal-backdrop" hidden>
        <section class="start-modal" role="dialog" aria-modal="true" aria-labelledby="start-modal-title">
          <button class="start-modal-close" type="button" data-start-action="close" aria-label="关闭">×</button>
          <div class="start-kicker"><span class="start-kicker-line"></span> MCACS / FIELD NOTES</div>
          <h2 id="start-modal-title"></h2>
          <div id="start-modal-body"></div>
        </section>
      </div>
    `

    document.body.appendChild(this.root)
    document.body.classList.add('start-menu')

    this.startButton = this.root.querySelector<HTMLButtonElement>('[data-start-action="start"]')!
    this.statusDot = this.root.querySelector<HTMLElement>('#start-status-dot')!
    this.statusText = this.root.querySelector<HTMLElement>('#start-status-text')!
    this.modal = this.root.querySelector<HTMLElement>('#start-modal-backdrop')!
    this.modalTitle = this.root.querySelector<HTMLElement>('#start-modal-title')!
    this.modalBody = this.root.querySelector<HTMLElement>('#start-modal-body')!

    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLElement>('[data-start-action]')?.dataset.startAction
      if (action === 'start') this.start()
      if (action === 'controls') this.openModal('操作说明', this.controlsMarkup())
      if (action === 'about') this.openModal('关于 MCACS', this.aboutMarkup())
      if (action === 'close' || target === this.modal) this.closeModal()
    })

    window.addEventListener('keydown', this.handleKeyDown)
    this.setStatus('loading')
  }

  setReady(): void {
    this.startButton.disabled = false
    this.setStatus('ready')
  }

  setError(message: string): void {
    this.startButton.disabled = false
    this.setStatus('error', message)
  }

  setConnectionStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
    if (this.leaving) return
    if (status === 'connected') this.setStatus('online')
    else if (status === 'connecting') this.setStatus('loading', '正在连接控制层')
    else this.setStatus('offline', '控制层等待连接')
  }

  private setStatus(status: StartScreenStatus, message?: string): void {
    const labels: Record<StartScreenStatus, string> = {
      loading: '正在载入小镇',
      ready: '小镇已就绪 · 按 Enter 开始',
      online: '控制层在线 · 按 Enter 开始',
      offline: '控制层等待连接',
      error: message ?? '小镇资源载入异常',
    }
    this.statusText.textContent = labels[status]
    this.statusDot.className = `start-status-dot ${status}`
  }

  private start(): void {
    if (this.leaving) return
    this.leaving = true
    this.startButton.disabled = true
    this.startButton.querySelector('.start-menu-label b')!.textContent = '正在进入小镇'
    this.root.classList.add('leaving')
    document.body.classList.add('start-menu-leaving')

    window.setTimeout(() => {
      document.body.classList.remove('start-menu', 'start-menu-leaving')
      this.root.remove()
      window.removeEventListener('keydown', this.handleKeyDown)
      this.onStart()
    }, 520)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.modalOpen) {
      event.preventDefault()
      this.closeModal()
      return
    }
    if (this.modalOpen) return
    if (event.key === 'Enter') {
      event.preventDefault()
      this.start()
    }
  }

  private openModal(title: string, body: string): void {
    if (this.leaving) return
    this.modalTitle.textContent = title
    this.modalBody.innerHTML = body
    this.modal.hidden = false
    this.modalOpen = true
    this.modal.querySelector<HTMLButtonElement>('[data-start-action="close"]')?.focus()
  }

  private closeModal(): void {
    this.modal.hidden = true
    this.modalOpen = false
  }

  private controlsMarkup(): string {
    return `
      <p class="start-modal-intro">进入小镇后，使用以下操作观察玩家、案件和证据状态。</p>
      <div class="start-controls-grid">
        <div><kbd>中键拖拽</kbd><span>旋转镜头</span></div>
        <div><kbd>Shift + 中键</kbd><span>平移镜头</span></div>
        <div><kbd>滚轮</kbd><span>缩放视角</span></div>
        <div><kbd>右键拖拽</kbd><span>快速旋转</span></div>
        <div><kbd>空格</kbd><span>暂停检测</span></div>
        <div><kbd>M</kbd><span>切换告警音效</span></div>
      </div>
      <p class="start-modal-note">移动端支持单指旋转与双指缩放。</p>
    `
  }

  private aboutMarkup(): string {
    return `
      <p class="start-modal-intro">Minecraft Anti-Cheat Operations Console</p>
      <div class="start-about-list">
        <div><span>核心</span><b>Three.js 3D 运营小镇</b></div>
        <div><span>流程</span><b>采集 → 证据 → 案件 → 复核</b></div>
        <div><span>版本</span><b>MCACS 0.1.1</b></div>
      </div>
      <p class="start-modal-note">让每一次判断都有证据，让每一次处理都可追踪。</p>
    `
  }

  private installStyles(): void {
    if (document.getElementById('start-screen-styles')) return
    const style = document.createElement('style')
    style.id = 'start-screen-styles'
    style.textContent = `
      body.start-menu #ui-overlay > *, body.start-menu #case-desk-toggle, body.start-menu #case-desk, body.start-menu #evidence-timeline { opacity: 0 !important; pointer-events: none !important; }
      #start-screen { position: fixed; inset: 0; z-index: 200; overflow: auto; color: #e0e6f0; background: linear-gradient(90deg, rgba(4,10,15,.86) 0%, rgba(4,10,15,.63) 36%, rgba(4,10,15,.16) 74%, rgba(4,10,15,.45) 100%), linear-gradient(180deg, rgba(4,10,15,.12), rgba(4,10,15,.42)); font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; opacity: 1; transition: opacity .52s ease, transform .52s cubic-bezier(.2,.8,.2,1); }
      #start-screen::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(circle at 72% 42%, rgba(69,231,150,.12), transparent 23%), linear-gradient(115deg, transparent 0 43%, rgba(255,255,255,.035) 43.1%, transparent 43.25% 100%), linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px); background-size: auto, auto, 40px 40px, 40px 40px; mask-image: linear-gradient(90deg, rgba(0,0,0,.8), transparent 90%); }
      #start-screen::after { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .16; background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.04) 4px, transparent 5px); mix-blend-mode: screen; }
      #start-screen.leaving { opacity: 0; transform: scale(1.025); pointer-events: none; }
      .start-screen-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: clamp(48px, 8vw, 150px); width: min(1240px, calc(100% - 96px)); min-height: 100dvh; margin: 0 auto; padding: 72px 0 64px; }
      .start-brand { width: min(610px, 58vw); }
      .start-kicker { display: inline-flex; align-items: center; gap: 9px; color: #45E796; font-size: 11px; font-weight: 700; letter-spacing: .16em; line-height: 1; text-transform: uppercase; }
      .start-kicker-line { width: 28px; height: 1px; background: #45E796; box-shadow: 0 0 12px rgba(69,231,150,.7); }
      .start-mark { display: grid; place-items: center; width: 58px; height: 58px; margin: 34px 0 18px; color: #45E796; border: 1px solid rgba(69,231,150,.55); border-radius: 50%; box-shadow: 0 0 0 7px rgba(69,231,150,.045), 0 0 36px rgba(69,231,150,.18); font-size: 11px; font-weight: 800; letter-spacing: .15em; }
      .start-mark::before { content: ''; position: absolute; width: 82px; height: 1px; background: linear-gradient(90deg, transparent, rgba(69,231,150,.45), transparent); transform: rotate(-45deg); }
      .start-title { margin: 0; color: #fff; font-family: 'Bahnschrift', 'Segoe UI', system-ui, sans-serif; font-size: clamp(54px, 7vw, 96px); font-weight: 700; letter-spacing: -.075em; line-height: .86; text-shadow: 0 6px 28px rgba(0,0,0,.38); }
      .start-title span { display: block; }
      .start-title small { display: block; margin-top: 21px; color: rgba(255,255,255,.85); font-family: 'Segoe UI', system-ui, sans-serif; font-size: clamp(18px, 2.2vw, 28px); font-weight: 500; letter-spacing: .03em; line-height: 1; }
      .start-lead { max-width: 420px; margin: 24px 0 34px; color: rgba(224,230,240,.72); font-size: 14px; line-height: 1.8; }
      .start-menu { display: grid; width: min(390px, 100%); gap: 6px; }
      .start-menu-item { position: relative; display: flex; align-items: center; width: 100%; min-height: 62px; padding: 11px 14px; color: rgba(255,255,255,.63); background: rgba(8,13,19,.26); border: 1px solid transparent; border-radius: 13px; cursor: pointer; text-align: left; transition: color .2s ease, background .2s ease, border-color .2s ease, transform .2s ease; }
      .start-menu-item:hover, .start-menu-item:focus-visible { color: #fff; background: rgba(10,10,18,.72); border-color: rgba(255,255,255,.16); outline: none; transform: translateX(5px); }
      .start-menu-item.primary { color: #fff; background: linear-gradient(90deg, rgba(69,231,150,.2), rgba(10,10,18,.52)); border-color: rgba(69,231,150,.42); box-shadow: 0 0 28px rgba(69,231,150,.09); }
      .start-menu-item.primary:hover, .start-menu-item.primary:focus-visible { border-color: #45E796; box-shadow: 0 0 32px rgba(69,231,150,.18); }
      .start-menu-item:disabled { opacity: .56; cursor: wait; transform: none; }
      .start-menu-index { width: 34px; color: rgba(255,255,255,.32); font-size: 10px; font-variant-numeric: tabular-nums; letter-spacing: .08em; }
      .start-menu-item.primary .start-menu-index { color: #45E796; }
      .start-menu-label { display: grid; gap: 4px; }
      .start-menu-label b { font-size: 14px; font-weight: 650; letter-spacing: .05em; }
      .start-menu-label small { color: #6a6a8a; font-size: 11px; }
      .start-menu-arrow { margin-left: auto; color: rgba(255,255,255,.34); font-size: 18px; transition: transform .2s ease, color .2s ease; }
      .start-menu-item:hover .start-menu-arrow, .start-menu-item:focus-visible .start-menu-arrow { color: #45E796; transform: translate(2px, -2px); }
      .start-status { display: flex; align-items: center; gap: 9px; margin-top: 28px; color: #6a6a8a; font-size: 10px; letter-spacing: .03em; }
      .start-status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #ffa502; box-shadow: 0 0 9px rgba(255,165,2,.7); }
      .start-status-dot.ready { background: #45E796; box-shadow: 0 0 9px rgba(69,231,150,.7); }
      .start-status-dot.online { background: #2ed573; box-shadow: 0 0 9px rgba(46,213,115,.7); }
      .start-status-dot.offline, .start-status-dot.error { background: #ff4757; box-shadow: 0 0 9px rgba(255,71,87,.7); }
      .start-status-dot.loading { animation: startPulse 1.1s ease-in-out infinite; }
      .start-status-key { margin-left: auto; color: rgba(255,255,255,.3); font-size: 9px; text-transform: uppercase; letter-spacing: .1em; }
      @keyframes startPulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.72); } }
      .start-brief { width: 260px; padding: 22px; color: #e0e6f0; background: rgba(10,10,18,.62); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.11); border-radius: 18px; box-shadow: 0 16px 42px rgba(0,0,0,.28); transform: translateY(10px); animation: startBriefIn .7s .25s both ease-out; }
      @keyframes startBriefIn { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: translateY(10px); } }
      .start-brief-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .start-brief-heading span { color: #45E796; font-size: 10px; font-weight: 700; letter-spacing: .15em; }
      .start-brief-heading b { color: rgba(255,255,255,.72); font-size: 11px; font-weight: 500; }
      .start-brief-rule { height: 1px; margin: 16px 0 8px; background: rgba(255,255,255,.08); }
      .start-brief-item { display: flex; gap: 11px; padding: 13px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
      .start-brief-item:last-of-type { border-bottom: 0; }
      .brief-marker { width: 7px; height: 7px; margin-top: 4px; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.28); border-radius: 50%; }
      .brief-marker.active { border-color: #45E796; background: #45E796; box-shadow: 0 0 9px rgba(69,231,150,.7); }
      .start-brief-item div { display: grid; gap: 4px; }
      .start-brief-item b { color: rgba(255,255,255,.78); font-size: 11px; font-weight: 600; }
      .start-brief-item small { color: #6a6a8a; font-size: 10px; line-height: 1.4; }
      .start-brief-footer { display: flex; justify-content: space-between; margin-top: 18px; color: #5a6478; font-size: 9px; letter-spacing: .12em; }
      .start-brief-footer strong { color: #45E796; font-weight: 600; letter-spacing: .04em; }
      .start-modal-backdrop { position: fixed; inset: 0; z-index: 3; display: grid; place-items: center; padding: 24px; background: rgba(3,7,10,.62); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      .start-modal-backdrop[hidden] { display: none; }
      .start-modal { position: relative; width: min(520px, 100%); padding: 30px; background: rgba(10,10,18,.96); border: 1px solid rgba(255,255,255,.13); border-radius: 18px; box-shadow: 0 18px 70px rgba(0,0,0,.48); animation: modalIn .22s ease-out; }
      @keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .start-modal-close { position: absolute; top: 12px; right: 13px; width: 32px; height: 32px; color: rgba(255,255,255,.42); background: transparent; border: 1px solid transparent; border-radius: 9px; cursor: pointer; font-size: 22px; line-height: 1; }
      .start-modal-close:hover, .start-modal-close:focus-visible { color: #fff; background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.1); outline: none; }
      .start-modal h2 { margin: 20px 0 12px; color: #fff; font-size: 24px; font-weight: 650; letter-spacing: -.02em; }
      .start-modal-intro, .start-modal-note { color: #6a6a8a; font-size: 12px; line-height: 1.7; }
      .start-modal-note { margin-top: 18px; }
      .start-controls-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 20px; }
      .start-controls-grid div { display: flex; align-items: center; gap: 8px; padding: 10px; background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.07); border-radius: 8px; }
      .start-controls-grid kbd { min-width: 72px; padding: 4px 6px; color: #45E796; background: rgba(69,231,150,.09); border: 1px solid rgba(69,231,150,.2); border-radius: 4px; font-size: 9px; text-align: center; }
      .start-controls-grid span { color: rgba(255,255,255,.66); font-size: 10px; }
      .start-about-list { display: grid; gap: 1px; margin-top: 20px; overflow: hidden; background: rgba(255,255,255,.07); border-radius: 8px; }
      .start-about-list div { display: flex; justify-content: space-between; gap: 16px; padding: 12px; background: rgba(10,10,18,.78); }
      .start-about-list span { color: #6a6a8a; font-size: 10px; }
      .start-about-list b { color: rgba(255,255,255,.78); font-size: 11px; font-weight: 500; text-align: right; }
      @media (max-width: 760px) {
        #start-screen { background: linear-gradient(180deg, rgba(4,10,15,.1) 0 25%, rgba(4,10,15,.64) 56%, rgba(4,10,15,.93) 100%); }
        .start-screen-inner { display: flex; align-items: flex-end; width: 100%; min-height: 100dvh; padding: 36px 20px 22px; }
        .start-brand { width: 100%; }
        .start-mark { width: 48px; height: 48px; margin: 0 0 14px; font-size: 10px; }
        .start-title { font-size: clamp(48px, 15vw, 68px); }
        .start-title small { margin-top: 14px; font-size: 18px; }
        .start-lead { margin: 16px 0 22px; font-size: 12px; line-height: 1.6; }
        .start-menu { width: 100%; gap: 5px; }
        .start-menu-item { min-height: 58px; }
        .start-brief { display: none; }
        .start-status { margin-top: 18px; }
        .start-status-key { display: none; }
        .start-modal-backdrop { align-items: end; padding: 10px; }
        .start-modal { padding: 25px 18px 20px; border-radius: 16px; }
        .start-controls-grid { grid-template-columns: 1fr; gap: 6px; }
      }
      @media (prefers-reduced-motion: reduce) {
        #start-screen, .start-brief, .start-modal, .start-status-dot.loading { animation: none; transition: none; }
      }
    `
    document.head.appendChild(style)
  }
}
