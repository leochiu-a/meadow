import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'

export const noise = new SimplexNoise({ random: mulberry32(7) })

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = mulberry32(42)
export const range = (a: number, b: number) => a + rand() * (b - a)
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// The active scene installs its height field before building anything that sits on it.
export interface Terrain {
  heightAt(x: number, z: number): number
}

let ground: Terrain = { heightAt: () => 0 }
export function setTerrain(terrain: Terrain) {
  ground = terrain
}
export const heightAt = (x: number, z: number) => ground.heightAt(x, z)
