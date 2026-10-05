import * as THREE from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  TiltShiftEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  KernelSize,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'

// Miniature look: ambient occlusion → soft bloom, tilt-shift blur and ACES grade → SMAA.
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))

  const ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight)
  Object.assign(ao.configuration, {
    aoRadius: 1.6,
    distanceFalloff: 0.6,
    intensity: 2.6,
    color: new THREE.Color('#2a1a10'),
    gammaCorrection: false,
    halfRes: true,
  })
  ao.setQualityMode('Performance')
  composer.addPass(ao)

  // One pass for bloom, tilt-shift and the grade, then SMAA on the final LDR image.
  // Tone map before grading: grading HDR values can go negative, which turns black.
  const saturation = new HueSaturationEffect({ saturation: 0.02, hue: 0.0 })
  const tone = new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.05 })
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.7, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 }),
      new TiltShiftEffect({ offset: -0.12, focusArea: 0.42, feather: 0.3, kernelSize: KernelSize.LARGE }),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      saturation,
      tone,
      new VignetteEffect({ offset: 0.3, darkness: 0.35 }),
    ),
  )
  composer.addPass(new EffectPass(camera, new SMAAEffect()))
  return {
    composer,
    ao,
    // Overcast grade for rain (0–1): greyer and a little darker and flatter.
    setRain(r: number) {

      saturation.saturation = 0.02 - 0.32 * r
      tone.brightness = 0.02 - 0.05 * r
      tone.contrast = 0.05 - 0.05 * r
    },
  }
}
