import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const distFlag = process.argv.find(value => value.startsWith('--dist='))
const dist = path.resolve(distFlag?.slice('--dist='.length) || 'Agent/dist')

const readJson = async name => JSON.parse(await readFile(path.join(dist, name), 'utf8'))
const sha256 = async filePath => {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex').toUpperCase()
}

const metadata = await readJson('RELEASE-METADATA.json')
if (!['DEV_SELF_SIGNED', 'PRODUCTION_TRUSTED'].includes(metadata.signingMode)) {
  throw new Error('signingMode da release invalido.')
}
if (metadata.signingMode === 'PRODUCTION_TRUSTED' && metadata.productionTrusted !== true) {
  throw new Error('PRODUCTION_TRUSTED exige productionTrusted=true.')
}
if (metadata.signingMode === 'DEV_SELF_SIGNED' && metadata.productionTrusted !== false) {
  throw new Error('DEV_SELF_SIGNED exige productionTrusted=false.')
}
if (metadata.portableRuntime !== true) {
  throw new Error('Release do Agent deve incluir runtime portatil.')
}
if (!/^24\.\d+\.\d+$/.test(String(metadata.nodeRuntimeVersion || ''))) {
  throw new Error('Versao do runtime Node.js da release e invalida.')
}
if (metadata.nodeRuntimeArchitecture !== 'x64') {
  throw new Error('Arquitetura do runtime Node.js da release e invalida.')
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

const certificateEntry = entries.find(entry => entry.relativePath.endsWith('PrintFlow-Agent-Dev-Certificate.cer'))
if (metadata.certificateSha256 && certificateEntry?.expected !== String(metadata.certificateSha256).toUpperCase()) {
  throw new Error('certificateSha256 nao corresponde ao certificado publicado.')
}

console.log(`Release artifacts valid (${entries.length} hashes; ${metadata.signingMode}).`)
