import { createConfiguredObjectStorage } from './configuredObjectStorage.js'

export const productImageMaxBytes = 5 * 1024 * 1024
export const productImageMarkerPrefix = 'photo:'

let configuredObjectStorage
const getConfiguredObjectStorage = () => {
  configuredObjectStorage ||= createConfiguredObjectStorage()
  return configuredObjectStorage
}

const safeSegment = (value) => {
  const segment = String(value || '').trim()
  if (!segment || !/^[a-zA-Z0-9._-]{1,160}$/.test(segment) || segment === '.' || segment === '..') {
    throw new Error('Identificador de imagem invalido.')
  }
  return segment
}

const storageKey = (tenantId, productId) =>
  `product-images/${safeSegment(tenantId)}/${safeSegment(productId)}/cover`

export const detectProductImageType = (body) => {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new Error('Imagem vazia.')
  if (body.length > productImageMaxBytes) throw new Error('A imagem deve ter no maximo 5 MB.')

  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return 'image/jpeg'
  }
  if (body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }

  throw new Error('Formato de imagem invalido. Use PNG, JPG ou WEBP.')
}

export const productImageMimeFromMarker = (marker) => {
  const mimeType = String(marker || '').startsWith(productImageMarkerPrefix)
    ? String(marker).slice(productImageMarkerPrefix.length).split('|')[0]
    : ''
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) ? mimeType : ''
}

export const saveProductImage = async ({ tenantId, productId, body, objectStorageProvider } = {}) => {
  const mimeType = detectProductImageType(body)
  const key = storageKey(tenantId, productId)
  const provider = objectStorageProvider || getConfiguredObjectStorage()
  await provider.put({ key, body, contentType: mimeType })
  return {
    key,
    mimeType,
    sizeBytes: body.length,
    marker: `${productImageMarkerPrefix}${mimeType}|${safeSegment(productId)}`
  }
}

const streamToBuffer = async (stream) => {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > productImageMaxBytes) throw new Error('Imagem armazenada excede o limite permitido.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export const readProductImage = async ({ tenantId, productId, marker, objectStorageProvider } = {}) => {
  const mimeType = productImageMimeFromMarker(marker)
  if (!mimeType) throw new Error('Imagem de produto nao encontrada.')
  const provider = objectStorageProvider || getConfiguredObjectStorage()
  const object = await provider.get(storageKey(tenantId, productId))
  const body = await streamToBuffer(object.body)
  if (detectProductImageType(body) !== mimeType) throw new Error('Imagem armazenada invalida.')
  return { body, mimeType }
}
