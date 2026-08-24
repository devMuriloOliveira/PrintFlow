import os from 'node:os'

import {
  getPrinterProfiles
} from './printers/printerProfiles.js'

export const AGENT_VERSION =
  '0.1.0'

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
