export const prusaLinkAdapter = {
  protocol: 'prusalink',

  async connect(printer, options = {}) {
    console.log(
      `[PrusaLink] Conectando em ${printer.ip}:${printer.port || 80}...`
    )

    return {
      connected: false,
      protocol: 'prusalink',
      printer,
      options,
      implemented: false
    }
  },

  async disconnect() {
    return {
      disconnected: true
    }
  },

  async getStatus() {
    return {
      connected: false,
      status: 'unknown',
      implemented: false
    }
  },

  async startPrint() {
    throw new Error(
      'Impressão PrusaLink ainda não implementada.'
    )
  },

  async pausePrint() {
    throw new Error(
      'Pausa PrusaLink ainda não implementada.'
    )
  },

  async resumePrint() {
    throw new Error(
      'Retomada PrusaLink ainda não implementada.'
    )
  },

  async cancelPrint() {
    throw new Error(
      'Cancelamento PrusaLink ainda não implementado.'
    )
  }
}