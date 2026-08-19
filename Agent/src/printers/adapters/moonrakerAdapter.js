export const moonrakerAdapter = {
  protocol: 'moonraker',

  async connect(printer) {
    console.log(
      `[Moonraker] Conectando em ${printer.ip}:${printer.port || 7125}...`
    )

    return {
      connected: false,
      protocol: 'moonraker',
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
      'Impressão Moonraker ainda não implementada.'
    )
  },

  async pausePrint() {
    throw new Error(
      'Pausa Moonraker ainda não implementada.'
    )
  },

  async resumePrint() {
    throw new Error(
      'Retomada Moonraker ainda não implementada.'
    )
  },

  async cancelPrint() {
    throw new Error(
      'Cancelamento Moonraker ainda não implementado.'
    )
  }
}