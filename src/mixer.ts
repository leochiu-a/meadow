import { createElement, SlidersHorizontal } from 'lucide'
import { CHANNELS, DEFAULT_LEVELS } from './audio.ts'
import { text } from './i18n.ts'

// Sound mixer: a sliders button beside the sound toggle opens a panel with a slider for the
// master volume and one per channel, and a button back to the default mix. Settings are
// kept in this browser.
const KEY = 'meadow-bot:mixer'

// 'master' or one of the audio channels.
export type LevelName = keyof typeof DEFAULT_LEVELS
// The levels the player has moved off the default, 0–1 each.
export type Levels = Partial<Record<LevelName, number>>
// What the mixer drives: the soundscape's per-channel volume.
export interface MixerTarget {
  setLevel(name: LevelName, value: number): void
}

const isLevelName = (name: string): name is LevelName => name in DEFAULT_LEVELS

export function loadLevels(): Levels {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const levels: Levels = {}
    if (typeof saved !== 'object' || saved === null) return levels
    for (const [name, value] of Object.entries(saved)) {
      if (isLevelName(name) && typeof value === 'number') levels[name] = value
    }
    return levels
  } catch {
    return {}
  }
}

export function createMixer(audio: MixerTarget, levels: Levels) {
  const button = document.createElement('button')
  button.id = 'mixer-button'
  button.append(createElement(SlidersHorizontal))
  button.setAttribute('aria-label', text.mixer.title)
  button.setAttribute('aria-expanded', 'false')
  document.getElementById('sound')?.before(button)

  const panel = document.createElement('div')
  panel.id = 'mixer'
  panel.innerHTML = `<div class="ribbon">${text.mixer.title}</div>`
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(levels))
    } catch {
      // Storage blocked: the levels last for this visit.
    }
  }
  const sliders = new Map<LevelName, (value: number) => void>()
  for (const name of ['master', ...CHANNELS].filter(isLevelName)) {
    const row = document.createElement('label')
    row.innerHTML = `<span>${text.mixer[name]}</span><input type="range" min="0" max="100"><output></output>`
    const input = row.querySelector('input')!
    const output = row.querySelector('output')!
    const show = (value: number) => {
      input.value = String(Math.round(value * 100))
      output.textContent = `${input.value}%`
    }
    show(levels[name] ?? DEFAULT_LEVELS[name])
    input.addEventListener('input', () => {
      const value = Number(input.value) / 100
      levels[name] = value
      show(value)
      audio.setLevel(name, value)
      save()
    })
    sliders.set(name, show)
    panel.appendChild(row)
  }
  const reset = document.createElement('button')
  reset.className = 'reset'
  reset.textContent = text.mixer.reset
  // Back to the default mix: forget the saved levels, so later defaults apply too.
  reset.addEventListener('click', () => {
    for (const [name, show] of sliders) {
      delete levels[name]
      show(DEFAULT_LEVELS[name])
      audio.setLevel(name, DEFAULT_LEVELS[name])
    }
    try {
      localStorage.removeItem(KEY)
    } catch {}
  })
  panel.appendChild(reset)
  document.body.appendChild(panel)

  const toggle = (open = !panel.classList.contains('open')) => {
    panel.classList.toggle('open', open)
    button.setAttribute('aria-expanded', String(open))
  }
  button.addEventListener('pointerdown', (e) => e.stopPropagation())
  button.addEventListener('click', () => toggle())
  // The panel keeps its clicks and keys: arrows nudge a slider, not the robot.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation())
  for (const type of ['keydown', 'keyup'] as const) panel.addEventListener(type, (e) => e.key !== 'Escape' && e.stopPropagation())
  addEventListener('pointerdown', () => toggle(false))
  addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false))
}
