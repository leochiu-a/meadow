import { text } from './i18n.ts'
import type { EchoWhere } from './echo-audio.ts'
import type { EchoSpot } from './world.ts'

export const ECHO_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14'] as const
export type EchoId = (typeof ECHO_IDS)[number]
// What the robot's transcript of each says, in the locales.
export type EchoTexts = Record<EchoId, { place: string; lines: string[] }>
interface EchoTiming {
  id: EchoId
  act: 1 | 2 | 3
  when: string
  cues: readonly number[]
  after?: EchoId
}

// DLV-06's audio buffer: fourteen recordings of the street from before the city emptied,
// each only decodable where it was recorded. Drive (or patrol) past a spot whose act is
// open and it plays: the mix ducks, a sound with nothing visible making it, and the robot's
// transcript underneath. What was heard is kept in this browser; the log replays it.
// `cues` are the seconds into the recording each transcript line appears (see the locales).
// `after`: only decodable once that one has been heard (her steps follow his call).

const TIMINGS: EchoTiming[] = [
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
  { id: 'R12', act: 2, when: '2054-04-30 23:41', cues: [7], after: 'R11' },
  { id: 'R13', act: 2, when: '2054-04-30 23:47', cues: [2.6, 4.3, 6.6] },
  { id: 'R14', act: 3, when: '2054-04-30 23:52', cues: [5, 6.5, 9] },
]
export const ECHOES = TIMINGS.map((e) => ({ ...e, ...text.echoes[e.id] }))
export type EchoDef = (typeof ECHOES)[number]
// How long a recording's transcript runs: its last line, and a moment after.
export const transcriptLength = (def: EchoDef) => def.cues[def.cues.length - 1] + 3



const KEY = 'meadow-bot:echoes'
const RADIUS = 4.5

export function heardEchoes(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export interface EchoHooks {
  isOpen(def: EchoDef): boolean
  onStart?(def: EchoDef, spot: EchoSpot): void
  onHeard?(def: EchoDef, heard: Set<string>): void
}

/**
 * spots: { [id]: { x, z, path? } } where this scene's recordings lie. isOpen(def) whether its
 * act has begun. onStart(def, spot) as one starts, onHeard(def, heard) once it has played.
 */
export function createEchoes(audio: { echo(id: EchoId, where: EchoWhere): number }, spots: Partial<Record<EchoId, EchoSpot>> = {}, { isOpen, onStart, onHeard }: EchoHooks) {
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
  const head = hud.querySelector<HTMLElement>('.head')!
  const sub = hud.querySelector<HTMLElement>('.sub')!
  let playing: EchoDef | null = null
  let timers: ReturnType<typeof setTimeout>[] = []
  const ready = (def: EchoDef) => isOpen(def) && (!def.after || heard.has(def.after))

  // Plays def's recording with its transcript; resolves once it is over.
  function play(def: EchoDef, where: EchoWhere) {
    for (const t of timers) clearTimeout(t)
    timers = []
    const length = audio.echo(def.id, where) || transcriptLength(def)
    const lead = 600
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    head.textContent = text.echo.detected
    sub.textContent = ''
    hud.className = 'show'
    later(lead, () => (head.textContent = `▶ ${def.when}`))
    def.cues.forEach((c, i) => later(lead + c * 1000, () => (sub.textContent = def.lines[i])))
    return new Promise<void>((resolve) =>
      later(lead + length * 1000, () => {
        sub.textContent = ''
        resolve()
      }),
    )
  }

  async function start(def: EchoDef, spot: EchoSpot) {
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
      return ECHOES.flatMap((d) => {
        const spot = spots[d.id]
        return spot && !heard.has(d.id) && ready(d) ? [spot] : []
      })

    },
    // busy: something else holds the stage (the story log), so nothing starts now.
    update(robot: { x: number; z: number }, busy: boolean) {
      if (playing || busy) return
      for (const def of ECHOES) {
        const spot = spots[def.id]
        if (!spot || heard.has(def.id) || !ready(def)) continue
        if (Math.hypot(robot.x - spot.x, robot.z - spot.z) < RADIUS) return start(def, spot)
      }
    },
    // Hears recording `id` again, from the log (or played to someone at the end).
    async replay(id: EchoId) {
      const def = ECHOES.find((d) => d.id === id)
      if (playing || !def) return
      const spot = spots[id]

      playing = def
      await play(def, spot ? { at: [spot.x, spot.z], path: spot.path, listener: { x: spot.x, z: spot.z } } : {})
      hud.className = ''
      playing = null
    },
  }
}
