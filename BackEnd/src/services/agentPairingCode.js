export const claimAgentPairingCode = async (executeQuery, pairingId) => {
  const result = await executeQuery(
    `update agent_pairing_codes
        set used_at = now()
      where id = $1
        and used_at is null
        and expires_at > now()
      returning id`,
    [pairingId]
  )
  return Boolean(result.rows[0])
}
