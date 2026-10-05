import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { heightAt, rand, range, pick, noise } from './terrain.ts'
import { addCircle, addSegment } from './collision.ts'
import { brickMaterial } from './bricks.ts'
import { createBush, createIvy, type IvyStrand } from './vegetation.ts'
import { graffiti } from './graffiti.ts'
import { weathered } from './weathering.ts'
import type { Bounds, XZ } from './walkmap.ts'

const WOOD = ['#a8683a', '#b97a45', '#94592f']
const WOODISH = new Set([
  ...WOOD,
  '#b88a52', '#c49a62', '#9a6a3e', '#8a5a34', '#7a5638', '#7a5232', '#7a4e2c', '#6e4f35', '#6b4a2e',
  '#6b4428', '#5e3c22', '#5a4a36', '#5a3d26', '#5a3b26', '#4a3423', '#3a2616',
])
const hsl = { h: 0, s: 0, l: 0 }
// Every prop material is weathered by kind: lights stay clean, metal rusts, timber gets
// grain, and loud plastics fade harder in the sun.
const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra })
  if (extra.emissive) return m
  if (extra.metalness) return weathered(m, { kind: 'metal' })
  if (WOODISH.has(color)) return weathered(m, { kind: 'wood' })
  m.color.getHSL(hsl)
  return weathered(m, { fade: hsl.s > 0.6 ? 0.3 : 0.15 })
}
const shadowed = <T extends THREE.Object3D>(m: T): T => {
  m.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  return m
}
const place = <T extends THREE.Object3D>(obj: T, x: number, z: number, rotY = 0, lift = 0): T => {
  obj.position.set(x, heightAt(x, z) + lift, z)
  obj.rotation.y = rotY
  return obj
}


// Weathered stone: grime pooling toward each slab's edges, moss creeping in from the
// joints and in patches that thicken toward the paving's open sides (+z, -x, +x).
function flagstoneMaterial(area: Bounds) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStoneLocal;\nvarying vec3 vStoneW;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvStoneLocal = position;\nvStoneW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vStoneLocal;
        varying vec3 vStoneW;
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sHash(i), sHash(i + vec2(1, 0)), f.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 w = vStoneW.xz;
        float edge = max(abs(vStoneLocal.x), abs(vStoneLocal.z)) * 2.0;
        float grain = sNoise(w * 3.0) * 0.6 + sNoise(w * 11.0) * 0.4;
        // Grime: broad dark stains plus dirt collecting near the slab edges.
        float stain = smoothstep(0.45, 0.85, sNoise(w * 0.7 + 5.0));
        diffuseColor.rgb *= 0.88 + 0.2 * grain;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.17, 0.12), stain * 0.45 + smoothstep(0.75, 1.0, edge) * 0.35);
        // Moss: from the joints inward, heavier near the meadow (+z) and in noise patches.
        float open = smoothstep(${(area.maxZ - 6).toFixed(2)}, ${area.maxZ.toFixed(2)}, w.y) + smoothstep(${(area.minX + 4).toFixed(2)}, ${area.minX.toFixed(2)}, w.x) + smoothstep(${(area.maxX - 4).toFixed(2)}, ${area.maxX.toFixed(2)}, w.x);
        float patchN = sNoise(w * 0.45 + 17.0);
        float moss = smoothstep(0.55, 0.8, edge * 0.55 + grain * 0.35 + patchN * 0.45 + open * 0.35 - 0.25);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.36, 0.1) * (0.75 + 0.5 * grain), moss * 0.9);`,
      )
  }
  m.customProgramCacheKey = () => `flagstone-${area.minX},${area.maxX},${area.maxZ}`
  return m
}

// Worn flagstone paving over area { minX, maxX, minZ, maxZ }: courses of large flat slabs
// of random width with tight joints, ragged where vegetation eats into the open sides.
export function cobblestones(area: Bounds) {
  const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06)
  const depth = 0.95
  const rows = Math.floor((area.maxZ - area.minZ) / depth)
  const mesh = new THREE.InstancedMesh(geo, flagstoneMaterial(area), rows * 40)
  const d = new THREE.Object3D()
  const c = new THREE.Color()
  let n = 0
  for (let j = 0; j < rows; j++) {
    const z = area.minZ + (j + 0.5) * depth
    let x = area.minX - range(0, 0.8)
    while (x < area.maxX) {
      const w = range(0.75, 1.7)
      const cx = x + w / 2
      x += w
      if (cx > area.maxX - 0.3) continue
      // Ragged edge where the meadow eats into the stones, plus the odd missing slab.
      const edge = Math.min(cx - area.minX, area.maxX - cx, area.maxZ - z)
      if (edge < 2.2 && rand() > edge / 2.2 + noise.noise(cx * 0.6, z * 0.6) * 0.3) continue
      if (rand() < 0.04) continue
      d.position.set(cx, 0.0, z + range(-0.03, 0.03))
      d.rotation.set(range(-0.02, 0.02), range(-0.04, 0.04), range(-0.02, 0.02))
      d.scale.set(w - range(0.05, 0.12), 0.08, depth - range(0.05, 0.12))
      d.updateMatrix()
      mesh.setMatrixAt(n, d.matrix)
      const v = range(0.2, 0.29) * (0.92 + 0.16 * (noise.noise(cx * 0.15, z * 0.15) * 0.5 + 0.5))
      c.setRGB(v * 0.98, v * 0.98, v * 1.03)
      mesh.setColorAt(n++, c)
    }
  }
  mesh.count = n
  mesh.receiveShadow = true
  return mesh
}

// Fallen leaves and pebbles drifted into clusters over area { minX, maxX, minZ, maxZ }.
export function litter(blocked: (x: number, z: number) => boolean, area: Bounds) {
  const leafGeo = new THREE.CircleGeometry(0.045, 5).scale(1, 1.6, 1).rotateX(-Math.PI / 2)
  const pebbleGeo = new THREE.DodecahedronGeometry(0.06, 0)
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), 2500)
  const pebbles = new THREE.InstancedMesh(pebbleGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), 1500)
  const d = new THREE.Object3D()
  const c = new THREE.Color()
  let nl = 0
  let np = 0
  for (let tries = 0; tries < 60000 && (nl < 2500 || np < 1500); tries++) {
    const x = range(area.minX, area.maxX)
    const z = range(area.minZ, area.maxZ)
    if (blocked(x, z)) continue
    // Debris drifts into clusters rather than spreading evenly.
    const drift = noise.noise(x * 0.35 + 50, z * 0.35) * 0.5 + 0.5
    if (rand() > drift ** 4 * 0.6) continue
    const y = heightAt(x, z) + 0.06
    if (rand() < 0.65 && nl < 2500) {
      d.position.set(x, y + rand() * 0.01, z)
      d.rotation.set(range(-0.3, 0.3), rand() * 6.28, range(-0.3, 0.3))
      d.scale.setScalar(range(0.6, 1.3))
      d.updateMatrix()
      leaves.setMatrixAt(nl, d.matrix)
      c.set(pick(['#8a6a34', '#7a4a2a', '#9a8040', '#5e4a2a', '#6f7a34'])).offsetHSL(0, 0, range(-0.05, 0.05))
      leaves.setColorAt(nl++, c)
    } else if (np < 1500) {
      d.position.set(x, y - 0.03, z)
      d.rotation.set(rand() * 6, rand() * 6, rand() * 6)
      d.scale.set(range(0.4, 1.2), range(0.3, 0.6), range(0.4, 1.2))
      d.updateMatrix()
      pebbles.setMatrixAt(np, d.matrix)
      const v = range(0.3, 0.5)
      c.setRGB(v, v * 0.96, v * 0.9)
      pebbles.setColorAt(np++, c)
    }
  }
  leaves.count = nl
  pebbles.count = np
  leaves.receiveShadow = true
  pebbles.receiveShadow = true
  const g = new THREE.Group()
  g.add(leaves, pebbles)
  return g
}

const brickBox = (w: number, h: number, d: number, color: string) => {
  const geo = new THREE.BoxGeometry(w, h, d)
  setMetreUVs(geo, w, h, d)
  return new THREE.Mesh(geo, brickMaterial(color))
}

// Arch outline: straight jambs up to `spring`, then a semicircle.
function archPath<P extends THREE.Path>(path: P, cx: number, halfW: number, spring: number, bottom = 0): P {
  path.moveTo(cx - halfW, bottom)
  path.lineTo(cx + halfW, bottom)
  path.lineTo(cx + halfW, spring)
  path.absarc(cx, spring, halfW, 0, Math.PI, false)
  path.lineTo(cx - halfW, bottom)
  return path
}

// Bush lifted onto a roof or ledge: built at the origin, then placed in group space.
function perch(g: THREE.Object3D, x: number, y: number, z: number, size: number) {
  const b = createBush(0, 0, size, false)
  b.position.set(x, y, z)
  g.add(b)
}

/**
 * Overgrown brick shop-house edging the plaza: a facade with real arched openings into a
 * dark interior, a roof gone to scrub, ivy hanging down the front.
 * opts.door: index of the arch with a blue-painted frame and doors; opts.railing: index of
 * the arch closed by iron bars; opts.pergola: brick-posted shelter with a sign out front;
 * opts.tags: piers between arches to tag; opts.piece: bubble-letter piece on the right wall.
 */
export interface CottageOptions {
  w?: number
  d?: number
  h?: number
  rotY?: number
  door?: number
  railing?: number
  pergola?: boolean
  bench?: boolean
  tags?: number[]
  piece?: boolean
}

export function cottage(x: number, z: number, { w = 6, d = 4.5, h = 4.2, rotY = 0, door = -1, railing = -1, pergola = false, bench = false, tags = [], piece = false }: CottageOptions = {}) {
  const g = new THREE.Group()
  const color = pick(['#94503c', '#8c4a38', '#9a5642'])
  const t = 0.35
  const back = brickBox(w, h, t, color)
  back.position.set(0, h / 2, -d / 2 + t / 2)
  const left = brickBox(t, h, d, color)
  left.position.set(-w / 2 + t / 2, h / 2, 0)
  const right = left.clone()
  right.position.x = w / 2 - t / 2
  g.add(back, left, right)

  // Facade with arched openings cut through it.
  const archCount = Math.max(2, Math.round(w / 2.1))
  const halfW = Math.min(0.7, (w / archCount) * 0.32)
  const spring = h * 0.56
  const facade = new THREE.Shape()
  facade.moveTo(-w / 2, -0.3)
  facade.lineTo(w / 2, -0.3)
  facade.lineTo(w / 2, h)
  facade.lineTo(-w / 2, h)
  facade.closePath()
  const centres = []
  for (let i = 0; i < archCount; i++) {
    const ax = (i + 0.5 - archCount / 2) * (w / archCount)
    centres.push(ax)
    facade.holes.push(archPath(new THREE.Path(), ax, halfW, spring, 0.02))
  }
  const front = new THREE.Mesh(new THREE.ExtrudeGeometry(facade, { depth: t, bevelEnabled: false, curveSegments: 16 }), brickMaterial(color))
  front.position.z = d / 2 - t
  g.add(front)

  // Dark interior: an inverted box so only its inside faces show through the arches.
  const inside = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * t - 0.06, h - 0.06, d - 2 * t - 0.06), new THREE.MeshBasicMaterial({ color: '#120d0a', side: THREE.BackSide }))
  // Inset from the walls and lifted off the terrain so no face z-fights.
  inside.position.y = h / 2 + 0.04
  g.add(inside)

  centres.forEach((ax, i) => {
    // Brick voussoir ring proud of the wall.
    const ring = new THREE.Shape()
    ring.absarc(0, 0, halfW + 0.16, 0, Math.PI, false)
    ring.absarc(0, 0, halfW, Math.PI, 0, true)
    const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 16 }), brickMaterial('#7e4636'))
    trim.position.set(ax, spring, d / 2)
    g.add(trim)
    if (i === door) {
      const frame = new THREE.Shape()
      archPath(frame, 0, halfW, spring - 0.02, 0)
      frame.holes.push(archPath(new THREE.Path(), 0, halfW - 0.1, spring - 0.02, 0.02))
      const blue = mat('#3f78a8', { roughness: 0.6 })
      const f = new THREE.Mesh(new THREE.ExtrudeGeometry(frame, { depth: 0.12, bevelEnabled: false, curveSegments: 16 }), blue)
      f.position.set(ax, 0.02, d / 2 - t * 0.6)
      g.add(f)
      // One leaf swung open, one ajar.
      for (const [side, open] of [[-1, 1.2], [1, 0.25]]) {
        const leaf = new THREE.Group()
        const panel = new THREE.Mesh(new THREE.BoxGeometry(halfW - 0.1, spring + 0.1, 0.05), mat('#2f5f8a', { roughness: 0.7 }))
        panel.position.set((-side * (halfW - 0.1)) / 2, (spring + 0.1) / 2, 0)
        leaf.add(panel)
        leaf.position.set(ax + side * (halfW - 0.1), 0.02, d / 2 - t - 0.05)
        leaf.rotation.y = side * open
        g.add(leaf)
      }
    } else if (i === railing) {
      const iron = mat('#1e2226', { metalness: 0.4, roughness: 0.5 })
      for (let k = 0; k <= 8; k++) {
        const bx = ax - halfW + (k / 8) * halfW * 2
        const bh = spring + Math.sqrt(Math.max(0, halfW ** 2 - (bx - ax) ** 2)) - 0.05
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, bh, 4), iron)
        bar.position.set(bx, bh / 2, d / 2 - t / 2)
        g.add(bar)
      }
      for (const ry of [0.15, spring * 0.6]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, 0.04, 0.03), iron)
        rail.position.set(ax, ry, d / 2 - t / 2)
        g.add(rail)
      }
    } else if (rand() < 0.6) {
      // Warm glow deep inside.
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.22), mat('#ffcf7a', { emissive: '#ffb347', emissiveIntensity: 1.4 }))
      glow.position.set(ax + range(-0.2, 0.2), 1.0, -d / 2 + t + 0.02)
      g.add(glow)
    }
  })

  // Spray paint on the piers between arches, sized to stay on the brick.
  const pier = w / archCount - 2 * halfW
  for (const i of tags) {
    if (i < 0 || i >= archCount - 1) continue
    const tag = graffiti(pier * 0.95, 'tag', 1)
    tag.position.set((centres[i] + centres[i + 1]) / 2, range(1.1, 1.5), d / 2 + 0.015)
    g.add(tag)
  }
  if (piece) {
    const art = graffiti(Math.min(d * 0.8, 3), 'piece')
    art.position.set(w / 2 + 0.015, 1.3, range(-0.3, 0.3))
    art.rotation.y = Math.PI / 2
    g.add(art)
  }

  // Crumbling parapet: a cornice with a few dropped courses, the roof gone to scrub.
  const cornice = brickBox(w + 0.25, 0.22, d + 0.25, '#7e4636')
  cornice.position.y = h + 0.11
  g.add(cornice)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.45, d - 0.1), mat('#4f6e2c'))
  roof.position.y = h + 0.03
  g.add(roof)
  const roofBushes = Math.round(w * 0.9)
  for (let i = 0; i < roofBushes; i++) {
    perch(g, range(-w / 2 + 0.4, w / 2 - 0.4), h + 0.4, range(-d / 2 + 0.4, d / 2 - 0.2) + (i % 3 === 0 ? d * 0.35 : 0), range(0.6, 1.0))
  }
  // Ivy curtains spilling over the cornice.
  const strands: IvyStrand[] = []
  for (let i = 0; i < Math.round(w / 1.6); i++) {
    const vx = range(-w / 2 + 0.3, w / 2 - 0.3)
    strands.push({ from: [vx, h + 0.15, d / 2 + 0.12], to: [vx + range(-0.2, 0.2), h - range(0.8, 2.2), d / 2 + 0.1], leaves: 45, spread: 0.2 })
  }
  g.add(createIvy(strands))

  if (pergola) {
    const pz = d / 2 + 1.8
    for (const px of [-w * 0.38, w * 0.38]) {
      const post = brickBox(0.42, 2.9, 0.42, color)
      post.position.set(px, 1.45, pz)
      g.add(post)
    }
    const wood = mat('#6b4a2e')
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 0.18, 0.22), wood)
    beam.position.set(0, 2.95, pz)
    g.add(beam)
    for (let i = 0; i < 7; i++) {
      const joist = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.1), wood)
      joist.position.set((i / 6 - 0.5) * w * 0.8, 3.08, d / 2 + 0.9)
      joist.rotation.x = -0.1
      g.add(joist)
    }
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.1, 2.2), mat('#5a4a36'))
    slab.position.set(0, 3.18, d / 2 + 0.9)
    slab.rotation.x = -0.1
    g.add(slab)
    for (let i = 0; i < 5; i++) perch(g, (i / 4 - 0.5) * w * 0.75, 3.15, d / 2 + range(0.4, 1.6), range(0.55, 0.8))
    // Faded blue sign with a white swoosh, hung from the beam.
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.38, 0.05), mat('#5c9ccc', { roughness: 0.6 }))
    sign.position.set(w * 0.12, 2.68, pz + 0.12)
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 4, 12, Math.PI), mat('#f2f4f6'))
    mark.position.set(w * 0.12 - 0.2, 2.64, pz + 0.15)
    g.add(sign, mark)
  }
  if (bench) {
    const stone = mat('#8a8c88', { roughness: 0.95 })
    const slab = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.12, 0.5, 2, 0.03), stone)
    slab.position.set(w * 0.25, 0.5, d / 2 + 0.45)
    g.add(slab)
    for (const sx of [-0.5, 0.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.4), stone)
      leg.position.set(w * 0.25 + sx, 0.22, d / 2 + 0.45)
      g.add(leg)
    }
    // A cluster of lit candles.
    const wax = mat('#f2e6c8')
    const flame = mat('#ffd27a', { emissive: '#ffb347', emissiveIntensity: 4 })
    for (let i = 0; i < 9; i++) {
      const ch = range(0.08, 0.2)
      const cx = w * 0.25 + range(-0.5, 0.5)
      const cz = d / 2 + 0.45 + range(-0.15, 0.15)
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ch, 8), wax)
      candle.position.set(cx, 0.56 + ch / 2, cz)
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4).scale(1, 1.8, 1), flame)
      fl.position.set(cx, 0.56 + ch + 0.035, cz)
      g.add(candle, fl)
    }
  }

  place(g, x, z, rotY)
  g.position.y = 0
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  addSegment(x - (w / 2) * cos, z + (w / 2) * sin, x + (w / 2) * cos, z - (w / 2) * sin, d / 2 + 0.3)
  if (pergola) {
    for (const px of [-w * 0.38, w * 0.38]) {
      const pz = d / 2 + 1.8
      addCircle(x + px * cos + pz * sin, z - px * sin + pz * cos, 0.35)
    }
  }
  return shadowed(g)
}

// Metre-based UVs on a box so the brick shader keeps a constant brick size.
export function setMetreUVs(geo: THREE.BufferGeometry, w: number, h: number, d: number) {
  const p = geo.attributes.position
  const n = geo.attributes.normal
  const uv = geo.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + w / 2
    const y = p.getY(i) + h / 2
    const z = p.getZ(i) + d / 2
    if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, z, y)
    else if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, x, y)
    else uv.setXY(i, x, z + h)
  }
}

// Small timber shed: vertical boards of slightly different tones, corner posts, and a
// shingled gable roof with an overhang.
export function shed(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  const w = 1.2
  const d = 1.0
  const h = 1.35
  const boards = 8
  for (const [face, len] of [['x', w], ['z', d]] as const) {
    for (const sideSign of [-1, 1]) {
      for (let i = 0; i < boards; i++) {
        const bw = len / boards
        const board = new THREE.Mesh(new THREE.BoxGeometry(face === 'x' ? bw - 0.012 : 0.04, h, face === 'x' ? 0.04 : bw - 0.012), mat(pick(WOOD)))
        const along = -len / 2 + bw * (i + 0.5)
        if (face === 'x') board.position.set(along, h / 2, (sideSign * d) / 2)
        else board.position.set((sideSign * w) / 2, h / 2, along)
        g.add(board)
      }
    }
  }
  const core = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, h, d - 0.04), mat('#3a2616'))
  core.position.y = h / 2
  g.add(core)
  const postMat = mat('#6b4428')
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, h + 0.05, 0.08), postMat)
    post.position.set((px * w) / 2, h / 2, (pz * d) / 2)
    g.add(post)
  }
  // Gable ends.
  const gable = new THREE.Shape()
  gable.moveTo(-w / 2, 0)
  gable.lineTo(w / 2, 0)
  gable.lineTo(0, 0.45)
  gable.closePath()
  for (const sideSign of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.ExtrudeGeometry(gable, { depth: 0.04, bevelEnabled: false }), mat('#9a6a3e'))
    end.position.set(0, h, (sideSign * d) / 2 - 0.02)
    g.add(end)
  }
  // Two roof pitches of overlapping shingle rows.
  const shingle = new RoundedBoxGeometry(1, 1, 1, 1, 0.1)
  const pitch = Math.atan2(0.45, w / 2)
  const slope = Math.hypot(0.45, w / 2) + 0.15
  for (const sideSign of [-1, 1]) {
    for (let r = 0; r < 5; r++) {
      const row = new THREE.Mesh(shingle, mat(pick(['#6b4428', '#7a4e2c', '#5e3c22'])))
      const tAlong = (r + 0.5) / 5
      row.scale.set(slope / 5 + 0.03, 0.045, d + 0.3)
      row.position.set(sideSign * (w / 2 + 0.08) * (1 - tAlong), h + 0.45 * tAlong + 0.05, 0)
      row.rotation.z = -sideSign * pitch
      g.add(row)
    }
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.95, 0.03), mat('#6b4428'))
  door.position.set(0, 0.5, d / 2 + 0.03)
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.02), mat('#2a2622', { metalness: 0.5 }))
  latch.position.set(0.18, 0.55, d / 2 + 0.05)
  g.add(door, latch)
  addCircle(x, z, 0.75)
  return shadowed(place(g, x, z, rotY))
}

// Raised bed with a stone kerb, soil and leafy veg.
export function planterBed(x: number, z: number, rotY = 0, w = 3, d = 1.4) {
  const g = new THREE.Group()
  const stone = mat('#8e9096')
  for (const [sx, sz, lx, lz] of [[0, -d / 2, w, 0.2], [0, d / 2, w, 0.2], [-w / 2, 0, 0.2, d], [w / 2, 0, 0.2, d]]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.45, lz), stone)
    kerb.position.set(sx, 0.22, sz)
    g.add(kerb)
  }
  const soil = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.35, d - 0.2), mat('#5a3b26'))
  soil.position.y = 0.2
  g.add(soil)
  for (let i = 0; i < 14; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(range(0.14, 0.26), 1), mat(pick(['#6cbf3f', '#4fa336', '#9ccf45'])))
    leaf.position.set(range(-w / 2 + 0.3, w / 2 - 0.3), 0.45, range(-d / 2 + 0.3, d / 2 - 0.3))
    leaf.scale.y = 0.7
    g.add(leaf)
  }
  addSegment(x - (w / 2) * Math.cos(rotY), z + (w / 2) * Math.sin(rotY), x + (w / 2) * Math.cos(rotY), z - (w / 2) * Math.sin(rotY), d / 2)
  return shadowed(place(g, x, z, rotY))
}

export function tire(x: number, z: number) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.14, 10, 20), mat('#1f1f22', { roughness: 0.7 }))
  t.position.set(x, heightAt(x, z) + 0.4, z)
  t.rotation.y = range(-0.4, 0.4)
  addCircle(x, z, 0.45)
  return shadowed(t)
}

export function plasticBarrel(x: number, z: number, color = '#2f63c9') {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 16), mat(color, { roughness: 0.5 }))
  b.position.set(x, heightAt(x, z) + 0.375, z)
  addCircle(x, z, 0.35)
  return shadowed(b)
}

// Red plastic road barrier.
export function roadBarrier(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  const red = mat('#e0352b', { roughness: 0.5 })
  const panel = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.8, 0.25, 3, 0.08), red)
  panel.position.y = 0.6
  const foot = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.2, 0.55, 2, 0.06), red)
  foot.position.y = 0.1
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.27), mat('#9c1e18'))
  slot.position.y = 0.72
  g.add(panel, foot, slot)
  addCircle(x, z, 0.7)
  return shadowed(place(g, x, z, rotY))
}

export function trafficCone(x: number, z: number) {
  const g = new THREE.Group()
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 12), mat('#ff6a1a'))
  cone.position.y = 0.27
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 12), mat('#ffffff'))
  band.position.y = 0.3
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.04, 0.36), mat('#ff6a1a'))
  base.position.y = 0.02
  g.add(cone, band, base)
  return shadowed(place(g, x, z))
}

export function barrel(x: number, z: number, rotY = 0, lying = true) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.15, 18), mat(pick(['#d98a3a', '#cf7d33', '#e09a48'])))
  // Bulge the staves.
  const p = body.geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const k = 1 + 0.12 * (1 - (y / 0.575) ** 2)
    p.setX(i, p.getX(i) * k)
    p.setZ(i, p.getZ(i) * k)
  }
  body.geometry.computeVertexNormals()
  g.add(body)
  for (const y of [-0.42, 0, 0.42]) {
    const r = 0.52 * (1 + 0.12 * (1 - (y / 0.575) ** 2)) + 0.01
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 24), mat('#5b4a3a', { metalness: 0.4 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = y
    g.add(ring)
  }
  if (lying) g.rotation.z = Math.PI / 2
  const holder = new THREE.Group()
  holder.add(g)
  place(holder, x, z, rotY, lying ? 0.55 : 0.58)
  addCircle(x, z, 0.65)
  return shadowed(holder)
}

export function utilityPole(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  const wood = mat('#6e4f35')
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), wood)
  pole.position.y = 2.6
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.1), wood)
  bar.position.y = 4.6
  const bar2 = bar.clone()
  bar2.scale.x = 0.7
  bar2.position.y = 4.1
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.3), mat('#2f7d6b'))
  box.position.set(0.18, 3.1, 0)
  g.add(pole, bar, bar2, box)
  for (const ix of [-0.65, 0.65]) {
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6), mat('#e8e2d0'))
    ins.position.set(ix, 4.72, 0)
    g.add(ins)
  }
  addCircle(x, z, 0.15)
  return shadowed(place(g, x, z, rotY))
}

// Green wooden feed crate with a yellow warning sign, like the one by the pole.
export function feedCrate(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.55, 0.8, 2, 0.04), mat('#5f7a3a'))
  box.position.y = 0.45
  g.add(box)
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.3, 0.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat('#4a3423'))
      leg.position.set(sx, 0.15, sz)
      g.add(leg)
    }
  }
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.05), mat('#3f5a2a'))
    slat.position.set(0, 0.3 + i * 0.13, 0.41)
    g.add(slat)
  }
  const sign = new THREE.Mesh(new THREE.CircleGeometry(0.14, 3), mat('#ffd23a', { emissive: '#ffb300', emissiveIntensity: 0.6 }))
  sign.position.set(0.3, 0.48, 0.43)
  sign.rotation.z = Math.PI / 2
  g.add(sign)
  addCircle(x, z, 0.7)
  return shadowed(place(g, x, z, rotY))
}

export function plankPile(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  for (let i = 0; i < 5; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.22), mat(pick(WOOD)))
    plank.position.set(range(-0.1, 0.1), 0.04 + (i > 2 ? 0.07 : 0), (i % 3) * 0.26 - 0.26)
    plank.rotation.y = range(-0.08, 0.08)
    g.add(plank)
  }
  return shadowed(place(g, x, z, rotY))
}

export function fence(points: XZ[]) {
  const g = new THREE.Group()
  const wood = mat('#7a5638')
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const rot = Math.atan2(-(bz - az), bx - ax)
    const posts = Math.max(1, Math.round(len / 1.6))
    for (let k = 0; k <= posts; k++) {
      const t = k / posts
      const px = ax + (bx - ax) * t
      const pz = az + (bz - az) * t
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), wood)
      post.position.set(px, heightAt(px, pz) + 0.55, pz)
      post.rotation.set(range(-0.06, 0.06), 0, range(-0.06, 0.06))
      g.add(post)
    }
    for (const y of [0.45, 0.85]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.05), wood)
      rail.position.set((ax + bx) / 2, heightAt((ax + bx) / 2, (az + bz) / 2) + y, (az + bz) / 2)
      rail.rotation.y = rot
      g.add(rail)
    }
    addSegment(ax, az, bx, bz, 0.12)
  }
  return shadowed(g)
}

// Wrought-iron gate between two posts.
export function ironGate(x: number, z: number, rotY = 0, width = 3) {
  const g = new THREE.Group()
  const iron = mat('#2d3238', { metalness: 0.6, roughness: 0.5 })
  const bars = Math.round(width / 0.18)
  for (let i = 0; i <= bars; i++) {
    const bx = -width / 2 + (i / bars) * width
    const h = 2.1 + Math.sin((i / bars) * Math.PI) * 0.35
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, h, 5), iron)
    bar.position.set(bx, h / 2, 0)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), iron)
    tip.position.set(bx, h + 0.06, 0)
    g.add(bar, tip)
  }
  for (const y of [0.3, 1.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.06), iron)
    rail.position.y = y
    g.add(rail)
  }
  return shadowed(place(g, x, z, rotY))
}

// Hanging festoon lights strung between two posts above the plaza.
export function stringLights(a: XZ, b: XZ, height = 3.6) {

  const g = new THREE.Group()
  const bulbMat = mat('#fff1c2', { emissive: '#ffcf6b', emissiveIntensity: 4 })
  const wireMat = new THREE.LineBasicMaterial({ color: '#2a2018' })
  const pts = []
  const count = 14
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const x = a[0] + (b[0] - a[0]) * t
    const z = a[1] + (b[1] - a[1]) * t
    const y = height - Math.sin(t * Math.PI) * 0.7
    pts.push(new THREE.Vector3(x, y, z))
    if (i > 0 && i < count) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bulbMat)
      bulb.position.set(x, y - 0.12, z)
      g.add(bulb)
    }
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat))
  for (const [px, pz] of [a, b]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height + 0.2, 6), mat('#5a3d26'))
    post.position.set(px, (height + 0.2) / 2, pz)
    post.castShadow = true
    g.add(post)
    addCircle(px, pz, 0.15)
  }
  return g
}

// Weathered market stall: a plank counter on posts, a sagging canvas awning in faded
// stripes, and crates of produce.
export function stall(x: number, z: number, rotY = 0, awning = '#c4594a') {
  const g = new THREE.Group()
  const wood = mat('#7a5232')
  // Plank counter top over a boarded front.
  for (let i = 0; i < 5; i++) {
    const plank = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.06, 0.19, 1, 0.02), mat(pick(WOOD)))
    plank.position.set(0, 0.92, -0.38 + i * 0.19)
    plank.rotation.y = range(-0.01, 0.01)
    g.add(plank)
  }
  for (let i = 0; i < 9; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.86, 0.04), mat(pick(WOOD)))
    board.position.set(-1.02 + i * 0.255, 0.45, 0.46)
    board.rotation.z = range(-0.02, 0.02)
    g.add(board)
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.86, 0.8), mat('#3a2616'))
  back.position.set(0, 0.45, 0.02)
  g.add(back)
  for (const [sx, sz, sh] of [[-1.1, -0.45, 2.5], [1.1, -0.45, 2.5], [-1.1, 0.5, 2.1], [1.1, 0.5, 2.1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, sh, 6), wood)
    post.position.set(sx, sh / 2, sz)
    g.add(post)
  }
  // Canvas: a subdivided sheet sloping toward the front, sagging between the posts,
  // striped through vertex colours.
  const sheet = new THREE.PlaneGeometry(2.5, 1.35, 20, 8).rotateX(-Math.PI / 2)
  const sp = sheet.attributes.position
  const cols = []
  const stripeA = new THREE.Color(awning)
  const stripeB = new THREE.Color('#ece2c8')
  const cc = new THREE.Color()
  for (let i = 0; i < sp.count; i++) {
    const px = sp.getX(i)
    const pz = sp.getZ(i)
    const along = (pz + 0.675) / 1.35
    const sag = Math.sin(((px + 1.25) / 2.5) * Math.PI) * 0.08 + Math.sin(along * Math.PI) * 0.05
    sp.setY(i, 2.5 - along * 0.45 - sag)
    const stripe = Math.floor((px + 1.25) / 0.36) % 2
    cc.copy(stripe ? stripeB : stripeA).multiplyScalar(0.92 + 0.08 * noise.noise(px * 3, pz * 3))
    cols.push(cc.r, cc.g, cc.b)
  }
  sheet.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  sheet.computeVertexNormals()
  const canvas = new THREE.Mesh(sheet, weathered(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.95 }), { fade: 0.3 }))
  canvas.position.z = 0.05
  g.add(canvas)
  // Scalloped valance along the front edge.
  for (let i = 0; i < 7; i++) {
    const flap = new THREE.Mesh(new THREE.CircleGeometry(0.18, 10, Math.PI, Math.PI), mat(i % 2 ? '#ece2c8' : awning, { side: THREE.DoubleSide }))
    flap.position.set(-1.08 + i * 0.36, 2.04, 0.72)
    g.add(flap)
  }
  const produce = [['#d8452f', '#e85a3a'], ['#f0a030', '#e8902a'], ['#7cc443', '#5fae35'], ['#9a4ac0', '#7a3aa0']]
  for (let i = 0; i < 4; i++) {
    const cx = -0.84 + i * 0.56
    const crate = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.38), mat('#b88a52'))
    base.position.y = 0.02
    crate.add(base)
    for (const [w2, d2, ox, oz] of [[0.48, 0.03, 0, 0.18], [0.48, 0.03, 0, -0.18], [0.03, 0.38, 0.23, 0], [0.03, 0.38, -0.23, 0]]) {
      for (const sy of [0.06, 0.13]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(w2, 0.05, d2), mat('#c49a62'))
        slat.position.set(ox, sy, oz)
        crate.add(slat)
      }
    }
    for (let k = 0; k < 9; k++) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(range(0.065, 0.085), 8, 6), mat(pick(produce[i]), { roughness: 0.5 }))
      fruit.position.set(range(-0.17, 0.17), range(0.12, 0.2), range(-0.12, 0.12))
      crate.add(fruit)
    }
    crate.position.set(cx, 0.95, range(-0.05, 0.08))
    crate.rotation.y = range(-0.08, 0.08)
    g.add(crate)
  }
  // Spare crates stacked beside the stall.
  for (const [ox, oy, oz] of [[1.55, 0.15, 0.1], [1.6, 0.45, 0.05]]) {
    const crate = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.4, 1, 0.02), mat('#b88a52'))
    crate.position.set(ox, oy, oz)
    crate.rotation.y = range(-0.2, 0.2)
    g.add(crate)
  }
  addCircle(x, z, 1.3)
  return shadowed(place(g, x, z, rotY))
}

// Xiaomai's mailbox: a little red box on a post by the cottage door, flag up, facing +z.
export function mailbox(x: number, z: number, rotY = 0) {
  const g = new THREE.Group()
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 8), mat('#94592f'))
  post.position.y = 0.55
  const red = mat('#b8352a')
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.3, 0.5, 2, 0.06), red)
  box.position.y = 1.2
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), red)
  lid.position.y = 1.35
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.1), mat('#f2c230'))
  flag.position.set(0.19, 1.45, -0.1)
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.01), mat('#2a1a14'))
  slot.position.set(0, 1.28, 0.252)
  g.add(post, box, lid, flag, slot)
  g.position.set(x, heightAt(x, z), z)
  g.rotation.y = rotY
  addCircle(x, z, 0.2)
  return shadowed(g)
}
