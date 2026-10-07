import * as THREE from 'three'
import { createElement, Radar, Package, AudioWaveform, Play } from 'lucide'
import { relicModel, type RelicDef } from './relics.ts'
import { text } from './i18n.ts'
import type { EchoDef, EchoId } from './echoes.ts'

// One card in the log: a relic or a recording.
export type Entry = (RelicDef & { kind: 'relic' }) | (EchoDef & { kind: 'echo' })

// The log, in the minimap's game style: a radar pill at the top (signal bars and the count;
// click it or press B to open), a card that pops up for each find, and the log itself —
// things found and sounds heard, in the order DLV-06 came across them. It never puts them in
// the order they happened: every card carries its own date, and lining them up is the
// player's to do. What is still missing waits at the end, with where to look.

// Little portraits of each relic, rendered once on a throwaway renderer.
function portraits(relics: RelicDef[]) {
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
  const out: Record<string, string> = {}
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

const label = (when: string | null) => when?.replaceAll('-', '.') ?? ''
const wave = () => createElement(AudioWaveform).outerHTML
const collator = new Intl.Collator(text.htmlLang)

export interface NotebookOptions {
  relics: RelicDef[]
  echoes: EchoDef[]
  found(): string[]
  heard(): string[]
  shown(entry: Entry): boolean
  released(): boolean
  onReplay(id: EchoId): void
}

/**
 * relics: every relic, both scenes. echoes: every recording (see echoes.ts). found(): the
 * ids of relics found and heard(): of recordings heard, each in the order it happened to the
 * robot. shown(entry): in the log yet (found, or still to be found). released(): the
 * recordings were let go, so they no longer replay. onReplay(id) to hear one again.
 */
export function createNotebook({ relics, echoes, found, heard, shown, released, onReplay }: NotebookOptions) {
  const pics = portraits(relics)
  interface Section {
    key: 'things' | 'sounds'
    all: Entry[]
    got(): string[]
  }
  const sections: Section[] = [
    { key: 'things', all: relics.map((r) => ({ ...r, kind: 'relic' as const })), got: found },
    { key: 'sounds', all: echoes.map((e) => ({ ...e, kind: 'echo' as const })), got: heard },
  ]
  const where = (e: Entry) => (e.kind === 'relic' ? e.hint : e.place)
  // A section's entries: what has turned up in the order it turned up, then the rest, by
  // where they lie (so their order gives nothing away).
  const listed = (s: Section) => {
    const got = s.got()
    const have = got.map((id) => s.all.find((e) => e.id === id)).filter((e): e is Entry => !!e && shown(e))
    const rest = s.all.filter((e) => !got.includes(e.id) && shown(e)).sort((a, b) => collator.compare(where(a), where(b)))
    return { have, rest }
  }
  const has = (e: Entry) => (e.kind === 'relic' ? found() : heard()).includes(e.id)

  const radar = document.createElement('button')
  radar.id = 'radar'
  radar.title = text.notebook.radar
  radar.innerHTML = `<span class="dish"></span><span class="bars">${'<i></i>'.repeat(5)}</span><span class="count"></span>`
  document.body.appendChild(radar)
  const bars = [...radar.querySelectorAll('.bars i')]
  const count = radar.querySelector<HTMLElement>('.count')!
  const dish = radar.querySelector<HTMLElement>('.dish')!
  dish.append(createElement(Radar))

  const toast = document.createElement('div')
  toast.id = 'toast'
  document.body.appendChild(toast)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const book = document.createElement('div')
  book.id = 'book'
  book.innerHTML = `<div class="page"><div class="ribbon">${text.notebook.title}</div><div class="rows"></div><div class="detail"></div><button class="close" aria-label="${text.notebook.close}">×</button></div>`
  document.body.appendChild(book)
  const rows = book.querySelector<HTMLElement>('.rows')!
  const detail = book.querySelector<HTMLElement>('.detail')!

  const tally = () => {
    let got = 0
    let all = 0
    for (const s of sections) {
      const { have, rest } = listed(s)
      got += have.length
      all += have.length + rest.length
    }
    return `${got} / ${all}`
  }

  function show(e: Entry) {
    const got = has(e)
    if (e.kind === 'relic') {
      detail.innerHTML = got
        ? `<img src="${pics[e.id]}" alt=""><div><small>${label(e.when)}</small><b>${e.name}</b><p>${e.story}</p></div>`
        : `<img class="unknown" src="${pics[e.id]}" alt=""><div><b>${text.notebook.unknown}</b><p>${text.notebook.clue(e.hint)}</p></div>`
      return
    }
    if (!got) {
      detail.innerHTML = `<span class="icon unknown">${wave()}</span><div><b>${text.notebook.unknown}</b><p>${text.notebook.area(e.place)}</p></div>`
      return
    }
    const gone = released()
    detail.innerHTML = `<span class="icon">${wave()}</span><div><small>${label(e.when)}</small><b>${e.place}</b><p class="transcript">${e.lines.join('\n')}</p>${gone ? `<p class="gone">${text.notebook.released}</p>` : `<button class="replay">${createElement(Play).outerHTML}${text.notebook.replay}</button>`}</div>`
    detail.querySelector('.replay')?.addEventListener('click', () => {
      toggle(false)
      onReplay(e.id)
    })
  }

  // Two rows, things and sounds, each in the order they turned up.
  function render() {
    count.textContent = tally()
    rows.innerHTML = ''
    for (const s of sections) {
      const { have, rest } = listed(s)
      if (!have.length && !rest.length) continue
      const row = document.createElement('section')
      row.innerHTML = `<h3>${text.notebook.sections[s.key]}</h3><div class="track"></div>`
      const track = row.querySelector<HTMLElement>('.track')!
      for (const e of [...have, ...rest]) {
        const got = has(e)
        const slot = document.createElement('button')
        slot.className = `slot ${e.kind}${got ? '' : ' missing'}`
        const face = e.kind === 'relic' ? `<img src="${pics[e.id]}" alt="">` : `<span class="icon">${wave()}</span>`
        slot.innerHTML = `${face}<small>${got ? label(e.when) : ''}</small><span>${got ? (e.kind === 'relic' ? e.name : e.place) : text.notebook.unknown}</span>`
        slot.addEventListener('click', () => show(e))
        track.appendChild(slot)
      }
      rows.appendChild(row)
    }
    detail.innerHTML = `<p class="lead">${text.notebook.lead}</p>`
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
    if (e.target === book || (e.target instanceof Element && e.target.classList.contains('close'))) toggle(false)
  })
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'b') toggle()
    if (e.key === 'Escape') toggle(false)
  })

  return {
    // Radar strength 0–1 lights the bars.
    setSignal(s: number) {
      const lit = Math.ceil(s * bars.length)
      bars.forEach((b, i) => b.classList.toggle('on', i < lit))
      radar.classList.toggle('hot', s > 0.75)
    },
    // Whether the pill is on screen.
    setRadar(on: boolean) {
      radar.classList.toggle('hidden', !on)
    },
    // While the story has somewhere to go, the pill shows that, with a parcel for the dish.
    setObjective(goal: string | undefined) {
      const words = goal ?? tally()
      if (count.textContent !== words) count.textContent = words
      if (radar.classList.contains('order') !== !!goal) dish.replaceChildren(createElement(goal ? Package : Radar))
      radar.classList.toggle('order', !!goal)
    },
    collected(def: RelicDef) {

      render()
      toast.innerHTML = `<img src="${pics[def.id]}" alt=""><div><small>${text.notebook.found}${def.when ? `・${label(def.when)}` : ''}</small><b>${def.name}</b><p>${def.story}</p></div>`
      toast.classList.add('show')
      // The robot's system lines make room under the card while it shows.
      const room = (px: number) => document.documentElement.style.setProperty('--toast-h', `${px}px`)
      room(toast.offsetHeight + 12)
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        toast.classList.remove('show')
        room(0)
      }, 6500)
    },
    refresh: render,
  }
}
