export const marlinSerialAdapter = {
  protocol: 'marlin',

  async connect(printer) {
    console.log(
      `[Marlin] Conectando na porta ${printer.port || 'desconhecida'}...`
    )

    return {
      connected: false,
      protocol: 'marlin',
      printer,
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
      'Impressão Marlin ainda não implementada.'
    )
  },

  async pausePrint() {
    throw new Error(
      'Pausa Marlin ainda não implementada.'
    )
  },

  async resumePrint() {
    throw new Error(
      'Retomada Marlin ainda não implementada.'
    )
  },

  async cancelPrint() {
    throw new Error(
      'Cancelamento Marlin ainda não implementado.'
    )
  }
}