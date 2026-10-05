import { colliders } from './collision.ts'

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface NavOptions {
  cell?: number
  radius?: number
  clearance?: number
}

// A point on the XZ plane as [x, z].
export type XZ = [number, number]

/**
 * Navigation grid from the scene's own colliders: `cell`-metre squares over bounds, each
 * collider inflated by the robot's radius plus a little clearance. The largest connected
 * stretch of open cells is where the robot can roam (`reach`, also what the minimap shows);
 * findPath() plans routes through it with A*. Build it after every collider is in place.
 */
export function createNavGrid({ minX, maxX, minZ, maxZ }: Bounds, { cell = 0.5, radius = 0.38, clearance = 0.15 }: NavOptions = {}) {
  const cols = Math.ceil((maxX - minX) / cell)
  const rows = Math.ceil((maxZ - minZ) / cell)
  const size = cols * rows
  const blocked = new Uint8Array(size)
  for (const c of colliders) {
    const r = c.r + radius + clearance
    const i0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - r - minX) / cell))
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(c.ax, c.bx) + r - minX) / cell))
    const j0 = Math.max(0, Math.floor((Math.min(c.az, c.bz) - r - minZ) / cell))
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(c.az, c.bz) + r - minZ) / cell))
    const dx = c.bx - c.ax
    const dz = c.bz - c.az
    const len2 = dx * dx + dz * dz
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = minX + (i + 0.5) * cell
        const z = minZ + (j + 0.5) * cell
        const t = len2 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / len2)) : 0
        if (Math.hypot(x - c.ax - dx * t, z - c.az - dz * t) < r) blocked[j * cols + i] = 1
      }
    }
  }

  // 4-connected neighbours of cell k, or -1 off the grid.
  const neighbours = (k: number) => {
    const i = k % cols
    return [i + 1 < cols ? k + 1 : -1, i > 0 ? k - 1 : -1, k + cols < size ? k + cols : -1, k - cols]
  }

  // Label open cells into connected regions; the largest is the network the robot roams.
  const region = new Int32Array(size).fill(-1)
  let best = -1
  let bestSize = 0
  let regions = 0
  for (let seed = 0; seed < size; seed++) {
    if (blocked[seed] || region[seed] >= 0) continue
    const id = regions++
    const stack: number[] = [seed]
    region[seed] = id
    let count = 0
    while (stack.length) {
      const k = stack.pop()!
      count++
      for (const n of neighbours(k)) {
        if (n < 0 || blocked[n] || region[n] >= 0) continue
        region[n] = id
        stack.push(n)
      }
    }
    if (count > bestSize) {
      bestSize = count
      best = id
    }
  }
  const reach = new Uint8Array(size)
  for (let k = 0; k < size; k++) reach[k] = region[k] === best ? 1 : 0

  const cellOf = (x: number, z: number): XZ => [Math.floor((x - minX) / cell), Math.floor((z - minZ) / cell)]
  const centre = (k: number): XZ => [minX + ((k % cols) + 0.5) * cell, minZ + (Math.floor(k / cols) + 0.5) * cell]
  const open = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && reach[j * cols + i] === 1

  // The reachable cell nearest (x, z), searching outward ring by ring.
  function nearestOpen(x: number, z: number) {
    const [ci, cj] = cellOf(x, z)
    for (let r = 0; r < 80; r++) {
      let bestK = -1
      let bestD = Infinity
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !open(i, j)) continue
          const d = (i - ci) ** 2 + (j - cj) ** 2
          if (d < bestD) {
            bestD = d
            bestK = j * cols + i
          }
        }
      }
      if (bestK >= 0) return bestK
    }
    return -1
  }

  const walkable = (x: number, z: number) => open(...cellOf(x, z))

  // The straight line from (ax, az) to (bx, bz) stays on reachable ground.
  function sightline(ax: number, az: number, bx: number, bz: number) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.25))
    for (let s = 1; s < steps; s++) {
      if (!walkable(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps)) return false
    }
    return true
  }
  const clear = (a: number, b: number) => sightline(...centre(a), ...centre(b))

  // A random reachable spot between rMin and rMax from (x, z) in plain sight of it, or null.
  function spotNear(x: number, z: number, rMin: number, rMax: number, tries = 12): XZ | null {
    for (let n = 0; n < tries; n++) {
      const a = Math.random() * Math.PI * 2
      const r = rMin + Math.random() * (rMax - rMin)
      const sx = x + Math.cos(a) * r
      const sz = z + Math.sin(a) * r
      if (walkable(sx, sz) && sightline(x, z, sx, sz)) return [sx, sz]
    }
    return null
  }

  // Scratch arrays for A*, reused across searches; `run` tags which entries are current.
  const g = new Float32Array(size)
  const from = new Int32Array(size)
  const seen = new Uint32Array(size)
  const done = new Uint32Array(size)
  let run = 0
  const STEPS: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]

  /**
   * Route from (x0, z0) to (x1, z1) as [[x, z], ...] waypoints, pulled taut into straight
   * runs between the corners it has to turn. Both ends snap to the nearest reachable spot.
   * Returns [] when there is no way there.
   */
  function findPath(x0: number, z0: number, x1: number, z1: number): XZ[] {
    const start = nearestOpen(x0, z0)
    const goal = nearestOpen(x1, z1)
    if (start < 0 || goal < 0) return []
    run++
    const gi = goal % cols
    const gj = Math.floor(goal / cols)
    const h = (k: number) => {
      const dx = Math.abs((k % cols) - gi)
      const dy = Math.abs(Math.floor(k / cols) - gj)
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
    }
    const heap = new MinHeap()
    seen[start] = run
    g[start] = 0
    from[start] = -1
    heap.push(h(start), start)
    while (heap.size) {
      const k = heap.pop()
      if (done[k] === run) continue
      done[k] = run
      if (k === goal) break
      const i = k % cols
      const j = Math.floor(k / cols)
      for (const [di, dj, cost] of STEPS) {
        const ni = i + di
        const nj = j + dj
        if (!open(ni, nj)) continue
        // Never cut diagonally past a blocked corner.
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue
        const n = nj * cols + ni
        const ng = g[k] + cost
        if (seen[n] === run && ng >= g[n]) continue
        seen[n] = run
        g[n] = ng
        from[n] = k
        heap.push(ng + h(n), n)
      }
    }
    if (done[goal] !== run) return []
    const cells: number[] = []
    for (let k = goal; k >= 0; k = from[k]) cells.push(k)
    cells.reverse()
    // String-pull: from each kept cell, jump to the furthest one still in clear sight.
    const kept: number[] = []
    for (let at = 0; at < cells.length - 1; ) {
      let next = at + 1
      for (let k = cells.length - 1; k > next; k--) {
        if (clear(cells[at], cells[k])) {
          next = k
          break
        }
      }
      kept.push(cells[next])
      at = next
    }
    const path = kept.map(centre)
    // End exactly on the target when it is itself reachable.
    const [ti, tj] = cellOf(x1, z1)
    if (path.length && open(ti, tj)) path[path.length - 1] = [x1, z1]
    return path
  }

  // The reachable spot nearest (x, z), or null when there is none nearby.
  const snap = (x: number, z: number): XZ | null => {
    const k = nearestOpen(x, z)
    return k < 0 ? null : walkable(x, z) ? [x, z] : centre(k)
  }

  return { cols, rows, cell, reach, findPath, walkable, sightline, spotNear, snap }
}

export type NavGrid = ReturnType<typeof createNavGrid>

// Binary min-heap of (priority, value) pairs.
class MinHeap {
  keys: number[] = []
  values: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, value: number) {
    const { keys, values } = this
    let i = keys.length
    keys.push(key)
    values.push(value)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      values[i] = values[p]
      i = p
    }
    keys[i] = key
    values[i] = value
  }
  pop() {
    const { keys, values } = this
    const top = values[0]
    const key = keys.pop()!
    const value = values.pop()!
    if (keys.length) {
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = l < keys.length && keys[l] < key ? l : -1
        if (r < keys.length && keys[r] < (m < 0 ? key : keys[m])) m = r
        if (m < 0) break
        keys[i] = keys[m]
        values[i] = values[m]
        i = m
      }
      keys[i] = key
      values[i] = value
    }
    return top
  }
}
