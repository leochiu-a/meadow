// Fetch the Ximending street plan from OpenStreetMap (Overpass API) and write it as compact
// local-metre JSON for the ruined-Ximending scene. Run: node scripts/fetch-ximending.mjs
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL).
import { writeFileSync, mkdirSync } from 'node:fs'

// MRT Ximen Exit 6 is the origin; +x is east, +z is south (the scene camera looks north).
const ORIGIN = { lat: 25.0425347, lon: 121.5077239 }
const BBOX = { south: 25.0412, west: 121.5045, north: 25.0448, east: 121.5089 }
const PAD = 0.0004

const M_PER_LAT = 110574
const M_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
const toLocal = ({ lat, lon }) => [round((lon - ORIGIN.lon) * M_PER_LON), round(-(lat - ORIGIN.lat) * M_PER_LAT)]
const round = (v) => Math.round(v * 10) / 10

const box = (b, pad = 0) => `${b.south - pad},${b.west - pad},${b.north + pad},${b.east + pad}`
const query = `[out:json][timeout:120];
(
  way["building"](${box(BBOX)});
  relation["building"](${box(BBOX)});
  way["highway"](${box(BBOX, PAD)});
  way["area:highway"](${box(BBOX, PAD)});
  node["railway"="subway_entrance"](${box(BBOX)});
);
out geom tags;`

// Public Overpass servers are often busy: try each mirror a few times.
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
async function overpass() {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of MIRRORS) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'meadow-bot/1.0 (three.js diorama)', Accept: 'application/json' },
        body: new URLSearchParams({ data: query }),
      })
      if (res.ok) return res.json()
      console.warn(`${url}: ${res.status}`)
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Overpass unavailable')
}
const { elements } = await overpass()

// Carriageway width in metres by OSM highway class, sidewalks excluded.
const ROAD_WIDTH = {
  primary: 22, secondary: 14, tertiary: 10, unclassified: 7, residential: 7,
  pedestrian: 9, service: 4, living_street: 6, footway: 2.4, path: 2, steps: 2.4,
}

const roads = []
const buildings = []
const entrances = []
for (const e of elements) {
  const t = e.tags ?? {}
  if (e.type === 'node' && t.railway === 'subway_entrance') {
    const [x, z] = toLocal(e)
    entrances.push({ ref: t.ref ?? null, name: t.name ?? null, x, z })
  } else if (e.type === 'way' && t.highway && ROAD_WIDTH[t.highway] && e.geometry) {
    roads.push({ kind: t.highway, name: t.name ?? null, width: ROAD_WIDTH[t.highway], area: t.area === 'yes', pts: e.geometry.map(toLocal) })
  } else if (t.building) {
    // Relations contribute their outer rings.
    const rings = e.type === 'way' ? [e.geometry] : (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry)
    for (const ring of rings) {
      if (!ring || ring.length < 4) continue
      buildings.push({
        pts: ring.slice(0, -1).map(toLocal),
        levels: t['building:levels'] ? Number.parseInt(t['building:levels'], 10) : null,
        kind: t.building,
        name: t.name ?? null,
      })
    }
  }
}

const [west, north] = toLocal({ lat: BBOX.north, lon: BBOX.west })
const [east, south] = toLocal({ lat: BBOX.south, lon: BBOX.east })
mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../src/data/ximending.json', import.meta.url),
  JSON.stringify({ attribution: '© OpenStreetMap contributors (ODbL)', origin: ORIGIN, bounds: { minX: west, maxX: east, minZ: north, maxZ: south }, roads, buildings, entrances }),
)
console.log(`roads ${roads.length}, buildings ${buildings.length}, entrances ${entrances.length}, bounds x ${west}..${east} z ${north}..${south}`)
