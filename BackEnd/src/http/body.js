export const readJsonBody = (req, maxBytes = 1_000_000) => new Promise((resolve, reject) => {
  let body = ''

  req.on('data', (chunk) => {
    body += chunk
    if (body.length > maxBytes) {
      reject(new Error('Payload muito grande'))
      req.destroy()
    }
  })

  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {})
    } catch {
      reject(new Error('JSON invalido'))
    }
  })

  req.on('error', reject)
})

export const readRawBody = (req, maxBytes = 1_000_000) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > maxBytes) {
      reject(new Error('Payload muito grande'))
      req.destroy()
      return
    }
    chunks.push(Buffer.from(chunk))
  })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})
