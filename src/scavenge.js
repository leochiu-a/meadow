import * as THREE from 'three'
import { RELICS, relicModel } from './relics.js'

// Scavenging: the scene's relics lie where it placed them, glinting once the robot is close.
// Drive up to one and the robot picks it up — only when you are steering, not on patrol.
// The radar signal grows as the nearest relic gets closer. Finds are remembered per scene
// in this browser.

const PICKUP = 1.1
const RADAR = 16
const storageKey = (sceneName) => `meadow-bot:relics:${sceneName}`

function load(sceneName) {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey(sceneName)) ?? '[]'))
  } catch {
    return new Set()
  }
}

function save(sceneName, found) {
  try {
    localStorage.setItem(storageKey(sceneName), JSON.stringify([...found]))
  } catch {
    // Storage may be unavailable (private window); finds then last for this visit only.
  }
}

// A soft warm star for the glint above each relic.
function glintTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,250,220,1)')
  g.addColorStop(0.25, 'rgba(255,220,140,0.6)')
  g.addColorStop(1, 'rgba(255,200,100,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = 'rgba(255,250,230,0.9)'
  ctx.fillRect(30, 4, 4, 56)
  ctx.fillRect(4, 30, 56, 4)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * placements: [{ id, x, z }] from the scene. onCollect(def, found) when one is picked up;
 * onPing(signal) on each radar beep, signal 0–1.
 */
export function createScavenge(scene, sceneName, placements = [], { onCollect, onPing } = {}) {
  const defs = (RELICS[sceneName] ?? []).filter((d) => placements.some((p) => p.id === d.id))
  const found = load(sceneName)
  const glintMat = new THREE.SpriteMaterial({ map: glintTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
  const lying = []
  for (const def of defs) {
    if (found.has(def.id)) continue
    const { x, z } = placements.find((p) => p.id === def.id)
    const root = new THREE.Group()
    root.position.set(x, 0, z)
    const model = relicModel(def.id)
    model.rotation.y = Math.random() * Math.PI * 2
    const holder = new THREE.Group()
    holder.add(model)
    const glint = new THREE.Sprite(glintMat.clone())
    glint.position.y = 0.9
    root.add(holder, glint)
    scene.add(root)
    lying.push({ def, root, holder, glint, phase: Math.random() * 6, flight: null })
  }

  let signal = 0
  let pingIn = 0
  return {
    defs,
    found,
    get signal() {
      return signal
    },
    // manual: the player is steering (finds only count then).
    update(t, dt, robot, manual) {
      let nearest = Infinity
      for (let i = lying.length - 1; i >= 0; i--) {
        const r = lying[i]
        if (r.flight !== null) {
          // Flying up into the robot's cargo box, shrinking as it goes.
          r.flight += dt / 0.6
          const k = Math.min(1, r.flight)
          r.root.position.lerp(new THREE.Vector3(robot.x, 0.8 * Math.sin(k * Math.PI) + k * 0.6, robot.z), Math.min(1, dt * 10))
          r.root.scale.setScalar(1 - k * 0.85)
          r.glint.material.opacity = 1 - k
          if (k >= 1) {
            scene.remove(r.root)
            lying.splice(i, 1)
          }
          continue
        }
        const d = Math.hypot(robot.x - r.root.position.x, robot.z - r.root.position.z)
        nearest = Math.min(nearest, d)
        // Bob and turn slowly; glint once the robot is near enough to notice.
        r.holder.position.y = 0.18 + Math.sin(t * 2 + r.phase) * 0.05
        r.holder.rotation.y += dt * 0.5
        const near = THREE.MathUtils.smoothstep(9 - d, 0, 4)
        r.glint.material.opacity = near * (0.55 + 0.45 * Math.sin(t * 4 + r.phase))
        r.glint.scale.setScalar(0.7 + 0.25 * Math.sin(t * 3 + r.phase))
        if (manual && d < PICKUP) {
          r.flight = 0
          found.add(r.def.id)
          save(sceneName, found)
          onCollect?.(r.def, found)
        }
      }
      signal = manual && nearest < RADAR ? 1 - nearest / RADAR : 0
      pingIn -= dt
      if (signal > 0 && pingIn <= 0) {
        pingIn = 1.5 - 1.3 * signal
        onPing?.(signal)
      }
    },
  }
}
