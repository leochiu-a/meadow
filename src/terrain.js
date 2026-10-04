import * as THREE from 'three'
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'

export const WORLD_SIZE = 120
export const noise = new SimplexNoise({ random: mulberry32(7) })

export function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = mulberry32(42)
export const range = (a, b) => a + rand() * (b - a)
export const pick = (arr) => arr[Math.floor(rand() * arr.length)]

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Dirt path: from the iron gate at the back-right winding down toward the camera.
export const pathCurve = new THREE.CatmullRomCurve3(
  [
    [14.7, -11.5], [14.2, -7], [13.2, -2], [11.5, 3], [12.8, 9], [11, 15], [8, 22], [6, 30],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)),
)
// Side branch toward the arch culvert.
const branchCurve = new THREE.CatmullRomCurve3(
  [[11.8, 5], [8, 4.2], [5.2, 2.2], [3.6, 0.6]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
)
const pathSamples = [...pathCurve.getSpacedPoints(160), ...branchCurve.getSpacedPoints(60)]

function distToPath(x, z) {
  let best = Infinity
  for (const p of pathSamples) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

export const PLAZA = { minX: -12, maxX: 18, minZ: -27, maxZ: -12.6 }

export function inPlaza(x, z, pad = 0) {
  return x > PLAZA.minX - pad && x < PLAZA.maxX + pad && z > PLAZA.minZ - pad && z < PLAZA.maxZ + pad
}

// Weights of each ground type at a point. Cached on a grid because grass placement queries it a lot.
const GRID = 0.25
const cache = new Map()
export function surfaceAt(x, z) {
  const key = Math.round(x / GRID) * 100000 + Math.round(z / GRID)
  let s = cache.get(key)
  if (s) return s
  const wobble = noise.noise(x * 0.35, z * 0.35) * 0.45
  const path = smoothstep(1.35, 0.55, distToPath(x, z) + wobble)
  // Patches of dry orange turf, mostly in the corner behind the barrels.
  const dryNoise = noise.noise(x * 0.09 + 40, z * 0.09) + noise.noise(x * 0.3, z * 0.3 + 7) * 0.25
  const corner = 1 - smoothstep(6, 13, Math.hypot(x + 14, (z + 6) * 1.3))
  const dry = smoothstep(0.05, 0.35, dryNoise * 0.6 + corner * 0.75 - 0.3)
  const plaza = inPlaza(x, z) ? 1 : 0
  s = { path, dry, plaza }
  cache.set(key, s)
  return s
}

export function heightAt(x, z) {
  const s = surfaceAt(x, z)
  const h = noise.noise(x * 0.05, z * 0.05) * 0.35 + noise.noise(x * 0.3, z * 0.3) * 0.05
  return h * (1 - s.plaza) - s.path * 0.05
}

const C = {
  grassA: new THREE.Color('#5aa426'),
  grassB: new THREE.Color('#98cc34'),
  grassC: new THREE.Color('#cfe06a'),
  dryA: new THREE.Color('#d9862e'),
  dryB: new THREE.Color('#eeb04a'),
  dirt: new THREE.Color('#a8744e'),
  dirtDark: new THREE.Color('#7e5838'),
  stone: new THREE.Color('#3d4a2a'),
}

export function grassColor(x, z, target = new THREE.Color()) {
  const n = noise.noise(x * 0.08, z * 0.08) * 0.5 + 0.5
  const m = noise.noise(x * 0.4 + 10, z * 0.4) * 0.5 + 0.5
  target.copy(C.grassA).lerp(C.grassB, n).lerp(C.grassC, m * m * 0.6)
  const s = surfaceAt(x, z)
  if (s.dry > 0) target.lerp(tmp.copy(C.dryA).lerp(C.dryB, m), s.dry)
  return target
}
const tmp = new THREE.Color()

export function createGround() {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 300, 300)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  const d = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, heightAt(x, z))
    const s = surfaceAt(x, z)
    grassColor(x, z, c).multiplyScalar(0.9)
    const grain = noise.noise(x * 1.7, z * 1.7) * 0.5 + 0.5
    d.copy(C.dirtDark).lerp(C.dirt, grain)
    c.lerp(d, s.path)
    c.lerp(C.stone, s.plaza)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  )
  mesh.receiveShadow = true
  mesh.name = 'ground'
  return mesh
}
