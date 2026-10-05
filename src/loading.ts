// The loading screen in index.html: a bar that fills as the scene is built. Building runs on
// the main thread, so each step waits for a painted frame before the work behind it starts.
function need<T extends Element>(el: T | null, what: string): T {
  if (!el) throw new Error(`index.html has no ${what}`)
  return el
}

const screen = need(document.getElementById('loading'), '#loading')
const bar = need(screen.querySelector<HTMLElement>('.bar i'), '#loading .bar i')
const label = need(screen.querySelector('.label'), '#loading .label')

// Reports a build's progress (0–1) with the step it is on.
export type Progress = (fraction: number, text: string) => Promise<void>

// A background tab never paints, so it only yields there and keeps building.
const painted = () => new Promise<void>((resolve) => (document.hidden ? setTimeout(resolve) : requestAnimationFrame(() => setTimeout(resolve))))

export async function loading(fraction: number, text: string) {
  bar.style.width = `${Math.round(fraction * 100)}%`
  label.textContent = text
  await painted()
}

export function loaded() {
  screen.classList.add('done')
  bar.style.width = '100%'
  // The bar's own width transition bubbles up too; only the screen's fade removes it.
  screen.addEventListener('transitionend', (e) => e.target === screen && screen.remove())
}

// Maps a build's own 0–1 progress onto a slice of the whole bar.
export const within = (from: number, to: number): Progress => (fraction, text) => loading(from + (to - from) * fraction, text)
