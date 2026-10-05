import * as THREE from 'three'
import meadow from './meadow.ts'
import ximending from './ximending.ts'
import { createRobot } from './robot.ts'
import { createComposer } from './post.ts'
import { windUniforms } from './wind.ts'
import { createAudio } from './audio.ts'
import { cutUniforms } from './cutaway.ts'
import { createMinimap } from './minimap.ts'
import { createOrbit } from './orbit.ts'
import { createWeather, createRain, applyWet, overcastEnvironment } from './weather.ts'
import { createScavenge, foundIn } from './scavenge.ts'
import { RELICS } from './relics.ts'
import { createNotebook } from './notebook.ts'
import { createStory } from './story.ts'
import { ECHOES, createEchoes } from './echoes.ts'
import { createRoutine } from './routine.ts'
import { createCompanion } from './companion.ts'
import { createWishes } from './wishes.ts'
import { createSettings, loadLevels } from './settings.ts'
import { useAudio } from './voice.ts'
import { loading, loaded, within } from './loading.ts'
import { setLang, text } from './i18n.ts'
import { hasSave, clearSave, lastScene, keepScene, reenter, reentered } from './save.ts'
import { showMenu } from './menu.ts'
import type { SceneDef, SceneName, WorldEvent } from './world.ts'


// The page's own chrome (in index.html), in the player's language.
function byId(id: string) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`index.html has no #${id}`)
  return el
}
byId('hint').textContent = text.hint
byId('loading').setAttribute('aria-label', text.loading.aria)

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance', antialias: false, stencil: false })
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// Scenes are picked by ?scene=; each brings its own look, start point and patrol route.
const SCENES: Record<SceneName, SceneDef> = { meadow, ximending }
const isScene = (name: string | null): name is SceneName => name !== null && name in SCENES
const requested = new URLSearchParams(location.search).get('scene')
// Entering the game stops at the title menu, over the scene last played; the game reloading
// itself (switching scene or language) goes straight back in.
const entering = !reentered()
const saved = hasSave()
const wanted = isScene(requested) ? requested : lastScene()
const sceneName: SceneName = isScene(wanted) ? wanted : 'ximending'
if (requested !== sceneName) history.replaceState(null, '', `?scene=${sceneName}`)
keepScene(sceneName)
// Every reload from here on is the game travelling, not the player entering.
const travel = (name: SceneName) => {
  reenter()
  location.search = `?scene=${name}`
}
const def = SCENES[sceneName]
const { look } = def

const scene = new THREE.Scene()
const background = new THREE.Color(look.background)
const fog = new THREE.Fog(...look.fog)
scene.background = background
scene.fog = fog

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
// The shadow box moves with the robot in whole shadow-map texels, so thin shadows (reeds,
// leaves) stay put instead of shimmering as the camera glides. Snapped in the light's own
// frame: x and y across the map, z along the light.
const SHADOW_TEXEL = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x
const lightZ = look.sunDirection.clone().normalize()
const lightX = new THREE.Vector3(0, 1, 0).cross(lightZ).normalize()
const lightY = lightZ.clone().cross(lightX)
const snapped = new THREE.Vector3()
function snapToShadowTexels(p: THREE.Vector3) {
  const snap = (v: number) => Math.round(v / SHADOW_TEXEL) * SHADOW_TEXEL
  return snapped
    .copy(lightX)
    .multiplyScalar(snap(p.dot(lightX)))
    .addScaledVector(lightY, snap(p.dot(lightY)))
    .addScaledVector(lightZ, p.dot(lightZ))
}

const world = await def.build(scene, within(0.1, 0.75))
await loading(0.75, text.loading.robot)
const robot = createRobot(...def.start, def.tour, world.nav)
scene.add(robot.object)

// The soundscape, silent until the page has been clicked (see startAudio below).
const levels = loadLevels()
const audio = createAudio(def.ambience, def.music, levels)

// The story's pieces: relics to find and recordings to hear, a log to keep them in,
// the robot's daily routine, its dog, and the small unfinished things.
const scavenge = createScavenge(scene, sceneName, world.relics, {
  onCollect: (def) => {
    notebook.collected(def)
    audio.chime()
    story.collected()
  },
  onPing: (signal) => audio.ping(signal),
})
// What has been found in each scene: this one's live, the other's as it was left.
const found = { ximending: foundIn('ximending'), meadow: foundIn('meadow'), [sceneName]: scavenge.found }
const story = createStory(sceneName, world.landmarks, {
  goTo: travel,
  beginRoutine: () => routine?.begin(),
  play: (id) => echoes.replay(id),
  letGo: () => audio.release(),
  song: () => audio.song('box'),
  hasLetters: () => found.meadow.has('letter'),
})
// Recordings pan to the screen: `right` is the camera's rightward direction on the ground.
const echoes = createEchoes({ echo: (id, where) => audio.echo(id, { ...where, right: [Math.cos(orbit.yaw), -Math.sin(orbit.yaw)] }) }, world.echoes, {
  isOpen: (def) => story.open(def),
  onStart: (def, spot) => companion.heard(def, spot),
  onHeard: (def, heard) => {
    story.heard(def, heard)
    notebook.refresh()
  },
})
const notebook = createNotebook({
  relics: [...RELICS.ximending, ...RELICS.meadow],
  echoes: ECHOES,
  // The order things turned up in: the city's finds came before the village's.
  found: () => [...found.ximending, ...found.meadow],
  heard: () => [...echoes.heard],
  // The village's things only once the robot is on its way there; recordings once their act has begun.
  shown: (e) => (e.kind === 'echo' ? story.open(e) : found[e.scene].has(e.id) || e.scene === sceneName || story.city),
  released: () => story.released,
  onReplay: (id) => echoes.replay(id),
})
// Sounds the dog makes, alongside the scene's own.
const petEvents: WorldEvent[] = []
const companion = createCompanion(scene, world.nav, robot, petEvents)
const routine =
  sceneName === 'ximending'
    ? createRoutine({ landmarks: world.landmarks, animals: world.animals, robot, onGreet: (a) => companion.greeted(a), onDone: () => story.begin() })
    : null
const wishes = createWishes(scene, sceneName, world.landmarks, { song: (timbre) => audio.song(timbre), wheels: () => audio.wheels() }, echoes.heard)
// In the village the music box plays from the cottage now and then, as it does every evening.
let musicBoxIn = 20
await loading(0.77, text.loading.camera)
const { composer, ao, setRain, setPitch } = createComposer(renderer, scene, camera)

// Weather: wet surfaces reflect an overcast sky, as strongly as they are wet.
applyWet(scene)
scene.environment = overcastEnvironment(renderer)
scene.environmentIntensity = 0
const rain = createRain()
scene.add(rain.object)
// The look each light lerps toward in a downpour.
const dry = { background: background.clone(), fog: fog.color.clone(), near: fog.near, far: fog.far, hemi: hemi.intensity, sun: sun.intensity }
const STORM_GREY = new THREE.Color('#8b9296')

// Scenes with a plan to show get a corner map; clicking it sends the robot there.
const minimap = world.minimap ? createMinimap(world.minimap, (x, z) => robot.goTo(new THREE.Vector3(x, 0, z))) : null

// Browsers only allow audio after a user gesture, so the soundscape starts on first input.
useAudio(audio)
// Switching language reloads into the same place: back into play, or to the title menu.
// Scenes built from map data credit it at the foot of the panel.
const settings = createSettings(audio, levels, def.attribution, (code) => {
  if (!titled) reenter()
  setLang(code)
})
const weather = createWeather((delay) => audio.thunder(delay))
const startAudio = () => {
  audio.start()
  byId('hint').classList.add('dim')
}
addEventListener('pointerdown', startAudio, { once: true })
addEventListener('keydown', startAudio, { once: true })

// Switching scenes reloads the page: each scene owns the terrain and colliders it builds.
const sceneButton = byId('scene')
const other: SceneName = sceneName === 'meadow' ? 'ximending' : 'meadow'
sceneButton.textContent = text.goTo(text.scenes[other])
sceneButton.addEventListener('pointerdown', (e) => {
  e.stopPropagation()
  travel(other)
})

// Drag to orbit the camera; a plain click on the ground sends the robot there.
const raycaster = new THREE.Raycaster()
const ground = scene.getObjectByName('ground')
if (!ground) throw new Error(`the ${sceneName} scene has no ground`)
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
function frame(now: number) {
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
// The title menu: the scene idles behind it, the robot parked and the camera circling.
// Continue picks up here. A new game erases the save and reloads into the city, since every
// module above has already read its progress; with nothing saved there is nothing to erase.
let titled = entering
if (entering) {
  const choice = await showMenu(saved, settings.open)
  if (choice === 'new' && saved) {
    clearSave()
    travel('ximending')
    // The page is leaving: nothing below may run and save again.
    await new Promise(() => {})
  }
  titled = false
}
setTimeout(() => story.start(), 800)

function step(dt: number) {
  windUniforms.uTime.value = t
  weather.update(dt)
  // The robot stands still while the story log or the title menu is up.
  if (story.playing || titled) robot.hold(0.1)
  if (titled) orbit.turn(dt * 0.08)
  robot.update(t, dt, orbit.yaw)
  const goal = story.objective
  const busy = story.playing || titled || !!echoes.playing
  // In the city the radar only switches on once the story has begun.
  const radar = sceneName === 'meadow' || story.begun
  scavenge.update(t, dt, robot.position, !robot.touring, goal, echoes.beacons(), radar)
  echoes.update(robot.position, story.playing || titled)
  story.update(robot.position, !robot.touring)
  notebook.setRadar(radar)
  notebook.setSignal(scavenge.signal)
  notebook.setObjective(goal?.label)
  world.update(t, dt, robot.position)
  routine?.update(dt, { speed: robot.speed, rain: weather.rain, events: world.events })
  companion.update(t, dt, busy)
  wishes.update(dt, robot.position, robot.speed)
  if (world.landmarks.cottage && !busy && (musicBoxIn -= dt) <= 0) {
    const [cx, cz] = world.landmarks.cottage
    musicBoxIn = Math.hypot(robot.position.x - cx, robot.position.z - cz) < 18 ? 110 : 5
    if (musicBoxIn > 5) audio.song('box')
  }
  if (world.events) for (const e of world.events.splice(0)) audio.cue(e, robot.position)
  for (const e of petEvents.splice(0)) audio.cue(e, robot.position)
  audio.update(dt, { listener: robot.position, robotSpeed: robot.speed, voices: world.voices, rain: weather.rain })

  // Camera trails the robot with a gentle drift, like a handheld miniature shot.
  focus.lerp(robot.position, 1 - Math.exp(-dt * 2.2))
  orbit.update(dt, offset)
  setPitch(orbit.pitch)
  const sway = Math.sin(t * 0.13) * 0.6
  const drift = new THREE.Vector3(Math.cos(orbit.yaw) * sway, Math.sin(t * 0.17) * 0.25, -Math.sin(orbit.yaw) * sway)
  camera.position.copy(focus).add(offset).add(drift)
  camera.lookAt(focus.x, focus.y + 0.3, focus.z)

  // Dissolve whatever stands between the camera and the robot.
  cutUniforms.uCutA.value.copy(camera.position)
  cutUniforms.uCutB.value.copy(robot.position).y += 0.6

  // Rain greys the sky and closes the fog in; lightning flashes the whole scene.
  const r = weather.rain
  background.copy(dry.background).lerp(STORM_GREY, r * 0.75)
  fog.color.copy(dry.fog).lerp(STORM_GREY, r * 0.75)
  fog.near = dry.near * (1 - 0.35 * r)
  fog.far = dry.far * (1 - 0.2 * r)

  hemi.intensity = dry.hemi * (1 - 0.15 * r) + weather.flash * 2.5
  sun.intensity = dry.sun * (1 - 0.75 * r)
  scene.environmentIntensity = weather.wet * 0.6
  rain.update(focus)
  setRain(r)

  const shadowAt = snapToShadowTexels(focus)
  sun.position.copy(shadowAt).addScaledVector(look.sunDirection, 40)
  sun.target.position.copy(shadowAt)

  minimap?.update(robot.position, robot.heading, t)
  composer.render(dt)
}
