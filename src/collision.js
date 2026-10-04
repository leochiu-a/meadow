// Obstacles are 2D capsules on the XZ plane: a segment (a→b) inflated by radius r.
// A circle is a capsule whose ends coincide.
export const colliders = []

export function addCircle(x, z, r) {
  colliders.push({ ax: x, az: z, bx: x, bz: z, r })
}

export function addSegment(ax, az, bx, bz, r) {
  colliders.push({ ax, az, bx, bz, r })
}

export function resolve(pos, radius) {
  for (let iter = 0; iter < 3; iter++) {
    for (const c of colliders) {
      const dx = c.bx - c.ax
      const dz = c.bz - c.az
      const len2 = dx * dx + dz * dz
      let t = len2 > 0 ? ((pos.x - c.ax) * dx + (pos.z - c.az) * dz) / len2 : 0
      t = Math.max(0, Math.min(1, t))
      const px = c.ax + dx * t
      const pz = c.az + dz * t
      const ox = pos.x - px
      const oz = pos.z - pz
      const d = Math.hypot(ox, oz)
      const min = c.r + radius
      if (d < min && d > 1e-5) {
        pos.x = px + (ox / d) * min
        pos.z = pz + (oz / d) * min
      }
    }
  }
}
