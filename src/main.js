import * as THREE from 'three'
import meadow from './meadow.js'
import ximending from './ximending.js'
import { createRobot } from './robot.js'
import { createComposer } from './post.js'
import { windUniforms } from './wind.js'
import { createAudio } from './audio.js'
import { cutUniforms } from './cutaway.js'
import { createMinimap } from './minimap.js'
import { createOrbit } from './orbit.js'

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Scenes are picked by ?scene=; each brings its own look, start point and patrol route.
const SCENES = { meadow, ximending }
const requested = new URLSearchParams(location.search).get('scene')
const sceneName = requested in SCENES ? requested : 'meadow'
const def = SCENES[sceneName]
const { look } = def

const scene = new THREE.Scene()
scene.background = new THREE.Color(look.background)
scene.fog = new THREE.Fog(...look.fog)

// The far plane stops at the fog's end: nothing past it is visible anyway.
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, look.fog[2] + 5)
// Keep a fixed horizontal field of view so portrait windows see as much scene as landscape ones.
function fitCamera() {
  camera.aspect = innerWidth / innerHeight
  const hfov = THREE.MathUtils.degToRad(look.camera.hfov)
  camera.fov = Math.max(30, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect)))
  camera.updateProjectionMatrix()
}
fitCamera()

scene.add(new THREE.HemisphereLight(...look.hemi))
const sun = new THREE.DirectionalLight(...look.sun)
sun.castShadow = true
// The shadow box follows the robot and only needs to span what the camera sees.
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 90 })
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.03
sun.shadow.radius = 3
sun.shadow.intensity = 0.72
scene.add(sun, sun.target)

const world = def.build(scene)
const robot = createRobot(...def.start, def.tour, world.nav)
scene.add(robot.object)

const { composer, ao } = createComposer(renderer, scene, camera)

// Scenes with a plan to show get a corner map; clicking it sends the robot there.
const minimap = world.minimap ? createMinimap(world.minimap, (x, z) => robot.goTo(new THREE.Vector3(x, 0, z))) : null

// Browsers only allow audio after a user gesture, so the soundscape starts on first input.
const audio = createAudio(def.ambience)
const soundButton = document.getElementById('sound')
const startAudio = () => {
  audio.start()
  soundButton.textContent = audio.enabled ? '🔊' : '🔇'
  document.getElementById('hint').classList.add('dim')
}
addEventListener('pointerdown', startAudio, { once: true })
addEventListener('keydown', startAudio, { once: true })
// Scenes built from map data carry its attribution.
if (def.attribution) document.getElementById('credit').innerHTML = `地圖資料 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${def.attribution}</a>`

// Switching scenes reloads the page: each scene owns the terrain and colliders it builds.
const sceneButton = document.getElementById('scene')
const other = sceneName === 'meadow' ? 'ximending' : 'meadow'
sceneButton.textContent = `前往${SCENES[other].title}`
sceneButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  location.search = `?scene=${other}`
})
soundButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  soundButton.textContent = audio.toggle() ? '🔊' : '🔇'
})

// Drag to orbit the camera; a plain click on the ground sends the robot there.
const raycaster = new THREE.Raycaster()
const ground = scene.getObjectByName('ground')
const orbit = createOrbit(renderer.domElement, look.camera.offset, (e) => {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObject(ground)[0]
  if (hit) {
    robot.goTo(hit.point)
    audio.beep()
  }
})

addEventListener('resize', () => {
  fitCamera()
  renderer.setSize(innerWidth, innerHeight)
  composer.setSize(innerWidth, innerHeight)
  ao.setSize(innerWidth, innerHeight)
})

const focus = robot.position.clone()
const offset = orbit.update(0, new THREE.Vector3())
camera.position.copy(focus).add(offset)
camera.lookAt(focus)

// Power: at most 30 frames a second (a slow diorama loses little), and none at all while
// the window is in the background. Scene time only advances on rendered frames, so nothing
// jumps when it resumes.
const FRAME_MS = 1000 / 30
let last = 0
let t = 0
function frame(now) {
  if (now - last < FRAME_MS - 2) return
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 30
  last = now
  t += dt
  step(dt)
}
const run = () => renderer.setAnimationLoop(frame)
const pause = () => {
  renderer.setAnimationLoop(null)
  last = 0
}
addEventListener('blur', pause)
addEventListener('focus', run)
run()

function step(dt) {
  windUniforms.uTime.value = t
  robot.update(t, dt, orbit.yaw)
  world.update(t, dt, robot.position)
  if (world.events) for (const e of world.events.splice(0)) audio.cue(e, robot.position)
  audio.update(dt, { listener: robot.position, robotSpeed: robot.speed, voices: world.voices })

  // Camera trails the robot with a gentle drift, like a handheld miniature shot.
  focus.lerp(robot.position, 1 - Math.exp(-dt * 2.2))
  orbit.update(dt, offset)
  const sway = Math.sin(t * 0.13) * 0.6
  const drift = new THREE.Vector3(Math.cos(orbit.yaw) * sway, Math.sin(t * 0.17) * 0.25, -Math.sin(orbit.yaw) * sway)
  camera.position.copy(focus).add(offset).add(drift)
  camera.lookAt(focus.x, focus.y + 0.3, focus.z)

  // Dissolve whatever stands between the camera and the robot.
  cutUniforms.uCutA.value.copy(camera.position)
  cutUniforms.uCutB.value.copy(robot.position).y += 0.6

  sun.position.copy(focus).addScaledVector(look.sunDirection, 40)
  sun.target.position.copy(focus)

  minimap?.update(robot.position, robot.heading, t)
  composer.render(dt)
}
