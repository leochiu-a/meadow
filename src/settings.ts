import { createElement, Settings } from 'lucide'
import { CHANNELS, DEFAULT_LEVELS } from './audio.ts'
import { lang, text, type Lang } from './i18n.ts'

// Settings: a gear button opens one panel with the language, sound on or off, and the
// mixer (a slider for the master volume and one per channel, and a button back to the
// default mix). Choices are kept in this browser.
const KEY = 'meadow-bot:mixer'

// 'master' or one of the audio channels.
export type LevelName = keyof typeof DEFAULT_LEVELS
// The levels the player has moved off the default, 0–1 each.
export type Levels = Partial<Record<LevelName, number>>
// What the panel drives: the soundscape's switch and per-channel volume.
export interface SoundTarget {
  // Whether sound can be heard now.
  readonly on: boolean
  // The first press starts audio (browsers need a gesture); later presses mute and unmute.
  toggle(): boolean
  setLevel(name: LevelName, value: number): void
}

// Each language named in itself, as language pickers do.
const LANGUAGES: [Lang, string][] = [
  ['zh', '中文'],
  ['en', 'English'],
]

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

// onLanguage(code) switches the game's language (it reloads the page).
export function createSettings(audio: SoundTarget, levels: Levels, onLanguage: (code: Lang) => void) {
  const button = document.createElement('button')
  button.id = 'settings-button'
  button.append(createElement(Settings))
  button.setAttribute('aria-label', text.settings.title)
  button.setAttribute('aria-expanded', 'false')
  document.getElementById('controls')?.append(button)

  const panel = document.createElement('div')
  panel.id = 'settings'
  panel.innerHTML = `<div class="ribbon">${text.settings.title}</div><button class="close" aria-label="${text.notebook.close}">×</button>`

  // Language: switching reloads the page.
  const language = document.createElement('div')
  language.className = 'row'
  language.innerHTML = `<span>${text.settings.language}</span><div class="choice"></div>`
  for (const [code, name] of LANGUAGES) {
    const b = document.createElement('button')
    b.textContent = name
    b.setAttribute('aria-pressed', String(code === lang))
    if (code !== lang) b.addEventListener('click', () => onLanguage(code))
    language.querySelector('.choice')!.append(b)
  }

  // Sound on or off.
  const sound = document.createElement('label')
  sound.className = 'row'
  sound.innerHTML = `<span>${text.settings.sound}</span><input type="checkbox" role="switch">`
  const soundSwitch = sound.querySelector('input')!
  soundSwitch.addEventListener('change', () => (soundSwitch.checked = audio.toggle()))
  panel.append(language, sound)

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
    row.className = 'level'
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
    // Sound may have started (on the first click anywhere) since the panel last opened.
    if (open) soundSwitch.checked = audio.on
    panel.classList.toggle('open', open)
    button.setAttribute('aria-expanded', String(open))
  }
  button.addEventListener('pointerdown', (e) => e.stopPropagation())
  button.addEventListener('click', () => toggle())
  panel.querySelector('.close')!.addEventListener('click', () => toggle(false))
  // The panel keeps its clicks and keys: arrows nudge a slider, not the robot.
  panel.addEventListener('pointerdown', (e) => e.stopPropagation())
  for (const type of ['keydown', 'keyup'] as const) panel.addEventListener(type, (e) => e.key !== 'Escape' && e.stopPropagation())
  addEventListener('pointerdown', () => toggle(false))
  addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false))
  return { open: () => toggle(true) }
}
