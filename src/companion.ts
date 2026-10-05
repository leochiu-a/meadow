import type * as THREE from 'three'
import { createDog, type Dog, type Stray } from './strays.ts'
import type { NavGrid } from './walkmap.ts'
import type { Robot } from './robot.ts'
import type { WorldEvent } from './world.ts'
import { transcriptLength, type EchoDef } from './echoes.ts'
import { text } from './i18n.ts'
import { say } from './syslog.ts'

// 一號顧客: the first street dog the robot greets that does not walk off. From then on it
// follows the robot everywhere, the village too; it is the only one that seems to hear the
// recordings (it looks toward them, and barks back at the ambulance). The robot reports to
// it now and then, the way it reports everything. Which dog it is lives in this browser.
const KEY = 'meadow-bot:companion'
const REMARK_EVERY = [70, 140]

function load(): { coat: number } | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

/** scene, nav and robot of this scene; events: the world's sound events (for its barks). */
export function createCompanion(scene: THREE.Scene, nav: NavGrid, robot: Robot, events: WorldEvent[]) {
  let dog: Dog | null = null
  let own = false
  let remarkIn = REMARK_EVERY[0]
  const saved = load()
  // Adopted on an earlier visit: it is already here, just behind the robot.
  if (saved) {
    const spot = nav.spotNear(robot.position.x, robot.position.z, 1.5, 3) ?? [robot.position.x - 1.5, robot.position.z]
    dog = createDog(...spot, nav, (kind, x, z) => events.push({ kind, x, z }), saved.coat)
    dog.adopt()

    scene.add(dog.object)
    own = true
  }

  return {
    get dog() {
      return dog
    },
    // The robot greeted a street dog: if it has no companion yet, this one stays.
    greeted(animal: Stray) {
      if (dog || animal.kind !== 'dog') return
      dog = animal
      dog.adopt()
      try {
        localStorage.setItem(KEY, JSON.stringify({ coat: dog.coat }))
      } catch {}
      setTimeout(() => say(text.companion.adopted), 3000)
    },
    // A recording starts at (x, z): it looks that way, and barks at the ambulance.
    heard(def: EchoDef, spot: { x: number; z: number }) {
      if (!dog) return
      const length = transcriptLength(def)
      dog.listen(spot.x, spot.z, length, def.id === 'R3')
      if (Math.random() < 0.4) setTimeout(() => say(text.companion.didYouHear), (length + 1) * 1000)

    },
    update(t: number, dt: number, busy: boolean) {

      if (!dog) return
      if (own) dog.update(t, dt, robot.position)
      remarkIn -= dt
      if (remarkIn <= 0 && !busy) {
        remarkIn = REMARK_EVERY[0] + Math.random() * (REMARK_EVERY[1] - REMARK_EVERY[0])
        say(text.companion.remarks[Math.floor(Math.random() * text.companion.remarks.length)])
      }
    },
  }
}
