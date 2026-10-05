import { createElement, SlidersHorizontal } from 'lucide'
import { CHANNELS } from './audio.js'
import { text } from './i18n.js'

// Sound mixer: a sliders button beside the sound toggle opens a panel with a slider for the
// master volume and one per channel. Settings are kept in this browser.
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
  for (const name of ['master', ...CHANNELS]) {
    const value = Math.round((levels[name] ?? 1) * 100)
    const row = document.createElement('label')
    row.innerHTML = `<span>${text.mixer[name]}</span><input type="range" min="0" max="100" value="${value}"><output>${value}%</output>`
    const input = row.querySelector('input')
    const output = row.querySelector('output')
    input.addEventListener('input', () => {
      output.textContent = `${input.value}%`
      levels[name] = input.value / 100
      audio.setLevel(name, levels[name])
      try {
        localStorage.setItem(KEY, JSON.stringify(levels))
      } catch {
        // Storage blocked: the levels last for this visit.
      }
    })
    panel.appendChild(row)
  }
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
