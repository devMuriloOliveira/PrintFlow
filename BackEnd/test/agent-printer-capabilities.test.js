import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isAgentPrinterActionSupported
} from '../src/services/agentPrinterCapabilities.js'

test(
  'mantem operacoes de vinculos legados sem capabilities',
  () => {
    assert.equal(
      isAgentPrinterActionSupported(
        {},
        'start'
      ),
      true
    )
  }
)

test(
  'rejeita no Cloud a acao ausente nas capabilities da impressora',
  () => {
    const metadata = {
      capabilities: {
        status: true,
        startPrint: false,
        pause: false
      }
    }

    assert.equal(
      isAgentPrinterActionSupported(
        metadata,
        'status'
      ),
      true
    )
    assert.equal(
      isAgentPrinterActionSupported(
        metadata,
        'start'
      ),
      false
    )
    assert.equal(
      isAgentPrinterActionSupported(
        metadata,
        'pause'
      ),
      false
    )
  }
)
