// Graphics: how sharp the picture is and how often it is drawn. Kept in this browser, like
// the other settings; a new game keeps it.
const KEY = 'meadow-bot:graphics'

export const QUALITIES = ['low', 'medium', 'high'] as const
export const FRAME_RATES = [30, 60] as const
export type Quality = (typeof QUALITIES)[number]
export type FrameRate = (typeof FRAME_RATES)[number]
export interface Graphics {
  quality: Quality
  fps: FrameRate
}

const DEFAULTS: Graphics = { quality: 'high', fps: 30 }

export function loadGraphics(): Graphics {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const g = { ...DEFAULTS }
    if (typeof saved !== 'object' || saved === null) return g
    if ('quality' in saved && QUALITIES.includes(saved.quality as Quality)) g.quality = saved.quality as Quality
    if ('fps' in saved && FRAME_RATES.includes(saved.fps as FrameRate)) g.fps = saved.fps as FrameRate
    return g
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveGraphics(g: Graphics) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
  } catch {
    // Storage blocked: the choice lasts for this visit.
  }
}

// What each quality level renders: the pixel density (capped by the screen's own) and
// whether ambient occlusion runs, the heaviest pass.
export const QUALITY: Record<Quality, { pixelRatio: number; ao: boolean }> = {
  low: { pixelRatio: 0.75, ao: false },
  medium: { pixelRatio: 1, ao: true },
  high: { pixelRatio: 1.5, ao: true },
}
