export const octoprintAdapter = {
  protocol: 'octoprint',

  async connect(printer, options = {}) {
    console.log(
      `[OctoPrint] Conectando em ${printer.ip}:${printer.port || 80}...`
    )

    return {
      connected: false,
      protocol: 'octoprint',
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
      'Impressão OctoPrint ainda não implementada.'
    )
  },

  async pausePrint() {
    throw new Error(
      'Pausa OctoPrint ainda não implementada.'
    )
  },

  async resumePrint() {
    throw new Error(
      'Retomada OctoPrint ainda não implementada.'
    )
  },

  async cancelPrint() {
    throw new Error(
      'Cancelamento OctoPrint ainda não implementado.'
    )
  }
}