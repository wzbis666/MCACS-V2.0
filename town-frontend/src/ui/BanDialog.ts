// BanDialog — ban confirmation dialog

export class BanDialog {
  private overlay: HTMLElement
  private durationSelect: HTMLSelectElement
  private reasonInput: HTMLInputElement
  private cancelBtn: HTMLElement
  private confirmBtn: HTMLElement
  private onConfirm: ((playerId: string, duration: string, reason: string) => void) | null = null
  private currentPlayerId: string | null = null

  constructor() {
    this.overlay = document.getElementById('ban-dialog-overlay')!
    this.durationSelect = document.getElementById('ban-duration') as HTMLSelectElement
    this.reasonInput = document.getElementById('ban-reason') as HTMLInputElement
    this.cancelBtn = document.getElementById('ban-cancel')!
    this.confirmBtn = document.getElementById('ban-confirm')!

    this.cancelBtn.addEventListener('click', () => this.hide())
    this.confirmBtn.addEventListener('click', () => this.confirm())
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })
  }

  setOnConfirm(callback: (playerId: string, duration: string, reason: string) => void): void {
    this.onConfirm = callback
  }

  show(playerId: string): void {
    this.currentPlayerId = playerId
    this.durationSelect.value = '24h'
    this.reasonInput.value = ''
    this.overlay.classList.add('visible')
  }

  hide(): void {
    this.overlay.classList.remove('visible')
    this.currentPlayerId = null
  }

  private confirm(): void {
    if (!this.currentPlayerId || !this.onConfirm) return
    const duration = this.durationSelect.value
    const reason = this.reasonInput.value.trim() || '未填写原因'
    this.onConfirm(this.currentPlayerId, duration, reason)
    this.hide()
  }
}
