import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { rand, range, pick } from './terrain.js'
import { addCircle, addSegment } from './collision.js'
import { cityMat } from './city.js'
import { withCutaway } from './cutaway.js'
import { weathered } from './weathering.js'

// Abandoned street furniture and landmarks for the ruined district. Every piece is built
// from shared weathered materials so the scene can batch it into a few draw calls.

const mesh = (geo, mat) => new THREE.Mesh(geo, mat)
const rbox = (w, h, d, r, mat) => mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat)

function place(g, x, z, rotY, collide) {
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  if (collide) addCircle(x, z, collide)
  return g
}

function wheel(r, w, x, y, z, tyre, hub) {
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(r, r, w, 12).rotateX(Math.PI / 2), tyre))
  g.add(mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.02, 8).rotateX(Math.PI / 2), hub))
  g.position.set(x, y, z)
  return g
}

const CAR_COLORS = ['#c9c4b8', '#8e9396', '#3a4a5c', '#6e2a26', '#2d3a2e', '#e2b230']

// Four-door saloon facing +x; `crushed` flattens the cabin under fallen debris.
export function car(x, z, rotY, { taxi = false, crushed = false } = {}) {
  const g = new THREE.Group()
  const paint = cityMat(taxi ? '#e5b62a' : pick(CAR_COLORS), { kind: 'paint', grime: 1.3, fade: 0.35 })
  const glass = cityMat('#20282c', { kind: 'paint', grime: 0.8, fade: 0, roughness: 0.3 })
  const tyre = cityMat('#1a1a1c', { kind: 'paint', grime: 0.5 })
  const hub = cityMat('#7a7d80', { kind: 'metal' })
  const lower = rbox(4.3, 0.7, 1.72, 0.18, paint)
  lower.position.y = 0.62
  g.add(lower)
  const cabinH = crushed ? 0.22 : 0.62
  const cabin = rbox(2.3, cabinH, 1.56, 0.16, paint)
  cabin.position.set(-0.25, 0.97 + cabinH / 2, 0)
  if (crushed) cabin.rotation.z = range(-0.08, 0.08)
  g.add(cabin)
  if (!crushed) {
    const windows = rbox(2.32, 0.4, 1.58, 0.12, glass)
    windows.position.set(-0.25, 1.32, 0)
    g.add(windows)
  }
  for (const [wx, wz] of [[1.35, 0.78], [1.35, -0.78], [-1.35, 0.78], [-1.35, -0.78]]) {
    const flat = rand() < 0.5
    g.add(wheel(0.34, 0.24, wx, flat ? 0.22 : 0.34, wz, tyre, hub))
  }
  if (taxi) {
    const roofSign = rbox(0.5, 0.18, 0.28, 0.04, cityMat('#f2efe6', { kind: 'paint' }))
    roofSign.position.set(-0.25, 1.1 + cabinH, 0)
    if (!crushed) g.add(roofSign)
  }
  // Settled on deflated tyres at a slight list.
  g.rotation.set(range(-0.03, 0.03), 0, range(-0.03, 0.03))
  const outer = new THREE.Group()
  outer.add(g)
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  addSegment(x - 1.6 * c, z + 1.6 * s, x + 1.6 * c, z - 1.6 * s, 1.0)
  return place(outer, x, z, rotY, 0)
}

// Street lamp with an overhanging arm; toppled ones lie across the pavement.
export function streetLamp(x, z, rotY, toppled = false) {
  const g = new THREE.Group()
  const pole = cityMat('#5d6266', { kind: 'metal' })
  const post = mesh(new THREE.CylinderGeometry(0.07, 0.11, 7, 8).translate(0, 3.5, 0), pole)
  const arm = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6).rotateZ(Math.PI / 2).translate(0.8, 6.9, 0), pole)
  const head = rbox(0.6, 0.16, 0.3, 0.05, cityMat('#3a3d40', { kind: 'metal' }))
  head.position.set(1.55, 6.82, 0)
  g.add(post, arm, head)
  if (toppled) {
    g.rotation.z = -Math.PI / 2 + range(0.02, 0.1)
    g.position.y = 0.12
    const outer = new THREE.Group()
    outer.add(g)
    return place(outer, x, z, rotY, 0)
  }
  return place(g, x, z, rotY, 0.2)
}

// ---------------------------------------------------------------- landmarks

const trim = () => cityMat('#e6dfd0', { kind: 'paint', grime: 1.2 })

// Arched window on a wall at (x, y, z) facing yaw: dark recess with a pale stone surround.
function archWindow(g, x, y, z, yaw, w, h) {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2, 0)
  shape.lineTo(w / 2, 0)
  shape.lineTo(w / 2, h - w / 2)
  shape.absarc(0, h - w / 2, w / 2, 0, Math.PI, false)
  shape.closePath()
  const holder = new THREE.Group()
  holder.add(mesh(new THREE.ShapeGeometry(shape, 10), cityMat('#1a1714', { kind: 'paint', grime: 0.3 })))
  const ring = new THREE.Shape()
  ring.absarc(0, 0, w / 2 + 0.14, 0, Math.PI, false)
  ring.absarc(0, 0, w / 2, Math.PI, 0, true)
  const arch = mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: false, curveSegments: 10 }), trim())
  arch.position.y = h - w / 2
  holder.add(arch)
  holder.position.set(x, y, z)
  holder.rotation.y = yaw
  g.add(holder)
}

/**
 * Dress the Red House (西門紅樓) over its mapped footprint: arched windows on two levels
 * and white string courses along every wall, then a low octagonal roof and lantern on the
 * octagon at the footprint's east end. `eaves` is the wall height.
 */
export function redHouseDressing(pts, eaves = 10.6) {
  const g = new THREE.Group()
  const cx0 = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const cz0 = pts.reduce((a, p) => a + p[1], 0) / pts.length
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const len = Math.hypot(bx - ax, bz - az)
    if (len < 1.2) continue
    let nx = (bz - az) / len
    let nz = -(bx - ax) / len
    const mx = (ax + bx) / 2
    const mz = (az + bz) / 2
    if (nx * (mx - cx0) + nz * (mz - cz0) < 0) {
      nx = -nx
      nz = -nz
    }
    const yaw = Math.atan2(nx, nz)
    for (const y of [eaves * 0.47, eaves - 0.3]) {
      const band = mesh(new THREE.BoxGeometry(len + 0.3, 0.35, 0.18), trim())
      band.position.set(mx + nx * 0.08, y, mz + nz * 0.08)
      band.rotation.y = yaw
      g.add(band)
    }
    const n = Math.floor(len / 2.6)
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5
      const x = mx + ((bx - ax) * t) + nx * 0.02
      const z = mz + ((bz - az) * t) + nz * 0.02
      archWindow(g, x, 0.8, z, yaw, 1.2, 2.8)
      archWindow(g, x, eaves * 0.5 + 0.4, z, yaw, 1.2, 2.8)
    }
  }
  // Octagon: the cluster of footprint points at its east end.
  const east = pts.reduce((a, p) => (p[0] > a[0] ? p : a))
  const near = pts.filter(([x, z]) => Math.hypot(x - east[0], z - east[1]) < 22)
  const cx = near.reduce((a, p) => a + p[0], 0) / near.length
  const cz = near.reduce((a, p) => a + p[1], 0) / near.length
  const r = Math.max(...near.map(([x, z]) => Math.hypot(x - cx, z - cz)))
  const roof = mesh(new THREE.CylinderGeometry(r * 0.3, r + 0.4, 2.6, 8), cityMat('#4a4d50', { kind: 'metal' }))
  roof.position.set(cx, eaves + 1.3, cz)
  const lantern = mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.24, 1.8, 8), trim())
  lantern.position.set(cx, eaves + 3.4, cz)
  const cap = mesh(new THREE.ConeGeometry(r * 0.3, 1.5, 8), cityMat('#3f4245', { kind: 'metal' }))
  cap.position.set(cx, eaves + 5, cz)
  for (const m of [roof, lantern, cap]) m.rotation.y = Math.PI / 8
  g.add(roof, lantern, cap)
  return g
}

const canvasTexture = (w, h, draw) => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d'))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// Station band across the canopy front: Taipei Metro's green-to-blue band for Ximen (green
// and blue lines), name in Chinese and English, the exit number on a yellow square.
function exitSignTexture(number) {
  return canvasTexture(1024, 128, (ctx) => {
    const band = ctx.createLinearGradient(0, 0, 1024, 0)
    band.addColorStop(0, '#2f8f5a')
    band.addColorStop(0.45, '#2a7f8a')
    band.addColorStop(1, '#1f5fae')
    ctx.fillStyle = band
    ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = '#f4f4f0'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.font = '800 60px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    ctx.fillText('西門站', 470, 52)
    ctx.font = '600 22px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText('XIMEN STATION', 470, 104)
    ctx.fillStyle = '#f2c230'
    ctx.fillRect(880, 10, 108, 108)
    ctx.fillStyle = '#1d1d1b'
    ctx.font = '900 92px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(String(number), 934, 70)
  })
}

// Head of the exit totem: a generic metro roundel over the exit number.
function totemTexture(number) {
  return canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#34383d'
    ctx.fillRect(0, 0, 128, 256)
    ctx.fillStyle = '#1f6fb6'
    ctx.beginPath()
    ctx.arc(64, 64, 50, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#f4f4f0'
    ctx.lineWidth = 9
    ctx.beginPath()
    ctx.arc(64, 64, 32, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#f4f4f0'
    ctx.fillRect(24, 59, 80, 10)
    ctx.font = '900 84px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(number), 64, 180)
  })
}

/**
 * Taipei MRT exit in the Ximen manner: a glass pavilion under a thick white canopy with
 * rounded corners overhanging the front, the station band along its fascia, broad granite
 * steps up to the mouth, stairs into the dark inside and an exit totem beside it. Long axis
 * along local z, the mouth at +z. Decades on, most glass is gone and one canopy corner sags.
 */
export function mrtExit(x, z, rotY, { number = 6, length = 9, width = 4.6 } = {}) {
  const g = new THREE.Group()
  const W = width
  const L = length
  const H = 3.4
  const white = cityMat('#e2e3de', { kind: 'paint', grime: 1.2 })
  const steel = cityMat('#b9bcb8', { kind: 'metal' })
  const granite = cityMat('#a29d93', { kind: 'concrete' })
  const glass = withCutaway(new THREE.MeshStandardMaterial({ color: '#a9c2c8', transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2 }))

  // Granite plinth, and broad steps up to it at the mouth.
  const plinth = rbox(W, 0.45, L, 0.04, granite)
  plinth.position.y = 0.225
  g.add(plinth)
  for (let i = 0; i < 3; i++) {
    const step = rbox(W + 1.6, 0.15, 0.45, 0.02, granite)
    step.position.set(0, 0.075 + i * 0.15, L / 2 + 1.35 - i * 0.45)
    g.add(step)
  }
  // Glass walls on a steel grid along the sides and back; the front stands open.
  const bays = Math.max(3, Math.round(L / 1.6))
  const pane = (px, pz, w, ry) => {
    if (rand() < 0.7) return
    const p = mesh(new THREE.BoxGeometry(w - 0.1, H - 0.6, 0.02), glass)
    p.position.set(px, 0.45 + (H - 0.45) / 2, pz)
    p.rotation.y = ry
    p.userData.dynamic = true
    g.add(p)
  }
  for (const sx of [-1, 1]) {
    for (let k = 0; k <= bays; k++) {
      const pz = -L / 2 + (k / bays) * L
      const post = mesh(new THREE.BoxGeometry(0.1, H - 0.45, 0.1), steel)
      post.position.set((sx * W) / 2, 0.45 + (H - 0.45) / 2, pz)
      g.add(post)
      if (k < bays) pane((sx * W) / 2, pz + L / bays / 2, L / bays, Math.PI / 2)
    }
  }
  for (let k = 1; k < 3; k++) {
    const post = mesh(new THREE.BoxGeometry(0.1, H - 0.45, 0.1), steel)
    post.position.set(-W / 2 + (k / 3) * W, 0.45 + (H - 0.45) / 2, -L / 2)
    g.add(post)
  }
  pane(0, -L / 2, W, 0)
  // The canopy: a thick white slab with rounded corners, overhanging the front and sides,
  // its front-left corner broken off and hanging.
  const cw = W + 1.6
  const cl = L + 1.2
  const cr = Math.min(1.6, cw / 2 - 0.1)
  const plan = new THREE.Shape()
  plan.moveTo(-cw / 2 + cr, -cl / 2)
  plan.lineTo(cw / 2 - cr, -cl / 2)
  plan.absarc(cw / 2 - cr, -cl / 2 + cr, cr, -Math.PI / 2, 0, false)
  plan.lineTo(cw / 2, cl / 2 - cr)
  plan.absarc(cw / 2 - cr, cl / 2 - cr, cr, 0, Math.PI / 2, false)
  plan.lineTo(-cw / 2 + cr, cl / 2)
  plan.absarc(-cw / 2 + cr, cl / 2 - cr, cr, Math.PI / 2, Math.PI, false)
  plan.lineTo(-cw / 2, -cl / 2 + cr)
  plan.absarc(-cw / 2 + cr, -cl / 2 + cr, cr, Math.PI, Math.PI * 1.5, false)
  const canopy = mesh(new THREE.ExtrudeGeometry(plan, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 }).rotateX(Math.PI / 2), white)
  canopy.position.set(0, H + 0.55, 0.5)
  g.add(canopy)
  const broken = rbox(1.6, 0.5, 1.6, 0.22, white)
  broken.position.set(-W / 2 - 0.2, H - 0.25, L / 2 + 0.6)
  broken.rotation.set(0.35, 0.2, -0.45)
  g.add(broken)
  const signFace = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: exitSignTexture(number), roughness: 0.6 }), { kind: 'paint', fade: 0.3 }))
  const band = mesh(new THREE.BoxGeometry(W + 1.2, 0.5, 0.06), [white, white, white, white, signFace, white])
  band.position.set(0.3, H + 0.27, L / 2 + 1.12)
  g.add(band)

  // Stairs down into the dark.
  const pit = mesh(new THREE.BoxGeometry(W - 0.6, 0.02, L - 0.8), cityMat('#0c0b0a', { kind: 'paint', grime: 0.1 }))
  pit.position.y = 0.46
  g.add(pit)
  const stepMat = cityMat('#6f6b64', { kind: 'concrete' })
  for (let i = 0; i < 7; i++) {
    const step = mesh(new THREE.BoxGeometry(W * 0.5, 0.04, 0.3), stepMat)
    step.position.set(-W * 0.16, 0.49, L / 2 - 0.9 - i * ((L - 2) / 7))
    g.add(step)
  }
  const rubber = cityMat('#1b1c1e', { kind: 'paint', grime: 0.5 })
  for (const ex of [W * 0.14, W * 0.38]) {
    const handrail = mesh(new THREE.BoxGeometry(0.08, 0.9, L * 0.55), rubber)
    handrail.position.set(ex, 0.9, L / 2 - 0.6 - L * 0.28)
    handrail.rotation.x = -0.1
    g.add(handrail)
  }

  // Exit totem beside the mouth.
  const edge = cityMat('#34383d', { kind: 'paint' })
  const totemFace = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: totemTexture(number), roughness: 0.6 }), { kind: 'paint', fade: 0.25 }))
  const head = mesh(new THREE.BoxGeometry(0.55, 1.1, 0.18), [edge, edge, edge, edge, totemFace, totemFace])
  head.position.set(W / 2 + 1.6, 2.6, L / 2 + 1.6)
  const pole = mesh(new THREE.BoxGeometry(0.16, 2.1, 0.16), edge)
  pole.position.set(W / 2 + 1.6, 1.05, L / 2 + 1.6)
  g.add(head, pole)

  g.position.set(x, 0, z)
  g.rotation.y = rotY
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  // The pavilion blocks walkers and keeps grass off its floor.
  addSegment(x - (L / 2) * s, z - (L / 2) * c, x + (L / 2) * s, z + (L / 2) * c, W / 2 + 0.1)
  addCircle(x + (W / 2 + 1.6) * c + (L / 2 + 1.6) * s, z - (W / 2 + 1.6) * s + (L / 2 + 1.6) * c, 0.25)
  return g
}

// Plaza lamp from the Exit 6 square: a tall pole hung with disc lamps at staggered heights
// and angles. Leaning ones have had their footings heaved by roots.
export function discLamp(x, z, lean = 0) {
  const g = new THREE.Group()
  const pole = cityMat('#8e9294', { kind: 'metal' })
  const disc = cityMat('#d8dad6', { kind: 'paint', grime: 1.3 })
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, 8, 8).translate(0, 4, 0), pole))
  for (let i = 0; i < 5; i++) {
    const a = i * 2.3 + rand()
    const y = 4.4 + i * 0.75
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5).rotateZ(Math.PI / 2).translate(0.35, 0, 0), pole)
    arm.position.y = y
    arm.rotation.y = a
    g.add(arm)
    const lamp = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 18), disc)
    lamp.position.set(Math.cos(a) * 0.75, y, -Math.sin(a) * 0.75)
    lamp.rotation.set(range(-0.5, 0.5), a, range(0.3, 0.7))
    g.add(lamp)
  }
  g.position.set(x, 0, z)
  g.rotation.set(lean, rand() * 6, 0, 'YXZ')
  addCircle(x, z, 0.2)
  return g
}

// Hanzhong Street's tall yellow L-poles: an upright with an arm, a banner hanging off it.
export function mallPole(x, z, rotY, { bent = 0, fallen = false } = {}) {
  const g = new THREE.Group()
  const yellow = cityMat('#e0a62a', { kind: 'paint', grime: 1.3, fade: 0.25 })
  const post = mesh(new THREE.BoxGeometry(0.22, 6.5, 0.22).translate(0, 3.25, 0), yellow)
  const arm = mesh(new THREE.BoxGeometry(1.6, 0.18, 0.18).translate(0.8, 6.4, 0), yellow)
  g.add(post, arm)
  const banner = mesh(
    new THREE.PlaneGeometry(0.8, 2.2).translate(1.2, 5.1, 0),
    cityMat(pick(['#3a7ac0', '#c84a8a', '#3fa57a', '#d8b03a']), { kind: 'paint', fade: 0.45, side: THREE.DoubleSide }),
  )
  banner.rotation.z = range(-0.08, 0.08)
  g.add(banner)
  if (fallen) {
    g.rotation.set(0, rotY, Math.PI / 2 - 0.06, 'YXZ')
    g.position.set(x, 0.12, z)
    return g
  }
  g.rotation.set(0, rotY, bent, 'YXZ')
  g.position.set(x, 0, z)
  addCircle(x, z, 0.2)
  return g
}

// ---------------------------------------------------------------- New World Building

// Lettering for a facade sign: white strokes on a dark panel, or the reverse.
function letteringTexture(text, { bg = '#2a2c30', fg = '#f2f0ea', vertical = false } = {}) {
  const chars = [...text]
  const w = vertical ? 128 : 128 * chars.length
  const h = vertical ? 128 * chars.length : 128
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = fg
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '800 96px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    chars.forEach((ch, i) => (vertical ? ctx.fillText(ch, 64, 64 + i * 128) : ctx.fillText(ch, 64 + i * 128, 66)))
  })
}

/**
 * The New World Building's corner tower (新世界大樓): a glass drum braced with stacked
 * X-frames, standing at the footprint corner nearest `toward`, with the building's name
 * and the cinema sign on the facades either side. `height` is the roof line.
 */
export function newWorldTower(pts, height, toward) {
  const g = new THREE.Group()
  const corner = pts.reduce((a, p) => (Math.hypot(p[0] - toward[0], p[1] - toward[1]) < Math.hypot(a[0] - toward[0], a[1] - toward[1]) ? p : a))
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length
  const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length
  const inX = cx - corner[0]
  const inZ = cz - corner[1]
  const inLen = Math.hypot(inX, inZ)
  // Centred just inside the corner, the drum bulging past both facades without blocking the mall.
  const r = 5
  const ox = corner[0] + (inX / inLen) * 2.5
  const oz = corner[1] + (inZ / inLen) * 2.5
  const H = height + 2
  const white = cityMat('#e8e6de', { kind: 'paint', grime: 1.1 })
  const frame = cityMat('#c9ccc8', { kind: 'metal' })
  const glass = withCutaway(new THREE.MeshStandardMaterial({ color: '#7f97a0', transparent: true, opacity: 0.45, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide }))
  // Glass drum, some facets blown out.
  const facets = 12
  for (let i = 0; i < facets; i++) {
    if (rand() < 0.3) continue
    const a0 = (i / facets) * Math.PI * 2
    const pane = mesh(new THREE.CylinderGeometry(r, r, H - 4.4, 2, 1, true, a0, (Math.PI * 2) / facets), glass)
    pane.position.set(ox, 4.4 + (H - 4.4) / 2, oz)
    pane.userData.dynamic = true
    g.add(pane)
  }
  // Floor rings and the X-bracing between them, two storeys to a bay.
  const bay = 6.4
  for (let y = 4.4; y <= H + 0.01; y += bay / 2) {
    const ring = mesh(new THREE.TorusGeometry(r + 0.08, 0.12, 4, 32).rotateX(Math.PI / 2), frame)
    ring.position.set(ox, y, oz)
    g.add(ring)
  }
  for (let y = 4.4; y + bay <= H + 0.01; y += bay) {
    for (let i = 0; i < facets; i++) {
      const a = ((i + 0.5) / facets) * Math.PI * 2
      const half = (Math.PI * 2) / facets
      for (const dir of [-1, 1]) {
        const a0 = a - half / 2
        const a1 = a + half / 2
        const p0 = new THREE.Vector3(ox + Math.sin(a0) * (r + 0.12), y + (dir > 0 ? 0 : bay), oz + Math.cos(a0) * (r + 0.12))
        const p1 = new THREE.Vector3(ox + Math.sin(a1) * (r + 0.12), y + (dir > 0 ? bay : 0), oz + Math.cos(a1) * (r + 0.12))
        const len = p0.distanceTo(p1)
        const bar = mesh(new THREE.BoxGeometry(0.16, len, 0.16), frame)
        bar.position.copy(p0).add(p1).multiplyScalar(0.5)
        bar.lookAt(p1)
        bar.rotateX(Math.PI / 2)
        g.add(bar)
      }
    }
  }
  // Solid base storey and a cap.
  const base = mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 4.4, 32), white)
  base.position.set(ox, 2.2, oz)
  const cap = mesh(new THREE.CylinderGeometry(r + 0.5, r + 0.5, 0.6, 32), white)
  cap.position.set(ox, H + 0.3, oz)
  g.add(base, cap)

  // Name and cinema signs on the facades running away from the corner.
  const i = pts.indexOf(corner)
  const neighbours = [pts[(i + 1) % pts.length], pts[(i - 1 + pts.length) % pts.length]]
  neighbours.forEach((nb, k) => {
    const dx = nb[0] - corner[0]
    const dz = nb[1] - corner[1]
    const len = Math.hypot(dx, dz)
    let nx = dz / len
    let nz = -dx / len
    if (nx * (corner[0] - cx) + nz * (corner[1] - cz) < 0) {
      nx = -nx
      nz = -nz
    }
    const at = r + 3.5
    const sx = corner[0] + (dx / len) * at + nx * 0.12
    const sz = corner[1] + (dz / len) * at + nz * 0.12
    const text = k === 0 ? '新世界大樓' : '真美善劇院'
    const tex = letteringTexture(text, k === 0 ? { bg: '#e8e6de', fg: '#2a6a4a' } : { bg: '#2a2c30', fg: '#f2d07a' })
    const sign = mesh(new THREE.PlaneGeometry(text.length * 1.1, 1.1), withCutaway(weathered(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), { kind: 'paint', fade: 0.3 })))
    sign.position.set(sx + (dx / len) * text.length * 0.55, k === 0 ? 7.5 : 5, sz + (dz / len) * text.length * 0.55)
    sign.rotation.y = Math.atan2(nx, nz)
    sign.userData.dynamic = true
    g.add(sign)
  })
  addCircle(ox, oz, r + 0.4)
  return g
}

// ---------------------------------------------------------------- cinema street

const FILMS = [
  ['西門追風', '#d2452f', '#1a1c2a'],
  ['霓虹迷途', '#5a2a8a', '#ffd84a'],
  ['雨夜情歌', '#1f4f7a', '#f4e8d0'],
  ['鐵甲少女', '#2a2a2e', '#e8483a'],
  ['末班捷運', '#0f3a3a', '#7ae0c8'],
  ['龍虎西門', '#7a1a14', '#f2c230'],
]

// Hand-painted cinema poster: a big title, a painted glow behind two silhouetted heads,
// the paint cracked and bleached decades on.
function filmTexture([title, bg, fg]) {
  return canvasTexture(256, 384, (ctx) => {
    const grad = ctx.createLinearGradient(0, 0, 0, 384)
    grad.addColorStop(0, fg)
    grad.addColorStop(0.35, bg)
    grad.addColorStop(1, bg)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 384)
    const glow = ctx.createRadialGradient(128, 150, 10, 128, 150, 140)
    glow.addColorStop(0, '#ffffffcc')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, 256, 384)
    ctx.fillStyle = 'rgba(10,10,14,0.85)'
    for (const [hx, hy, r] of [[95, 170, 42], [165, 185, 36]]) {
      ctx.beginPath()
      ctx.arc(hx, hy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(hx, hy + r * 2.2, r * 1.5, r * 1.4, 0, Math.PI, 0)
      ctx.fill()
    }
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 54px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    ctx.fillText(title, 128, 320)
    ctx.font = '600 16px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText('NOW SHOWING', 128, 360)
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,250,235,${range(0.04, 0.16)})`
      ctx.fillRect(range(0, 256), range(0, 384), range(10, 80), range(10, 60))
    }
  })
}

/**
 * A cinema front on Wuchang Street: a row of hand-painted film posters across the facade
 * above the entrance and the cinema's name down a tall vertical sign. Facade at (x, z)
 * facing yaw, w wide, posters from y up; the name sign rises beside them.
 */
export function cinemaFront(x, z, yaw, w, y, name) {
  const g = new THREE.Group()
  const frame = cityMat('#2c2e32', { kind: 'metal' })
  const count = Math.max(2, Math.min(6, Math.floor(w / 1.7)))
  const pw = Math.min(1.5, (w / count) * 0.88)
  const ph = pw * 1.5
  for (let i = 0; i < count; i++) {
    const m = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: filmTexture(pick(FILMS)), roughness: 0.8 }), { kind: 'paint', grime: 0.4, fade: 0.2 }))
    const poster = mesh(new THREE.BoxGeometry(pw, ph, 0.12), [frame, frame, frame, frame, m, frame])
    poster.position.set((i - (count - 1) / 2) * (w / count), y + ph / 2, 0.35)
    // Now and then one has come loose and hangs off a corner.
    if (rand() < 0.2) poster.rotation.z = range(-0.35, 0.35)
    g.add(poster)
  }
  const nameTex = canvasTexture(128, 128 * [...name].length, (ctx) => {
    ctx.fillStyle = '#b8241c'
    ctx.fillRect(0, 0, 128, 128 * [...name].length)
    ctx.fillStyle = '#f6e7c8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 96px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    ;[...name].forEach((ch, i) => ctx.fillText(ch, 64, 66 + i * 128))
  })
  const nameMat = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.7 }), { kind: 'paint', fade: 0.3 }))
  const signH = [...name].length * 1.1
  const sign = mesh(new THREE.BoxGeometry(0.3, signH, 1.1), [nameMat, nameMat, frame, frame, frame, frame])
  sign.position.set(w / 2 - 0.6, Math.max(y + ph + 0.4, 2.5) + signH / 2, 0.9)
  g.add(sign)
  g.position.set(x, 0, z)
  g.rotation.y = yaw
  g.traverse((o) => (o.userData.dynamic = o.isMesh))
  return g
}

// Wuchang Street's light totems: a white column crowned with stacked coloured rings.
export function ringTotem(x, z, { lean = 0 } = {}) {
  const g = new THREE.Group()
  const white = cityMat('#e4e2dc', { kind: 'paint', grime: 1.2 })
  g.add(mesh(new THREE.CylinderGeometry(0.42, 0.48, 4.6, 16).translate(0, 2.3, 0), white))
  const colours = ['#e0483c', '#f2a83a', '#f2d84a', '#5ab04a', '#3a8ad0', '#9a5ac8']
  for (let i = 0; i < 4; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.62 + i * 0.05, 0.07, 6, 24).rotateX(Math.PI / 2), cityMat(colours[(i * 2 + Math.floor(rand() * 2)) % 6], { kind: 'paint', fade: 0.4 }))
    ring.position.y = 4.1 + i * 0.32
    ring.rotation.x = rand() < 0.25 ? range(-0.4, 0.4) : 0
    g.add(ring)
  }
  g.position.set(x, 0, z)
  g.rotation.set(lean, rand() * 6, 0, 'YXZ')
  addCircle(x, z, 0.5)
  return g
}

// Emei Street's teal lamp posts: a tall post with a halo ring around a cylindrical lamp.
export function haloPole(x, z, { lean = 0 } = {}) {
  const g = new THREE.Group()
  const teal = cityMat('#3f9a92', { kind: 'paint', grime: 1.2, fade: 0.3 })
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.4, 10).translate(0, 3.2, 0), teal))
  const lamp = mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.3, 14), cityMat('#2a2e32', { kind: 'metal' }))
  lamp.position.y = 6.9
  const halo = mesh(new THREE.TorusGeometry(0.9, 0.08, 6, 28).rotateX(Math.PI / 2), teal)
  halo.position.y = 7.5
  halo.rotation.z = rand() < 0.3 ? range(0.2, 0.5) : 0
  g.add(lamp, halo)
  g.position.set(x, 0, z)
  g.rotation.set(lean, rand() * 6, 0, 'YXZ')
  addCircle(x, z, 0.25)
  return g
}

// Billboard on a steel frame standing on a roof edge at height y, facing yaw, w × h.
export function rooftopBillboard(x, z, yaw, w, h, y) {
  const g = new THREE.Group()
  const steel = cityMat('#4a4d50', { kind: 'metal' })
  const face = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: adTexture(true), roughness: 0.8 }), { kind: 'paint', grime: 0.7, fade: 0.35 }))
  const board = mesh(new THREE.BoxGeometry(w, h, 0.2), [steel, steel, steel, steel, face, steel])
  board.position.y = y + 1.2 + h / 2
  board.rotation.x = rand() < 0.2 ? range(-0.25, -0.1) : 0
  g.add(board)
  for (const lx of [-w * 0.35, w * 0.35]) {
    const leg = mesh(new THREE.BoxGeometry(0.16, 1.2 + h * 0.6, 0.16), steel)
    leg.position.set(lx, y + (1.2 + h * 0.6) / 2, -0.6)
    g.add(leg)
    const brace = mesh(new THREE.BoxGeometry(0.1, 0.1, 1.6), steel)
    brace.position.set(lx, y + 0.6, -0.3)
    brace.rotation.x = 0.6
    g.add(brace)
  }
  g.position.set(x, 0, z)
  g.rotation.y = yaw
  g.traverse((o) => (o.userData.dynamic = o.isMesh))
  return g
}

/**
 * The famous noodle stand at the Emei Street corner (renamed): a red signboard with big
 * gold lettering over a stall counter, a tall vertical sign, and the standing counters
 * where the queue ate. Facing yaw at (x, z).
 */
export function noodleStand(x, z, yaw) {
  const g = new THREE.Group()
  const red = cityMat('#b8241c', { kind: 'paint', fade: 0.3 })
  const steel = cityMat('#8a8e90', { kind: 'metal' })
  const signTex = canvasTexture(512, 160, (ctx) => {
    ctx.fillStyle = '#b8241c'
    ctx.fillRect(0, 0, 512, 160)
    ctx.strokeStyle = '#f2c230'
    ctx.lineWidth = 8
    ctx.strokeRect(10, 10, 492, 140)
    ctx.fillStyle = '#f6d24a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 104px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    ctx.fillText('阿忠麵線', 256, 84)
  })
  const signMat = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 }), { kind: 'paint', fade: 0.3 }))
  const sign = mesh(new THREE.BoxGeometry(4.2, 1.3, 0.16), [red, red, red, red, signMat, red])
  sign.position.set(0, 3.4, 0.2)
  sign.rotation.z = 0.04
  g.add(sign)
  const counter = rbox(3.6, 1.0, 0.9, 0.05, steel)
  counter.position.set(0, 0.5, 0.6)
  g.add(counter)
  // The same name on a banner along the counter front, low enough for the camera to read.
  const banner = mesh(new THREE.PlaneGeometry(3.4, 0.85), signMat)
  banner.position.set(0, 0.55, 1.06)
  g.add(banner)
  for (let i = 0; i < 2; i++) {
    const pot = mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.5, 16), cityMat('#5a5e60', { kind: 'metal' }))
    pot.position.set(-0.8 + i * 1.4, 1.25, 0.6)
    g.add(pot)
  }
  for (let i = 0; i < 3; i++) {
    const table = rbox(1.2, 0.06, 0.5, 0.02, steel)
    table.position.set(-1.5 + i * 1.5, 1.1, 2.6 + (i % 2) * 0.4)
    table.rotation.y = range(-0.2, 0.2)
    const leg = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), steel)
    leg.position.set(table.position.x, 0.55, table.position.z)
    g.add(table, leg)
  }
  g.position.set(x, 0, z)
  g.rotation.y = yaw
  g.traverse((o) => (o.userData.dynamic = o.isMesh))
  addCircle(x + Math.sin(yaw) * 0.6, z + Math.cos(yaw) * 0.6, 1.8)
  return g
}

// ---------------------------------------------------------------- billboards

const AD_COPY = [
  ['全館清倉', '1折起', '#c8302c', '#ffffff'],
  ['明天的我', '會更好', '#e8e2d6', '#c8302c'],
  ['換季特賣', 'SALE 70%', '#1f3f7a', '#f2c230'],
  ['西門夜未眠', '新片熱映', '#1a1a1e', '#f0e6c8'],
  ['白到發光', '美肌新上市', '#f0c8d2', '#5a2a3a'],
  ['ZUMBA 舞蹈', '體驗課免費', '#2e8a5a', '#ffffff'],
  ['HOT 珍奶', '第二杯半價', '#f2c230', '#3a2414'],
]

// A giant facade ad, sun-bleached and torn: the bottom edge shredded away to show the wall.
// Landscape ones (for rooftop billboards) stay whole on their frames.
function adTexture(landscape = false) {
  const [big, small, bg, fg] = pick(AD_COPY)
  if (landscape) {
    return canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, 512, 256)
      ctx.fillStyle = fg
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '900 84px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
      ctx.fillText(big, 256, 100)
      ctx.font = '800 44px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
      ctx.fillText(small, 256, 190)
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(255,255,255,${range(0.04, 0.14)})`
        ctx.fillRect(range(0, 512), range(0, 256), range(20, 140), range(20, 100))
      }
    })
  }
  return canvasTexture(256, 512, (ctx) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 256, 512)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '900 54px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    const chars = [...big]
    chars.forEach((ch, i) => ctx.fillText(ch, 128, 70 + i * 62))
    ctx.font = '800 34px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
    ctx.fillText(small, 128, 90 + chars.length * 62)
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(255,255,255,${range(0.04, 0.14)})`
      ctx.fillRect(range(0, 256), range(0, 512), range(20, 120), range(20, 160))
    }
    // Shredded lower edge.
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.moveTo(0, 512)
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, 512 - range(40, 220))
    ctx.lineTo(256, 512)
    ctx.closePath()
    ctx.fill()
  })
}

// Giant ad hung on a facade at (x, z), w × h metres, bottom edge at y, facing yaw.
export function facadeAd(x, z, yaw, w, h, y) {
  const m = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: adTexture(), transparent: true, alphaTest: 0.5, roughness: 0.8, side: THREE.DoubleSide }), { kind: 'paint', grime: 0.6, fade: 0.3 }))
  const ad = mesh(new THREE.PlaneGeometry(w, h), m)
  ad.position.set(x, y + h / 2, z)
  ad.rotation.set(0, yaw, range(-0.02, 0.02))
  ad.userData.dynamic = true
  return ad
}

// ---------------------------------------------------------------- screens

const ADS = ['西門町', '新片上映', '電影節', '週年慶', '演唱會', '全館五折']

// Dead LED screen: a ghost of the last advert burnt into the panel, a cracked impact star,
// knocked-out modules showing black, and the module grid over it all.
function screenTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 288
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#121416'
  ctx.fillRect(0, 0, 512, 288)
  for (let i = 0; i < 4; i++) {
    const g = ctx.createRadialGradient(range(0, 512), range(0, 288), 0, range(100, 400), range(50, 250), range(150, 300))
    g.addColorStop(0, `rgba(${pick(['200,60,120', '60,140,220', '230,180,60', '90,200,160'])},0.22)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 288)
  }
  ctx.fillStyle = 'rgba(240,235,220,0.18)'
  ctx.font = '900 96px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(pick(ADS), 256, 150)
  // Missing modules.
  ctx.fillStyle = '#050506'
  for (let i = 0; i < 9; i++) ctx.fillRect(Math.floor(range(0, 8)) * 64, Math.floor(range(0, 4.5)) * 64, 64, 64)
  // Impact star.
  const cx = range(80, 430)
  const cy = range(60, 220)
  ctx.strokeStyle = 'rgba(200,205,210,0.55)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 14; i++) {
    let a = rand() * Math.PI * 2
    let x = cx
    let y = cy
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      a += range(-0.3, 0.3)
      x += Math.cos(a) * range(10, 30)
      y += Math.sin(a) * range(10, 30)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = 2
  for (let x = 0; x <= 512; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 288)
    ctx.stroke()
  }
  for (let y = 0; y <= 288; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(512, y)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * Giant street screen on a steel truss, facing local +z, w × h metres with its bottom edge
 * `lift` above the ground. A fallen one lies face-up, slewed across the ground.
 */
export function giantScreen(x, z, rotY, { w = 8, h = 4.5, lift = 6, fallen = false } = {}) {
  const g = new THREE.Group()
  const steel = cityMat('#55595c', { kind: 'metal' })
  const face = withCutaway(new THREE.MeshStandardMaterial({ map: screenTexture(), roughness: 0.35, metalness: 0.2 }))
  const back = cityMat('#2a2c2e', { kind: 'metal' })
  const panel = mesh(new THREE.BoxGeometry(w, h, 0.4), [back, back, back, back, face, back])
  const frame = new THREE.Group()
  frame.add(panel)
  for (const [fx, fy, fw, fh] of [[0, h / 2 + 0.1, w + 0.3, 0.2], [0, -h / 2 - 0.1, w + 0.3, 0.2], [w / 2 + 0.1, 0, 0.2, h], [-w / 2 - 0.1, 0, 0.2, h]]) {
    const bar = mesh(new THREE.BoxGeometry(fw, fh, 0.5), steel)
    bar.position.set(fx, fy, 0)
    frame.add(bar)
  }
  if (fallen) {
    frame.rotation.x = -Math.PI / 2 + range(0.08, 0.25)
    frame.position.y = 0.5 + Math.sin(0.15) * h * 0.5
    g.add(frame)
    g.position.set(x, 0, z)
    g.rotation.y = rotY
    addCircle(x, z, Math.min(w, h) * 0.45)
    return g
  }
  frame.position.y = lift + h / 2
  g.add(frame)
  // Lattice legs behind the screen.
  for (const lx of [-w * 0.3, w * 0.3]) {
    for (const dz of [-0.6, -1.6]) {
      const leg = mesh(new THREE.BoxGeometry(0.22, lift + h * 0.8, 0.22), steel)
      leg.position.set(lx, (lift + h * 0.8) / 2, dz)
      g.add(leg)
    }
    for (let y = 1; y < lift + h * 0.7; y += 1.6) {
      const brace = mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), steel)
      brace.position.set(lx, y + 0.7, -1.1)
      brace.rotation.x = 0.6 * (Math.round(y) % 2 ? 1 : -1)
      g.add(brace)
    }
  }
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  for (const lx of [-w * 0.3, w * 0.3]) addCircle(x + lx * c - 1.1 * s, z - lx * s - 1.1 * c, 0.7)
  return g
}
