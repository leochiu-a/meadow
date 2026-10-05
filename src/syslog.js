import { speak } from './voice.js'

// DLV-06's running system messages: short terminal lines under the radar, one after another,
// each fading after a moment. Its daily routine, the dog and the little deliveries speak here.
// A line given as { speak } is also said out loud.

const el = document.createElement('div')
el.id = 'syslog'
document.body.appendChild(el)
const queue = []
let busy = false

function next() {
  const item = queue.shift()
  if (!item) {
    busy = false
    return
  }
  busy = true
  const p = document.createElement('p')
  p.className = item.warn ? 'warn' : ''
  const words = typeof item.line === 'string' ? item.line : item.line.speak
  p.textContent = `> ${words}`
  if (words !== item.line) speak(words)
  el.appendChild(p)
  while (el.children.length > 3) el.firstChild.remove()
  setTimeout(() => p.classList.add('out'), 4200)
  setTimeout(() => p.remove(), 5000)
  setTimeout(next, 1100)
}

// Queues one line or several (strings, or { speak } to say aloud); warn lines show in amber.
export function say(lines, { warn = false } = {}) {
  for (const line of [lines].flat()) queue.push({ line, warn })
  if (!busy) next()
}
