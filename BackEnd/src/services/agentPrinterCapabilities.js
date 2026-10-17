const capabilityByAction = {
  status: 'status',
  start: 'startPrint',
  slice: 'startPrint',
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancel',
  disconnect: 'disconnect'
}

const controlActions = new Set([
  'start',
  'slice',
  'pause',
  'resume',
  'cancel',
  'disconnect'
])

export const isAgentPrinterControlAction = (action) =>
  controlActions.has(action)

export const isAgentPrinterActionSupported = (
  metadata,
  action
) => {
  const capabilities =
    metadata?.capabilities

  if (
    !capabilities ||
    typeof capabilities !== 'object' ||
    !Object.keys(capabilities).length
  ) {
    return true
  }

  const capability =
    capabilityByAction[action]

  return capability
    ? capabilities[capability] === true
    : false
}
