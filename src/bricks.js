import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { heightAt, rand, range, pick } from './terrain.js'
import { addSegment, addCircle } from './collision.js'
import { weathered } from './weathering.js'

// Every brick in the world is collected here, then flushed into one InstancedMesh.
const bricks = []
const BRICK_COLORS = ['#8f4a38', '#9a5642', '#824034', '#a8664e', '#8a4636', '#965040', '#76392c', '#ac6c54', '#844c3e']

const BL = 0.46
const BH = 0.21

const q = new THREE.Quaternion()
const e = new THREE.Euler()

// Painted-brick material: continuous meshes carry metre-based UVs and the shader draws
// staggered courses, per-brick tint, dark mortar joints and a weathered top.
const brickWalls = []
export function brickMaterial(base = '#94503c') {
  // Double-sided so end-cap winding never matters; three flips the normal for back faces.
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.95, side: THREE.DoubleSide })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBrickUv;\nvarying vec3 vBrickN;\nvarying vec3 vBrickW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrickUv = uv;\nvBrickN = normalize(mat3(modelMatrix) * normal);\nvBrickW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vBrickUv;
        varying vec3 vBrickN;
        varying vec3 vBrickW;
        float bHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float bNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bHash(i), bHash(i + vec2(1, 0)), f.x), mix(bHash(i + vec2(0, 1)), bHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 bsz = vec2(0.46, 0.2);
        vec2 b = vBrickUv / bsz;
        b.x += mod(floor(b.y), 2.0) * 0.5;
        vec2 id = floor(b);
        vec2 f = fract(b);
        float joint = min(min(f.x, 1.0 - f.x) * bsz.x, min(f.y, 1.0 - f.y) * bsz.y);
        float mortar = 1.0 - smoothstep(0.006, 0.02, joint);
        float v1 = bHash(id);
        float v2 = bHash(id + 17.0);
        vec3 tint = mix(vec3(0.92, 0.94, 0.97), vec3(1.07, 1.0, 0.94), v1) * (0.92 + 0.14 * v2);
        vec3 brick = diffuseColor.rgb * tint;
        // Broad weathering blotches rather than fine grain, so the wall reads painted.
        float weather = bNoise(vBrickW.xz * 1.1 + vBrickW.y * 1.7);
        brick *= 0.88 + 0.22 * weather;
        diffuseColor.rgb = mix(brick, diffuseColor.rgb * 0.72, mortar * 0.8);
        // Pitted surface and soot-dark grime wicking up from the ground.
        float pit = bNoise(vBrickW.xy * 31.0 + vBrickW.z * 17.0) * 0.5 + bNoise(vBrickW.zy * 23.0) * 0.5;
        diffuseColor.rgb *= 0.84 + 0.26 * pit;
        float soot = (1.0 - smoothstep(0.0, 0.9, vBrickW.y)) * 0.5 + smoothstep(0.6, 0.9, bNoise(vBrickW.xz * 0.8 + vBrickW.y * 0.6)) * 0.3;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.11, 0.08), soot);
        float faceUp = smoothstep(0.6, 0.95, vBrickN.y);
        // Odd bricks spalled or swapped for a different batch.
        float odd = step(0.93, bHash(id + 41.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(vec3(0.62, 0.55, 0.5), vec3(1.15, 1.0, 0.85), bHash(id + 7.0)), odd);
        // Rain streaks running down the face.
        float streak = bNoise(vec2((vBrickW.x + vBrickW.z) * 9.0, vBrickW.y * 0.6)) * bNoise(vec2((vBrickW.x - vBrickW.z) * 3.0, vBrickW.y * 0.25));
        diffuseColor.rgb *= 1.0 - smoothstep(0.25, 0.6, streak) * 0.35 * (1.0 - faceUp);
        // Patches of old render clinging to the brick.
        float render = smoothstep(0.8, 0.84, bNoise(vBrickW.xy * 2.2 + vBrickW.z * 1.7 + 30.0) * 0.85 + pit * 0.2);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.5, 0.43) * (0.75 + 0.4 * pit), render * 0.8 * (1.0 - faceUp));
        float up = smoothstep(0.6, 0.95, vBrickN.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * vec3(1.05, 0.9, 0.82), up * 0.35);
        // Moss creeping up from the ground and settling on top.
        float mossN = bNoise(vBrickW.xz * 2.3 + vBrickW.y * 2.0) * 0.7 + bNoise(vBrickW.xz * 7.0 - vBrickW.y * 5.0) * 0.3;
        float base = 1.0 - smoothstep(0.0, 0.55, vBrickW.y);
        float moss = smoothstep(0.66, 0.8, mossN * 0.85 + base * 0.38) * (1.0 - up * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.36, 0.1) * (0.8 + 0.4 * mossN), moss * 0.8);
        float brickBump = (1.0 - mortar) * 0.012 * (1.0 - render) + pit * 0.004 - odd * 0.006 + render * 0.01;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Bump from a height field via screen-space derivatives (as three's bump map does).
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec2 dh = vec2(dFdx(brickBump), dFdy(brickBump));
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      )
  }
  return m
}

// Rounded-top wall profile swept along a curve. heights(t) lets ruined stretches dip.
function sweepWall(curve, thickness, heights) {
  const length = curve.getLength()
  const steps = Math.max(2, Math.ceil(length / 0.2))
  const r = Math.min(0.12, thickness * 0.25)
  const half = thickness / 2
  const profile = (h) => {
    const pts = [[-half, -0.3], [-half, h - r]]
    for (let k = 1; k <= 3; k++) {
      const a = Math.PI - (k / 3) * (Math.PI / 2)
      pts.push([-half + r + Math.cos(a) * r, h - r + Math.sin(a) * r])
    }
    for (let k = 0; k <= 3; k++) {
      const a = Math.PI / 2 - (k / 3) * (Math.PI / 2)
      pts.push([half - r + Math.cos(a) * r, h - r + Math.sin(a) * r])
    }
    pts.push([half, -0.3])
    return pts
  }
  const P = profile(1).length
  const pos = []
  const uv = []
  const idx = []
  const side = new THREE.Vector3()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const c = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    side.set(-tan.z, 0, tan.x).normalize()
    const ground = heightAt(c.x, c.z)
    const h = heights(t)
    for (const [px, py] of profile(h)) {
      pos.push(c.x + side.x * px, ground + py, c.z + side.z * px)
      // Sides use height for V; the cap continues across the top.
      uv.push(t * length, Math.abs(Math.abs(px) - half) < 1e-4 ? py : h + px + half)
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < P - 1; k++) {
      const a = i * P + k
      const b = (i + 1) * P + k
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  // End caps as fans so the wall reads as a solid block.
  for (const [t, flip] of [[0, true], [1, false]]) {
    const c = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    side.set(-tan.z, 0, tan.x).normalize()
    const ground = heightAt(c.x, c.z)
    const base = pos.length / 3
    for (const [px, py] of profile(heights(t))) {
      pos.push(c.x + side.x * px, ground + py, c.z + side.z * px)
      uv.push(px, py)
    }
    for (let k = 1; k < P - 1; k++) {
      if (flip) idx.push(base, base + k + 1, base + k)
      else idx.push(base, base + k, base + k + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * Brick wall following a smoothed polyline.
 * opts: rows (height in courses), thickness, ruin (0..1 how much the top crumbles)
 */
export function brickWall(points, { rows = 5, thickness = 0.7, ruin = 0, collide = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.2)
  const length = curve.getLength()
  const H = rows * 0.25
  const seed = rand() * 100
  const heights = (t) => {
    if (!ruin) return H
    const n = Math.sin(t * length * 0.9 + seed) * 0.5 + Math.sin(t * length * 2.3 + seed * 2) * 0.3
    return Math.max(0.35, H * (1 - ruin * Math.max(0, n + 0.2)))
  }
  const mesh = new THREE.Mesh(sweepWall(curve, thickness, heights), brickMaterial())
  mesh.castShadow = true
  mesh.receiveShadow = true
  brickWalls.push(mesh)
  if (collide) {
    const samples = curve.getSpacedPoints(Math.ceil(length / 0.8))
    for (let i = 0; i < samples.length - 1; i++) {
      addSegment(samples[i].x, samples[i].z, samples[i + 1].x, samples[i + 1].z, thickness * 0.5 + 0.02)
    }
  }
  return curve
}

// Block with softly rounded edges and metre-based UVs so the brick shader lines up:
// a rounded rectangle in XY extruded along Z with a bevel to round the remaining edges.
function boxWithMetreUVs(w, h, d, r = 0.06) {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2 + r, -h / 2 + r)
  shape.lineTo(w / 2 - r, -h / 2 + r)
  shape.lineTo(w / 2 - r, h / 2 - r)
  shape.lineTo(-w / 2 + r, h / 2 - r)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - 2 * r,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: 2,
  })
  g.translate(0, 0, -(d - 2 * r) / 2)
  // Project UVs by face direction so courses stay horizontal on every side.
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = g.attributes.uv
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + w / 2
    const y = p.getY(i) + h / 2
    const z = p.getZ(i) + d / 2
    const nx = Math.abs(n.getX(i))
    const ny = Math.abs(n.getY(i))
    const nz = Math.abs(n.getZ(i))
    if (ny > nx && ny > nz) uv.setXY(i, x, z + h)
    else if (nx > nz) uv.setXY(i, z, y)
    else uv.setXY(i, x, y)
  }
  return g
}

// Square column with a pyramid cap; tilt tips it over around its base.
export function brickPillar(x, z, { rows = 12, size = 0.7, tilt = 0, dir = 0, cap = true } = {}) {
  const g = new THREE.Group()
  const h = rows * 0.25
  const body = new THREE.Mesh(boxWithMetreUVs(size, h, size), brickMaterial('#8f4a38'))
  body.position.y = h / 2 - 0.15
  g.add(body)
  if (cap) {
    const ledge = new THREE.Mesh(boxWithMetreUVs(size + 0.14, 0.2, size + 0.14), brickMaterial('#7e4636'))
    ledge.position.y = h - 0.05
    g.add(ledge)
  }
  g.position.set(x, heightAt(x, z), z)
  g.rotation.set(tilt, dir, 0, 'YXZ')
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
  brickWalls.push(g)
  addCircle(x, z, size * 0.65)
}

// Brick culvert: one thick, bevelled barrel vault with a dark mouth, worn smooth like the
// reference's ruined arch rather than built brick by brick.
export function brickArch(x, z, rotY, scene) {
  const group = new THREE.Group()
  const radius = 0.9
  const outer = 1.4
  const depth = 1.4
  const legs = 0.25
  const shape = new THREE.Shape()
  shape.moveTo(-outer - 0.15, -0.3)
  shape.lineTo(-outer - 0.15, legs)
  shape.absarc(0, legs, outer + 0.15, Math.PI, 0, true)
  shape.lineTo(outer + 0.15, -0.3)
  shape.lineTo(radius, -0.3)
  shape.lineTo(radius, legs)
  shape.absarc(0, legs, radius, 0, Math.PI, false)
  shape.lineTo(-radius, -0.3)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 0.16,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 24,
  })
  geo.translate(0, 0, -(depth - 0.16) / 2)
  const vault = new THREE.Mesh(geo, brickMaterial('#8e4e3c'))
  const ground = heightAt(x, z)
  vault.position.set(x, ground, z)
  vault.rotation.y = rotY
  vault.castShadow = true
  vault.receiveShadow = true
  group.add(vault)
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, depth - 0.1, 24, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#1a120e', side: THREE.BackSide, roughness: 1 }),
  )
  inner.position.set(x, ground + legs, z)
  inner.rotation.y = rotY
  group.add(inner)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, depth), new THREE.MeshStandardMaterial({ color: '#2a1d14' }))
  floor.rotation.set(-Math.PI / 2, 0, rotY)
  floor.position.set(x, ground + 0.02, z)
  group.add(floor)
  scene.add(group)
  const dx = Math.cos(rotY)
  const dz = -Math.sin(rotY)
  addSegment(x - dx * 1.6, z - dz * 1.6, x + dx * 1.6, z + dz * 1.6, depth * 0.5)
}

// Small rubble pile of loose bricks.
export function brickRubble(x, z, count = 10) {
  for (let i = 0; i < count; i++) {
    const a = rand() * 6.28
    const d = rand() * 0.9
    const px = x + Math.cos(a) * d
    const pz = z + Math.sin(a) * d
    e.set(range(-0.3, 0.3), rand() * 6.28, range(-0.3, 0.3))
    q.setFromEuler(e)
    bricks.push({
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(px, heightAt(px, pz) + 0.08 + (i > count * 0.6 ? 0.18 : 0), pz), q.clone(), new THREE.Vector3(BL, BH, 0.24)),
      color: new THREE.Color(pick(BRICK_COLORS)),
    })
  }
}

// A toppled section of wall lying at an angle, like the chunks scattered in the meadow.
export function fallenChunk(x, z, rotY, tilt = 1.1, rows = 3, cols = 3) {
  const w = cols * 0.48
  const h = rows * 0.25
  const chunk = new THREE.Mesh(boxWithMetreUVs(w, h, 0.7), brickMaterial())
  chunk.geometry.translate(0, h / 2, 0)
  chunk.position.set(x, heightAt(x, z) - 0.05, z)
  chunk.rotation.set(tilt, rotY, range(-0.15, 0.15), 'YXZ')
  chunk.castShadow = true
  chunk.receiveShadow = true
  brickWalls.push(chunk)
  addCircle(x, z, 0.8)
}

export function flushBricks() {
  const geo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06)
  const mesh = new THREE.InstancedMesh(geo, weathered(new THREE.MeshStandardMaterial({ roughness: 0.92 })), bricks.length)
  bricks.forEach((b, i) => {
    mesh.setMatrixAt(i, b.matrix)
    mesh.setColorAt(i, b.color)
  })
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh, ...brickWalls)
  return group
}
