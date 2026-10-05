import zh, { type Locale } from './locales/zh.ts'
import en from './locales/en.ts'
import { reenter } from './save.ts'

// Every word the player reads, in Chinese or English: the choice saved in this browser, else
// the browser's own language. Changing it reloads the page, like switching scenes.
// Signs painted into the city itself stay in Chinese: they belong to the place.
const LOCALES: Record<Lang, Locale> = { zh, en }
const KEY = 'meadow-bot:lang'

export type Lang = 'zh' | 'en'
export type { Locale }

const isLang = (v: string | null): v is Lang => v !== null && v in LOCALES

function saved() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const stored = saved()
export const lang: Lang = isLang(stored) ? stored : navigator.languages.some((l) => l.startsWith('zh')) ? 'zh' : 'en'
export const text = LOCALES[lang]
document.documentElement.lang = text.htmlLang

export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage blocked: nowhere to keep the choice, so the browser's language stays.
  }
  reenter()
  location.reload()
}
