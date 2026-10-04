import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { heightAt } from './terrain.js'
import { resolve } from './collision.js'
import { turnToward } from './animals.js'
import { weathered } from './weathering.js'

const SPEED = 3.2
const IDLE_BEFORE_TOUR = 4

// Six-wheeled sidewalk delivery robot: white cargo tub with a lid over a blue-grey chassis,
// a black face panel at the front (+X) and a tall flag whip at the back.
function buildMesh() {
  const g = new THREE.Group()
  const shell = weathered(new THREE.MeshStandardMaterial({ color: '#f6f5f1', roughness: 0.5 }), { grime: 0.45, fade: 0 })
  const chassis = weathered(new THREE.MeshStandardMaterial({ color: '#86a2bf', roughness: 0.6 }), { grime: 0.6, fade: 0.05 })
  const dark = new THREE.MeshStandardMaterial({ color: '#16191f', roughness: 0.25 })
  const rubber = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 })
  const hub = new THREE.MeshStandardMaterial({ color: '#8d96a0', roughness: 0.4, metalness: 0.3 })
  const lamp = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d8', emissiveIntensity: 2.2 })
  const glow = new THREE.MeshStandardMaterial({ color: '#9ff3ff', emissive: '#54e4ff', emissiveIntensity: 3 })
  const tail = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2a1a', emissiveIntensity: 1.6 })

  const base = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.2, 0.5, 4, 0.07), chassis)
  base.position.y = 0.24
  const tub = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.3, 0.48, 5, 0.1), shell)
  tub.position.y = 0.46
  const seam = new THREE.Mesh(new RoundedBoxGeometry(0.665, 0.012, 0.485, 3, 0.006), new THREE.MeshStandardMaterial({ color: '#c9ccd0' }))
  seam.position.y = 0.55
  const lid = new THREE.Mesh(new RoundedBoxGeometry(0.68, 0.1, 0.5, 5, 0.05), shell)
  lid.position.y = 0.6
  g.add(base, tub, seam, lid)

  // Black face panel wrapping the front, with headlights and two glowing eyes.
  const face = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.2, 0.44, 3, 0.025), dark)
  face.position.set(0.335, 0.4, 0)
  g.add(face)
  for (const z of [-0.15, 0.15]) {
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateZ(Math.PI / 2), lamp)
    light.position.set(0.362, 0.36, z)
    g.add(light)
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.035, 0.08, 2, 0.008), tail)
    back.position.set(-0.352, 0.3, z)
    g.add(back)
  }
  const eyes = new THREE.Group()
  for (const z of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.06, 0.05, 2, 0.01), glow)
    eye.position.set(0.362, 0.45, z)
    eyes.add(eye)
  }
  g.add(eyes)

  // Three chunky wheels per side.
  const wheels = []
  const tyre = new THREE.CylinderGeometry(0.095, 0.095, 0.08, 16)
  const cap = new THREE.CylinderGeometry(0.045, 0.045, 0.085, 10)
  for (const x of [0.24, 0, -0.24]) {
    for (const z of [0.27, -0.27]) {
      const w = new THREE.Group()
      w.add(new THREE.Mesh(tyre, rubber), new THREE.Mesh(cap, hub))
      w.rotation.x = Math.PI / 2
      w.position.set(x, 0.095, z)
      wheels.push(w)
      g.add(w)
    }
  }

  const flag = new THREE.Group()
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.7, 4), dark)
  mast.position.y = 0.35
  const pennant = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.12).translate(-0.1, 0, 0),
    new THREE.MeshStandardMaterial({ color: '#ff5a2a', side: THREE.DoubleSide, roughness: 0.8 }),
  )
  pennant.position.set(0, 0.64, 0)
  flag.add(mast, pennant)
  flag.position.set(-0.28, 0.62, -0.17)
  g.add(flag)
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })
  return { g, wheels, eyes, flag }
}

// Robot starting at (x, z); when idle it patrols `tour`, a loop of [x, z] waypoints.
export function createRobot(x, z, tour) {
  const { g, wheels, eyes, flag } = buildMesh()
  const pos = new THREE.Vector3(x, 0, z)
  const keys = new Set()
  let clickTarget = null
  let idle = IDLE_BEFORE_TOUR - 1
  let tourIdx = 0
  let heading = 0
  let speed = 0
  let blink = 0
  let stuckTime = 0

  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()))
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

  function nearestTourIdx() {
    let best = 0
    let bestD = Infinity
    tour.forEach(([tx, tz], i) => {
      const d = (tx - pos.x) ** 2 + (tz - pos.z) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  return {
    object: g,
    position: pos,
    goTo(point) {
      clickTarget = new THREE.Vector2(point.x, point.z)
      idle = 0
    },
    get speed() {
      return speed / SPEED
    },
    get touring() {
      return idle > IDLE_BEFORE_TOUR
    },
    update(t, dt) {
      const input = new THREE.Vector2(
        (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0),
        (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0),
      )
      let dir = null
      let pace = 1
      if (input.lengthSq() > 0) {
        clickTarget = null
        idle = 0
        dir = input.normalize()
      } else if (clickTarget) {
        const to = new THREE.Vector2(clickTarget.x - pos.x, clickTarget.y - pos.z)
        if (to.length() < 0.15) clickTarget = null
        else dir = to.normalize()
      } else {
        const wasTouring = idle > IDLE_BEFORE_TOUR
        idle += dt
        if (idle > IDLE_BEFORE_TOUR) {
          if (!wasTouring) tourIdx = nearestTourIdx()
          const [tx, tz] = tour[tourIdx]
          const to = new THREE.Vector2(tx - pos.x, tz - pos.z)
          // Skip a waypoint if something keeps us from making progress toward it.
          if (to.length() < 0.6 || stuckTime > 1.5) {
            tourIdx = (tourIdx + 1) % tour.length
            stuckTime = 0
          }
          dir = to.normalize()
          pace = 0.55
        }
      }
      const targetSpeed = dir ? SPEED * pace : 0
      speed += (targetSpeed - speed) * Math.min(1, dt * 6)
      if (dir) heading = turnToward(heading, Math.atan2(-dir.y, dir.x), Math.min(1, dt * 7))
      pos.x += Math.cos(heading) * speed * dt
      pos.z -= Math.sin(heading) * speed * dt
      const before = pos.clone()
      resolve(pos, 0.38)
      const moved = Math.hypot(pos.x - before.x + Math.cos(heading) * speed * dt, pos.z - before.z - Math.sin(heading) * speed * dt)
      stuckTime = dir && moved < speed * dt * 0.3 ? stuckTime + dt : 0
      pos.y = heightAt(pos.x, pos.z)

      g.position.copy(pos)
      g.position.y += Math.abs(Math.sin(t * 16)) * 0.025 * (speed / SPEED)
      g.rotation.y = heading
      g.rotation.z = -speed * 0.02
      for (const w of wheels) w.rotation.y -= speed * dt * 8
      flag.rotation.z = 0.06 + speed * 0.05 + Math.sin(t * 5) * 0.04
      blink -= dt
      if (blink < -3.5) blink = 0.12
      eyes.scale.y = blink > 0 ? 0.15 : 1
    },
  }
}
