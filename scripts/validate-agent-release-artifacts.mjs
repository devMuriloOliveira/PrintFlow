import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const distFlag = process.argv.find(value => value.startsWith('--dist='))
const dist = path.resolve(distFlag?.slice('--dist='.length) || 'Agent/dist')
const trustedEarlyAccessCertificateSha256 = 'AC55382179B1B6FF5D7642083ED1E674DC92793FF83B55F151C0F8DA0F9C7DBB'

const readJson = async name => JSON.parse(await readFile(path.join(dist, name), 'utf8'))
const sha256 = async filePath => {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex').toUpperCase()
}

const metadata = await readJson('RELEASE-METADATA.json')
const minimumSupportedVersion = process.env.FILA_AGENT_MINIMUM_SUPPORTED_VERSION ||
  process.env.PRINTFLOW_AGENT_MINIMUM_SUPPORTED_VERSION || '0.1.10'
if (!['DEV_SELF_SIGNED', 'PRODUCTION_TRUSTED'].includes(metadata.signingMode)) {
  throw new Error('signingMode da release invalido.')
}
if (metadata.signingMode === 'PRODUCTION_TRUSTED' && metadata.productionTrusted !== true) {
  throw new Error('PRODUCTION_TRUSTED exige productionTrusted=true.')
}
if (metadata.signingMode === 'DEV_SELF_SIGNED' && metadata.productionTrusted !== false) {
  throw new Error('DEV_SELF_SIGNED exige productionTrusted=false.')
}
if (metadata.minimumSupportedVersion !== minimumSupportedVersion) {
  throw new Error(`Versao minima suportada deve ser ${minimumSupportedVersion}.`)
}
if (metadata.runtime !== '.NET 8 self-contained' || metadata.selfContained !== true) {
  throw new Error('Release do Agent deve incluir o runtime C# .NET 8 autocontido.')
}

const sums = await readFile(path.join(dist, 'SHA256SUMS.txt'), 'utf8')
const entries = sums.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
  if (!match) throw new Error(`Linha SHA-256 invalida: ${line}`)
  return { expected: match[1].toUpperCase(), relativePath: match[2].trim().replace(/^.*Agent[\\/]+dist[\\/]+/, '') }
})
if (!entries.length) throw new Error('SHA256SUMS.txt vazio.')

for (const entry of entries) {
  const actual = await sha256(path.join(dist, entry.relativePath))
  if (actual !== entry.expected) throw new Error(`Hash divergente: ${entry.relativePath}`)
}

const hashesByName = new Map(entries.map(entry => [entry.relativePath.split(/[\\/]/).at(-1).toLowerCase(), entry.expected]))
const canonicalAssets = ['Fila-Agent-Windows.zip', 'Fila-Agent-Setup.exe', 'Fila-Agent-Transition-Setup.exe', 'Fila-Agent-Dev-Certificate.cer']
const compatibilityAssets = ['PrintFlow-Agent-Windows.zip', 'PrintFlow-Agent-Setup.exe', 'PrintFlow-Agent-Transition-Setup.exe', 'PrintFlow-Agent-Dev-Certificate.cer']
const hasCanonicalAssets = canonicalAssets.every(name => hashesByName.has(name.toLowerCase()))
const hasLegacyAssets = compatibilityAssets.every(name => hashesByName.has(name.toLowerCase()))
if (!hasCanonicalAssets && !hasLegacyAssets) {
  throw new Error('Release sem conjunto completo de artefatos Fila Agent ou aliases PrintFlow legados.')
}
if (hasCanonicalAssets && !hasLegacyAssets) {
  throw new Error('Release nova precisa manter os aliases PrintFlow para atualizar instalacoes existentes.')
}
if (hasCanonicalAssets) {
  for (const [canonical, legacy] of [
    ['Fila-Agent-Windows.zip', 'PrintFlow-Agent-Windows.zip'],
    ['Fila-Agent-Setup.exe', 'PrintFlow-Agent-Setup.exe'],
    ['Fila-Agent-Dev-Certificate.cer', 'PrintFlow-Agent-Dev-Certificate.cer'],
    ['Fila-Agent-Transition-Setup.exe', 'PrintFlow-Agent-Transition-Setup.exe']
  ]) {
    if (hashesByName.get(canonical.toLowerCase()) !== hashesByName.get(legacy.toLowerCase())) {
      throw new Error(`Alias legado diverge do artefato canonico: ${legacy}`)
    }
  }
}

const certificateEntries = entries.filter(entry => /(?:Fila|PrintFlow)-Agent-Dev-Certificate\.cer$/i.test(entry.relativePath))
const certificateEntry = certificateEntries.find(entry => /Fila-Agent-Dev-Certificate\.cer$/i.test(entry.relativePath)) || certificateEntries[0]
if (metadata.signingMode === 'DEV_SELF_SIGNED' && (!certificateEntry || certificateEntries.some(entry => entry.expected !== trustedEarlyAccessCertificateSha256))) {
  throw new Error('Certificado Early Access diverge da identidade confiavel do Agent.')
}
if (metadata.certificateSha256 && certificateEntry?.expected !== String(metadata.certificateSha256).toUpperCase()) {
  throw new Error('certificateSha256 nao corresponde ao certificado publicado.')
}

console.log(`Release artifacts valid (${entries.length} hashes; ${metadata.signingMode}).`)
