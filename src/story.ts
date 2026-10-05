// The story, in acts (see storyboard/script.md):
//   ximending — DLV-06 wakes and goes about its old routine; when the day is done it finds
//     an order never closed, its data corrupt, and starts decoding the recordings in its
//     buffer: act one (the floods, 2049–2053), act two (the night of the last train), and
//     last the one where it woke. That restores the order: to Exit 6, where the letter is
//     opened and the recipient's new address found;
//   meadow — the village; at Xiaomai's door the order cannot be delivered. The robot plays
//     her the recording she never heard, posts the letter, and may let the recordings go.
//     With her letters to A-Sheng in hand, it takes a new order.
// Lines play in a log over the scene: click, Space or Enter for the next line, Esc to skip
// to the end. Some steps wait on a button instead. Progress lives in this browser.

import { text } from './i18n.ts'
import type { EchoId } from './echoes.ts'
import type { Landmarks, SceneName } from './world.ts'

// One step of a script: a system line, a plain line, the letter,
// a recording played on a button, or a choice that is kept.
export type StoryStep =
  | { sys: string; warn?: boolean }
  | { line: string }
  | { letter: string }
  | { play: { label: string; id: EchoId; then?: 'song' } }
  | { choice: { key: 'released'; options: { label: string; value: boolean }[] } }
type ScriptName = 'wake' | 'order' | 'interlude1' | 'interlude2' | 'restored' | 'exit6' | 'village' | 'farewell' | 'newOrder'
export type StoryScripts = Record<ScriptName, StoryStep[]> & Record<'next' | 'close' | 'toVillage' | 'lastRecording' | 'lastOrder' | 'delivering', string>

const KEY = 'meadow-bot:story'
const SCRIPTS = text.story

type Chapter = 'woke' | 'begun' | 'act1' | 'act2' | 'restored' | 'city' | 'arrived' | 'delivered' | 'released' | 'newOrder'
type StoryState = Partial<Record<Chapter, boolean>>

function load(): StoryState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * sceneName and its landmarks ({ finale, wake }). hooks: goTo(scene) to travel on;
 * beginRoutine() for the robot's day; play(id) → Promise to play a recording; letGo() to
 * release the recordings; song() for the music box; hasLetters() whether Xiaomai's letters
 * have been found.
 */
export interface StoryHooks {
  goTo(scene: SceneName): void
  beginRoutine(): void
  play(id: EchoId): Promise<void>
  letGo(): void
  song(): void
  hasLetters(): boolean
}

// What runs once a script's last line is dismissed, and the prompt shown for it.
interface After {
  label?: string
  run?(): void
}

export function createStory(sceneName: SceneName, landmarks: Landmarks = {}, hooks: StoryHooks) {
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
  const log = overlay.querySelector<HTMLElement>('.log')!
  const next = overlay.querySelector<HTMLElement>('.next')!
  let queue: StoryStep[] = []
  let after: After | null = null
  let playing = false
  // A step waiting on its button: lines don't advance until it is pressed.
  let waiting = false

  function button(label: string, onPress: () => void) {
    const b = document.createElement('button')
    b.className = 'act'
    b.textContent = label
    b.addEventListener('pointerdown', (e) => e.stopPropagation())
    b.addEventListener('click', onPress)
    return b
  }

  function step() {
    if (waiting) return
    if (!queue.length) return finish()
    const s = queue.shift()!
    const el = document.createElement('p')
    if ('letter' in s) {
      el.className = 'letter'
      el.textContent = s.letter
    } else if ('play' in s) {
      // A recording played to someone: one button, no other choice.
      const { play } = s
      waiting = true
      el.className = 'choices'
      el.append(
        button(play.label, async () => {
          el.replaceChildren()
          overlay.classList.add('listening')
          await hooks.play(play.id)
          if (play.then === 'song') hooks.song()
          overlay.classList.remove('listening')
          waiting = false
          step()
        }),
      )
    } else if ('choice' in s) {
      const { choice } = s
      waiting = true
      el.className = 'choices'
      el.append(
        ...choice.options.map(({ label, value }) =>
          button(label, () => {
            state[choice.key] = value
            // Letting go (or not) is the last thing at her door: the letter is delivered.
            if (choice.key === 'released') state.delivered = true
            save()
            el.replaceChildren(Object.assign(document.createElement('span'), { className: 'sys', textContent: `> ${label}` }))
            if (choice.key === 'released' && value) hooks.letGo()
            waiting = false
            step()
          }),
        ),
      )
    } else if ('sys' in s) {
      el.className = `sys${s.warn ? ' warn' : ''}`
      el.textContent = `> ${s.sys}`
    } else {
      el.className = 'line'
      el.textContent = s.line
    }
    log.appendChild(el)
    next.textContent = waiting ? '' : queue.length ? text.story.next : (after?.label ?? text.story.close)
  }
  function finish() {
    overlay.classList.remove('open', 'soft')
    playing = false
    after?.run?.()
  }
  function play(name: ScriptName, then: After | null = null, { soft = false } = {}) {
    log.innerHTML = ''
    queue = [...SCRIPTS[name]]
    after = then
    playing = true
    overlay.classList.add('open')
    overlay.classList.toggle('soft', soft)
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
      while (queue.length && !waiting) step()
    }
  })

  // Where the robot is headed, once the story gives it somewhere to go.
  const objective = () => {
    const { wake, finale } = landmarks
    if (sceneName === 'ximending' && wake && state.act2 && !state.restored) return { x: wake[0], z: wake[1], label: text.story.lastRecording }
    if (sceneName === 'ximending' && finale && state.restored && !state.city) return { x: finale[0], z: finale[1], label: text.story.lastOrder }
    if (sceneName === 'meadow' && finale && state.city && !state.delivered) return { x: finale[0], z: finale[1], label: text.story.delivering }
    return null
  }

  // The new order, once the letter is delivered and her letters are in the cargo box.
  function newOrder() {
    if (!state.delivered || state.newOrder || !hooks.hasLetters()) return
    state.newOrder = true
    save()
    play('newOrder')
  }

  return {
    get playing() {
      return playing
    },
    get objective() {
      return objective()
    },
    // The robot's day is over and the story has begun.
    get begun() {
      return !!state.begun
    },
    get released() {
      return !!state.released
    },
    get city() {
      return !!state.city
    },
    // Whether a recording's act has begun.
    open(def: { act: number }) {
      return !!state.begun && (def.act === 1 || (def.act === 2 && !!state.act1) || (def.act === 3 && !!state.act2))
    },
    // Opening lines for whatever this scene's next chapter is.
    start() {
      if (sceneName === 'ximending' && !state.woke) {
        state.woke = true
        save()
        play('wake', { run: hooks.beginRoutine })
      } else if (sceneName === 'ximending' && !state.begun) hooks.beginRoutine()
      else if (sceneName === 'meadow' && state.city && !state.arrived) {
        state.arrived = true
        save()
        play('village', { run: hooks.song })
      }
    },
    // The day is done: loading the next item turns up the unfinished order.
    begin() {
      if (state.begun) return
      state.begun = true
      save()
      play('order')
    },
    // A recording has played: an act may be complete.
    heard(def: { id: EchoId }, heard: Set<string>) {
      const all = (act: EchoId[]) => act.every((id) => heard.has(id))
      if (!state.act1 && all(['R1', 'R2', 'R3', 'R4', 'R5'])) {
        state.act1 = true
        save()
        setTimeout(() => play('interlude1'), 1500)
      } else if (state.act1 && !state.act2 && all(['R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13'])) {
        state.act2 = true
        save()
        setTimeout(() => play('interlude2'), 1500)
      } else if (def.id === 'R14' && !state.restored) {
        state.restored = true
        save()
        setTimeout(() => play('restored'), 1200)
      }
    },
    // A relic was found: her letters may complete the new order.
    collected() {
      setTimeout(newOrder, 7000)
    },
    // manual: the player is steering. Arriving at Exit 6 or at her door only counts then,
    // so the patrol never walks into the story's turning points on its own.
    update(robot: { x: number; z: number }, manual: boolean) {

      const goal = objective()
      if (!goal || playing || !manual || Math.hypot(robot.x - goal.x, robot.z - goal.z) > 2.5) return
      if (sceneName === 'ximending' && state.restored) {
        state.city = true
        save()
        play('exit6', { label: text.story.toVillage, run: () => hooks.goTo('meadow') })
      } else if (sceneName === 'meadow') {
        play('farewell', { run: newOrder }, { soft: true })
      }
    },
  }
}
