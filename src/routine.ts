import { text } from './i18n.ts'
import { say, type SysLine } from './syslog.ts'
import type { Robot } from './robot.ts'
import type { Stray } from './strays.ts'
import type { Landmarks, WorldEvent } from './world.ts'

// DLV-06's day, from firmware thirty-one years old: a self-check, sun on its panel (any clear stretch counts, parked or rolling), greeting
// customers, clearing its path, waiting at the crossing, its old patrol. Nothing is asked of
// the player; a small list ticks off whatever happens, on patrol too. Once enough of the day
// is done (or enough time has passed) it goes to load the next item, and the story begins.
// Some habits stay for good: it keeps greeting animals and waiting for a light that never
// changes.

const ITEMS = ['selfcheck', 'sun', 'greet', 'pigeons', 'crossing', 'lens', 'patrol'] as const
type Item = (typeof ITEMS)[number]
const ENOUGH = 4
const LONG_ENOUGH = 360
// With no progress for this long, the robot reads out what its schedule says is next.
const NUDGE_AFTER = 20

/**
 * landmarks: { crossing, patrol } from the scene. animals: the scene's strays. robot: for
 * holding at the crossing. onGreet(animal) when it greets one, onDone() once the day is done.
 */
export interface RoutineOptions {
  landmarks: Landmarks
  animals?: Stray[]
  robot: Robot
  onGreet?(animal: Stray): void
  onDone(): void
}

export function createRoutine({ landmarks, animals = [], robot, onGreet, onDone }: RoutineOptions) {
  const t = text.routine
  const panel = document.createElement('div')
  panel.id = 'routine'
  panel.innerHTML = `<div class="ribbon">${t.title}</div><ul>${ITEMS.map((id) => `<li data-id="${id}"><span class="t">${t.times[id]}</span> ${t.items[id]}</li>`).join('')}</ul>`
  document.body.appendChild(panel)

  let active = false
  let elapsed = 0
  let sunny = 0
  const done = new Set<Item>()
  const visited = new Set<number>()
  const wait = { greet: 0, crossing: 0 }
  const nudged = new Set<Item>()
  let stalled = 0

  function complete(id: Item, lines?: SysLine | readonly SysLine[]) {
    if (!active || done.has(id)) return
    done.add(id)
    stalled = 0
    panel.querySelector(`[data-id="${id}"]`)?.classList.add('done')
    if (lines) say(lines)
    if (done.size >= ENOUGH) finish()
  }
  function finish() {
    active = false
    setTimeout(() => panel.classList.remove('open'), 4500)
    setTimeout(onDone, 5500)
  }

  return {
    get active() {
      return active
    },
    begin() {
      active = true
      panel.classList.add('open')
      say(t.lines.boot)
      setTimeout(() => complete('selfcheck', t.lines.selfcheck), 2500)
    },
    // events: this frame's world events (a flock taking off is one).
    update(dt: number, { rain, events = [] }: { rain: number; events?: WorldEvent[] }) {
      const p = robot.position
      wait.greet -= dt
      wait.crossing -= dt

      // Habits, for good: wait at the rainbow crossing; greet whoever is close.
      if (landmarks.crossing && wait.crossing <= 0 && Math.hypot(p.x - landmarks.crossing[0], p.z - landmarks.crossing[1]) < 3) {
        wait.crossing = 25
        robot.hold(2.2)
        say(t.lines.crossing[0])
        setTimeout(() => say(t.lines.crossing[1]), 2200)
        complete('crossing')
      }
      if (wait.greet <= 0) {
        const near = animals.find((a) => (a.kind === 'cat' || (a.kind === 'dog' && !a.companion)) && Math.hypot(a.position.x - p.x, a.position.z - p.z) < 2.2)
        if (near) {
          wait.greet = 50
          say(t.lines.greet)
          onGreet?.(near)
          if (near.kind === 'cat') setTimeout(() => say(t.lines.cat), 3000)
          complete('greet')
        }
      }
      if (!active) return

      elapsed += dt
      stalled += dt
      if (stalled > NUDGE_AFTER) {
        stalled = 0
        const pending = ITEMS.filter((id): id is Exclude<Item, 'selfcheck'> => id !== 'selfcheck' && !done.has(id))
        const next = pending.find((id) => !nudged.has(id)) ?? (nudged.clear(), pending[0])
        if (next) {
          nudged.add(next)
          say(t.nudges[next])
        }
      }
      if (rain < 0.05) sunny += dt
      if (sunny > 8) complete('sun', t.lines.sun)
      const flock = events.find((e) => e.kind === 'flutter' && Math.hypot(e.x - p.x, e.z - p.z) < 8)
      if (flock) complete('pigeons', t.lines.pigeons(Math.floor(5 + Math.random() * 30)))
      if (rain > 0.3) complete('lens', t.lines.lens)
      const patrol = landmarks.patrol ?? []
      patrol.forEach(([x, z], i) => Math.hypot(p.x - x, p.z - z) < 5 && visited.add(i))
      if (patrol.length && visited.size === patrol.length) complete
('patrol', t.lines.patrol)

      if (elapsed > LONG_ENOUGH) finish()
    },
  }
}
