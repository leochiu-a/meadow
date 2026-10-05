// The district plan scripts/fetch-ximending.ts writes to src/data/ximending.json: OSM
// roads, building outlines and MRT exits in local metres (+x east, +z south of Exit 6).

type Pt = [x: number, z: number]

export interface Road {
  kind: string
  name: string | null
  width: number
  area: boolean
  colour: string | null
  pts: Pt[]
}

export interface Building {
  pts: Pt[]
  levels: number | null
  kind: string
  name: string | null
}

export interface Entrance {
  ref: string | null
  name: string | null
  x: number
  z: number
}

export interface DistrictPlan {
  attribution: string
  origin: { lat: number; lon: number }
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  roads: Road[]
  buildings: Building[]
  entrances: Entrance[]
}
