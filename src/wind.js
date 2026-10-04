// Shared wind uniforms; patched into instanced foliage materials so blades sway in world
// space. uStorm (0–1) whips them harder in the rain.
export const windUniforms = { uTime: { value: 0 }, uStorm: { value: 0 } }

export function applyWind(material, { strength = 0.25, heightRef = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime
    shader.uniforms.uStorm = windUniforms.uStorm
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStorm;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wPos = modelMatrix * mvPosition;
        float h = clamp( position.y / ${heightRef.toFixed(3)}, 0.0, 1.0 );
        float gust = sin( uTime * 0.6 + wPos.x * 0.05 ) * 0.5 + 0.5;
        float w = sin( uTime * 1.7 + wPos.x * 0.45 + wPos.z * 0.3 ) * 0.6
                + sin( uTime * 2.9 + wPos.x * 1.3 - wPos.z * 0.8 ) * 0.25;
        vec2 bend = vec2( 0.8 + w, 0.35 + w * 0.5 ) * h * h * ${strength.toFixed(3)} * ( 0.6 + gust );
        // Storm: pushed further over, with a fast shiver on top.
        float shiver = sin( uTime * 9.0 + wPos.x * 2.1 + wPos.z * 1.7 ) * 0.35;
        bend *= 1.0 + uStorm * ( 0.6 + gust * 0.5 + shiver );
        wPos.xz += bend;
        mvPosition = viewMatrix * wPos;
        gl_Position = projectionMatrix * mvPosition;
        `,
      )
    // Blades share the ground's up-normal on both sides; don't flip it for back faces.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\nnormal = normalize( vNormal );',
    )
  }
  material.customProgramCacheKey = () => `wind-${strength}-${heightRef}`
  material.userData.foliage = true
  return material
}
