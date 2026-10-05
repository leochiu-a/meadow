// The title menu, over the scene once it is built: Continue the saved game or start a new
// one. Starting over with a save asks once more, since it erases the progress.

import { text } from './i18n.ts'

export type MenuChoice = 'continue' | 'new'

/**
 * saved: whether there is progress to continue; openSettings() shows the settings panel.
 * Resolves 'continue' or 'new'.
 */
export function showMenu(saved: boolean, openSettings: () => void): Promise<MenuChoice> {
  const overlay = document.createElement('div')
  overlay.id = 'menu'
  overlay.innerHTML = '<div class="box"><div class="title">MEADOW BOT</div><div class="choices"></div></div>'
  document.body.append(overlay)
  document.body.classList.add('titled')
  const choices = overlay.querySelector('.choices')!

  const button = (label: string, onPress: () => void, primary = false) => {
    const b = document.createElement('button')
    b.textContent = label
    if (primary) b.className = 'primary'
    b.addEventListener('click', onPress)
    return b
  }

  return new Promise<MenuChoice>((resolve) => {
    const choose = (choice: MenuChoice) => {
      document.body.classList.remove('titled')
      overlay.classList.add('done')
      overlay.addEventListener('transitionend', () => overlay.remove(), { once: true })
      resolve(choice)
    }
    const main = () => {
      const cont = button(text.menu.continue, () => choose('continue'), saved)
      cont.disabled = !saved
      choices.replaceChildren(cont, button(text.menu.newGame, () => (saved ? confirm() : choose('new')), !saved), button(text.settings.title, openSettings))
      choices.querySelector<HTMLElement>('.primary')?.focus()
    }
    const confirm = () => {
      const warn = Object.assign(document.createElement('p'), { textContent: text.menu.confirm })
      choices.replaceChildren(warn, button(text.menu.erase, () => choose('new'), true), button(text.menu.back, main))
      choices.querySelector<HTMLElement>('.primary')?.focus()
    }
    main()
  })
}
