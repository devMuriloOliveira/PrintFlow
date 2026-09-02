import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validatePrintCompatibility
} from '../src/services/printValidation.js'

test('receita validada permite impressao compativel', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '120 x 80 x 45',
        print_file_name:
          'suporte.3mf',
        print_file_format:
          '3mf',
        print_file_hash:
          'sha256-mock',
        print_file_storage_key:
          'tenant/product/sha256-mock.3mf',
        validation_status:
          'validated',
        compatibility: {
          materials:
            ['PLA'],
          nozzleMm:
            0.4
        },
        print_profile: {
          layerHeightMm:
            0.2,
          infillPercent:
            15
        }
      },
      printer: {
        volume:
          '256 x 256 x 256',
        agent_protocol:
          'bambu'
      },
      filament: {
        material:
          'PLA'
      }
    })

  assert.equal(
    result.valid,
    true
  )

  assert.deepEqual(
    result.errors,
    []
  )
})

test('receita aceita materiais separados por virgula', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '120 x 80 x 45',
        print_file_name:
          'suporte.gcode',
        print_file_format:
          'gcode',
        print_file_hash:
          'sha256-mock',
        print_file_storage_key:
          'tenant/product/sha256-mock.gcode',
        validation_status:
          'validated',
        compatibility: {
          materials:
            'PLA, PETG',
          nozzleMm:
            0.4
        },
        print_profile: {
          layerHeightMm:
            0.2,
          infillPercent:
            15
        }
      },
      printer: {
        volume:
          '220 x 220 x 250',
        agent_protocol:
          'marlin'
      },
      filament: {
        material:
          'PETG'
      },
      job: {
        quantity:
          1
      }
    })

  assert.equal(
    result.valid,
    true
  )
})

test('receita invalida bloqueia formato, volume, material e status', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '300 x 80 x 45',
        print_file_name:
          'suporte.3mf',
        print_file_format:
          '3mf',
        validation_status:
          'needs_validation',
        compatibility: {
          materials:
            ['PETG']
        }
      },
      printer: {
        volume:
          '220 x 220 x 250',
        agent_protocol:
          'marlin'
      },
      filament: {
        material:
          'PLA'
      }
    })

  assert.equal(
    result.valid,
    false
  )

  assert.ok(
    result.errors.some((error) => error.includes('Formato'))
  )

  assert.ok(
    result.errors.some((error) => error.includes('excede o volume'))
  )

  assert.ok(
    result.errors.some((error) => error.includes('Material'))
  )

  assert.ok(
    result.errors.some((error) => error.includes('Receita'))
  )
})

test('receita invalida bloqueia extensao divergente e quantidade invalida', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '120 x 80 x 45',
        print_file_name:
          'suporte.stl',
        print_file_format:
          'gcode',
        print_file_hash:
          'sha256-mock',
        print_file_storage_key:
          'tenant/product/sha256-mock.gcode',
        validation_status:
          'validated',
        compatibility: {
          materials:
            ['PLA'],
          nozzleMm:
            0.4
        },
        print_profile: {
          layerHeightMm:
            0.2,
          infillPercent:
            15
        }
      },
      printer: {
        volume:
          '220 x 220 x 250',
        agent_protocol:
          'marlin'
      },
      filament: {
        material:
          'PLA'
      },
      job: {
        quantity:
          0
      }
    })

  assert.equal(
    result.valid,
    false
  )

  assert.ok(
    result.errors.some((error) => error.includes('Extensao'))
  )

  assert.ok(
    result.errors.some((error) => error.includes('Quantidade'))
  )
})

test('receita invalida bloqueia bico incompativel com impressora', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '120 x 80 x 45',
        print_file_name:
          'suporte.gcode',
        print_file_format:
          'gcode',
        print_file_hash:
          'sha256-mock',
        print_file_storage_key:
          'tenant/product/sha256-mock.gcode',
        validation_status:
          'validated',
        compatibility: {
          materials:
            ['PLA'],
          nozzleMm:
            0.6
        },
        print_profile: {
          layerHeightMm:
            0.2,
          infillPercent:
            15
        }
      },
      printer: {
        volume:
          '220 x 220 x 250',
        agent_protocol:
          'marlin',
        nozzle_mm:
          0.4
      },
      filament: {
        material:
          'PLA'
      }
    })

  assert.equal(
    result.valid,
    false
  )

  assert.ok(
    result.errors.some((error) => error.includes('bico'))
  )
})

test('receita invalida bloqueia camada e preenchimento fora do perfil', () => {
  const result =
    validatePrintCompatibility({
      product: {
        dimensions:
          '120 x 80 x 45',
        print_file_name:
          'suporte.gcode',
        print_file_format:
          'gcode',
        print_file_hash:
          'sha256-mock',
        print_file_storage_key:
          'tenant/product/sha256-mock.gcode',
        validation_status:
          'validated',
        compatibility: {
          materials:
            ['PLA'],
          nozzleMm:
            0.4
        },
        print_profile: {
          layerHeightMm:
            0.35,
          infillPercent:
            125
        }
      },
      printer: {
        volume:
          '220 x 220 x 250',
        agent_protocol:
          'marlin',
        nozzle_mm:
          0.4,
        min_layer_height:
          0.08,
        max_layer_height:
          0.28
      },
      filament: {
        material:
          'PLA'
      }
    })

  assert.equal(
    result.valid,
    false
  )

  assert.ok(
    result.errors.some((error) => error.includes('camada'))
  )

  assert.ok(
    result.errors.some((error) => error.includes('Preenchimento'))
  )
})
