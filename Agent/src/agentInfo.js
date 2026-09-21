import os from 'node:os'

import {
  AGENT_VERSION
} from './config/agentVersion.js'

import {
  getPrinterProfiles
} from './printers/printerProfiles.js'

export {
  AGENT_VERSION
}

export const getAgentRuntimeInfo = () => ({
  version:
    AGENT_VERSION,
  machineName:
    os.hostname(),
  platform:
    os.platform(),
  architecture:
    os.arch(),
  nodeVersion:
    process.version,
  printerProfiles:
    getPrinterProfiles()
      .map(
        profile => ({
          protocol:
            profile.protocol,
          label:
            profile.label,
          connectionType:
            profile.connectionType,
          capabilities:
            profile.capabilities
        })
      )
})
