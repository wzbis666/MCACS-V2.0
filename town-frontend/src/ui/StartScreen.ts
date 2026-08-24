import './StartScreen.css'

export type StartScreenStatus = 'loading' | 'ready' | 'online' | 'offline' | 'error'

interface StartScreenOptions {
  onStart: () => void
}

export class StartScreen {
  private readonly root: HTMLElement
  private readonly startButton: HTMLButtonElement
  private readonly menuItems: HTMLButtonElement[]
  private readonly statusDot: HTMLElement
  private readonly statusText: HTMLElement
  private readonly clockText: HTMLElement
  private readonly modal: HTMLElement
  private readonly modalTitle: HTMLElement
  private readonly modalBody: HTMLElement
  private readonly onStart: () => void
  private clockTimer: ReturnType<typeof setInterval> | null = null
  private leaving = false
  private modalOpen = false

  constructor(options: StartScreenOptions) {
    this.onStart = options.onStart
    this.root = document.createElement('section')
    this.root.id = 'start-screen'
    this.root.setAttribute('aria-label', 'MCACS 安全小镇开始界面')
    this.root.innerHTML = `
      <div class="town-shade" aria-hidden="true"></div>
      <div class="floating-leaves" aria-hidden="true"><i></i><i></i><i></i></div>

      <header class="town-brand">
        <div class="town-mark" aria-hidden="true"><img src="/favicon.svg" alt="" /></div>
        <div><small>MCACS</small><strong>反作弊安全小镇</strong><span>MINECRAFT ANTI-CHEAT TOWN</span></div>
      </header>

      <aside class="town-weather" aria-label="小镇时间">
        <span class="weather-sun" aria-hidden="true"></span>
        <div><small>小镇晴朗 · 今日值班</small><b id="town-clock">--:--</b></div>
        <em>v0.1.1</em>
      </aside>

      <button type="button" class="town-hotspot archive" data-start-action="about" aria-label="查看档案馆信息">
        <span class="hotspot-pin"></span><span><b>档案馆</b><small>看看小镇档案</small></span>
      </button>
      <button type="button" class="town-hotspot monitor" data-start-action="start" aria-label="进入监控中心">
        <span class="hotspot-pin"></span><span><b>监控中心</b><small>点击进入值班</small></span>
      </button>

      <main class="town-stage">
        <section class="town-welcome">
          <div class="welcome-ribbon"><span>欢迎回来</span><i></i><b>管理员</b></div>
          <h1><small>守护每一次公平冒险</small><span>反作弊</span><strong>安全小镇</strong></h1>
          <p>异常出现时，小镇居民会把线索送到你的值班台。观察、复核，然后做出有依据的决定。</p>

          <nav class="town-menu" aria-label="小镇菜单">
            <button type="button" class="town-menu-item primary" data-start-action="start">
              <span class="menu-icon">▶</span>
              <span class="menu-copy"><b>开始今天的值班</b><small>进入实时监控小镇</small></span>
              <span class="menu-arrow">›</span>
            </button>
            <div class="town-menu-secondary">
              <button type="button" class="town-menu-item" data-start-action="controls">
                <span class="menu-icon">?</span><span class="menu-copy"><b>玩法说明</b><small>镜头与操作</small></span>
              </button>
              <button type="button" class="town-menu-item" data-start-action="about">
                <span class="menu-icon">i</span><span class="menu-copy"><b>关于小镇</b><small>项目与版本</small></span>
              </button>
            </div>
          </nav>

          <div class="town-status" role="status" aria-live="polite">
            <span class="town-status-dot" id="start-status-dot"></span>
            <span id="start-status-text">小镇正在准备开门</span>
            <kbd>ENTER</kbd>
          </div>
        </section>

        <aside class="notice-board" aria-label="今日值班公告">
          <div class="board-plank top"></div>
          <div class="board-title"><span>今日值班板</span><small>DAILY BOARD</small></div>
          <div class="board-paper">
            <i class="paper-pin left"></i><i class="paper-pin right"></i>
            <header><span>安全小镇 · 晨间简报</span><b>准备就绪</b></header>
            <div class="board-list">
              <div><span class="board-icon route"><i></i><i></i><i></i></span><p><b>7 条巡逻路线</b><small>飞行、速度、矿洞与战斗区域</small></p></div>
              <div><span class="board-icon evidence">✓</span><p><b>证据链已整理</b><small>捕获 → 回放 → 复核 → 留痕</small></p></div>
              <div><span class="board-icon bell">!</span><p><b>告警中心待命</b><small>重要异常会第一时间送达</small></p></div>
            </div>
            <blockquote>“今天也要让每一次判断都有依据。”</blockquote>
            <footer><span>值班员签名</span><b>MCACS</b></footer>
          </div>
          <div class="board-plank bottom"></div>
        </aside>
      </main>

      <footer class="town-footer">
        <span><i class="mouse-icon"></i>拖动空白区域可以看看小镇</span>
        <span>也可以点击建筑入口</span>
      </footer>

      <div class="start-modal-backdrop" id="start-modal-backdrop" hidden>
        <section class="start-modal" role="dialog" aria-modal="true" aria-labelledby="start-modal-title">
          <div class="modal-wood top"></div>
          <div class="modal-paper">
            <i class="paper-pin left"></i><i class="paper-pin right"></i>
            <button class="start-modal-close" type="button" data-start-action="close" aria-label="关闭">×</button>
            <small class="modal-kicker">MCACS · 小镇手册</small>
            <h2 id="start-modal-title"></h2><div id="start-modal-body"></div>
            <footer><span>安全小镇管理处</span><b>v0.1.1</b></footer>
          </div>
          <div class="modal-wood bottom"></div>
        </section>
      </div>
    `

    document.body.appendChild(this.root)
    document.body.classList.add('start-menu')
    this.startButton = this.root.querySelector<HTMLButtonElement>('.town-menu-item.primary')!
    this.menuItems = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.town-menu-item'))
    this.statusDot = this.root.querySelector<HTMLElement>('#start-status-dot')!
    this.statusText = this.root.querySelector<HTMLElement>('#start-status-text')!
    this.clockText = this.root.querySelector<HTMLElement>('#town-clock')!
    this.modal = this.root.querySelector<HTMLElement>('#start-modal-backdrop')!
    this.modalTitle = this.root.querySelector<HTMLElement>('#start-modal-title')!
    this.modalBody = this.root.querySelector<HTMLElement>('#start-modal-body')!

    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLElement>('[data-start-action]')?.dataset.startAction
      if (action === 'start') this.start()
      if (action === 'controls') this.openModal('玩法说明', this.controlsMarkup())
      if (action === 'about') this.openModal('关于安全小镇', this.aboutMarkup())
      if (action === 'close' || target === this.modal) this.closeModal()
    })
    window.addEventListener('keydown', this.handleKeyDown)
    this.updateClock()
    this.clockTimer = setInterval(() => this.updateClock(), 1000)
    this.setStatus('loading')
  }

  setReady(): void { this.startButton.disabled = false; this.setStatus('ready') }
  setError(message: string): void { this.startButton.disabled = false; this.setStatus('error', message) }

  setConnectionStatus(status: 'connected' | 'connecting' | 'disconnected'): void {
    if (this.leaving) return
    if (status === 'connected') this.setStatus('online')
    else if (status === 'connecting') this.setStatus('loading', '正在连接小镇控制台')
    else this.setStatus('offline', '控制台暂时离线，可先进入小镇')
  }

  private setStatus(status: StartScreenStatus, message?: string): void {
    const labels: Record<StartScreenStatus, string> = {
      loading: message ?? '小镇正在准备开门',
      ready: '小镇已经开门，随时可以开始值班',
      online: '小镇通讯正常',
      offline: '控制台暂时离线，可先进入小镇',
      error: message ?? '部分小镇资源暂未载入',
    }
    this.statusText.textContent = labels[status]
    this.statusDot.className = `town-status-dot ${status}`
  }

  private updateClock(): void {
    this.clockText.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  }

  private start(): void {
    if (this.leaving) return
    this.leaving = true
    this.startButton.disabled = true
    this.startButton.querySelector('.menu-copy b')!.textContent = '小镇开门中…'
    this.startButton.querySelector('.menu-copy small')!.textContent = '正在准备值班台'
    this.root.classList.add('leaving')
    document.body.classList.add('start-menu-leaving')
    if (this.clockTimer) clearInterval(this.clockTimer)
    window.setTimeout(() => {
      document.body.classList.remove('start-menu', 'start-menu-leaving')
      this.root.remove()
      window.removeEventListener('keydown', this.handleKeyDown)
      this.onStart()
    }, 620)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.modalOpen) { event.preventDefault(); this.closeModal(); return }
    if (this.modalOpen) return
    if (event.key === 'F1') { event.preventDefault(); this.openModal('玩法说明', this.controlsMarkup()); return }
    if (event.key === 'F2') { event.preventDefault(); this.openModal('关于安全小镇', this.aboutMarkup()); return }
    if (event.key === 'Enter') { event.preventDefault(); this.start(); return }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const focusedIndex = this.menuItems.indexOf(document.activeElement as HTMLButtonElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = focusedIndex < 0 ? 0 : (focusedIndex + direction + this.menuItems.length) % this.menuItems.length
    this.menuItems[nextIndex].focus()
  }

  private openModal(title: string, body: string): void {
    if (this.leaving) return
    this.modalTitle.textContent = title
    this.modalBody.innerHTML = body
    this.modal.hidden = false
    this.modalOpen = true
    this.modal.querySelector<HTMLButtonElement>('[data-start-action="close"]')?.focus()
  }

  private closeModal(): void { this.modal.hidden = true; this.modalOpen = false }

  private controlsMarkup(): string {
    return `<p class="start-modal-intro">进入小镇后，你可以像观察一座模型镇一样自由查看现场。</p>
      <div class="start-controls-grid">
        <div><kbd>中键拖拽</kbd><span><b>转动小镇</b><small>从不同方向观察</small></span></div>
        <div><kbd>Shift + 中键</kbd><span><b>移动视角</b><small>前往关注区域</small></span></div>
        <div><kbd>滚轮</kbd><span><b>拉近或远离</b><small>查看建筑细节</small></span></div>
        <div><kbd>右键拖拽</kbd><span><b>快速转动</b><small>迅速切换方向</small></span></div>
        <div><kbd>空格</kbd><span><b>暂停巡逻</b><small>临时停下检测</small></span></div>
        <div><kbd>M</kbd><span><b>告警声音</b><small>打开或关闭提示音</small></span></div>
      </div><p class="start-modal-note">使用鼠标拖动观察小镇，滚轮可以拉近建筑细节。</p>`
  }

  private aboutMarkup(): string {
    return `<p class="start-modal-intro">这里是一座由 Three.js 驱动的反作弊运营小镇。玩家、异常、证据和处置都会在镇上留下可追踪的记录。</p>
      <div class="start-about-list">
        <div><span>监控中心</span><b>实时查看玩家与告警</b></div>
        <div><span>档案馆</span><b>保存案件与证据时间线</b></div>
        <div><span>管理处</span><b>复核并执行可靠处置</b></div>
      </div><p class="start-modal-note">项目版本 MCACS 0.1.1 · Minecraft Anti-Cheat Operations Console</p>`
  }
}
