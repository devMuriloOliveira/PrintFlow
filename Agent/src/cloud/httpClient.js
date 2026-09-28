import axios from 'axios'

export const CLOUD_REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.PRINTFLOW_CLOUD_REQUEST_TIMEOUT_MS) || 20_000
)

export const CLOUD_TRANSFER_TIMEOUT_MS = Math.max(
  CLOUD_REQUEST_TIMEOUT_MS,
  Number(process.env.PRINTFLOW_CLOUD_TRANSFER_TIMEOUT_MS) || 120_000
)

export function withCloudTimeout(options = {}) {
  return {
    timeout: CLOUD_REQUEST_TIMEOUT_MS,
    maxContentLength: 20 * 1024 * 1024,
    maxBodyLength: 20 * 1024 * 1024,
    ...options
  }
}

// Mantem o axios compartilhado para que os adaptadores de transporte e mocks
// existentes continuem valendo, aplicando os limites em cada chamada Cloud.
export const cloudHttp = {
  get(url, options) {
    return axios.get(url, withCloudTimeout(options))
  },
  post(url, data, options) {
    return axios.post(url, data, withCloudTimeout(options))
  }
}
