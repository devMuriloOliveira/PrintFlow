import { blindIndex } from '../security/crypto.js'

export const normalizeCompanyDocument = (value) => String(value || '').replace(/\D/g, '')

const allSameDigits = (digits) => /^(\d)\1+$/.test(digits)
const checkDigit = (digits, weights) => {
  const total = weights.reduce((sum, weight, index) => sum + Number(digits[index]) * weight, 0)
  const remainder = total % 11
  return remainder < 2 ? 0 : 11 - remainder
}

export const companyDocumentType = (value) => {
  const digits = normalizeCompanyDocument(value)
  return digits.length === 11 ? 'cpf' : digits.length === 14 ? 'cnpj' : ''
}

export const isValidCpf = (value) => {
  const digits = normalizeCompanyDocument(value)
  return digits.length === 11 && !allSameDigits(digits)
    && Number(digits[9]) === checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])
    && Number(digits[10]) === checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
}

export const isValidCnpj = (value) => {
  const digits = normalizeCompanyDocument(value)
  return digits.length === 14 && !allSameDigits(digits)
    && Number(digits[12]) === checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    && Number(digits[13]) === checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
}

export const validCompanyDocument = (value) => {
  const digits = normalizeCompanyDocument(value)
  const type = companyDocumentType(digits)
  if (!type || !(type === 'cpf' ? isValidCpf(digits) : isValidCnpj(digits))) return null
  return { digits, type, hash: blindIndex(`company-document:${type}:${digits}`) }
}
