import type * as THREE from 'three'
import type { NavGrid, XZ } from './walkmap.ts'
import type { Progress } from './loading.ts'
import type { MinimapSpec } from './minimap.ts'
import type { Stray } from './strays.ts'
import type { Ambience } from './audio.ts'

// What a scene module provides (meadow.ts, ximending.ts) and what its build hands back to
// main.ts: the shared contract between the scenes and the story's pieces.

export type SceneName = 'ximending' | 'meadow'

// Where something lies in the scene: a relic, or the start of a recording.
export interface Placement {
  id: string
  x: number
  z: number
}

// A recording's spot; `path`, when given, is the line it sounds along (from → to).
export interface EchoSpot {
  x: number
  z: number
  path?: readonly [XZ, XZ]
}

// A sound worth playing that happened somewhere in the world this frame.
export interface WorldEvent {
  kind: string
  x: number
  z: number
}

// The places the story and the robot's habits look for, those this scene has.
export interface Landmarks {
  finale?: XZ
  wake?: XZ
  crossing?: XZ | null
  patrol?: XZ[]
  cinema?: XZ
  redHouse?: XZ
  square?: XZ
  cottage?: XZ
  stall?: XZ
}

// Where each kind of animal voice comes from, for the soundscape.
export type Voices = Partial<Record<'cat' | 'dog' | 'pigeon' | 'cow' | 'chicken', THREE.Vector3[]>>

export interface World {
  nav: NavGrid
  landmarks: Landmarks
  relics: Placement[]
  echoes?: Record<string, EchoSpot>
  animals?: Stray[]
  events?: WorldEvent[]
  voices: Voices
  minimap?: MinimapSpec
  update(t: number, dt: number, robot: THREE.Vector3): void
}

export interface Look {
  background: THREE.ColorRepresentation
  fog: [color: THREE.ColorRepresentation, near: number, far: number]
  hemi: [sky: THREE.ColorRepresentation, ground: THREE.ColorRepresentation, intensity: number]
  sun: [color: THREE.ColorRepresentation, intensity: number]
  sunDirection: THREE.Vector3
  camera: { offset: [number, number, number]; hfov: number }
}

export interface SceneDef {
  look: Look
  ambience?: Ambience
  music: string
  start: XZ
  tour: XZ[]
  attribution?: string
  build(scene: THREE.Scene, progress: Progress): Promise<World>
}
