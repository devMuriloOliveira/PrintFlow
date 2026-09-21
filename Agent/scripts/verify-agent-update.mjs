import path from 'node:path'

import { verifyReleaseDirectory } from '../src/updates/releaseVerifier.js'

const value = (name) => {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || ''
}

const directory = path.resolve(value('dist') || '.')
const result = await verifyReleaseDirectory({
  directory,
  expectedVersion: value('expected-version'),
  expectedCertificateSha256: value('expected-certificate-sha256')
})

console.log(`Update package valid (${result.metadata.version}; ${result.metadata.signingMode}; ${result.entries.length} hashes).`)
