import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isActivePrinterStatus
} from '../src/printers/printerManager.js'

test(
  'reconhece estados ativos que impedem atualizacao',
  () => {
    for (const state of [
      'PRINTING',
      'RUNNING',
      'PAUSE',
      'Paused',
      'preparing'
    ]) {
      assert.equal(
        isActivePrinterStatus({ state }),
        true
      )
    }

    for (const state of [
      'idle',
      'complete',
      'failed',
      'offline'
    ]) {
      assert.equal(
        isActivePrinterStatus({ state }),
        false
      )
    }
  }
)
