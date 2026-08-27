// scripts/gen-icons.js — 生成 tabBar PNG 图标（纯 Node，无外部依赖）
// 输出：src/assets/tab-{search,explore,plan,profile}[-active].png (81x81 RGBA)
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 81

// ---------- PNG 编码 ----------
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(pixels, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // 每行前加 filter byte 0
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    pixels.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 绘制辅助（基于距离场 + 1px 羽化） ----------
function makeCanvas() {
  return Buffer.alloc(SIZE * SIZE * 4) // 透明背景
}

function hexToRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function blend(px, x, y, rgb, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const a = Math.min(1, alpha)
  const oldA = px[i + 3] / 255
  const outA = a + oldA * (1 - a)
  if (outA <= 0) return
  px[i] = Math.round((rgb[0] * a + px[i] * oldA * (1 - a)) / outA)
  px[i + 1] = Math.round((rgb[1] * a + px[i + 1] * oldA * (1 - a)) / outA)
  px[i + 2] = Math.round((rgb[2] * a + px[i + 2] * oldA * (1 - a)) / outA)
  px[i + 3] = Math.round(outA * 255)
}

// 按距离场填充：dist(x,y) <= 0 为形状内部，[-feather,0] 区间羽化
function paint(px, rgb, distFn) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = distFn(x + 0.5, y + 0.5)
      if (d < 1) blend(px, x, y, rgb, d <= 0 ? 1 : 1 - d)
    }
  }
}

const ringDist = (cx, cy, r, t) => (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) - t / 2
const discDist = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r
function segDist(x1, y1, x2, y2, t) {
  return (x, y) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy
    let u = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2
    u = Math.max(0, Math.min(1, u))
    return Math.hypot(x - (x1 + u * dx), y - (y1 + u * dy)) - t / 2
  }
}

// ---------- 图标 ----------
function drawSearch(rgb) {
  const px = makeCanvas()
  paint(px, rgb, ringDist(35, 35, 20, 7))
  paint(px, rgb, segDist(50, 50, 67, 67, 8))
  return px
}

function drawExplore(rgb) {
  const px = makeCanvas()
  paint(px, rgb, ringDist(40.5, 40.5, 28, 6))
  // 罗盘指针（斜向双三角形近似为粗线 + 中心点）
  paint(px, rgb, segDist(29, 52, 52, 29, 7))
  paint(px, rgb, discDist(40.5, 40.5, 6))
  return px
}

function drawProfile(rgb) {
  const px = makeCanvas()
  paint(px, rgb, discDist(40.5, 27, 14))
  // 肩部圆弧（下半圆截断）
  paint(px, rgb, (x, y) => {
    const d = Math.hypot(x - 40.5, y - 70) - 24
    return y > 64 ? 1 : d
  })
  return px
}

// 行程规划：起点圆 + 斜向航线 + 终点圆（地图路线意象）
function drawPlan(rgb) {
  const px = makeCanvas()
  paint(px, rgb, discDist(23, 58, 9))
  paint(px, rgb, segDist(30, 51, 51, 30, 6))
  paint(px, rgb, ringDist(58, 23, 9, 6))
  return px
}

// ---------- 输出 ----------
const outDir = path.join(__dirname, '..', 'src', 'assets')
fs.mkdirSync(outDir, { recursive: true })

// iOS 色板：未选中 systemGray / 选中 systemBlue
const NORMAL = hexToRGB('#8e8e93')
const ACTIVE = hexToRGB('#0a84ff')

const icons = {
  'tab-search': drawSearch,
  'tab-explore': drawExplore,
  'tab-plan': drawPlan,
  'tab-profile': drawProfile
}

for (const [name, draw] of Object.entries(icons)) {
  fs.writeFileSync(path.join(outDir, `${name}.png`), encodePNG(draw(NORMAL), SIZE, SIZE))
  fs.writeFileSync(path.join(outDir, `${name}-active.png`), encodePNG(draw(ACTIVE), SIZE, SIZE))
  console.log(`generated ${name}.png / ${name}-active.png`)
}

// 地图 marker 小圆点（浅色主题：白芯）
function drawDot(rgb) {
  const px = makeCanvas()
  paint(px, rgb, discDist(40.5, 40.5, 26))
  paint(px, [255, 255, 255], discDist(40.5, 40.5, 12))
  return px
}
fs.writeFileSync(path.join(outDir, 'marker-cyan.png'), encodePNG(drawDot(ACTIVE), SIZE, SIZE))
fs.writeFileSync(path.join(outDir, 'marker-orange.png'), encodePNG(drawDot(hexToRGB('#ff9f0a')), SIZE, SIZE))
console.log('generated marker-cyan.png / marker-orange.png')
