import * as THREE from 'three'
import { setTerrain, noise, rand, range, pick, smoothstep } from './terrain.ts'
import { windUniforms } from './wind.ts'
import { createCityGround, GROUND, SIDEWALK, VEHICLE, MALL } from './city-ground.ts'
import { shophouse, mappedBuilding, toppledTower, flushCityParts, batchStatic, cityMat, GROUND_FLOOR, FLOOR } from './city.ts'
import { buildBlockers } from './collision.ts'
import { createNavGrid } from './walkmap.ts'
import { createCat, createDog, createPigeonFlock } from './strays.ts'
import { car, streetLamp, redHouseDressing, mrtExit, giantScreen, discLamp, mallPole, facadeAd, newWorldTower, cinemaFront, ringTotem, haloPole, rooftopBillboard, noodleStand, noticeBoard, evacSign, sandbags } from './city-props.ts'
import { graffiti } from './graffiti.ts'
import { createGrass, createFlowers, createReeds, createTree, createBush, type Area, type Patch } from './vegetation.ts'
import { brickMaterial } from './bricks.ts'
import { withCutaway } from './cutaway.ts'
import { text } from './i18n.ts'
import osm from './data/ximending.json'
import type { DistrictPlan, Entrance } from './osm.ts'
import type { NavGrid, XZ } from './walkmap.ts'
import type { Rainbow } from './city-ground.ts'
import type { Edge, Ruin } from './city.ts'
import type { Emit, Stray } from './strays.ts'
import type { Progress } from './loading.ts'
import type { EchoSpot, Landmarks, Placement, SceneDef, World, WorldEvent } from './world.ts'
import type { ToMap } from './minimap.ts'
import type { EchoId } from './echoes.ts'
import type { RelicId } from './relics.ts'

type Pts = readonly XZ[]
type Here = (x: number, z: number) => boolean

// The map must have what the scene is built around (a street, a crossing, a landmark).
function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`Ximending map data has no ${what}`)
  return value
}
// The point k of the way from a to b.
const at = (a: XZ, b: XZ, k = 0.5): XZ => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]

// Ruined Ximending, laid out from the real street plan (OpenStreetMap): the district decades
// after it emptied out. Streets crack and green over, signs hang dead, and some blocks have
// come down altogether. MRT Ximen Exit 6 is the origin.

const cityTerrain = { heightAt: () => 0 }

// The scene covers the core from the Red House to Exit 6 and up to the Wuchang Street cinemas:
// small enough to carry meadow-thick grass. Map features outside it are dropped.
const VIEW = { minX: -175, maxX: 45, minZ: -268, maxZ: 75 }
const inView = ([x, z]: XZ) => x > VIEW.minX && x < VIEW.maxX && z > VIEW.minZ && z < VIEW.maxZ
const plan = osm as DistrictPlan
const data: DistrictPlan = {
  ...plan,
  bounds: VIEW,
  roads: plan.roads.filter((r) => r.pts.some(inView)),
  buildings: plan.buildings.filter((b) => b.pts.every(inView)),
  entrances: plan.entrances.filter((e) => inView([e.x, e.z])),
}
const { minX, maxX, minZ, maxZ } = data.bounds

// ---------------------------------------------------------------- occupancy

// One-metre grid of taken ground (mapped buildings, fillers, the fallen tower) so procedural
// buildings only go up on genuinely empty lots.
function occupancy() {
  const cols = Math.ceil(maxX - minX)
  const taken = new Uint8Array(cols * Math.ceil(maxZ - minZ))
  const idx = (x: number, z: number) => Math.floor(z - minZ) * cols + Math.floor(x - minX)
  const inside = (x: number, z: number) => x >= minX && x < maxX && z >= minZ && z < maxZ
  return {
    has: (x: number, z: number) => !inside(x, z) || taken[idx(x, z)] === 1,
    mark(x: number, z: number) {
      if (inside(x, z)) taken[idx(x, z)] = 1
    },
    polygon(pts: Pts) {
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

function pointInPolygon(x: number, z: number, pts: Pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// Points across a rectangle centred (cx, cz), w along (dx, dz), d across it.
function rectSamples(cx: number, cz: number, dx: number, dz: number, w: number, d: number, n = 4) {
  const out: XZ[] = []
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

const roadsNamed = (name: string) => data.roads.filter((r) => r.name === name)
const streets = data.roads.filter((r) => (VEHICLE.has(r.kind) && r.kind !== 'service') || (MALL.has(r.kind) && !r.area))

// Closest point between two named streets: their crossing.
function crossing(a: string, b: string): XZ {
  let best: { d: number; p: XZ | null } = { d: Infinity, p: null }
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
  return must(best.p, `crossing of ${a} and ${b}`)
}

// Nearest point on any street centreline to (x, z).
function nearestStreet(x: number, z: number) {
  let best: { d: number; p: XZ } = { d: Infinity, p: [x, z] }
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
function alongKerbs(step: () => number, fn: (x: number, z: number, faceX: number, faceZ: number, along: XZ, road: (typeof streets)[number]) => void) {
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

// How far nature has taken back each spot: wild stretches have lost all their paving.
const reclaimed = (x: number, z: number) => noise.noise(x * 0.06 + 11, z * 0.06) * 0.5 + 0.5
const cellKey = (x: number, z: number) => Math.round(x / 0.5) * 100000 + Math.round(z / 0.5)

// The meadow scene's palette: lush greens with sun-dried orange swathes.
const GRASS = ['#5aa426', '#98cc34', '#cfe06a'].map((c) => new THREE.Color(c))
const DRY = ['#d9862e', '#eeb04a'].map((c) => new THREE.Color(c))
const tmpColor = new THREE.Color()

function meadowColor(x: number, z: number, color: THREE.Color) {
  const n = noise.noise(x * 0.08, z * 0.08) * 0.5 + 0.5
  const m = noise.noise(x * 0.4 + 10, z * 0.4) * 0.5 + 0.5
  color.copy(GRASS[0]).lerp(GRASS[1], n).lerp(GRASS[2], m * m * 0.6)
  const dry = smoothstep(0.74, 0.9, noise.noise(x * 0.05 + 40, z * 0.05) * 0.5 + 0.5)
  if (dry > 0) color.lerp(tmpColor.copy(DRY[0]).lerp(DRY[1], m), dry * 0.7)
  const patch = noise.noise(x * 0.9 + 3, z * 0.9) * 0.5 + 0.5
  return color.offsetHSL(range(-0.02, 0.02) + (patch - 0.5) * 0.03, range(-0.04, 0.04), (patch - 0.5) * 0.14 + range(-0.04, 0.04))
}

// Meadow wherever earth shows through; on surviving paving only the odd weed in a crack.
// tiled(x, z): on a ruin's ground-floor tiles, where weeds only come up between them.
function cityGrass(blocked: Here, groundAt: (x: number, z: number) => number, overgrownAt: (x: number, z: number) => number, crackCells: Set<number>, tiled: Here) {
  return (x: number, z: number, color: THREE.Color) => {
    if (blocked(x, z)) return 0
    const open = tiled(x, z) ? 0 : overgrownAt(x, z)
    // Turf creeps over what paving survives, and weeds come up through the cracks.
    // The rainbow crossing is kept mostly clear so its bands still read.
    const sparse = groundAt(x, z) === GROUND.kept ? 0.08 : 0.25
    if (open < 0.45 && rand() > (crackCells.has(cellKey(x, z)) ? 0.6 : sparse)) return 0
    const clump = noise.noise(x * 0.5, z * 0.5) * 0.5 + 0.5
    if (open >= 0.45 && rand() > 0.6 + clump * 0.4) return 0
    meadowColor(x, z, color)
    const tall = range(0.24, 0.46) * (0.75 + clump * 0.7)
    return open >= 0.45 ? tall : tall * 0.6
  }
}

const SPECKS = ['#ffffff', '#f2eefc', '#e3dcf6', '#d9d2f2', '#fffbe8']
const DRIFTS = [['#ff5a5a', '#ff7a6a'], ['#6f8cff', '#8aa4ff'], ['#c88cff', '#b07af0'], ['#ff8fb8', '#ffb3cf']]

// Pale specks through the turf, saturated colour in tight drifts, as in the meadow.
function cityFlowers(blocked: Here, overgrownAt: (x: number, z: number) => number, tiled: Here) {
  return (x: number, z: number) => {
    // On a ruin's tiles, only the odd one that found a crack.
    if (blocked(x, z) || overgrownAt(x, z) < 0.45 || (tiled(x, z) && rand() > 0.15)) return null
    const swathe = noise.noise(x * 0.12 - 20, z * 0.12) * 0.5 + 0.5
    const big = noise.noise(x * 0.18 + 30, z * 0.18) * 0.5 + 0.5 > 0.76
    if (!big && rand() > swathe ** 1.5 * 0.8) return null
    const drift = DRIFTS[Math.floor((noise.noise(x * 0.07, z * 0.07 + 9) * 0.5 + 0.5) * 3.99) % 4]
    return { color: big ? pick(drift) : pick(SPECKS), big }
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

// The six-colour rainbow crossing as the map has it (a crossing tagged surface:colour=
// rainbow, just west of Exit 6): bands run along the walking direction.
function rainbowCrossing(): Rainbow | null {
  const way = data.roads.find((r) => r.colour === 'rainbow')
  if (!way) return null
  const [ax, az] = way.pts[0]
  const [bx, bz] = way.pts[way.pts.length - 1]
  return { x: (ax + bx) / 2, z: (az + bz) / 2, angle: Math.atan2(bz - az, bx - ax), length: Math.hypot(bx - ax, bz - az) + 3, width: 7 }
}

// ---------------------------------------------------------------- build

// Decades on, few blocks stand whole: most are gutted shells, many have come down.
const RUINS = (r: number): Exclude<Ruin, 'lean'> => (r < 0.35 ? 'collapsed' : r < 0.85 ? 'shell' : 'none')

async function build(scene: THREE.Scene, progress: Progress): Promise<World> {
  await progress(0, text.loading.city.roads)
  setTerrain(cityTerrain)
  const rainbow = rainbowCrossing()
  const { mesh, cracks, groundAt, overgrownAt } = createCityGround(data, { wild: reclaimed, rainbow })
  scene.add(mesh)
  const taken = occupancy()
  // The ruins' tiled ground floors, which the grass only thinly covers.
  const ruinFloors = occupancy()
  const city = new THREE.Group()
  const streetSide = (e: Pick<Edge, 'mx' | 'mz' | 'nx' | 'nz'>) => groundAt(e.mx + e.nx * 2.5, e.mz + e.nz * 2.5) !== GROUND.lot

  // The fallen tower: an eight-storey block on Emei Street that toppled over.
  const emei = crossing('漢中街', '峨眉街')
  // Its stump stands well back from Emei Street so the debris heaped there leaves the
  // street open.
  const seedBase: XZ = [emei[0] - 38, emei[1] - 14]
  const towerFace = nearestStreet(...seedBase)
  const away = Math.hypot(seedBase[0] - towerFace[0], seedBase[1] - towerFace[1]) || 1
  const towerBase: XZ = [towerFace[0] + ((seedBase[0] - towerFace[0]) / away) * 12, towerFace[1] + ((seedBase[1] - towerFace[1]) / away) * 12]
  const fall = Math.atan2(towerBase[0] - towerFace[0], towerBase[1] - towerFace[1])
  const tower = toppledTower({ x: towerBase[0], z: towerBase[1], rotY: fall, w: 8, d: 9, floors: 8 })
  city.add(tower.group)
  const tdx = Math.sin(fall)
  const tdz = Math.cos(fall)
  const towerLen = Math.hypot(tower.to[0] - tower.from[0], tower.to[1] - tower.from[1])
  for (const [x, z] of rectSamples(towerBase[0] + (tdx * towerLen) / 2, towerBase[1] + (tdz * towerLen) / 2, tdz, -tdx, 10, towerLen + 10, 30)) taken.mark(x, z)
  const underTower = (pts: Pts) => pts.some(([x, z]) => taken.has(x, z))

  await progress(0.02, text.loading.city.blocks)
  // Mapped buildings at their real size and height; the Red House keeps its brick.
  // The map draws station entrances as small buildings; the canopy stands there instead.
  // Renamed cinemas for the Wuchang Street fronts, one per qualifying building.
  const cinemaNames = ['國寶影城', '日昇戲院', '樂生影城', '豪景戲院']
  let billboards = 3
  let graffitiDone = false
  // Where 日昇戲院 stands: the cinema from the ticket stub.
  let sunrise: XZ | null = null
  const isEntrance = (pts: Pts) => data.entrances.some((e) => pointInPolygon(e.x, e.z, pts) || pts.some(([x, z]) => Math.hypot(x - e.x, z - e.z) < 3))
  for (const b of data.buildings) {
    if (underTower(b.pts) || isEntrance(b.pts)) continue
    const red = b.name?.includes('紅樓')
    const newWorld = b.name === '新世界大樓'
    const floors = red ? 2 : Math.max(1, Math.min(14, b.levels ?? Math.floor(range(2, 7))))
    // Around the Exit 6 square the blocks people know stand, weathered, under their ads.
    const atSquare = Math.hypot(centroid(b.pts)[0] - exit6.x, centroid(b.pts)[1] - exit6.z) < 50
    // Fronts people know (the cinemas, Emei Street) mostly stand too, weathered.
    // Cinema fronts only on the north side, facing south toward the camera.
    const wuchangFace = onCinemaStrip(b.pts) ? streetFace(b.pts, '武昌街二段') : null
    const cinemaFace = wuchangFace && wuchangFace.nz > 0.3 ? wuchangFace : null
    const emeiFace = streetFace(b.pts, '峨眉街')
    const known = atSquare || wuchangFace || emeiFace
    const ruin: Exclude<Ruin, 'lean'> = red || newWorld || cinemaFace ? 'none' : known ? (rand() < 0.65 ? 'none' : 'shell') : RUINS(rand())
    city.add(
      mappedBuilding({
        pts: b.pts,
        floors,
        ruin,
        streetSide,
        signs: !red && ['commercial', 'retail', 'yes', 'hotel'].includes(b.kind),
        material: red ? withCutaway(brickMaterial('#9a4634')) : newWorld ? cityMat('#e6e4dc', { grime: 1.1 }) : null,
        windows: !red,
      }),
    )
    if (red) city.add(redHouseDressing(b.pts))
    if (newWorld) city.add(newWorldTower(b.pts, GROUND_FLOOR + floors * FLOOR, rainbow ? [rainbow.x, rainbow.z] : [exit6.x, exit6.z]))
    if (atSquare && !newWorld && ruin === 'none') hangAds(city, b.pts, GROUND_FLOOR + floors * FLOOR, (x: number, z: number) => !taken.has(x, z))
    const height = GROUND_FLOOR + floors * FLOOR
    if (cinemaFace && ruin === 'none' && cinemaNames.length && cinemaFace.len > 5) {
      const f = cinemaFace
      // Posters at eye level along the front, where the camera's steep angle can read them.
      const name = cinemaNames.shift()!
      if (name === '日昇戲院') sunrise = [f.mx, f.mz]
      city.add(cinemaFront(f.mx, f.mz, f.yaw, f.len * 0.9, 0.8, name))
    }
    if (emeiFace && ruin === 'none' && billboards > 0 && emeiFace.len > 6 && rand() < 0.6) {
      const f = emeiFace
      city.add(rooftopBillboard(f.mx - f.nx * 1.5, f.mz - f.nz * 1.5, f.yaw, Math.min(10, f.len * 0.9), Math.min(5, f.len * 0.45), height))
      billboards--
    }
    if (wuchangFace && wuchangFace.nz > 0.3 && wuchangFace.len > 6 && !graffitiDone && centroid(b.pts)[0] < -80) {
      const f = wuchangFace
      const art = graffiti(Math.min(8, f.len * 0.8), 'piece')
      art.position.set(f.mx + f.nx * 0.2, 2.6, f.mz + f.nz * 0.2)
      art.rotation.y = f.yaw
      city.add(art)
      graffitiDone = true
    }
    taken.polygon(b.pts)
    if (ruin !== 'none') ruinFloors.polygon(b.pts)
  }

  await progress(0.07, text.loading.city.street)
  // MRT Ximen exits where and how the map draws them.
  for (const e of data.entrances.filter((e) => e.name?.includes('捷運'))) {
    const exit = exitPlan(e)
    city.add(mrtExit(exit.x, exit.z, exit.yaw, { number: e.ref, length: exit.length, width: exit.width }))
    for (const [ox, oz] of rectSamples(exit.x, exit.z, Math.cos(exit.yaw), -Math.sin(exit.yaw), exit.width + 3, exit.length + 6, 12)) taken.mark(ox, oz)
  }
  // Wuchang Street's ringed light totems down the cinema strip, Emei Street's teal halo
  // poles along both kerbs, and the noodle stand at the Emei Street corner.
  alongNamed('武昌街二段', 13, (x: number, z: number, nx: number, nz: number, side: number) => {
    if (!onCinemaStrip([[x, z]]) || side < 0) return
    const tx = x + nx * 1.2
    const tz = z + nz * 1.2
    if (!taken.has(tx, tz)) city.add(ringTotem(tx, tz, { lean: rand() < 0.25 ? range(0.1, 0.3) : 0 }))
  })
  alongNamed('峨眉街', 15, (x: number, z: number, nx: number, nz: number) => {
    const tx = x + nx * 0.8
    const tz = z + nz * 0.8
    if (!taken.has(tx, tz) && inView([tx, tz])) city.add(haloPole(tx, tz, { lean: rand() < 0.25 ? range(0.08, 0.25) : 0 }))
  })
  {
    // Backed against the north storefronts, facing south, so its sign faces the camera.
    const [ex, ez] = crossing('漢中街', '峨眉街')
    const stand = kerb('峨眉街', ex - 14, ez, 0.3)
    city.add(noodleStand(stand.x, stand.z, stand.yaw))
    for (const [ox, oz] of rectSamples(stand.x, stand.z, 1, 0, 8, 4)) taken.mark(ox, oz)
  }

  // The last months before everyone left: notices posted after the great flood, the way to
  // high ground, and the sandbags shops stacked against the water.
  {
    const emei = crossing('漢中街', '峨眉街')
    const wuchang = crossing('漢中街', '武昌街二段')
    const cinemas = crossing('西寧南路', '武昌街二段')
    const chengdu = crossing('漢中街', '成都路')
    const redHouse = centroid(redHouseFootprint())
    type Spot = ReturnType<typeof kerb>
    const put = (spot: Spot, make: (s: Spot) => THREE.Object3D, size = 2) => {
      if (taken.has(spot.x, spot.z)) return
      city.add(make(spot))
      for (const [ox, oz] of rectSamples(spot.x, spot.z, 1, 0, size, size)) taken.mark(ox, oz)
    }
    const board = (kind: Parameters<typeof noticeBoard>[3]) => (s: Spot) => noticeBoard(s.x, s.z, 0, kind)
    put(kerb('成都路', exit6.x - 7, exit6.z, 0.6), board('relocation'))
    put(kerb('峨眉街', emei[0] - 9.5, emei[1], 0.5), board('noodle'))
    put(kerb('武昌街二段', ...at(wuchang, cinemas, 0.35), 0.6), board('cinema'))
    put(kerb('成都路', redHouse[0] + 4, redHouse[1], 0.6), board('volunteer'))
    put(kerb('漢中街', ...at(chengdu, emei, 0.55), 0.6), board('relocation'))
    put(kerb('漢中街', ...at(emei, wuchang, 0.5), 0.6), (s) => evacSign(s.x, s.z, 0, 1), 1)
    put(kerb('西寧南路', ...at(crossing('西寧南路', '峨眉街'), cinemas, 0.3), 0.6), (s) => evacSign(s.x, s.z, 0, -1), 1)
    // The station's last-train notice beside the Exit 6 mouth, and sandbags along its sides.
    const ax = Math.sin(exit6.yaw)
    const az = Math.cos(exit6.yaw)
    const mouth: XZ = [exit6.x + ax * (exit6.length / 2 + 1.4) + az * (exit6.width / 2 + 0.9), exit6.z + az * (exit6.length / 2 + 1.4) - ax * (exit6.width / 2 + 0.9)]
    city.add(noticeBoard(...mouth, 0, 'lastTrain'))
    for (const side of [-1, 1]) {
      const off = exit6.width / 2 + 0.55
      city.add(sandbags(exit6.x + az * off * side + ax * exit6.length * 0.15, exit6.z - ax * off * side + az * exit6.length * 0.15, exit6.yaw - Math.PI / 2, exit6.length * 0.5, 3))
    }
    const bagged: [string, number, number][] = [['峨眉街', emei[0] - 26, emei[1]], ['峨眉街', emei[0] - 36, emei[1]], ['武昌街二段', ...at(wuchang, cinemas, 0.7)], ['漢中街', ...at(chengdu, emei, 0.25)]]
    for (const [street, x, z] of bagged) {
      put(kerb(street, x, z, 0.4), (s) => sandbags(s.x, s.z, s.yaw, range(2.2, 3.4), rand() < 0.5 ? 2 : 3), 3)
    }
  }

  // The Exit 6 square's disc lamps, a couple heaved over by roots.
  for (const [ox, oz] of [[-12, 7], [-11, -7], [13, 7], [6, -10], [-4, 11]]) {
    const x = exit6.x + ox
    const z = exit6.z + oz
    if (taken.has(x, z) || groundAt(x, z) === GROUND.road) continue
    city.add(discLamp(x, z, rand() < 0.3 ? range(0.08, 0.2) : 0))
    taken.mark(x, z)
  }
  // Hanzhong Street's yellow poles up the middle of the mall, some bent or down.
  const hanzhong = roadsNamed('漢中街').find((r) => MALL.has(r.kind))
  if (hanzhong) {
    const pts = [...hanzhong.pts].reverse()
    let carry = 6
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const yaw = Math.atan2(-(bz - az), bx - ax) + Math.PI / 2
      for (let t = carry; t < len; t += 14) {
        const x = ax + ((bx - ax) * t) / len
        const z = az + ((bz - az) * t) / len
        if (!inView([x, z])) continue
        const r = rand()
        city.add(mallPole(x, z, yaw, { fallen: r < 0.15, bent: r > 0.75 ? range(0.15, 0.4) : 0 }))
      }
      carry = (carry - len) % 14
      if (carry < 0) carry += 14
    }
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

  await progress(0.08, text.loading.city.shophouses)
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
      const ruin = r < 0.35 ? 'collapsed' : r < 0.8 ? 'shell' : r < 0.88 ? 'lean' : 'none'
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
        if (Math.hypot(x, z) < 12 || groundAt(x, z) === GROUND.kept || (rainbow && Math.hypot(x - rainbow.x, z - rainbow.z) < 9)) continue
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

  await progress(0.1, text.loading.city.merge)
  scene.add(batchStatic(city), city, flushCityParts())

  // --- Nature taking the streets back ---
  const blocked = buildBlockers()
  const crackCells = new Set<number>()
  for (const pts of cracks) for (const [x, z] of pts) crackCells.add(cellKey(x, z))
  const bounds: Area = [minX + 1, maxX - 1, minZ + 1, maxZ - 1]
  const area = (maxX - minX) * (maxZ - minZ)
  const grow = (f: number) => progress(0.14 + 0.46 * f, text.loading.city.grass)
  scene.add(await createGrass({ bounds, target: Math.round(area * 26), place: cityGrass(blocked, groundAt, overgrownAt, crackCells, (x, z) => ruinFloors.has(x, z)), progress: grow }))
  await progress(0.87, text.loading.city.flowers)
  // Sparser than the meadow (about 10 a square metre) but enough to dot the turf.
  scene.add(createFlowers({ bounds, target: Math.round(area * 3), place: cityFlowers(blocked, overgrownAt, (x, z) => ruinFloors.has(x, z)) }))
  await progress(0.91, text.loading.city.trees)
  // Trees seeded in the streets themselves, thickest where the street has gone wild, but
  // never crowding the station exits.
  let trees = 0
  for (let tries = 0; tries < 20000 && trees < area / 700; tries++) {
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    if (blocked(x, z) || taken.has(x, z) || reclaimed(x, z) < 0.5 || overgrownAt(x, z) < 0.45) continue
    if (data.entrances.some((e) => Math.hypot(e.x - x, e.z - z) < 7)) continue
    scene.add(rand() < 0.65 ? createTree(x, z, range(0.8, 1.4)) : createBush(x, z, range(0.8, 1.5)))
    trees++
  }
  const reeds: Patch[] = []
  for (let tries = 0; tries < 6000 && reeds.length < area / 900; tries++) {
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    if (!blocked(x, z) && !taken.has(x, z) && reclaimed(x, z) > 0.5) reeds.push([x, z, range(0.4, 0.9)])
  }
  scene.add(createReeds(reeds))
  scene.add(dust())

  // Every collider is in place now: plan routes on them, and draw the minimap from them.
  await progress(0.99, text.loading.routes)
  const nav = createNavGrid(data.bounds)
  const { animals, events } = strays(scene, nav, (x: number, z: number) => overgrownAt(x, z) < 0.45)
  const relics = relicSpots(nav)
  const echoes = echoSpots(nav)
  return {
    update(t, dt, robot) {
      for (const a of animals) a.update(t, dt, robot)
    },
    events,
    animals,
    voices: {
      cat: animals.flatMap((a) => (a.kind === 'cat' ? [a.position] : [])),
      dog: animals.flatMap((a) => (a.kind === 'dog' ? [a.position] : [])),
      pigeon: animals.flatMap((a) => (a.kind === 'pigeon' ? [a.positions[0]] : [])),
    },
    relics,
    echoes,
    landmarks: landmarks(nav, rainbow, sunrise, echoes),
    nav,
    minimap: { bounds: data.bounds, title: text.minimap.ximending, draw: (ctx, px) => drawPlan(ctx, px, nav) } }
}

// Nearest point on a named street's centreline, with the unit normal pointing from the
// street toward (x, z) and the street's half-width.
// A spot `inset` m in from the kerb on `street` near (x, z): the north kerb of an east–west
// street, the west kerb of a north–south one. yaw faces it out across the street, which
// also turns local x along the kerb.
function kerb(street: string, x: number, z: number, inset: number) {
  const road = must(nearestOnRoad(street, x, z), street)
  const eastWest = Math.abs(road.nz) > Math.abs(road.nx)
  const flip = (eastWest ? road.nz > 0 : road.nx > 0) ? -1 : 1
  const nx = road.nx * flip
  const nz = road.nz * flip
  const back = road.half - inset
  return { x: road.px + nx * back, z: road.pz + nz * back, yaw: Math.atan2(-nx, -nz) }
}

function nearestOnRoad(name: string, x: number, z: number) {
  let best: { d: number; px: number; pz: number; nx: number; nz: number; half: number } | null = null
  for (const r of roadsNamed(name)) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
      const px = ax + dx * t
      const pz = az + dz * t
      const d = Math.hypot(x - px, z - pz)
      if (!best || d < best.d) {
        const len = Math.sqrt(len2)
        let nx = -dz / len
        let nz = dx / len
        if (nx * (x - px) + nz * (z - pz) < 0) {
          nx = -nx
          nz = -nz
        }
        best = { d, px, pz, nx, nz, half: r.width / 2 + (VEHICLE.has(r.kind) ? SIDEWALK : 0) }
      }
    }
  }
  return best
}

// The longest wall of a footprint that fronts the named street (its outward normal facing
// the street, its midpoint near the kerb), or null.
function streetFace(pts: Pts, name: string) {
  const [cx, cz] = centroid(pts)
  let best: { mx: number; mz: number; nx: number; nz: number; len: number; yaw: number } | null = null
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 3) continue
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    const road = nearestOnRoad(name, mx, mz)
    if (!road || road.d > road.half + 7 || nx * (road.px - mx) + nz * (road.pz - mz) < 0) continue
    if (!best || len > best.len) best = { mx, mz, nx, nz, len, yaw: Math.atan2(nx, nz) }
  }
  return best
}

// The cinema strip: Wuchang Street from Hanzhong Street west to Xining South Road.
function onCinemaStrip(pts: Pts) {
  const [x, z] = centroid(pts)
  const east = crossing('漢中街', '武昌街二段')
  const west = crossing('武昌街二段', '西寧南路')
  if (x > east[0] + 4 || x < west[0] - 4) return false
  const road = nearestOnRoad('武昌街二段', x, z)
  return !!road && road.d < road.half + 22
}

// Walk a named street every `step` metres, offering each kerb point (both sides) with the
// outward normal from the centreline, and side = ±1.
function alongNamed(name: string, step: number, fn: (x: number, z: number, nx: number, nz: number, side: number) => void) {
  for (const r of roadsNamed(name)) {
    const half = r.width / 2 + (VEHICLE.has(r.kind) ? SIDEWALK : 0)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      for (let t = step / 2; t < len; t += step) {
        for (const side of [-1, 1]) {
          fn(ax + ((bx - ax) * t) / len + nx * side * half, az + ((bz - az) * t) / len + nz * side * half, -nx * side, -nz * side, side)
        }
      }
    }
  }
}

const centroid = (pts: Pts): XZ => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
const footprint = (what: string, test: (name: string) => boolean) => must(data.buildings.find((b) => b.name !== null && test(b.name)), what).pts
const redHouseFootprint = () => footprint('Red House', (name) => name.includes('紅樓'))

// Giant ads hung down every long face of a building that looks out on open ground (street,
// mall or square, not the next building), side by side.
function hangAds(city: THREE.Object3D, pts: Pts, height: number, isOpen: Here) {
  const [cx, cz] = centroid(pts)
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 5) continue
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    if (!isOpen(mx + nx * 4, mz + nz * 4)) continue
    const count = Math.max(1, Math.floor(len / 6))
    const w = Math.min(6, (len / count) * 0.9)
    const h = Math.min(height - GROUND_FLOOR - 1, w * 2)
    if (h < 4) continue
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count
      // Hung clear of the window cages, as the real ones are on frames.
      city.add(facadeAd(ax + (bx - ax) * t + nx * 0.5, az + (bz - az) * t + nz * 0.5, Math.atan2(nx, nz), w, h, height - h - 0.6))
    }
  }
}

// An exit's canopy from the small building the map draws over it: centred on that footprint,
// sized to it, long axis along it, the mouth at whichever end is nearer a street. Without a
// footprint the canopy just faces its nearest street.
function exitPlan(e: Entrance) {
  const b = data.buildings.find((b) => pointInPolygon(e.x, e.z, b.pts) || b.pts.some(([x, z]) => Math.hypot(x - e.x, z - e.z) < 3))
  if (!b) {
    const [sx, sz] = nearestStreet(e.x, e.z)
    return { x: e.x, z: e.z, yaw: Math.atan2(sx - e.x, sz - e.z), length: 8, width: 4.6 }
  }
  const n = b.pts.length
  const cx = b.pts.reduce((a, p) => a + p[0], 0) / n
  const cz = b.pts.reduce((a, p) => a + p[1], 0) / n
  // Principal axis of the footprint.
  let sxx = 0
  let szz = 0
  let sxz = 0
  for (const [x, z] of b.pts) {
    sxx += (x - cx) ** 2
    szz += (z - cz) ** 2
    sxz += (x - cx) * (z - cz)
  }
  const axis = 0.5 * Math.atan2(2 * sxz, sxx - szz)
  const ux = Math.cos(axis)
  const uz = Math.sin(axis)
  const along = b.pts.map(([x, z]) => (x - cx) * ux + (z - cz) * uz)
  const across = b.pts.map(([x, z]) => -(x - cx) * uz + (z - cz) * ux)
  const length = Math.max(...along) - Math.min(...along)
  const width = Math.max(...across) - Math.min(...across)
  const end = (sign: number) => {
    const ex = cx + ux * sign * length * 0.5
    const ez = cz + uz * sign * length * 0.5
    const [sx, sz] = nearestStreet(ex, ez)
    return Math.hypot(sx - ex, sz - ez)
  }
  const mouth = end(1) < end(-1) ? 1 : -1
  return { x: cx, z: cz, yaw: Math.atan2(ux * mouth, uz * mouth), length: Math.min(length, 16), width: Math.min(Math.max(width, 3.6), 6), pts: b.pts }
}

// Just outside the mouth of Exit 6, as if the robot had come up the stairs.
const exit6 = exitPlan(must(data.entrances.find((e) => e.ref === '6'), 'Exit 6'))
// The last order was bound for the Exit 6 mouth; the robot wakes on Emei Street, where it
// stopped when the power went.
const finale: XZ = [exit6.x + Math.sin(exit6.yaw) * (exit6.length / 2 + 3), exit6.z + Math.cos(exit6.yaw) * (exit6.length / 2 + 3)]
const start = ((): XZ => {
  const [ex, ez] = crossing('漢中街', '峨眉街')
  const road = must(nearestOnRoad('峨眉街', ex - 6, ez), '峨眉街')
  return [road.px, road.pz]
})()

// The minimap, drawn like a game map: soft meadow ground, cartoon roads with a dark
// outline, and soft shapes wherever the robot cannot go. No labels or markers.
const MAP = {
  ground: '#9ccf6a',
  groundDot: 'rgba(255,255,255,0.12)',
  roadEdge: '#6b5a3e',
  road: '#f3e2b3',
  block: '#cfc6ad',
  blockShade: 'rgba(80,64,40,0.25)',
}

function drawPlan(ctx: CanvasRenderingContext2D, px: ToMap, nav: NavGrid) {
  const path = (pts: Pts, close = false) => {
    ctx.beginPath()
    pts.forEach(([x, z], i: number) => (i ? ctx.lineTo(...px(x, z)) : ctx.moveTo(...px(x, z))))
    if (close) ctx.closePath()
  }
  // Size in map units: the canvas may be scaled up for high-DPI screens.
  const w = ctx.canvas.width / ctx.getTransform().a
  const h = ctx.canvas.height / ctx.getTransform().d
  // Ground with a scatter of soft dots, like painted grass.
  ctx.fillStyle = MAP.ground
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = MAP.groundDot
  for (let i = 0; i < 260; i++) {
    ctx.beginPath()
    ctx.arc(rand() * w, rand() * h, 0.8 + rand() * 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  // Roads: an outline pass then the fill, two widths only — main roads and the rest.
  const width = (r: { kind: string }) => (['primary', 'secondary', 'tertiary'].includes(r.kind) ? 9 : MALL.has(r.kind) ? 7 : 5)
  for (const [colour, extra] of [[MAP.roadEdge, 2.5], [MAP.road, 0]] as const) {
    for (const r of streets) {
      path(r.pts)
      ctx.strokeStyle = colour
      ctx.lineWidth = width(r) + extra
      ctx.stroke()
    }
  }
  // Everything the robot cannot get to, worked out from the scene's own colliders: walls,
  // rubble, trees and wrecks, and whatever they wall in. Painted from the grid with
  // smoothing so the shapes come out soft, with a drop shadow under them.
  const { cols, rows, cell, reach } = nav
  const mask = document.createElement('canvas')
  mask.width = cols
  mask.height = rows
  const mctx = mask.getContext('2d')!
  const img = mctx.createImageData(cols, rows)
  for (let k = 0; k < reach.length; k++) img.data[k * 4 + 3] = reach[k] ? 0 : 255
  mctx.putImageData(img, 0, 0)
  const [ox, oy] = px(data.bounds.minX, data.bounds.minZ)
  const [ex, ey] = px(data.bounds.minX + cols * cell, data.bounds.minZ + rows * cell)
  const tint = (colour: string) => {
    const t = document.createElement('canvas')
    t.width = cols
    t.height = rows
    const tctx = t.getContext('2d')!
    tctx.drawImage(mask, 0, 0)
    tctx.globalCompositeOperation = 'source-in'
    tctx.fillStyle = colour
    tctx.fillRect(0, 0, cols, rows)
    return t
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(tint(MAP.blockShade), ox, oy + 1.5, ex - ox, ey - oy)
  ctx.drawImage(tint(MAP.block), ox, oy, ex - ox, ey - oy)
}

// Where each of DLV-06's recordings was made (see echoes.js), and the way anything in it
// moved: the ambulance up Hanzhong Street, the two people running opposite ways.
function echoSpots(nav: NavGrid): Record<EchoId, EchoSpot> {
  const emei = crossing('漢中街', '峨眉街')
  const wuchang = crossing('漢中街', '武昌街二段')
  const cinemas = crossing('西寧南路', '武昌街二段')
  const xiningEmei = crossing('西寧南路', '峨眉街')
  const chengdu = crossing('漢中街', '成都路')
  const chengduXining = crossing('西寧南路', '成都路')
  const redHouse = centroid(redHouseFootprint())
  const outOfExit6 = (k: number): XZ => [exit6.x + Math.sin(exit6.yaw) * (exit6.length / 2 + k), exit6.z + Math.cos(exit6.yaw) * (exit6.length / 2 + k)]
  const chengduRoad = must(nearestOnRoad('成都路', exit6.x - 14, exit6.z), '成都路')
  const spots: Record<EchoId, [XZ, [XZ, XZ]?]> = {
    R1: [chengduXining],
    R2: [at(emei, xiningEmei, 0.55)],
    R3: [at(emei, wuchang, 0.5), [chengdu, wuchang]],
    R4: [[redHouse[0] + 9, redHouse[1] + 7]],
    R5: [[chengduRoad.px, chengduRoad.pz]],
    R6: [at(wuchang, cinemas, 0.3)],
    R7: [at(wuchang, cinemas, 0.08)],
    R8: [[redHouse[0] - 6, redHouse[1] + 13]],
    R9: [at(chengdu, chengduXining, 0.4), [at(chengdu, chengduXining, 0.9), chengdu]],
    R10: [at(chengdu, emei, 0.55), [at(chengdu, emei, 0.1), emei]],
    // Close enough that waiting where he called her name brings her steps three minutes on.
    R11: [outOfExit6(1.5)],
    R12: [outOfExit6(5)],
    R13: [[emei[0] - 26, emei[1]]],
    R14: [start],
  }
  const spot = ([[x, z], path]: [XZ, [XZ, XZ]?]): EchoSpot => {
    const [sx, sz] = nav.snap(x, z) ?? [x, z]
    return { x: sx, z: sz, path }
  }
  return {
    R1: spot(spots.R1), R2: spot(spots.R2), R3: spot(spots.R3), R4: spot(spots.R4), R5: spot(spots.R5), R6: spot(spots.R6), R7: spot(spots.R7),
    R8: spot(spots.R8), R9: spot(spots.R9), R10: spot(spots.R10), R11: spot(spots.R11), R12: spot(spots.R12), R13: spot(spots.R13), R14: spot(spots.R14),
  }
}

// Places the story and the robot's habits look for: the order's destination and where it
// woke; the rainbow crossing it waits at and its old patrol (Emei, Hanzhong, Wuchang
// Streets); and where the little unfinished things from the recordings can be done.
function landmarks(nav: NavGrid, rainbow: Rainbow | null, sunrise: XZ | null, echoes: Record<EchoId, EchoSpot>): Landmarks {
  const emei = crossing('漢中街', '峨眉街')
  const wuchang = crossing('漢中街', '武昌街二段')
  const cinemas = crossing('西寧南路', '武昌街二段')
  const xiningEmei = crossing('西寧南路', '峨眉街')
  const snap = ([x, z]: XZ): XZ => nav.snap(x, z) ?? [x, z]
  return {
    finale,
    wake: start,
    crossing: rainbow ? [rainbow.x, rainbow.z] : null,
    patrol: [at(emei, xiningEmei, 0.35), at(emei, wuchang, 0.35), at(wuchang, cinemas, 0.5)].map(snap),
    cinema: snap(sunrise ?? at(wuchang, cinemas, 0.6)),
    redHouse: [echoes.R4.x, echoes.R4.z],
    square: [echoes.R8.x, echoes.R8.z],
  }
}

// Where each relic lies (see relics.js): by the landmark its memory belongs to.
function relicSpots(nav: NavGrid): Placement[] {
  const emei = crossing('漢中街', '峨眉街')
  const wuchang = crossing('漢中街', '武昌街二段')
  const cinemas = crossing('西寧南路', '武昌街二段')
  const xiningEmei = crossing('西寧南路', '峨眉街')
  const chengdu = crossing('漢中街', '成都路')
  const chengduXining = crossing('西寧南路', '成都路')
  const redHouse = centroid(redHouseFootprint())
  const newWorld = centroid(footprint('New World Building', (name) => name === '新世界大樓'))
  const spots: Partial<Record<RelicId, XZ>> = {
    ticket: at(wuchang, cinemas, 0.6),
    noodleBowl: [emei[0] - 11, emei[1] - 2.5],
    card: [exit6.x + 3, exit6.z - 5],
    neon: at(emei, xiningEmei, 0.7),
    cassette: [redHouse[0] + 8, redHouse[1] + 6],
    bubbleTea: at(chengdu, emei, 0.45),
    sneaker: nearestStreet(...newWorld),
    vinyl: at(wuchang, cinemas, 0.15),
    flipPhone: at(xiningEmei, cinemas, 0.5),
    skateboard: at(chengdu, chengduXining, 0.5),
  }
  return Object.entries(spots).map(([id, [x, z]]) => {
    const [sx, sz] = nav.snap(x, z) ?? [x, z]
    return { id, x: sx, z: sz }
  })
}

// The city's new residents: cats about the noodle stand and the cinemas, street dogs on
// their corners, pigeons on the open squares. Sounds they make go into `events`.
// They keep to bare ground (`bare`), where the grass would not hide them.
function strays(scene: THREE.Scene, nav: NavGrid, bare: Here) {
  const events: WorldEvent[] = []
  const emit: Emit = (kind, x, z) => events.push({ kind, x, z })
  const ground: NavGrid = {
    ...nav,
    walkable: (x: number, z: number) => nav.walkable(x, z) && bare(x, z),
    spotNear(x: number, z: number, rMin: number, rMax: number) {
      for (let i = 0; i < 8; i++) {
        const s = nav.spotNear(x, z, rMin, rMax, 3)
        if (s && bare(...s)) return s
      }
      return null
    },
  }
  // The nearest bare walkable spot to (x, z), searching outward.
  const onNav = ([x, z]: XZ): XZ | null => {
    for (let r = 0; r < 16; r += 0.5) {
      for (let a = 0; a < 12; a++) {
        const sx = x + Math.cos((a / 12) * Math.PI * 2) * r
        const sz = z + Math.sin((a / 12) * Math.PI * 2) * r
        if (ground.walkable(sx, sz)) return [sx, sz]
      }
    }
    return null
  }
  const emei = crossing('漢中街', '峨眉街')
  const wuchang = crossing('漢中街', '武昌街二段')
  const cinemas = crossing('西寧南路', '武昌街二段')
  const chengdu = crossing('漢中街', '成都路')
  const redHouse = centroid(redHouseFootprint())
  const square: XZ = [exit6.x, exit6.z]
  const plan: ['cat' | 'dog' | 'pigeon', XZ][] = [
    ['cat', [emei[0] - 12, emei[1] - 2]],
    ['cat', [emei[0] - 16, emei[1] - 3]],
    ['cat', [(wuchang[0] + cinemas[0]) / 2, (wuchang[1] + cinemas[1]) / 2 - 2]],
    ['cat', [redHouse[0] + 6, redHouse[1] + 8]],
    ['cat', [square[0] - 8, square[1] + 6]],
    ['cat', [chengdu[0] - 20, chengdu[1]]],
    ['dog', [chengdu[0] + 4, chengdu[1] - 3]],
    ['dog', [redHouse[0] - 4, redHouse[1] + 10]],
    ['dog', [cinemas[0] + 6, cinemas[1]]],
    ['pigeon', [square[0] + 2, square[1] - 6]],
    ['pigeon', [redHouse[0], redHouse[1] + 12]],
    ['pigeon', [wuchang[0] - 8, wuchang[1]]],
    ['pigeon', [emei[0], emei[1] - 18]],
  ]
  const make = { cat: createCat, dog: createDog, pigeon: createPigeonFlock }
  const animals: Stray[] = []
  for (const [kind, at] of plan) {
    const spot = onNav(at)
    if (!spot) continue
    const a = make[kind](...spot, ground, emit)
    scene.add(a.object)

    animals.push(a)
  }
  return { animals, events }
}

// Patrol: out of Exit 6, up the Hanzhong mall, west along Emei Street past the noodle stand,
// north on Xining South Road, east along the Wuchang Street cinemas, back down Hanzhong to
// Chengdu Road, out to the Red House and back to the exit.
// Each leg [street, from, to, north] follows the street's centreline between its crossings
// with `from` and `to`, so the robot keeps to the street instead of cutting through ruins.
// `north` shifts it that many metres toward the north kerb, past the shopfronts that face
// the camera: the steep framing only shows a few metres beyond the robot.
const LEGS: [street: string, from: string, to: string, north?: number][] = [
  ['漢中街', '成都路', '峨眉街'],
  ['峨眉街', '漢中街', '西寧南路', 2.6],
  ['西寧南路', '峨眉街', '武昌街二段'],
  ['武昌街二段', '西寧南路', '漢中街', 2.6],
  ['漢中街', '武昌街二段', '成都路'],
  ['成都路', '漢中街', '西寧南路'],
  ['成都路', '西寧南路', '漢中街'],
]

// Centreline points of `street` from crossing a to crossing b, a and b included.
function streetLeg(street: string, a: XZ, b: XZ) {
  let best: { err: number; r: (typeof data.roads)[number]; sa: number; sb: number } | null = null
  for (const r of roadsNamed(street)) {
    if (r.kind === 'service') continue
    const proj = (p: XZ) => {
      let bestT: { d: number; s: number } | null = null
      let acc = 0
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i]
        const [bx, bz] = r.pts[i + 1]
        const dx = bx - ax
        const dz = bz - az
        const len = Math.hypot(dx, dz)
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (len * len)))
        const d = Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t)
        if (!bestT || d < bestT.d) bestT = { d, s: acc + t * len }
        acc += len
      }
      return bestT
    }
    const pa = must(proj(a), street)
    const pb = must(proj(b), street)
    const err = pa.d + pb.d
    if (!best || err < best.err) best = { err, r, sa: pa.s, sb: pb.s }
  }
  const leg = must(best, street)
  const out = [a]
  let acc = 0
  const verts = leg.r.pts.map((p, i) => {
    if (i > 0) acc += Math.hypot(p[0] - leg.r.pts[i - 1][0], p[1] - leg.r.pts[i - 1][1])
    return { p, s: acc }
  })
  const lo = Math.min(leg.sa, leg.sb)
  const hi = Math.max(leg.sa, leg.sb)
  const mid = verts.filter((v) => v.s > lo + 1 && v.s < hi - 1).map((v) => v.p)
  out.push(...(leg.sa < leg.sb ? mid : mid.reverse()), b)
  return out
}

const tour: XZ[] = [start]
for (const [street, from, to, north = 0] of LEGS) {
  const leg = streetLeg(street, crossing(street, from), crossing(street, to))
  tour.push(
    ...leg.map(([x, z], i): XZ => {
      if (!north) return [x, z]
      const [ax, az] = leg[Math.max(0, i - 1)]
      const [bx, bz] = leg[Math.min(leg.length - 1, i + 1)]
      const len = Math.hypot(bx - ax, bz - az) || 1
      let nx = -(bz - az) / len
      let nz = (bx - ax) / len
      if (nz > 0) {
        nx = -nx
        nz = -nz
      }
      return [x + nx * north, z + nz * north]
    }),
  )
}

// Dusty, hazy afternoon light over a dead city.
export default {
  look: {
    background: '#c8bfa6',
    fog: ['#bfb59b', 32, 66],
    hemi: ['#d6dcd8', '#5a5040', 0.95],
    sun: ['#ffd8a6', 4.2],
    sunDirection: new THREE.Vector3(-12, 14, -8).normalize(),
    // The meadow's framing, so the turf reads at the same scale.
    camera: { offset: [0, 11, 12.5], hfov: 33 },
  },
  ambience: 'city',
  music: '/music/ximending.mp3',
  start,
  tour,
  attribution: data.attribution,
  build,
} satisfies SceneDef

