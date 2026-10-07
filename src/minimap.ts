import { text } from './i18n.ts'
import type { Bounds, XZ } from './walkmap.ts'
import type { PointXZ } from './collision.ts'

// World (x, z) to map canvas [u, v].
export type ToMap = (x: number, z: number) => XZ
export interface MinimapSpec {
  bounds: Bounds
  title?: string
  draw(ctx: CanvasRenderingContext2D, px: ToMap): void
}

// Corner minimap in a game-UI frame: the scene's own plan drawn once into a backing canvas,
// then each frame the robot's marker with a breathing halo. North is up, as in the scene.
// Clicking the map sends the robot there; M toggles it.

const SIZE = 220
const PAD = 6

/**
 * spec: { bounds: { minX, maxX, minZ, maxZ }, title, draw(ctx, px) } where px(x, z) → canvas
 * [u, v]. onPick(x, z) is called with the world point under a click.
 */
export function createMinimap(spec: MinimapSpec, onPick: (x: number, z: number) => void) {
  const { minX, maxX, minZ, maxZ } = spec.bounds
  const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ)
  const w = Math.round((maxX - minX) * scale + PAD * 2)
  const h = Math.round((maxZ - minZ) * scale + PAD * 2)
  const dpr = Math.min(devicePixelRatio, 2)
  const px: ToMap = (x, z) => [PAD + (x - minX) * scale, PAD + (z - minZ) * scale]
  const toWorld = (u: number, v: number): XZ => [minX + (u - PAD) / scale, minZ + (v - PAD) / scale]

  // The static plan, drawn once at map resolution.
  const plan = document.createElement('canvas')
  plan.width = w * dpr
  plan.height = h * dpr
  const pctx = plan.getContext('2d')!
  pctx.scale(dpr, dpr)
  spec.draw(pctx, px)

  const frame = document.createElement('div')
  frame.id = 'minimap'
  frame.innerHTML = `<div class="ribbon">${spec.title ?? ''}</div><div class="compass">N</div>`
  const canvas = document.createElement('canvas')
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.title = text.minimap.hint
  frame.appendChild(canvas)
  document.body.appendChild(frame)
  const ctx = canvas.getContext('2d')!

  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    const r = canvas.getBoundingClientRect()
    onPick(...toWorld(e.clientX - r.left, e.clientY - r.top))
  })
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') frame.classList.toggle('hidden')
  })

  return {
    // robot: world position; heading in radians (0 = +x). marks: places to point the player at.
    update(robot: PointXZ, heading: number, t: number, marks: PointXZ[] = []) {

      if (frame.classList.contains('hidden')) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.drawImage(plan, 0, 0, w, h)
      // Marks: an orange dot with a ripple, a beat behind the robot's own.
      const ripple = (t * 0.9 + 0.5) % 1
      for (const m of marks) {
        const [mx, my] = px(m.x, m.z)
        ctx.strokeStyle = `rgba(210,100,58,${0.9 * (1 - ripple)})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(mx, my, 4 + ripple * 8, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#d2643a'
        ctx.strokeStyle = '#fff6e2'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(mx, my, 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      const [rx, ry] = px(robot.x, robot.z)
      // Breathing halo.
      const pulse = (t * 0.9) % 1
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - pulse)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(rx, ry, 7 + pulse * 9, 0, Math.PI * 2)
      ctx.stroke()
      // White disc with an orange arrow pointing where the robot heads.
      ctx.save()
      ctx.translate(rx, ry)
      ctx.fillStyle = 'rgba(40,30,15,0.35)'
      ctx.beginPath()
      ctx.arc(0, 1.5, 7.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(0, 0, 7.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.rotate(-heading)
      ctx.fillStyle = '#ff7a2a'
      ctx.beginPath()
      ctx.moveTo(5.5, 0)
      ctx.lineTo(-3.5, 4)
      ctx.lineTo(-1.5, 0)
      ctx.lineTo(-3.5, -4)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    },
  }
}
