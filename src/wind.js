// Shared wind uniform; patched into instanced foliage materials so blades sway in world space.
export const windUniforms = { uTime: { value: 0 } }

export function applyWind(material, { strength = 0.25, heightRef = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
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
  return material
}
