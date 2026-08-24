import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

const outputPng = resolve('assets/printflow-agent-icon.png')
const outputIco = resolve('assets/printflow-agent-icon.ico')
const size = 256

const polygons = [
  { color: [111, 77, 246, 255], points: [[22, 2], [35, 9.5], [35, 24.5], [22, 32], [9, 24.5], [9, 9.5]] },
  { color: [35, 72, 216, 255], points: [[22, 17], [35, 9.5], [35, 24.5], [22, 32]] },
  { color: [66, 193, 242, 255], points: [[22, 17], [9, 9.5], [9, 24.5], [22, 32]] },
  { color: [23, 104, 242, 230], points: [[22, 17], [35, 24.5], [22, 42], [9, 34.5], [22, 27]] },
  { color: [98, 210, 239, 255], points: [[9, 24.5], [22, 32], [22, 42], [9, 34.5]] }
]

function blendPixel(data, index, color) {
  const alpha = color[3] / 255
  const inverse = 1 - alpha
  data[index] = Math.round(color[0] * alpha + data[index] * inverse)
  data[index + 1] = Math.round(color[1] * alpha + data[index + 1] * inverse)
  data[index + 2] = Math.round(color[2] * alpha + data[index + 2] * inverse)
  data[index + 3] = Math.round(255 * alpha + data[index + 3] * inverse)
}

function pointInPolygon(x, y, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0]
    const yi = points[i][1]
    const xj = points[j][0]
    const yj = points[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function createPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rawRow = y * (width * 4 + 1)
    raw[rawRow] = 0
    rgba.copy(raw, rawRow + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function createIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  return Buffer.concat([header, entry, png])
}

const rgba = Buffer.alloc(size * size * 4)
const scale = size / 44

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const svgX = (x + 0.5) / scale
    const svgY = (y + 0.5) / scale
    const pixel = (y * size + x) * 4
    for (const polygon of polygons) {
      if (pointInPolygon(svgX, svgY, polygon.points)) {
        blendPixel(rgba, pixel, polygon.color)
      }
    }
  }
}

const png = createPng(size, size, rgba)
mkdirSync(dirname(outputPng), { recursive: true })
writeFileSync(outputPng, png)
writeFileSync(outputIco, createIco(png))

console.log(`Icones gerados: ${outputPng}, ${outputIco}`)
