import * as THREE from 'three'
import { heightAt } from './terrain.js'
import { foundIn } from './scavenge.js'
import { text } from './i18n.js'
import { say } from './syslog.js'

// Little things people left unfinished in the recordings, never listed or hinted at: only
// someone who heard the line and remembers it will think to do them. Doing one gets one
// line, "delivered", and something small that might be a coincidence.
//   R1 "the film's about to start" — stop at 日昇戲院 with the ticket: its lamp flickers.
//   R4 "I want to hear that song again" — stop in front of the Red House with the tape: the
//     robot's speaker plays it through.
//   R8 "one last lap!" — drive once round the Red House square: wheels roll by.
//   R6 "see you up the mountain" — stop at A-Zhong's stall in the village with his bowl:
//     steam rises from the pot.
const WISHES = [
  { id: 'film', scene: 'ximending', echo: 'R1', relic: ['ximending', 'ticket'], at: 'cinema', effect: 'flicker' },
  { id: 'song', scene: 'ximending', echo: 'R4', relic: ['ximending', 'cassette'], at: 'redHouse', effect: 'song' },
  { id: 'lap', scene: 'ximending', echo: 'R8', lap: 'square', effect: 'wheels' },
  { id: 'noodles', scene: 'meadow', echo: 'R6', relic: ['ximending', 'noodleBowl'], at: 'stall', effect: 'steam' },
]
const KEY = 'meadow-bot:wishes'

function load() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

// A soft white puff for the steam.
function puffTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.8)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** heard: the set of recordings heard (see echoes.js). */
export function createWishes(scene, sceneName, landmarks, audio, heard) {
  const done = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...done]))
    } catch {}
  }
  const found = (where, id) => foundIn(where).has(id)
  const mine = WISHES.filter((w) => w.scene === sceneName && landmarks[w.at ?? w.lap])
  let still = 0
  let lap = { angle: 0, last: null }
  const effects = []

  const EFFECTS = {
    // The cinema's lamp: a warm light over its door that flickers three times.
    flicker([x, z]) {
      const lamp = new THREE.PointLight('#ffd27a', 0, 10, 1.5)
      lamp.position.set(x, heightAt(x, z) + 3.2, z)
      scene.add(lamp)
      effects.push({ t: 0, end: 2, run: (t) => (lamp.intensity = t < 1.6 && Math.sin(t * 24) > 0.2 ? 18 : 0), done: () => scene.remove(lamp) })
    },
    song: () => audio.song('speaker'),
    wheels: () => audio.wheels(),
    // A wisp of steam off the stall's pot.
    steam([x, z]) {
      const map = puffTexture()
      for (let i = 0; i < 9; i++) {
        const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0 }))
        puff.position.set(x, heightAt(x, z) + 1.1, z - 1.6)
        scene.add(puff)
        effects.push({
          t: -i * 0.45,
          end: 3,
          run: (t) => {
            if (t < 0) return
            puff.position.y += 0.012
            puff.position.x += Math.sin(t * 2 + i) * 0.003
            puff.scale.setScalar(0.3 + t * 0.35)
            puff.material.opacity = Math.sin((t / 3) * Math.PI) * 0.55
          },
          done: () => scene.remove(puff),
        })
      }
    },
  }

  function grant(w) {
    done.add(w.id)
    save()
    EFFECTS[w.effect](landmarks[w.at ?? w.lap])
    setTimeout(() => say(text.wishes.delivered), 1200)
  }

  return {
    update(dt, robot, speed) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]
        e.t += dt
        e.run(e.t)
        if (e.t >= e.end) {
          e.done()
          effects.splice(i, 1)
        }
      }
      still = speed < 0.03 ? still + dt : 0
      for (const w of mine) {
        if (done.has(w.id) || !heard.has(w.echo) || (w.relic && !found(...w.relic))) continue
        const [x, z] = landmarks[w.at ?? w.lap]
        const d = Math.hypot(robot.x - x, robot.z - z)
        if (w.at && d < 2.8 && still > 1.5) grant(w)
        if (w.lap) {
          // Once all the way round, staying within the square.
          if (d < 2 || d > 14) lap = { angle: 0, last: null }
          else {
            const a = Math.atan2(robot.z - z, robot.x - x)
            if (lap.last !== null) lap.angle += Math.atan2(Math.sin(a - lap.last), Math.cos(a - lap.last))
            lap.last = a
            if (Math.abs(lap.angle) > Math.PI * 2) grant(w)
          }
        }
      }
    },
  }
}
