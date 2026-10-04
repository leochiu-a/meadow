// Procedural soundscape built with the Web Audio API: wind, rustling leaves, birdsong,
// cows, chickens, the robot's motor, and a soft music-box melody. No audio files needed.

const PENTATONIC = [0, 2, 4, 7, 9]
const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12)
const rand = (a, b) => a + Math.random() * (b - a)

function noiseBuffer(ctx, seconds, kind) {
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

export function createAudio() {
  let ctx = null
  let master = null
  let enabled = true
  let started = false
  const sfx = {}
  const timers = { bird: 2, music: 0, chord: 0 }
  const animalTimers = new Map()

  function loopNoise(kind, seconds = 4) {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, seconds, kind)
    src.loop = true
    src.start()
    return src
  }

  function lfo(freq, depth, target, offset) {
    const osc = ctx.createOscillator()
    osc.frequency.value = freq
    const g = ctx.createGain()
    g.gain.value = depth
    osc.connect(g).connect(target)
    target.value = offset
    osc.start()
  }

  function spatial(x, z, listener) {
    const d = Math.hypot(x - listener.x, z - listener.z)
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.max(-1, Math.min(1, (x - listener.x) / 14))
    const g = ctx.createGain()
    g.gain.value = 1 / (1 + d * d * 0.012)
    pan.connect(g).connect(sfx.fx)
    return { input: pan, distance: d }
  }

  function build() {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    // Gentle room so everything sits in the same space.
    const verb = ctx.createConvolver()
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2.2, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3
    }
    verb.buffer = ir
    const verbGain = ctx.createGain()
    verbGain.gain.value = 0.25
    verb.connect(verbGain).connect(master)
    sfx.fx = ctx.createGain()
    sfx.fx.connect(master)
    sfx.fx.connect(verb)

    // Wind: low brown noise with slow gusts.
    const wind = loopNoise('brown', 6)
    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.Q.value = 0.7
    const windGain = ctx.createGain()
    wind.connect(windFilter).connect(windGain).connect(master)
    lfo(0.07, 260, windFilter.frequency, 520)
    lfo(0.11, 0.07, windGain.gain, 0.16)

    // Leaves: airy high band that breathes with the gusts.
    const leaves = loopNoise('white', 3)
    const leafFilter = ctx.createBiquadFilter()
    leafFilter.type = 'bandpass'
    leafFilter.frequency.value = 5200
    leafFilter.Q.value = 0.8
    const leafGain = ctx.createGain()
    leaves.connect(leafFilter).connect(leafGain).connect(master)
    lfo(0.09, 0.012, leafGain.gain, 0.016)

    // Robot motor: buzzy pair of oscillators, pitch and level follow speed.
    sfx.motorA = ctx.createOscillator()
    sfx.motorA.type = 'sawtooth'
    sfx.motorB = ctx.createOscillator()
    sfx.motorB.type = 'square'
    const motorFilter = ctx.createBiquadFilter()
    motorFilter.type = 'lowpass'
    motorFilter.frequency.value = 700
    sfx.motorGain = ctx.createGain()
    sfx.motorGain.gain.value = 0
    sfx.motorA.connect(motorFilter)
    sfx.motorB.connect(motorFilter)
    motorFilter.connect(sfx.motorGain).connect(sfx.fx)
    sfx.motorA.start()
    sfx.motorB.start()

    // Music bus kept soft and warm.
    sfx.music = ctx.createGain()
    sfx.music.gain.value = 0.11
    const musicTone = ctx.createBiquadFilter()
    musicTone.type = 'lowpass'
    musicTone.frequency.value = 2600
    sfx.music.connect(musicTone).connect(master)
    musicTone.connect(verb)
  }

  function chirp(listener) {
    const x = listener.x + rand(-18, 18)
    const z = listener.z + rand(-14, 8)
    const { input } = spatial(x, z, listener)
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

  function moo(x, z, listener) {
    const { input, distance } = spatial(x, z, listener)
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

  function cluck(x, z, listener) {
    const { input, distance } = spatial(x, z, listener)
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

  function pluck(midi, when, vol = 0.5, dur = 1.6) {
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
    g.connect(sfx.music)
    osc.start(when)
    over.start(when)
    osc.stop(when + dur)
    over.stop(when + dur)
  }

  // A wandering pentatonic melody over a slow I–vi–IV–V cycle in F.
  const CHORDS = [[53, 57, 60], [50, 53, 57], [46, 50, 53], [48, 52, 55]]
  let chordIdx = 0
  let lastNote = 2
  function musicStep(dt) {
    timers.chord -= dt
    timers.music -= dt
    const now = ctx.currentTime + 0.05
    if (timers.chord <= 0) {
      timers.chord = 4.8
      const chord = CHORDS[chordIdx++ % CHORDS.length]
      chord.forEach((m, i) => pluck(m, now + i * 0.06, 0.22, 4.5))
    }
    if (timers.music <= 0) {
      timers.music = Math.random() < 0.3 ? 1.2 : 0.6
      if (Math.random() < 0.8) {
        lastNote = Math.max(0, Math.min(9, lastNote + Math.floor(rand(-2, 3))))
        const octave = Math.floor(lastNote / 5)
        pluck(65 + 12 * octave + PENTATONIC[lastNote % 5], now, 0.32, 1.8)
      }
    }
  }

  return {
    get enabled() {
      return enabled
    },
    start() {
      if (!ctx) build()
      if (ctx.state === 'suspended') ctx.resume()
      started = true
      master.gain.setTargetAtTime(enabled ? 0.9 : 0, ctx.currentTime, 0.4)
    },
    toggle() {
      // The very first press only unlocks audio; later presses mute/unmute.
      if (!started) {
        this.start()
        return enabled
      }
      enabled = !enabled
      master.gain.setTargetAtTime(enabled ? 0.9 : 0, ctx.currentTime, 0.2)
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
        osc.connect(g).connect(sfx.fx)
        osc.start(t + i * 0.08)
        osc.stop(t + i * 0.08 + 0.13)
      })
    },
    update(dt, { listener, robotSpeed, cows, chickens }) {
      if (!started || !enabled) return
      const now = ctx.currentTime
      sfx.motorA.frequency.setTargetAtTime(70 + robotSpeed * 55, now, 0.05)
      sfx.motorB.frequency.setTargetAtTime(141 + robotSpeed * 90, now, 0.05)
      sfx.motorGain.gain.setTargetAtTime(robotSpeed * 0.035, now, 0.08)

      timers.bird -= dt
      if (timers.bird <= 0) {
        timers.bird = rand(1.2, 5)
        chirp(listener)
      }
      for (const [list, fn, min, max] of [[cows, moo, 14, 40], [chickens, cluck, 3, 10]]) {
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
      musicStep(dt)
    },
  }
}
