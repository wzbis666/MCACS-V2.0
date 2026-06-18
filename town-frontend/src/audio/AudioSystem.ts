/**
 * AudioSystem — 音效系统
 * 基于 Web Audio API，支持音效预加载、节流播放、主音量控制
 */

interface SoundConfig {
  src: string
  volume?: number
  throttleMs?: number
  loop?: boolean
}

const SOUNDS: Record<string, SoundConfig> = {
  alert:       { src: 'alert.mp3',        volume: 0.35 },
  ban:         { src: 'ban.mp3',          volume: 0.4 },
  freeze:      { src: 'freeze.mp3',       volume: 0.3 },
  click:       { src: 'click.mp3',        volume: 0.2, throttleMs: 100 },
  chat_pop:    { src: 'pop.mp3',          volume: 0.2, throttleMs: 300 },
  scene_switch:{ src: 'whoosh.mp3',       volume: 0.3 },
  complete:    { src: 'complete.mp3',     volume: 0.35 },
  error:       { src: 'error.mp3',        volume: 0.25 },
}

interface LoadedSound {
  buffer: AudioBuffer
  config: SoundConfig
  lastPlayTime: number
}

export class AudioSystem {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private sounds: Map<string, LoadedSound> = new Map()
  private _masterVolume = 0.7
  private _muted = false
  private basePath: string
  private initialized = false

  constructor(basePath: string = '/assets/music/') { this.basePath = basePath }

  async init(): Promise<boolean> {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      this.masterGain = this.audioContext.createGain()
      this.masterGain.connect(this.audioContext.destination)
      this.masterGain.gain.value = this._masterVolume
      this.sfxGain = this.audioContext.createGain()
      this.sfxGain.connect(this.masterGain)
      this.initialized = true
      return true
    } catch { return false }
  }

  async ensureResumed(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      try { await this.audioContext.resume() } catch { /* ignore */ }
    }
  }

  async preload(): Promise<void> {
    if (!this.audioContext) await this.init()
    for (const [key, config] of Object.entries(SOUNDS)) {
      try {
        const buffer = await this.loadAudioFile(config.src)
        this.sounds.set(key, { buffer, config, lastPlayTime: 0 })
      } catch { /* ignore missing files */ }
    }
  }

  private async loadAudioFile(filename: string): Promise<AudioBuffer> {
    if (!this.audioContext) throw new Error('AudioContext not initialized')
    const response = await fetch(this.basePath + filename)
    if (!response.ok) throw new Error(`Audio file not found: ${filename}`)
    return await this.audioContext.decodeAudioData(await response.arrayBuffer())
  }

  play(soundId: string, options?: { volume?: number }): void {
    if (!this.initialized || this._muted || !this.audioContext || !this.sfxGain) return
    const sound = this.sounds.get(soundId)
    if (!sound) return
    const now = performance.now()
    if (sound.config.throttleMs && now - sound.lastPlayTime < sound.config.throttleMs) return
    try {
      const source = this.audioContext.createBufferSource()
      source.buffer = sound.buffer
      if (sound.config.loop) source.loop = true
      const gainNode = this.audioContext.createGain()
      gainNode.gain.value = (options?.volume ?? 1) * (sound.config.volume ?? 1)
      source.connect(gainNode)
      gainNode.connect(this.sfxGain)
      source.start(0)
      sound.lastPlayTime = now
    } catch { /* ignore */ }
  }

  getAudioContext(): AudioContext | null { return this.audioContext }
  getSfxGain(): GainNode | null { return this.sfxGain }
  isReady(): boolean { return this.initialized }

  get masterVolume(): number { return this._masterVolume }
  set masterVolume(v: number) { this._masterVolume = Math.max(0, Math.min(1, v)); if (this.masterGain) this.masterGain.gain.value = this._masterVolume }
  get muted(): boolean { return this._muted }
  set muted(v: boolean) { this._muted = v; if (this.masterGain) this.masterGain.gain.value = v ? 0 : this._masterVolume }
  toggleMute(): void { this.muted = !this.muted }

  destroy(): void {
    if (this.audioContext) { this.audioContext.close(); this.audioContext = null }
    this.sounds.clear(); this.initialized = false
  }
}

let audioSystem: AudioSystem | null = null
export function getAudioSystem(): AudioSystem { if (!audioSystem) audioSystem = new AudioSystem(); return audioSystem }
