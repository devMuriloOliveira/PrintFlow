import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { sliceModelWithOrcaSlicer } from './sliceModel.js'
import { uploadSlicedPrintArtifact } from '../cloud/productionJobSlicing.js'

export const prepareProductionJobSlicing = async ({
  job,
  printer,
  apiUrl,
  credentials,
  fileManager,
  executablePath,
  slice = sliceModelWithOrcaSlicer,
  upload = uploadSlicedPrintArtifact
} = {}) => {
  if (!job?.id || !job?.printFile?.storageKey || String(job.printFile.format || '').toLowerCase() !== '3mf') {
    throw new Error('O Production Job precisa de um arquivo 3MF disponivel para preparar o G-code.')
  }
  if (!printer?.manufacturer || !printer?.model) {
    throw new Error('Impressora com fabricante e modelo obrigatoria para preparar o G-code.')
  }
  if (!apiUrl || !credentials || !fileManager?.ensureCached || !fileManager?.pin || !fileManager?.unpin) {
    throw new Error('Contexto do Agent ausente para preparar o G-code.')
  }
  if (!executablePath) {
    throw new Error('Configure PRINTFLOW_ORCA_SLICER_PATH antes de preparar o G-code.')
  }

  const source = await fileManager.ensureCached(job.printFile)
  await fileManager.pin(source.localPath)
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'printflow-slice-'))
  try {
    const artifact = await slice({
      inputPath: source.localPath,
      outputPath: path.join(tempDirectory, `print-job-${job.id}.gcode`),
      executablePath,
      printer
    })
    const idempotencyKey = `slice-${job.id}-${artifact.artifact.sha256}`
    const result = await upload(apiUrl, credentials, job.id, {
      artifact: { ...artifact.artifact, localPath: artifact.artifact.outputPath },
      profile: artifact.profile,
      metrics: artifact.metrics,
      idempotencyKey
    })
    return { success: true, artifact: result.artifact || artifact.artifact, profile: artifact.profile, metrics: artifact.metrics }
  } finally {
    await fileManager.unpin(source.localPath)
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
