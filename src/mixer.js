import { createElement, SlidersHorizontal } from 'lucide'
import { CHANNELS, DEFAULT_LEVELS } from './audio.js'
import { text } from './i18n.js'

// Sound mixer: a sliders button beside the sound toggle opens a panel with a slider for the
// master volume and one per channel, and a button back to the default mix. Settings are
// kept in this browser.
const KEY = 'meadow-bot:mixer'

export function loadLevels() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function createMixer(audio, levels) {
  const button = document.createElement('button')
  button.id = 'mixer-button'
  button.append(createElement(SlidersHorizontal))
  button.setAttribute('aria-label', text.mixer.title)
  button.setAttribute('aria-expanded', 'false')
  document.getElementById('sound').before(button)

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
  const sliders = {}
  for (const name of ['master', ...CHANNELS]) {
    const row = document.createElement('label')
    row.innerHTML = `<span>${text.mixer[name]}</span><input type="range" min="0" max="100"><output></output>`
    const input = row.querySelector('input')
    const output = row.querySelector('output')
    const show = (value) => {
      input.value = Math.round(value * 100)
      output.textContent = `${input.value}%`
    }
    show(levels[name] ?? DEFAULT_LEVELS[name])
    input.addEventListener('input', () => {
      levels[name] = input.value / 100
      show(levels[name])
      audio.setLevel(name, levels[name])
      save()
    })
    sliders[name] = show
    panel.appendChild(row)
  }
  const reset = document.createElement('button')
  reset.className = 'reset'
  reset.textContent = text.mixer.reset
  // Back to the default mix: forget the saved levels, so later defaults apply too.
  reset.addEventListener('click', () => {
    for (const [name, show] of Object.entries(sliders)) {
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
  for (const type of ['keydown', 'keyup']) panel.addEventListener(type, (e) => e.key !== 'Escape' && e.stopPropagation())
  addEventListener('pointerdown', () => toggle(false))
  addEventListener('keydown', (e) => e.key === 'Escape' && toggle(false))
}
