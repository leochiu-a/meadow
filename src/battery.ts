import { text } from './i18n.ts'

// DLV-06's battery, always on screen: it wakes at 12% and its solar panel tops it up to 64%
// over half a minute of clear weather, parked or rolling. The level is kept in the save.

const KEY = 'meadow-bot:battery'
const EMPTY = 12
const FULL = 64
// Clear-weather seconds from empty to full.
const CHARGE_TIME = 30

function load() {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return saved >= EMPTY && saved <= FULL ? saved : EMPTY
  } catch {
    return EMPTY
  }
}

export type Battery = ReturnType<typeof createBattery>

export function createBattery() {
  const t = text.battery
  const el = document.createElement('div')
  el.id = 'battery'
  el.innerHTML = '<i class="cell"><b></b></i><span class="pct"></span><span class="state"></span>'
  document.body.appendChild(el)
  const fill = el.querySelector<HTMLElement>('.cell b')!
  const pct = el.querySelector<HTMLElement>('.pct')!
  const state = el.querySelector<HTMLElement>('.state')!

  let level = load()
  let shown = ''

  function show(charging: boolean) {
    const whole = Math.floor(level)
    const mode = level >= FULL ? 'full' : charging ? 'charging' : 'idle'
    if (shown === `${whole}${mode}`) return
    if (shown) {
      try {
        localStorage.setItem(KEY, String(whole))
      } catch {
        // Private window: the battery starts low again next time.
      }
    }
    shown = `${whole}${mode}`
    fill.style.width = `${whole}%`
    pct.textContent = `${whole}%`
    state.textContent = t[mode]
    el.dataset.mode = mode
  }
  show(false)

  return {
    get full() {
      return level >= FULL
    },
    // charging: whether the sun is on the panel and the robot is out on its day.
    update(dt: number, charging: boolean) {
      if (charging && level < FULL) level = Math.min(FULL, level + ((FULL - EMPTY) / CHARGE_TIME) * dt)
      show(charging)
    },
  }
}
