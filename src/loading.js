// The loading screen in index.html: a bar that fills as the scene is built. Building runs on
// the main thread, so each step waits for a painted frame before the work behind it starts.
// It only shows on the very first visit (see index.html); later loads build straight through.
const screen = document.getElementById('loading')
const bar = screen.querySelector('.bar i')
const label = screen.querySelector('.label')
const shown = !document.documentElement.classList.contains('returning')

// A background tab never paints, so it only yields there and keeps building.
const painted = () => new Promise((resolve) => (document.hidden ? setTimeout(resolve) : requestAnimationFrame(() => setTimeout(resolve))))

export async function loading(fraction, text) {
  if (!shown) return
  bar.style.width = `${Math.round(fraction * 100)}%`
  label.textContent = text
  await painted()
}

export function loaded() {
  try {
    localStorage.setItem('meadow-loaded', '1')
  } catch {}
  if (!shown) return screen.remove()
  screen.classList.add('done')
  bar.style.width = '100%'
  // The bar's own width transition bubbles up too; only the screen's fade removes it.
  screen.addEventListener('transitionend', (e) => e.target === screen && screen.remove())
}

// Maps a build's own 0–1 progress onto a slice of the whole bar.
export const within = (from, to) => (fraction, text) => loading(from + (to - from) * fraction, text)
