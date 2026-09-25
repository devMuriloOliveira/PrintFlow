import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const sha256 = async (filePath) => {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex').toUpperCase()
}

const safeRelativePath = (value) => {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  const withoutPrefix = normalized.replace(/^.*Agent\/dist\//i, '')
  if (!withoutPrefix || withoutPrefix.startsWith('/') || withoutPrefix.split('/').includes('..')) {
    throw new Error('Caminho de artefato da release invalido.')
  }
  return withoutPrefix
}

export const parseReleaseSums = (content) => String(content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
  if (!match) throw new Error('Linha SHA-256 da release invalida.')
  return { expected: match[1].toUpperCase(), relativePath: safeRelativePath(match[2]) }
})

export const verifyReleaseDirectory = async ({ directory, expectedVersion = '', expectedCertificateSha256 = '' } = {}) => {
  const root = path.resolve(String(directory || ''))
  const metadata = JSON.parse(await readFile(path.join(root, 'RELEASE-METADATA.json'), 'utf8'))
  if (!['DEV_SELF_SIGNED', 'PRODUCTION_TRUSTED'].includes(metadata.signingMode)) throw new Error('signingMode da release invalido.')
  if (metadata.signingMode === 'PRODUCTION_TRUSTED' && metadata.productionTrusted !== true) throw new Error('PRODUCTION_TRUSTED exige productionTrusted=true.')
  if (metadata.signingMode === 'DEV_SELF_SIGNED' && metadata.productionTrusted !== false) throw new Error('DEV_SELF_SIGNED exige productionTrusted=false.')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(metadata.minimumSupportedVersion || ''))) throw new Error('Versao minima suportada invalida.')
  if (metadata.portableRuntime !== true) throw new Error('Release sem runtime Node.js portatil.')
  if (!/^24\.\d+\.\d+$/.test(String(metadata.nodeRuntimeVersion || ''))) throw new Error('Versao do runtime Node.js invalida.')
  if (metadata.nodeRuntimeArchitecture !== 'x64') throw new Error('Arquitetura do runtime Node.js invalida.')
  if (expectedVersion && String(metadata.version || '') !== String(expectedVersion)) throw new Error('Versao da release nao corresponde ao esperado.')
  const expectedCertificate = String(expectedCertificateSha256 || metadata.certificateSha256 || '').trim().toUpperCase()
  const entries = parseReleaseSums(await readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8'))
  if (!entries.length) throw new Error('SHA256SUMS.txt vazio.')
  for (const entry of entries) {
    const filePath = path.resolve(root, entry.relativePath)
    if (!filePath.startsWith(`${root}${path.sep}`) || !(await stat(filePath)).isFile()) throw new Error(`Artefato ausente: ${entry.relativePath}`)
    if (await sha256(filePath) !== entry.expected) throw new Error(`Hash divergente: ${entry.relativePath}`)
  }
  if (expectedCertificate) {
    const certificateEntry = entries.find((entry) => entry.relativePath.toLowerCase().endsWith('.cer'))
    if (!certificateEntry || certificateEntry.expected !== expectedCertificate) throw new Error('Certificado da release nao corresponde ao esperado.')
  }
  return { metadata, entries }
}
