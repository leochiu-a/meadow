// The story of how the city emptied, told in three parts:
//   ximending, first visit — DLV-06 wakes after 31 years with one order never delivered;
//   ximending, every relic found — the order is to Exit 6; arriving there opens the letter
//     and sends the robot up to the mountain village;
//   meadow, after that — delivering the letter to Xiaomai's house.
// Progress lives in this browser. Lines play in a full-screen log: click, Space or Enter
// for the next line, Esc to skip to the end.

const KEY = 'meadow-bot:story'

const SCRIPTS = {
  wake: [
    { sys: 'DLV-06 外送機器人' },
    { sys: '系統重新啟動……' },
    { sys: '待機時間：31 年 2 個月' },
    { sys: '目前位置：西門町・峨眉街' },
    { sys: '城市網路：無回應' },
    { sys: '最後一筆訂單：未送達', warn: true },
    { line: '記憶模組受損。附近的東西，也許能讓它想起發生了什麼。' },
  ],
  remembered: [
    { sys: '記憶重建完成' },
    { line: '2054 年 4 月 30 日，最後一班捷運開走的那天晚上。' },
    { line: '阿聲來不及趕到，請它把一封信送去六號出口，交給等在那裡的小麥。' },
    { line: '它還在半路上，城市就斷電了。' },
    { sys: '訂單目的地：捷運西門站 6 號出口', warn: true },
  ],
  exit6: [
    { sys: '抵達：捷運西門站 6 號出口' },
    { sys: '收件人：小麥 —— 不在現場' },
    { sys: '已逾時：31 年' },
    { line: '貨箱裡是一封信。' },
    { letter: '小麥：\n對不起，沒趕上最後一班車。\n等店裡收好，我就上山去找你。\n到時候，再一起聽那首歌。\n—— 阿聲' },
    { sys: '查詢收件人新地址……' },
    { sys: '綠洲遷居計畫・第一期安置地：草原村' },
    { sys: '重新規劃路線　距離 38 公里' },
    { line: '它轉過身，往山的方向出發。' },
  ],
  village: [
    { sys: '抵達：草原村' },
    { sys: '訂單狀態：配送中' },
    { line: '村子裡飄著一段熟悉的旋律。收件地址就在廣場邊的小屋。' },
  ],
  delivered: [
    { sys: '送達：小麥 收' },
    { line: '門口的花開得很好。屋裡傳出那段旋律，是音樂盒。' },
    { line: '信輕輕落進信箱。三十一年，總算送到了。' },
    { sys: '訂單狀態：已送達 ✓', warn: true },
    { sys: 'DLV-06：感謝您的耐心等候。' },
  ],
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

/**
 * sceneName, the scene's story spots ({ finale: [x, z] }), whether all its relics are
 * found, and goTo(scene) to travel on after the city's ending.
 */
export function createStory(sceneName, spots = {}, { allFound, goTo }) {
  const state = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // Private window: the story then lasts for this visit.
    }
  }

  const overlay = document.createElement('div')
  overlay.id = 'story'
  overlay.innerHTML = '<div class="log"></div><div class="next">點一下繼續 ▸</div>'
  document.body.appendChild(overlay)
  const log = overlay.querySelector('.log')
  const next = overlay.querySelector('.next')
  let queue = []
  let after = null
  let playing = false

  function step() {
    if (!queue.length) return finish()
    const s = queue.shift()
    const el = document.createElement('p')
    if (s.letter) {
      el.className = 'letter'
      el.textContent = s.letter
    } else {
      el.className = s.sys ? `sys${s.warn ? ' warn' : ''}` : 'line'
      el.textContent = s.sys ? `> ${s.sys}` : s.line
    }
    log.appendChild(el)
    next.textContent = queue.length ? '點一下繼續 ▸' : after?.label ?? '點一下關閉'
  }
  function finish() {
    overlay.classList.remove('open')
    playing = false
    after?.run?.()
  }
  function play(name, then = null) {
    log.innerHTML = ''
    queue = [...SCRIPTS[name]]
    after = then
    playing = true
    overlay.classList.add('open')
    step()
  }
  overlay.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    step()
  })
  addEventListener('keydown', (e) => {
    if (!playing) return
    if (e.key === ' ' || e.key === 'Enter') step()
    if (e.key === 'Escape') {
      while (queue.length) step()
    }
  })

  // Where the robot is headed, once the story gives it somewhere to go.
  const objective = () => {
    if (sceneName === 'ximending' && state.remembered && !state.city) return { x: spots.finale[0], z: spots.finale[1], label: '最後一筆訂單' }
    if (sceneName === 'meadow' && state.city && !state.delivered) return { x: spots.finale[0], z: spots.finale[1], label: '配送中' }
    return null
  }

  return {
    get playing() {
      return playing
    },
    get objective() {
      return objective()
    },
    // Opening lines for whatever this scene's next chapter is.
    start() {
      if (sceneName === 'ximending' && !state.woke) {
        state.woke = true
        save()
        play('wake')
      } else if (sceneName === 'ximending' && allFound() && !state.remembered) this.relicsDone()
      else if (sceneName === 'meadow' && state.city && !state.arrived) {
        state.arrived = true
        save()
        play('village')
      }
    },
    // Every relic in the city found: the memory of the last order comes back.
    relicsDone() {
      if (sceneName !== 'ximending' || state.remembered) return
      state.remembered = true
      save()
      play('remembered')
    },
    update(robot) {
      const goal = objective()
      if (!goal || playing || Math.hypot(robot.x - goal.x, robot.z - goal.z) > 2.5) return
      if (sceneName === 'ximending') {
        state.city = true
        save()
        play('exit6', { label: '前往草原村 ▸', run: () => goTo('meadow') })
      } else {
        state.delivered = true
        save()
        play('delivered')
      }
    },
  }
}
