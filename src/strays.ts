import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { heightAt, rand, range, pick } from './terrain.ts'
import { resolve } from './collision.ts'
import { turnToward, mat, shadow, furMaterial, loft, leg } from './animals.ts'
import type { NavGrid, XZ } from './walkmap.ts'
import type { PointXZ } from './collision.ts'

// A sound worth playing, reported where it happened.
export type Emit = (kind: 'meow' | 'bark' | 'flutter', x: number, z: number) => void

// The animals that took the city over once people left: stray cats, street dogs and
// pigeons. They roam the robot's walkable network (`nav`) and react to it: cats bolt when
// it rolls up, dogs trot over and tag along for a while, pigeon flocks burst into the air.
// `emit(kind, x, z)` reports a sound worth playing (meow, bark, flutter).

// Step pos toward target at `speed`; true while still on the way.
function stepToward(pos: PointXZ, target: XZ, speed: number, dt: number, radius: number) {
  const dx = target[0] - pos.x
  const dz = target[1] - pos.z
  const d = Math.hypot(dx, dz)
  if (d < 0.12) return false
  const s = Math.min(d, speed * dt)
  pos.x += (dx / d) * s
  pos.z += (dz / d) * s
  resolve(pos, radius)
  return true
}

// The reachable spot near `pos` farthest from `from`, for running away.
function escapeSpot(nav: NavGrid, pos: PointXZ, from: PointXZ, rMin: number, rMax: number) {
  let best: XZ | null = null
  let bestD = -1
  for (let i = 0; i < 6; i++) {
    const s = nav.spotNear(pos.x, pos.z, rMin, rMax, 4)
    if (!s) continue
    const d = Math.hypot(s[0] - from.x, s[1] - from.z)
    if (d > bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

const COATS = [
  ['#d98a3d', '#e09a4e', '#d98a3d', '#f1e6d6'], // ginger tabby
  ['#2a2622', '#2a2622', '#2a2622', '#2a2622'], // black
  ['#8c8a86', '#9a9893', '#8c8a86', '#e8e4dc'], // grey
  ['#f2ede4', '#d98a3d', '#2a2622', '#f2ede4'], // calico
  ['#f2ede4', '#f2ede4', '#6b5a4a', '#f2ede4'], // white with a dark patch
]

// Stray cat: naps in a loaf, strolls a little, turns to watch the robot when it comes near
// and bolts when it gets too close.
export function createCat(x: number, z: number, nav: NavGrid, emit: Emit) {
  const coat = pick(COATS)
  const fur = furMaterial('#ffffff', true)
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  body.add(
    new THREE.Mesh(
      loft([[-0.2, 0.2], [-0.02, 0.21], [0.16, 0.23]], [0.05, 0.085, 0.09, 0.08, 0.06], { squash: 0.9, colors: coat.slice(0, 3), ring: 10, segs: 18 }),
      fur,
    ),
  )
  const legMat = mat(coat[3])
  const legs: THREE.Group[] = []
  for (const [lx, lz] of [[0.13, 0.045], [0.13, -0.045], [-0.15, 0.045], [-0.15, -0.045]]) {
    const l = leg(0.19, 0.02, legMat)
    l.position.set(lx, 0.19, lz)
    legs.push(l)
    body.add(l)
  }
  const head = new THREE.Group()
  head.position.set(0.21, 0.3, 0)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), mat(coat[0]))
  skull.scale.set(1, 0.9, 1.05)
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), mat(coat[3]))
  muzzle.position.set(0.055, -0.02, 0)
  head.add(skull, muzzle)
  for (const sd of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.06, 4), mat(coat[0]))
    ear.position.set(0, 0.07, sd * 0.037)
    ear.rotation.x = sd * 0.3
    head.add(ear)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), mat('#c9d64a'))
    eye.position.set(0.058, 0.015, sd * 0.03)
    head.add(eye)
  }
  body.add(head)
  const tail = new THREE.Group()
  tail.position.set(-0.2, 0.22, 0)
  tail.add(
    new THREE.Mesh(
      loft([[0, 0], [-0.1, 0.04], [-0.15, 0.16], [-0.12, 0.28]], [0.022, 0.024, 0.022, 0.018, 0.012], { colors: [coat[0], coat[2]], ring: 6, segs: 12 }),
      fur,
    ),
  )
  body.add(tail)
  shadow(root)
  // A touch larger than life so it reads at the diorama's scale.
  root.scale.setScalar(1.3)

  const home: XZ = [x, z]
  const pos = new THREE.Vector3(x, 0, z)
  let target: XZ | null = null
  let state: 'rest' | 'stroll' | 'flee' = 'rest'
  let timer = range(2, 10)
  let heading = rand() * 6
  let stride = 0
  let loaf = 1
  const phase = rand() * 10
  return {
    kind: 'cat' as const,
    object: root,
    position: pos,
    update(t: number, dt: number, robot: PointXZ) {
      const toRobot = Math.hypot(robot.x - pos.x, robot.z - pos.z)
      if (state !== 'flee' && toRobot < 2.4) {
        target = escapeSpot(nav, pos, robot, 3, 7)
        if (target) {
          state = 'flee'
          if (rand() < 0.5) emit('meow', pos.x, pos.z)
        }
      }
      let speed = 0
      if (state === 'flee' && target) {
        speed = 3.4
        if (!stepToward(pos, target, speed, dt, 0.16)) {
          state = 'rest'
          timer = range(3, 8)
        }
      } else if (state === 'stroll' && target) {
        speed = 0.7
        if (!stepToward(pos, target, speed, dt, 0.16)) {
          state = 'rest'
          timer = range(4, 12)
        }
      } else {
        timer -= dt
        if (timer <= 0) {
          // Wander, but drift back toward home rather than away from it.
          const far = Math.hypot(pos.x - home[0], pos.z - home[1]) > 8
          target = far && nav.sightline(pos.x, pos.z, ...home) ? home : nav.spotNear(pos.x, pos.z, 1, 4)
          if (target) state = 'stroll'
          else timer = 2
        }
      }
      const moving = speed > 0
      if (moving && target) heading = Math.atan2(-(target[1] - pos.z), target[0] - pos.x)
      // A cat that has noticed the robot turns its head to keep an eye on it.
      const watching = !moving && toRobot < 6
      const look = watching ? Math.atan2(Math.sin(Math.atan2(-(robot.z - pos.z), robot.x - pos.x) - root.rotation.y), Math.cos(Math.atan2(-(robot.z - pos.z), robot.x - pos.x) - root.rotation.y)) : 0
      head.rotation.y = turnToward(head.rotation.y, THREE.MathUtils.clamp(look, -1.2, 1.2), Math.min(1, dt * 6))
      loaf += ((state === 'rest' && !watching ? 1 : 0) - loaf) * Math.min(1, dt * 3)
      stride += dt * speed * 9
      legs.forEach((l, i) => {
        l.rotation.z = moving ? Math.sin(stride + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0
        l.scale.y = 1 - loaf * 0.75
      })
      body.position.y = -loaf * 0.13
      tail.rotation.x = Math.sin(t * (watching ? 4 : 1.3) + phase) * (watching ? 0.5 : 0.25)
      tail.rotation.z = state === 'flee' ? -0.6 : loaf * -0.9
      root.rotation.y = turnToward(root.rotation.y, heading, Math.min(1, dt * 9))
      root.position.set(pos.x, heightAt(pos.x, pos.z) + (moving ? Math.abs(Math.sin(stride)) * 0.02 : 0), pos.z)
    },
  }
}

// Taiwanese street dog (土狗): lean and long-legged, deep chest and tucked belly, a wedge
// head with big upright ears, sickle tail carried high. Ambles round its patch; when the
// robot passes it trots over, barks once and follows it for a while. Once adopted it is
// the robot's companion and follows it everywhere. `coat` picks its colouring (0–2).
const DOG_COATS = [['#b98a4e', '#e6cfa4'], ['#22201d', '#3a3430'], ['#c9a46e', '#efe0c2']]
export function createDog(x: number, z: number, nav: NavGrid, emit: Emit, coat = Math.floor(rand() * DOG_COATS.length)) {
  const [colour, chest] = DOG_COATS[coat]
  const fur = furMaterial('#ffffff', true)
  const solid = mat(colour)
  const root = new THREE.Group()
  // Body: rump, tucked waist, deep ribcage, chest, shoulders.
  root.add(
    new THREE.Mesh(
      loft([[-0.3, 0.39], [-0.12, 0.39], [0.06, 0.37], [0.22, 0.39]], [0.09, 0.095, 0.08, 0.12, 0.125, 0.1], { squash: 0.72, colors: [colour, colour, colour, chest], ring: 12, segs: 26 }),
      fur,
    ),
  )
  // Neck rising to the head.
  root.add(new THREE.Mesh(loft([[0.18, 0.41], [0.26, 0.47], [0.31, 0.52]], [0.085, 0.072, 0.062], { squash: 0.8, colors: [chest, colour], ring: 10, segs: 12 }), fur))
  const head = new THREE.Group()
  head.position.set(0.33, 0.55, 0)
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.074, 12, 10), solid)
  skull.scale.set(1.15, 0.9, 0.95)
  head.add(skull)
  head.add(new THREE.Mesh(loft([[0.04, -0.015], [0.1, -0.03], [0.15, -0.04]], [0.05, 0.04, 0.03, 0.022], { colors: [colour, chest, '#1a1512'], ring: 10, segs: 12 }), fur))
  for (const sd of [-1, 1]) {
    // Big pricked triangular ears, set wide and tipped slightly forward.
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.11, 3), solid)
    ear.scale.z = 0.45
    ear.position.set(-0.01, 0.085, sd * 0.042)
    ear.rotation.set(sd * 0.22, 0, 0.12)
    head.add(ear)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), mat('#1a1512'))
    eye.position.set(0.058, 0.018, sd * 0.034)
    head.add(eye)
  }
  root.add(head)
  // Legs hinge at the hip / shoulder and again at the knee / hock; hind legs angle back.
  const legs: { hip: THREE.Group; knee: THREE.Group; hind: boolean; rest: [number, number] }[] = []
  const limb = (lx: number, lz: number, hind: boolean) => {
    const hip = new THREE.Group()
    hip.position.set(lx, hind ? 0.37 : 0.35, lz)
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(hind ? 0.045 : 0.034, 0.026, 0.17, 7).translate(0, -0.085, 0), solid)
    hip.add(upper)
    const knee = new THREE.Group()
    knee.position.y = -0.17
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.02, 0.18, 6).translate(0, -0.09, 0), solid)
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.027, 6, 4), mat(chest))
    paw.scale.set(1.4, 0.6, 1)
    paw.position.set(0.012, -0.18, 0)
    knee.add(lower, paw)
    hip.add(knee)
    hip.rotation.z = hind ? -0.35 : 0.05
    knee.rotation.z = hind ? 0.62 : -0.08
    root.add(hip)
    legs.push({ hip, knee, hind, rest: [hip.rotation.z, knee.rotation.z] })
  }
  limb(0.16, 0.045, false)
  limb(0.16, -0.045, false)
  limb(-0.23, 0.05, true)
  limb(-0.23, -0.05, true)
  // Sickle tail, carried up and curving forward over the back.
  const tail = new THREE.Group()
  tail.position.set(-0.33, 0.43, 0)
  tail.add(new THREE.Mesh(loft([[0, 0], [-0.07, 0.1], [-0.05, 0.22], [0.04, 0.28]], [0.028, 0.03, 0.026, 0.02, 0.01], { colors: [colour, colour, chest], ring: 7, segs: 14 }), fur))
  root.add(tail)
  shadow(root)
  root.scale.setScalar(1.2)

  const home: XZ = [x, z]
  const pos = new THREE.Vector3(x, 0, z)
  let target: XZ | null = null
  let state: 'rest' | 'stroll' | 'follow' | 'companion' = 'rest'
  let timer = range(1, 6)
  let bored = 0
  let heading = rand() * 6
  let stride = 0
  const phase = rand() * 10
  // Where it is listening, and for how long more: it stops and looks there.
  let listening: { x: number; z: number; left: number } | null = null
  return {
    kind: 'dog' as const,
    object: root,
    position: pos,
    coat,
    get companion() {
      return state === 'companion'
    },
    // From now on it stays with the robot.
    adopt() {
      state = 'companion'
    },
    // Pricks up at a sound from (x, z) for `seconds`; barks back if `bark`.
    listen(x: number, z: number, seconds: number, bark = false) {
      listening = { x, z, left: seconds }
      if (bark) emit('bark', pos.x, pos.z)
    },
    update(t: number, dt: number, robot: PointXZ) {
      bored = Math.max(0, bored - dt)
      const toRobot = Math.hypot(robot.x - pos.x, robot.z - pos.z)
      if (listening && (listening.left -= dt) <= 0) listening = null
      if (state === 'companion') {
        // Left far behind (a jump across the map): catch up from just out of sight.
        if (toRobot > 24) {
          const s = nav.spotNear(robot.x, robot.z, 4, 8)
          if (s) pos.set(s[0], 0, s[1])
        }
      } else if (state !== 'follow' && !bored && toRobot < 7 && nav.sightline(pos.x, pos.z, robot.x, robot.z)) {
        state = 'follow'
        timer = range(8, 16)
        emit('bark', pos.x, pos.z)
      }
      let speed = 0
      let facing: XZ | null = null
      if (state === 'companion') {
        if (toRobot > 1.9 && !listening) {
          speed = Math.min(3.8, 0.8 + (toRobot - 1.9) * 1.4)
          stepToward(pos, [robot.x, robot.z], speed, dt, 0.25)
        }
        facing = listening ? [listening.x, listening.z] : [robot.x, robot.z]
      } else if (state === 'follow') {
        timer -= dt
        // Lose interest after a while, or once the robot is out of sight.
        if (timer <= 0 || toRobot > 14 || !nav.sightline(pos.x, pos.z, robot.x, robot.z)) {
          state = 'rest'
          timer = range(2, 5)
          bored = range(20, 35)
        } else if (toRobot > 1.7) {
          speed = Math.min(2.8, 0.8 + (toRobot - 1.7) * 1.2)
          stepToward(pos, [robot.x, robot.z], speed, dt, 0.25)
          facing = [robot.x, robot.z]
        } else facing = [robot.x, robot.z]
      } else if (state === 'stroll' && target) {
        speed = 0.9
        facing = target
        if (!stepToward(pos, target, speed, dt, 0.25)) {
          state = 'rest'
          timer = range(3, 9)
        }
      } else {
        timer -= dt
        if (timer <= 0) {
          const far = Math.hypot(pos.x - home[0], pos.z - home[1]) > 10
          target = far && nav.sightline(pos.x, pos.z, ...home) ? home : nav.spotNear(pos.x, pos.z, 2, 6)
          if (target) state = 'stroll'
          else timer = 2
        }
      }
      if (facing) heading = Math.atan2(-(facing[1] - pos.z), facing[0] - pos.x)
      const moving = speed > 0
      stride += dt * speed * 6
      legs.forEach((l, i) => {
        const swing = moving ? Math.sin(stride + (i === 0 || i === 3 ? 0 : Math.PI)) : 0
        l.hip.rotation.z = l.rest[0] + swing * 0.45
        // The knee folds as the leg swings forward.
        l.knee.rotation.z = l.rest[1] + Math.max(0, -swing) * (l.hind ? 0.4 : -0.6)
      })
      // Tail wags hard while it has company; head dips to sniff when it is alone.
      const company = state === 'follow' || (state === 'companion' && !listening)
      tail.rotation.x = Math.sin(t * (company ? 16 : 2) + phase) * (company ? 0.45 : 0.12)
      // Head dips to sniff when it is alone, lifts when it listens.
      const headTo = listening ? 0.35 : state === 'rest' && Math.sin(t * 0.4 + phase) > 0.3 ? -0.5 : 0.1
      head.rotation.z = turnToward(head.rotation.z, headTo, Math.min(1, dt * 4))
      root.rotation.y = turnToward(root.rotation.y, heading, Math.min(1, dt * 7))
      root.position.set(pos.x, heightAt(pos.x, pos.z) + (moving ? Math.abs(Math.sin(stride)) * 0.03 : 0), pos.z)
    },
  }
}

// One pigeon's body as a single vertex-coloured mesh; wings are separate so they can flap.
function pigeonBody() {
  const part = (geo: THREE.BufferGeometry, colour: THREE.ColorRepresentation, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    geo.scale(sx, sy, sz).translate(x, y, z)
    const c = new THREE.Color(colour)
    const n = geo.attributes.position.count
    geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => c.toArray()[i % 3]), 3))
    return geo.toNonIndexed()
  }
  const grey = pick(['#8d93a0', '#7d828e', '#9c9a96', '#5e5c5a'])
  return mergeGeometries([
    part(new THREE.SphereGeometry(0.08, 10, 8), grey, 0, 0.12, 0, 1.5, 1, 1),
    part(new THREE.SphereGeometry(0.05, 8, 6), '#5f7f6a', 0.09, 0.18, 0, 1, 1.1, 0.9),
    part(new THREE.SphereGeometry(0.04, 8, 6), '#7a7f8c', 0.13, 0.23, 0),
    part(new THREE.ConeGeometry(0.012, 0.04, 4).rotateZ(-Math.PI / 2), '#d8c8b0', 0.18, 0.225, 0),
    part(new THREE.BoxGeometry(0.1, 0.015, 0.07), '#4a4a50', -0.15, 0.13, 0),
    part(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), '#c0505a', 0.01, 0.03, 0.025),
    part(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 4), '#c0505a', 0.01, 0.03, -0.025),
  ])
}

// Wing pose: folded (1) lies back along the body, spread (0) flaps by `flap` radians.
function fold(wing: THREE.Object3D, folded: number, flap: number) {
  const side = Math.sign(wing.scale.z)
  wing.rotation.y = -side * 1.45 * folded
  wing.rotation.x = -side * flap * (1 - folded)
}

// A flock of pigeons pecking about a spot. When the robot comes close, or every so often
// on their own, they all take off and land again somewhere else nearby.
interface Pigeon {
  g: THREE.Group
  body: THREE.Mesh
  wings: THREE.Mesh[]
  x: number
  z: number
  y: number
  heading: number
  peck: number
  hop: number
  flight: { from: XZ; to: XZ; t: number; dur: number; top: number } | null
}

export function createPigeonFlock(x: number, z: number, nav: NavGrid, emit: Emit, count = 7) {
  const root = new THREE.Group()
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
  const wingGeo = new THREE.BoxGeometry(0.07, 0.012, 0.17).translate(0, 0, 0.085)
  const wingMat = mat('#6f7480')
  const birds: Pigeon[] = []
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group()
    g.scale.setScalar(1.4)
    const body = new THREE.Mesh(pigeonBody(), bodyMat)
    body.castShadow = true
    const wings = [1, -1].map((side) => {
      const w = new THREE.Mesh(wingGeo, wingMat)
      w.position.set(0.0, 0.16, side * 0.05)
      w.scale.z = side
      w.castShadow = true
      g.add(w)
      return w
    })
    g.add(body)
    root.add(g)
    const a = rand() * Math.PI * 2
    const r = rand() * 1.6
    birds.push({ g, body, wings, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, y: 0, heading: rand() * 6, peck: rand() * 10, hop: 0, flight: null })
  }
  let centre: XZ = [x, z]
  let restless = range(40, 90)
  let airborne = false

  function takeOff(robot: PointXZ) {
    // Land well away from whatever spooked them, on open ground.
    let spot: XZ | null = null
    for (let i = 0; i < 24 && !spot; i++) {
      const a = Math.atan2(centre[1] - robot.z, centre[0] - robot.x) + range(-1.2, 1.2)
      const r = range(9, 18)
      const sx = centre[0] + Math.cos(a) * r
      const sz = centre[1] + Math.sin(a) * r
      if (nav.walkable(sx, sz)) spot = [sx, sz]
    }
    if (!spot) return
    emit('flutter', centre[0], centre[1])
    airborne = true
    centre = spot
    for (const b of birds) {
      let tx = spot[0] + range(-1.6, 1.6)
      let tz = spot[1] + range(-1.6, 1.6)
      if (!nav.walkable(tx, tz)) [tx, tz] = spot
      const dist = Math.hypot(tx - b.x, tz - b.z)
      b.flight = { from: [b.x, b.z], to: [tx, tz], t: -range(0, 0.35), dur: dist / range(6, 8), top: range(2.5, 4.5) }
    }
  }

  return {
    kind: 'pigeon' as const,
    object: root,
    positions: birds.map((b) => b.g.position),
    update(t: number, dt: number, robot: PointXZ) {
      restless -= dt

      const near = birds.some((b) => !b.flight && Math.hypot(robot.x - b.x, robot.z - b.z) < 3)
      if (!airborne && (near || restless <= 0)) {
        takeOff(near ? robot : { x: centre[0] + range(-1, 1), z: centre[1] + range(-1, 1) })
        restless = range(40, 90)
      }
      let flying = 0
      for (const b of birds) {
        if (b.flight) {
          const f = b.flight
          f.t += dt
          const k = THREE.MathUtils.clamp(f.t / f.dur, 0, 1)
          const e = k * k * (3 - 2 * k)
          b.x = f.from[0] + (f.to[0] - f.from[0]) * e
          b.z = f.from[1] + (f.to[1] - f.from[1]) * e
          b.y = Math.sin(k * Math.PI) * f.top
          b.heading = Math.atan2(-(f.to[1] - f.from[1]), f.to[0] - f.from[0])
          // Flap hard on the climb, glide in to land.
          const flap = k < 0.75 ? Math.sin(t * 38 + b.peck) * 1.1 : 0.25
          b.wings.forEach((w) => fold(w, f.t > 0 ? 0 : 1, flap))
          if (k >= 1) {
            b.flight = null
            b.y = 0
          } else flying++
        } else {
          b.wings.forEach((w) => fold(w, 1, 0))
          // Peck, and now and then shuffle a short step.
          b.hop -= dt
          if (b.hop <= 0) {
            b.hop = range(0.8, 3)
            b.heading += range(-1.2, 1.2)
          }
          if (b.hop > 0.5 && b.hop < 0.8) {
            b.x += Math.cos(b.heading) * dt * 0.5
            b.z -= Math.sin(b.heading) * dt * 0.5
          }
          b.body.rotation.z = Math.max(0, Math.sin(t * 7 + b.peck)) * -0.5
        }
        b.g.rotation.y = turnToward(b.g.rotation.y, b.heading, Math.min(1, dt * 8))
        b.g.position.set(b.x, heightAt(b.x, b.z) + b.y, b.z)
      }
      airborne = flying > 0
    },
  }
}

export type Cat = ReturnType<typeof createCat>
export type Dog = ReturnType<typeof createDog>
export type PigeonFlock = ReturnType<typeof createPigeonFlock>
export type Stray = Cat | Dog | PigeonFlock

