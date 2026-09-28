export const toDateInputValue = (value?: string | null) => {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const brazilianDate = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brazilianDate) return `${brazilianDate[3]}-${brazilianDate[2]}-${brazilianDate[1]}`

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

const isValidIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const toBrazilianDateInputValue = (value?: string | null) => {
  const isoDate = toDateInputValue(value)
  if (!isValidIsoDate(isoDate)) return ''

  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export const fromBrazilianDateInputValue = (value?: string | null) => {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return ''

  const isoDate = `${match[3]}-${match[2]}-${match[1]}`
  return isValidIsoDate(isoDate) ? isoDate : ''
}

export const maskBrazilianDateInput = (value?: string | null) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean)
  return parts.join('/')
}
