const requiredMethods = [
  'put',
  'get',
  'head',
  'delete'
]

export const assertObjectStorageProvider = (
  provider
) => {
  if (!provider || typeof provider !== 'object') {
    throw new Error(
      'ObjectStorageProvider invalido.'
    )
  }

  for (const method of requiredMethods) {
    if (typeof provider[method] !== 'function') {
      throw new Error(
        `ObjectStorageProvider sem o metodo ${method}.`
      )
    }
  }

  return provider
}

/**
 * Contrato mínimo do domínio para storage de objetos.
 * A implementação Cloudflare R2 fica separada do domínio; endpoint,
 * credenciais e autorização temporária são responsabilidade do Backend.
 */
export const createObjectStorageProvider = (
  provider
) =>
  assertObjectStorageProvider(
    provider
  )

export const OBJECT_STORAGE_METHODS =
  Object.freeze([
    ...requiredMethods
  ])
