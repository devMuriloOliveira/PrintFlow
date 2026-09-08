import { getAuthUser } from './auth.js'
import { hasDatabase } from '../db/pool.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { createCalculatorSimulation, listCalculatorSimulations } from '../repositories/calculatorSimulationsRepository.js'
import { writeAuditEvent } from '../services/operationalEvents.js'
import { withTenant } from '../db/pool.js'

export const handleCalculatorSimulationsList = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Historico exige banco de dados.' })
  return sendJson(res, 200, await listCalculatorSimulations(user.tenantId))
}

export const handleCalculatorSimulationCreate = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  if (!hasDatabase) return sendJson(res, 501, { error: 'Historico exige banco de dados.' })
  const payload = await readJsonBody(req)
  if (!payload || typeof payload !== 'object') return sendJson(res, 400, { error: 'Simulacao invalida' })
  if (Number(payload.weight || 0) <= 0) return sendJson(res, 400, { error: 'Peso da simulacao deve ser maior que zero' })
  if (Number(payload.suggestedPrice || 0) <= 0) return sendJson(res, 400, { error: 'Preco sugerido invalido' })
  const created = await createCalculatorSimulation(user.tenantId, user.id, payload)
  await withTenant(user.tenantId, (client) => writeAuditEvent(user.tenantId, { action: 'calculator.simulation_created', actorType: 'user', actorId: user.id, entityType: 'calculator_simulation', entityId: created.id, details: { name: created.name, suggestedPrice: created.suggestedPrice } }, client))
  return sendJson(res, 201, created)
}
