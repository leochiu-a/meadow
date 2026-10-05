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
    // Full resolution: at half, the occlusion of the dense grass upsamples into dark blade-
    // shaped smudges that crawl over the lawn whenever the camera moves.
    halfRes: false,
  })
  // Medium, not Performance: with fewer samples the occlusion's noise stays fixed to the
  // screen and reads as a grainy layer over the grass whenever the camera moves.
  ao.setQualityMode('Medium')
  composer.addPass(ao)

  // One pass for bloom, tilt-shift and the grade, then SMAA on the final LDR image.
  // Tone map before grading: grading HDR values can go negative, which turns black.
  // Sharp band centred on the robot (which the camera frames mid-screen), wide enough that
  // the robot and its surroundings never read as out of focus.
  const tilt = new TiltShiftEffect({ offset: 0, focusArea: 0.55, feather: 0.32, kernelSize: KernelSize.MEDIUM })
  const saturation = new HueSaturationEffect({ saturation: 0.02, hue: 0.0 })
  const tone = new BrightnessContrastEffect({ brightness: 0.02, contrast: 0.05 })
  composer.addPass(
    new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.7, luminanceThreshold: 0.85, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 }),
      tilt,
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
    // Tilt-shift reads as a miniature only from above: as the camera comes down toward the
    // horizon (pitch in radians), the sharp band widens and softens, like a lens at eye level.
    setPitch(pitch: number) {
      const low = 1 - THREE.MathUtils.smoothstep(pitch, 0.3, 0.72)
      tilt.focusArea = 0.55 + 0.3 * low
      tilt.feather = 0.32 + 0.18 * low
    },
    setRain(r: number) {

      saturation.saturation = 0.02 - 0.32 * r
      tone.brightness = 0.02 - 0.05 * r
      tone.contrast = 0.05 - 0.05 * r
    },
  }
}
