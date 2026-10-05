// Obstacles are 2D capsules on the XZ plane: a segment (a→b) inflated by radius r.
// A circle is a capsule whose ends coincide.
export interface Collider {
  ax: number
  az: number
  bx: number
  bz: number
  r: number
}

// Anything with an XZ position that resolve() can push out of colliders.
export interface PointXZ {
  x: number
  z: number
}

export const colliders: Collider[] = []

export function addCircle(x: number, z: number, r: number) {
  colliders.push({ ax: x, az: z, bx: x, bz: z, r })
}

export function addSegment(ax: number, az: number, bx: number, bz: number, r: number) {
  colliders.push({ ax, az, bx, bz, r })
}

export function resolve(pos: PointXZ, radius: number) {
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

// Coarse occupancy grid of collider footprints so foliage doesn't sprout through props.
export function buildBlockers(): (x: number, z: number) => boolean {
  const cell = 0.4
  const filled = new Set<number>()
  const key = (i: number, j: number) => i * 10000 + j
  for (const c of colliders) {
    const minX = Math.min(c.ax, c.bx) - c.r
    const maxX = Math.max(c.ax, c.bx) + c.r
    const minZ = Math.min(c.az, c.bz) - c.r
    const maxZ = Math.max(c.az, c.bz) + c.r
    for (let x = minX; x <= maxX; x += cell * 0.5) {
      for (let z = minZ; z <= maxZ; z += cell * 0.5) {
        const dx = c.bx - c.ax
        const dz = c.bz - c.az
        const len2 = dx * dx + dz * dz
        const t = len2 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / len2)) : 0
        if (Math.hypot(x - (c.ax + dx * t), z - (c.az + dz * t)) < c.r * 0.85) {
          filled.add(key(Math.round(x / cell), Math.round(z / cell)))
        }
      }
    }
  }
  return (x, z) => filled.has(key(Math.round(x / cell), Math.round(z / cell)))
}
