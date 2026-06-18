// AlertSound — Web Audio API synthesized alert sounds

import type { Confidence } from '../types.js'

export class AlertSound {
  private ctx: AudioContext | null = null

  private getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    return this.ctx
  }

  playAlert(confidence: Confidence): void {
    const ctx = this.getContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }

    switch (confidence) {
      case 'low':
        this.playBeep(ctx, 880, 0.08, 0.15)
        break
      case 'medium':
        this.playBeep(ctx, 880, 0.08, 0.15)
        setTimeout(() => this.playBeep(ctx, 1100, 0.08, 0.15), 150)
        break
      case 'high':
        this.playAlarm(ctx)
        break
    }
  }

  playBanSound(): void {
    const ctx = this.getContext()
    if (ctx.state === 'suspended') {
      ctx.resume()
    }
    this.playBeep(ctx, 440, 0.3, 0.25)
    setTimeout(() => this.playBeep(ctx, 330, 0.4, 0.2), 300)
  }

  private playBeep(ctx: AudioContext, freq: number, duration: number, volume: number): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.value = freq

    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration + 0.01)
  }

  private playAlarm(ctx: AudioContext): void {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = 'square'
    osc.frequency.setValueAtTime(600, ctx.currentTime)
    osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.15)
    osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.3)

    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01)
    gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.25)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.45)

    // Second burst
    setTimeout(() => {
      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.type = 'square'
      osc2.frequency.setValueAtTime(600, ctx.currentTime)
      osc2.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.15)
      osc2.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.3)
      gain2.gain.setValueAtTime(0, ctx.currentTime)
      gain2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01)
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.25)
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
      osc2.start(ctx.currentTime)
      osc2.stop(ctx.currentTime + 0.45)
    }, 450)
  }
}
