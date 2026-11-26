import { appendFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { compareAgentReleaseTags } from '../src/config/agentReleaseVersion.js'

const tag = process.env.FILA_AGENT_RELEASE_TAG ?? ''
const outputFile = process.env.GITHUB_OUTPUT
const currentMatch = /^agent-v(\d+)\.(\d+)\.(\d+)$/.exec(tag)
if (!currentMatch || !outputFile) throw new Error('FILA_AGENT_RELEASE_TAG and GITHUB_OUTPUT are required.')

const list = spawnSync('gh', ['release', 'list', '--limit', '100', '--json', 'tagName'], { encoding: 'utf8' })
if (list.error) throw list.error
if (list.status !== 0) throw new Error(`gh release list failed: ${list.stderr.trim()}`)
const releases = JSON.parse(list.stdout)
const earlierReleases = releases
  .map(release => release.tagName)
  .filter(value => /^agent-v\d+\.\d+\.\d+$/.test(value) && compareAgentReleaseTags(value, tag) < 0)
  .sort((left, right) => compareAgentReleaseTags(right, left))
const knownLegacyBaseline = 'agent-v0.1.34'
const baseline = earlierReleases.includes(knownLegacyBaseline) ? knownLegacyBaseline : earlierReleases[0]

if (!baseline) {
  await appendFile(outputFile, 'available=false\n')
  process.stdout.write('No earlier release exists; upgrade E2E baseline skipped.\n')
  process.exit(0)
}

const directory = path.join('dist', 'upgrade-baseline')
await mkdir(directory, { recursive: true })
const download = spawnSync('gh', ['release', 'download', baseline, '--pattern', 'Fila-Agent-Setup.exe', '--pattern', 'Fila-Agent-Windows.zip', '--dir', directory], { encoding: 'utf8' })
if (download.error) throw download.error
if (download.status !== 0) throw new Error(`gh release download ${baseline} failed: ${download.stderr.trim()}`)

const version = baseline.slice('agent-v'.length)
await appendFile(outputFile, `available=true\nversion=${version}\ntag=${baseline}\n`)
process.stdout.write(`Upgrade E2E baseline: ${baseline}\n`)
