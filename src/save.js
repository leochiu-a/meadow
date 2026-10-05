// The save: every module keeps its own progress in this browser under `meadow-bot:`. Settings
// (language, mixer) live there too but are not progress, so a new game keeps them. The scene
// last played is kept so Continue returns to it.

const PREFIX = 'meadow-bot:'
const SETTINGS = new Set([`${PREFIX}lang`, `${PREFIX}mixer`])
const SCENE = `${PREFIX}scene`
// Set just before the game reloads itself (switching scene or language): that reload goes
// straight back in instead of stopping at the title menu.
const REENTER = `${PREFIX}reenter`

const progressKeys = () => {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && !SETTINGS.has(k))
  } catch {
    return []
  }
}

export const hasSave = () => progressKeys().length > 0

export function clearSave() {
  for (const k of progressKeys()) localStorage.removeItem(k)
}

export function lastScene() {
  try {
    return localStorage.getItem(SCENE)
  } catch {
    return null
  }
}

export function keepScene(name) {
  try {
    localStorage.setItem(SCENE, name)
  } catch {
    // Private window: Continue then starts in the city.
  }
}

export function reenter() {
  try {
    sessionStorage.setItem(REENTER, '1')
  } catch {
    // Without session storage the reload shows the menu once more.
  }
}

// Whether this load is the game reloading itself; asking consumes the mark.
export function reentered() {
  try {
    const was = sessionStorage.getItem(REENTER) === '1'
    sessionStorage.removeItem(REENTER)
    return was
  } catch {
    return false
  }
}
