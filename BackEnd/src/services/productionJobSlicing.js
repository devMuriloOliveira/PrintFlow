const text = (value, max = 160) => String(value || '').trim().slice(0, max)

const metric = (value, max) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= max ? number : null
}

export const normalizeSlicingArtifact = (payload = {}) => {
  const artifact = payload.artifact || {}
  const profileId = text(payload.profileId, 120)
  const profileVersion = text(payload.profileVersion, 80)
  const idempotencyKey = text(payload.idempotencyKey, 160)
  const name = text(artifact.name, 180)
  const storageKey = text(artifact.storageKey, 500)
  const hash = text(artifact.hash, 64).toLowerCase()
  const format = text(artifact.format, 12).toLowerCase()
  const sizeBytes = Number(artifact.sizeBytes)

  if (!idempotencyKey) throw new Error('idempotencyKey obrigatoria.')
  if (!profileId || !profileVersion) throw new Error('Perfil de slicing obrigatorio.')
  if (!name || !storageKey || !/^[a-f0-9]{64}$/.test(hash) || format !== 'gcode' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Artefato de slicing invalido.')
  }

  return {
    idempotencyKey,
    profileId,
    profileVersion,
    artifact: { name, storageKey, hash, format, sizeBytes },
    estimatedPrintSeconds: metric(payload.estimatedPrintSeconds, 365 * 24 * 3600),
    estimatedFilamentGrams: metric(payload.estimatedFilamentGrams, 100000),
    estimatedFilamentMillimeters: metric(payload.estimatedFilamentMillimeters, 10000000)
  }
}

export const recordProductionJobSlicingArtifact = async ({ client, tenantId, agentId, printJobId, payload }) => {
  const slicing = normalizeSlicingArtifact(payload)
  const result = await client.query(
    `select j.id, j.status, j.slicing_artifact_sha256, j.slicing_artifact_storage_key
       from print_jobs j
       join agent_printers ap on ap.id = j.agent_printer_id and ap.tenant_id = j.tenant_id
      where j.tenant_id = $1 and j.id = $2 and ap.agent_id = $3
      for update`,
    [tenantId, printJobId, agentId]
  )
  if (!result.rowCount) return null

  const job = result.rows[0]
  if (job.slicing_artifact_sha256) {
    if (String(job.slicing_artifact_sha256).toLowerCase() === slicing.artifact.hash && String(job.slicing_artifact_storage_key || '') === slicing.artifact.storageKey) {
      return { idempotent: true, artifact: slicing.artifact }
    }
    const conflict = new Error('Production Job ja possui outro artefato de slicing.')
    conflict.statusCode = 409
    throw conflict
  }
  if (!['queued', 'awaiting_confirmation'].includes(String(job.status || ''))) {
    const conflict = new Error('Production Job nao aceita slicing neste status.')
    conflict.statusCode = 409
    throw conflict
  }

  await client.query(
    `update print_jobs
        set slicer_profile_id = $3,
            slicer_profile_version = $4,
            slicing_artifact_storage_key = $5,
            slicing_artifact_name = $6,
            slicing_artifact_format = $7,
            slicing_artifact_sha256 = $8,
            slicing_artifact_size_bytes = $9,
            estimated_print_seconds = coalesce($10::numeric, estimated_print_seconds),
            estimated_filament_grams = coalesce($11::numeric, estimated_filament_grams),
            estimated_filament_millimeters = coalesce($12::numeric, estimated_filament_millimeters),
            slicing_recorded_at = now(),
            updated_at = now()
      where tenant_id = $1 and id = $2`,
    [tenantId, printJobId, slicing.profileId, slicing.profileVersion,
      slicing.artifact.storageKey, slicing.artifact.name, slicing.artifact.format,
      slicing.artifact.hash, slicing.artifact.sizeBytes,
      slicing.estimatedPrintSeconds, slicing.estimatedFilamentGrams, slicing.estimatedFilamentMillimeters]
  )
  return { idempotent: false, artifact: slicing.artifact }
}
