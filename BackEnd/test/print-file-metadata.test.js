import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  applyPrintFileMetadataToProduct,
  extractPrintFileMetadata
} from '../src/services/printFileMetadata.js'

const writeTempFile =
  async (
    name,
    content
  ) => {
    const folder =
      await fs.mkdtemp(
        path.join(
          os.tmpdir(),
          'printflow-metadata-'
        )
      )

    const filePath =
      path.join(
        folder,
        name
      )

    await fs.writeFile(
      filePath,
      content
    )

    return filePath
  }

const makeStoredZip =
  (entries) => {
    const localParts = []
    const centralParts = []
    let offset = 0

    for (const entry of entries) {
      const name =
        Buffer.from(
          entry.name,
          'utf8'
        )

      const content =
        Buffer.isBuffer(entry.content)
          ? entry.content
          : Buffer.from(
              entry.content,
              'utf8'
            )

      const local =
        Buffer.alloc(
          30
        )

      local.writeUInt32LE(
        0x04034b50,
        0
      )
      local.writeUInt16LE(
        20,
        4
      )
      local.writeUInt16LE(
        0,
        8
      )
      local.writeUInt32LE(
        content.length,
        18
      )
      local.writeUInt32LE(
        content.length,
        22
      )
      local.writeUInt16LE(
        name.length,
        26
      )

      localParts.push(
        local,
        name,
        content
      )

      const central =
        Buffer.alloc(
          46
        )

      central.writeUInt32LE(
        0x02014b50,
        0
      )
      central.writeUInt16LE(
        20,
        4
      )
      central.writeUInt16LE(
        20,
        6
      )
      central.writeUInt16LE(
        0,
        10
      )
      central.writeUInt32LE(
        content.length,
        20
      )
      central.writeUInt32LE(
        content.length,
        24
      )
      central.writeUInt16LE(
        name.length,
        28
      )
      central.writeUInt32LE(
        offset,
        42
      )

      centralParts.push(
        central,
        name
      )

      offset +=
        local.length +
        name.length +
        content.length
    }

    const centralDirectory =
      Buffer.concat(
        centralParts
      )

    const eocd =
      Buffer.alloc(
        22
      )

    eocd.writeUInt32LE(
      0x06054b50,
      0
    )
    eocd.writeUInt16LE(
      entries.length,
      8
    )
    eocd.writeUInt16LE(
      entries.length,
      10
    )
    eocd.writeUInt32LE(
      centralDirectory.length,
      12
    )
    eocd.writeUInt32LE(
      offset,
      16
    )

    return Buffer.concat([
      ...localParts,
      centralDirectory,
      eocd
    ])
  }

test('extrai dimensoes e perfil basico de G-code', async () => {
  const filePath =
    await writeTempFile(
      'part.gcode',
      [
        ';MINX:10',
        ';MAXX:130',
        ';MINY:5',
        ';MAXY:85',
        ';MINZ:0.2',
        ';MAXZ:45.2',
        '; layer_height = 0.2',
        '; fill_density = 15%',
        '; nozzle_diameter = 0.4',
        '; filament_type = PLA',
        'M104 S205',
        'M140 S60'
      ].join('\n')
    )

  const metadata =
    await extractPrintFileMetadata({
      filePath,
      format:
        'gcode'
    })

  assert.equal(
    metadata.dimensions,
    '120 x 80 x 45'
  )

  assert.equal(
    metadata.profile.layerHeightMm,
    0.2
  )

  assert.equal(
    metadata.profile.infillPercent,
    15
  )

  assert.equal(
    metadata.profile.material,
    'PLA'
  )
})

test('extrai dimensoes de modelo 3MF', async () => {
  const filePath =
    await writeTempFile(
      'part.3mf',
      makeStoredZip([
        {
          name:
            '3D/3dmodel.model',
          content:
            `<?xml version="1.0" encoding="UTF-8"?>
            <model unit="millimeter">
              <resources>
                <object id="1" type="model">
                  <mesh>
                    <vertices>
                      <vertex x="0" y="0" z="0" />
                      <vertex x="120" y="80" z="45" />
                    </vertices>
                  </mesh>
                </object>
              </resources>
            </model>`
        },
        {
          name:
            'Metadata/print.config',
          content:
            'layer_height = 0.16\nnozzle_diameter = 0.4\nfilament_type = PETG'
        }
      ])
    )

  const metadata =
    await extractPrintFileMetadata({
      filePath,
      format:
        '3mf'
    })

  assert.equal(
    metadata.dimensions,
    '120 x 80 x 45'
  )

  const product =
    applyPrintFileMetadataToProduct(
      {
        name:
          'Produto'
      },
      metadata
    )

  assert.equal(
    product.dimensions,
    '120 x 80 x 45'
  )

  assert.equal(
    product.printProfile.layerHeightMm,
    0.16
  )

  assert.deepEqual(
    product.compatibility.materials,
    ['PETG']
  )
})
