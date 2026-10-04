import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { rand, range, pick, noise } from './terrain.js'
import { addSegment, addCircle } from './collision.js'
import { weathered } from './weathering.js'
import { withCutaway } from './cutaway.js'
import { createIvy } from './vegetation.js'

// Taipei shophouse blocks: a ground-floor arcade (騎樓) under the overhanging upper floors,
// rows of windows behind iron grilles with air-conditioners hung under them, rooftop water
// tanks and tin add-ons, and Ximending's forest of signboards jutting into the street.

export const GROUND_FLOOR = 4.2
export const FLOOR = 3.2
export const ARCADE = 3

const materials = new Map()
// Shared, weathered, cut-away materials keyed by colour and kind.
export function cityMat(color, { kind = 'concrete', grime = 1, fade = 0.2, ...extra } = {}) {
  const key = `${color}-${kind}-${grime}-${fade}-${JSON.stringify(extra)}`
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra })
    materials.set(key, withCutaway(extra.emissive ? m : weathered(m, { kind, grime, fade })))
  }
  return materials.get(key)
}

// Every repeated facade part across the whole district goes into one InstancedMesh per kind.
const PART_GEOMETRY = {
  pane: new THREE.PlaneGeometry(1, 1),
  frame: (() => {
    const bars = [
      new THREE.BoxGeometry(1, 0.06, 0.08).translate(0, 0.5, 0),
      new THREE.BoxGeometry(1, 0.06, 0.08).translate(0, -0.5, 0),
      new THREE.BoxGeometry(0.06, 1, 0.08).translate(0.5, 0, 0),
      new THREE.BoxGeometry(0.06, 1, 0.08).translate(-0.5, 0, 0),
      new THREE.BoxGeometry(0.04, 1, 0.06),
    ]
    return mergeGeometries(bars)
  })(),
  // Iron window cage (鐵窗): a box frame of bars standing proud of the wall.
  grille: (() => {
    const bars = []
    for (let i = 0; i <= 8; i++) bars.push(new THREE.BoxGeometry(0.025, 1, 0.025).translate(-0.5 + i / 8, 0, 0.35))
    for (const y of [-0.5, 0, 0.5]) bars.push(new THREE.BoxGeometry(1, 0.03, 0.03).translate(0, y, 0.35))
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) bars.push(new THREE.BoxGeometry(0.03, 0.03, 0.35).translate(x, y, 0.175))
    bars.push(new THREE.BoxGeometry(1.04, 0.04, 0.38).translate(0, 0.52, 0.19))
    return mergeGeometries(bars)
  })(),
  ac: (() => {
    const box = new RoundedBoxGeometry(0.8, 0.55, 0.3, 1, 0.03).translate(0, 0, 0.15)
    const fan = new THREE.CylinderGeometry(0.19, 0.19, 0.02, 12).rotateX(Math.PI / 2).translate(0.15, 0, 0.31)
    return mergeGeometries([box.toNonIndexed(), fan.toNonIndexed()])
  })(),
  // Broken concrete lump: a dodecahedron with its corners knocked about, flat-shaded.
  chunk: (() => {
    const g = mergeVertices(new THREE.DodecahedronGeometry(0.5, 0).deleteAttribute('normal').deleteAttribute('uv'))
    const pos = g.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * range(0.7, 1.25), pos.getY(i) * range(0.55, 1.1), pos.getZ(i) * range(0.7, 1.25))
    const flat = g.toNonIndexed()
    flat.computeVertexNormals()
    return flat
  })(),
  // Reinforcing bar with a kink near its tip, base at the origin.
  rebar: mergeGeometries([
    new THREE.CylinderGeometry(0.014, 0.014, 0.8, 4).translate(0, 0.4, 0).toNonIndexed(),
    new THREE.CylinderGeometry(0.014, 0.014, 0.35, 4).translate(0, 0.175, 0).rotateZ(0.7).translate(0, 0.8, 0).toNonIndexed(),
  ]),
  // Rolling steel shutter: a ribbed panel with the drum housing on top.
  shutter: (() => {
    const ribs = []
    for (let i = 0; i < 12; i++) ribs.push(new THREE.BoxGeometry(1, 1 / 12 - 0.01, 0.04).translate(0, -0.5 + (i + 0.5) / 12, (i % 2) * 0.01))
    return mergeGeometries(ribs)
  })(),
}
const parts = Object.fromEntries(Object.keys(PART_GEOMETRY).map((k) => [k, []]))
const tmpColor = new THREE.Color()

const partPos = new THREE.Vector3()
const partQuat = new THREE.Quaternion()
const partScale = new THREE.Vector3()

// Every part arrives in world space. Concrete chunks big enough to trip over become
// obstacles, so the robot steers round rubble rather than driving through it.
function part(kind, matrix, color) {
  parts[kind].push({ matrix, color: tmpColor.set(color).clone() })
  if (kind !== 'chunk') return
  matrix.decompose(partPos, partQuat, partScale)
  const size = (partScale.x + partScale.z) / 2
  if (size > 0.35 && partPos.y + partScale.y * 0.4 > 0.12) addCircle(partPos.x, partPos.z, size * 0.45)
}

export function flushCityParts() {
  const mats = {
    pane: cityMat('#ffffff', { kind: 'paint', grime: 0.3, fade: 0, roughness: 0.25, metalness: 0.2 }),
    frame: cityMat('#ffffff', { kind: 'metal' }),
    grille: cityMat('#ffffff', { kind: 'metal' }),
    ac: cityMat('#ffffff', { kind: 'paint' }),
    shutter: cityMat('#ffffff', { kind: 'metal' }),
    chunk: cityMat('#ffffff', { kind: 'concrete' }),
    rebar: cityMat('#ffffff', { kind: 'metal' }),
  }
  // One InstancedMesh per kind per 40 m cell, so whole cells can be culled.
  const g = new THREE.Group()
  const at = new THREE.Vector3()
  for (const [kind, list] of Object.entries(parts)) {
    const cells = new Map()
    for (const p of list) {
      at.setFromMatrixPosition(p.matrix)
      const key = `${Math.floor(at.x / 40)},${Math.floor(at.z / 40)}`
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push(p)
    }
    for (const cell of cells.values()) {
      const mesh = new THREE.InstancedMesh(PART_GEOMETRY[kind], mats[kind], cell.length)
      cell.forEach((p, i) => {
        mesh.setMatrixAt(i, p.matrix)
        mesh.setColorAt(i, p.color)
      })
      mesh.castShadow = kind !== 'pane'
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      g.add(mesh)
    }
    list.length = 0
  }
  return g
}

// ---------------------------------------------------------------- signboards

const SHOP_NAMES = [
  '旅社', '電影', '茶飲', '服飾', '飯店', '當舖', '眼鏡', '刺青', '拉麵', '鞋店', '藥局', '牛排',
  '卡拉OK', '遊藝場', '唱片行', '麻辣鍋', '剉冰', '照相', '理容', '皮件', '手機', '鐘錶', '小吃', '冰果室',
]
const SIGN_COLORS = [
  ['#c8302c', '#f6e7c8'], ['#1f4f9a', '#f2f2ec'], ['#f0c430', '#2a2420'], ['#2e7d4f', '#f4f1e6'],
  ['#f2efe6', '#c8302c'], ['#7a2f8f', '#f8e8ff'], ['#e86a2a', '#fff6e0'], ['#20232a', '#f4c64a'],
]
const signTextures = []

// Vertical sign face: bold characters stacked top to bottom on a faded panel.
function signTexture(text, [bg, fg]) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 128, 512)
  ctx.strokeStyle = fg
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, 112, 496)
  // Latin letters stay together as one glyph at the bottom (卡拉OK).
  const glyphs = text.includes('OK') ? [...text.replace('OK', ''), 'OK'] : [...text]
  const step = Math.min(110, 470 / glyphs.length)
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  glyphs.forEach((ch, i) => {
    ctx.font = `900 ${ch === 'OK' ? step * 0.55 : step * 0.82}px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif`
    ctx.fillText(ch, 64, 256 - (glyphs.length * step) / 2 + step * (i + 0.5))
  })
  // Sun fade and grime.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${pick(['255,255,255', '40,30,20'])},${range(0.03, 0.12)})`
    ctx.beginPath()
    ctx.ellipse(range(0, 128), range(0, 512), range(10, 60), range(10, 90), 0, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function signMaterial() {
  if (signTextures.length < 18) {
    const tex = signTexture(pick(SHOP_NAMES), pick(SIGN_COLORS))
    signTextures.push(withCutaway(weathered(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), { kind: 'paint', grime: 0.8, fade: 0.25 })))
  }
  return pick(signTextures)
}

/**
 * Vertical blade sign sticking out from a facade at (x, y) in the building's local frame.
 * tilt hangs it askew when a bracket has given way.
 */
function bladeSign(g, x, y, height, tilt = 0) {
  const face = signMaterial()
  const edge = cityMat(pick(['#d9d4c8', '#3a3c40', '#b8302a']), { kind: 'paint' })
  // Box faces: +x, -x carry the lettering; the rest is the sign's metal edge.
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, 1.1), [face, face, edge, edge, edge, edge])
  sign.position.set(x, y + height / 2, 0.75)
  sign.rotation.z = tilt
  g.add(sign)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), cityMat('#2d2f33', { kind: 'metal' }))
  arm.position.set(x, y + height * 0.85, 0.2)
  g.add(arm)
}

// ---------------------------------------------------------------- ruins

const CONCRETE = ['#8f8b84', '#9d988e', '#7c7871', '#a8a297', '#6f6b65']

/**
 * Heap of broken concrete around local (x, z): chunks pile highest in the middle and get
 * smaller toward the edges, with rebar poking out. Pushes instanced parts into `local`.
 */
function rubble(local, x, z, { radius, height, count, tint = null }) {
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(rand())
    const a = rand() * Math.PI * 2
    const fall = 1 - r / radius
    const size = range(0.25, 0.6) + fall * range(0.2, 0.9)
    const pos = new THREE.Vector3(x + Math.cos(a) * r, height * fall ** 1.3 * range(0.6, 1) - size * 0.2, z + Math.sin(a) * r)
    q.setFromEuler(e.set(rand() * 6, rand() * 6, rand() * 6))
    const scale = new THREE.Vector3(size * range(0.8, 1.8), size * range(0.5, 1), size * range(0.8, 1.6))
    const color = tint && rand() < 0.35 ? tint : rand() < 0.08 ? pick(['#8c4b3c', '#a05a44']) : pick(CONCRETE)
    local.push(['chunk', new THREE.Matrix4().compose(pos, q.clone(), scale), color])
  }
  for (let i = 0; i < count / 7; i++) {
    const r = radius * 0.7 * Math.sqrt(rand())
    const a = rand() * Math.PI * 2
    const pos = new THREE.Vector3(x + Math.cos(a) * r, height * (1 - r / radius) * 0.8, z + Math.sin(a) * r)
    q.setFromEuler(e.set(range(-1, 1), rand() * 6, range(-1, 1)))
    local.push(['rebar', new THREE.Matrix4().compose(pos, q.clone(), new THREE.Vector3(1, range(0.8, 2), 1)), pick(['#5a3a26', '#6b4228', '#4a3020'])])
  }
}

/**
 * Wall slab w wide whose top edge has broken away: about `broken` (0..1) of its height `h`
 * gone, the break stepped along floor lines with a ragged profile. Rectangular `holes` that still
 * sit below the break become empty window openings. Faces +z, base at y = 0, 0.3 thick.
 */
function jaggedWall(w, h, broken, holes = []) {
  const steps = Math.max(4, Math.round(w / 0.45))
  const top = []
  const seed = rand() * 100
  // Concrete breaks along its floors: a break level, then runs of 1-3 m stepped up or down
  // a storey or so from it, with ragged chips along each run.
  const level = Math.max(1.2, h * (1 - broken * range(0.4, 1)))
  let runEnd = -1
  let runY = level
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = -w / 2 + t * w
    if (x > runEnd) {
      runEnd = x + range(1, 3)
      runY = Math.min(h, Math.max(0.8, level + Math.round(range(-1.4, 1)) * FLOOR * range(0.5, 1)))
    }
    const chip = (noise.noise(t * 6 + seed, seed) * 0.5 + 0.5) * 0.45 + (rand() < 0.1 ? range(0.3, 0.9) : 0)
    top.push([x, Math.max(0.6, runY - (i > 0 && i < steps ? chip : 0))])
  }
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(w / 2, 0)
  for (let i = top.length - 1; i >= 0; i--) shape.lineTo(...top[i])
  shape.closePath()
  const below = (x) => {
    const t = (x + w / 2) / w
    const i = Math.min(steps - 1, Math.floor(t * steps))
    return Math.min(top[i][1], top[i + 1][1])
  }
  for (const hole of holes) {
    if (hole.y + hole.h > Math.min(below(hole.x - hole.w / 2), below(hole.x + hole.w / 2)) - 0.35) continue
    const path = new THREE.Path()
    path.moveTo(hole.x - hole.w / 2, hole.y)
    path.lineTo(hole.x + hole.w / 2, hole.y)
    path.lineTo(hole.x + hole.w / 2, hole.y + hole.h)
    path.lineTo(hole.x - hole.w / 2, hole.y + hole.h)
    path.closePath()
    shape.holes.push(path)
  }
  return new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }).translate(0, 0, -0.3)
}

// ---------------------------------------------------------------- buildings

const CLADDING = ['#d6cdbd', '#c9bba6', '#bfb7ad', '#cdb7a4', '#a9aaa4', '#d8d2c4', '#b9a58f', '#c4c9c4']

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)

const windowBays = (w) => Math.max(1, Math.floor(w / 2.3))

// Ground floor: recessed shopfront with a shutter, the fascia sign, and the arcade columns
// along the street edge (some snapped off in a ruin). Returns column x positions kept.
function arcade(g, local, { w, d, clad, plain, ruined }) {
  const shop = box(w, GROUND_FLOOR, d - ARCADE, plain)
  shop.position.set(0, GROUND_FLOOR / 2, -ARCADE - (d - ARCADE) / 2)
  g.add(shop)
  const cols = Math.max(2, Math.round(w / 4) + 1)
  const kept = []
  for (let i = 0; i < cols; i++) {
    const cx = -w / 2 + 0.3 + (i / (cols - 1)) * (w - 0.6)
    const h = ruined && rand() < 0.4 ? range(0.8, GROUND_FLOOR * 0.7) : GROUND_FLOOR
    const col = box(0.6, h, 0.6, clad)
    col.position.set(cx, h / 2, -0.3)
    g.add(col)
    kept.push(cx)
  }
  const darkShop = cityMat('#141210', { kind: 'paint', grime: 0.2 })
  const opening = box(w - 1.2, GROUND_FLOOR - 0.9, 0.05, darkShop)
  opening.position.set(0, (GROUND_FLOOR - 0.9) / 2, -ARCADE + 0.03)
  g.add(opening)
  // Shutters, some rolled part way up over the black interior.
  const shutterH = (GROUND_FLOOR - 0.9) * pick([1, 1, 0.75, 0.45, 0.2])
  local.push(['shutter', new THREE.Matrix4().compose(new THREE.Vector3(0, GROUND_FLOOR - 0.9 - shutterH / 2, -ARCADE + 0.08), new THREE.Quaternion(), new THREE.Vector3(w - 1.2, shutterH, 1)), pick(['#8f8a80', '#7d8288', '#a39d90', '#6e6a62'])])
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.9, 0.12), [plain, plain, plain, plain, signMaterial(), plain])
  fascia.position.set(0, GROUND_FLOOR - 0.55, 0.08)
  if (ruined && rand() < 0.5) {
    // Dropped at one end, hanging off its last bracket.
    fascia.position.y -= 0.6
    fascia.rotation.z = range(0.2, 0.4) * (rand() < 0.5 ? -1 : 1)
  }
  g.add(fascia)
  return kept
}

// Intact upper floors: banded facade, caged windows with AC units, roof tank and tin shack.
function upperFloors(g, local, { w, d, floors, clad, plain, signs }) {
  const upper = floors * FLOOR
  const body = box(w, upper, d, clad)
  body.position.set(0, GROUND_FLOOR + upper / 2, -d / 2)
  g.add(body)
  for (let f = 1; f < floors; f++) {
    const band = box(w + 0.04, 0.18, 0.06, plain)
    band.position.set(0, GROUND_FLOOR + f * FLOOR, 0.02)
    g.add(band)
  }
  const parapet = box(w, 0.9, 0.18, clad)
  parapet.position.set(0, GROUND_FLOOR + upper + 0.45, -0.09)
  g.add(parapet)
  const bays = windowBays(w)
  for (let f = 0; f < floors; f++) {
    const y = GROUND_FLOOR + f * FLOOR + 1.65
    for (let b = 0; b < bays; b++) {
      const wx = -w / 2 + (b + 0.5) * (w / bays)
      const ww = Math.min(1.8, (w / bays) * 0.7)
      const wh = 1.4
      local.push(['pane', new THREE.Matrix4().compose(new THREE.Vector3(wx, y, 0.01), new THREE.Quaternion(), new THREE.Vector3(ww, wh, 1)), pick(['#1c2228', '#232a30', '#2e3a40', '#151719', '#3d4a52'])])
      local.push(['frame', new THREE.Matrix4().compose(new THREE.Vector3(wx, y, 0.02), new THREE.Quaternion(), new THREE.Vector3(ww, wh, 1)), pick(['#b9bcbd', '#8a8e90', '#d8d4c8'])])
      if (rand() < 0.55) local.push(['grille', new THREE.Matrix4().compose(new THREE.Vector3(wx, y, 0.02), new THREE.Quaternion(), new THREE.Vector3(ww + 0.12, wh + 0.12, 1)), pick(['#3b3d40', '#5a4b3c', '#2e3a38', '#6b5a48'])])
      if (rand() < 0.35) local.push(['ac', new THREE.Matrix4().compose(new THREE.Vector3(wx + range(-0.3, 0.3), y - 1.05, 0.02), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)), pick(['#d8d6cf', '#c9c4b8', '#b8b4aa'])])
    }
  }
  for (let i = 0; i < signs; i++) {
    const sx = (i % 2 ? 1 : -1) * (w / 2 - range(0.6, 1.2))
    const h = Math.min(upper - 0.6, range(3, 7))
    bladeSign(g, sx, GROUND_FLOOR + range(0.2, 1), h, rand() < 0.15 ? range(-0.25, 0.25) : 0)
  }
  const roofY = GROUND_FLOOR + upper
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14), cityMat(pick(['#9ea4a8', '#3f6fa0', '#c8c2b0']), { kind: pick(['metal', 'paint']) }))
  tank.position.set(range(-w / 2 + 1, w / 2 - 1), roofY + 1.3, -d * range(0.3, 0.7))
  g.add(tank)
  if (rand() < 0.5) {
    const tw = Math.min(w - 1, range(3, 6))
    const tin = box(tw, 2.4, d * 0.4, cityMat(pick(['#8a8f8c', '#6f7d7a', '#a07a58', '#5f6a74']), { kind: 'metal' }))
    tin.position.set(range(-(w - tw) / 2, (w - tw) / 2), roofY + 1.2, -d * 0.7)
    g.add(tin)
  }
}

// Window openings for a broken facade, in the wall's own coordinates (base at y = 0).
function facadeHoles(w, floors, base) {
  const bays = windowBays(w)
  const holes = []
  for (let f = 0; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      holes.push({ x: -w / 2 + (b + 0.5) * (w / bays), y: base + f * FLOOR + 0.95, w: Math.min(1.8, (w / bays) * 0.7), h: 1.4 })
    }
  }
  return holes
}

// Gutted shell: facade and side walls standing with ragged tops and empty window holes,
// interior floors gone or hanging off their last supports, rubble heaped inside.
function shell(g, local, { w, d, floors, clad }) {
  const h = floors * FLOOR + 0.9
  const front = new THREE.Mesh(jaggedWall(w, h, range(0.3, 0.7), facadeHoles(w, floors, 0)), clad)
  front.position.y = GROUND_FLOOR
  g.add(front)
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(jaggedWall(d, h * range(0.6, 1), range(0.4, 0.9)), clad)
    wall.position.set(side * (w / 2 - 0.15), GROUND_FLOOR, -d / 2)
    wall.rotation.y = side * Math.PI / 2
    g.add(wall)
  }
  const slabMat = cityMat(pick(CONCRETE))
  for (let f = 1; f < floors; f++) {
    if (rand() < 0.35) continue
    const depth = d * range(0.3, 0.8)
    const slab = box(w - 0.5, 0.25, depth, slabMat)
    // Snapped at the back: the slab hinges down from the facade.
    slab.geometry.translate(0, 0, -depth / 2)
    slab.position.set(0, GROUND_FLOOR + f * FLOOR, -0.3)
    slab.rotation.x = rand() < 0.5 ? range(0.15, 0.55) : 0
    g.add(slab)
  }
  rubble(local, 0, -d * 0.55, { radius: Math.min(w, d) * 0.45, height: 2.2, count: Math.round(w * 4) })
}

// Pancake collapse: a stub of the first floor above the arcade, the upper slabs fallen in a
// tilted stack, and a heap of debris spilling forward into the street.
function collapsed(g, local, { w, d, clad }) {
  const stubH = FLOOR * range(0.4, 1.3)
  const front = new THREE.Mesh(jaggedWall(w, stubH, range(0.2, 0.8), facadeHoles(w, 1, 0)), clad)
  front.position.y = GROUND_FLOOR
  g.add(front)
  const slabMat = cityMat(pick(CONCRETE))
  const slabs = Math.floor(range(2, 5))
  for (let i = 0; i < slabs; i++) {
    const slab = box(w * range(0.75, 1.02), 0.3, d * range(0.45, 0.85), slabMat)
    slab.position.set(range(-0.6, 0.6), GROUND_FLOOR * 0.45 + i * range(0.6, 1.1), -d * range(0.45, 0.6))
    slab.rotation.set(range(-0.4, 0.35), range(-0.15, 0.15), range(-0.3, 0.3))
    g.add(slab)
  }
  rubble(local, 0, -d * 0.45, { radius: Math.max(w, d) * 0.55, height: 3.2, count: Math.round(w * 9), tint: clad.color.getStyle() })
  // Debris fans out across the pavement in front.
  rubble(local, range(-1, 1), 1.8, { radius: w * 0.5, height: 1.3, count: Math.round(w * 5) })
}

/**
 * Shophouse whose street facade faces local +z, centred on (x, z) at the facade line and
 * rotated rotY. Upper floors sit over a walk-through arcade.
 * ruin: 'none' | 'shell' (gutted) | 'collapsed' (pancaked with a debris spill) |
 * 'lean' (intact but listing on a failed footing).
 */
export function shophouse({ x, z, w, d, floors, rotY = 0, signs = 1, ruin = 'none' }) {
  const g = new THREE.Group()
  const clad = cityMat(pick(CLADDING))
  const plain = cityMat(pick(['#8e8a82', '#9a958b', '#7f7b74']))
  const local = []
  const ruined = ruin === 'shell' || ruin === 'collapsed'
  const cols = arcade(g, local, { w, d, clad, plain, ruined })
  if (ruin === 'shell') shell(g, local, { w, d, floors, clad })
  else if (ruin === 'collapsed') collapsed(g, local, { w, d, clad })
  else upperFloors(g, local, { w, d, floors, clad, plain, signs })
  // Creepers hanging down the face from the roof line.
  if (ruin !== 'collapsed' && rand() < 0.45) {
    const top = GROUND_FLOOR + floors * FLOOR * (ruin === 'shell' ? 0.6 : 1)
    const strands = []
    for (let i = 0; i < Math.round(w / 1.4); i++) {
      const vx = range(-w / 2 + 0.3, w / 2 - 0.3)
      strands.push({ from: [vx, top, 0.12], to: [vx + range(-0.3, 0.3), top - range(2, top * 0.8), 0.1], leaves: Math.round(range(40, 110)), spread: 0.28 })
    }
    g.add(createIvy(strands))
  }
  if (ruined && rand() < 0.7) {
    // A signboard torn off and lying in the street.
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.3, range(2.5, 5), 1.1), [signMaterial(), signMaterial(), plain, plain, plain, plain])
    sign.position.set(range(-w / 3, w / 3), 0.5, range(2, 4))
    sign.rotation.set(Math.PI / 2 + range(-0.15, 0.15), range(-0.8, 0.8), Math.PI / 2, 'YXZ')
    g.add(sign)
  }

  g.position.set(x, 0, z)
  if (ruin === 'lean') {
    // Listing sideways on a failed footing, sunk on the low side.
    const lean = range(0.06, 0.12) * (rand() < 0.5 ? -1 : 1)
    g.rotation.set(0, rotY, lean, 'YZX')
    g.position.y = -Math.abs(lean) * w * 0.35
  } else {
    g.rotation.y = rotY
  }
  g.updateMatrixWorld(true)
  for (const [kind, m, color] of local) part(kind, m.clone().premultiply(g.matrixWorld), color)
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  // Solid behind the arcade, columns along its edge; the arcade itself is walkable.
  const toWorld = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(g.matrixWorld)
  const a = toWorld(-w / 2 + 0.2, -ARCADE - (d - ARCADE) / 2)
  const b = toWorld(w / 2 - 0.2, -ARCADE - (d - ARCADE) / 2)
  addSegment(a.x, a.z, b.x, b.z, (d - ARCADE) / 2)
  for (const cx of cols) {
    const c = toWorld(cx, -0.3)
    addCircle(c.x, c.z, 0.4)
  }
  if (ruin === 'collapsed') {
    const spill = toWorld(0, 1.4)
    addCircle(spill.x, spill.z, w * 0.4)
  }
  return g
}

// ---------------------------------------------------------------- mapped buildings

// Walls of a footprint polygon [[x, z], ...] with outward normals and facing angles.
function footprintEdges(pts) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length
  const edges = []
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 0.5) continue
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    // yaw turns local +z (a facade's front) to face along the outward normal.
    edges.push({ ax, az, bx, bz, len, mx, mz, nx, nz, dx: (bx - ax) / len, dz: (bz - az) / len, yaw: Math.atan2(nx, nz) })
  }
  return { edges, cx, cz }
}

// Footprint extruded from y0 up by h, as a mesh lying on the ground plane.
function extrudeFootprint(pts, h, mat, y0 = 0) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y0, 0)
  return new THREE.Mesh(geo, mat)
}

const facing = (e, x, y, z) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.yaw), new THREE.Vector3(1, 1, 1))

/**
 * A building from the map: its real footprint `pts` raised `floors` storeys. Street-facing
 * walls (streetSide(edge) → true) get shutters and blade signs at ground level; every long
 * wall gets windows. ruin: 'none' | 'shell' | 'collapsed', as for shophouses.
 */
export function mappedBuilding({ pts, floors, ruin = 'none', streetSide, signs = true, material = null, windows = true }) {
  const g = new THREE.Group()
  const local = []
  const clad = material ?? cityMat(pick(CLADDING))
  const plain = cityMat(pick(['#8e8a82', '#9a958b', '#7f7b74']))
  const { edges, cx, cz } = footprintEdges(pts)
  const height = GROUND_FLOOR + floors * FLOOR
  const shutterColor = pick(['#8f8a80', '#7d8288', '#a39d90', '#6e6a62'])
  const add = (kind, m, color) => local.push([kind, m, color])

  // Arcades (騎樓) along the street: the ground floor steps back ARCADE metres behind a row
  // of columns while the floors above carry on out to the street line.
  const span = Math.sqrt(Math.abs(polygonArea(pts)))
  const isArcade = (e) => span > 8 && e.len >= 4 && streetSide(e)
  const rawArcade = pts.map(([ax, az], i) => {
    const [bx, bz] = pts[(i + 1) % pts.length]
    const len = Math.hypot(bx - ax, bz - az) || 1
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    const flip = (bz - az) * (mx - cx) - (bx - ax) * (mz - cz) < 0 ? -1 : 1
    return isArcade({ len, mx, mz, nx: (flip * (bz - az)) / len, nz: (-flip * (bx - ax)) / len })
  })
  const inset = rawArcade.some(Boolean) ? insetFootprint(pts, rawArcade, ARCADE) : null
  const arcadeDepth = (e) => (isArcade(e) && (inset || ruin !== 'none') ? ARCADE : 0)

  if (ruin === 'none') {
    if (inset) {
      g.add(extrudeFootprint(pts, height - GROUND_FLOOR, clad, GROUND_FLOOR))
      g.add(extrudeFootprint(inset, GROUND_FLOOR, plain))
    } else {
      g.add(extrudeFootprint(pts, height, clad))
    }
    // Roof clutter on the bigger roofs.
    if (rand() < 0.7) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 14), cityMat(pick(['#9ea4a8', '#3f6fa0', '#c8c2b0']), { kind: pick(['metal', 'paint']) }))
      tank.position.set(cx + range(-1, 1), height + 0.65, cz + range(-1, 1))
      g.add(tank)
    }
  } else {
    const top = ruin === 'shell' ? height : GROUND_FLOOR + FLOOR * range(0.4, 1.3)
    for (const e of edges) {
      // Some walls have come down entirely.
      if (rand() < 0.25) continue
      const holes = []
      const bays = windowBays(e.len)
      for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) holes.push({ x: -e.len / 2 + (b + 0.5) * (e.len / bays), y: GROUND_FLOOR + f * FLOOR + 0.95, w: Math.min(1.8, (e.len / bays) * 0.7), h: 1.4 })
      const wall = new THREE.Mesh(jaggedWall(e.len + 0.3, top * range(0.35, 0.95), range(0.4, 0.95), e.len > 3 ? holes : []), clad)
      wall.position.set(e.mx, 0, e.mz)
      wall.rotation.y = e.yaw
      g.add(wall)
    }
    if (ruin === 'collapsed') {
      const slabMat = cityMat(pick(CONCRETE))
      // Floor slabs broken into pieces a few metres across, heaped inside the footprint.
      const pieces = Math.min(40, Math.round((span * span) / 14) + 2)
      const xs = pts.map((q) => q[0])
      const zs = pts.map((q) => q[1])
      for (let i = 0, tries = 0; i < pieces && tries < pieces * 6; tries++) {
        const px = range(Math.min(...xs), Math.max(...xs))
        const pz = range(Math.min(...zs), Math.max(...zs))
        if (!pointInFootprint(px, pz, pts)) continue
        const slab = box(range(2.5, 6), range(0.22, 0.32), range(2, 5), slabMat)
        slab.position.set(px, range(0.3, Math.min(4, 1 + floors * 0.4)), pz)
        slab.rotation.set(range(-0.6, 0.6), rand() * 6, range(-0.5, 0.5))
        g.add(slab)
        i++
      }
      rubble(local, cx, cz, { radius: span * 0.65, height: Math.min(6, 2 + floors * 0.5), count: Math.round(span * 10), tint: clad.color.getStyle() })
    } else {
      rubble(local, cx, cz, { radius: span * 0.45, height: 2.2, count: Math.round(span * 4) })
    }
  }

  const columns = []
  for (const e of edges) {
    const recess = arcadeDepth(e)
    if (!recess) continue
    const count = Math.max(2, Math.round(e.len / 3.6) + 1)
    for (let i = 0; i < count; i++) {
      const t = -e.len / 2 + 0.35 + (i / (count - 1)) * (e.len - 0.7)
      const x = e.mx + e.dx * t - e.nx * 0.35
      const z = e.mz + e.dz * t - e.nz * 0.35
      // Whole under an intact block; in a ruin some snapped, under a collapse only stumps.
      const h = ruin === 'none' ? GROUND_FLOOR : ruin === 'shell' ? (rand() < 0.65 ? GROUND_FLOOR : range(0.6, GROUND_FLOOR * 0.7)) : range(0.4, 1.6)
      const col = box(0.6, h, 0.6, clad)
      col.position.set(x, h / 2, z)
      col.rotation.y = e.yaw
      g.add(col)
      columns.push([x, z])
    }
    if (ruin === 'shell') {
      // What is left of the floor over the arcade, in pieces with gaps between.
      for (let t = -e.len / 2; t < e.len / 2 - 1; ) {
        const len = Math.min(e.len / 2 - t, range(2, 5))
        if (rand() < 0.65) {
          const slab = box(len, 0.3, recess, cityMat(pick(CONCRETE)))
          const mid = t + len / 2
          slab.position.set(e.mx + e.dx * mid - e.nx * recess / 2, GROUND_FLOOR + 0.15, e.mz + e.dz * mid - e.nz * recess / 2)
          slab.rotation.set(0, e.yaw, 0)
          if (rand() < 0.3) slab.rotateX(range(-0.25, 0.25))
          g.add(slab)
        }
        t += len + range(0.3, 1.5)
      }
    }
  }

  for (const e of edges) {
    const street = streetSide(e)
    // Shopfronts sit at the back of the arcade.
    const back = arcadeDepth(e)
    if (windows && ruin === 'none' && e.len > 2.6) {
      const bays = windowBays(e.len)
      const ww = Math.min(1.8, (e.len / bays) * 0.7)
      for (let f = 0; f < floors; f++) {
        const y = GROUND_FLOOR + f * FLOOR + 1.65
        for (let b = 0; b < bays; b++) {
          const t = -e.len / 2 + (b + 0.5) * (e.len / bays)
          const x = e.mx + e.dx * t + e.nx * 0.01
          const z = e.mz + e.dz * t + e.nz * 0.01
          const base = facing(e, x, y, z)
          add('pane', base.clone().scale(new THREE.Vector3(ww, 1.4, 1)), pick(['#1c2228', '#232a30', '#2e3a40', '#151719', '#3d4a52']))
          add('frame', base.clone().scale(new THREE.Vector3(ww, 1.4, 1)), pick(['#b9bcbd', '#8a8e90', '#d8d4c8']))
          if (rand() < 0.5) add('grille', base.clone().scale(new THREE.Vector3(ww + 0.12, 1.52, 1)), pick(['#3b3d40', '#5a4b3c', '#2e3a38', '#6b5a48']))
          if (rand() < 0.3) add('ac', facing(e, x, y - 1.05, z), pick(['#d8d6cf', '#c9c4b8', '#b8b4aa']))
        }
      }
    }
    if (!street || e.len < 3) continue
    // Ground floor onto the street: a dark shopfront behind a part-rolled shutter.
    const sw = e.len - 1
    const shopFront = box(sw, GROUND_FLOOR - 0.9, 0.05, cityMat('#141210', { kind: 'paint', grime: 0.2 }))
    shopFront.position.set(e.mx + e.nx * (0.03 - back), (GROUND_FLOOR - 0.9) / 2, e.mz + e.nz * (0.03 - back))
    shopFront.rotation.y = e.yaw
    g.add(shopFront)
    const shutterH = (GROUND_FLOOR - 0.9) * pick([1, 1, 0.75, 0.45, 0.2])
    add('shutter', facing(e, e.mx + e.nx * (0.08 - back), GROUND_FLOOR - 0.9 - shutterH / 2, e.mz + e.nz * (0.08 - back)).scale(new THREE.Vector3(sw, shutterH, 1)), shutterColor)
    if (ruin !== 'collapsed') {
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.4, 0.9, 0.12), [plain, plain, plain, plain, signMaterial(), plain])
      fascia.position.set(e.mx + e.nx * 0.08, GROUND_FLOOR - 0.55, e.mz + e.nz * 0.08)
      fascia.rotation.y = e.yaw
      g.add(fascia)
    }
    if (signs && ruin === 'none' && e.len > 4) {
      const holder = new THREE.Group()
      holder.position.set(e.mx, 0, e.mz)
      holder.rotation.y = e.yaw
      const count = e.len > 12 ? 2 : 1
      for (let i = 0; i < count; i++) bladeSign(holder, (i % 2 ? 1 : -1) * (e.len / 2 - range(0.6, 1.4)), GROUND_FLOOR + range(0.2, 1), Math.min(floors * FLOOR - 0.6, range(3, 7)), rand() < 0.15 ? range(-0.25, 0.25) : 0)
      g.add(holder)
    }
  }

  for (const [kind, m, color] of local) part(kind, m, color)
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  // Walls block; arcades are walkable up to the shopfronts, between the columns.
  for (const e of edges) {
    const back = arcadeDepth(e)
    addSegment(e.ax - e.nx * back, e.az - e.nz * back, e.bx - e.nx * back, e.bz - e.nz * back, 0.3)
  }
  for (const [x, z] of columns) addCircle(x, z, 0.4)
  return g
}

/**
 * Footprint with chosen edges pulled inward by `depth` (the arcade recess).
 */
function insetFootprint(pts, inset, depth) {
  const n = pts.length
  const cx = pts.reduce((a, p) => a + p[0], 0) / n
  const cz = pts.reduce((a, p) => a + p[1], 0) / n
  const lines = pts.map(([ax, az], i) => {
    const [bx, bz] = pts[(i + 1) % n]
    const len = Math.hypot(bx - ax, bz - az) || 1
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    const d = inset[i] ? depth : 0
    return { px: ax - nx * d, pz: az - nz * d, dx: (bx - ax) / len, dz: (bz - az) / len }
  })
  const out = []
  for (let i = 0; i < n; i++) {
    const a = lines[(i - 1 + n) % n]
    const b = lines[i]
    const cross = a.dx * b.dz - a.dz * b.dx
    let x
    let z
    if (Math.abs(cross) < 0.05) {
      x = b.px
      z = b.pz
    } else {
      const t = ((b.px - a.px) * b.dz - (b.pz - a.pz) * b.dx) / cross
      x = a.px + a.dx * t
      z = a.pz + a.dz * t
    }
    // At a sharp or reflex corner the offset lines meet far away; step the corner straight
    // in along the two edges' inward normals instead.
    if (Math.hypot(x - pts[i][0], z - pts[i][1]) > depth * 2.5) {
      const na = { x: a.px - pts[(i - 1 + n) % n][0], z: a.pz - pts[(i - 1 + n) % n][1] }
      const nb = { x: b.px - pts[i][0], z: b.pz - pts[i][1] }
      x = pts[i][0] + (na.x + nb.x) / 2
      z = pts[i][1] + (na.z + nb.z) / 2
    }
    out.push([x, z])
  }
  return out
}

function pointInFootprint(x, z, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export function polygonArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    a += x1 * z2 - x2 * z1
  }
  return a / 2
}

/**
 * A tower that broke at its footing and fell flat, lying on its back so the window grid
 * faces the sky. It falls from (x, z) toward local +z (turned by rotY), snapped into
 * segments with debris heaped in the breaks and at the stump.
 */
export function toppledTower({ x, z, rotY, w, d, floors }) {
  const g = new THREE.Group()
  // Window parts live in each segment's frame; debris in the tower's own frame.
  const local = []
  const debris = []
  const clad = cityMat(pick(CLADDING))
  const slabMat = cityMat(pick(CONCRETE))
  const length = GROUND_FLOOR + floors * FLOOR
  const pieces = [0.36, 0.3, 0.34]
  const bays = windowBays(w)
  let at = d * 0.5
  let floorAt = 0
  pieces.forEach((frac, i) => {
    const len = length * frac
    const seg = new THREE.Group()
    const body = box(w, d, len, clad)
    body.position.set(0, d / 2, len / 2)
    seg.add(body)
    // Window grid on what used to be the street face, now facing up.
    const firstFloor = Math.ceil(floorAt / FLOOR)
    for (let f = firstFloor; (f + 1) * FLOOR + GROUND_FLOOR < floorAt + len + FLOOR && f < floors; f++) {
      const zz = GROUND_FLOOR + f * FLOOR + 1.65 - floorAt
      if (zz < 0.8 || zz > len - 0.8) continue
      for (let b = 0; b < bays; b++) {
        const wx = -w / 2 + (b + 0.5) * (w / bays)
        const ww = Math.min(1.8, (w / bays) * 0.7)
        const up = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
        local.push([seg, 'pane', new THREE.Matrix4().compose(new THREE.Vector3(wx, d + 0.01, zz), up, new THREE.Vector3(ww, 1.4, 1)), pick(['#1c2228', '#151719', '#2e3a40'])])
        local.push([seg, 'frame', new THREE.Matrix4().compose(new THREE.Vector3(wx, d + 0.02, zz), up, new THREE.Vector3(ww, 1.4, 1)), pick(['#b9bcbd', '#8a8e90'])])
        if (rand() < 0.4) local.push([seg, 'grille', new THREE.Matrix4().compose(new THREE.Vector3(wx, d + 0.02, zz), up, new THREE.Vector3(ww + 0.12, 1.52, 1)), pick(['#3b3d40', '#5a4b3c'])])
      }
    }
    // Exposed floor slabs at the broken ends.
    for (const end of [0, len]) {
      for (let k = 0; k < 3; k++) {
        const slab = box(w * range(0.6, 1), 0.25, range(0.5, 1.4), slabMat)
        slab.position.set(range(-0.5, 0.5), range(0.5, d - 0.5), end + (end ? 0.3 : -0.3))
        slab.rotation.set(range(-0.4, 0.4), 0, range(-0.2, 0.2))
        seg.add(slab)
      }
    }
    seg.position.set(range(-0.4, 0.4), i === pieces.length - 1 ? -0.4 : 0, at)
    seg.rotation.set(range(-0.03, 0.05), range(-0.08, 0.08), range(-0.06, 0.06))
    g.add(seg)
    rubble(debris, range(-0.5, 0.5), at - 0.4, { radius: w * 0.55, height: d * 0.55, count: Math.round(w * 6), tint: clad.color.getStyle() })
    at += len + range(0.8, 1.6)
    floorAt += len
  })
  // Stump where it sheared off, and the debris fan at the tip.
  for (let i = 0; i < 4; i++) {
    const col = box(0.7, range(1, 3), 0.7, clad)
    col.position.set(-w / 2 + 0.5 + (i / 3) * (w - 1), col.geometry.parameters.height / 2, -d * range(0.2, 0.8))
    g.add(col)
  }
  rubble(debris, 0, -d * 0.4, { radius: Math.max(w, d) * 0.6, height: 2.5, count: Math.round(w * 8) })
  rubble(debris, 0, at - 0.5, { radius: w * 0.7, height: 1.6, count: Math.round(w * 6) })

  g.position.set(x, 0, z)
  g.rotation.y = rotY
  g.updateMatrixWorld(true)
  for (const [seg, kind, m, color] of local) part(kind, m.clone().premultiply(seg.matrixWorld), color)
  for (const [kind, m, color] of debris) part(kind, m.clone().premultiply(g.matrixWorld), color)
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  const dir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY))
  addSegment(x, z, x + dir.x * at, z + dir.z * at, w / 2 + 0.2)
  return { group: g, from: [x, z], to: [x + dir.x * at, z + dir.z * at], halfWidth: w / 2 }
}

/**
 * Merge every static single-material mesh under root into one mesh per material per ground
 * cell, baking world transforms. Hundreds of facade boxes become a few draw calls, while
 * cells off screen (or outside the sun's shadow box) are still culled whole.
 */
export function batchStatic(root, cell = 40) {
  root.updateMatrixWorld(true)
  const buckets = new Map()
  const doomed = []
  const centre = new THREE.Vector3()
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.dynamic) return
    const geo = o.geometry.clone()
    geo.applyMatrix4(o.matrixWorld)
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name)
    geo.computeBoundingBox()
    geo.boundingBox.getCenter(centre)
    const key = `${o.material.uuid}:${Math.floor(centre.x / cell)},${Math.floor(centre.z / cell)}`
    if (!buckets.has(key)) buckets.set(key, { material: o.material, list: [] })
    buckets.get(key).list.push(geo.index ? geo.toNonIndexed() : geo)
    doomed.push(o)
  })
  for (const o of doomed) o.removeFromParent()
  const out = new THREE.Group()
  for (const { material, list } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    out.add(mesh)
  }
  return out
}
