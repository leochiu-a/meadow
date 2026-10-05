import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { applyWind } from './wind.ts'
import { heightAt, noise, rand, range, pick } from './terrain.ts'
import { addCircle } from './collision.ts'

const dummy = new THREE.Object3D()
const color = new THREE.Color()

// Tuft of tapered blades fanning out from one root, about 20cm across, tips near y=1.
// Tips are pale and roots dark; normals point up so blades shade like the ground under them.
function tuftGeometry() {
  const segs = 2
  const blades = []
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + k * 0.7
    const lean = 0.05 + (k % 3) * 0.035
    const height = 0.75 + ((k * 37) % 5) * 0.07
    const pos = []
    const col = []
    const idx = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const w = 0.045 * (1 - t) ** 0.8
      const out = t * t * lean
      if (i < segs) {
        pos.push(-w, t * height, out, w, t * height, out)
        const v = 0.7 + 0.45 * t
        col.push(v, v, v, v, v, v)
      } else {
        pos.push(0, height, out)
        col.push(1.2, 1.2, 1.2)
      }
    }
    for (let i = 0; i < segs - 1; i++) {
      const j = i * 2
      idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2)
    }
    const last = (segs - 1) * 2
    idx.push(last, last + 1, last + 2)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    g.rotateY(a)
    g.translate(Math.cos(a) * 0.05, 0, -Math.sin(a) * 0.05)
    blades.push(g)
  }
  const g = mergeGeometries(blades)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill([0, 1, 0]).flat(), 3))
  return g
}

// Split instances into ground tiles, each its own InstancedMesh with a bounding sphere, so
// the renderer frustum-culls whole patches the camera can't see.
interface Instance {
  x: number
  z: number
  matrix: THREE.Matrix4
  color: THREE.Color
}

function tiledInstances(geometry: THREE.BufferGeometry, material: THREE.Material, entries: Instance[], tile = 16) {
  const buckets = new Map<string, Instance[]>()
  for (const e of entries) {
    const key = `${Math.floor(e.x / tile)},${Math.floor(e.z / tile)}`
    let list = buckets.get(key)
    if (!list) buckets.set(key, (list = []))
    list.push(e)
  }
  const group = new THREE.Group()
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length)
    list.forEach((e, i: number) => {
      mesh.setMatrixAt(i, e.matrix)
      mesh.setColorAt(i, e.color)
    })
    mesh.computeBoundingSphere()
    // Leave room for wind sway.
    mesh.boundingSphere!.radius += 0.5
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return group
}

/**
 * Grass tufts scattered over bounds [minX, maxX, minZ, maxZ]. The scene decides where grass
 * grows: place(x, z, color) returns the tuft height (0 to skip) and fills in its colour.
 * progress(fraction) is awaited along the way.
 */
// [minX, maxX, minZ, maxZ]
export type Area = [number, number, number, number]
export interface GrassOptions {
  bounds: Area
  target: number
  // The tuft height at (x, z), 0 to skip; fills in its colour.
  place(x: number, z: number, color: THREE.Color): number
  progress(fraction: number): Promise<void>
}

export async function createGrass({ bounds, target, place, progress }: GrassOptions) {
  const [minX, maxX, minZ, maxZ] = bounds
  const entries: Instance[] = []
  const step = Math.ceil(target / 5)
  for (let tries = 0; tries < target * 3 && entries.length < target; tries++) {
    // The lawn is most of a scene's build time, so it reports progress as it goes.
    if (tries % step === 0) await progress(Math.max(entries.length / target, tries / (target * 3)))
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    const tall = place(x, z, color)
    if (!tall) continue
    dummy.position.set(x, heightAt(x, z) - 0.02, z)
    dummy.rotation.set(range(-0.12, 0.12), rand() * Math.PI * 2, range(-0.12, 0.12))
    const wide = range(0.85, 1.4)
    dummy.scale.set(wide, tall, wide)
    dummy.updateMatrix()
    entries.push({ x, z, matrix: dummy.matrix.clone(), color: color.clone() })
  }
  await progress(1)
  return tiledInstances(
    tuftGeometry(),
    applyWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }), { strength: 0.22 }),
    entries,
  )
}

// Tall seed-head reeds that poke above the lawn near walls and on the dry field.
// [x, z, radius?] patches.
export type Patch = [x: number, z: number, r?: number]

export function createReeds(spots: Patch[]) {
  const stalk = new THREE.CylinderGeometry(0.006, 0.012, 1, 3).translate(0, 0.5, 0)
  const head = new THREE.CylinderGeometry(0.02, 0.012, 0.18, 4).translate(0, 1.02, 0)
  const geo = mergeGeometries([stalk, head])
  const total = spots.length * 22
  const mesh = new THREE.InstancedMesh(
    geo,
    applyWind(new THREE.MeshStandardMaterial({ color: '#e8d9a0', roughness: 0.9 }), { strength: 0.35, heightRef: 1.1 }),
    total,
  )
  let n = 0
  for (const [cx, cz, r = 0.7] of spots) {
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * r
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      dummy.position.set(x, heightAt(x, z), z)
      dummy.rotation.set(range(-0.2, 0.2), rand() * 6, range(-0.2, 0.2))
      const s = range(0.7, 1.4)
      dummy.scale.set(1, s, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(n, dummy.matrix)
      color.set(pick(['#e4ecc0', '#d2e0a0', '#f0f2d8', '#bcd486']))
      mesh.setColorAt(n++, color)
    }
  }
  mesh.count = n
  mesh.castShadow = true
  return mesh
}

/**
 * Small flowers over bounds [minX, maxX, minZ, maxZ]. place(x, z) returns null to skip, or
 * { color, big } where big marks a bloom in a colourful drift rather than a pale speck.
 */
export interface FlowerOptions {
  bounds: Area
  target: number
  place(x: number, z: number): { color: THREE.ColorRepresentation; big?: boolean } | null
}

export function createFlowers({ bounds, target, place }: FlowerOptions) {
  const [minX, maxX, minZ, maxZ] = bounds
  const head = new THREE.IcosahedronGeometry(0.04, 0).scale(1, 0.6, 1).translate(0, 0.34, 0)
  const stem = new THREE.CylinderGeometry(0.005, 0.005, 0.34, 3).translate(0, 0.17, 0)
  const geo = mergeGeometries([head, stem.toNonIndexed()])
  const entries: Instance[] = []
  for (let tries = 0; tries < target * 8 && entries.length < target; tries++) {
    const x = range(minX, maxX)
    const z = range(minZ, maxZ)
    const bloom = place(x, z)
    if (!bloom) continue
    dummy.position.set(x, heightAt(x, z), z)
    dummy.rotation.set(0, rand() * 6, 0)
    const sc = bloom.big ? range(0.9, 1.4) : range(0.6, 1)
    dummy.scale.set(sc, range(1.0, 1.5), sc)
    dummy.updateMatrix()
    color.set(bloom.color)
    entries.push({ x, z, matrix: dummy.matrix.clone(), color: color.clone() })
  }
  return tiledInstances(geo, applyWind(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { strength: 0.18, heightRef: 0.35 }), entries)
}

// Lupine spikes: a dense tapering column of florets over a stem with palmate leaves.
// Florets and greenery are two instanced meshes sharing the same transforms.
export function createLupines(spots: Patch[]) {
  const florets = []
  for (let i = 0; i < 14; i++) {
    const t = i / 13
    const r = 0.06 * (1 - t * 0.75)
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + i * 0.8
      florets.push(new THREE.IcosahedronGeometry(r * 0.75, 0).translate(Math.cos(a) * r, 0.4 + t * 0.48, Math.sin(a) * r))
    }
  }
  const spikeGeo = mergeGeometries(florets)
  const green: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.009, 0.013, 0.5, 4).translate(0, 0.25, 0)]
  for (let k = 0; k < 7; k++) {
    green.push(new THREE.CircleGeometry(0.035, 5).scale(1, 3, 1).translate(0, 0.1, 0).rotateX(-1.1).rotateY((k / 7) * Math.PI * 2).translate(0, 0.08, 0))
  }
  const greenGeo = mergeGeometries(green.map((g) => (g.index ? g.toNonIndexed() : g)))
  const total = spots.length * 9
  const spikes = new THREE.InstancedMesh(
    spikeGeo,
    applyWind(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { strength: 0.2, heightRef: 0.9 }),
    total,
  )
  const leaves = new THREE.InstancedMesh(
    greenGeo,
    applyWind(new THREE.MeshStandardMaterial({ color: '#3f7f2c', side: THREE.DoubleSide, roughness: 0.8 }), { strength: 0.2, heightRef: 0.9 }),
    total,
  )
  const hues = ['#9a5cff', '#b06cf0', '#c77ae8', '#8a62f5', '#e08ad8']
  let n = 0
  for (const [cx, cz, r = 0.5] of spots) {
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * r
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      dummy.position.set(x, heightAt(x, z), z)
      dummy.rotation.set(range(-0.15, 0.15), rand() * 6, range(-0.15, 0.15))
      const sc = range(0.75, 1.25)
      dummy.scale.set(sc, sc * range(0.85, 1.2), sc)
      dummy.updateMatrix()
      spikes.setMatrixAt(n, dummy.matrix)
      leaves.setMatrixAt(n, dummy.matrix)
      color.set(pick(hues))
      spikes.setColorAt(n++, color)
    }
  }
  const g = new THREE.Group()
  for (const m of [spikes, leaves]) {
    m.count = n
    m.castShadow = true
    g.add(m)
  }
  return g
}

// Ivy draped over a surface: broad round leaves scattered on a few hanging strands.
export interface IvyStrand {
  from: [number, number, number]
  to: [number, number, number]
  leaves: number
  spread?: number
}

export function createIvy(strands: IvyStrand[]) {
  const leaf = new THREE.CircleGeometry(0.09, 6).scale(1, 1.2, 1)
  const total = strands.reduce((a, s) => a + s.leaves, 0)
  const mesh = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), total)
  const c = new THREE.Color()
  let n = 0
  for (const { from, to, leaves, spread = 0.18 } of strands) {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    for (let i = 0; i < leaves; i++) {
      const t = rand()
      dummy.position.lerpVectors(a, b, t).add(new THREE.Vector3(range(-spread, spread), range(-0.05, 0.05), range(-spread, spread)))
      dummy.rotation.set(rand() * 6, rand() * 6, rand() * 6)
      const sc = range(0.7, 1.4)
      dummy.scale.set(sc, sc, sc)
      dummy.updateMatrix()
      mesh.setMatrixAt(n, dummy.matrix)
      c.set(pick(['#2f6b25', '#3d8030', '#4f9436', '#285c20'])).offsetHSL(0, 0, range(-0.04, 0.04))
      mesh.setColorAt(n++, c)
    }
  }
  mesh.count = n
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// Lumpy foliage blob: displaced sphere with darker undersides baked into vertex colors.
function blobGeometry(radius: number, seed: number, detail = 3) {
  // Weld the icosahedron so displaced vertices stay shared and normals come out smooth.
  const raw = new THREE.IcosahedronGeometry(radius, detail)
  raw.deleteAttribute('normal')
  raw.deleteAttribute('uv')
  const g = mergeVertices(raw)
  const p = g.attributes.position
  const cols = new Float32Array(p.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = v.clone().normalize()
    const bump =
      noise.noise3d(n.x * 2.2 + seed, n.y * 2.2, n.z * 2.2) * 0.16 +
      noise.noise3d(n.x * 6 + seed, n.y * 6, n.z * 6) * 0.07
    v.multiplyScalar(1 + bump)
    v.y *= 0.85
    p.setXYZ(i, v.x, v.y, v.z)
    const shade = 0.55 + 0.45 * THREE.MathUtils.smoothstep(n.y, -0.8, 0.9) + bump * 0.8
    cols.set([shade, shade, shade], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
  g.computeVertexNormals()
  return g
}

// A twig of five small leaves fanned out from one stem: the unit every canopy is built from.
const twigGeo = (() => {
  const leaves = []
  for (let i = 0; i < 5; i++) {
    const len = 0.13 + (i % 2) * 0.03
    const w = len * 0.42
    const leaf = new THREE.BufferGeometry()
    leaf.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, w, len * 0.45, 0.01, 0, len, 0, -w, len * 0.45, 0.01], 3),
    )
    leaf.setIndex([0, 1, 2, 0, 2, 3])
    leaf.rotateX(-0.5 - (i % 3) * 0.15)
    leaf.rotateZ((i - 2) * 0.55)
    leaf.translate(0, 0.04 * i, 0)
    leaves.push(leaf)
  }
  const g = mergeGeometries(leaves)
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3))
  return g
})()

// Leaves are lit with a per-twig normal pointing out of the canopy, so the crown shades like
// one soft volume while the leaf cards still break up its silhouette.
function leafMaterial() {
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLeafN;')
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize( normalMatrix * aLeafN );')
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal = normalize( vNormal );',
    )
  }
  m.customProgramCacheKey = () => 'leaf'
  return m
}
const LEAF_MAT = leafMaterial()
const CORE_MAT = new THREE.MeshStandardMaterial({ color: '#1f4d1c', vertexColors: true, roughness: 1 })

const LEAF_DEEP = new THREE.Color('#2a5f22')
const LEAF_MID = new THREE.Color('#4b9530')
const LEAF_TOP = new THREE.Color('#98c847')

// Canopy from a few ellipsoid masses: a dark core fills the gaps, and leaf twigs scatter
// mostly near the surface, lighter where the sun hits and deeper inside.
interface Mass {
  x: number
  y: number
  z: number
  r: number
  sy?: number
}

function canopy(masses: Mass[], twigs: number, twigSize: number, tint = 0) {
  const core = new THREE.Group()
  for (const m of masses) {
    const blob = new THREE.Mesh(blobGeometry(m.r * 0.72, rand() * 50, 2), CORE_MAT)
    blob.position.set(m.x, m.y, m.z)
    blob.scale.y = m.sy ?? 1
    blob.castShadow = true
    blob.receiveShadow = true
    core.add(blob)
  }
  const geo = twigGeo.clone()
  const mesh = new THREE.InstancedMesh(geo, LEAF_MAT, twigs)
  const normals = new Float32Array(twigs * 3)
  const total = masses.reduce((a, m) => a + m.r * m.r, 0)
  const dir = new THREE.Vector3()
  const sunDir = new THREE.Vector3(-0.5, 0.75, -0.4).normalize()
  const c = new THREE.Color()
  let top = -Infinity
  let bottom = Infinity
  for (const m of masses) {
    top = Math.max(top, m.y + m.r * (m.sy ?? 1))
    bottom = Math.min(bottom, m.y - m.r * (m.sy ?? 1))
  }
  for (let i = 0; i < twigs; i++) {
    let pickR = rand() * total
    let m = masses[0]
    for (const mm of masses) {
      pickR -= mm.r * mm.r
      if (pickR <= 0) {
        m = mm
        break
      }
    }
    dir.set(range(-1, 1), range(-0.7, 1), range(-1, 1)).normalize()
    const depth = rand() ** 0.35
    const d = m.r * (0.55 + 0.5 * depth)
    dummy.position.set(m.x + dir.x * d, m.y + dir.y * d * (m.sy ?? 1), m.z + dir.z * d)
    // Twigs point outward and a little upward, with plenty of jitter.
    dummy.lookAt(dummy.position.x + dir.x, dummy.position.y + dir.y + 0.6, dummy.position.z + dir.z)
    dummy.rotateX(Math.PI / 2 + range(-0.5, 0.5))
    dummy.rotateY(rand() * 6.28)
    const sc = twigSize * range(0.75, 1.3)
    dummy.scale.set(sc, sc, sc)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    const n = dir.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.45, 0)).normalize()
    normals.set([n.x, n.y, n.z], i * 3)
    const h = (dummy.position.y - bottom) / (top - bottom)
    const sunny = Math.max(0, dir.dot(sunDir))
    c.copy(LEAF_DEEP).lerp(LEAF_MID, Math.min(1, depth * 0.6 + h * 0.6)).lerp(LEAF_TOP, sunny * depth * (0.3 + h * 0.7))
    c.offsetHSL(tint + range(-0.015, 0.015), range(-0.05, 0.05), range(-0.05, 0.05))
    mesh.setColorAt(i, c)
  }
  geo.setAttribute('aLeafN', new THREE.InstancedBufferAttribute(normals, 3))
  mesh.castShadow = true
  mesh.receiveShadow = true
  core.add(mesh)
  return core
}

// Slim trunk that forks into a few branches reaching up into the crown.
function trunk(height: number, radius: number, color: THREE.ColorRepresentation, branches: { len: number; y: number; tilt: number; dir: number }[]) {

  const g = new THREE.Group()
  const bark = new THREE.MeshStandardMaterial({ color, roughness: 1 })
  const main = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius, height, 6).translate(0, height / 2, 0), bark)
  main.castShadow = true
  g.add(main)
  for (const b of branches) {
    const len = b.len
    const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.25, radius * 0.5, len, 5).translate(0, len / 2, 0), bark)
    limb.position.y = b.y
    limb.rotation.set(b.tilt, b.dir, 0, 'YXZ')
    limb.castShadow = true
    g.add(limb)
  }
  return g
}

export function createTree(x: number, z: number, size = 1) {
  const tree = new THREE.Group()
  const trunkH = 2.2 * size
  const masses = []
  const branches = []
  const n = 5 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand()
    const spread = i === 0 ? 0 : range(0.4, 0.8) * size
    const y = trunkH + (i === 0 ? 1.2 : range(0.2, 1.5)) * size
    masses.push({ x: Math.cos(a) * spread, y, z: Math.sin(a) * spread, r: range(0.6, 0.85) * size, sy: 1.1 })
    if (i > 0 && i < 4) branches.push({ y: trunkH * 0.75, len: (y - trunkH * 0.75) * 1.1, tilt: Math.atan2(spread, y - trunkH * 0.75), dir: -a + Math.PI / 2 })
  }
  tree.add(trunk(trunkH + 0.5 * size, 0.13 * size, '#8a7c6e', branches))
  tree.add(canopy(masses, Math.round(2300 * size * size), 0.8 * size, range(-0.02, 0.02)))
  tree.position.set(x, heightAt(x, z), z)
  tree.rotation.y = rand() * 6
  addCircle(x, z, 0.3 * size)
  return tree
}

// Thin young tree like the sapling in the middle of the meadow.
export function createSapling(x: number, z: number) {
  const g = new THREE.Group()
  g.add(trunk(2.3, 0.05, '#d4ccbe', [{ y: 1.6, len: 0.6, tilt: 0.5, dir: 0.8 }, { y: 1.8, len: 0.5, tilt: -0.45, dir: 2.2 }]))
  const masses = [
    { x: 0, y: 2.35, z: 0, r: 0.5, sy: 1.2 },
    { x: 0.3, y: 2.0, z: 0.1, r: 0.36 },
    { x: -0.25, y: 2.05, z: -0.2, r: 0.38 },
  ]
  g.add(canopy(masses, 560, 0.55))
  g.position.set(x, heightAt(x, z), z)
  addCircle(x, z, 0.12)
  return g
}

export function createBush(x: number, z: number, size = 1, collide = true) {
  const g = new THREE.Group()
  const count = 2 + Math.floor(rand() * 3)
  const masses = []
  for (let i = 0; i < count; i++) {
    const r = range(0.45, 0.7) * size
    masses.push({ x: range(-0.5, 0.5) * size, y: r * 0.75, z: range(-0.5, 0.5) * size, r, sy: 0.85 })
  }
  g.add(canopy(masses, Math.round(800 * size * size), 0.7 * size, range(-0.03, 0.01)))
  g.position.set(x, heightAt(x, z), z)
  if (collide) addCircle(x, z, 0.55 * size)
  return g
}
