import path from 'node:path'
import { readFile } from 'node:fs/promises'

const MAX_MODEL_BYTES = 200 * 1024 * 1024

const boundsFor = (vertices) => {
  if (!vertices.length) throw new Error('Modelo sem vertices STL validos.')
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis])
      max[axis] = Math.max(max[axis], vertex[axis])
    }
  }
  return { min, max, size: max.map((value, axis) => value - min[axis]) }
}

const parseBinaryStl = (buffer) => {
  if (buffer.length < 84) return null
  const triangleCount = buffer.readUInt32LE(80)
  if (triangleCount < 1 || 84 + triangleCount * 50 !== buffer.length) return null
  const vertices = []
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = 84 + triangle * 50 + 12
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const start = offset + vertex * 12
      vertices.push([buffer.readFloatLE(start), buffer.readFloatLE(start + 4), buffer.readFloatLE(start + 8)])
    }
  }
  return { format: 'stl', encoding: 'binary', triangleCount, bounds: boundsFor(vertices) }
}

const parseAsciiStl = (buffer) => {
  const text = buffer.toString('utf8')
  const vertices = [...text.matchAll(/\bvertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi)]
    .map((match) => match.slice(1).map(Number))
  if (!vertices.length || vertices.length % 3 !== 0 || !/^\s*solid\b/i.test(text)) return null
  return { format: 'stl', encoding: 'ascii', triangleCount: vertices.length / 3, bounds: boundsFor(vertices) }
}

const zipEntryNames = (buffer) => {
  const names = []
  for (let offset = 0; offset + 46 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const end = offset + 46 + nameLength + extraLength + commentLength
    if (end > buffer.length) continue
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    offset = end - 1
  }
  return names
}

export const analyzeModelFile = async (inputPath) => {
  const resolved = path.resolve(String(inputPath || ''))
  const buffer = await readFile(resolved)
  if (buffer.length === 0 || buffer.length > MAX_MODEL_BYTES) throw new Error('Tamanho de modelo invalido.')
  const extension = path.extname(resolved).toLowerCase()
  let result = extension === '.stl' && (parseBinaryStl(buffer) || parseAsciiStl(buffer))
  if (!result && extension === '.3mf' && buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    const entries = zipEntryNames(buffer)
    if (entries.includes('[Content_Types].xml') && entries.includes('3D/3dmodel.model')) {
      result = { format: '3mf', encoding: 'zip', entries: entries.length }
    }
  }
  if (!result) throw new Error('Formato de modelo nao suportado ou invalido.')
  return { path: resolved, bytes: buffer.length, ...result }
}
