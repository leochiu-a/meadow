import { text } from './i18n.js'

// DLV-06's audio buffer: fourteen recordings of the street from before the city emptied,
// each only decodable where it was recorded. Drive (or patrol) past a spot whose act is
// open and it plays: the mix ducks, a sound with nothing visible making it, and the robot's
// transcript underneath. What was heard is kept in this browser; the timeline replays it.
// `cues` are the seconds into the recording each transcript line appears (see the locales).

export const ECHOES = [
  { id: 'R1', act: 1, when: '2049-07-22 14:10', cues: [3, 5.5, 7.5, 10] },
  { id: 'R2', act: 1, when: '2052-09-14 01:50', cues: [1] },
  { id: 'R3', act: 1, when: '2052-09-14 02:13', cues: [5, 9.5] },
  { id: 'R4', act: 1, when: '2052-10-05 10:30', cues: [4, 8, 12.5] },
  { id: 'R5', act: 1, when: '2053-03-01 08:00', cues: [3, 8] },
  { id: 'R6', act: 2, when: '2054-04-30 23:05', cues: [2.5, 6.5, 9.5] },
  { id: 'R7', act: 2, when: '2054-04-30 23:12', cues: [2.8, 5.5, 7.5] },
  { id: 'R8', act: 2, when: '2054-04-30 23:20', cues: [3, 7] },
  { id: 'R9', act: 2, when: '2054-04-30 23:31', cues: [1.5, 5.5] },
  { id: 'R10', act: 2, when: '2054-04-30 23:33', cues: [1.5, 4.5] },
  { id: 'R11', act: 2, when: '2054-04-30 23:38', cues: [5, 8, 14, 17.5] },
  { id: 'R12', act: 2, when: '2054-04-30 23:41', cues: [7] },
  { id: 'R13', act: 2, when: '2054-04-30 23:47', cues: [2.6, 4.3, 6.6] },
  { id: 'R14', act: 3, when: '2054-04-30 23:52', cues: [5, 6.5, 9] },
].map((e) => ({ ...e, ...text.echoes[e.id] }))
export const ECHO_IDS = ECHOES.map((e) => e.id)

const KEY = 'meadow-bot:echoes'
const RADIUS = 4.5

export function heardEchoes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

/**
 * spots: { [id]: { x, z, path? } } where this scene's recordings lie. isOpen(def) whether its
 * act has begun. onStart(def, spot) as one starts, onHeard(def, heard) once it has played.
 */
export function createEchoes(audio, spots = {}, { isOpen, onStart, onHeard }) {
  const heard = heardEchoes()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...heard]))
    } catch {
      // Private window: the recordings stay heard for this visit.
    }
  }

  const hud = document.createElement('div')
  hud.id = 'echo'
  hud.innerHTML = '<div class="head"></div><div class="sub"></div>'
  document.body.appendChild(hud)
  const head = hud.querySelector('.head')
  const sub = hud.querySelector('.sub')
  let playing = null
  let timers = []

  // Plays def's recording with its transcript; resolves once it is over.
  function play(def, where) {
    for (const t of timers) clearTimeout(t)
    timers = []
    const length = audio.echo(def.id, where) || def.cues.at(-1) + 3
    const lead = 600
    const later = (ms, fn) => timers.push(setTimeout(fn, ms))
    head.textContent = text.echo.detected
    sub.textContent = ''
    hud.className = 'show'
    later(lead, () => (head.textContent = `${text.echo.aligned}・${def.when}`))
    def.cues.forEach((c, i) => later(lead + c * 1000, () => (sub.textContent = def.lines[i])))
    return new Promise((resolve) =>
      later(lead + length * 1000, () => {
        sub.textContent = ''
        resolve()
      }),
    )
  }

  async function start(def, spot) {
    playing = def
    onStart?.(def, spot)
    await play(def, { at: [spot.x, spot.z], path: spot.path, listener: { x: spot.x, z: spot.z } })
    heard.add(def.id)
    save()
    head.textContent = text.echo.saved
    timers.push(setTimeout(() => (hud.className = ''), 1800))
    playing = null
    onHeard?.(def, heard)
  }

  return {
    heard,
    get playing() {
      return playing
    },
    // Where the open, unheard recordings lie, for the radar.
    beacons() {
      return ECHOES.filter((d) => spots[d.id] && !heard.has(d.id) && isOpen(d)).map((d) => spots[d.id])
    },
    // busy: something else holds the stage (the story log), so nothing starts now.
    update(robot, busy) {
      if (playing || busy) return
      for (const def of ECHOES) {
        const spot = spots[def.id]
        if (!spot || heard.has(def.id) || !isOpen(def)) continue
        if (Math.hypot(robot.x - spot.x, robot.z - spot.z) < RADIUS) return start(def, spot)
      }
    },
    // Hears recording `id` again, from the timeline (or played to someone at the end).
    async replay(id) {
      if (playing) return
      const def = ECHOES.find((d) => d.id === id)
      const spot = spots[id]
      playing = def
      await play(def, spot ? { at: [spot.x, spot.z], path: spot.path, listener: { x: spot.x, z: spot.z } } : {})
      hud.className = ''
      playing = null
    },
  }
}
