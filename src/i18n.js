import zh from './locales/zh.js'
import en from './locales/en.js'
import { reenter } from './save.js'

// Every word the player reads, in Chinese or English: the choice saved in this browser, else
// the browser's own language. Changing it reloads the page, like switching scenes.
// Signs painted into the city itself stay in Chinese: they belong to the place.
const LOCALES = { zh, en }
const KEY = 'meadow-bot:lang'

function saved() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const lang = saved() in LOCALES ? saved() : navigator.languages.some((l) => l.startsWith('zh')) ? 'zh' : 'en'
export const text = LOCALES[lang]
document.documentElement.lang = text.htmlLang

export function setLang(next) {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage blocked: nowhere to keep the choice, so the browser's language stays.
  }
  reenter()
  location.reload()
}
