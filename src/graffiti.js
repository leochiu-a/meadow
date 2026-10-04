import * as THREE from 'three'
import { rand, range, pick } from './terrain.js'

// Spray-paint graffiti drawn into a canvas and applied as a decal on brick.
// 'tag' is a quick one-colour scrawl with drips; 'piece' is chunky bubble letters with
// a fill colour, dark outline and highlights.

// Scrawled letterforms: looping strokes with the odd tall ascender, and an underline swoosh,
// spread across a canvas of size w x h.
function tagPath(letters, w, h) {
  const path = new Path2D()
  const drips = []
  const step = (w * 0.8) / letters
  let x = w * 0.1
  const base = h * 0.66
  path.moveTo(x, base)
  for (let i = 0; i < letters; i++) {
    const tall = rand() < 0.35
    // Bezier strokes only reach ~3/4 of their control height, so aim high.
    const top = base - h * range(0.5, tall ? 0.85 : 0.65)
    const nx = x + step * range(0.85, 1.15)
    path.bezierCurveTo(x + range(-10, 20), top, nx + range(-25, 5), top - range(-10, 20), nx - range(5, 20), base + range(-5, 15))
    if (rand() < 0.5) path.quadraticCurveTo(nx + 10, base + range(20, 40), nx + range(10, 25), base - range(10, 30))
    if (rand() < 0.45) drips.push([nx - 10, base + 12])
    x = nx
  }
  path.moveTo(w * 0.08, base + h * 0.14)
  path.bezierCurveTo(w * 0.3, base + h * 0.24, w * 0.6, base + h * 0.06, Math.min(x + 20, w * 0.95), base + h * 0.1)
  return { path, drips }
}

// Soft overspray halo under a solid core line.
function spray(ctx, path, color, width) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = 0.25
  ctx.lineWidth = width * 2.6
  ctx.filter = 'blur(4px)'
  ctx.stroke(path)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.lineWidth = width
  ctx.stroke(path)
  ctx.restore()
}

function dripLines(ctx, drips, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  for (const [dx, dy] of drips) {
    const len = range(20, 70)
    ctx.lineWidth = range(2, 4)
    ctx.beginPath()
    ctx.moveTo(dx, dy)
    ctx.lineTo(dx + range(-2, 2), dy + len)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(dx, dy + len, ctx.lineWidth * 0.9, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawTag(ctx, w, h) {
  const color = pick(['#151515', '#1d1f2a', '#2a1414', '#f2f2ee'])
  const { path, drips } = tagPath(3 + Math.floor(rand() * 3), w, h)
  spray(ctx, path, color, range(15, 20))
  dripLines(ctx, drips, color)
  // A small crown flourish over some tags.
  if (rand() < 0.6) {
    const crown = new Path2D()
    const cx = range(w * 0.35, w * 0.65)
    const cy = h * 0.14
    crown.moveTo(cx - 40, cy + 40)
    crown.lineTo(cx - 26, cy)
    crown.lineTo(cx, cy + 28)
    crown.lineTo(cx + 26, cy - 4)
    crown.lineTo(cx + 42, cy + 40)
    spray(ctx, crown, color, 10)
  }
}

const WORDS = ['BLOOM', 'MEOW', 'KIRO', 'ZEN', 'RAD', 'SOFT', 'HOME', 'YO']

// Bubble-letter piece: each letter tilted and bobbed, wrapped in a thick dark outline
// with a drop shadow, a two-tone fill, white shines and the odd drip.
function drawPiece(ctx, w, h) {
  const word = pick(WORDS)
  const fill = pick([['#ff7ab6', '#d63f86'], ['#6cd0ff', '#2f8fd6'], ['#ffd85a', '#f0a020'], ['#8be06c', '#3fa83a'], ['#ff9a4a', '#e0521f']])
  const size = Math.min(h * 0.62, (w * 0.86) / (word.length * 0.72))
  ctx.font = `900 ${size}px "Arial Black", "Arial Rounded MT Bold", Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const widths = [...word].map((ch) => ctx.measureText(ch).width * 0.88)
  const total = widths.reduce((a, b) => a + b, 0)
  let x = (w - total) / 2
  const letters = [...word].map((ch, i) => {
    const l = { ch, x: x + widths[i] / 2, y: h * 0.5 + range(-h * 0.05, h * 0.05), rot: range(-0.18, 0.18) }
    x += widths[i]
    return l
  })
  const each = (fn) => {
    for (const l of letters) {
      ctx.save()
      ctx.translate(l.x, l.y)
      ctx.rotate(l.rot)
      fn(l)
      ctx.restore()
    }
  }
  ctx.lineJoin = 'round'
  // Drop shadow, then the outline.
  each((l) => {
    ctx.fillStyle = 'rgba(10,10,10,0.55)'
    ctx.fillText(l.ch, 10, 12)
  })
  each((l) => {
    ctx.strokeStyle = '#141414'
    ctx.lineWidth = size * 0.22
    ctx.strokeText(l.ch, 0, 0)
  })
  each((l) => {
    const grad = ctx.createLinearGradient(0, -size * 0.4, 0, size * 0.4)
    grad.addColorStop(0, fill[0])
    grad.addColorStop(0.55, fill[0])
    grad.addColorStop(0.56, fill[1])
    grad.addColorStop(1, fill[1])
    ctx.fillStyle = grad
    ctx.fillText(l.ch, 0, 0)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.ellipse(-size * 0.16, -size * 0.2, size * 0.04, size * 0.09, -0.4, 0, Math.PI * 2)
    ctx.fill()
  })
  dripLines(
    ctx,
    letters.filter(() => rand() < 0.4).map((l) => [l.x + range(-10, 10), l.y + size * 0.36]),
    fill[1],
  )
}

function graffitiTexture(style, aspect) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = Math.round(512 / aspect)
  const ctx = canvas.getContext('2d')
  if (style === 'piece') drawPiece(ctx, canvas.width, canvas.height)
  else drawTag(ctx, canvas.width, canvas.height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * Decal plane facing +Z, centred on the origin, `width` metres wide at the given aspect.
 * Paint sits just off the wall and is pulled forward in depth so it never z-fights.
 */
export function graffiti(width, style = 'tag', aspect = 2) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / aspect),
    new THREE.MeshStandardMaterial({
      map: graffitiTexture(style, aspect),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      roughness: 0.85,
    }),
  )
  mesh.receiveShadow = true
  return mesh
}

/**
 * Paint graffiti on one face of a swept brick wall at arc-length fraction t.
 * side picks the face (+1 or -1 along the wall's left normal).
 */
export function graffitiOnWall(curve, t, { side = 1, width = 1.4, y = 0.8, thickness = 0.7, style = 'tag', ground = 0 } = {}) {
  const p = curve.getPointAt(t)
  const tan = curve.getTangentAt(t)
  const normal = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(side)
  const decal = graffiti(width, style)
  decal.position.copy(p).addScaledVector(normal, thickness / 2 + 0.015)
  decal.position.y = ground + y
  decal.lookAt(decal.position.clone().add(normal))
  return decal
}
