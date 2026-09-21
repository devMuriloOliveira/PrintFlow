import { readFile } from 'node:fs/promises'

const numberAfter = (text, pattern) => {
  const match = text.match(pattern)
  if (!match) return null
  const value = Number.parseFloat(match[1].replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

const secondsFromDuration = (value) => {
  const match = String(value || '').match(/(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i)
  if (!match || !match.slice(1).some(Boolean)) return null
  return (Number(match[1] || 0) * 86400) + (Number(match[2] || 0) * 3600) + (Number(match[3] || 0) * 60) + Number(match[4] || 0)
}

export const parseGcodeMetrics = (text) => {
  const source = String(text || '')
  const durationText = source.match(/;\s*estimated printing time[^=]*=\s*([^\r\n]+)/i)?.[1]
  return {
    estimatedPrintSeconds: secondsFromDuration(durationText),
    estimatedFilamentGrams: numberAfter(source, /;\s*total filament used\s*\[g\]\s*=\s*([\d.,]+)/i),
    estimatedFilamentMillimeters: numberAfter(source, /;\s*filament used\s*\[mm\]\s*=\s*([\d.,]+)/i)
  }
}

export const readGcodeMetrics = async (inputPath) =>
  parseGcodeMetrics(await readFile(inputPath, 'utf8'))
