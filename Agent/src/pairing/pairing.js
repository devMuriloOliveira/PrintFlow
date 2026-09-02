import axios from 'axios'
import os from 'node:os'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { saveCredentials } from '../storage/credentials.js'
import { AGENT_VERSION } from '../agentInfo.js'

export const pairAgent = async (
  apiUrl,
  pairingCode = '',
  currentCredentials = null
) => {
  const normalizedPairingCode =
    String(pairingCode || '')
      .trim()
      .toUpperCase()

  const rl = normalizedPairingCode
    ? null
    : readline.createInterface({
        input,
        output
      })

  try {
    console.log('')
    console.log('Este computador ainda nao esta conectado ao PrintFlow.')
    console.log('')

    const code =
      normalizedPairingCode ||
      await rl.question(
        'Digite o codigo de conexao: '
      )

    console.log('')
    console.log('Conectando ao PrintFlow...')

    const response = await axios.post(
      `${apiUrl}/api/agents/pair`,
      {
        code: code.trim().toUpperCase(),
        machineName: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        version: AGENT_VERSION
      }
    )

    const credentials = {
      agentId: response.data.agentId,
      agentSecret: response.data.agentSecret,
      tenantId: response.data.tenantId || '',
      tenantName: response.data.tenantName || '',
      machineName: response.data.machineName
    }

    if (
      currentCredentials?.tenantId &&
      credentials.tenantId &&
      currentCredentials.tenantId !==
        credentials.tenantId
    ) {
      console.log('')
      console.log(
        'Pareamento alterado para outra empresa.'
      )
      console.log(
        'Empresa anterior:',
        currentCredentials.tenantName ||
          currentCredentials.tenantId
      )
      console.log(
        'Nova empresa:',
        credentials.tenantName ||
          credentials.tenantId
      )
    }

    await saveCredentials(credentials)

    console.log('')
    console.log('Agent conectado com sucesso!')
    console.log('Computador:', credentials.machineName)
    if (credentials.tenantName || credentials.tenantId) {
      console.log(
        'Empresa:',
        credentials.tenantName || credentials.tenantId
      )
    }
    console.log('Agent ID:', credentials.agentId)
    console.log('')
    console.log('Credencial salva neste computador.')

    return credentials
  } catch (error) {
    console.log('')
    console.log('Nao foi possivel conectar o Agent.')

    if (error.response) {
      console.log(
        'Erro:',
        error.response.data?.error || error.response.status
      )
    } else {
      console.log('Erro:', error.message)
    }

    return null
  } finally {
    rl?.close()
  }
}
