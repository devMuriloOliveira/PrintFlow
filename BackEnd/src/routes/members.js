import { getAuthUser } from './auth.js'
import { readJsonBody } from '../http/body.js'
import { sendJson } from '../http/response.js'
import { listTenantMembers, updateTenantMember } from '../repositories/membersRepository.js'
import { createInvitation } from '../repositories/invitationsRepository.js'

export const handleMembersList = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  return sendJson(res, 200, await listTenantMembers(user.tenantId))
}

export const handleMemberUpdate = async (req, res, userId) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })

  const body = await readJsonBody(req)
  const member = await updateTenantMember({
    actor: user,
    userId,
    role: body.role,
    status: body.status
  })

  return sendJson(res, 200, member)
}

export const handleInvitationCreate = async (req, res) => {
  const user = await getAuthUser(req)
  if (!user) return sendJson(res, 401, { error: 'Login necessario' })
  const body = await readJsonBody(req)
  return sendJson(res, 201, await createInvitation({ actor: user, email: body.email, role: body.role }))
}
