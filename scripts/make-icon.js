// Draws the app icon (ruled ledger paper, red margin, three category bars) and writes
// public/icon.ico (16–256px, for the Windows shortcut) and public/icon-192.png / icon-512.png.
// Usage: node scripts/make-icon.js
const fs = require("fs")
const path = require("path")
const zlib = require("zlib")

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const INK = hex("#20301F"), PAPER = hex("#EEF3E9"), RULE = hex("#C6D6BF"), MARGIN = hex("#B4433D")
const BARS = [
  { x: 0.38, h: 0.34, color: hex("#B8622C") },
  { x: 0.56, h: 0.52, color: hex("#2A5A83") },
  { x: 0.74, h: 0.24, color: hex("#2F7A72") },
]

/** Colour at (u, v) in 0..1 icon space, or null outside the rounded square. */
function shade(u, v) {
  const r = 0.2
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r)
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null
  if (v < 0.22) return INK // masthead band
  for (const b of BARS) if (u >= b.x - 0.07 && u <= b.x + 0.07 && v >= 0.84 - b.h && v <= 0.84) return b.color
  if (u >= 0.22 && u <= 0.255) return MARGIN
  for (const y of [0.38, 0.53, 0.68, 0.84]) if (Math.abs(v - y) < 0.016) return RULE
  return PAPER
}

function render(size) {
  const SS = 4 // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
        }
      }
      const i = (y * size + x) * 4
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a }
      px[i + 3] = Math.round((a / (SS * SS)) * 255)
    }
  }
  return px
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function png(size) {
  const px = render(size)
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ])
}

function ico(sizes) {
  const images = sizes.map(png)
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i
    header[e] = s >= 256 ? 0 : s; header[e + 1] = s >= 256 ? 0 : s
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(images[i].length, e + 8); header.writeUInt32LE(offset, e + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

const out = path.join(__dirname, "..", "public")
fs.writeFileSync(path.join(out, "icon.ico"), ico([16, 24, 32, 48, 64, 256]))
fs.writeFileSync(path.join(out, "icon-192.png"), png(192))
fs.writeFileSync(path.join(out, "icon-512.png"), png(512))
console.log("Wrote public/icon.ico, icon-192.png, icon-512.png")
