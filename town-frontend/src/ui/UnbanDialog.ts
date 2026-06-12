// UnbanDialog — unban confirmation dialog with reason input

export class UnbanDialog {
  private overlay: HTMLElement
  private playerInfoEl: HTMLElement
  private reasonInput: HTMLInputElement
  private cancelBtn: HTMLElement
  private confirmBtn: HTMLElement
  private onConfirm: ((playerId: string, reason: string) => void) | null = null
  private currentPlayerId: string | null = null
  private currentPlayerName: string | null = null

  constructor() {
    this.overlay = document.getElementById('unban-dialog-overlay')!
    this.playerInfoEl = document.getElementById('unban-player-info')!
    this.reasonInput = document.getElementById('unban-reason') as HTMLInputElement
    this.cancelBtn = document.getElementById('unban-cancel')!
    this.confirmBtn = document.getElementById('unban-confirm')!

    this.cancelBtn.addEventListener('click', () => this.hide())
    this.confirmBtn.addEventListener('click', () => this.confirm())
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide()
    })
  }

  setOnConfirm(callback: (playerId: string, reason: string) => void): void {
    this.onConfirm = callback
  }

  show(playerId: string, playerName?: string, banInfo?: { reason?: string; duration?: string; bannedAt?: number }): void {
    this.currentPlayerId = playerId
    this.currentPlayerName = playerName ?? playerId
    this.reasonInput.value = ''

    // 显示封禁信息
    let infoText = `玩家 ${this.currentPlayerName} 当前处于封禁状态`
    if (banInfo) {
      const parts: string[] = []
      if (banInfo.reason) parts.push(`原因: ${banInfo.reason}`)
      if (banInfo.duration) parts.push(`时长: ${banInfo.duration}`)
      if (banInfo.bannedAt) {
        const d = new Date(banInfo.bannedAt)
        parts.push(`封禁于: ${d.toLocaleString('zh-CN', { hour12: false })}`)
      }
      if (parts.length > 0) {
        infoText += '\n' + parts.join(' | ')
      }
    }
    this.playerInfoEl.textContent = infoText
    this.playerInfoEl.style.whiteSpace = 'pre-line'

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
    const reason = this.reasonInput.value.trim() || '管理员手动解封'
    this.onConfirm(this.currentPlayerId, reason)
    this.hide()
  }
}
