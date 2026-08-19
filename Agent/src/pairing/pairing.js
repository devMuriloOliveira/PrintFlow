import axios from 'axios'
import os from 'node:os'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { saveCredentials } from '../storage/credentials.js'

export const pairAgent = async (apiUrl) => {
  const rl = readline.createInterface({
    input,
    output
  })

  try {
    console.log('')
    console.log('Este computador ainda não está conectado ao PrintFlow.')
    console.log('')

    const code = await rl.question(
      'Digite o código de conexão: '
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
        version: '0.1.0'
      }
    )

    const credentials = {
      agentId: response.data.agentId,
      agentSecret: response.data.agentSecret,
      machineName: response.data.machineName
    }

    await saveCredentials(credentials)

    console.log('')
    console.log('✅ Agent conectado com sucesso!')
    console.log('Computador:', credentials.machineName)
    console.log('Agent ID:', credentials.agentId)
    console.log('')
    console.log('Credencial salva neste computador.')

    return credentials
  } catch (error) {
    console.log('')
    console.log('❌ Não foi possível conectar o Agent.')

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
    rl.close()
  }
}