import type { MeshStandardMaterial } from 'three'

// Weathering patch for MeshStandardMaterial: world-space grain and blotchy stains, grime
// rising from the ground, dust settling on upward faces, sun fading, and per-kind detail
// (wood grain, rust). Keeps props from reading as fresh plastic.
//
// kind: 'paint' (default), 'wood', 'metal', 'concrete' (rain streaks running down walls).
// grime and fade scale the effect. flood (metres, 0 = none) leaves the marks of floodwater
// on vertical faces: silt-stained below, a dark tide line where the water stood longest,
// and a fainter one from an earlier, lower flood.
export type WeatherKind = 'paint' | 'wood' | 'metal' | 'concrete'

export interface WeatherOptions {
  kind?: WeatherKind
  grime?: number
  fade?: number
  flood?: number
}

export function weathered<M extends MeshStandardMaterial>(material: M, { kind = 'paint', grime = 1, fade = 0.15, flood = 0 }: WeatherOptions = {}): M {
  if (kind !== 'metal') material.roughness = Math.max(material.roughness, 0.88)
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wpW = vec4(transformed, 1.0);
        vec3 wnW = objectNormal;
        #ifdef USE_INSTANCING
          wpW = instanceMatrix * wpW;
          wnW = mat3(instanceMatrix) * wnW;
        #endif
        vWPos = (modelMatrix * wpW).xyz;
        vWNrm = normalize(mat3(modelMatrix) * wnW);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float wHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float wNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float wBump = 0.0;
        {
          vec3 c = diffuseColor.rgb;
          float fine = wNoise(vWPos * 14.0) * 0.6 + wNoise(vWPos * 40.0) * 0.4;
          float blot = wNoise(vWPos * 1.3 + 11.0) * 0.7 + wNoise(vWPos * 3.7) * 0.3;
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(c, vec3(lum), ${fade.toFixed(3)});
          c *= 0.86 + 0.24 * fine;
          ${
            kind === 'wood'
              ? `// Grain runs along boards: across X on decks, up the faces of posts and boards.
          vec3 gp = abs(vWNrm.y) > 0.5 ? vec3(vWPos.x * 1.5, 0.0, vWPos.z * 30.0) : vec3(vWPos.x * 30.0, vWPos.y * 1.5, vWPos.z * 30.0);
          float grain = wNoise(gp) * 0.6 + wNoise(gp * 2.3) * 0.4;
          c *= 0.62 + 0.6 * grain;
          wBump += grain * 0.01;
          c = mix(c, vec3(lum) * vec3(1.02, 0.97, 0.88), 0.28);`
              : ''
          }
          ${
            kind === 'concrete'
              ? `// Rain streaks: dark runs down vertical faces, heavier toward the top edges.
          float run = wNoise(vec3((vWPos.x + vWPos.z) * 5.0, vWPos.y * 0.35, (vWPos.x - vWPos.z) * 5.0));
          float run2 = wNoise(vec3((vWPos.x - vWPos.z) * 1.7, vWPos.y * 0.15 + 3.0, 0.0));
          c *= 1.0 - smoothstep(0.45, 0.8, run * run2 * 1.6) * 0.45 * (1.0 - abs(vWNrm.y));`
              : ''
          }
          float g = ${grime.toFixed(3)};
          float stain = smoothstep(0.55, 0.85, blot);
          c = mix(c, c * vec3(0.55, 0.5, 0.42), stain * 0.6 * g);
          float low = 1.0 - smoothstep(0.02, 0.7, vWPos.y);
          c = mix(c, vec3(0.2, 0.16, 0.11), low * 0.42 * g);
          float up = smoothstep(0.55, 0.95, vWNrm.y);
          c = mix(c, vec3(0.62, 0.58, 0.5) * (0.8 + 0.3 * fine), up * 0.22 * g);
          ${
            kind === 'metal'
              ? `float rust = smoothstep(0.5, 0.72, wNoise(vWPos * 2.5 + 5.0) * 0.7 + fine * 0.3);
          c = mix(c, vec3(0.32, 0.15, 0.07) * (0.7 + 0.6 * fine), rust * 0.8);`
              : ''
          }
          ${
            flood
              ? `{
            float vert = 1.0 - abs(vWNrm.y);
            float wobble = (wNoise(vec3(vWPos.x * 0.6, 0.0, vWPos.z * 0.6)) - 0.5) * 0.14;
            float top = ${flood.toFixed(2)} + wobble;
            float below = 1.0 - smoothstep(top - 0.03, top + 0.005, vWPos.y);
            // Dried silt films everything below in muddy brown, heavier toward the ground where
            // the water stood longest.
            float depth = clamp((top - vWPos.y) / top, 0.0, 1.0);
            c = mix(c, vec3(0.47, 0.4, 0.3) * (0.8 + 0.35 * fine), below * (0.38 + 0.22 * depth) * vert);
            // Scum collected just under the surface: a darker band fading down from the line.
            float scum = below * (1.0 - smoothstep(0.0, 0.28, top - vWPos.y));
            c = mix(c, vec3(0.28, 0.22, 0.15), scum * 0.45 * vert);
            // The tide line itself: sharp on top, where the water's edge dried.
            float tide = smoothstep(top - 0.1, top - 0.02, vWPos.y) - smoothstep(top - 0.005, top + 0.01, vWPos.y);
            c = mix(c, vec3(0.16, 0.12, 0.08), tide * 0.9 * vert);
            float low = ${(flood * 0.55).toFixed(2)} + wobble * 0.7;
            float tide2 = smoothstep(low - 0.06, low - 0.01, vWPos.y) - smoothstep(low - 0.01, low + 0.012, vWPos.y);
            c = mix(c, vec3(0.28, 0.22, 0.15), tide2 * 0.55 * vert);
            // Silt dried in streaks that ran down from the tide line.
            float drip = wNoise(vec3((vWPos.x + vWPos.z) * 7.0, vWPos.y * 0.5, 0.0));
            c *= 1.0 - smoothstep(0.62, 0.88, drip) * below * 0.3 * vert;
          }`
              : ''
          }
          wBump += fine * 0.004 + stain * 0.003;
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Bump from a height field via screen-space derivatives (as three's bump map does).
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec2 dh = vec2(dFdx(wBump), dFdy(wBump));
          normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
        }`,
      )
  }
  material.customProgramCacheKey = () => `weathered-${kind}-${grime}-${fade}-${flood}`
  return material
}
