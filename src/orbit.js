// Camera orbit around the robot: drag to turn and tilt, wheel to zoom, Q / E to turn.
// A press that never moves far enough to count as a drag is reported as a click instead.

const PITCH = [0.3, 1.25]
const DISTANCE = [9, 28]
const DRAG_PX = 6

/** offset: the default [x, y, z] camera offset; onClick(event) for presses that were not drags. */
export function createOrbit(dom, offset, onClick) {
  const [ox, oy, oz] = offset
  const home = {
    yaw: Math.atan2(ox, oz),
    pitch: Math.atan2(oy, Math.hypot(ox, oz)),
    distance: Math.hypot(ox, oy, oz),
  }
  const goal = { ...home }
  const now = { ...home }
  const keys = new Set()
  let press = null

  dom.addEventListener('pointerdown', (e) => {
    press = { x: e.clientX, y: e.clientY, dragging: false }
    dom.setPointerCapture(e.pointerId)
  })
  dom.addEventListener('pointermove', (e) => {
    if (!press) return
    const dx = e.clientX - press.x
    const dy = e.clientY - press.y
    if (!press.dragging && Math.hypot(dx, dy) < DRAG_PX) return
    press.dragging = true
    press.x = e.clientX
    press.y = e.clientY
    goal.yaw -= dx * 0.006
    goal.pitch = clamp(goal.pitch + dy * 0.004, PITCH)
  })
  dom.addEventListener('pointerup', (e) => {
    if (press && !press.dragging) onClick(e)
    press = null
  })
  dom.addEventListener('pointercancel', () => (press = null))
  dom.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      goal.distance = clamp(goal.distance * Math.exp(e.deltaY * 0.0012), DISTANCE)
    },
    { passive: false },
  )
  // Double-click returns to the default framing.
  dom.addEventListener('dblclick', () => Object.assign(goal, home))
  addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()))
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

  return {
    // Horizontal angle of the camera around the robot (0 = looking north from the south).
    get yaw() {
      return now.yaw
    },
    // Turn the camera by `radians`, as Q / E would.
    turn(radians) {
      goal.yaw += radians
    },
    // Advance toward the goal framing and write the camera offset into `out`.
    update(dt, out) {
      goal.yaw += ((keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0)) * 1.6 * dt
      const k = 1 - Math.exp(-dt * 8)
      for (const key of ['yaw', 'pitch', 'distance']) now[key] += (goal[key] - now[key]) * k
      const flat = Math.cos(now.pitch) * now.distance
      return out.set(Math.sin(now.yaw) * flat, Math.sin(now.pitch) * now.distance, Math.cos(now.yaw) * flat)
    },
  }
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
