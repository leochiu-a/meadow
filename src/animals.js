import * as THREE from 'three'
import { heightAt, rand, range } from './terrain.js'
import { addCircle, resolve } from './collision.js'

export const turnToward = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k

export const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
export const shadow = (o) => {
  o.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true
      m.receiveShadow = true
    }
  })
  return o
}

// Coat material: fine world-space mottling so hide reads as fur rather than plastic.
export function furMaterial(color, vertexColors = false) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1, vertexColors })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFurPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFurPos;
        float fHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float fNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(fHash(i), fHash(i + vec3(1,0,0)), f.x), mix(fHash(i + vec3(0,1,0)), fHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(fHash(i + vec3(0,0,1)), fHash(i + vec3(1,0,1)), f.x), mix(fHash(i + vec3(0,1,1)), fHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float fur = fNoise(vFurPos * 6.0) * 0.6 + fNoise(vFurPos * 28.0) * 0.4;
        diffuseColor.rgb *= 0.82 + 0.32 * fur;`,
      )
  }
  m.customProgramCacheKey = () => `fur-${vertexColors}`
  return m
}

/**
 * Smooth body lofted along a spine: an elliptical tube whose radius follows `radii`
 * and whose colour follows `colors`, both sampled along the spine, closed at each end.
 * spine: [[x, y], ...] in the XY plane; squash scales the Z (width) of the cross-section.
 */
export function loft(spine, radii, { squash = 0.85, colors = null, segs = 40, ring = 14 } = {}) {
  const curve = new THREE.CatmullRomCurve3(spine.map(([x, y]) => new THREE.Vector3(x, y, 0)))
  const sample = (arr, t) => {
    const f = t * (arr.length - 1)
    const i = Math.min(arr.length - 2, Math.floor(f))
    const k = THREE.MathUtils.smootherstep(f - i, 0, 1)
    return [arr[i], arr[i + 1], k]
  }
  const pos = []
  const col = []
  const idx = []
  const c = new THREE.Color()
  const c2 = new THREE.Color()
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const p = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const nrm = new THREE.Vector3(-tan.y, tan.x, 0)
    const [r0, r1, k] = sample(radii, t)
    // Round the ends off with hemispherical caps.
    const e = Math.min(1, Math.min(t, 1 - t) / 0.1)
    const r = (r0 + (r1 - r0) * k) * Math.max(0.04, Math.sqrt(1 - (1 - e) ** 2))
    if (colors) {
      const [a, b, kk] = sample(colors, t)
      c.set(a).lerp(c2.set(b), kk)
    } else c.set('#ffffff')
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI * 2
      const off = nrm.clone().multiplyScalar(Math.cos(a) * r)
      pos.push(p.x + off.x, p.y + off.y, Math.sin(a) * r * squash)
      // Darker belly, lighter back.
      const shade = 0.82 + 0.18 * Math.cos(a)
      col.push(c.r * shade, c.g * shade, c.b * shade)
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * (ring + 1) + j
      const b = a + ring + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function leg(len, r, material, hoof) {
  const g = new THREE.Group()
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, len, 7).translate(0, -len / 2, 0), material)
  g.add(upper)
  if (hoof) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.85, 0.07, 7).translate(0, -len + 0.035, 0), hoof)
    g.add(h)
  }
  return g
}

// Stocky chestnut cow that grazes with its head down, lifting it now and then to look around.
export function createCow(x, z, rotY) {
  const root = new THREE.Group()
  const coat = furMaterial('#ffffff', true)
  const hide = '#78301f'
  const body = new THREE.Mesh(
    loft(
      [[-0.95, 0.9], [-0.6, 0.92], [-0.1, 0.9], [0.35, 0.94], [0.75, 0.98]],
      [0.08, 0.4, 0.47, 0.47, 0.44, 0.34],
      { squash: 0.8, colors: [hide, hide, hide] },
    ),
    coat,
  )
  root.add(body)
  const legMat = furMaterial('#62271a')
  const hoof = mat('#2b1d16')
  const legs = []
  for (const [lx, lz] of [[0.52, 0.2], [0.52, -0.2], [-0.62, 0.2], [-0.62, -0.2]]) {
    const l = leg(0.6, 0.09, legMat, hoof)
    l.position.set(lx, 0.64, lz)
    legs.push(l)
    root.add(l)
  }
  // Neck and head as one loft hinged at the shoulders; muzzle shades pale at the tip.
  const neck = new THREE.Group()
  neck.position.set(0.62, 1.0, 0)
  const head = new THREE.Mesh(
    loft(
      [[-0.1, 0], [0.18, 0.04], [0.38, 0.02], [0.56, -0.04], [0.68, -0.1]],
      [0.32, 0.28, 0.22, 0.2, 0.19, 0.17, 0.13],
      { squash: 0.85, colors: [hide, hide, hide, '#7a3420', '#c08a74'] },
    ),
    coat,
  )
  neck.add(head)
  for (const sd of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6).scale(1, 0.45, 1.6), furMaterial('#a0563c'))
    ear.position.set(0.38, 0.1, sd * 0.22)
    ear.rotation.x = sd * 0.5
    neck.add(ear)
  }
  root.add(neck)
  const tail = new THREE.Group()
  tail.position.set(-0.98, 0.92, 0)
  const tailRope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.65, 4).translate(0, -0.32, 0), legMat)
  const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5).scale(0.8, 1.6, 0.8).translate(0, -0.68, 0), mat('#4a2216'))
  tail.add(tailRope, tuft)
  tail.rotation.z = -0.15
  root.add(tail)
  root.position.set(x, heightAt(x, z), z)
  root.rotation.y = rotY
  addCircle(x, z, 0.85)
  const phase = rand() * 10
  return {
    object: shadow(root),
    update(t) {
      // Mostly grazing: head down nibbling, occasionally raised to look around.
      const cycle = (t * 0.12 + phase) % 1
      const up = THREE.MathUtils.smoothstep(cycle, 0.72, 0.8) * (1 - THREE.MathUtils.smoothstep(cycle, 0.92, 1))
      neck.rotation.z = -0.85 * (1 - up) + Math.sin(t * 6) * 0.03 * (1 - up)
      neck.rotation.y = up * Math.sin(t * 0.8 + phase) * 0.4
      tail.rotation.x = Math.sin(t * 2.1 + phase) * 0.35
    },
  }
}

// Red fox that trots between a few spots near home, pausing to sniff.
export function createFox(x, z) {
  const root = new THREE.Group()
  const coat = furMaterial('#ffffff', true)
  const orange = '#c8662c'
  const body = new THREE.Mesh(
    loft(
      [[-0.32, 0.3], [-0.1, 0.31], [0.12, 0.32], [0.28, 0.36]],
      [0.05, 0.12, 0.13, 0.12, 0.1],
      { squash: 0.85, colors: [orange, orange, orange], ring: 10, segs: 24 },
    ),
    coat,
  )
  root.add(body)
  const legMat = mat('#2a1a14')
  const legs = []
  for (const [lx, lz] of [[0.2, 0.06], [0.2, -0.06], [-0.22, 0.06], [-0.22, -0.06]]) {
    const l = leg(0.25, 0.028, legMat)
    l.position.set(lx, 0.27, lz)
    legs.push(l)
    root.add(l)
  }
  const head = new THREE.Group()
  head.position.set(0.3, 0.4, 0)
  head.add(
    new THREE.Mesh(
      loft([[-0.04, 0], [0.08, 0.0], [0.18, -0.03], [0.25, -0.05]], [0.09, 0.09, 0.06, 0.035, 0.02], {
        colors: [orange, orange, '#e9dcc8', '#2a1a14'],
        ring: 10,
        segs: 16,
      }),
      coat,
    ),
  )
  for (const sd of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 4), mat('#a84f22'))
    ear.position.set(0.0, 0.1, sd * 0.05)
    ear.rotation.x = sd * 0.25
    head.add(ear)
  }
  root.add(head)
  const tail = new THREE.Group()
  tail.position.set(-0.32, 0.3, 0)
  tail.add(
    new THREE.Mesh(
      loft([[0, 0], [-0.15, -0.04], [-0.3, -0.06], [-0.42, -0.04]], [0.03, 0.07, 0.08, 0.06, 0.02], {
        colors: [orange, orange, orange, '#f4efe6'],
        ring: 8,
        segs: 16,
      }),
      coat,
    ),
  )
  root.add(tail)
  shadow(root)

  const home = new THREE.Vector2(x, z)
  const pos = new THREE.Vector3(x, 0, z)
  const target = new THREE.Vector2(x, z)
  let wait = rand() * 3
  let heading = rand() * 6
  let stride = 0
  return {
    object: root,
    update(t, dt) {
      const to = new THREE.Vector2(target.x - pos.x, target.y - pos.z)
      let moving = false
      if (wait > 0) {
        wait -= dt
        head.rotation.z = -0.35 + Math.sin(t * 5) * 0.08
      } else if (to.length() < 0.15) {
        wait = range(1.5, 4)
        const a = rand() * Math.PI * 2
        const r = range(0.8, 2.6)
        target.set(home.x + Math.cos(a) * r, home.y + Math.sin(a) * r)
      } else {
        moving = true
        to.normalize()
        pos.x += to.x * dt * 1.3
        pos.z += to.y * dt * 1.3
        resolve(pos, 0.25)
        heading = Math.atan2(-to.y, to.x)
        head.rotation.z = turnToward(head.rotation.z, 0.05, Math.min(1, dt * 6))
      }
      stride += dt * (moving ? 13 : 0)
      legs.forEach((l, i) => (l.rotation.z = moving ? Math.sin(stride + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.55 : 0))
      tail.rotation.y = Math.sin(t * 2 + home.x) * 0.25
      tail.rotation.z = moving ? 0.15 : -0.1
      root.rotation.y = turnToward(root.rotation.y, heading, Math.min(1, dt * 7))
      root.position.set(pos.x, heightAt(pos.x, pos.z) + (moving ? Math.abs(Math.sin(stride)) * 0.025 : 0), pos.z)
    },
  }
}

// Little hen that pecks and wanders around a home spot.
export function createChicken(x, z) {
  const root = new THREE.Group()
  const color = rand() < 0.5 ? '#f2ede2' : '#b5683a'
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mat(color))
  body.scale.set(1.25, 1, 0.95)
  body.position.y = 0.26
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(color))
  head.position.set(0.17, 0.42, 0)
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), mat('#e0302a'))
  comb.position.set(0.18, 0.52, 0)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), mat('#f2b233'))
  beak.rotation.z = -Math.PI / 2
  beak.position.set(0.28, 0.41, 0)
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), mat(color))
  tail.position.set(-0.22, 0.36, 0)
  tail.rotation.z = 0.9
  const headGroup = new THREE.Group()
  headGroup.add(head, comb, beak)
  root.add(body, headGroup, tail)
  for (const s of [-0.06, 0.06]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), mat('#e2a33a'))
    leg.position.set(0, 0.07, s)
    root.add(leg)
  }
  shadow(root)
  const home = new THREE.Vector2(x, z)
  const pos = new THREE.Vector3(x, 0, z)
  const target = new THREE.Vector2(x, z)
  let wait = rand() * 3
  let heading = rand() * 6
  return {
    object: root,
    update(t, dt) {
      const to = new THREE.Vector2(target.x - pos.x, target.y - pos.z)
      if (wait > 0) {
        wait -= dt
        headGroup.position.y = Math.max(0, Math.sin(t * 9)) * -0.12
        headGroup.position.x = Math.max(0, Math.sin(t * 9)) * 0.04
      } else if (to.length() < 0.1) {
        wait = range(1, 4)
        const a = rand() * Math.PI * 2
        const r = rand() * 2.5
        target.set(home.x + Math.cos(a) * r, home.y + Math.sin(a) * r)
      } else {
        to.normalize()
        pos.x += to.x * dt * 0.9
        pos.z += to.y * dt * 0.9
        resolve(pos, 0.2)
        heading = Math.atan2(-to.y, to.x)
        headGroup.position.set(0, Math.abs(Math.sin(t * 14)) * 0.03, 0)
      }
      root.rotation.y = turnToward(root.rotation.y, heading, Math.min(1, dt * 8))
      root.position.set(pos.x, heightAt(pos.x, pos.z) + Math.abs(Math.sin(t * 14)) * (wait > 0 ? 0 : 0.02), pos.z)
    },
  }
}

// Villager walking a looping route: swinging arms and legs, a little bob in the stride.
export function createVillager(route, { top = '#2b2f3a', bottom = '#3a3328', skin = '#e2b48f', hair = '#2a1d16', hood = true } = {}) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const shirt = mat(top)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.32, 4, 10), shirt)
  torso.scale.set(0.85, 1, 1.1)
  torso.position.y = 1.05
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), mat(skin))
  head.position.y = 1.5
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(hood ? 0.165 : 0.14, 12, 8, 0, Math.PI * 2, 0, hood ? Math.PI * 0.62 : Math.PI * 0.5),
    hood ? shirt : mat(hair),
  )
  cap.position.set(-0.02, 1.52, 0)
  cap.rotation.z = 0.25
  body.add(torso, head, cap)
  const limb = (len, r, m, y, zOff) => {
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 6).translate(0, -len / 2 - r, 0), m))
    g.position.set(0, y, zOff)
    body.add(g)
    return g
  }
  const legs = [limb(0.5, 0.075, mat(bottom), 0.72, 0.09), limb(0.5, 0.075, mat(bottom), 0.72, -0.09)]
  const arms = [limb(0.4, 0.055, shirt, 1.3, 0.22), limb(0.4, 0.055, shirt, 1.3, -0.22)]
  for (const l of legs) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.1), mat('#1c1a18'))
    shoe.position.set(0.04, -0.68, 0)
    l.add(shoe)
  }
  shadow(root)

  const curve = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)), true)
  const length = curve.getLength()
  const speed = 1.05
  let s = rand() * length
  let stride = 0
  return {
    object: root,
    update(t, dt) {
      s = (s + speed * dt) % length
      const u = s / length
      const p = curve.getPointAt(u)
      const tan = curve.getTangentAt(u)
      stride += dt * speed * 5.2
      const swing = Math.sin(stride)
      legs[0].rotation.z = swing * 0.5
      legs[1].rotation.z = -swing * 0.5
      arms[0].rotation.z = -swing * 0.45
      arms[1].rotation.z = swing * 0.45
      body.position.y = Math.abs(Math.cos(stride)) * 0.04
      root.position.set(p.x, heightAt(p.x, p.z), p.z)
      root.rotation.y = Math.atan2(-tan.z, tan.x)
    },
  }
}
