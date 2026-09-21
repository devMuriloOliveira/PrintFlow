import { analyzeModelFile } from './modelAnalyzer.js'
import { resolveOfficialOrcaProfileForPrinter } from './orcaProfiles.js'
import { sliceWithOrcaSlicer } from './orcaSlicer.js'
import { readGcodeMetrics } from './gcodeMetrics.js'

/**
 * Local-only preflight and slicing pipeline. It never sends the result to a
 * printer or changes a Cloud Production Job.
 */
export const sliceModelWithOrcaSlicer = async ({
  inputPath,
  outputPath,
  executablePath,
  printer,
  version = '2.4.2',
  nozzle = '0.4',
  spawnImpl,
  timeoutMs
} = {}) => {
  const analysis = await analyzeModelFile(inputPath)
  const profile = resolveOfficialOrcaProfileForPrinter({
    printer,
    executablePath,
    version,
    nozzle
  })
  const artifact = await sliceWithOrcaSlicer({
    inputPath,
    outputPath,
    executablePath,
    profile,
    spawnImpl,
    timeoutMs
  })
  return { analysis, profile, artifact, metrics: await readGcodeMetrics(artifact.outputPath) }
}
