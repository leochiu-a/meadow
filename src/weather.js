import * as THREE from 'three'
import { windUniforms } from './wind.js'

// Weather: clear spells and showers taking turns, or R to call one. `rain` is how hard it
// falls; `wet` follows it, soaking in within seconds and drying off slowly afterward.
// Everything else reads these: the rain streaks, the wet-surface patch, the light, the wind
// in the grass and the sound.

export const weatherUniforms = { uWet: { value: 0 }, uRain: { value: 0 }, uTime: windUniforms.uTime }

const CLEAR = [100, 200]
const SHOWER = [50, 110]
const rnd = ([a, b]) => a + Math.random() * (b - a)

// onThunder(delay) fires with each lightning flash; the clap follows `delay` seconds later.
export function createWeather(onThunder) {
  let raining = false
  let left = rnd(CLEAR)
  let rain = 0
  let wet = 0
  let flash = 0
  let nextBolt = 20
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'r' || e.repeat) return
    raining = !raining
    left = rnd(raining ? SHOWER : CLEAR)
  })
  return {
    get rain() {
      return rain
    },
    get wet() {
      return wet
    },
    // Lightning, 1 at the strike fading to 0.
    get flash() {
      return flash
    },
    update(dt) {
      left -= dt
      if (left <= 0) {
        raining = !raining
        left = rnd(raining ? SHOWER : CLEAR)
      }
      rain += ((raining ? 1 : 0) - rain) * (1 - Math.exp(-dt / 4))
      wet += (rain - wet) * (1 - Math.exp(-dt / (rain > wet ? 5 : 35)))
      // Now and then in a heavy shower, a flash, and the thunder after it.
      flash = Math.max(0, flash - dt * 3)
      if (rain > 0.7 && (nextBolt -= dt) <= 0) {
        nextBolt = 18 + Math.random() * 30
        flash = 1
        onThunder?.(1 + Math.random() * 2.5)
      }
      weatherUniforms.uRain.value = rain
      weatherUniforms.uWet.value = wet
      windUniforms.uStorm.value = rain
    },
  }
}

/**
 * Rain streaks in a box that follows the camera's focus: each streak falls on its own
 * phase and wraps around, so a few thousand lines read as rain everywhere you look.
 */
export function createRain(count = 7000) {
  const W = 34
  const H = 16
  const base = new Float32Array(count * 2 * 3)
  const end = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const z = Math.random() * W
    base.set([x, y, z, x, y, z], i * 6)
    end[i * 2 + 1] = 1
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3))
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1))
  const uniforms = { uFocus: { value: new THREE.Vector3() }, uRain: weatherUniforms.uRain, uTime: windUniforms.uTime }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aEnd;
      uniform vec3 uFocus;
      uniform float uTime;
      varying float vEnd;
      void main() {
        // Fall and wrap; tile the box around the focus so it never runs out.
        float y = mod(position.y - uTime * 14.0, ${H.toFixed(1)});
        vec3 p = vec3(
          uFocus.x + mod(position.x - uFocus.x + y * 0.12, ${W.toFixed(1)}) - ${(W / 2).toFixed(1)},
          y - 1.0,
          uFocus.z + mod(position.z - uFocus.z, ${W.toFixed(1)}) - ${(W / 2).toFixed(1)}
        );
        // The top end trails up and upwind, slanting the streak.
        p += aEnd * vec3(0.06, 0.55, 0.0);
        vEnd = aEnd;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRain;
      varying float vEnd;
      void main() {
        gl_FragColor = vec4(0.82, 0.86, 0.9, uRain * 0.42 * (0.35 + 0.65 * vEnd));
      }`,
  })
  const lines = new THREE.LineSegments(geo, material)
  lines.frustumCulled = false
  return {
    object: lines,
    update(focus) {
      uniforms.uFocus.value.copy(focus)
      lines.visible = weatherUniforms.uRain.value > 0.01
    },
  }
}

/**
 * Soaks every standard material in `scene` as `uWet` rises: darker and glossier, water
 * trickling down walls, and on the mesh named `ground` puddles that spread as the rain
 * goes on, rippled by the drops. Run once after the scene is built.
 */
export function applyWet(scene) {
  const done = new Set()
  scene.traverse((o) => {
    if (!o.isMesh) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m?.isMeshStandardMaterial || done.has(m)) continue
      done.add(m)
      soak(m, o.name === 'ground', m.userData.foliage)
    }
  })
}

// Foliage only darkens: glossy blades shimmer into dark streaks under the tilt-shift.
function soak(material, puddles, foliage) {
  const inner = material.onBeforeCompile
  const innerKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    inner?.call(material, shader, renderer)
    Object.assign(shader.uniforms, weatherUniforms)
    // worldpos_vertex survives every other patch here (the wind patch replaces project_vertex).
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;\nvarying vec3 vWetNrm;').replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      {
        vec4 wp = vec4(transformed, 1.0);
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWetPos = (modelMatrix * wp).xyz;
        vWetNrm = normalize(mat3(modelMatrix) * wn);
      }`,
    )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWet;
        uniform float uRain;
        uniform float uTime;
        varying vec3 vWetPos;
        varying vec3 vWetNrm;
        float wetHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float wetNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wetHash(i), wetHash(i + vec2(1, 0)), f.x), mix(wetHash(i + vec2(0, 1)), wetHash(i + vec2(1, 1)), f.x), f.y);
        }
        // Rings spreading from drops landing on a jittered grid, each on its own clock.
        float wetRipples(vec2 p) {
          float h = 0.0;
          vec2 cell = floor(p / 0.45);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            vec2 drop = (c + vec2(wetHash(c), wetHash(c + 7.1))) * 0.45;
            float age = fract(uTime * 1.3 + wetHash(c + 3.7));
            float d = length(p - drop) - age * 0.4;
            h += sin(d * 60.0) * (1.0 - smoothstep(0.0, 0.05, abs(d))) * (1.0 - age);
          }
          return h;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float wetPuddle = 0.0;
        if (uWet > 0.001) {
          float up = smoothstep(0.6, 0.95, vWetNrm.y);
          // Soaked: darker, and glossy where water films over it.
          diffuseColor.rgb *= 1.0 - ${foliage ? '0.22' : '0.38'} * uWet;
          ${foliage ? '' : 'roughnessFactor = mix(roughnessFactor, mix(0.5, 0.32, up), uWet);'}
          // Trickles running down walls.
          float trickle = wetNoise(vec2((vWetPos.x + vWetPos.z) * 9.0, vWetPos.y * 0.7 + uTime * 1.8));
          float run = smoothstep(0.72, 0.9, trickle) * (1.0 - up) * uWet * ${foliage ? '0.0' : '1.0'};
          diffuseColor.rgb *= 1.0 - run * 0.3;
          roughnessFactor = mix(roughnessFactor, 0.12, run);
          ${
            puddles
              ? `// Puddles fill the low spots first and spread as the rain goes on.
          float lowSpot = wetNoise(vWetPos.xz * 0.32) * 0.65 + wetNoise(vWetPos.xz * 1.1 + 9.0) * 0.35;
          float fill = 1.0 - 0.5 * uWet;
          wetPuddle = smoothstep(fill, fill + 0.04, lowSpot) * up;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45 + vec3(0.02, 0.025, 0.03), wetPuddle);
          roughnessFactor = mix(roughnessFactor, 0.04, wetPuddle);`
              : ''
          }
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (wetPuddle > 0.01) {
          // Ripples as a bump on the puddle surface, flattening the ground's own bumps.
          float rh = wetRipples(vWetPos.xz) * 0.0025 * wetPuddle * clamp(uRain * 1.5, 0.0, 1.0);
          vec3 px = dFdx(-vViewPosition);
          vec3 py = dFdy(-vViewPosition);
          vec3 r1 = cross(py, normal);
          vec3 r2 = cross(normal, px);
          float det = dot(px, r1) * faceDirection;
          vec2 dh = vec2(dFdx(rh), dFdy(rh));
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      )
  }
  material.customProgramCacheKey = () => `${innerKey}|wet-${puddles}-${foliage}`
}

/**
 * A soft overcast sky for wet surfaces to reflect, as an environment map. The scene's
 * environmentIntensity is driven by wetness, so dry surfaces keep their usual look.
 */
export function overcastEnvironment(renderer) {
  const sky = new THREE.Scene()
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = normalize(vDir).y;
          vec3 c = mix(vec3(0.32, 0.33, 0.33), vec3(0.78, 0.8, 0.82), smoothstep(-0.1, 0.25, h));
          c = mix(c, vec3(0.62, 0.65, 0.68), smoothstep(0.3, 1.0, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  )
  sky.add(dome)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(sky, 0.02).texture
  pmrem.dispose()
  return env
}
