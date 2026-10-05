import * as THREE from 'three'
import { createElement, Radar, Package } from 'lucide'
import { relicModel } from './relics.js'
import { text } from './i18n.js'

// Scavenging HUD in the minimap's game style: a radar pill at the top (signal bars and the
// count; click it or press B for the book), a card that pops up for each find, and the
// collection book — finds with their stories, the rest as silhouettes with a hint.

// Little portraits of each relic, rendered once on a throwaway renderer.
function portraits(defs) {
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
  for (const def of defs) {
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

export function createCollectionUI(defs, found) {
  const pics = portraits(defs)
  const radar = document.createElement('button')
  radar.id = 'radar'
  radar.title = text.collection.radar
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
  book.innerHTML = `<div class="page"><div class="ribbon">${text.collection.book}</div><div class="grid"></div><div class="detail"></div><button class="close" aria-label="${text.collection.close}">×</button></div>`
  document.body.appendChild(book)
  const grid = book.querySelector('.grid')
  const detail = book.querySelector('.detail')

  const show = (def) => {
    detail.innerHTML = found.has(def.id)
      ? `<img src="${pics[def.id]}" alt=""><div><small>${def.date}</small><b>${def.name}</b><p>${def.story}</p></div>`
      : `<img class="unknown" src="${pics[def.id]}" alt=""><div><b>${text.collection.unknown}</b><p>${text.collection.clue(def.hint)}</p></div>`
  }
  function render() {
    count.textContent = `${found.size} / ${defs.length}`
    grid.innerHTML = ''
    for (const def of defs) {
      const have = found.has(def.id)
      const slot = document.createElement('button')
      slot.className = have ? 'slot' : 'slot missing'
      slot.innerHTML = `<img src="${pics[def.id]}" alt=""><span>${have ? def.name : text.collection.unknown}</span><small>${have ? def.date : ''}</small>`
      slot.addEventListener('click', () => show(def))
      grid.appendChild(slot)
    }
    detail.innerHTML = `<p class="lead">${text.collection.lead}</p>`
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
    // While the story has somewhere to go, the pill shows that, with a parcel for the dish.
    setObjective(label) {
      const text = label ?? `${found.size} / ${defs.length}`
      if (count.textContent !== text) count.textContent = text
      if (radar.classList.contains('order') !== !!label) dish.replaceChildren(createElement(label ? Package : Radar))
      radar.classList.toggle('order', !!label)
    },
    collected(def) {
      render()
      const done = found.size === defs.length
      toast.innerHTML = `<img src="${pics[def.id]}" alt=""><div><small>${done ? text.collection.allFound : text.collection.found}・${found.size} / ${defs.length}・${def.date}</small><b>${def.name}</b><p>${def.story}</p></div>`
      toast.classList.add('show')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => toast.classList.remove('show'), 6500)
    },
  }
}
