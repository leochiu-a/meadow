import { SONG, BEAT } from './song.js'

// The recordings in DLV-06's audio buffer, synthesized like the rest of the soundscape:
// sirens, rain, footsteps, a ticket gate, a train leaving. No voices: what people said is
// only in the robot's transcript (the subtitles, see echoes.js). Each recording runs through
// a worn-tape colour (band-limited, a little hiss) so it sounds recorded, not present.
// Recordings are the one thing in stereo (the world's mix is mono): rain and crowds spread
// wide, shovels and bangs land left or right, and sources that move (the ambulance,
// someone running) follow a path past the listener, panned by where they are on screen,
// louder as they pass and pitch bent by their speed.

const rand = (a, b) => a + Math.random() * (b - a)
const hz = (m) => 440 * 2 ** ((m - 69) / 12)

const buffers = new WeakMap()
function noise(ctx, kind) {
  let set = buffers.get(ctx)
  if (!set) buffers.set(ctx, (set = {}))
  if (set[kind]) return set[kind]
  const seconds = kind === 'click' ? 0.03 : 4
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1
    if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else if (kind === 'click') d[i] = w * (1 - i / d.length) ** 2
    else d[i] = w
  }
  return (set[kind] = buf)
}

function filter(ctx, type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = Q
  return f
}

// A stereo position for whatever goes into it: -1 left, 1 right (null: leave it centred).
function panned(ctx, dest, pan) {
  if (pan == null) return dest
  const p = ctx.createStereoPanner()
  p.pan.value = pan
  p.connect(dest)
  return p
}
const anywhere = (spread = 0.8) => rand(-spread, spread)

// A gain with an attack–hold–release envelope starting at t.
function envelope(ctx, dest, t, { attack = 0.005, hold = 0, release = 0.1, peak = 1 }) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.setValueAtTime(peak, t + attack + hold)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
  g.connect(dest)
  return g
}

function tone(ctx, dest, t, { type = 'sine', f, to = null, dur, ...env }) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(f, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  osc.connect(envelope(ctx, dest, t, { release: dur, ...env }))
  osc.start(t)
  osc.stop(t + dur + (env.hold ?? 0) + (env.attack ?? 0.005) + 0.05)
}

function burst(ctx, dest, t, { kind = 'click', type = 'bandpass', f = 1000, Q = 1, rate = 1, dur = 0.05, pan = null, ...env }) {
  dest = panned(ctx, dest, pan)
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx, kind)
  src.playbackRate.value = rate
  src.loop = kind !== 'click'
  src.connect(filter(ctx, type, f, Q)).connect(envelope(ctx, dest, t, { release: dur, ...env }))
  src.start(t, kind === 'click' ? 0 : rand(0, 3))
  src.stop(t + dur + (env.hold ?? 0) + 0.1)
}

// A noise bed from t to t + dur that fades in and out; `wide` spreads it across both
// speakers with two unrelated halves of noise.
function bed(ctx, dest, t, dur, { kind = 'white', type = 'bandpass', f = 1000, Q = 0.7, gain = 0.1, fade = 0.6, wide = false }) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + fade)
  g.gain.setValueAtTime(gain, t + dur - fade)
  g.gain.linearRampToValueAtTime(0, t + dur)
  g.connect(dest)
  for (const side of wide ? [-0.75, 0.75] : [null]) {
    const src = ctx.createBufferSource()
    src.buffer = noise(ctx, kind)
    src.loop = true
    const half = ctx.createGain()
    half.gain.value = wide ? Math.SQRT1_2 : 1
    src.connect(filter(ctx, type, f, Q)).connect(half).connect(panned(ctx, g, side))
    src.start(t, rand(0, 3.5))
    src.stop(t + dur + 0.1)
  }
  return g
}

// Something moving along `path` ([x, z] points) over dur seconds, heard from `listener`
// with `right` the screen's rightward direction: the returned input is loud as it passes
// and panned to its side, and doppler(s) gives the pitch factor s seconds in.
function mover(ctx, dest, t, dur, path, listener, right, { falloff = 0.006, push = 1 } = {}) {
  const lengths = [0]
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
  const total = lengths.at(-1)
  const at = (u) => {
    const s = u * total
    let i = 1
    while (i < path.length - 1 && lengths[i] < s) i++
    const k = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1)
    return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k]
  }
  const step = 0.05
  const n = Math.ceil(dur / step) + 1
  const points = Array.from({ length: n }, (_, i) => at(Math.min(1, (i * step) / dur)))
  const dist = points.map(([x, z]) => Math.hypot(x - listener.x, z - listener.z))
  const side = points.map(([x, z], i) => (((x - listener.x) * right[0] + (z - listener.z) * right[1]) / Math.max(dist[i], 2)) * 0.9)
  const p = ctx.createStereoPanner()
  p.pan.setValueCurveAtTime(Float32Array.from(side), t, dur)
  p.connect(dest)
  const g = ctx.createGain()
  g.gain.setValueCurveAtTime(Float32Array.from(dist, (d) => 1 / (1 + d * d * falloff)), t, dur)
  g.connect(p)
  const doppler = (s) => {
    const i = Math.min(n - 2, Math.max(0, Math.floor(s / step)))
    return 343 / (343 + ((dist[i + 1] - dist[i]) / step) * push)
  }
  return { input: g, doppler }
}

// Footsteps from t for dur seconds, steps a second apart `rate`; heavy for leather soles,
// light for sneakers; keys jingling with each step if `keys`.
function footsteps(ctx, dest, t, dur, { rate = 3, heavy = true, keys = false, slow = false }) {
  let s = 0
  while (s < dur) {
    const at = t + s
    tone(ctx, dest, at, { f: heavy ? 110 : 150, to: 60, dur: 0.07, peak: heavy ? 0.4 : 0.22 })
    burst(ctx, dest, at, { f: heavy ? 1300 : 2400, Q: 1.2, dur: 0.04, peak: heavy ? 0.22 : 0.12 })
    if (keys) for (let k = 0; k < 3; k++) tone(ctx, dest, at + rand(0, 0.06), { f: rand(3200, 6200), dur: 0.08, peak: 0.025 })
    s += (1 / rate) * (slow ? 1 + s / dur : 1) * rand(0.92, 1.08)
  }
}

// Out-of-breath panting: soft noise breaths in and out.
function panting(ctx, dest, t, dur, { period = 0.75, peak = 0.07 } = {}) {
  for (let s = 0; s < dur; s += period) {
    const fade = 1 - (s / dur) * 0.6
    burst(ctx, dest, t + s, { kind: 'white', f: 1100, Q: 0.9, attack: 0.08, dur: period * 0.45, peak: peak * fade })
  }
}

// Drips off an awning: little falling blips now and then.
function drips(ctx, dest, t, dur) {
  for (let s = rand(0.2, 0.8); s < dur; s += rand(0.5, 1.3)) tone(ctx, panned(ctx, dest, anywhere(0.6)), t + s, { f: rand(1500, 2100), to: 700, dur: 0.06, peak: 0.04 })
}

// A metal roller shutter pulled partway down.
function shutter(ctx, dest, t, dur = 1.4) {
  for (let s = 0; s < dur; s += 0.028) burst(ctx, dest, t + s, { f: 900 + (s / dur) * 900, Q: 5, dur: 0.03, peak: 0.16 * (1 - s / dur / 2) })
  burst(ctx, dest, t + dur, { type: 'lowpass', f: 500, rate: 0.5, dur: 0.25, peak: 0.6 })
}

// A heavy thud: something hitting something.
function thud(ctx, dest, t, peak = 0.45) {
  tone(ctx, dest, t, { f: 90, to: 45, dur: 0.25, peak })
  burst(ctx, dest, t, { type: 'lowpass', f: 900, dur: 0.06, peak: peak * 0.6 })
}

// Indistinct speech-like murmur: bandpassed noise in syllable-length puffs. Used for a crowd
// and for a PA heard through static; never for words.
function murmur(ctx, dest, t, dur, { peak = 0.05, low = 500, high = 1600, rate = 5, spread = 0 } = {}) {
  for (let s = 0; s < dur; s += rand(0.6, 1.4) / rate) burst(ctx, dest, t + s, { kind: 'white', f: rand(low, high), Q: 3, attack: 0.03, dur: rand(0.08, 0.2), peak: peak * rand(0.5, 1), pan: spread ? anywhere(spread) : null })
}

// The robot's own beep, the same two tones it makes when it gets a destination.
function robotBeep(ctx, dest, t, notes = [880, 1320]) {
  notes.forEach((f, i) => tone(ctx, dest, t + i * 0.08, { f, dur: 0.12, peak: 0.12 }))
}

// A motor hum like the robot's, at `speed` 0–1.
function motor(ctx, dest, t, dur, { from = 0.5, to = from, peak = 0.03 } = {}) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + 0.2)
  g.gain.setValueAtTime(peak, t + dur - 0.3)
  g.gain.linearRampToValueAtTime(0, t + dur)
  const lp = filter(ctx, 'lowpass', 700)
  lp.connect(g).connect(dest)
  for (const [type, base, k] of [['sawtooth', 70, 55], ['square', 141, 90]]) {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(base + from * k, t)
    osc.frequency.linearRampToValueAtTime(Math.max(8, base * (to > 0 ? 1 : 0.15) + to * k), t + dur)
    osc.connect(lp)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }
}

/**
 * 〈紅樓之夜〉 from t in a timbre: 'box' (a music box), 'radio' (an old transistor radio) or
 * 'speaker' (the robot's little speaker). Returns its length in seconds.
 */
export function playSong(ctx, dest, t, timbre = 'box', { peak = 0.2, notes = SONG } = {}) {
  const out = timbre === 'box' ? dest : filter(ctx, 'bandpass', timbre === 'radio' ? 1100 : 1500, 0.6)
  if (out !== dest) out.connect(dest)
  let s = 0
  for (const [m, beats] of notes) {
    const f = hz(m)
    const at = t + s
    if (timbre === 'box') {
      // Plucked steel tine: a clean partial, an octave and a bright inharmonic ping.
      tone(ctx, out, at, { f, dur: 1.4, attack: 0.002, peak })
      tone(ctx, out, at, { f: f * 2, dur: 0.6, attack: 0.002, peak: peak * 0.3 })
      tone(ctx, out, at, { f: f * 5.4, dur: 0.15, attack: 0.001, peak: peak * 0.12 })
    } else {
      tone(ctx, out, at, { type: timbre === 'radio' ? 'square' : 'triangle', f, dur: beats * BEAT * 0.9, attack: 0.02, peak })
    }
    s += beats * BEAT
  }
  return s
}

// Each recording: what plays (from t, into dest) and how long it lasts. `at` is where it was
// recorded and `path` the way something moved through it, both in world coordinates.
const ECHOES = {
  // 2049: the flood siren from the riverside, three long wails; people on the street.
  R1(ctx, dest, t) {
    murmur(ctx, dest, t, 13, { peak: 0.025, rate: 3, spread: 0.7 })
    bed(ctx, dest, t, 14, { kind: 'brown', f: 420, gain: 0.05, wide: true })
    const lp = filter(ctx, 'lowpass', 1400)
    const g = ctx.createGain()
    g.gain.value = 0.16
    lp.connect(g).connect(dest)
    for (let w = 0; w < 3; w++) {
      const at = t + 0.3 + w * 4.4
      for (const [type, k] of [['sawtooth', 1], ['sine', 2]]) {
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.setValueAtTime(300 * k, at)
        osc.frequency.linearRampToValueAtTime(760 * k, at + 1.8)
        osc.frequency.setValueAtTime(760 * k, at + 2.6)
        osc.frequency.linearRampToValueAtTime(300 * k, at + 4.2)
        const e = envelope(ctx, lp, at, { attack: 0.6, hold: 2.6, release: 1.2, peak: type === 'sine' ? 0.4 : 1 })
        osc.connect(e)
        osc.start(at)
        osc.stop(at + 4.5)
      }
    }
    return 14
  },
  // 2052, the typhoon night: rain, rushing water, a shutter battered by it, a neon sign that
  // buzzes and finally pops out.
  R2(ctx, dest, t) {
    bed(ctx, dest, t, 12, { type: 'highpass', f: 1600, gain: 0.22, fade: 0.8, wide: true })
    bed(ctx, dest, t, 12, { kind: 'brown', f: 340, Q: 1, gain: 0.7, fade: 1, wide: true })
    for (let s = rand(0.5, 1.2); s < 10.5; s += rand(1.1, 2.4)) {
      const pan = anywhere()
      burst(ctx, dest, t + s, { type: 'lowpass', f: 600, rate: 0.5, dur: 0.3, peak: 0.5, pan })
      tone(ctx, panned(ctx, dest, pan), t + s, { f: rand(200, 260), dur: 0.45, peak: 0.05 })
    }
    const buzz = ctx.createOscillator()
    buzz.type = 'sawtooth'
    buzz.frequency.value = 120
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    for (let s = 0.5; s < 9.4; s += rand(0.05, 0.3)) g.gain.setValueAtTime(Math.random() < 0.15 ? 0 : 0.03, t + s)
    g.gain.setValueAtTime(0, t + 9.5)
    buzz.connect(filter(ctx, 'bandpass', 2200, 3)).connect(g).connect(dest)
    buzz.start(t)
    buzz.stop(t + 9.6)
    burst(ctx, dest, t + 9.5, { type: 'highpass', f: 2000, dur: 0.08, peak: 0.6 })
    return 12
  },
  // 2052, the same night on Hanzhong Street: an ambulance's hi–lo siren comes up the street
  // and goes past, with the crew's radio crackling.
  R3(ctx, dest, t, { path, listener, right }) {
    bed(ctx, dest, t, 16, { type: 'highpass', f: 1800, gain: 0.08, wide: true })
    const run = 14
    const { input, doppler } = mover(ctx, dest, t + 0.5, run, path, listener, right, { falloff: 0.004, push: 3 })
    const lp = filter(ctx, 'lowpass', 3200)
    const g = ctx.createGain()
    g.gain.value = 0.22
    lp.connect(g).connect(input)
    for (const type of ['square', 'triangle']) {
      const osc = ctx.createOscillator()
      osc.type = type
      for (let s = 0; s < run; s += 0.05) osc.frequency.setValueAtTime((Math.floor(s / 0.45) % 2 ? 960 : 720) * doppler(s), t + 0.5 + s)
      osc.connect(lp)
      osc.start(t + 0.5)
      osc.stop(t + 0.5 + run)
    }
    bed(ctx, input, t + 0.5, run, { kind: 'brown', type: 'lowpass', f: 220, gain: 0.6 })
    for (const at of [5, 9.5]) {
      tone(ctx, dest, t + at - 0.2, { f: 1250, dur: 0.07, peak: 0.08 })
      bed(ctx, dest, t + at, 2.6, { f: 1800, Q: 2, gain: 0.05, fade: 0.1 })
      murmur(ctx, dest, t + at, 2.4, { peak: 0.04, low: 900, high: 2000, rate: 7 })
    }
    return 16
  },
  // 2052, the clean-up in front of the Red House: shovels scraping, buckets, and the song on
  // somebody's radio.
  R4(ctx, dest, t) {
    for (let i = 0; i < 18; i++) {
      const at = t + rand(0, 16)
      burst(ctx, dest, at, { kind: 'white', f: rand(1800, 3200), Q: 1.5, attack: 0.05, hold: 0.2, dur: 0.15, peak: rand(0.06, 0.12), pan: anywhere(0.9) })
    }
    for (let i = 0; i < 4; i++) {
      const at = t + rand(1, 15)
      const pan = anywhere()
      burst(ctx, dest, at, { type: 'lowpass', f: 800, dur: 0.1, peak: 0.3, pan })
      tone(ctx, panned(ctx, dest, pan), at, { f: rand(170, 220), dur: 0.5, peak: 0.05 })
    }
    murmur(ctx, dest, t, 17, { peak: 0.02, rate: 3, spread: 0.8 })
    bed(ctx, dest, t + 0.5, 16.5, { type: 'highpass', f: 3000, gain: 0.03 })
    // The radio sits off to one side, on somebody's bucket.
    playSong(ctx, panned(ctx, dest, -0.45), t + 1, 'radio', { peak: 0.045, notes: SONG.slice(0, 30) })
    return 18
  },
  // 2053: the station PA, chime then an announcement lost in static; a crowd stirs.
  R5(ctx, dest, t) {
    ;[79, 84, 88, 91].forEach((m, i) => tone(ctx, dest, t + 0.4 + i * 0.32, { f: hz(m), dur: 1, peak: 0.1 }))
    bed(ctx, dest, t + 2, 11, { f: 1500, Q: 0.8, gain: 0.05 })
    murmur(ctx, dest, t + 2.2, 10, { peak: 0.06, low: 700, high: 1700, rate: 6 })
    murmur(ctx, dest, t, 14, { peak: 0.02, rate: 3, spread: 0.9 })
    bed(ctx, dest, t, 14, { kind: 'brown', f: 500, gain: 0.06, wide: true })
    return 14
  },
  // 23:05, the record shop: the shutter half down, a box dragged across the floor, drips
  // off the awning.
  R6(ctx, dest, t) {
    drips(ctx, dest, t, 13)
    shutter(ctx, dest, t + 0.5)
    bed(ctx, dest, t + 3.6, 1.6, { kind: 'brown', type: 'lowpass', f: 300, gain: 0.35, fade: 0.2 })
    thud(ctx, dest, t + 5.3, 0.3)
    footsteps(ctx, dest, t + 10.5, 2.5, { rate: 1.8, slow: true })
    return 14
  },
  // 23:12, the record shop: a delivery robot's beep (DLV-06's own), the cargo lid, the
  // order accepted.
  R7(ctx, dest, t) {
    drips(ctx, dest, t, 10)
    motor(ctx, dest, t + 0.5, 9, { from: 0.05, peak: 0.02 })
    robotBeep(ctx, dest, t + 1.2)
    burst(ctx, dest, t + 4.2, { type: 'lowpass', f: 700, dur: 0.12, peak: 0.4 })
    burst(ctx, dest, t + 6.4, { type: 'lowpass', f: 600, dur: 0.15, peak: 0.5 })
    robotBeep(ctx, dest, t + 7.5, [880, 1320, 1760])
    return 10
  },
  // 23:20, the Red House square: skateboards rolling round, ollies and landings.
  R8(ctx, dest, t, { at, listener, right }) {
    const loop = Array.from({ length: 13 }, (_, i) => [at[0] + Math.cos((i / 12) * Math.PI * 2) * 7, at[1] + Math.sin((i / 12) * Math.PI * 2) * 7])
    for (const [delay, off] of [[0, 0], [1.4, 6]]) {
      const { input } = mover(ctx, dest, t + delay, 10, [...loop.slice(off), ...loop.slice(0, off + 1)], listener, right, { falloff: 0.02 })
      bed(ctx, input, t + delay, 10, { kind: 'brown', f: 260, Q: 1.2, gain: 0.5 })
      for (let s = 0; s < 10; s += 0.22) burst(ctx, input, t + delay + s, { f: 700, Q: 2, dur: 0.02, peak: 0.08 })
    }
    for (const s of [3.2, 7.4]) {
      burst(ctx, dest, t + s, { type: 'highpass', f: 1500, dur: 0.05, peak: 0.4 })
      thud(ctx, dest, t + s + 0.45, 0.35)
    }
    return 12
  },
  // 23:31, Chengdu Road: someone in leather shoes running, out of breath; something drops
  // and is left lying.
  R9(ctx, dest, t, { path, listener, right }) {
    const { input } = mover(ctx, dest, t, 8, path, listener, right, { falloff: 0.01 })
    footsteps(ctx, input, t, 8, { rate: 3 })
    panting(ctx, input, t, 8)
    burst(ctx, dest, t + 4.4, { type: 'highpass', f: 2500, dur: 0.04, peak: 0.45 })
    burst(ctx, dest, t + 4.56, { type: 'highpass', f: 2200, dur: 0.03, peak: 0.25 })
    burst(ctx, dest, t + 4.7, { type: 'highpass', f: 2000, dur: 0.02, peak: 0.1 })
    return 9
  },
  // 23:33, Hanzhong Street: lighter, quicker steps the other way, keys jingling.
  R10(ctx, dest, t, { path, listener, right }) {
    const { input } = mover(ctx, dest, t, 7.5, path, listener, right, { falloff: 0.01 })
    footsteps(ctx, input, t, 7.5, { rate: 3.6, heavy: false, keys: true })
    panting(ctx, input, t, 7.5, { period: 0.6, peak: 0.05 })
    return 8
  },
  // 23:38–23:40, Exit 6: running up, the ticket gate, calling out; the escalator down, the
  // door chime, the last train pulling away.
  R11(ctx, dest, t) {
    // He runs up from one side…
    const side = ctx.createStereoPanner()
    side.pan.setValueAtTime(0.7, t)
    side.pan.linearRampToValueAtTime(0, t + 2.6)
    side.connect(dest)
    const near = ctx.createGain()
    near.gain.setValueAtTime(0.3, t)
    near.gain.linearRampToValueAtTime(1, t + 2.5)
    near.connect(side)
    footsteps(ctx, near, t, 2.6, { rate: 3, slow: true })
    tone(ctx, dest, t + 3, { f: 1700, dur: 0.16, hold: 0.06, peak: 0.16 })
    burst(ctx, dest, t + 3.35, { type: 'lowpass', f: 700, dur: 0.12, peak: 0.45 })
    panting(ctx, dest, t + 2.6, 7)
    footsteps(ctx, dest, t + 9.4, 0.8, { rate: 2.5 })
    bed(ctx, dest, t + 10, 4.5, { kind: 'brown', type: 'lowpass', f: 180, gain: 0.25 })
    for (let s = 10.3; s < 14; s += 0.9) burst(ctx, dest, t + s, { f: 600, Q: 4, dur: 0.05, peak: 0.12 })
    ;[84, 79, 76, 79, 84, 81].forEach((m, i) => tone(ctx, dest, t + 14 + i * 0.28, { f: hz(m), dur: 0.5, peak: 0.08 }))
    thud(ctx, dest, t + 17, 0.35)
    const train = bed(ctx, dest, t + 17.4, 6.6, { kind: 'brown', type: 'lowpass', f: 400, gain: 0.7, fade: 0.1 })
    train.gain.cancelScheduledValues(t + 17.4)
    train.gain.setValueAtTime(0.1, t + 17.4)
    train.gain.linearRampToValueAtTime(0.7, t + 19.5)
    train.gain.exponentialRampToValueAtTime(0.001, t + 24)
    tone(ctx, dest, t + 17.6, { f: 220, to: 900, dur: 5.5, attack: 1.5, peak: 0.035 })
    return 24
  },
  // 23:41, Exit 6 square: running up and stopping, keys, catching breath; under the street
  // the train's rumble dies away.
  R12(ctx, dest, t) {
    const far = bed(ctx, dest, t, 6, { kind: 'brown', type: 'lowpass', f: 140, gain: 0.25, fade: 0.1, wide: true })
    far.gain.linearRampToValueAtTime(0, t + 6)
    // …she comes back from the other.
    const side = ctx.createStereoPanner()
    side.pan.setValueAtTime(-0.7, t)
    side.pan.linearRampToValueAtTime(0, t + 3.5)
    side.connect(dest)
    const near = ctx.createGain()
    near.gain.setValueAtTime(0.25, t)
    near.gain.linearRampToValueAtTime(1, t + 3.4)
    near.connect(side)
    footsteps(ctx, near, t, 3.5, { rate: 3.6, heavy: false, keys: true, slow: true })
    panting(ctx, dest, t + 3.5, 6, { period: 0.7, peak: 0.06 })
    for (let k = 0; k < 4; k++) tone(ctx, dest, t + 4 + rand(0, 0.2), { f: rand(3200, 6000), dur: 0.1, peak: 0.03 })
    return 12
  },
  // 23:47, Emei Street: a delivery robot bumping into the sandbags, its navigation erroring.
  R13(ctx, dest, t) {
    motor(ctx, dest, t, 2, { from: 0.6, to: 0.05 })
    thud(ctx, dest, t + 2, 0.4)
    robotBeep(ctx, dest, t + 2.6, [660, 440])
    robotBeep(ctx, dest, t + 4.3, [660, 880, 1100])
    motor(ctx, dest, t + 4.6, 1.5, { from: 0.6, to: 0.05 })
    thud(ctx, dest, t + 6, 0.4)
    robotBeep(ctx, dest, t + 6.6, [660, 440])
    return 10
  },
  // 23:52, the robot's own last recording: the street's mains hum and distant voices cut out
  // all at once; in the silence its own motor winds down and stops.
  R14(ctx, dest, t) {
    const hum = ctx.createGain()
    hum.gain.setValueAtTime(0.05, t)
    hum.gain.setValueAtTime(0, t + 5)
    hum.connect(dest)
    for (const f of [60, 120, 180]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = f
      osc.connect(hum)
      osc.start(t)
      osc.stop(t + 5)
    }
    const life = ctx.createGain()
    life.gain.setValueAtTime(1, t)
    life.gain.setValueAtTime(0, t + 5)
    life.connect(dest)
    murmur(ctx, life, t, 5, { peak: 0.02, rate: 2, spread: 0.8 })
    burst(ctx, dest, t + 5, { type: 'lowpass', f: 400, dur: 0.08, peak: 0.3 })
    robotBeep(ctx, dest, t + 6.3, [880, 660, 440])
    motor(ctx, dest, t + 6, 4, { from: 0.4, to: 0, peak: 0.04 })
    return 14
  },
}

// The worn-tape colour every recording plays through.
function tape(ctx, dest, t, dur, gain) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.setValueAtTime(gain, t + dur - 0.4)
  g.gain.linearRampToValueAtTime(0, t + dur)
  const hp = filter(ctx, 'highpass', 140)
  const lp = filter(ctx, 'lowpass', 6500)
  hp.connect(lp).connect(g).connect(dest)
  bed(ctx, g, t, dur, { type: 'highpass', f: 4000, gain: 0.012, fade: 0.2, wide: true })
  return hp
}

/**
 * Plays recording `id` from t into dest. where: { at, path, listener } in world coordinates,
 * and right: the screen's rightward [x, z], for panning. Returns its length in seconds.
 */
export function playEcho(ctx, dest, id, t, where = {}, gain = 1) {
  const right = where.right ?? [1, 0]
  const listener = where.listener ?? { x: where.at?.[0] ?? 0, z: where.at?.[1] ?? 0 }
  const at = where.at ?? [listener.x, listener.z]
  const path = where.path ?? [at, at]
  const input = ctx.createGain()
  const length = ECHOES[id](ctx, input, t, { at, path, listener, right })
  input.connect(tape(ctx, dest, t, length, gain))
  return length
}

// A short phrase of R8's wheels going by, for the skaters' last lap.
export function playWheels(ctx, dest, t) {
  const g = tape(ctx, dest, t, 3, 0.8)
  bed(ctx, g, t, 2.6, { kind: 'brown', f: 260, Q: 1.2, gain: 0.4 })
  for (let s = 0; s < 2.6; s += 0.22) burst(ctx, g, t + s, { f: 700, Q: 2, dur: 0.02, peak: 0.06 })
}
