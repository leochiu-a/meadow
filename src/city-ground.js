import * as THREE from 'three'
import { rand, range, pick } from './terrain.js'

// The district floor painted from the real street plan into one canvas: asphalt and tiled
// sidewalks along every road, the pedestrian malls in banded paving, zebra crossings at
// the junctions, then aged with grime, cracks and moss. A coarse class grid painted the
// same way answers "what ground is here" for placing buildings and weeds.

const SIZE = 4096
export const SIDEWALK = 3

// Road classes that carry traffic (asphalt + kerbed sidewalks) vs paved pedestrian ways.
export const VEHICLE = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street'])
export const MALL = new Set(['pedestrian'])
const PATHS = new Set(['footway', 'path', 'steps'])

export const GROUND = { lot: 0, road: 1, sidewalk: 2, mall: 3 }
const CLASS_COLOR = ['#000000', '#010000', '#020000', '#030000']

// Square paving tile image used as a pattern, so tiles can be turned to follow each street.
function tileImage(size, base, joint, jitter) {
  const c = document.createElement('canvas')
  c.width = c.height = size * 4
  const ctx = c.getContext('2d')
  const col = new THREE.Color()
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      col.set(base).offsetHSL(0, 0, range(-jitter, jitter))
      ctx.fillStyle = `#${col.getHexString()}`
      ctx.fillRect(i * size, j * size, size, size)
    }
  }
  ctx.strokeStyle = joint
  ctx.lineWidth = 1
  // Joints on one edge of each tile only, so the repeat seam isn't drawn twice.
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(i * size + 0.5, 0)
    ctx.lineTo(i * size + 0.5, size * 4)
    ctx.moveTo(0, i * size + 0.5)
    ctx.lineTo(size * 4, i * size + 0.5)
    ctx.stroke()
  }
  return c
}

/**
 * Paints the ground for `data` (local-metre OSM roads within data.bounds) and returns the
 * mesh, the crack polylines (where weeds take hold) and groundAt(x, z) → GROUND class.
 */
export function createCityGround(data) {
  const { minX, maxX, minZ, maxZ } = data.bounds
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  const PX = SIZE / Math.max(spanX, spanZ)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(spanX * PX)
  canvas.height = Math.round(spanZ * PX)
  const ctx = canvas.getContext('2d')
  const u = (x) => (x - minX) * PX
  const v = (z) => (z - minZ) * PX

  // Class grid at half-metre cells, drawn with the same strokes.
  const CELL = 0.5
  const cls = document.createElement('canvas')
  cls.width = Math.ceil(spanX / CELL)
  cls.height = Math.ceil(spanZ / CELL)
  const cctx = cls.getContext('2d')

  const trace = (c, scale, pts) => {
    c.beginPath()
    pts.forEach(([x, z], i) => (i ? c.lineTo((x - minX) * scale, (z - minZ) * scale) : c.moveTo((x - minX) * scale, (z - minZ) * scale)))
  }
  // Stroke (or fill, for areas) a polyline in both the painted ground and the class grid.
  const stroke = (pts, width, style, klass, area = false) => {
    for (const [c, scale, paint] of [[ctx, PX, style], [cctx, 1 / CELL, CLASS_COLOR[klass]]]) {
      c.lineCap = 'round'
      c.lineJoin = 'round'
      trace(c, scale, pts)
      if (area) {
        c.fillStyle = paint
        c.fill()
      } else {
        c.strokeStyle = paint
        c.lineWidth = width * scale
        c.stroke()
      }
    }
  }
  // Paving pattern turned to run along a road segment.
  const patterned = (img, tile, angle) => {
    const p = ctx.createPattern(img, 'repeat')
    const scale = (tile * PX) / (img.width / 4)
    p.setTransform(new DOMMatrix().rotateSelf((angle * 180) / Math.PI).scaleSelf(scale, scale))
    return p
  }
  const bySegment = (pts, fn) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      fn([pts[i], pts[i + 1]], Math.atan2(bz - az, bx - ax))
    }
  }

  // Lots: bare grimy concrete.
  ctx.fillStyle = '#57534c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  cctx.fillStyle = CLASS_COLOR[GROUND.lot]
  cctx.fillRect(0, 0, cls.width, cls.height)

  const sidewalkTile = tileImage(32, '#9a8f84', 'rgba(40,36,32,0.4)', 0.02)
  const mallTile = tileImage(32, '#8f8b84', 'rgba(30,30,30,0.4)', 0.02)
  const roads = data.roads
  // Sidewalks first so carriageways paint over them at junctions.
  for (const r of roads.filter((r) => VEHICLE.has(r.kind) && r.kind !== 'service')) {
    bySegment(r.pts, (seg, a) => stroke(seg, r.width + SIDEWALK * 2, patterned(sidewalkTile, 0.5, a), GROUND.sidewalk))
  }
  for (const r of roads.filter((r) => MALL.has(r.kind))) {
    if (r.area) stroke(r.pts, 0, patterned(mallTile, 0.6, 0), GROUND.mall, true)
    else bySegment(r.pts, (seg, a) => stroke(seg, r.width, patterned(mallTile, 0.6, a), GROUND.mall))
  }
  // Rust-red bands across the malls every few metres, under any road that crosses them.
  ctx.save()
  ctx.globalAlpha = 0.8
  ctx.strokeStyle = '#7c4a3e'
  ctx.lineWidth = 0.6 * PX
  ctx.lineCap = 'butt'
  for (const r of roads.filter((r) => MALL.has(r.kind) && !r.area)) {
    bySegment(r.pts, ([[ax, az], [bx, bz]]) => {
      const len = Math.hypot(bx - ax, bz - az)
      const nx = -(bz - az) / len
      const nz = (bx - ax) / len
      for (let t = 2; t < len; t += 4.2) {
        const cx = ax + ((bx - ax) * t) / len
        const cz = az + ((bz - az) * t) / len
        ctx.beginPath()
        ctx.moveTo(u(cx + nx * r.width * 0.5), v(cz + nz * r.width * 0.5))
        ctx.lineTo(u(cx - nx * r.width * 0.5), v(cz - nz * r.width * 0.5))
        ctx.stroke()
      }
    })
  }
  ctx.restore()

  for (const r of roads.filter((r) => PATHS.has(r.kind))) stroke(r.pts, r.width, patterned(sidewalkTile, 0.4, 0), GROUND.sidewalk)
  for (const r of roads.filter((r) => VEHICLE.has(r.kind))) stroke(r.pts, r.width, '#3d3e40', GROUND.road)

  // Aggregate speckle over the asphalt.
  for (const r of roads.filter((r) => VEHICLE.has(r.kind))) {
    bySegment(r.pts, ([[ax, az], [bx, bz]]) => {
      const len = Math.hypot(bx - ax, bz - az)
      for (let i = 0; i < len * r.width * 5; i++) {
        const t = rand()
        const s = range(-0.5, 0.5) * r.width
        const g = Math.floor(range(40, 95))
        ctx.fillStyle = `rgba(${g},${g},${g + 3},0.5)`
        ctx.fillRect(u(ax + (bx - ax) * t - ((bz - az) / len) * s), v(az + (bz - az) * t + ((bx - ax) / len) * s), PX * 0.08, PX * 0.08)
      }
    })
  }

  // Faded paint: centre lines on the bigger roads, zebra crossings at their junctions.
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.lineCap = 'butt'
  const big = roads.filter((r) => ['primary', 'secondary', 'tertiary'].includes(r.kind))
  for (const r of big) {
    ctx.strokeStyle = r.kind === 'tertiary' ? '#e9e4d6' : '#d9a63a'
    ctx.lineWidth = 0.15 * PX
    ctx.setLineDash(r.kind === 'tertiary' ? [3 * PX, 3 * PX] : [])
    trace(ctx, PX, r.pts)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // A junction is where another road's end meets a big road's line.
  const ends = []
  for (const r of roads.filter((r) => VEHICLE.has(r.kind) || MALL.has(r.kind))) ends.push(r.pts[0], r.pts[r.pts.length - 1])
  ctx.fillStyle = '#e9e4d6'
  for (const r of big) {
    bySegment(r.pts, ([[ax, az], [bx, bz]], a) => {
      const len = Math.hypot(bx - ax, bz - az)
      for (const [ex, ez] of ends) {
        const t = ((ex - ax) * (bx - ax) + (ez - az) * (bz - az)) / (len * len)
        if (t < 0.02 || t > 0.98) continue
        const px = ax + (bx - ax) * t
        const pz = az + (bz - az) * t
        if (Math.hypot(ex - px, ez - pz) > r.width * 0.5 + SIDEWALK + 1) continue
        for (const side of [-1, 1]) {
          ctx.save()
          ctx.translate(u(px + Math.cos(a) * side * 8), v(pz + Math.sin(a) * side * 8))
          ctx.rotate(a)
          for (let s = -r.width / 2 + 0.3; s < r.width / 2 - 0.2; s += 1) ctx.fillRect(-1.5 * PX, s * PX, 3 * PX, 0.5 * PX)
          ctx.restore()
        }
      }
    })
  }
  ctx.restore()

  // Ageing: grime and oil, cracks, and moss creeping along them.
  const blotch = (x, z, r, color) => {
    const g = ctx.createRadialGradient(u(x), v(z), 0, u(x), v(z), r * PX)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(u(x) - r * PX, v(z) - r * PX, r * PX * 2, r * PX * 2)
  }
  const area = spanX * spanZ
  for (let i = 0; i < area / 12; i++) blotch(range(minX, maxX), range(minZ, maxZ), range(0.5, 3), `rgba(${pick(['20,18,15', '45,38,28', '30,34,22'])},${range(0.08, 0.3)})`)
  for (let i = 0; i < area / 90; i++) blotch(range(minX, maxX), range(minZ, maxZ), range(0.3, 1.2), `rgba(8,8,10,${range(0.25, 0.5)})`)
  const cracks = []
  const crack = (x, z, len) => {
    let a = rand() * Math.PI * 2
    const pts = [[x, z]]
    for (let i = 0; i < len; i++) {
      a += range(-0.6, 0.6)
      x += Math.cos(a) * 0.22
      z += Math.sin(a) * 0.22
      pts.push([x, z])
      if (rand() < 0.08 && len > 6) crack(x, z, Math.floor(len * 0.4))
    }
    ctx.strokeStyle = `rgba(18,16,14,${range(0.45, 0.75)})`
    ctx.lineWidth = range(0.7, 1.8)
    trace(ctx, PX, pts)
    ctx.stroke()
    cracks.push(pts)
  }
  for (let i = 0; i < area / 24; i++) crack(range(minX, maxX), range(minZ, maxZ), Math.floor(range(5, 22)))
  for (const pts of cracks) for (const [x, z] of pts) if (rand() < 0.25) blotch(x, z, range(0.2, 0.7), `rgba(${pick(['62,82,30', '84,96,40', '48,66,26'])},${range(0.3, 0.6)})`)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }))
  mesh.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  mesh.receiveShadow = true
  mesh.name = 'ground'

  // Antialiased edges can read as a neighbouring class; harmless at half-metre cells.
  const pixels = cctx.getImageData(0, 0, cls.width, cls.height).data
  const groundAt = (x, z) => {
    const i = Math.floor((x - minX) / CELL)
    const j = Math.floor((z - minZ) / CELL)
    if (i < 0 || j < 0 || i >= cls.width || j >= cls.height) return GROUND.lot
    return pixels[(j * cls.width + i) * 4]
  }
  return { mesh, cracks, groundAt }
}
