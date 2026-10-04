import * as THREE from 'three'
import { heightAt, setTerrain, noise, rand, range, pick } from './terrain.js'
import { meadowTerrain, createGround, surfaceAt, grassColor, PLAZA } from './meadow-terrain.js'
import { buildBlockers } from './collision.js'
import { createNavGrid } from './walkmap.js'
import { brickWall, brickPillar, brickArch, brickRubble, fallenChunk, flushBricks } from './bricks.js'
import * as props from './props.js'
import { createGrass, createFlowers, createReeds, createLupines, createIvy, createTree, createSapling, createBush } from './vegetation.js'
import { createCow, createChicken, createFox, createVillager } from './animals.js'
import { graffitiOnWall } from './graffiti.js'

// Where grass grows and how tall: thin on the path, creeping into the plaza from its
// edges, lumpy clumps everywhere else, taller on the dry field.
function meadowGrass(blocked) {
  return (x, z, color) => {
    const s = surfaceAt(x, z)
    if (rand() < s.path * 0.97) return 0
    if (s.plaza) {
      const margin = Math.min(x - PLAZA.minX, PLAZA.maxX - x, PLAZA.maxZ - z)
      const overgrown = Math.max(1 - margin / 3.5, noise.noise(x * 0.4 + 9, z * 0.4) - 0.25)
      if (rand() > overgrown * 0.55 + 0.01) return 0
    }
    if (blocked(x, z)) return 0
    const clump = noise.noise(x * 0.5, z * 0.5) * 0.5 + 0.5
    if (rand() > 0.6 + clump * 0.4) return 0
    const tall = s.dry > 0.5 ? range(0.32, 0.6) : range(0.24, 0.46) * (0.75 + clump * 0.6)
    // Clump-scale light and dark patches give the lawn its soft, lumpy read.
    const patch = noise.noise(x * 0.9 + 3, z * 0.9) * 0.5 + 0.5
    grassColor(x, z, color).offsetHSL(range(-0.02, 0.02) + (patch - 0.5) * 0.03, range(-0.04, 0.04), (patch - 0.5) * 0.14 + range(-0.04, 0.04))
    return tall * (1 - s.path * 0.6)
  }
}

const SPECKS = ['#ffffff', '#f2eefc', '#e3dcf6', '#d9d2f2', '#fffbe8']
const DRIFTS = [
  ['#ff5a5a', '#ff7a6a', '#f04a4a'],
  ['#6f8cff', '#8aa4ff', '#5f78f0'],
  ['#c88cff', '#b07af0', '#d9a8ff'],
  ['#ff8fb8', '#ffb3cf'],
]

// Pale specks scatter in loose swathes; saturated colours only in tight drifts.
function meadowFlowers(blocked) {
  return (x, z) => {
    const s = surfaceAt(x, z)
    if (s.path > 0.2 || s.plaza || s.dry > 0.6 || blocked(x, z)) return null
    const swathe = noise.noise(x * 0.12 - 20, z * 0.12) * 0.5 + 0.5
    const field = noise.noise(x * 0.18 + 30, z * 0.18) * 0.5 + 0.5
    const big = field > 0.76
    if (!big && rand() > swathe ** 1.5 * 0.8) return null
    const paletteIdx = Math.floor((noise.noise(x * 0.07, z * 0.07 + 9) * 0.5 + 0.5) * 3.99) % 4
    return { color: big ? pick(DRIFTS[paletteIdx]) : pick(SPECKS), big }
  }
}

function build(scene) {
  setTerrain(meadowTerrain)
  const updaters = []
  scene.add(createGround())

  // --- Village plaza at the back ---
  scene.add(props.cobblestones(PLAZA))
  const houses = [
    [-9, -29.5, { w: 7, railing: 1, tags: [0], piece: true }],
    [-1, -30, { w: 6.5, door: 0, pergola: true, tags: [1] }],
    [7.5, -29.5, { w: 7.5, bench: true, railing: 2, tags: [0, 1] }],
    [16, -29, { w: 6, door: 1, piece: true }],
  ]
  for (const [x, z, o] of houses) scene.add(props.cottage(x, z, o))
  scene.add(props.stall(-6, -21.5, 0.2, '#d94b4b'))
  scene.add(props.stringLights([-11, -15], [-2, -25]))
  scene.add(props.stringLights([3, -16], [13, -25.5], 3.9))
  scene.add(props.shed(3.2, -16.8, -0.25))
  scene.add(props.planterBed(8, -17.5, 0.12))
  scene.add(props.tire(10.2, -16.4))
  scene.add(props.plasticBarrel(12, -15.8))
  scene.add(props.roadBarrier(7.4, -13.6, 0.5))
  scene.add(props.trafficCone(6.2, -14.2))
  scene.add(props.trafficCone(-2.6, -19.5))
  scene.add(props.barrel(-8.5, -16, 0, false))
  scene.add(props.barrel(-7.5, -15.3, 0, false))
  scene.add(props.fence([[-13, -13.5], [-13, -21], [-12, -26]]))
  scene.add(props.plankPile(1.5, -21, 0.4))

  // --- Brick walls ---
  const longWall = brickWall(
    [[-9.5, -11.3], [-6, -10], [-4.2, -8.4], [-3.9, -5.5], [-4.6, -1], [-6.2, 3.5], [-8.6, 8], [-11.5, 11.5]],
    { rows: 7 },
  )
  // Barrels continue the wall's line toward the far corner.
  for (let i = 0; i < 6; i++) {
    const t = i / 5
    scene.add(props.barrel(-10.6 - t * 6.5, -11.7 - t * 3.2, -0.45 + range(-0.08, 0.08)))
  }
  brickWall([[2.2, -11.6], [6, -11.2], [10, -11.1], [12.7, -11]], { rows: 4, ruin: 0.35 })
  brickPillar(13.1, -11, { rows: 13 })
  brickPillar(16.3, -11, { rows: 13 })
  scene.add(props.ironGate(14.7, -11, 0, 2.6))
  const gateWall = brickWall([[16.9, -11], [21, -10.6], [26, -11.5]], { rows: 5 })
  brickWall([[-4.5, -12.3], [-1, -12.1]], { rows: 3, ruin: 0.5 })
  brickPillar(-0.6, -12.1, { rows: 9 })
  brickPillar(1.8, -11.6, { rows: 15 })

  // Graffiti on the meadow-facing sides of the walls.
  for (const [curve, t, opts] of [
    [longWall, 0.075, { side: 1, width: 1.8, y: 0.95, style: 'piece' }],
    [longWall, 0.72, { side: -1, width: 1.2, y: 0.9 }],
    [gateWall, 0.3, { side: 1, width: 1.6, y: 0.62, style: 'piece' }],
    [gateWall, 0.62, { side: 1, width: 1.0, y: 0.6 }],
  ]) {
    const p = curve.getPointAt(t)
    scene.add(graffitiOnWall(curve, t, { ...opts, ground: heightAt(p.x, p.z) }))
  }

  // --- Meadow landmarks ---
  brickArch(5.4, -1.8, 0.25, scene)
  brickWall([[2.9, -1.2], [1.2, -0.9]], { rows: 4, ruin: 0.4 })
  brickWall([[7.9, -2.4], [9.4, -2.9]], { rows: 3, ruin: 0.5 })
  brickPillar(11.6, 1.2, { rows: 12, tilt: 0.22, dir: 0.4 })
  brickPillar(-1.8, 12.5, { rows: 8, tilt: -0.15, dir: 1 })
  fallenChunk(0.4, 4.3, 0.7, 1.15, 3, 3)
  fallenChunk(2.6, 6.8, -0.4, 0.5, 4, 3)
  fallenChunk(-2.8, 1.4, 1.9, 1.35, 2, 4)
  brickRubble(1.6, 5.4, 8)
  brickRubble(9.3, -2, 6)
  scene.add(props.utilityPole(9.4, 3.2, 0.3))
  scene.add(props.utilityPole(14, 15, 0.3))
  scene.add(props.feedCrate(8, 7, -0.3))
  scene.add(props.plankPile(-1.4, -8.6, 0.35))
  scene.add(props.plankPile(-2.6, -7, 0.2))
  scene.add(props.plankPile(-7.6, -4, 1.1))
  scene.add(props.fence([[19, 2], [22, 9], [21, 16]]))

  scene.add(createTree(4.6, -8.2, 1.1))
  scene.add(createTree(-0.8, -5.2, 0.75))
  scene.add(createTree(20, -6.5, 1.3))
  scene.add(createTree(-14.5, 3, 1.0))
  scene.add(createTree(-12, 15, 1.25))
  scene.add(createTree(17.5, 12.5, 1.15))
  scene.add(createTree(-4, 19, 1.3))
  scene.add(createTree(25, 2, 1.4))
  scene.add(createSapling(2.1, 3.1))
  scene.add(createSapling(-6.8, 13.5))
  for (const [x, z, s] of [
    [-2.8, -2.6, 0.9], [6.6, -9.7, 1], [14, -3.5, 1.1], [-8, 7, 1], [18, 7.5, 1.2],
    [-3.2, -10.2, 0.8], [3.3, -2.8, 0.7], [8.2, -1.2, 0.6], [12.5, 9, 0.9], [-1, 15, 1.1],
    [5, 13, 1], [22, -2, 1.3], [-17, 8, 1.2], [10.5, -9.5, 0.8], [0.5, 9.8, 0.7],
  ]) {
    scene.add(createBush(x, z, s))
  }

  const cows = [createCow(-2.4, 9.6, 0.4), createCow(12.6, -7.6, 2.6), createCow(16.5, 4.2, -0.4), createCow(-9.5, -2, 1.8)]
  const chickens = [createChicken(0.8, -8), createChicken(-1.5, -15), createChicken(6, -16.5), createChicken(3.8, 1.8)]
  const foxes = [createFox(4.2, 0.6), createFox(-7, 10)]
  const villagers = [
    // Down the dirt path and back up the other verge.
    createVillager([[14.4, -10], [13.9, -7], [12.9, -2], [11.2, 3], [12.5, 9], [10.8, 15], [11.5, 15.4], [13.1, 9], [11.8, 3], [13.5, -2], [14.5, -7], [15, -10]]),
    // A stroll around the plaza.
    createVillager([[-3, -18.6], [2, -19.5], [8, -20], [12, -21.5], [7, -24], [0, -24], [-4, -22.5]], {
      top: '#8a5a3a',
      bottom: '#5d6b7a',
      skin: '#f0c8a8',
      hair: '#e8e4dc',
      hood: false,
    }),
  ]
  for (const a of [...cows, ...chickens, ...foxes, ...villagers]) {
    scene.add(a.object)
    updaters.push(a.update)
  }

  scene.add(flushBricks())

  // --- Foliage last, so it can avoid every prop's footprint ---
  const blocked = buildBlockers()
  scene.add(createGrass({ bounds: [-46, 46, -40, 42], target: 200000, place: meadowGrass(blocked) }))
  scene.add(props.litter(blocked, { minX: PLAZA.minX - 4, maxX: PLAZA.maxX + 4, minZ: PLAZA.minZ, maxZ: PLAZA.maxZ + 6 }))
  scene.add(createFlowers({ bounds: [-44, 44, -38, 40], target: 70000, place: meadowFlowers(blocked) }))
  const reedSpots = []
  for (let i = 0; i < 26; i++) {
    const t = rand()
    const p = longWall.getPointAt(t)
    reedSpots.push([p.x + range(0.5, 1.2), p.z + range(-0.4, 0.4), range(0.4, 0.8)])
  }
  for (let i = 0; i < 14; i++) reedSpots.push([range(-24, -8), range(-10, 10), range(0.5, 1)])
  reedSpots.push([4, -10.2, 0.7], [8.5, -10.2, 0.6], [11.4, -9.8, 0.6], [12.3, 1.8, 0.5], [7, -0.6, 0.5])
  scene.add(createReeds(reedSpots.filter(([x, z]) => !blocked(x, z))))

  // Lupines crowd the arch's right side and dot the wall feet, as in the reference.
  const lupineSpots = [[7.3, -0.9, 0.45], [6.5, -0.6, 0.35], [7.9, -1.9, 0.35], [3.9, -0.7, 0.3], [-3.2, -6.5, 0.4], [-5.3, 2.2, 0.45], [15.3, -10, 0.4], [-2.6, -11.2, 0.35]]
  scene.add(createLupines(lupineSpots.filter(([x, z]) => !blocked(x, z))))
  // Ivy spilling over the arch's shoulder.
  const ag = heightAt(5.4, -1.8)
  scene.add(
    createIvy([
      { from: [6.6, ag + 1.55, -1.6], to: [7.0, ag + 0.2, -1.2], leaves: 70 },
      { from: [6.2, ag + 1.75, -2.2], to: [6.9, ag + 0.4, -2.5], leaves: 55 },
      { from: [4.0, ag + 1.6, -1.6], to: [3.9, ag + 0.6, -1.3], leaves: 30, spread: 0.14 },
    ]),
  )

  return {
    // Routes for the robot, planned around everything placed above.
    nav: createNavGrid({ minX: -46, maxX: 46, minZ: -40, maxZ: 42 }),
    update(t, dt) {
      for (const u of updaters) u(t, dt)
    },
    cows: cows.map((c) => c.object.position),
    chickens: chickens.map((c) => c.object.position),
  }
}

// Sunny overgrown village: warm low sun, green-tinted shade, a grassy horizon.
export default {
  title: '草原',
  look: {
    background: '#8fbf4a',
    fog: ['#a9cc62', 55, 130],
    hemi: ['#a8dcff', '#5f8f30', 1.05],
    sun: ['#ffd49a', 4.6],
    sunDirection: new THREE.Vector3(-12, 13, -9).normalize(),
    camera: { offset: [0, 11, 12.5], hfov: 33 },
  },
  start: [0.6, -7.5],
  // Route that wanders past the landmarks, like the camera move in the reference clip.
  tour: [
    [0.6, -9.5], [0.6, -14.5], [-1, -22.5], [5, -23.5], [5.2, -19.5], [1.2, -19], [0.6, -14], [0.6, -9.5],
    [-2, -4], [-0.5, 1.5], [-2, 7.2], [4.5, 10], [9.5, 9.5], [10.6, 4.6], [10.5, -0.5],
    [6, 0.6], [2.4, 0.3], [0.2, -0.4], [0.6, -3.6], [2.4, -8.6],
  ],
  build,
}
