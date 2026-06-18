// WhitelistDialog — whitelist confirmation dialog with reason input

export class WhitelistDialog {
  private overlay: HTMLElement
  private playerInfoEl: HTMLElement
  private reasonInput: HTMLInputElement
  private cancelBtn: HTMLElement
  private confirmBtn: HTMLElement
  private onConfirm: ((playerId: string, reason: string) => void) | null = null
  private currentPlayerId: string | null = null
  private currentPlayerName: string | null = null

  constructor() {
    this.overlay = document.getElementById('whitelist-dialog-overlay')!
    this.playerInfoEl = document.getElementById('whitelist-player-info')!
    this.reasonInput = document.getElementById('whitelist-reason') as HTMLInputElement
    this.cancelBtn = document.getElementById('whitelist-cancel')!
    this.confirmBtn = document.getElementById('whitelist-confirm')!

    this.cancelBtn.addEventListener('click', () => this.hide())
    this.confirmBtn.addEventListener('click', () => this.confirm())
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })
  }

  setOnConfirm(callback: (playerId: string, reason: string) => void): void {
    this.onConfirm = callback
  }

  show(playerId: string, playerName?: string): void {
    this.currentPlayerId = playerId
    this.currentPlayerName = playerName ?? playerId
    this.reasonInput.value = ''

    this.playerInfoEl.textContent = `将玩家 ${this.currentPlayerName} 加入白名单后，系统将不再对其执行自动处罚`

    this.overlay.classList.add('visible')
  }

  hide(): void {
    this.overlay.classList.remove('visible')
    this.currentPlayerId = null
    this.currentPlayerName = null
  }

  isVisible(): boolean {
    return this.overlay.classList.contains('visible')
  }

  private confirm(): void {
    if (!this.currentPlayerId || !this.onConfirm) return
    const reason = this.reasonInput.value.trim() || '管理员手动添加'
    this.onConfirm(this.currentPlayerId, reason)
    this.hide()
  }
}
