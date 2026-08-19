// Generates the PWA icons into public/. Run with `npm run icons` after changing
// the mark. Rasterised by hand — a canvas dependency would be the only reason
// this project needed one.

import { deflateSync, crc32 } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const INDIGO = [0x4f, 0x46, 0xe5]
const WHITE = [0xff, 0xff, 0xff]

/** Signed distance to a rounded rectangle centred on the origin. */
function roundedRect(x, y, halfW, halfH, r) {
  const dx = Math.abs(x) - (halfW - r)
  const dy = Math.abs(y) - (halfH - r)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r
}

/** Coverage in 0..1 for a distance field, antialiased across one pixel. */
const coverage = (d) => Math.min(Math.max(0.5 - d, 0), 1)

function over(dst, src, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = dst[i] * (1 - alpha) + src[i] * alpha
}

function render(size, inset) {
  const px = Buffer.alloc(size * size * 4)
  const s = size * inset
  const cardW = s * 0.72 / 2
  const cardH = s * 0.92 / 2
  const radius = s * 0.1
  // The back card sits up and to the right and tilts a little, so the stack
  // reads as two cards rather than as one card with torn corners.
  const backScale = 0.97
  const backOffX = s * 0.055
  const backOffY = -s * 0.055
  const angle = (-10 * Math.PI) / 180
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)

  // Two text rules on the front card.
  const ruleW = cardW * 1.04 / 2
  const ruleH = s * 0.055 / 2
  const rules = [
    { cx: 0, cy: -ruleH * 3.8, hw: ruleW, hh: ruleH },
    { cx: ruleW * 0.32, cy: ruleH * 1.8, hw: ruleW * 0.68, hh: ruleH },
  ]

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      const x = pxi + 0.5 - size / 2
      const y = py + 0.5 - size / 2
      const rgb = [...INDIGO]

      // Back card: offset, then tilted about its own centre.
      const bx = x - backOffX
      const by = y - backOffY
      const rx = bx * cos - by * sin
      const ry = bx * sin + by * cos
      over(
        rgb,
        WHITE,
        coverage(roundedRect(rx, ry, cardW * backScale, cardH * backScale, radius)) * 0.42,
      )

      // Front card.
      const front = coverage(roundedRect(x, y, cardW, cardH, radius))
      over(rgb, WHITE, front)

      // Rules, clipped to the front card so they never bleed onto the tilted one.
      for (const r of rules) {
        const c = coverage(roundedRect(x - r.cx, y - r.cy, r.hw, r.hh, r.hh))
        over(rgb, INDIGO, c * front)
      }

      const o = (py * size + pxi) * 4
      px[o] = Math.round(rgb[0])
      px[o + 1] = Math.round(rgb[1])
      px[o + 2] = Math.round(rgb[2])
      px[o + 3] = 255
    }
  }
  return px
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Maskable icons get a smaller mark so nothing important lands outside the
// platform's safe zone when it crops to a circle or squircle.
const targets = [
  ['icon-192.png', 192, 0.74],
  ['icon-512.png', 512, 0.74],
  ['icon-maskable-512.png', 512, 0.56],
  ['apple-touch-icon.png', 180, 0.74],
]

for (const [name, size, inset] of targets) {
  const file = join(OUT, name)
  writeFileSync(file, png(size, render(size, inset)))
  console.log(`wrote ${name} (${size}x${size})`)
}
