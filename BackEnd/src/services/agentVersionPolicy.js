export const MINIMUM_SUPPORTED_AGENT_VERSION = String(
  process.env.MINIMUM_SUPPORTED_AGENT_VERSION || '0.1.10'
).trim()

const parseVersion = value => {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map(Number) : null
}

export const compareAgentVersions = (left, right) => {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) return null

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1
    }
  }
  return 0
}

export const isAgentVersionSupported = value => {
  const comparison = compareAgentVersions(
    value,
    MINIMUM_SUPPORTED_AGENT_VERSION
  )
  return comparison !== null && comparison >= 0
}

export const unsupportedAgentVersionPayload = () => ({
  error: `Atualize o PrintFlow Agent para a versao ${MINIMUM_SUPPORTED_AGENT_VERSION} ou superior.`,
  code: 'AGENT_UPDATE_REQUIRED',
  minimumSupportedVersion: MINIMUM_SUPPORTED_AGENT_VERSION
})
