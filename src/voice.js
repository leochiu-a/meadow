import { lang } from './i18n.js'

// DLV-06's voice: the browser's own speech synthesis, pitched down and a touch slow, so it
// sounds like an old delivery robot. Only the robot speaks; people in the recordings stay
// subtitles. Its volume is the mixer's robot-voice level (see audio.js), and it stays quiet
// until sound is on.

let audio = null
let voice = null

function pickVoice() {
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
export function useAudio(a) {
  audio = a
}

export function speak(words) {
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
