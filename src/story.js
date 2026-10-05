// The story of how the city emptied, told in three parts:
//   ximending, first visit — DLV-06 wakes after 31 years with one order never delivered;
//   ximending, every relic found — the order is to Exit 6; arriving there opens the letter
//     and sends the robot up to the mountain village;
//   meadow, after that — delivering the letter to Xiaomai's house.
// Progress lives in this browser. Lines play in a full-screen log: click, Space or Enter
// for the next line, Esc to skip to the end.

import { text } from './i18n.js'

const KEY = 'meadow-bot:story'
const SCRIPTS = text.story

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * sceneName, the scene's story spots ({ finale: [x, z] }), whether all its relics are
 * found, and goTo(scene) to travel on after the city's ending.
 */
export function createStory(sceneName, spots = {}, { allFound, goTo }) {
  const state = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Private window: the story then lasts for this visit.
    }
  }

  const overlay = document.createElement('div')
  overlay.id = 'story'
  overlay.innerHTML = '<div class="log"></div><div class="next"></div>'
  document.body.appendChild(overlay)
  const log = overlay.querySelector('.log')
  const next = overlay.querySelector('.next')
  let queue = []
  let after = null
  let playing = false

  function step() {
    if (!queue.length) return finish()
    const s = queue.shift()
    const el = document.createElement('p')
    if (s.letter) {
      el.className = 'letter'
      el.textContent = s.letter
    } else {
      el.className = s.sys ? `sys${s.warn ? ' warn' : ''}` : 'line'
      el.textContent = s.sys ? `> ${s.sys}` : s.line
    }
    log.appendChild(el)
    next.textContent = queue.length ? text.story.next : after?.label ?? text.story.close
  }
  function finish() {
    overlay.classList.remove('open')
    playing = false
    after?.run?.()
  }
  function play(name, then = null) {
    log.innerHTML = ''
    queue = [...SCRIPTS[name]]
    after = then
    playing = true
    overlay.classList.add('open')
    step()
  }
  overlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    step()
  })
  addEventListener('keydown', (e) => {
    if (!playing) return
    if (e.key === ' ' || e.key === 'Enter') step()
    if (e.key === 'Escape') {
      while (queue.length) step()
    }
  })

  // Where the robot is headed, once the story gives it somewhere to go.
  const objective = () => {
    if (sceneName === 'ximending' && state.remembered && !state.city) return { x: spots.finale[0], z: spots.finale[1], label: text.story.lastOrder }
    if (sceneName === 'meadow' && state.city && !state.delivered) return { x: spots.finale[0], z: spots.finale[1], label: text.story.delivering }
    return null
  }

  return {
    get playing() {
      return playing
    },
    get objective() {
      return objective()
    },
    // Opening lines for whatever this scene's next chapter is.
    start() {
      if (sceneName === 'ximending' && !state.woke) {
        state.woke = true
        save()
        play('wake')
      } else if (sceneName === 'ximending' && allFound() && !state.remembered) this.relicsDone()
      else if (sceneName === 'meadow' && state.city && !state.arrived) {
        state.arrived = true
        save()
        play('village')
      }
    },
    // Every relic in the city found: the memory of the last order comes back.
    relicsDone() {
      if (sceneName !== 'ximending' || state.remembered) return
      state.remembered = true
      save()
      play('remembered')
    },
    update(robot) {
      const goal = objective()
      if (!goal || playing || Math.hypot(robot.x - goal.x, robot.z - goal.z) > 2.5) return
      if (sceneName === 'ximending') {
        state.city = true
        save()
        play('exit6', { label: text.story.toVillage, run: () => goTo('meadow') })
      } else {
        state.delivered = true
        save()
        play('delivered')
      }
    },
  }
}
