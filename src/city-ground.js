import * as THREE from 'three'
import { rand, range, pick } from './terrain.js'

// The district floor from the real street plan, decades gone to meadow. A canvas holds the
// broad strokes (road paint, grime, cracks); a class grid painted with the same strokes says
// where roads and paving were. The ground shader works per pixel in world space from there:
// asphalt cracked into slabs with many gone, only scattered stone fragments left of the
// paving, earth everywhere else. overgrownAt() repeats the same tests on the CPU so grass
// grows exactly where the shader shows earth.

const SIZE = 4096
// Asphalt slab size in metres.
const SLAB = 2.2
export const SIDEWALK = 3

// Road classes that carry traffic (asphalt + kerbed sidewalks) vs paved pedestrian ways.
export const VEHICLE = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street'])
export const MALL = new Set(['pedestrian'])
const PATHS = new Set(['footway', 'path', 'steps'])

// `kept` is asphalt that cracks but never loses slabs, so painted features stay legible.
export const GROUND = { lot: 0, road: 1, sidewalk: 2, mall: 3, kept: 4 }
const CLASS_COLOR = ['#000000', '#010000', '#020000', '#030000', '#040000']

/**
 * Paints the ground for `data` (local-metre OSM roads within data.bounds). wild(x, z) in
 * 0..1 says how far nature has taken a spot back; it decides how much of the asphalt has
 * broken up. rainbow { x, z, angle, length, width } paints the six-colour crossing there.
 * Returns the mesh, the crack polylines, groundAt(x, z) → GROUND class and
 * overgrownAt(x, z) → 0..1 how much earth shows (1 = earth, where grass grows).
 */
export function createCityGround(data, { wild, rainbow }) {
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

  // Class grid at quarter-metre cells, drawn with the same strokes.
  const CELL = 0.25
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
  const bySegment = (pts, fn) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      fn([pts[i], pts[i + 1]], Math.atan2(bz - az, bx - ax))
    }
  }

  // Lots: open earth.
  ctx.fillStyle = '#4a4432'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  cctx.fillStyle = CLASS_COLOR[GROUND.lot]
  cctx.fillRect(0, 0, cls.width, cls.height)

  const roads = data.roads
  // Sidewalks first so carriageways paint over them at junctions.
  for (const r of roads.filter((r) => VEHICLE.has(r.kind) && r.kind !== 'service')) {
    stroke(r.pts, r.width + SIDEWALK * 2, '#9a8f84', GROUND.sidewalk)
  }
  for (const r of roads.filter((r) => MALL.has(r.kind))) {
    stroke(r.pts, r.width, '#9a8f84', GROUND.mall, r.area)
  }

  for (const r of roads.filter((r) => PATHS.has(r.kind))) stroke(r.pts, r.width, '#9a8f84', GROUND.sidewalk)
  for (const r of roads.filter((r) => VEHICLE.has(r.kind))) stroke(r.pts, r.width, '#3d3e40', GROUND.road)

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

  // The rainbow crossing: six faded bands along the walking direction, scuffed through.
  if (rainbow) {
    const { x, z, angle, length, width } = rainbow
    const bands = ['#d8463c', '#e8873a', '#e8c63e', '#4f9a4a', '#3c6fb4', '#7c4a9a']
    const corners = [[-length / 2, -width / 2], [length / 2, -width / 2], [length / 2, width / 2], [-length / 2, width / 2]]
    const rot = ([a, b]) => [x + Math.cos(angle) * a - Math.sin(angle) * b, z + Math.sin(angle) * a + Math.cos(angle) * b]
    stroke([...corners.map(rot), rot(corners[0])], 0, '#3d3e40', GROUND.kept, true)
    ctx.save()
    ctx.translate(u(x), v(z))
    ctx.rotate(angle)
    ctx.globalAlpha = 0.62
    bands.forEach((c, i) => {
      ctx.fillStyle = c
      ctx.fillRect((-length / 2) * PX, (-width / 2 + (i * width) / 6) * PX, length * PX, (width / 6) * PX)
    })
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(0,0,0,${range(0.15, 0.55)})`
      ctx.beginPath()
      ctx.ellipse(range(-length / 2, length / 2) * PX, range(-width / 2, width / 2) * PX, range(0.1, 0.8) * PX, range(0.05, 0.3) * PX, rand() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    // Restore asphalt under the scuffs.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#3d3e40'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

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
  // How wild each metre of the district has gone, for the shader to decide which asphalt
  // slabs have broken away (smooth noise, so a coarse grid is plenty).
  const pixels = cctx.getImageData(0, 0, cls.width, cls.height).data
  const wildW = Math.ceil(spanX)
  const wildH = Math.ceil(spanZ)
  const wildGrid = new Uint8Array(wildW * wildH)
  for (let j = 0; j < wildH; j++) for (let i = 0; i < wildW; i++) wildGrid[j * wildW + i] = Math.round(255 * wild(minX + i + 0.5, minZ + j + 0.5))
  const wildTex = new THREE.DataTexture(wildGrid, wildW, wildH, THREE.RedFormat)
  wildTex.magFilter = wildTex.minFilter = THREE.LinearFilter
  wildTex.needsUpdate = true
  const classTex = new THREE.CanvasTexture(cls)
  classTex.magFilter = classTex.minFilter = THREE.NearestFilter
  classTex.generateMipmaps = false
  // Rows run with +z as in the canvas; don't flip them like an image.
  classTex.flipY = false
  const material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  material.onBeforeCompile = (shader) => groundShader(shader, classTex, wildTex, data.bounds, gridAngle(roads))
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spanX, spanZ).rotateX(-Math.PI / 2), material)
  mesh.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  mesh.receiveShadow = true
  mesh.name = 'ground'

  // Antialiased edges can read as a neighbouring class; harmless at quarter-metre cells.
  const cellOf = (x, z) => {
    const i = Math.floor((x - minX) / CELL)
    const j = Math.floor((z - minZ) / CELL)
    return i < 0 || j < 0 || i >= cls.width || j >= cls.height ? -1 : j * cls.width + i
  }
  const groundAt = (x, z) => {
    const c = cellOf(x, z)
    return c < 0 ? GROUND.lot : pixels[c * 4]
  }
  // The same tests as the shader: 1 where earth shows (open lots, lost paving tiles, gone
  // asphalt slabs), falling off across the cracks between slabs.
  const angle = gridAngle(roads)
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const overgrownAt = (x, z) => {
    const klass = groundAt(x, z)
    if (klass === GROUND.lot) return 1
    if (klass === GROUND.sidewalk || klass === GROUND.mall) {
      const ti = Math.floor((ca * x + sa * z) / TILE)
      const tj = Math.floor((-sa * x + ca * z) / TILE)
      const kept = tileLoss(wild(x, z), valueNoise((ti * TILE) / PATCH, (tj * TILE) / PATCH), hashCell(ti, tj)) <= KEEP && hashCell(ti + 23, tj - 11) >= 0.35
      return kept ? 0 : 1
    }
    const { edge, id, seed } = voronoi(...warp(x / SLAB, z / SLAB))
    if (klass === GROUND.road && hashCell(id[0], id[1]) < goneChance(wild(seed[0] * SLAB, seed[1] * SLAB))) return 1
    return 1 - smoothstepJS(0.02, 0.05, edge)
  }
  return { mesh, cracks, groundAt, overgrownAt }
}

// The district's dominant street direction, so one paving grid lines up with most streets:
// length-weighted mean of segment angles folded to a quarter turn.
function gridAngle(roads) {
  let c = 0
  let s = 0
  for (const r of roads) {
    if (!VEHICLE.has(r.kind) && !MALL.has(r.kind)) continue
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i]
      const [bx, bz] = r.pts[i + 1]
      const len = Math.hypot(bx - ax, bz - az)
      const a = Math.atan2(bz - az, bx - ax) * 4
      c += len * Math.cos(a)
      s += len * Math.sin(a)
    }
  }
  return Math.atan2(s, c) / 4
}

// Per-pixel ground keyed on the class grid: earth on open lots, stone fragments on the old
// paving (one tile grid along the district's streets), broken asphalt slabs on the roads.
function groundShader(shader, classTex, wildTex, { minX, maxX, minZ, maxZ }, angle) {
  shader.uniforms.uClass = { value: classTex }
  shader.uniforms.uWild = { value: wildTex }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec2 vGroundXZ;
      uniform sampler2D uClass;
      uniform sampler2D uWild;
      // Integer cell hash, bit-identical to hashCell() in JS.
      float cellHash(vec2 c) {
        uint h = uint(int(c.x)) * 374761393u + uint(int(c.y)) * 668265263u;
        h = (h ^ (h >> 13u)) * 1274126177u;
        h ^= h >> 16u;
        return float(h) / 4294967296.0;
      }
      // Value noise on the integer hash lattice, matching valueNoise() in JS.
      float latticeNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = p - i;
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(cellHash(i), cellHash(i + vec2(1, 0)), f.x), mix(cellHash(i + vec2(0, 1)), cellHash(i + vec2(1, 1)), f.x), f.y);
      }
      // Matches tileLoss() in JS: wildness, a patch field and a per-tile jitter.
      float tileLoss(float wildness, float patchiness, float jitter) {
        return smoothstep(${GONE_FROM.toFixed(2)}, ${GONE_TO.toFixed(2)}, wildness) * 0.6 + patchiness * 0.55 + (jitter - 0.5) * 0.2;
      }
      // Bend slab coordinates so cracks wander instead of running ruler-straight.
      vec2 warp(vec2 p) {
        return p + (vec2(latticeNoise(p * 0.7), latticeNoise(p * 0.7 + 31.0)) - 0.5) * ${WARP.toFixed(2)};
      }
      // Voronoi in slab units: x = distance to the nearest border, yz = nearest cell, w unused.
      vec4 slabs(vec2 p, out vec2 seed) {
        vec2 ip = floor(p);
        float d1 = 1e9;
        float d2 = 1e9;
        vec2 id = ip;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = ip + vec2(float(i), float(j));
          vec2 s = c + 0.15 + 0.7 * vec2(cellHash(c), cellHash(c + vec2(19.0, -4.0)));
          float d = length(p - s);
          if (d < d1) { d2 = d1; d1 = d; id = c; seed = s; } else if (d < d2) { d2 = d; }
        }
        return vec4((d2 - d1) * 0.5, id, 0.0);
      }
      float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
      }`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec2 uv = vec2((vGroundXZ.x - ${minX.toFixed(2)}) / ${(maxX - minX).toFixed(2)}, (vGroundXZ.y - ${minZ.toFixed(2)}) / ${(maxZ - minZ).toFixed(2)});
        float klass = floor(texture2D(uClass, uv).r * 255.0 + 0.5);
        float ca = ${Math.cos(angle).toFixed(5)};
        float sa = ${Math.sin(angle).toFixed(5)};
        vec2 p = vec2(ca * vGroundXZ.x + sa * vGroundXZ.y, -sa * vGroundXZ.x + ca * vGroundXZ.y);
        float soilN = gNoise(vGroundXZ * 1.7) * 0.6 + gNoise(vGroundXZ * 6.0) * 0.4;
        vec3 soil = mix(vec3(0.11, 0.1, 0.07), vec3(0.17, 0.24, 0.08), smoothstep(0.35, 0.75, soilN));
        float wildHere = texture2D(uWild, uv).r;
        if (klass > 1.5 && klass < 3.5) {
          // Only scattered fragments of the old stone paving survive: each one chipped,
          // shrunk back from its neighbours and stained, earth all around.
          vec2 q = p / ${TILE.toFixed(2)};
          vec2 tileId = floor(q);
          float kept = step(tileLoss(wildHere, latticeNoise(tileId * ${(TILE / PATCH).toFixed(3)}), cellHash(tileId)), ${KEEP.toFixed(2)})
            * step(0.35, cellHash(tileId + vec2(23.0, -11.0)));
          vec2 f = abs(fract(q) - 0.5);
          float chip = gNoise(vGroundXZ * 7.0 + tileId * 3.1) * 0.22;
          float half_ = 0.24 + cellHash(tileId + vec2(7.0, 3.0)) * 0.2 - chip;
          float aa2 = fwidth(q.x) * 1.5;
          float stone = kept * (1.0 - smoothstep(half_ - aa2, half_, max(f.x, f.y)));
          float tone = 0.45 + cellHash(tileId + vec2(1.0, 9.0)) * 0.35;
          vec3 stoneColor = mix(vec3(0.42, 0.4, 0.35) * tone, soil, 0.25) * (0.85 + 0.25 * gNoise(vGroundXZ * 14.0));
          diffuseColor.rgb = mix(soil, stoneColor, stone);
        } else if (klass < 0.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, soil, 0.7);
        } else {
          float grain = gHash(floor(vGroundXZ * 22.0)) * 0.6 + gNoise(vGroundXZ * 3.0) * 0.4;
          diffuseColor.rgb *= 0.86 + 0.26 * grain;
          // Cracked into slabs; slabs gone where the street has gone wild, soil and turf
          // showing through the cracks and the gaps.
          vec2 seed;
          vec4 v = slabs(warp(vGroundXZ / ${SLAB.toFixed(2)}), seed);
          vec2 seedUv = vec2((seed.x * ${SLAB.toFixed(2)} - ${minX.toFixed(2)}) / ${(maxX - minX).toFixed(2)}, (seed.y * ${SLAB.toFixed(2)} - ${minZ.toFixed(2)}) / ${(maxZ - minZ).toFixed(2)});
          float wildness = texture2D(uWild, seedUv).r;
          float gone = step(klass, 3.5) * step(cellHash(v.yz), ${GONE_BASE.toFixed(2)} + smoothstep(${GONE_FROM.toFixed(2)}, ${GONE_TO.toFixed(2)}, wildness) * ${GONE_WILD.toFixed(2)});
          float aa = fwidth(v.x);
          float crack = 1.0 - smoothstep(0.02 - aa, 0.05 + aa, v.x);
          float rim = 1.0 - smoothstep(0.05, 0.14, v.x);
          diffuseColor.rgb *= 1.0 - rim * 0.25;
          diffuseColor.rgb = mix(diffuseColor.rgb, soil, max(crack, gone));
        }
      }`,
    )
}

// Integer cell hash, bit-identical to cellHash() in the ground shader.
function hashCell(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

// A third of the slabs gone anywhere; nearly all of them where the street has gone wild.
const GONE_BASE = 0.3
const GONE_WILD = 0.68
const GONE_FROM = 0.3
const GONE_TO = 0.6
// Paving tiles (TILE m) were lost in patches about PATCH m across.
const TILE = 0.5
const PATCH = 2.5
const tileLoss = (wildness, patch, jitter) => smoothstepJS(GONE_FROM, GONE_TO, wildness) * 0.6 + patch * 0.55 + (jitter - 0.5) * 0.2
// Tiles with a loss score under KEEP survive as fragments; the rest are gone.
const KEEP = 0.24
const goneChance = (wildness) => GONE_BASE + smoothstepJS(GONE_FROM, GONE_TO, wildness) * GONE_WILD
// How far slab coordinates are bent, in slab units.
const WARP = 0.6

function valueNoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let fx = x - ix
  let fy = y - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const a = hashCell(ix, iy) + (hashCell(ix + 1, iy) - hashCell(ix, iy)) * fx
  const b = hashCell(ix, iy + 1) + (hashCell(ix + 1, iy + 1) - hashCell(ix, iy + 1)) * fx
  return a + (b - a) * fy
}
const warp = (x, y) => [x + (valueNoise(x * 0.7, y * 0.7) - 0.5) * WARP, y + (valueNoise(x * 0.7 + 31, y * 0.7 + 31) - 0.5) * WARP]

const smoothstepJS = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// Cellular noise in slab units: distance to the nearest border, the nearest cell and its seed.
function voronoi(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let d1 = Infinity
  let d2 = Infinity
  let id = [0, 0]
  let seed = [0, 0]
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i
      const cy = iy + j
      const sx = cx + 0.15 + 0.7 * hashCell(cx, cy)
      const sy = cy + 0.15 + 0.7 * hashCell(cx + 19, cy - 4)
      const d = Math.hypot(x - sx, y - sy)
      if (d < d1) {
        d2 = d1
        d1 = d
        id = [cx, cy]
        seed = [sx, sy]
      } else if (d < d2) d2 = d
    }
  }
  return { edge: (d2 - d1) / 2, id, seed }
}
