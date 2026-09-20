import path from 'node:path'

import {
  getAgentDataDirectory
} from './credentials.js'

export const getAgentLocalPaths = () => {
  const root =
    getAgentDataDirectory()

  return {
    root,

    database:
      path.join(
        root,
        'agent-operations.sqlite'
      ),

    cacheFiles:
      path.join(
        root,
        'cache',
        'files'
      ),

    cacheGcode:
      path.join(
        root,
        'cache',
        'gcode'
      ),

    temp:
      path.join(
        root,
        'temp'
      ),

    logs:
      path.join(
        root,
        'logs'
      ),

    updates:
      path.join(
        root,
        'updates'
      )
  }
}
