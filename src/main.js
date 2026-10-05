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
import { createWeather, createRain, applyWet, overcastEnvironment } from './weather.js'
import { createScavenge } from './scavenge.js'
import { createCollectionUI } from './collection.js'
import { createStory } from './story.js'
import { loading, loaded, within } from './loading.js'
import { lang, text, setLang } from './i18n.js'

// The page's own chrome, in the player's language.
document.getElementById('hint').textContent = text.hint
document.getElementById('sound').setAttribute('aria-label', text.sound)
document.getElementById('loading').setAttribute('aria-label', text.loading.aria)

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Scenes are picked by ?scene=; each brings its own look, start point and patrol route.
const SCENES = { meadow, ximending }
const requested = new URLSearchParams(location.search).get('scene')
// The story begins in the city.
const sceneName = requested in SCENES ? requested : 'ximending'
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

const hemi = new THREE.HemisphereLight(...look.hemi)
scene.add(hemi)
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

const world = await def.build(scene, within(0.1, 0.75))
await loading(0.75, text.loading.robot)
const robot = createRobot(...def.start, def.tour, world.nav)
scene.add(robot.object)

// Scavenging: relics to find, a radar to find them with, and a book to keep them in.
let audio = null
const scavenge = createScavenge(scene, sceneName, world.relics, {
  onCollect: (def, found) => {
    collection.collected(def)
    audio.chime()
    if (found.size === scavenge.defs.length) setTimeout(() => story.relicsDone(), 2500)
  },
  onPing: (signal) => audio.ping(signal),
})
const collection = createCollectionUI(scavenge.defs, scavenge.found)
const story = createStory(sceneName, world.story, {
  allFound: () => scavenge.found.size === scavenge.defs.length,
  goTo: (name) => (location.search = `?scene=${name}`),
})
await loading(0.77, text.loading.camera)
const { composer, ao, setRain } = createComposer(renderer, scene, camera)

// Weather: wet surfaces reflect an overcast sky, as strongly as they are wet.
applyWet(scene)
scene.environment = overcastEnvironment(renderer)
scene.environmentIntensity = 0
const rain = createRain()
scene.add(rain.object)
// The look each light lerps toward in a downpour.
const dry = { background: scene.background.clone(), fog: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far, hemi: hemi.intensity, sun: sun.intensity }
const STORM_GREY = new THREE.Color('#8b9296')

// Scenes with a plan to show get a corner map; clicking it sends the robot there.
const minimap = world.minimap ? createMinimap(world.minimap, (x, z) => robot.goTo(new THREE.Vector3(x, 0, z))) : null

// Browsers only allow audio after a user gesture, so the soundscape starts on first input.
audio = createAudio(def.ambience)
const weather = createWeather((delay) => audio.thunder(delay))
const soundButton = document.getElementById('sound')
const startAudio = () => {
  audio.start()
  soundButton.textContent = audio.enabled ? '🔊' : '🔇'
  document.getElementById('hint').classList.add('dim')
}
addEventListener('pointerdown', startAudio, { once: true })
addEventListener('keydown', startAudio, { once: true })
// Scenes built from map data carry its attribution.
if (def.attribution) document.getElementById('credit').innerHTML = `${text.credit} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${def.attribution}</a>`

// Switching scenes reloads the page: each scene owns the terrain and colliders it builds.
const sceneButton = document.getElementById('scene')
const other = sceneName === 'meadow' ? 'ximending' : 'meadow'
sceneButton.textContent = text.goTo(text.scenes[other])
sceneButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  location.search = `?scene=${other}`
})
soundButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  soundButton.textContent = audio.toggle() ? '🔊' : '🔇'
})
// Switching language reloads too, back into the same scene.
const langButton = document.getElementById('lang')
langButton.textContent = text.langButton
langButton.setAttribute('aria-label', text.langLabel)
langButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  setLang(lang === 'zh' ? 'en' : 'zh')
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

// Compile every shader before the first frame, so the scene appears whole instead of stalling.
await loading(0.78, text.loading.shaders)
await renderer.compileAsync(scene, camera)
await loading(0.88, text.loading.light)
composer.render(0)
loaded()
run()
setTimeout(() => story.start(), 800)

function step(dt) {
  windUniforms.uTime.value = t
  weather.update(dt)
  robot.update(t, dt, orbit.yaw)
  const goal = story.objective
  scavenge.update(t, dt, robot.position, !robot.touring, goal)
  story.update(robot.position)
  collection.setSignal(scavenge.signal)
  collection.setObjective(goal?.label)
  world.update(t, dt, robot.position)
  if (world.events) for (const e of world.events.splice(0)) audio.cue(e, robot.position)
  audio.update(dt, { listener: robot.position, robotSpeed: robot.speed, voices: world.voices, rain: weather.rain })

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

  // Rain greys the sky and closes the fog in; lightning flashes the whole scene.
  const r = weather.rain
  scene.background.copy(dry.background).lerp(STORM_GREY, r * 0.75)
  scene.fog.color.copy(dry.fog).lerp(STORM_GREY, r * 0.75)
  scene.fog.near = dry.near * (1 - 0.35 * r)
  scene.fog.far = dry.far * (1 - 0.2 * r)
  hemi.intensity = dry.hemi * (1 - 0.15 * r) + weather.flash * 2.5
  sun.intensity = dry.sun * (1 - 0.75 * r)
  scene.environmentIntensity = weather.wet * 0.6
  rain.update(focus)
  setRain(r)

  sun.position.copy(focus).addScaledVector(look.sunDirection, 40)
  sun.target.position.copy(focus)

  minimap?.update(robot.position, robot.heading, t)
  composer.render(dt)
}
