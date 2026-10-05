import { lang } from './i18n.ts'

// DLV-06's voice: the browser's own speech synthesis, pitched down and a touch slow, so it
// sounds like an old delivery robot. Only the robot speaks; people in the recordings stay
// subtitles. Its volume is the mixer's robot-voice level (see audio.js), and it stays quiet
// until sound is on.

// What the voice needs from the soundscape: its robot-voice level, 0 while muted.
export interface VoiceLevel {
  readonly voiceVolume: number
}

let audio: VoiceLevel | null = null
let voice: SpeechSynthesisVoice | null = null

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  const want = lang === 'zh' ? ['zh-TW', 'zh-HK', 'zh'] : ['en-US', 'en-GB', 'en']
  for (const tag of want) {
    const v = voices.find((v) => v.lang.replace('_', '-').startsWith(tag))
    if (v) return v
  }
  return null
}

const supported = typeof speechSynthesis !== 'undefined'
if (supported) {
  voice = pickVoice()
  speechSynthesis.addEventListener?.('voiceschanged', () => (voice = pickVoice()))
}

// The soundscape whose robot-voice level and mute it follows.
export function useAudio(a: VoiceLevel) {
  audio = a
}

export function speak(words: string) {
  const volume = audio?.voiceVolume ?? 0
  if (!supported || volume <= 0) return
  const u = new SpeechSynthesisUtterance(words)
  u.lang = voice?.lang ?? (lang === 'zh' ? 'zh-TW' : 'en-US')
  if (voice) u.voice = voice
  u.pitch = 0.55
  u.rate = 0.92
  u.volume = Math.min(1, volume)
  speechSynthesis.speak(u)
}
