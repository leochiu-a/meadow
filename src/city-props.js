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

function exitSignTexture(number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#2b5d9c'
  ctx.fillRect(0, 0, 512, 128)
  ctx.fillStyle = '#f4f4f0'
  ctx.font = '800 58px "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText('捷運西門站', 28, 66)
  ctx.beginPath()
  ctx.arc(436, 64, 46, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2b5d9c'
  ctx.font = '900 72px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(String(number), 436, 68)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// MRT exit canopy: steel frame and glass, most panes gone, stairs dropping into darkness.
// Its long axis runs along local z; the signed end faces +z.
export function mrtExit(x, z, rotY, { number = 6, length = 9 } = {}) {
  const g = new THREE.Group()
  const steel = cityMat('#7c8286', { kind: 'metal' })
  const glass = withCutaway(new THREE.MeshStandardMaterial({ color: '#9fb8c0', transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.2 }))
  const W = 4
  const L = length
  const H = 3.2
  for (const sx of [-1, 1]) {
    for (let k = 0; k <= 3; k++) {
      const post = mesh(new THREE.BoxGeometry(0.14, H, 0.14), steel)
      post.position.set((sx * W) / 2, H / 2, -L / 2 + (k / 3) * L)
      g.add(post)
    }
  }
  const roof = mesh(new THREE.BoxGeometry(W + 0.4, 0.18, L + 0.4), steel)
  roof.position.y = H + 0.1
  roof.rotation.x = 0.05
  g.add(roof)
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      if (rand() < 0.55) continue
      const pane = mesh(new THREE.BoxGeometry(0.03, H - 0.4, L / 3 - 0.2), glass)
      pane.position.set((sx * W) / 2, H / 2, -L / 2 + (k + 0.5) * (L / 3))
      pane.userData.dynamic = true
      g.add(pane)
    }
  }
  const pit = mesh(new THREE.BoxGeometry(W - 0.4, 0.05, L - 1), cityMat('#0e0d0c', { kind: 'paint', grime: 0.2 }))
  pit.position.y = 0.03
  g.add(pit)
  for (let i = 0; i < 8; i++) {
    const step = mesh(new THREE.BoxGeometry(W - 0.5, 0.06, 0.4), cityMat('#6a6862', { kind: 'concrete' }))
    step.position.set(0, 0.06, L / 2 - 1.2 - i * ((L - 2) / 8))
    g.add(step)
  }
  // Station sign on the front beam: 捷運西門站 with the exit number in a white disc.
  const signFace = withCutaway(weathered(new THREE.MeshStandardMaterial({ map: exitSignTexture(number), roughness: 0.6 }), { kind: 'paint', fade: 0.3 }))
  const edge = cityMat('#2b5d9c', { kind: 'paint', fade: 0.3 })
  const sign = mesh(new THREE.BoxGeometry(3.2, 0.8, 0.14), [edge, edge, edge, edge, signFace, edge])
  sign.position.set(0, H - 0.5, L / 2 + 0.1)
  sign.rotation.z = 0.06
  g.add(sign)
  g.position.set(x, 0, z)
  g.rotation.y = rotY
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  addSegment(x - (L / 2) * s, z - (L / 2) * c, x + (L / 2) * s, z + (L / 2) * c, W / 2 + 0.2)
  return g
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
