const invalid = []

const requireHttpsUrl = (name) => {
  const value = String(process.env[name] || '').trim()

  if (!value) {
    invalid.push(`${name} e obrigatoria em Production.`)
    return
  }

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()

    if (url.protocol !== 'https:') {
      invalid.push(`${name} deve usar HTTPS em Production.`)
    }

    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
      invalid.push(`${name} nao pode apontar para host local em Production.`)
    }
  } catch {
    invalid.push(`${name} nao contem uma URL valida.`)
  }
}

const optionalWssUrl = (name) => {
  const value = String(process.env[name] || '').trim()
  if (!value) return

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()

    if (url.protocol !== 'wss:') {
      invalid.push(`${name} deve usar WSS em Production.`)
    }

    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
      invalid.push(`${name} nao pode apontar para host local em Production.`)
    }
  } catch {
    invalid.push(`${name} nao contem uma URL valida.`)
  }
}

requireHttpsUrl('PRINTFLOW_API_URL')
requireHttpsUrl('NUXT_PUBLIC_API_BASE')
optionalWssUrl('PRINTFLOW_WS_URL')

const objectStorageProvider = String(process.env.OBJECT_STORAGE_PROVIDER || '').trim().toLowerCase()
if (objectStorageProvider !== 'r2') {
  invalid.push('OBJECT_STORAGE_PROVIDER deve ser r2 em Production.')
} else {
  for (const name of ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!String(process.env[name] || '').trim()) {
      invalid.push(`${name} e obrigatoria quando OBJECT_STORAGE_PROVIDER=r2.`)
    }
  }

  const endpoint = String(process.env.R2_ENDPOINT || '').trim()
  if (!endpoint) {
    invalid.push('R2_ENDPOINT e obrigatoria quando OBJECT_STORAGE_PROVIDER=r2.')
  } else {
    try {
      const url = new URL(endpoint)
      if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
        invalid.push('R2_ENDPOINT deve ser uma URL HTTPS do endpoint S3, sem bucket ou query.')
      }
    } catch {
      invalid.push('R2_ENDPOINT nao contem uma URL valida.')
    }
  }
}

if (String(process.env.PRINTFLOW_DEV_MOCK_BAMBU || '').trim().toLowerCase() === 'true') {
  invalid.push('PRINTFLOW_DEV_MOCK_BAMBU nao pode estar ativo em Production.')
}

if (invalid.length) {
  for (const message of invalid) {
    console.error(`Production config invalida: ${message}`)
  }
  process.exitCode = 1
} else {
  console.log('Production config valida.')
}
