import type { CaseEvidenceSnapshot, InvestigationCaseSummary, SemanticEvidenceEvent } from '../types.js'
import { CHEAT_TYPE_LABELS } from '../types.js'

type FetchEvidence = (caseId: string) => Promise<CaseEvidenceSnapshot | null>

export class EvidenceTimeline {
  private readonly root: HTMLElement
  private readonly content: HTMLElement
  private fetchEvidence: FetchEvidence | null = null
  private snapshot: CaseEvidenceSnapshot | null = null
  private investigationCase: InvestigationCaseSummary | null = null
  private currentTime = 0
  private speed = 1
  private playing = false
  private timer: number | null = null

  constructor() {
    this.installStyles()
    this.root = document.createElement('aside')
    this.root.id = 'evidence-timeline'
    this.root.setAttribute('aria-label', '案件证据回放')
    this.root.innerHTML = '<div class="evidence-timeline-content"></div>'
    this.content = this.root.querySelector('.evidence-timeline-content')!
    this.root.addEventListener('click', event => this.handleClick(event))
    this.root.addEventListener('input', event => this.handleInput(event))
    document.body.appendChild(this.root)
  }

  setOnFetch(callback: FetchEvidence): void {
    this.fetchEvidence = callback
  }

  async open(investigationCase: InvestigationCaseSummary): Promise<void> {
    this.stop()
    this.investigationCase = investigationCase
    this.snapshot = null
    this.content.innerHTML = this.loadingMarkup(investigationCase.playerName)
    this.root.classList.add('visible')
    const snapshot = await this.fetchEvidence?.(investigationCase.id) ?? null
    if (!snapshot || this.investigationCase?.id !== investigationCase.id) {
      this.content.innerHTML = this.emptyMarkup(investigationCase.playerName)
      return
    }
    this.snapshot = snapshot
    this.currentTime = snapshot.events[0]?.timestamp ?? snapshot.capturedAt
    this.render()
  }

  close(): void {
    this.stop()
    this.root.classList.remove('visible')
  }

  destroy(): void {
    this.stop()
    this.root.remove()
  }

  private handleClick(event: MouseEvent): void {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-timeline-action]')?.dataset.timelineAction
    if (action === 'close') this.close()
    if (action === 'play') {
      this.playing ? this.stop() : this.play()
      this.render()
    }
    if (action === 'speed') {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 0.5 : 1
      this.render()
    }
  }

  private handleInput(event: Event): void {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-timeline-scrubber]')
    if (!input) return
    this.stop()
    this.currentTime = Number(input.value)
    this.render()
  }

  private play(): void {
    if (!this.snapshot || this.snapshot.events.length === 0 || this.timer !== null) return
    const end = this.snapshot.events[this.snapshot.events.length - 1].timestamp
    if (this.currentTime >= end) this.currentTime = this.snapshot.events[0].timestamp
    this.playing = true
    let previous = performance.now()
    this.timer = window.setInterval(() => {
      const now = performance.now()
      this.currentTime += (now - previous) * this.speed
      previous = now
      if (this.currentTime >= end) {
        this.currentTime = end
        this.stop()
      }
      this.render()
    }, 100)
  }

  private stop(): void {
    this.playing = false
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private render(): void {
    if (!this.snapshot || !this.investigationCase) return
    const events = this.snapshot.events
    const start = events[0]?.timestamp ?? this.snapshot.windowStart
    const end = events[events.length - 1]?.timestamp ?? this.snapshot.windowEnd
    const currentEvent = [...events].reverse().find(item => item.timestamp <= this.currentTime) ?? events[0]
    const eventIndex = currentEvent ? events.indexOf(currentEvent) + 1 : 0

    this.content.innerHTML = `
      <header class="evidence-header">
        <div><small>SEMANTIC REPLAY / 离线证据</small><h2>${this.escape(this.investigationCase.playerName)}</h2></div>
        <button type="button" data-timeline-action="close" aria-label="关闭证据回放">×</button>
      </header>
      <div class="evidence-path">${this.renderPath(events, currentEvent)}</div>
      ${this.renderXRayAnalysis()}
      ${this.renderPhysicsAnalysis()}
      ${this.renderScaffoldAnalysis()}
      <div class="evidence-context">${this.renderContext(currentEvent)}</div>
      <div class="evidence-event">
        <span>${eventIndex} / ${events.length}</span>
        <strong>${currentEvent ? this.describeEvent(currentEvent) : '暂无语义事件'}</strong>
        <time>${currentEvent ? this.formatOffset(currentEvent.timestamp - this.snapshot.capturedAt) : '—'}</time>
      </div>
      <input data-timeline-scrubber type="range" min="${start}" max="${Math.max(start, end)}" step="25" value="${Math.min(Math.max(this.currentTime, start), end)}" aria-label="证据时间轴" ${events.length === 0 ? 'disabled' : ''}>
      <footer class="evidence-controls">
        <button type="button" data-timeline-action="play" ${events.length === 0 ? 'disabled' : ''}>${this.playing ? '暂停' : '播放'}</button>
        <button type="button" data-timeline-action="speed">${this.speed}×</button>
        <span>${this.snapshot.complete ? '窗口已冻结' : '仍在采集后置窗口'} · ${(this.snapshot.byteSize / 1024).toFixed(1)} KB</span>
      </footer>
    `
  }

  private renderContext(event?: SemanticEvidenceEvent): string {
    if (!event) return '<span>TPS —</span><span>Ping —</span><span>状态效果 —</span><span class="exemption">豁免 —</span>'
    return `
      <span>TPS <b>${event.tps.toFixed(1)}</b></span>
      <span>Ping <b>${event.ping === null ? '未上报' : `${event.ping} ms`}</b></span>
      <span>状态效果 <b>${this.escape(event.statusEffects.join(', ') || '无')}</b></span>
      <span class="exemption">豁免 <b>${this.escape(event.exemptions.join(', ') || '未应用')}</b></span>
    `
  }

  private renderPath(events: SemanticEvidenceEvent[], current?: SemanticEvidenceEvent): string {
    if (this.snapshot?.xrayAnalysis?.trajectory.length) {
      return this.renderMineScene()
    }
    if (this.snapshot?.scaffoldAnalysis?.path.length) return this.renderScaffoldPath()
    if (this.snapshot?.physicsAnalysis?.frames.length) return this.renderPhysicsEnvelope()
    const movements = events.filter((event): event is Extract<SemanticEvidenceEvent, { type: 'movement' }> => event.type === 'movement')
    if (movements.length < 2) return '<div class="evidence-path-empty">轨迹样本不足，仍可查看语义事件</div>'
    const minX = Math.min(...movements.map(item => item.x)); const maxX = Math.max(...movements.map(item => item.x))
    const minZ = Math.min(...movements.map(item => item.z)); const maxZ = Math.max(...movements.map(item => item.z))
    const point = (value: number, min: number, max: number, size: number) => max === min ? size / 2 : 12 + ((value - min) / (max - min)) * (size - 24)
    const points = movements.map(item => `${point(item.x, minX, maxX, 430)},${point(item.z, minZ, maxZ, 110)}`).join(' ')
    const currentMovement = current?.type === 'movement' ? current : [...movements].reverse().find(item => item.timestamp <= (current?.timestamp ?? this.currentTime)) ?? movements[0]
    const cx = point(currentMovement.x, minX, maxX, 430); const cy = point(currentMovement.z, minZ, maxZ, 110)
    return `<svg viewBox="0 0 430 110" role="img" aria-label="玩家移动轨迹"><polyline points="${points}"/><circle cx="${cx}" cy="${cy}" r="5"/></svg>`
  }

  private renderPhysicsEnvelope(): string {
    const analysis = this.snapshot?.physicsAnalysis
    if (!analysis || analysis.frames.length === 0) return ''
    const max = Math.max(1, ...analysis.frames.flatMap(frame => [frame.actualHorizontalSpeed, frame.legalHorizontalSpeed]))
    const point = (value: number, index: number) => `${12 + index / Math.max(1, analysis.frames.length - 1) * 406},${100 - value / max * 84}`
    const actual = analysis.frames.map((frame, index) => point(frame.actualHorizontalSpeed, index)).join(' ')
    const legal = analysis.frames.map((frame, index) => point(frame.legalHorizontalSpeed, index)).join(' ')
    return `<svg viewBox="0 0 430 110" role="img" aria-label="实际速度与合法物理范围"><polyline points="${legal}" class="legal-envelope"/><polyline points="${actual}" class="actual-trajectory"/></svg>`
  }

  private renderScaffoldPath(): string {
    const analysis = this.snapshot?.scaffoldAnalysis
    if (!analysis || analysis.path.length === 0) return ''
    const minX = Math.min(...analysis.path.map(item => item.x)); const maxX = Math.max(...analysis.path.map(item => item.x))
    const minZ = Math.min(...analysis.path.map(item => item.z)); const maxZ = Math.max(...analysis.path.map(item => item.z))
    const map = (value: number, min: number, max: number, size: number) => max === min ? size / 2 : 12 + (value - min) / (max - min) * (size - 24)
    const points = analysis.path.map(item => `${map(item.x,minX,maxX,430)},${map(item.z,minZ,maxZ,110)}`).join(' ')
    const nodes = analysis.path.map(item => `<circle cx="${map(item.x,minX,maxX,430)}" cy="${map(item.z,minZ,maxZ,110)}" r="3"><title>${item.placedFace} · ${item.pitch.toFixed(0)}°</title></circle>`).join('')
    return `<svg viewBox="0 0 430 110" role="img" aria-label="Scaffold 放置路径与放置面"><polyline points="${points}" class="actual-trajectory"/>${nodes}</svg>`
  }

  private renderMineScene(): string {
    const analysis = this.snapshot?.xrayAnalysis
    if (!analysis) return ''
    const allPoints = [...analysis.trajectory, ...analysis.oreContext]
    const projected = allPoints.map(point => ({ x: point.x - point.z, y: (point.x + point.z) * 0.32 - point.y * 0.7 }))
    const minX = Math.min(...projected.map(point => point.x)); const maxX = Math.max(...projected.map(point => point.x))
    const minY = Math.min(...projected.map(point => point.y)); const maxY = Math.max(...projected.map(point => point.y))
    const mapX = (value: number) => maxX === minX ? 215 : 15 + (value - minX) / (maxX - minX) * 400
    const mapY = (value: number) => maxY === minY ? 55 : 12 + (value - minY) / (maxY - minY) * 86
    const project = (point: { x: number; y: number; z: number }) => ({ x: mapX(point.x - point.z), y: mapY((point.x + point.z) * .32 - point.y * .7) })
    const path = analysis.trajectory.map(point => { const p = project(point); return `${p.x},${p.y}` }).join(' ')
    const ores = analysis.oreContext.map(ore => {
      const p = project(ore)
      return `<rect x="${p.x - 3}" y="${p.y - 3}" width="6" height="6" class="${ore.exposed ? 'ore-exposed' : 'ore-hidden'}"><title>${this.escape(ore.type)} · ${ore.exposed ? '已暴露' : '未暴露'}</title></rect>`
    }).join('')
    const hits = analysis.trajectory.filter(point => point.valuable).map(point => {
      const p = project(point)
      return `<circle cx="${p.x}" cy="${p.y}" r="4" class="ore-hit"/>`
    }).join('')
    return `<svg viewBox="0 0 430 110" role="img" aria-label="X-Ray 地下调查轨迹"><polyline points="${path}"/>${ores}${hits}</svg>`
  }

  private renderXRayAnalysis(): string {
    const analysis = this.snapshot?.xrayAnalysis
    if (!analysis) return ''
    const deviation = analysis.shortestPathDeviation === null ? '样本不足' : `${(analysis.shortestPathDeviation * 100).toFixed(0)}%`
    return `
      <section class="xray-analysis">
        <div class="xray-metrics">
          <span>高价值命中 <b>${(analysis.valuableHitEfficiency * 100).toFixed(1)}%</b></span>
          <span>最短路偏差 <b>${deviation}</b></span>
          <span>跨样本异常 <b>${analysis.crossSampleAnomaly.toFixed(1)}σ</b></span>
          <span>隐矿转向 <b>${analysis.hiddenDirectionMatches}/${analysis.turnCount}</b></span>
        </div>
        <div class="xray-compare">
          <p><small>正常分支挖矿</small>${analysis.comparison.normal}</p>
          <p class="suspicious"><small>疑似追矿</small>${analysis.comparison.suspicious}</p>
        </div>
      </section>
    `
  }

  private renderPhysicsAnalysis(): string {
    const analysis = this.snapshot?.physicsAnalysis
    if (!analysis) return ''
    return `<div class="physics-legend"><span><i class="actual"></i>实际轨迹</span><span><i class="legal"></i>合法物理上限</span><b>${analysis.exceededFrames} 帧越界</b><em>${analysis.exemptedFrames} 帧应用豁免</em></div>`
  }

  private renderScaffoldAnalysis(): string {
    const analysis = this.snapshot?.scaffoldAnalysis
    if (!analysis) return ''
    return `<div class="scaffold-metrics"><span>平均间隔 <b>${analysis.averageIntervalMs === null ? '—' : `${analysis.averageIntervalMs.toFixed(0)} ms`}</b></span><span>快速放置 <b>${analysis.rapidPlacements}</b></span><span>向下视线 <b>${(analysis.downwardLookRatio*100).toFixed(0)}%</b></span><span>异常放置面 <b>${(analysis.unusualFaceRatio*100).toFixed(0)}%</b></span></div>`
  }

  private describeEvent(event: SemanticEvidenceEvent): string {
    if (event.type === 'movement') return `移动至 ${event.x.toFixed(1)}, ${event.y.toFixed(1)}, ${event.z.toFixed(1)}`
    if (event.type === 'combat') return `攻击距离 ${event.distance.toFixed(2)} · ${event.cps} CPS`
    if (event.type === 'block') return `${event.action === 'break' ? '挖掘' : '放置'} ${this.escape(event.blockType)}`
    if (event.type === 'action') return `${this.escape(event.action)} ${event.state ? '开始' : '结束'}`
    return `检测 ${CHEAT_TYPE_LABELS[event.cheatType] ?? event.cheatType} · ${event.confidence}`
  }

  private formatOffset(offset: number): string {
    const seconds = offset / 1000
    return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(1)}s`
  }

  private loadingMarkup(playerName: string): string {
    return `<div class="evidence-state"><small>SEMANTIC REPLAY</small><strong>${this.escape(playerName)}</strong><p>正在读取冻结的案件窗口…</p></div>`
  }

  private emptyMarkup(playerName: string): string {
    return `<div class="evidence-state"><button type="button" data-timeline-action="close">×</button><small>SEMANTIC REPLAY</small><strong>${this.escape(playerName)}</strong><p>此案件尚无离线证据快照。</p></div>`
  }

  private escape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }

  private installStyles(): void {
    if (document.getElementById('evidence-timeline-styles')) return
    const style = document.createElement('style')
    style.id = 'evidence-timeline-styles'
    style.textContent = `
      #evidence-timeline { position: fixed; left: 18px; bottom: 18px; z-index: 34; width: min(470px, calc(100vw - 36px)); max-height: min(680px, calc(100vh - 36px)); display: flex; flex-direction: column; overflow: hidden; opacity: 0; pointer-events: none; transform: translateY(15px); color: #e0e6f0; background: rgba(10, 10, 18, 0.96); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4); transition: opacity .22s ease, transform .22s ease; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
      #evidence-timeline.visible { opacity: 1; pointer-events: auto; transform: none; }
      .evidence-header { display: flex; justify-content: space-between; align-items: start; padding: 16px 18px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
      .evidence-header small, .evidence-state small { color: #45E796; font: 11px/1.4 'Segoe UI', system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; font-weight: 600; }
      .evidence-header h2 { margin: 4px 0 0; color: #fff; font: 600 18px/1.2 'Segoe UI', system-ui, -apple-system, sans-serif; }
      .evidence-header button, .evidence-state button { color: rgba(255,255,255,.5); background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; width: 30px; height: 30px; font-size: 16px; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; }
      .evidence-header button:hover, .evidence-state button:hover { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(69,231,150,.3); }
      .evidence-timeline-content { display: flex; flex-direction: column; overflow: hidden; }
      .evidence-path { height: 118px; margin: 11px 14px 8px; overflow: hidden; background: radial-gradient(circle at center, rgba(69,231,150,.06), transparent 65%), linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size: auto, 22px 22px, 22px 22px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; }
      .evidence-path svg { width: 100%; height: 100%; }
      .evidence-path polyline { fill: none; stroke: #45E796; stroke-width: 2; vector-effect: non-scaling-stroke; }
      .evidence-path circle { fill: #ffa502; filter: drop-shadow(0 0 5px rgba(255,165,2,.8)); }
      .evidence-path .ore-hidden { fill: #ff4757; stroke: #ff6b6b; stroke-width: 1; }
      .evidence-path .ore-exposed { fill: #2da66e; stroke: #45E796; stroke-width: 1; }
      .evidence-path .ore-hit { fill: #ffa502; stroke: #ffd700; stroke-width: 1; }
      .evidence-path .legal-envelope { fill: none; stroke: rgba(69,231,150,.45); stroke-width: 6; opacity: .28; }
      .evidence-path .actual-trajectory { fill: none; stroke: #ffa502; stroke-width: 2; }
      .evidence-path-empty { display: grid; place-items: center; height: 100%; color: #6a6a8a; font-size: 10px; }
      .xray-analysis { margin: 0 14px 8px; }
      .xray-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: rgba(255,255,255,.06); border-radius: 6px; overflow: hidden; }
      .xray-metrics span { padding: 8px; color: #6a6a8a; background: rgba(10,10,18,.6); font-size: 9px; }
      .xray-metrics b { display: block; margin-top: 4px; color: #45E796; font-weight: 500; }
      .xray-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin-top: 1px; background: rgba(255,255,255,.06); border-radius: 6px; overflow: hidden; }
      .xray-compare p { margin: 0; padding: 8px; color: #6a6a8a; background: rgba(69,231,150,.04); font-size: 9px; line-height: 1.45; }
      .xray-compare p.suspicious { background: rgba(255,71,87,.06); }
      .xray-compare small { display: block; margin-bottom: 3px; color: #45E796; font-size: 9px; }
      .xray-compare .suspicious small { color: #ff4757; }
      .physics-legend, .scaffold-metrics { display: flex; align-items: center; gap: 10px; margin: 0 14px 8px; padding: 8px 10px; color: #6a6a8a; background: rgba(255,255,255,.03); border-radius: 6px; font-size: 9px; }
      .physics-legend i { display: inline-block; width: 12px; height: 2px; margin-right: 4px; vertical-align: middle; }
      .physics-legend i.actual { background: #ffa502; } .physics-legend i.legal { height: 5px; background: rgba(69,231,150,.45); }
      .physics-legend b { margin-left: auto; color: #ff4757; font-weight: 500; } .physics-legend em { color: #45E796; font-style: normal; }
      .scaffold-metrics { display: grid; grid-template-columns: repeat(4,1fr); }
      .scaffold-metrics b { display: block; margin-top: 3px; color: #45E796; font-weight: 500; }
      .evidence-context { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; margin: 0 14px 8px; background: rgba(255,255,255,.06); border-radius: 6px; overflow: hidden; }
      .evidence-context span { min-width: 0; padding: 8px; overflow: hidden; color: #6a6a8a; background: rgba(10,10,18,.6); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
      .evidence-context b { display: block; margin-top: 4px; overflow: hidden; color: #e0e6f0; font-weight: 500; text-overflow: ellipsis; }
      .evidence-context .exemption b { color: #45E796; }
      .evidence-event { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 7px 15px; }
      .evidence-event span, .evidence-event time { color: #6a6a8a; font-size: 9px; }
      .evidence-event strong { overflow: hidden; color: #e0e6f0; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
      #evidence-timeline input[type=range] { width: calc(100% - 30px); margin: 5px 15px; accent-color: #45E796; }
      .evidence-controls { display: flex; align-items: center; gap: 6px; padding: 8px 15px 14px; }
      .evidence-controls button { padding: 7px 12px; color: rgba(255,255,255,.6); background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; font: 10px/1 'Segoe UI', system-ui, sans-serif; cursor: pointer; transition: all .2s; }
      .evidence-controls button:hover { color: #fff; background: rgba(255,255,255,.1); border-color: rgba(69,231,150,.3); }
      .evidence-controls button:disabled { opacity: .4; cursor: not-allowed; }
      .evidence-controls span { margin-left: auto; color: #6a6a8a; font-size: 9px; }
      .evidence-state { position: relative; padding: 32px 22px; }
      .evidence-state strong { display: block; margin: 6px 0; color: #fff; font-weight: 600; }
      .evidence-state p { margin: 0; color: #6a6a8a; font-size: 11px; }
      .evidence-state button { position: absolute; top: 12px; right: 14px; }
      @media (prefers-color-scheme: light) {
        #evidence-timeline { color: #1a1f2e; background: rgba(240,244,250,.88); border-color: rgba(60,80,140,.15); box-shadow: 0 8px 32px rgba(0,0,0,.1); }
        .evidence-header { border-bottom-color: rgba(60,80,140,.1); }
        .evidence-header small { color: #2da66e; }
        .evidence-header h2 { color: #1a1f2e; }
        .evidence-header button { color: rgba(60,80,140,.5); background: rgba(0,0,0,.04); border-color: rgba(60,80,140,.15); }
        .evidence-path { border-color: rgba(60,80,140,.1); background: radial-gradient(circle at center, rgba(45,166,110,.04), transparent 65%), linear-gradient(rgba(0,0,0,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.03) 1px, transparent 1px); }
        .xray-metrics, .xray-compare, .evidence-context { background: rgba(60,80,140,.1); }
        .xray-metrics span, .evidence-context span { background: rgba(240,244,250,.6); }
        .evidence-event strong { color: #1a1f2e; }
        .evidence-controls button { color: rgba(60,80,140,.6); background: rgba(0,0,0,.03); border-color: rgba(60,80,140,.15); }
        .evidence-state strong { color: #1a1f2e; }
      }
      @media (max-width: 640px) { #evidence-timeline { left: 10px; bottom: 10px; width: calc(100vw - 20px); max-height: calc(100vh - 20px); overflow-y: auto; } .evidence-path { height: 100px; } .evidence-context, .xray-metrics { grid-template-columns: repeat(2, 1fr); } }
    `
    document.head.appendChild(style)
  }
}
