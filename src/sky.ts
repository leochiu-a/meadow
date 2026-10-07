import * as THREE from 'three'

// Colours for a scene's sky dome: zenith and horizon haze, then the far and near ridges.
export interface SkyLook {
  zenith: THREE.ColorRepresentation
  haze: THREE.ColorRepresentation
  hills: [far: THREE.ColorRepresentation, near: THREE.ColorRepresentation]
}

// A dome that travels with the camera and paints everything past the edge of the world:
// a sky with drifting clouds, two ridges of distant hills, and below them the fog's own
// colour, so the fogged ground runs into the horizon without a seam. Drawn first and
// without depth, so whatever stands in the scene covers it.
export function createSky(look: SkyLook, fog: THREE.Fog) {
  const uniforms = {
    uZenith: { value: new THREE.Color(look.zenith) },
    uHaze: { value: new THREE.Color(look.haze) },
    uHillFar: { value: new THREE.Color(look.hills[0]) },
    uHillNear: { value: new THREE.Color(look.hills[1]) },
    uFog: { value: fog.color },
    uStorm: { value: new THREE.Color() },
    uRain: { value: 0 },
    uTime: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDir = world.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHaze, uHillFar, uHillNear, uFog, uStorm;
      uniform float uRain, uTime;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      // A ridge line around the horizon: whole-number frequencies, so it closes on itself.
      float ridge(float a, float s) {
        return sin(a * 3.0 + s) * 0.5 + sin(a * 7.0 + s * 2.1) * 0.25 + sin(a * 13.0 + s * 0.7) * 0.12 + sin(a * 31.0 + s * 1.3) * 0.05;
      }

      void main() {
        vec3 d = normalize(vDir);
        float e = d.y;
        float a = atan(d.z, d.x);

        vec3 sky = mix(uFog, uHaze, smoothstep(0.0, 0.06, e));
        sky = mix(sky, uZenith, smoothstep(0.05, 0.5, e));
        // Clouds on a flat ceiling, thinning toward the horizon.
        vec2 p = d.xz / max(e, 0.04) * 0.7 + vec2(uTime * 0.01, 0.0);
        float n = noise(p) * 0.55 + noise(p * 2.1) * 0.3 + noise(p * 4.3) * 0.15;
        float cloud = smoothstep(0.52, 0.78, n) * smoothstep(0.03, 0.25, e);
        sky = mix(sky, mix(vec3(1.0), uHaze, 0.25), cloud * 0.8);

        // Far rolling hills, then a nearer ridge scalloped with tree crowns, both hazed toward the fog.
        float aa = fwidth(e) * 1.5;
        float far = 0.032 + 0.016 * ridge(a, 1.0);
        float near = 0.012 + 0.01 * ridge(a, 4.0) + 0.006 * abs(sin(a * 70.0)) + 0.004 * abs(sin(a * 157.0 + 1.7));
        vec3 col = sky;
        col = mix(col, mix(uHillFar, uFog, 0.55), 1.0 - smoothstep(far - aa, far + aa, e));
        col = mix(col, mix(uHillNear, uFog, 0.25), 1.0 - smoothstep(near - aa, near + aa, e));
        col = mix(col, uFog, 1.0 - smoothstep(-aa, aa, e));

        // Rain greys the sky and sinks the hills into the fog.
        col = mix(col, uFog, uRain * 0.6);
        col = mix(col, uStorm, uRain * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const dome = new THREE.Mesh(new THREE.SphereGeometry(fog.far * 0.8, 48, 24), material)
  dome.renderOrder = -1
  dome.frustumCulled = false
  dome.name = 'sky'
  return {
    object: dome,
    update(t: number, camera: THREE.Camera, rain: number, storm: THREE.Color) {
      dome.position.copy(camera.position)
      uniforms.uTime.value = t
      uniforms.uRain.value = rain
      uniforms.uStorm.value.copy(storm)
    },
  }
}
