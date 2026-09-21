import { validCompanyDocument } from './companyDocument.js'

const text = (value, max = 160) => String(value || '').trim().slice(0, max)
const address = (data = {}) => [data.logradouro, data.numero, data.complemento].map((value) => text(value, 160)).filter(Boolean).join(', ').slice(0, 500)

export const companyLookupFromBrasilApi = (data = {}) => ({
  name: text(data.nome_fantasia || data.razao_social),
  legalName: text(data.razao_social),
  phone: text(data.ddd_telefone_1 || data.ddd_telefone_2, 40),
  email: text(data.email),
  address: address(data),
  district: text(data.bairro),
  city: text(data.municipio),
  state: text(data.uf, 2).toUpperCase(),
  zip: text(data.cep, 12),
  status: text(data.descricao_situacao_cadastral || data.situacao_cadastral, 60)
})

export const lookupCompanyByCnpj = async (value, request = fetch) => {
  const document = validCompanyDocument(value)
  if (!document || document.type !== 'cnpj') {
    const error = new Error('Informe um CNPJ valido para buscar os dados da empresa.')
    error.statusCode = 422
    throw error
  }

  let response
  try {
    response = await request(`https://brasilapi.com.br/api/cnpj/v1/${document.digits}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    })
  } catch {
    const error = new Error('A consulta de CNPJ esta indisponivel. Preencha os dados manualmente.')
    error.statusCode = 503
    throw error
  }

  if (response.status === 404) {
    const error = new Error('CNPJ nao encontrado na consulta complementar. Confira o numero ou preencha manualmente.')
    error.statusCode = 404
    throw error
  }
  if (!response.ok) {
    const error = new Error('A consulta de CNPJ esta indisponivel. Preencha os dados manualmente.')
    error.statusCode = 503
    throw error
  }

  return companyLookupFromBrasilApi(await response.json())
}
