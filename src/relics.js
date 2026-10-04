import * as THREE from 'three'
import { weathered } from './weathering.js'

// Relics left behind from before: what each one is, when its memory is from, the memory
// itself, a hint at where it lies, and its little model. Each scene places them by id (see `relics` in its build).
// Models are built at display size, roughly half a metre across, so they read in the grass.

const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts })
const aged = (color, kind = 'paint') => weathered(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), { kind, grime: 0.5, fade: 0.2 })
const glow = (color) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4 })
const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}
const group = (...parts) => {
  const g = new THREE.Group()
  g.add(...parts)
  return g
}

// Card-like flat things: a rounded slab with a face texture drawn on a canvas.
function slab(w, d, h, draw, side = '#e8e0cc') {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = Math.round((256 * d) / w)
  draw(canvas.getContext('2d'), canvas.width, canvas.height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const edge = std(side)
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 })
  return mesh(new THREE.BoxGeometry(w, h, d), [edge, edge, face, edge, edge, edge])
}

const MODELS = {
  ticket: () =>
    group(
      slab(0.46, 0.22, 0.012, (c, w, h) => {
        c.fillStyle = '#efe4c8'
        c.fillRect(0, 0, w, h)
        c.fillStyle = '#b8352a'
        c.fillRect(0, 0, w, 22)
        c.fillStyle = '#3a2a20'
        c.font = 'bold 30px "PingFang TC", sans-serif'
        c.fillText('日昇戲院', 16, 64)
        c.font = '20px "PingFang TC", sans-serif'
        c.fillText('午夜場 7排12號', 16, 96)
        c.setLineDash([5, 6])
        c.strokeStyle = '#8a7a60'
        c.beginPath()
        c.moveTo(196, 26)
        c.lineTo(196, h)
        c.stroke()
      }),
    ),
  neon: () => {
    // A bent tube in a heart, still faintly glowing.
    const pts = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2
      pts.push(new THREE.Vector3(16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t), 0).multiplyScalar(0.014))
    }
    const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.022, 8, true), glow('#ff4f9a'))
    tube.rotation.x = -Math.PI / 2 + 0.25
    tube.position.y = 0.05
    return group(tube)
  },
  card: () =>
    group(
      slab(0.42, 0.27, 0.014, (c, w, h) => {
        const g = c.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, '#2f7fd0')
        g.addColorStop(1, '#25b3a8')
        c.fillStyle = g
        c.fillRect(0, 0, w, h)
        c.fillStyle = '#ffffff'
        c.font = 'bold 34px "PingFang TC", sans-serif'
        c.fillText('悠悠卡', 18, 56)
        c.fillStyle = 'rgba(255,255,255,0.35)'
        c.beginPath()
        c.arc(w - 40, h - 36, 50, 0, Math.PI * 2)
        c.fill()
      }, '#2f7fd0'),
    ),
  cassette: () => {
    const shell = slab(0.44, 0.28, 0.06, (c, w, h) => {
      c.fillStyle = '#2a2a2e'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#e9d9a8'
      c.fillRect(20, 14, w - 40, 70)
      c.fillStyle = '#c0392b'
      c.font = 'bold 22px "PingFang TC", sans-serif'
      c.fillText('西門 MIX ’52', 32, 54)
      c.fillStyle = '#111'
      c.fillRect(60, 100, w - 120, 40)
    }, '#2a2a2e')
    const reels = [-0.08, 0.08].map((x) => mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.065, 12), std('#f2f2f2'), x, 0, 0.04))
    return group(shell, ...reels)
  },
  bubbleTea: () => {
    const cup = mesh(new THREE.CylinderGeometry(0.11, 0.085, 0.32, 18, 1, true), std('#e9dcc4', { transparent: true, opacity: 0.75, side: THREE.DoubleSide }), 0, 0.16)
    const tea = mesh(new THREE.CylinderGeometry(0.1, 0.082, 0.22, 18), std('#b98a5a'), 0, 0.12)
    const lid = mesh(new THREE.SphereGeometry(0.112, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#f4f1ea', { transparent: true, opacity: 0.7 }), 0, 0.32)
    const straw = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 8), std('#e2463b'), 0.03, 0.36)
    straw.rotation.z = -0.18
    const pearls = []
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2
      pearls.push(mesh(new THREE.SphereGeometry(0.022, 8, 6), std('#2a1a12'), Math.cos(a) * 0.05, 0.03, Math.sin(a) * 0.05))
    }
    const g = group(cup, tea, lid, straw, ...pearls)
    g.rotation.z = 1.35
    g.position.y = 0.1
    return g
  },
  sneaker: () => {
    const sole = mesh(new THREE.BoxGeometry(0.46, 0.05, 0.17), std('#f4f1ea'), 0, 0.025)
    const upper = mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 12).rotateZ(Math.PI / 2), aged('#c8342c'), 0.02, 0.1)
    upper.scale.set(1, 0.85, 1.05)
    const collar = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 14), aged('#c8342c'), -0.12, 0.15)
    const swoosh = mesh(new THREE.BoxGeometry(0.2, 0.025, 0.005), std('#f4f1ea'), 0.02, 0.09, 0.083)
    swoosh.rotation.z = 0.25
    const laces = mesh(new THREE.BoxGeometry(0.16, 0.012, 0.06), std('#f4f1ea'), 0.04, 0.165)
    return group(sole, upper, collar, swoosh, laces)
  },
  vinyl: () => {
    const disc = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 40), std('#141414', { roughness: 0.25 }), 0, 0.03)
    const label = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.014, 24), std('#d8443a'), 0, 0.031)
    const sleeve = slab(0.5, 0.5, 0.01, (c, w, h) => {
      c.fillStyle = '#e8c35a'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#3a2a5a'
      c.beginPath()
      c.arc(w * 0.62, h * 0.45, 70, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#3a2a20'
      c.font = 'bold 28px "PingFang TC", sans-serif'
      c.fillText('紅樓之夜', 20, h - 24)
    }, '#e8c35a')
    sleeve.position.set(-0.12, 0.005, -0.06)
    sleeve.rotation.y = 0.3
    disc.position.x = 0.1
    label.position.x = 0.1
    return group(sleeve, disc, label)
  },
  flipPhone: () => {
    const body = mesh(new THREE.BoxGeometry(0.11, 0.03, 0.22), aged('#9aa0a8', 'metal'), 0, 0.015, 0.11)
    const keys = mesh(new THREE.BoxGeometry(0.08, 0.005, 0.15), std('#3a3d42'), 0, 0.032, 0.11)
    const lid = new THREE.Group()
    lid.add(mesh(new THREE.BoxGeometry(0.11, 0.025, 0.22), aged('#9aa0a8', 'metal'), 0, 0, -0.11))
    lid.add(mesh(new THREE.BoxGeometry(0.08, 0.004, 0.12), glow('#7fd6ff'), 0, 0.014, -0.11))
    lid.rotation.x = 0.45
    lid.position.y = 0.03
    const g = group(body, keys, lid)
    g.scale.setScalar(1.7)
    return g
  },
  noodleBowl: () => {
    const profile = [[0.0, 0], [0.09, 0], [0.1, 0.02], [0.2, 0.1], [0.22, 0.16], [0.21, 0.16], [0.19, 0.11], [0.09, 0.03], [0.0, 0.03]].map(([x, y]) => new THREE.Vector2(x, y))
    const bowl = mesh(new THREE.LatheGeometry(profile, 28), aged('#ece4d4'))
    const rim = mesh(new THREE.TorusGeometry(0.214, 0.008, 6, 32).rotateX(Math.PI / 2), std('#c0392b'), 0, 0.16)
    const soup = mesh(new THREE.CircleGeometry(0.195, 28).rotateX(-Math.PI / 2), std('#7a4a2a', { roughness: 0.3 }), 0, 0.125)
    const spoon = mesh(new THREE.CapsuleGeometry(0.02, 0.24, 4, 8).rotateZ(Math.PI / 2), std('#f4f1ea'), 0.08, 0.19, 0.04)
    spoon.rotation.y = 0.5
    spoon.rotation.z = -0.35
    return group(bowl, rim, soup, spoon)
  },
  skateboard: () => {
    const deck = mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 12).rotateZ(Math.PI / 2), aged('#2d5f8a', 'wood'), 0, 0.07)
    deck.scale.y = 0.12
    const wheels = []
    for (const x of [-0.2, 0.2]) for (const z of [-0.07, 0.07]) wheels.push(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12).rotateX(Math.PI / 2), std('#f1c84b'), x, 0.03, z))
    const g = group(deck, ...wheels)
    g.rotation.z = 0.12
    return g
  },
  pocketWatch: () => {
    const brass = std('#c9a048', { metalness: 0.7, roughness: 0.35 })
    const caseM = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 28), brass, 0, 0.02)
    const face = mesh(new THREE.CircleGeometry(0.1, 28).rotateX(-Math.PI / 2), std('#f6f1e2'), 0, 0.041)
    const hands = [0.6, 2.2].map((a, i) => {
      const h = mesh(new THREE.BoxGeometry(i ? 0.08 : 0.06, 0.003, 0.008), std('#222'), 0, 0.043)
      h.geometry.translate((i ? 0.08 : 0.06) / 2, 0, 0)
      h.rotation.y = a
      return h
    })
    const bow = mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 14), brass, 0, 0.02, -0.15)
    bow.rotation.x = Math.PI / 2
    const chain = mesh(new THREE.TorusGeometry(0.16, 0.006, 4, 40, Math.PI * 1.2).rotateX(Math.PI / 2), brass, 0.05, 0.005, -0.2)
    return group(caseM, face, ...hands, bow, chain)
  },
  tinCar: () => {
    const body = mesh(new THREE.BoxGeometry(0.4, 0.1, 0.2), aged('#c8342c', 'metal'), 0, 0.09)
    const cab = mesh(new THREE.BoxGeometry(0.2, 0.09, 0.18), aged('#e9d9a8', 'metal'), -0.03, 0.18)
    const win = mesh(new THREE.BoxGeometry(0.205, 0.05, 0.12), std('#6fa8c8', { roughness: 0.2 }), -0.03, 0.19)
    const wheels = []
    for (const x of [-0.13, 0.13]) for (const z of [-0.105, 0.105]) wheels.push(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 14).rotateX(Math.PI / 2), std('#222'), x, 0.045, z))
    const key = mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 12), std('#c9a048', { metalness: 0.7 }), 0.22, 0.12, 0)
    key.rotation.y = Math.PI / 2
    return group(body, cab, win, ...wheels, key)
  },
  oldKey: () => {
    const brass = aged('#b38a3c', 'metal')
    const bow = mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20).rotateX(Math.PI / 2), brass, -0.2, 0.02)
    const shaft = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 8).rotateZ(Math.PI / 2), brass, 0.04, 0.02)
    const bit1 = mesh(new THREE.BoxGeometry(0.03, 0.02, 0.07), brass, 0.17, 0.02, 0.035)
    const bit2 = mesh(new THREE.BoxGeometry(0.03, 0.02, 0.05), brass, 0.12, 0.02, 0.025)
    const g = group(bow, shaft, bit1, bit2)
    g.scale.setScalar(1.3)
    return g
  },
  letter: () => {
    const env = slab(0.42, 0.26, 0.012, (c, w, h) => {
      c.fillStyle = '#efe6d2'
      c.fillRect(0, 0, w, h)
      c.strokeStyle = '#cbbd9e'
      c.lineWidth = 3
      c.beginPath()
      c.moveTo(0, 0)
      c.lineTo(w / 2, h * 0.55)
      c.lineTo(w, 0)
      c.stroke()
      c.fillStyle = '#4a3a2a'
      c.font = 'italic 20px serif'
      c.fillText('給 阿聲', 20, h - 22)
    })
    const seal = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 14), std('#a3241c'), 0, 0.012, 0.01)
    return group(env, seal)
  },
  musicBox: () => {
    const wood = aged('#8a5a34', 'wood')
    const box = mesh(new THREE.BoxGeometry(0.3, 0.14, 0.22), wood, 0, 0.07)
    const lid = mesh(new THREE.BoxGeometry(0.3, 0.025, 0.22), wood, 0, 0.0, -0.11)
    lid.geometry.translate(0, 0, 0.11)
    const hinge = new THREE.Group()
    hinge.position.set(0, 0.14, -0.11)
    hinge.rotation.x = -1.9
    hinge.add(lid)
    const comb = mesh(new THREE.BoxGeometry(0.16, 0.01, 0.06), std('#c9c9c9', { metalness: 0.8, roughness: 0.3 }), 0, 0.145, 0.03)
    const drum = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12).rotateZ(Math.PI / 2), std('#c9a048', { metalness: 0.7 }), 0, 0.16, -0.02)
    const crank = mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), std('#c9a048', { metalness: 0.7 }), 0.18, 0.08, 0)
    return group(box, hinge, comb, drum, crank)
  },
}

// In story order: each find is a memory DLV-06 recovers, from the first flood warnings to
// the night of the last train (see story.js). The meadow's tell of life after the move.
export const RELICS = {
  ximending: [
    { id: 'ticket', date: '2049.07', name: '電影票根', hint: '電影街的騎樓下', story: '日昇戲院的午夜場。散場時河堤的警報響了，大家笑著說「又來了」，撐著傘去吃宵夜。那年夏天，警報響了九次。' },
    { id: 'bubbleTea', date: '2050.06', name: '珍奶杯', hint: '漢中街徒步區', story: '半糖少冰。店門口貼了新告示：「因淹水保險調漲，飲品一律加價五元。」杯底還黏著兩顆珍珠。' },
    { id: 'vinyl', date: '2051.08', name: '黑膠唱片', hint: '武昌街往東', story: '二手唱片行把唱片全搬上二樓，老闆說：「水只會淹到膝蓋，到不了這裡。」這張放在最上層，所以留了下來。' },
    { id: 'neon', date: '2052.09', name: '霓虹燈管', hint: '峨眉街', story: '白鷺颱風那一夜，淡水河漫過了河堤。峨眉街的招牌一盞一盞熄滅，那是四十年來第一次全暗。水，停在一樓半的高度。' },
    { id: 'cassette', date: '2052.10', name: '卡帶', hint: '紅樓附近', story: '水退了三週，紅樓前擠滿清淤的志工。有人用收音機錄下大家邊鏟泥邊唱的歌，標籤寫著「西門 MIX ’52」。' },
    { id: 'sneaker', date: '2053.03', name: '球鞋', hint: '新世界大樓那頭', story: '店重新開張的那一週，政府公布了「綠洲遷居計畫」，西門町列入第一期。這雙鞋只穿過一次。' },
    { id: 'skateboard', date: '2053.11', name: '滑板', hint: '成都路', story: '搬家前的最後一個週末，大家在紅樓前的廣場溜到天亮。膝蓋上的疤，是這座城留給我的紀念。' },
    { id: 'noodleBowl', date: '2054.04', name: '麵線碗', hint: '總是排著隊的那個攤子', story: '阿忠麵線最後一天營業，排隊的人比四十年來任何一天都多。老闆說：「山上見，到時候再煮給你們吃。」' },
    { id: 'card', date: '2054.04', name: '悠悠卡', hint: '六號出口附近', story: '最後一班捷運，4 月 30 日 23:40。卡裡還剩 37 元，再也用不到了。' },
    { id: 'flipPhone', date: '2054.04', name: '折疊手機', hint: '西寧南路', story: '最後一封簡訊，寄件人小麥：「我在六號出口等你。」還沒送出的回覆：「店裡收不完，我請外送機器人先把信送過去。」' },
  ],
  meadow: [
    { id: 'pocketWatch', date: '2054.05', name: '懷錶', hint: '磚拱門下', story: '指針停在 23:40，最後一班捷運開走的時間。從那天起，就再也沒有人替它上過發條。' },
    { id: 'oldKey', date: '2058', name: '舊鑰匙', hint: '鐵門旁', story: '西門町老家的鑰匙。那扇門早就泡過水了，還是捨不得丟。' },
    { id: 'tinCar', date: '2066', name: '鐵皮小車', hint: '飼料箱附近', story: '在山上出生的孩子，把城裡帶來的玩具一個個玩到掉漆。他們從來沒見過捷運。' },
    { id: 'letter', date: '2079', name: '信封', hint: '村子裡的攤子旁', story: '收件人寫著「阿聲」，地址是西門町的舊店。沒有郵差會去那裡了，所以每年寫一封，每年都沒有寄出。' },
    { id: 'musicBox', date: '2085', name: '音樂盒', hint: '小木屋旁', story: '每天傍晚，村子裡都會飄來這段旋律。原來一直在耳邊的音樂，是有人每天替它轉一次發條。' },
  ],
}

export const relicModel = (id) => MODELS[id]()
