import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const outputPng = resolve('assets/fila-agent-icon.png')
const outputIco = resolve('assets/fila-agent-icon.ico')
const sourcePng = resolve('assets/filamind-icon-256.png')
function createIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const entries = []
  let offset = header.length + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size === 256 ? 0 : size
    entry[1] = size === 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map(image => image.png)])
}

const png = readFileSync(sourcePng)
const images = [{ size: 256, png }]
mkdirSync(dirname(outputPng), { recursive: true })
writeFileSync(outputPng, png)
writeFileSync(outputIco, createIco(images))

console.log(`Icones gerados: ${outputPng}, ${outputIco}`)
