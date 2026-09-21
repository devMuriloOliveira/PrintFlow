import axios from 'axios'
import { createReadStream } from 'node:fs'
import path from 'node:path'

export const uploadSlicedPrintArtifact = async (
  apiUrl,
  credentials,
  printJobId,
  {
    artifact,
    profile,
    metrics = {},
    idempotencyKey
  } = {}
) => {
  const localPath = artifact?.localPath || artifact?.outputPath
  const outputName = artifact?.outputName || (localPath ? path.basename(localPath) : '')
  if (!localPath || !outputName || !artifact?.sha256 || !artifact?.sizeBytes) {
    throw new Error('Artefato local de slicing invalido.')
  }
  if (!profile?.id || !profile?.version || !idempotencyKey) {
    throw new Error('Perfil e idempotencyKey de slicing obrigatorios.')
  }

  const response = await axios.post(
    `${apiUrl}/api/agents/print-jobs/${encodeURIComponent(printJobId)}/slicing-artifact`,
    createReadStream(localPath),
    {
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: {
        'content-type': 'application/octet-stream',
        'x-agent-id': credentials.agentId,
        'x-agent-secret': credentials.agentSecret,
        'x-printflow-file-name': outputName,
        'x-printflow-file-format': 'gcode',
        'x-printflow-slicer-profile-id': profile.id,
        'x-printflow-slicer-profile-version': profile.version,
        'x-printflow-idempotency-key': idempotencyKey,
        ...(metrics.estimatedPrintSeconds != null ? { 'x-printflow-estimated-print-seconds': String(metrics.estimatedPrintSeconds) } : {}),
        ...(metrics.estimatedFilamentGrams != null ? { 'x-printflow-estimated-filament-grams': String(metrics.estimatedFilamentGrams) } : {}),
        ...(metrics.estimatedFilamentMillimeters != null ? { 'x-printflow-estimated-filament-millimeters': String(metrics.estimatedFilamentMillimeters) } : {})
      }
    }
  )
  return response.data
}
