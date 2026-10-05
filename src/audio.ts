// Soundscape built with the Web Audio API: wind, rustling leaves, birdsong, animal calls
// and the robot's motor, all synthesized, under the scene's background music track.
// ambience 'city' swaps the meadow's breeze for wind whistling through dead streets,
// creaking signs, rattling shutters and crows. DLV-06's recordings (see echo-audio.js) and
// the song play on their own story channel, with the rest of the mix ducked under them.
// The world is mixed to mono, the same in both speakers; only the recordings are in stereo,
// so the past opens up around the listener while the present stays flat.

import { playEcho, playSong, playWheels, type EchoWhere, type SongTimbre } from './echo-audio.ts'
import { ECHO_IDS, type EchoId } from './echoes.ts'
import type { PointXZ } from './collision.ts'
import type { Voices, WorldEvent } from './world.ts'

export type { SongTimbre }
export type Ambience = 'meadow' | 'city'

const PENTATONIC = [0, 2, 4, 7, 9]
// The mixer's channels, each with its own volume (0–1) on top of the master.
// 'voice' is the robot's speech (see voice.js): the browser speaks it, outside this graph.
export const CHANNELS = ['music', 'ambience', 'weather', 'animals', 'robot', 'voice', 'echo', 'ui'] as const
export type Channel = (typeof CHANNELS)[number]
// The channels mixed in this graph: the voice is spoken by the browser, outside it.
type Bus = Exclude<Channel, 'voice'>
type LevelName = Channel | 'master'
// The default mix, balanced from measured levels: the music leads, wind and the robot's
// motor (both constant) sit well under it, rain a little under, and the short sounds
// (animal calls, the radar and the find chime) stay full so they cut through, as do the
// recordings, which have the stage to themselves while they play.
export const DEFAULT_LEVELS: Record<LevelName, number> = { master: 1, music: 1, ambience: 0.5, weather: 0.8, animals: 1, robot: 0.35, voice: 0.8, echo: 1, ui: 1 }
// While a recording or the song plays, the world around it drops to this much.
const DUCK: Partial<Record<Bus, number>> = { music: 0.15, ambience: 0.25, weather: 0.35, animals: 0.3, robot: 0.6 }
const DUCKED = Object.keys(DUCK) as Bus[]
const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12)
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function noiseBuffer(ctx: BaseAudioContext, seconds: number, kind: 'white' | 'brown') {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    } else {
      data[i] = white
    }
  }
  return buf
}

// The sounds built once with the graph and driven every frame.
interface Sfx {
  click: AudioBuffer
  motorA: OscillatorNode
  motorB: OscillatorNode
  motorGain: GainNode
  pluck: GainNode
  rainGain: GainNode
}
// A world sound placed at (x, z), heard from the listener.
type Call = (x: number, z: number, listener: PointXZ) => void

export function createAudio(ambience: Ambience = 'meadow', music: string | null = null, levels: Partial<Record<LevelName, number>> = {}) {
  const city = ambience === 'city'
  // The graph exists from the first start() on (browsers only allow audio after a gesture);
  // nothing below touches it before then.
  let ctx!: AudioContext
  let master!: GainNode
  let enabled = true
  let started = false
  let sfx!: Sfx
  // Volume per channel plus 'master'; the user's mixer settings, applied once audio exists.
  const level = { ...DEFAULT_LEVELS, ...levels }
  // Each channel: dry goes straight out, wet also feeds the room reverb.
  let bus!: Record<Bus, { dry: GainNode; wet: GainNode }>
  const timers = { bird: 2, creak: 6, rattle: 14, crow: 9 }
  const animalTimers = new Map<PointXZ, number>()

  // Until when (audio clock) the mix stays ducked.
  let duckUntil = 0
  let ducked = false

  const masterTarget = () => (enabled ? 0.9 * level.master : 0)
  const busTarget = (name: Bus) => level[name] * (ducked ? (DUCK[name] ?? 1) : 1)
  function setLevel(name: LevelName, value: number, ramp = 0.05) {
    level[name] = value
    if (!ctx) return
    if (name === 'master') master.gain.setTargetAtTime(started ? masterTarget() : 0, ctx.currentTime, ramp)
    else if (name !== 'voice') for (const node of Object.values(bus[name])) node.gain.setTargetAtTime(busTarget(name), ctx.currentTime, ramp)
  }
  function duck(seconds: number) {
    duckUntil = Math.max(duckUntil, ctx.currentTime + seconds)
    if (ducked) return
    ducked = true
    for (const name of DUCKED) setLevel(name, level[name], 0.35)
  }

  function loopNoise(kind: 'white' | 'brown', seconds = 4) {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, seconds, kind)
    src.loop = true
    src.start()
    return src
  }

  function lfo(freq: number, depth: number, target: AudioParam, offset: number) {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = depth
    osc.connect(g).connect(target)
    target.value = offset
    osc.start()
  }

  // Distant sounds are quieter; the world plays in mono, so nothing in it sits left or right.
  function spatial(x: number, z: number, listener: PointXZ, channel: Bus) {
    const d = Math.hypot(x - listener.x, z - listener.z)
    const g = ctx.createGain()
    g.gain.value = 1 / (1 + d * d * 0.012)
    g.connect(bus[channel].wet)
    return { input: g, distance: d }
  }

  function build() {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    // The world folds down to one channel here, then plays the same in both speakers.
    const mono = ctx.createGain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.connect(master)

    // Gentle room so everything sits in the same space.
    const verb = ctx.createConvolver()
    const ir = ctx.createBuffer(1, ctx.sampleRate * 2.2, ctx.sampleRate)
    const decay = ir.getChannelData(0)
    for (let i = 0; i < decay.length; i++) decay[i] = (Math.random() * 2 - 1) * (1 - i / decay.length) ** 3
    verb.buffer = ir
    const verbGain = ctx.createGain()
    verbGain.gain.value = 0.25
    verb.connect(verbGain).connect(mono)
    // A short decaying noise tick, the raw material for rattles, wingbeats and barks.
    const click = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate)
    const tick = click.getChannelData(0)
    for (let i = 0; i < tick.length; i++) tick[i] = (Math.random() * 2 - 1) * (1 - i / tick.length) ** 2
    const channel = (c: Bus) => {
      const dry = ctx.createGain()
      const wet = ctx.createGain()
      // The story channel skips the fold-down: recordings keep their stereo.
      const out = c === 'echo' ? master : mono
      dry.connect(out)
      wet.connect(out)
      wet.connect(verb)
      return { dry, wet }
    }
    bus = { music: channel('music'), ambience: channel('ambience'), weather: channel('weather'), animals: channel('animals'), robot: channel('robot'), echo: channel('echo'), ui: channel('ui') }
    for (const c of CHANNELS) setLevel(c, level[c])

    // Wind: low brown noise with slow gusts.
    const wind = loopNoise('brown', 6)
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.Q.value = 0.7
    const windGain = ctx.createGain()
    wind.connect(windFilter).connect(windGain).connect(bus.ambience.dry)
    lfo(0.07, 260, windFilter.frequency, 520)
    lfo(0.11, 0.07, windGain.gain, 0.16)

    // Leaves: airy high band that breathes with the gusts.
    const leaves = loopNoise('white', 3)
    const leafFilter = ctx.createBiquadFilter()
    leafFilter.type = 'bandpass'
    leafFilter.frequency.value = 5200
    leafFilter.Q.value = 0.8
    const leafGain = ctx.createGain()
    leaves.connect(leafFilter).connect(leafGain).connect(bus.ambience.dry)
    lfo(0.09, 0.012, leafGain.gain, city ? 0.008 : 0.016)

    // City wind: a hollow whistle through broken windows that rises with the gusts.
    if (city) {
      const howl = loopNoise('white', 4)
      const howlFilter = ctx.createBiquadFilter()
      howlFilter.type = 'bandpass'
      howlFilter.Q.value = 18
      const howlGain = ctx.createGain()
      howl.connect(howlFilter).connect(howlGain).connect(bus.ambience.dry)
      lfo(0.05, 220, howlFilter.frequency, 640)
      lfo(0.08, 0.05, howlGain.gain, 0.06)
    }

    // Robot motor: buzzy pair of oscillators, pitch and level follow speed.
    const motorA = ctx.createOscillator()
    motorA.type = 'sawtooth'
    const motorB = ctx.createOscillator()
    motorB.type = 'square'
    const motorFilter = ctx.createBiquadFilter()
    motorFilter.type = 'lowpass'
    motorFilter.frequency.value = 700
    const motorGain = ctx.createGain()
    motorGain.gain.value = 0
    motorA.connect(motorFilter)
    motorB.connect(motorFilter)
    motorFilter.connect(motorGain).connect(bus.robot.wet)
    motorA.start()
    motorB.start()

    const rainGain = buildRain()

    // Plucked notes (the find chime), kept soft and warm.
    const pluck = ctx.createGain()
    pluck.gain.value = 0.11
    const pluckTone = ctx.createBiquadFilter()
    pluckTone.type = 'lowpass'
    pluckTone.frequency.value = 2600
    pluck.connect(pluckTone).connect(bus.ui.wet)
    sfx = { click, motorA, motorB, motorGain, pluck, rainGain }

    if (music) playMusic(music)
  }

  // The scene's background track, decoded whole so it loops without a gap.
  async function playMusic(url: string) {
    const data = await (await fetch(url)).arrayBuffer()
    const src = ctx.createBufferSource()
    src.buffer = await ctx.decodeAudioData(data)
    src.loop = true
    const g = ctx.createGain()
    g.gain.value = 0.4
    src.connect(g).connect(bus.music.dry)
    src.start()
  }

  function chirp(listener: PointXZ) {
    const x = listener.x + rand(-18, 18)
    const z = listener.z + rand(-14, 8)
    const { input } = spatial(x, z, listener, 'animals')
    const t0 = ctx.currentTime
    const notes = Math.floor(rand(2, 7))
    const base = rand(2600, 4200)
    const style = Math.random()
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * rand(0.09, 0.16)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const g = ctx.createGain()
      const f = base * (style < 0.5 ? 1 + i * 0.04 : 1.15 - (i % 2) * 0.2)
      osc.frequency.setValueAtTime(f * 0.8, t)
      osc.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.04)
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.08)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.05, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
      osc.connect(g).connect(input)
      osc.start(t)
      osc.stop(t + 0.1)
    }
  }

  function moo(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 40) return
    const t = ctx.currentTime
    const dur = rand(1.2, 1.9)
    const pitch = rand(95, 125)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(pitch * 0.8, t)
    osc.frequency.linearRampToValueAtTime(pitch * 1.15, t + dur * 0.3)
    osc.frequency.linearRampToValueAtTime(pitch * 0.7, t + dur)
    // Vowel-ish formants: "mm" opening into "oo".
    const f1 = ctx.createBiquadFilter()
    f1.type = 'bandpass'
    f1.Q.value = 4
    f1.frequency.setValueAtTime(300, t)
    f1.frequency.linearRampToValueAtTime(650, t + dur * 0.35)
    f1.frequency.linearRampToValueAtTime(380, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.25)
    g.gain.setValueAtTime(0.45, t + dur * 0.7)
    g.gain.linearRampToValueAtTime(0, t + dur)
    osc.connect(f1).connect(g).connect(input)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  function cluck(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 25) return
    const t0 = ctx.currentTime
    const n = Math.floor(rand(2, 5))
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.12, 0.2)
      const osc = ctx.createOscillator()
      osc.type = 'square'
      const f = rand(420, 560) * (i === n - 1 ? 1.4 : 1)
      osc.frequency.setValueAtTime(f, t)
      osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.07)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1200
      bp.Q.value = 3
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
      osc.connect(bp).connect(g).connect(input)
      osc.start(t)
      osc.stop(t + 0.1)
    }
  }

  // A hanging sign swinging on a rusty hinge somewhere nearby.
  function creak(listener: PointXZ) {
    const { input } = spatial(listener.x + rand(-16, 16), listener.z + rand(-12, 8), listener, 'ambience')
    const t = ctx.currentTime
    const dur = rand(0.5, 1.2)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = rand(180, 320)
    osc.frequency.setValueAtTime(f, t)
    osc.frequency.linearRampToValueAtTime(f * rand(1.3, 1.8), t + dur * 0.6)
    osc.frequency.linearRampToValueAtTime(f * 1.1, t + dur)
    // Stick-slip: a fast tremolo makes it grind rather than sing.
    const grind = ctx.createGain()
    const trem = ctx.createOscillator()
    trem.frequency.value = rand(28, 45)
    const tremDepth = ctx.createGain()
    tremDepth.gain.value = 0.5
    trem.connect(tremDepth).connect(grind.gain)
    grind.gain.value = 0.5
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1400
    bp.Q.value = 5
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.06, t + 0.1)
    g.gain.linearRampToValueAtTime(0, t + dur)
    osc.connect(grind).connect(bp).connect(g).connect(input)
    osc.start(t)
    trem.start(t)
    osc.stop(t + dur)
    trem.stop(t + dur)
  }

  // A loose roller shutter rattling in a gust.
  function rattle(listener: PointXZ) {
    const { input } = spatial(listener.x + rand(-14, 14), listener.z + rand(-10, 6), listener, 'ambience')
    const t0 = ctx.currentTime
    const n = Math.floor(rand(5, 12))
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.04, 0.09)
      const src = ctx.createBufferSource()
      src.buffer = sfx.click
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = rand(900, 1600)
      bp.Q.value = 6
      const g = ctx.createGain()
      g.gain.value = 0.12 * (1 - i / n)
      src.connect(bp).connect(g).connect(input)
      src.start(t)
    }
  }

  // A crow somewhere over the rooftops.
  function caw(listener: PointXZ) {
    const { input } = spatial(listener.x + rand(-20, 20), listener.z + rand(-18, 4), listener, 'ambience')
    const t0 = ctx.currentTime
    const n = Math.floor(rand(2, 4))
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.35, 0.5)
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      const f = rand(380, 460)
      osc.frequency.setValueAtTime(f * 1.1, t)
      osc.frequency.linearRampToValueAtTime(f * 0.85, t + 0.25)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 1300
      bp.Q.value = 2.5
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.09, t + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
      osc.connect(bp).connect(g).connect(input)
      osc.start(t)
      osc.stop(t + 0.3)
    }
  }

  // Pigeon: a soft throaty "coo-COO-oo".
  function coo(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 20) return
    const t0 = ctx.currentTime
    ;[[0, 0.18, 0.7], [0.22, 0.32, 1], [0.58, 0.25, 0.6]].forEach(([at, dur, vol]) => {
      const t = t0 + at
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      const f = rand(260, 300)
      osc.frequency.setValueAtTime(f * 0.9, t)
      osc.frequency.linearRampToValueAtTime(f * 1.08, t + dur * 0.4)
      osc.frequency.linearRampToValueAtTime(f * 0.85, t + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.09 * vol, t + dur * 0.3)
      g.gain.linearRampToValueAtTime(0, t + dur)
      osc.connect(g).connect(input)
      osc.start(t)
      osc.stop(t + dur)
    })
  }

  // Cat: "mi-aow", a rising then falling nasal glide.
  function meow(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 25) return
    const t = ctx.currentTime
    const dur = rand(0.45, 0.8)
    const f = rand(520, 700)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(f * 0.8, t)
    osc.frequency.linearRampToValueAtTime(f * 1.25, t + dur * 0.35)
    osc.frequency.linearRampToValueAtTime(f * 0.7, t + dur)
    const formant = ctx.createBiquadFilter()
    formant.type = 'bandpass'
    formant.Q.value = 3
    formant.frequency.setValueAtTime(900, t)
    formant.frequency.linearRampToValueAtTime(1800, t + dur * 0.35)
    formant.frequency.linearRampToValueAtTime(800, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.12, t + 0.06)
    g.gain.setValueAtTime(0.1, t + dur * 0.6)
    g.gain.linearRampToValueAtTime(0, t + dur)
    osc.connect(formant).connect(g).connect(input)
    osc.start(t)
    osc.stop(t + dur)
  }

  // Dog: one or two short "woof"s, a noisy burst over a dropping tone.
  function bark(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 35) return
    const t0 = ctx.currentTime
    const n = Math.random() < 0.5 ? 1 : 2
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.22, 0.3)
      const osc = ctx.createOscillator()
      osc.type = 'square'
      const f = rand(230, 300)
      osc.frequency.setValueAtTime(f * 1.3, t)
      osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.12)
      const noise = ctx.createBufferSource()
      noise.buffer = sfx.click
      const formant = ctx.createBiquadFilter()
      formant.type = 'bandpass'
      formant.frequency.value = 700
      formant.Q.value = 1.5
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
      osc.connect(formant)
      noise.connect(formant)
      formant.connect(g).connect(input)
      osc.start(t)
      noise.start(t)
      osc.stop(t + 0.16)
    }
  }

  // A flock taking off: a burst of wingbeats that fades as it climbs away.
  function flutter(x: number, z: number, listener: PointXZ) {
    const { input, distance } = spatial(x, z, listener, 'animals')
    if (distance > 25) return
    const t0 = ctx.currentTime
    for (let i = 0; i < 26; i++) {
      const t = t0 + i * rand(0.025, 0.05)
      const src = ctx.createBufferSource()
      src.buffer = sfx.click
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = rand(500, 1100)
      bp.Q.value = 1.2
      const g = ctx.createGain()
      g.gain.value = 0.25 * (1 - i / 26)
      src.connect(bp).connect(g).connect(input)
      src.start(t)
    }
  }

  // Radar beep: brighter and higher the closer the relic.
  function ping(signal: number) {
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 900 + signal * 700
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.03 + signal * 0.04, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    osc.connect(g).connect(bus.ui.wet)
    osc.start(t)
    osc.stop(t + 0.1)
  }

  // A find: a bright little arpeggio up the pentatonic scale.
  function chime() {
    const now = ctx.currentTime + 0.02
    ;[0, 2, 4, 7].forEach((step, i) => pluck(77 + PENTATONIC[step % 5] + (step >= 5 ? 12 : 0), now + i * 0.09, 0.5, 1.4))
  }

  // Calls each kind of animal makes on its own, and how many seconds apart.
  const VOICES: Record<keyof Voices, [Call, number, number]> = { cow: [moo, 14, 40], chicken: [cluck, 3, 10], pigeon: [coo, 6, 16], cat: [meow, 25, 60], dog: [bark, 30, 70] }
  const CUES: Partial<Record<string, Call>> = { meow, bark, flutter }

  // Rain: a hiss of fine drops over a softer patter, both silent until it rains.
  function buildRain() {
    const rainGain = ctx.createGain()
    rainGain.gain.value = 0
    rainGain.connect(bus.weather.dry)
    const hiss = loopNoise('white', 3)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2200
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 9000
    const hissGain = ctx.createGain()
    hissGain.gain.value = 0.16
    hiss.connect(hp).connect(lp).connect(hissGain).connect(rainGain)
    const patter = loopNoise('brown', 4)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700
    bp.Q.value = 0.6
    const patterGain = ctx.createGain()
    patterGain.gain.value = 0.5
    patter.connect(bp).connect(patterGain).connect(rainGain)
    return rainGain
  }

  // Thunder: a crack, then a long low rumble rolling off.
  function thunder(delay: number) {
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, 6, 'brown')
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900, t)
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.08)
    g.gain.exponentialRampToValueAtTime(0.35, t + 1.5)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5)
    src.connect(lp).connect(g).connect(bus.weather.wet)
    src.start(t)
    src.stop(t + 6)
  }

  function pluck(midi: number, when: number, vol = 0.5, dur = 1.6) {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = midiToHz(midi)
    const over = ctx.createOscillator()
    over.type = 'sine'
    over.frequency.value = midiToHz(midi) * 3
    const og = ctx.createGain()
    og.gain.value = 0.15
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(vol, when + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    osc.connect(g)
    over.connect(og).connect(g)
    g.connect(sfx.pluck)
    osc.start(when)
    over.start(when)
    osc.stop(when + dur)
    over.stop(when + dur)
  }

  return {
    get enabled() {
      return enabled
    },
    // How loud the robot's voice should be, 0 while sound is off.
    get voiceVolume() {
      return started && enabled ? level.master * level.voice : 0
    },
    // Mixer volume (0–1) for 'master' or one of CHANNELS.
    setLevel,
    start() {
      if (!ctx) build()
      if (ctx.state === 'suspended') ctx.resume()
      started = true
      master.gain.setTargetAtTime(masterTarget(), ctx.currentTime, 0.4)
    },
    toggle() {
      // The very first press only unlocks audio; later presses mute/unmute.
      if (!started) {
        this.start()
        return enabled
      }
      enabled = !enabled
      master.gain.setTargetAtTime(masterTarget(), ctx.currentTime, 0.2)
      return enabled
    },
    // Short two-tone "boop" when the robot gets a new destination.
    beep() {
      if (!started) return
      const t = ctx.currentTime
      ;[880, 1320].forEach((f, i) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = f
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t + i * 0.08)
        g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.08 + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.12)
        osc.connect(g).connect(bus.robot.wet)
        osc.start(t + i * 0.08)
        osc.stop(t + i * 0.08 + 0.13)
      })
    },
    /**
     * Recording `id` from DLV-06's buffer; where: { at, path, listener }. Returns how long it
     * lasts in seconds, 0 when sound is off (the subtitles then pace themselves).
     */
    echo(id: EchoId, where: EchoWhere) {
      if (!started || !enabled) return 0
      const t = ctx.currentTime + 0.6
      const length = playEcho(ctx, bus.echo.wet, id, t, where)
      duck(length + 1)
      return length
    },
    // Letting the recordings go: all of them at once, faint, rising away until they are gone.
    release() {
      if (!started || !enabled) return
      const t = ctx.currentTime + 0.3
      const away = ctx.createBiquadFilter()
      away.type = 'highpass'
      away.frequency.setValueAtTime(80, t)
      away.frequency.exponentialRampToValueAtTime(7000, t + 16)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.5, t)
      g.gain.linearRampToValueAtTime(0, t + 18)
      away.connect(g).connect(bus.echo.wet)
      ECHO_IDS.forEach((id, i) => playEcho(ctx, away, id, t + i * 0.45, {}, 0.35))
      duck(19)
    },
    // 〈紅樓之夜〉 from a music box ('box') or the robot's speaker ('speaker'), on the story
    // channel with the recordings. Returns its length.
    song(timbre: SongTimbre) {
      if (!started || !enabled) return 0
      const length = playSong(ctx, bus.echo.wet, ctx.currentTime + 0.3, timbre, { peak: timbre === 'box' ? 0.12 : 0.08 })
      duck(length + 0.8)
      return length
    },
    // The skaters' wheels going round once more.
    wheels() {
      if (started && enabled) playWheels(ctx, bus.echo.wet, ctx.currentTime + 0.1)
    },
    // A one-off sound an animal made: { kind, x, z }.
    cue({ kind, x, z }: WorldEvent, listener: PointXZ) {
      if (started && enabled) CUES[kind]?.(x, z, listener)
    },
    thunder(delay: number) {
      if (started && enabled) thunder(delay)
    },
    ping(signal: number) {
      if (started && enabled) ping(signal)
    },
    chime() {
      if (started && enabled) chime()
    },
    update(dt: number, { listener, robotSpeed, voices = {}, rain = 0 }: { listener: PointXZ; robotSpeed: number; voices?: Voices; rain?: number }) {
      if (!started || !enabled) return
      const now = ctx.currentTime
      if (ducked && now > duckUntil) {
        ducked = false
        for (const name of DUCKED) setLevel(name, level[name], 0.8)
      }
      sfx.rainGain.gain.setTargetAtTime(rain * 0.9, now, 0.5)
      sfx.motorA.frequency.setTargetAtTime(70 + robotSpeed * 55, now, 0.05)
      sfx.motorB.frequency.setTargetAtTime(141 + robotSpeed * 90, now, 0.05)
      sfx.motorGain.gain.setTargetAtTime(robotSpeed * 0.035, now, 0.08)

      // Birds keep quiet in the rain.
      timers.bird -= dt * (1 - rain)
      if (timers.bird <= 0) {
        timers.bird = city ? rand(3, 9) : rand(1.2, 5)
        chirp(listener)
      }
      if (city) {
        for (const [key, fn, min, max] of [['creak', creak, 5, 14], ['rattle', rattle, 10, 26], ['crow', caw, 12, 30]] as const) {
          timers[key] -= dt
          if (timers[key] <= 0) {
            timers[key] = rand(min, max)
            fn(listener)
          }
        }
      }
      for (const kind of Object.keys(voices) as (keyof Voices)[]) {
        const list = voices[kind] ?? []
        const [fn, min, max] = VOICES[kind]

        for (const p of list) {
          let t = animalTimers.get(p)
          if (t === undefined) t = rand(min * 0.3, max)
          t -= dt
          if (t <= 0) {
            fn(p.x, p.z, listener)
            t = rand(min, max)
          }
          animalTimers.set(p, t)
        }
      }
    },
  }
}
