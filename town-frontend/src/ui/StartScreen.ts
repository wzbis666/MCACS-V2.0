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
  private readonly nodeStatus: HTMLElement
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
    this.root.setAttribute('aria-label', 'MCACS 游戏启动界面')
    this.root.innerHTML = `
      <div class="game-noise" aria-hidden="true"></div>
      <div class="game-scan" aria-hidden="true"></div>
      <div class="game-reticle" aria-hidden="true">
        <span class="reticle-ring"></span><span class="reticle-cross"></span>
        <small>PATROL CORE · LOCKED</small>
      </div>

      <div class="game-shell">
        <i class="hud-corner top-left"></i><i class="hud-corner top-right"></i>
        <i class="hud-corner bottom-left"></i><i class="hud-corner bottom-right"></i>

        <header class="game-topbar">
          <div class="game-identity">
            <div class="voxel-badge" aria-hidden="true"><span></span><span></span><span></span><b>M</b></div>
            <div><strong>MCACS</strong><small>ANTI-CHEAT COMMAND SYSTEM</small></div>
          </div>
          <div class="game-node-cluster">
            <div class="node-signal" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="node-info"><small>WORLD NODE</small><b>MC-01 / <em id="game-node-status">BOOTING</em></b></div>
            <div class="node-info build-info"><small>BUILD</small><b>0.1.1</b></div>
            <div class="node-info clock-info"><small>LOCAL SHIFT</small><b id="game-clock">--:--</b></div>
          </div>
        </header>

        <main class="game-stage">
          <section class="game-hero">
            <div class="game-eyebrow">
              <span><i></i> TACTICAL OVERWATCH</span><em>SECURITY LEVEL / ALPHA</em>
            </div>
            <h1 class="game-title" aria-label="MCACS"><span>MC</span><strong>ACS</strong></h1>
            <div class="game-subtitle">
              <span class="subtitle-number">01</span>
              <div><small>MINECRAFT WORLD SECURITY</small><b>反作弊 <strong>行动中心</strong></b></div>
            </div>
            <p class="game-lead">接管监控小镇，锁定异常行为，沿证据链完成复核与处置。</p>

            <nav class="game-menu" aria-label="启动菜单">
              <button type="button" class="game-menu-item primary" data-start-action="start">
                <span class="menu-selector"></span><span class="menu-index">01</span>
                <span class="menu-copy"><b>开始行动</b><small>ENTER OPERATIONS TOWN</small></span><span class="menu-key">ENTER</span>
              </button>
              <button type="button" class="game-menu-item" data-start-action="controls">
                <span class="menu-selector"></span><span class="menu-index">02</span>
                <span class="menu-copy"><b>行动手册</b><small>CONTROLS & FIELD GUIDE</small></span><span class="menu-key">F1</span>
              </button>
              <button type="button" class="game-menu-item" data-start-action="about">
                <span class="menu-selector"></span><span class="menu-index">03</span>
                <span class="menu-copy"><b>系统档案</b><small>MCACS ARCHIVE</small></span><span class="menu-key">F2</span>
              </button>
            </nav>
          </section>

          <aside class="mission-board" aria-label="当前行动简报">
            <header class="mission-header"><div><span>ACTIVE OPERATION</span><b>当前行动</b></div><em>LIVE</em></header>
            <section class="mission-name">
              <div><small>MISSION / OPS-071</small><b>守卫主世界</b></div><span class="mission-emblem">M</span>
            </section>
            <div class="tactical-map" aria-hidden="true">
              <span class="map-axis axis-x"></span><span class="map-axis axis-y"></span>
              <i class="map-point p1"></i><i class="map-point p2"></i><i class="map-point p3"></i>
              <div class="map-sweep"></div><small>OVERWATCH GRID / SECTOR 7</small>
            </div>
            <section class="threat-level">
              <div><span>THREAT LEVEL</span><b>威胁等级 · 低</b></div>
              <div class="threat-bars" aria-label="威胁等级 2/5"><i class="active"></i><i class="active"></i><i></i><i></i><i></i></div>
            </section>
            <div class="mission-stats">
              <div><strong>07</strong><span>检测路线<br><small>ACTIVE</small></span></div>
              <div><strong>03</strong><span>处置阶段<br><small>TRACKED</small></span></div>
              <div><strong>24H</strong><span>证据留痕<br><small>READY</small></span></div>
            </div>
            <div class="mission-routes"><span>FLY</span><span>SPEED</span><span>X-RAY</span><span>REACH</span></div>
            <footer class="mission-footer"><i></i><span>所有监控协议已装载</span><b>SECURE</b></footer>
          </aside>
        </main>

        <footer class="game-footer">
          <div class="game-status" role="status" aria-live="polite"><span class="game-status-dot" id="start-status-dot"></span><span id="start-status-text">正在载入监控小镇</span></div>
          <div class="game-shortcuts"><span><kbd>↑↓</kbd> 选择</span><span><kbd>ENTER</kbd> 确认</span><span><kbd>ESC</kbd> 返回</span></div>
          <span class="game-copyright">MCACS FIELD OPERATIONS © 2026</span>
        </footer>
      </div>

      <div class="start-modal-backdrop" id="start-modal-backdrop" hidden>
        <section class="start-modal" role="dialog" aria-modal="true" aria-labelledby="start-modal-title">
          <div class="modal-stripe"></div>
          <header><span>MCACS / FIELD DOSSIER</span><b>机密等级 · INTERNAL</b></header>
          <button class="start-modal-close" type="button" data-start-action="close" aria-label="关闭">ESC</button>
          <h2 id="start-modal-title"></h2><div id="start-modal-body"></div>
          <footer><span>ANTI-CHEAT COMMAND SYSTEM</span><b>0.1.1</b></footer>
        </section>
      </div>
    `

    document.body.appendChild(this.root)
    document.body.classList.add('start-menu')
    this.startButton = this.root.querySelector<HTMLButtonElement>('[data-start-action="start"]')!
    this.menuItems = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.game-menu-item'))
    this.statusDot = this.root.querySelector<HTMLElement>('#start-status-dot')!
    this.statusText = this.root.querySelector<HTMLElement>('#start-status-text')!
    this.nodeStatus = this.root.querySelector<HTMLElement>('#game-node-status')!
    this.clockText = this.root.querySelector<HTMLElement>('#game-clock')!
    this.modal = this.root.querySelector<HTMLElement>('#start-modal-backdrop')!
    this.modalTitle = this.root.querySelector<HTMLElement>('#start-modal-title')!
    this.modalBody = this.root.querySelector<HTMLElement>('#start-modal-body')!

    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLElement>('[data-start-action]')?.dataset.startAction
      if (action === 'start') this.start()
      if (action === 'controls') this.openModal('行动手册', this.controlsMarkup())
      if (action === 'about') this.openModal('系统档案', this.aboutMarkup())
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
    else if (status === 'connecting') this.setStatus('loading', '正在连接控制层')
    else this.setStatus('offline', '控制层等待连接')
  }

  private setStatus(status: StartScreenStatus, message?: string): void {
    const labels: Record<StartScreenStatus, string> = {
      loading: message ?? '正在载入监控小镇', ready: '行动区域已就绪 · 等待接管',
      online: '控制层在线 · 通讯安全', offline: '控制层等待连接', error: message ?? '小镇资源载入异常',
    }
    const nodeLabels: Record<StartScreenStatus, string> = {
      loading: 'BOOTING', ready: 'STANDBY', online: 'ONLINE', offline: 'OFFLINE', error: 'DEGRADED',
    }
    this.root.dataset.status = status
    this.statusText.textContent = labels[status]
    this.nodeStatus.textContent = nodeLabels[status]
    this.statusDot.className = `game-status-dot ${status}`
  }

  private updateClock(): void {
    this.clockText.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  }

  private start(): void {
    if (this.leaving) return
    this.leaving = true
    this.startButton.disabled = true
    this.startButton.querySelector('.menu-copy b')!.textContent = '正在接管行动区域'
    this.startButton.querySelector('.menu-copy small')!.textContent = 'INITIALIZING FIELD SYSTEMS'
    this.root.classList.add('leaving')
    document.body.classList.add('start-menu-leaving')
    if (this.clockTimer) clearInterval(this.clockTimer)
    window.setTimeout(() => {
      document.body.classList.remove('start-menu', 'start-menu-leaving')
      this.root.remove()
      window.removeEventListener('keydown', this.handleKeyDown)
      this.onStart()
    }, 720)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.modalOpen) { event.preventDefault(); this.closeModal(); return }
    if (this.modalOpen) return
    if (event.key === 'F1') { event.preventDefault(); this.openModal('行动手册', this.controlsMarkup()); return }
    if (event.key === 'F2') { event.preventDefault(); this.openModal('系统档案', this.aboutMarkup()); return }
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
    this.modalTitle.textContent = title; this.modalBody.innerHTML = body; this.modal.hidden = false; this.modalOpen = true
    this.modal.querySelector<HTMLButtonElement>('[data-start-action="close"]')?.focus()
  }

  private closeModal(): void { this.modal.hidden = true; this.modalOpen = false }

  private controlsMarkup(): string {
    return `<p class="start-modal-intro">进入行动区域后，使用以下指令观察玩家、案件与证据状态。</p>
      <div class="start-controls-grid">
        <div><kbd>中键拖拽</kbd><span><b>旋转镜头</b><small>ORBIT CAMERA</small></span></div>
        <div><kbd>Shift + 中键</kbd><span><b>平移镜头</b><small>PAN CAMERA</small></span></div>
        <div><kbd>滚轮</kbd><span><b>缩放视角</b><small>ZOOM VIEW</small></span></div>
        <div><kbd>右键拖拽</kbd><span><b>快速旋转</b><small>QUICK ORBIT</small></span></div>
        <div><kbd>空格</kbd><span><b>暂停检测</b><small>PAUSE FEED</small></span></div>
        <div><kbd>M</kbd><span><b>切换音效</b><small>TOGGLE ALERTS</small></span></div>
      </div><p class="start-modal-note"><i></i> 移动端支持单指旋转与双指缩放。</p>`
  }

  private aboutMarkup(): string {
    return `<p class="start-modal-intro">Minecraft Anti-Cheat Command System · 可视化反作弊运营控制台。</p>
      <div class="start-about-list">
        <div><span>行动场景</span><b>THREE.JS 3D 监控小镇</b></div><div><span>证据流程</span><b>采集 → 证据 → 案件 → 复核</b></div>
        <div><span>执行协议</span><b>ACK / NACK · ACTION ID</b></div><div><span>系统版本</span><b>MCACS BUILD 0.1.1</b></div>
      </div><p class="start-modal-note"><i></i> 让每一次判断都有证据，让每一次处理都可追踪。</p>`
  }
}
