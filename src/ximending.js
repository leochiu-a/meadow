import * as THREE from 'three'
import { setTerrain, noise, rand, range, pick, smoothstep } from './terrain.js'
import { windUniforms } from './wind.js'
import { createCityGround, GROUND, SIDEWALK, VEHICLE, MALL } from './city-ground.js'
import { shophouse, mappedBuilding, toppledTower, flushCityParts, batchStatic } from './city.js'
import { buildBlockers } from './collision.js'
import { car, streetLamp, redHouseDressing, mrtExit, giantScreen } from './city-props.js'
import { createGrass, createFlowers, createReeds, createTree, createBush } from './vegetation.js'
import { brickMaterial } from './bricks.js'
import { withCutaway } from './cutaway.js'
import data from './data/ximending.json'

// Ruined Ximending, laid out from the real street plan (OpenStreetMap): the district decades
// after it emptied out. Streets crack and green over, signs hang dead, and some blocks have
// come down altogether. MRT Ximen Exit 6 is the origin.

const cityTerrain = { heightAt: () => 0 }
const { minX, maxX, minZ, maxZ } = data.bounds

// ---------------------------------------------------------------- occupancy

// One-metre grid of taken ground (mapped buildings, fillers, the fallen tower) so procedural
// buildings only go up on genuinely empty lots.
function occupancy() {
  const cols = Math.ceil(maxX - minX)
  const taken = new Uint8Array(cols * Math.ceil(maxZ - minZ))
  const idx = (x, z) => Math.floor(z - minZ) * cols + Math.floor(x - minX)
  const inside = (x, z) => x >= minX && x < maxX && z >= minZ && z < maxZ
  return {
    has: (x, z) => !inside(x, z) || taken[idx(x, z)] === 1,
    mark(x, z) {
      if (inside(x, z)) taken[idx(x, z)] = 1
    },
    polygon(pts) {
      const xs = pts.map((p) => p[0])
      const zs = pts.map((p) => p[1])
      for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
        for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z++) {
          if (pointInPolygon(x + 0.5, z + 0.5, pts)) this.mark(x + 0.5, z + 0.5)
        }
      }
    },
  }
}

function pointInPolygon(x, z, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// Points across a rectangle centred (cx, cz), w along (dx, dz), d across it.
function rectSamples(cx, cz, dx, dz, w, d, n = 4) {
  const out = []
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const a = (i / n - 0.5) * w
      const b = (j / n - 0.5) * d
      out.push([cx + dx * a - dz * b, cz + dz * a + dx * b])
    }
  }
  return out
}

// ---------------------------------------------------------------- streets

const roadsNamed = (name) => data.roads.filter((r) => r.name === name)
const streets = data.roads.filter((r) => (VEHICLE.has(r.kind) && r.kind !== 'service') || (MALL.has(r.kind) && !r.area))

// Closest point between two named streets: their crossing.
function crossing(a, b) {
  let best = { d: Infinity, p: null }
  for (const ra of roadsNamed(a)) {
    for (let i = 0; i < ra.pts.length - 1; i++) {
      const [ax, az] = ra.pts[i]
      const [bx, bz] = ra.pts[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz
      for (const rb of roadsNamed(b)) {
        for (const [vx, vz] of rb.pts) {
          const t = Math.max(0, Math.min(1, ((vx - ax) * dx + (vz - az) * dz) / len2))
          const d = Math.hypot(vx - ax - dx * t, vz - az - dz * t)
          if (d < best.d) best = { d, p: [ax + dx * t, az + dz * t] }
        }
      }
    }
  }
  return best.p
}

// Nearest point on any street centreline to (x, z).
function nearestStreet(x, z) {
  let best = { d: Infinity, p: [x, z] }
  for (const r of streets) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
      const px = ax + dx * t
      const pz = az + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (d < best.d) best = { d, p: [px, pz] }
    }
  }
  return best.p
}

// Walk both kerbs of every street, offering each facade slot to `fn(x, z, faceX, faceZ, along)`
// where (faceX, faceZ) points from the lot toward the street.
function alongKerbs(step, fn) {
  for (const r of streets) {
    const setback = r.width / 2 + (VEHICLE.has(r.kind) ? SIDEWALK : 0) + 0.2
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const dx = (bx - ax) / len
      const dz = (bz - az) / len
      for (const side of [-1, 1]) {
        for (let t = step() / 2; t < len; t += step()) {
          const x = ax + dx * t - dz * side * setback
          const z = az + dz * t + dx * side * setback
          fn(x, z, dz * side, -dx * side, [dx, dz], r)
        }
      }
    }
  }
}

// ---------------------------------------------------------------- vegetation rules

// How far nature has taken back each spot: whole stretches gone to meadow, the rest only
// greening along cracks and at the foot of walls.
const reclaimed = (x, z) => noise.noise(x * 0.06 + 11, z * 0.06) * 0.5 + 0.5
const GREENS = ['#6f9a2e', '#86a83a', '#5e8a2a', '#9fb04a']
const STRAW = ['#b9a35a', '#a89048', '#c8b46a']
const tmpColor = new THREE.Color()
const cellKey = (x, z) => Math.round(x / 0.5) * 100000 + Math.round(z / 0.5)

function cityGrass(blocked, groundAt, crackCells) {
  return (x, z, color) => {
    if (blocked(x, z)) return 0
    const ground = groundAt(x, z)
    const wild = reclaimed(x, z)
    let chance = ground === GROUND.lot ? 0.6 : 0.04
    chance += smoothstep(0.55, 0.8, wild) * 0.85
    if (crackCells.has(cellKey(x, z))) chance += 0.7
    if (rand() > chance) return 0
    // Dry and green swathes follow broad noise so the weeds read as patches, not confetti.
    const dry = noise.noise(x * 0.11 - 7, z * 0.11) * 0.5 + 0.5
    color.set(pick(dry > 0.55 ? STRAW : GREENS)).lerp(tmpColor.set(pick(dry > 0.55 ? GREENS : STRAW)), Math.abs(dry - 0.55) < 0.08 ? 0.5 : 0)
    color.offsetHSL(range(-0.015, 0.015), range(-0.05, 0.02), range(-0.04, 0.04) + (reclaimed(x * 3, z * 3) - 0.5) * 0.1)
    return range(0.18, 0.4) * (0.7 + wild * 0.8)
  }
}

function cityFlowers(blocked) {
  return (x, z) => {
    if (blocked(x, z) || reclaimed(x, z) < 0.6 || rand() > 0.35) return null
    return { color: pick(['#ffffff', '#f4e9b0', '#e8c8f0', '#ffd24a']), big: false }
  }
}

// Dust hanging over the district, drifting on the wind; positions wrap inside the bounds.
function dust() {
  const count = 9000
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) pos.set([range(minX, maxX), range(0.3, 14), range(minZ, maxZ)], i * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color: '#f2dcb0', size: 0.09, transparent: true, opacity: 0.55, depthWrite: false })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.x = mod(transformed.x - ${minX.toFixed(1)} + uTime * 0.35 + sin(uTime * 0.3 + transformed.z) * 0.6, ${(maxX - minX).toFixed(1)}) + ${minX.toFixed(1)};
      transformed.y += sin(uTime * 0.5 + transformed.x * 0.7) * 0.4;
      transformed.z = mod(transformed.z - ${minZ.toFixed(1)} + uTime * 0.12, ${(maxZ - minZ).toFixed(1)}) + ${minZ.toFixed(1)};`,
    )
  }
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  return points
}

// ---------------------------------------------------------------- build

const RUINS = (r) => (r < 0.15 ? 'collapsed' : r < 0.35 ? 'shell' : 'none')

function build(scene) {
  setTerrain(cityTerrain)
  const { mesh, cracks, groundAt } = createCityGround(data)
  scene.add(mesh)
  const taken = occupancy()
  const city = new THREE.Group()
  const streetSide = (e) => groundAt(e.mx + e.nx * 2.5, e.mz + e.nz * 2.5) !== GROUND.lot

  // The fallen tower: an eight-storey block on Emei Street that toppled south across it.
  const emei = crossing('漢中街', '峨眉街')
  const towerBase = [emei[0] - 38, emei[1] - 14]
  const towerFace = nearestStreet(...towerBase)
  const fall = Math.atan2(towerFace[0] - towerBase[0], towerFace[1] - towerBase[1])
  const tower = toppledTower({ x: towerBase[0], z: towerBase[1], rotY: fall, w: 8, d: 9, floors: 8 })
  city.add(tower.group)
  const tdx = Math.sin(fall)
  const tdz = Math.cos(fall)
  const towerLen = Math.hypot(tower.to[0] - tower.from[0], tower.to[1] - tower.from[1])
  for (const [x, z] of rectSamples(towerBase[0] + (tdx * towerLen) / 2, towerBase[1] + (tdz * towerLen) / 2, tdz, -tdx, 10, towerLen + 10, 30)) taken.mark(x, z)
  const underTower = (pts) => pts.some(([x, z]) => taken.has(x, z))

  // Mapped buildings at their real size and height; the Red House keeps its brick.
  // The map draws station entrances as small buildings; the canopy stands there instead.
  const isEntrance = (pts) => data.entrances.some((e) => pointInPolygon(e.x, e.z, pts) || pts.some(([x, z]) => Math.hypot(x - e.x, z - e.z) < 3))
  for (const b of data.buildings) {
    if (underTower(b.pts) || isEntrance(b.pts)) continue
    const red = b.name?.includes('紅樓')
    const floors = red ? 2 : Math.max(1, Math.min(14, b.levels ?? Math.floor(range(2, 7))))
    city.add(
      mappedBuilding({
        pts: b.pts,
        floors,
        ruin: red ? 'none' : RUINS(rand()),
        streetSide,
        signs: !red && ['commercial', 'retail', 'yes', 'hotel'].includes(b.kind),
        material: red ? withCutaway(brickMaterial('#9a4634')) : null,
        windows: !red,
      }),
    )
    if (red) city.add(redHouseDressing(b.pts))
    taken.polygon(b.pts)
  }

  // MRT Ximen exits where they really are, each canopy facing its street.
  for (const e of data.entrances.filter((e) => e.name?.includes('捷運'))) {
    const [sx, sz] = nearestStreet(e.x, e.z)
    const yaw = Math.atan2(sx - e.x, sz - e.z)
    city.add(mrtExit(e.x, e.z, yaw, { number: e.ref, length: 5.2 }))
    for (const [ox, oz] of rectSamples(e.x, e.z, Math.cos(yaw), -Math.sin(yaw), 7, 9, 10)) taken.mark(ox, oz)
  }
  // Dead screens on trusses around the Exit 6 square, and one that came down.
  let screens = 0
  for (let tries = 0; tries < 400 && screens < 3; tries++) {
    const a = rand() * Math.PI * 2
    const r = range(10, 22)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r - 6
    if (groundAt(x, z) === GROUND.road || [[0, 0], [3, 0], [-3, 0], [0, -2.5]].some(([ox, oz]) => taken.has(x + ox, z + oz))) continue
    const [sx, sz] = nearestStreet(x, z)
    city.add(giantScreen(x, z, Math.atan2(sx - x, sz - z), screens === 2 ? { w: 6, h: 3.4, fallen: true } : { w: range(6, 8), h: range(3.4, 4.5), lift: range(6, 7.5) }))
    for (const [ox, oz] of rectSamples(x, z, 1, 0, 9, 5)) taken.mark(ox, oz)
    screens++
  }

  // Shophouses fill the frontage the map, the exits and the screens leave empty.
  alongKerbs(
    () => range(5.5, 8.5),
    (x, z, fx, fz, [dx, dz]) => {
      const w = range(5, 8)
      const d = range(9, 13)
      const cx = x - fx * (d / 2)
      const cz = z - fz * (d / 2)
      const samples = rectSamples(cx, cz, dx, dz, w, d)
      if (samples.some(([sx, sz]) => taken.has(sx, sz) || groundAt(sx, sz) !== GROUND.lot)) return
      for (const [sx, sz] of rectSamples(cx, cz, dx, dz, w + 0.6, d + 0.6, 10)) taken.mark(sx, sz)
      const r = rand()
      const ruin = r < 0.14 ? 'collapsed' : r < 0.3 ? 'shell' : r < 0.36 ? 'lean' : 'none'
      city.add(shophouse({ x, z, w, d, floors: Math.floor(range(2, 7)), rotY: Math.atan2(fx, fz), signs: rand() < 0.6 ? 2 : 1, ruin }))
    },
  )

  // Dead cars in the traffic lanes; lamps along the kerbs, some down.
  for (const r of data.roads.filter((r) => ['primary', 'secondary', 'tertiary', 'residential'].includes(r.kind))) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const yaw = Math.atan2(-(bz - az), bx - ax)
      for (let t = range(4, 30); t < len; t += range(18, 45)) {
        const lane = pick([-1, 1]) * r.width * 0.25
        const x = ax + ((bx - ax) * t) / len - ((bz - az) / len) * lane
        const z = az + ((bz - az) * t) / len + ((bx - ax) / len) * lane
        if (Math.hypot(x, z) < 12) continue
        city.add(car(x, z, yaw + (lane > 0 ? 0 : Math.PI) + range(-0.35, 0.35), { taxi: rand() < 0.35, crushed: rand() < 0.15 }))
      }
    }
  }
  alongKerbs(
    () => 16,
    (x, z, fx, fz, dir, r) => {
      if (!VEHICLE.has(r.kind) || r.kind === 'service' || taken.has(x + fx * 2.4, z + fz * 2.4)) return
      city.add(streetLamp(x + fx * 2.4, z + fz * 2.4, Math.atan2(-fz, fx), rand() < 0.3))
    },
  )

  scene.add(batchStatic(city), city, flushCityParts())

  // --- Nature taking the streets back ---
  const blocked = buildBlockers()
  const crackCells = new Set()
  for (const pts of cracks) for (const [x, z] of pts) crackCells.add(cellKey(x, z))
  const bounds = [minX + 1, maxX - 1, minZ + 1, maxZ - 1]
  const area = (maxX - minX) * (maxZ - minZ)
  scene.add(createGrass({ bounds, target: Math.round(area * 1.1), place: cityGrass(blocked, groundAt, crackCells) }))
  scene.add(createFlowers({ bounds, target: Math.round(area * 0.15), place: cityFlowers(blocked) }))
  // Trees seeded in the streets themselves, thickest where the street has gone wild, but
  // never crowding the station exits.
  let trees = 0
  for (let tries = 0; tries < 20000 && trees < area / 1400; tries++) {
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    if (blocked(x, z) || taken.has(x, z) || reclaimed(x, z) < 0.58 || groundAt(x, z) === GROUND.lot) continue
    if (data.entrances.some((e) => Math.hypot(e.x - x, e.z - z) < 7)) continue
    scene.add(rand() < 0.65 ? createTree(x, z, range(0.8, 1.4)) : createBush(x, z, range(0.8, 1.5)))
    trees++
  }
  const reeds = []
  for (let tries = 0; tries < 6000 && reeds.length < area / 900; tries++) {
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    if (!blocked(x, z) && !taken.has(x, z) && reclaimed(x, z) > 0.5) reeds.push([x, z, range(0.4, 0.9)])
  }
  scene.add(createReeds(reeds))
  scene.add(dust())

  return { update() {}, cows: [], chickens: [] }
}

// Patrol: out of Exit 6, up the Hanzhong mall to Emei Street, west to Xining South Road,
// back down to Chengdu Road past the Red House, and along Chengdu Road to the exit again.
const tour = [
  [0, 4],
  crossing('成都路', '漢中街'),
  crossing('漢中街', '峨眉街'),
  crossing('峨眉街', '西寧南路'),
  crossing('成都路', '西寧南路'),
  crossing('成都路', '漢中街'),
]

// Dusty, hazy afternoon light over a dead city.
export default {
  title: '廢土西門町',
  look: {
    background: '#c8bfa6',
    fog: ['#bfb59b', 40, 85],
    hemi: ['#d6dcd8', '#5a5040', 0.95],
    sun: ['#ffd8a6', 4.2],
    sunDirection: new THREE.Vector3(-12, 14, -8).normalize(),
    // Higher and further back than the meadow so streets read between the buildings.
    camera: { offset: [0, 26, 22], hfov: 40 },
  },
  // On the square by MRT Ximen Exit 6.
  start: [0, 4],
  tour,
  attribution: data.attribution,
  build,
}
