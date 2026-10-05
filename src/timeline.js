import * as THREE from 'three'
import { createElement, Radar, Package, AudioWaveform, Play } from 'lucide'
import { relicModel } from './relics.js'
import { text } from './i18n.js'

// The timeline, in the minimap's game style: a radar pill at the top (signal bars and the
// count; click it or press B to open), a card that pops up for each find, and the timeline
// itself — relics and recordings in the order they happened: the years before, the night of
// the last train minute by minute, and the years after. It only puts things in order: no
// links, no notes. What is missing shows as ??:?? with where to look.

// Little portraits of each relic, rendered once on a throwaway renderer.
function portraits(relics) {
  const size = 160
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size, false)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#fff8ec', '#8a7a60', 2.2))
  const key = new THREE.DirectionalLight('#ffffff', 2.4)
  key.position.set(2, 4, 3)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20)
  camera.position.set(0, 1.1, 1.3)
  camera.lookAt(0, 0, 0)
  const out = {}
  for (const def of relics) {
    const model = relicModel(def.id)
    const box = new THREE.Box3().setFromObject(model)
    const fit = 0.62 / Math.max(...box.getSize(new THREE.Vector3()).toArray())
    model.scale.multiplyScalar(fit)
    model.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(fit))
    model.rotation.y = -0.5
    scene.add(model)
    renderer.render(scene, camera)
    out[def.id] = renderer.domElement.toDataURL()
    scene.remove(model)
  }
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}

const NIGHT = '2054-04-30'
const label = (when) => (!when ? '' : when.startsWith(NIGHT) ? when.slice(11) : when.replaceAll('-', '.'))
// What a slot not found yet shows for its time: a minute on the last night, a year before.
const unknownTime = (when) => (!when ? '' : when.startsWith(NIGHT) ? '??:??' : '????')
const wave = () => createElement(AudioWaveform).outerHTML

/**
 * relics: every relic, both scenes. echoes: every recording (see echoes.js). has(entry):
 * found or heard. shown(entry): on the timeline yet. released(): the recordings were let go,
 * so they no longer replay. onReplay(id) to hear one again.
 */
export function createTimeline({ relics, echoes, has, shown, released, onReplay }) {
  const pics = portraits(relics)
  const entries = [...relics.map((r) => ({ ...r, kind: 'relic' })), ...echoes.map((e) => ({ ...e, kind: 'echo' }))]
  const sorted = () => entries.filter(shown).sort((a, b) => (a.when ?? '9999').localeCompare(b.when ?? '9999'))

  const radar = document.createElement('button')
  radar.id = 'radar'
  radar.title = text.timeline.radar
  radar.innerHTML = `<span class="dish"></span><span class="bars">${'<i></i>'.repeat(5)}</span><span class="count"></span>`
  document.body.appendChild(radar)
  const bars = [...radar.querySelectorAll('.bars i')]
  const count = radar.querySelector('.count')
  const dish = radar.querySelector('.dish')
  dish.append(createElement(Radar))

  const toast = document.createElement('div')
  toast.id = 'toast'
  document.body.appendChild(toast)
  let toastTimer = 0

  const book = document.createElement('div')
  book.id = 'book'
  book.innerHTML = `<div class="page"><div class="ribbon">${text.timeline.title}</div><div class="rows"></div><div class="detail"></div><button class="close" aria-label="${text.timeline.close}">×</button></div>`
  document.body.appendChild(book)
  const rows = book.querySelector('.rows')
  const detail = book.querySelector('.detail')

  const tally = () => {
    const list = sorted()
    return `${list.filter(has).length} / ${list.length}`
  }

  function show(e) {
    const got = has(e)
    const time = label(e.when)
    if (e.kind === 'relic') {
      detail.innerHTML = got
        ? `<img src="${pics[e.id]}" alt=""><div><small>${time}</small><b>${e.name}</b><p>${e.story}</p></div>`
        : `<img class="unknown" src="${pics[e.id]}" alt=""><div><small>${unknownTime(e.when)}</small><b>${text.timeline.unknown}</b><p>${text.timeline.clue(e.hint)}</p></div>`
      return
    }
    if (!got) {
      detail.innerHTML = `<span class="icon unknown">${wave()}</span><div><small>${unknownTime(e.when)}</small><b>${text.timeline.unknown}</b><p>${text.timeline.area(e.place)}</p></div>`
      return
    }
    const gone = released()
    detail.innerHTML = `<span class="icon">${wave()}</span><div><small>${e.when}</small><b>${e.place}</b><p class="transcript">${e.lines.join('\n')}</p>${gone ? `<p class="gone">${text.timeline.released}</p>` : `<button class="replay">${createElement(Play).outerHTML}${text.timeline.replay}</button>`}</div>`
    detail.querySelector('.replay')?.addEventListener('click', () => {
      toggle(false)
      onReplay(e.id)
    })
  }

  // One row per stretch of time: the years before, the last night, the years after.
  function render() {
    count.textContent = tally()
    rows.innerHTML = ''
    const groups = []
    for (const e of sorted()) {
      const key = !e.when ? 'after' : e.when.startsWith(NIGHT) ? 'night' : 'before'
      if (groups.at(-1)?.key !== key) groups.push({ key, list: [] })
      groups.at(-1).list.push(e)
    }
    for (const g of groups) {
      const row = document.createElement('section')
      row.innerHTML = `<h3>${text.timeline.groups[g.key]}</h3><div class="track"></div>`
      const track = row.querySelector('.track')
      for (const e of g.list) {
        const got = has(e)
        const slot = document.createElement('button')
        slot.className = `slot ${e.kind}${got ? '' : ' missing'}`
        const face = e.kind === 'relic' ? `<img src="${pics[e.id]}" alt="">` : `<span class="icon">${wave()}</span>`
        const time = got ? label(e.when) : unknownTime(e.when)
        slot.innerHTML = `${face}<small>${time}</small><span>${got ? (e.kind === 'relic' ? e.name : e.place) : text.timeline.unknown}</span>`
        slot.addEventListener('click', () => show(e))
        track.appendChild(slot)
      }
      rows.appendChild(row)
    }
    detail.innerHTML = `<p class="lead">${text.timeline.lead}</p>`
  }
  render()

  const toggle = (open = !book.classList.contains('open')) => {
    if (open) render()
    book.classList.toggle('open', open)
  }
  radar.addEventListener('pointerdown', (e) => e.stopPropagation())
  radar.addEventListener('click', () => toggle())
  book.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    if (e.target === book || e.target.classList.contains('close')) toggle(false)
  })
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'b') toggle()
    if (e.key === 'Escape') toggle(false)
  })

  return {
    // Radar strength 0–1 lights the bars.
    setSignal(s) {
      const lit = Math.ceil(s * bars.length)
      bars.forEach((b, i) => b.classList.toggle('on', i < lit))
      radar.classList.toggle('hot', s > 0.75)
    },
    // The radar only appears once the story has begun.
    setRadar(on) {
      radar.classList.toggle('hidden', !on)
    },
    // While the story has somewhere to go, the pill shows that, with a parcel for the dish.
    setObjective(goal) {
      const words = goal ?? tally()
      if (count.textContent !== words) count.textContent = words
      if (radar.classList.contains('order') !== !!goal) dish.replaceChildren(createElement(goal ? Package : Radar))
      radar.classList.toggle('order', !!goal)
    },
    collected(def) {
      render()
      toast.innerHTML = `<img src="${pics[def.id]}" alt=""><div><small>${text.timeline.found}${def.when ? `・${label(def.when)}` : ''}</small><b>${def.name}</b><p>${def.story}</p></div>`
      toast.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => toast.classList.remove('show'), 6500)
    },
    refresh: render,
  }
}
