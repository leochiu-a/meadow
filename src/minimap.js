// Corner minimap: the scene's own plan drawn once into a backing canvas, then each frame the
// robot's marker and the patch the camera is looking at. North is up, as in the scene.
// Clicking the map sends the robot there; M toggles it.

const SIZE = 232
const PAD = 8

/**
 * spec: { bounds: { minX, maxX, minZ, maxZ }, draw(ctx, px) } where px(x, z) → canvas [u, v].
 * onPick(x, z) is called with the world point under a click.
 */
export function createMinimap(spec, onPick) {
  const { minX, maxX, minZ, maxZ } = spec.bounds
  const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ)
  const w = Math.round((maxX - minX) * scale + PAD * 2)
  const h = Math.round((maxZ - minZ) * scale + PAD * 2)
  const dpr = Math.min(devicePixelRatio, 2)
  const px = (x, z) => [PAD + (x - minX) * scale, PAD + (z - minZ) * scale]
  const toWorld = (u, v) => [minX + (u - PAD) / scale, minZ + (v - PAD) / scale]

  // The static plan, drawn once.
  const plan = document.createElement('canvas')
  plan.width = w * dpr
  plan.height = h * dpr
  const pctx = plan.getContext('2d')
  pctx.scale(dpr, dpr)
  pctx.fillStyle = '#5d7d35'
  pctx.fillRect(0, 0, w, h)
  spec.draw(pctx, px)

  const canvas = document.createElement('canvas')
  canvas.id = 'minimap'
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  canvas.title = '點地圖讓機器人前往・M 開關地圖'
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    const r = canvas.getBoundingClientRect()
    onPick(...toWorld(e.clientX - r.left, e.clientY - r.top))
  })
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') canvas.classList.toggle('hidden')
  })

  return {
    // robot: world position and heading (radians, 0 = +x); view: camera focus point.
    update(robot, heading, view) {
      if (canvas.classList.contains('hidden')) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.drawImage(plan, 0, 0, w, h)
      // Roughly what the camera frames, around its focus.
      const [vx, vy] = px(view.x, view.z)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.strokeRect(vx - 14 * scale, vy - 10 * scale, 28 * scale, 18 * scale)
      // The robot: a white arrow pointing where it heads.
      const [rx, ry] = px(robot.x, robot.z)
      ctx.save()
      ctx.translate(rx, ry)
      ctx.rotate(-heading)
      ctx.beginPath()
      ctx.moveTo(8, 0)
      ctx.lineTo(-5, 5)
      ctx.lineTo(-2.5, 0)
      ctx.lineTo(-5, -5)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = 'rgba(20,24,16,0.9)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fill()
      ctx.restore()
    },
  }
}
