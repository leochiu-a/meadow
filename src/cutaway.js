import * as THREE from 'three'

// See-through cutaway: anything inside a capsule from the camera to the robot is dissolved
// with an ordered dither, so tall buildings between the two never hide the robot. Shadows
// still come from the full geometry because the depth pass isn't patched.
export const cutUniforms = {
  uCutA: { value: new THREE.Vector3() },
  uCutB: { value: new THREE.Vector3() },
  uCutR: { value: 6 },
}

// Wraps a material so it is cut away along the camera→robot line, keeping any existing patch.
export function withCutaway(material) {
  const inner = material.onBeforeCompile
  // Resolve the inner key now: three's default key is the patch source, which is about to change.
  const innerKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    inner?.call(material, shader, renderer)
    Object.assign(shader.uniforms, cutUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 cutW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cutW = instanceMatrix * cutW;
          #endif
          vCutPos = (modelMatrix * cutW).xyz;
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCutPos;
        uniform vec3 uCutA;
        uniform vec3 uCutB;
        uniform float uCutR;
        float bayer4(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          int i = int(q.x + q.y * 4.0);
          int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
          return (float(m[i]) + 0.5) / 16.0;
        }`,
      )
      .replace(
        'void main() {',
        `void main() {
        {
          vec3 ab = uCutB - uCutA;
          float t = clamp(dot(vCutPos - uCutA, ab) / dot(ab, ab), 0.0, 1.0);
          float d = length(vCutPos - (uCutA + ab * t));
          // Only between camera and robot, fading out just before the robot itself, and never
          // the street level, so arcades and kerbs still frame where the robot is.
          float inside = (1.0 - smoothstep(uCutR * 0.55, uCutR, d)) * (1.0 - smoothstep(0.86, 0.94, t)) * smoothstep(1.0, 2.0, vCutPos.y);
          if (inside > bayer4(gl_FragCoord.xy)) discard;
        }`,
      )
  }
  material.customProgramCacheKey = () => `cut-${innerKey}`
  return material
}
