// DLV-06's running system messages: short terminal lines under the radar, one after another,
// each fading after a moment. Its daily routine, the dog and the little deliveries speak here.

const el = document.createElement('div')
el.id = 'syslog'
document.body.appendChild(el)
export type SysLine = string

const queue: { line: SysLine; warn: boolean }[] = []
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
  p.textContent = `> ${item.line}`
  el.appendChild(p)
  while (el.children.length > 3) el.firstElementChild?.remove()
  setTimeout(() => p.classList.add('out'), 4200)
  setTimeout(() => p.remove(), 5000)
  setTimeout(next, 1100)
}

// Queues one line or several; warn lines show in amber.
export function say(lines: SysLine | readonly SysLine[], { warn = false }: { warn?: boolean } = {}) {
  for (const line of [lines].flat()) queue.push({ line, warn })
  if (!busy) next()
}
