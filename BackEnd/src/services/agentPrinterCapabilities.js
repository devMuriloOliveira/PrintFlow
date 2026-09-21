const capabilityByAction = {
  status: 'status',
  start: 'startPrint',
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancel',
  disconnect: 'disconnect'
}

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
