import { text } from './i18n.ts'
import { say, type SysLine } from './syslog.ts'
import type { Robot } from './robot.ts'
import type { Battery } from './battery.ts'
import type { Stray } from './strays.ts'
import type { Landmarks, WorldEvent } from './world.ts'

// DLV-06's day, from firmware thirty-one years old: a self-check, sun on its panel (its battery filling), greeting
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
// Different customers to greet before that item is done.
const CUSTOMERS = 5
// How close a customer must be to be greeted: past where a cat bolts (2.4), so the robot says
// hello as it rolls up and the cat runs off after.
const GREET_RANGE = 3.4

/**
 * landmarks: { crossing, patrol } from the scene. animals: the scene's strays. robot: for
 * holding at the crossing. battery: the solar charge is done once it is full. onGreet(animal)
 * when it greets one, onDone() once the day is done.
 */
export interface RoutineOptions {
  landmarks: Landmarks
  animals?: Stray[]
  robot: Robot
  battery: Battery
  onGreet?(animal: Stray): void
  onDone(): void
}

// Who counts as a customer: cats, and dogs that have not yet joined the robot.
const greetable = (a: Stray): a is Extract<Stray, { kind: 'cat' | 'dog' }> => a.kind === 'cat' || (a.kind === 'dog' && !a.companion)

export function createRoutine({ landmarks, animals = [], robot, battery, onGreet, onDone }: RoutineOptions) {
  const t = text.routine
  const panel = document.createElement('div')
  panel.id = 'routine'
  panel.innerHTML = `<div class="ribbon">${t.title}</div><ul>${ITEMS.map((id) => `<li data-id="${id}"><span class="t">${t.times[id]}</span> ${t.items[id]}${id === 'greet' ? ' <span class="n"></span>' : ''}</li>`).join('')}</ul>`
  document.body.appendChild(panel)
  const tally = panel.querySelector<HTMLElement>('[data-id="greet"] .n')!

  let active = false
  let elapsed = 0
  const done = new Set<Item>()
  const visited = new Set<number>()
  const wait = { greet: 0, crossing: 0 }
  const nudged = new Set<Item>()
  const greeted = new Set<Stray>()
  const counting = () => active && !done.has('greet')
  const showTally = () => (tally.textContent = `${Math.min(greeted.size, CUSTOMERS)}/${CUSTOMERS}`)
  showTally()
  let stalled = 0

  function complete(id: Item, lines?: SysLine | readonly SysLine[]) {
    if (!active || done.has(id)) return
    done.add(id)
    stalled = 0
    panel.querySelector(`[data-id="${id}"]`)?.classList.add('done')
    if (lines) say(lines)
    if (done.size >= ENOUGH) return finish()
    // Once its own lines have played, what the schedule says is next.
    setTimeout(() => active && nudge(), 3500)
  }
  // Reads out the next item still to do, taking each in turn before coming round again.
  function nudge() {
    stalled = 0
    const pending = ITEMS.filter((id): id is Exclude<Item, 'selfcheck'> => id !== 'selfcheck' && !done.has(id))
    const next = pending.find((id) => !nudged.has(id)) ?? (nudged.clear(), pending[0])
    if (!next) return
    nudged.add(next)
    say(t.nudges[next])
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
    // Where to go for what is still on the schedule, for the map: customers to greet, pigeons to clear.
    get marks() {
      if (!active) return []
      return [
        ...(done.has('greet') ? [] : animals.filter(greetable).filter((a) => !greeted.has(a)).map((a) => a.position)),
        ...(done.has('pigeons') ? [] : animals.flatMap((a) => (a.kind === 'pigeon' ? [a.positions[0]] : []))),
      ]
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
      // While the schedule counts customers, only new ones, a moment apart; after that, the old
      // habit of greeting whoever is close now and then.
      if (wait.greet <= 0) {
        const fresh = counting()
        const near = animals.find((a) => greetable(a) && !(fresh && greeted.has(a)) && Math.hypot(a.position.x - p.x, a.position.z - p.z) < GREET_RANGE)
        if (near) {
          wait.greet = fresh ? 1.5 : 50
          say(t.lines.greet)
          onGreet?.(near)
          if (near.kind === 'cat') setTimeout(() => say(t.lines.cat), 3000)
          if (fresh) {
            greeted.add(near)
            stalled = 0
            showTally()
            if (greeted.size >= CUSTOMERS) complete('greet')
          }
        }
      }
      if (!active) return

      elapsed += dt
      stalled += dt
      if (stalled > NUDGE_AFTER) nudge()
      if (battery.full) complete('sun', t.lines.sun)
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
