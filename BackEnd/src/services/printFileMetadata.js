import fs from 'node:fs/promises'
import zlib from 'node:zlib'

const number =
  (value) => {
    const parsed =
      Number(
        String(value || '')
          .replace(',', '.')
          .replace(/[^\d.-]/g, '')
      )

    return Number.isFinite(parsed)
      ? parsed
      : 0
  }

const roundMm =
  (value) =>
    Math.round(
      Number(value || 0) *
        10
    ) /
    10

const compactDimensions =
  (dimensions) => {
    if (
      !dimensions ||
      dimensions.x <= 0 ||
      dimensions.y <= 0 ||
      dimensions.z <= 0
    ) {
      return ''
    }

    return `${roundMm(dimensions.x)} x ${roundMm(dimensions.y)} x ${roundMm(dimensions.z)}`
  }

const unitFactor = {
  micron:
    0.001,
  millimeter:
    1,
  centimeter:
    10,
  inch:
    25.4,
  foot:
    304.8,
  meter:
    1000
}

const zipEntries =
  (buffer) => {
    const entries = []
    let eocd = -1

    for (
      let index = buffer.length - 22;
      index >= 0 &&
        index >= buffer.length - 66000;
      index -= 1
    ) {
      if (
        buffer.readUInt32LE(index) ===
        0x06054b50
      ) {
        eocd = index
        break
      }
    }

    if (eocd < 0) return entries

    const totalEntries =
      buffer.readUInt16LE(
        eocd + 10
      )

    let offset =
      buffer.readUInt32LE(
        eocd + 16
      )

    for (let index = 0; index < totalEntries; index += 1) {
      if (
        buffer.readUInt32LE(offset) !==
        0x02014b50
      ) {
        break
      }

      const method =
        buffer.readUInt16LE(
          offset + 10
        )

      const compressedSize =
        buffer.readUInt32LE(
          offset + 20
        )

      const nameLength =
        buffer.readUInt16LE(
          offset + 28
        )

      const extraLength =
        buffer.readUInt16LE(
          offset + 30
        )

      const commentLength =
        buffer.readUInt16LE(
          offset + 32
        )

      const localOffset =
        buffer.readUInt32LE(
          offset + 42
        )

      const name =
        buffer
          .subarray(
            offset + 46,
            offset + 46 + nameLength
          )
          .toString('utf8')

      if (
        buffer.readUInt32LE(localOffset) ===
        0x04034b50
      ) {
        const localNameLength =
          buffer.readUInt16LE(
            localOffset + 26
          )

        const localExtraLength =
          buffer.readUInt16LE(
            localOffset + 28
          )

        const dataStart =
          localOffset +
          30 +
          localNameLength +
          localExtraLength

        const compressed =
          buffer.subarray(
            dataStart,
            dataStart + compressedSize
          )

        let content = null

        if (method === 0) {
          content = compressed
        } else if (method === 8) {
          content =
            zlib.inflateRawSync(
              compressed
            )
        }

        if (content) {
          entries.push({
            name,
            content
          })
        }
      }

      offset +=
        46 +
        nameLength +
        extraLength +
        commentLength
    }

    return entries
  }

const metadataNumber =
  (text, patterns) => {
    for (const pattern of patterns) {
      const match =
        text.match(pattern)

      if (match) {
        const value =
          number(
            match[1]
          )

        if (value > 0) return value
      }
    }

    return 0
  }

const metadataMaterial =
  (text) => {
    const match =
      text.match(
        /(?:filament_type|filament_settings_id|material)\s*[=:]\s*["']?([a-z0-9 _+-]+)/i
      )

    return match
      ? match[1].trim().split(/\s+/)[0].toUpperCase()
      : ''
  }

const profileFromText =
  (text) => ({
    layerHeightMm:
      metadataNumber(
        text,
        [
          /layer_height\s*[=:]\s*([\d.,]+)/i,
          /layer height\s*[=:]\s*([\d.,]+)/i
        ]
      ),

    infillPercent:
      metadataNumber(
        text,
        [
          /(?:fill_density|infill_sparse_density|infill_density)\s*[=:]\s*([\d.,]+)/i,
          /infill\s*[=:]\s*([\d.,]+)\s*%/i
        ]
      ),

    nozzleTemperature:
      metadataNumber(
        text,
        [
          /(?:nozzle_temperature|temperature)\s*[=:]\s*([\d.,]+)/i,
          /M104\s+S([\d.,]+)/i,
          /M109\s+S([\d.,]+)/i
        ]
      ),

    bedTemperature:
      metadataNumber(
        text,
        [
          /(?:bed_temperature|first_layer_bed_temperature)\s*[=:]\s*([\d.,]+)/i,
          /M140\s+S([\d.,]+)/i,
          /M190\s+S([\d.,]+)/i
        ]
      ),

    nozzleMm:
      metadataNumber(
        text,
        [
          /nozzle_diameter\s*[=:]\s*([\d.,]+)/i,
          /nozzle diameter\s*[=:]\s*([\d.,]+)/i
        ]
      ),

    material:
      metadataMaterial(
        text
      )
  })

const mergeProfile =
  (...items) => {
    const merged = {}

    for (const item of items) {
      for (const [key, value] of Object.entries(item || {})) {
        if (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 0
        ) {
          merged[key] = value
        }
      }
    }

    return merged
  }

const dimensionsFrom3mfModel =
  (xml) => {
    const unit =
      xml.match(
        /<model[^>]*\bunit=["']([^"']+)["']/i
      )?.[1]
        ?.toLowerCase() ||
      'millimeter'

    const factor =
      unitFactor[unit] ||
      1

    const bounds = {
      minX:
        Infinity,
      minY:
        Infinity,
      minZ:
        Infinity,
      maxX:
        -Infinity,
      maxY:
        -Infinity,
      maxZ:
        -Infinity
    }

    const vertexPattern =
      /<vertex\b[^>]*\bx=["']([^"']+)["'][^>]*\by=["']([^"']+)["'][^>]*\bz=["']([^"']+)["'][^>]*\/?>/gi

    let match = null
    let count = 0

    while ((match = vertexPattern.exec(xml))) {
      const x =
        number(match[1]) *
        factor
      const y =
        number(match[2]) *
        factor
      const z =
        number(match[3]) *
        factor

      bounds.minX =
        Math.min(bounds.minX, x)
      bounds.minY =
        Math.min(bounds.minY, y)
      bounds.minZ =
        Math.min(bounds.minZ, z)
      bounds.maxX =
        Math.max(bounds.maxX, x)
      bounds.maxY =
        Math.max(bounds.maxY, y)
      bounds.maxZ =
        Math.max(bounds.maxZ, z)
      count += 1
    }

    if (!count) return null

    return {
      x:
        bounds.maxX -
        bounds.minX,
      y:
        bounds.maxY -
        bounds.minY,
      z:
        bounds.maxZ -
        bounds.minZ
    }
  }

const dimensionsFromGcode =
  (text) => {
    const minMax =
      {
        minX:
          metadataNumber(text, [/MINX\s*:\s*([\d.,-]+)/i]),
        maxX:
          metadataNumber(text, [/MAXX\s*:\s*([\d.,-]+)/i]),
        minY:
          metadataNumber(text, [/MINY\s*:\s*([\d.,-]+)/i]),
        maxY:
          metadataNumber(text, [/MAXY\s*:\s*([\d.,-]+)/i]),
        minZ:
          metadataNumber(text, [/MINZ\s*:\s*([\d.,-]+)/i]),
        maxZ:
          metadataNumber(text, [/MAXZ\s*:\s*([\d.,-]+)/i])
      }

    if (
      minMax.maxX > minMax.minX &&
      minMax.maxY > minMax.minY &&
      minMax.maxZ > minMax.minZ
    ) {
      return {
        x:
          minMax.maxX -
          minMax.minX,
        y:
          minMax.maxY -
          minMax.minY,
        z:
          minMax.maxZ -
          minMax.minZ
      }
    }

    return null
  }

export const extractPrintFileMetadata =
  async ({
    filePath,
    format
  }) => {
    const detectedFormat =
      String(format || '')
        .toLowerCase()

    if (detectedFormat === 'bgcode') {
      return {
        extracted:
          false,
        message:
          'BGCODE enviado. Metadados automaticos ainda nao foram extraidos para este formato.'
      }
    }

    if (detectedFormat === '3mf') {
      const buffer =
        await fs.readFile(
          filePath
        )

      const entries =
        zipEntries(
          buffer
        )

      const modelXml =
        entries
          .find((entry) => /3dmodel\.model$/i.test(entry.name))
          ?.content
          .toString('utf8') ||
        ''

      const text =
        entries
          .filter((entry) => /\.(model|config|xml|gcode|txt)$/i.test(entry.name))
          .map((entry) => entry.content.toString('utf8'))
          .join('\n')

      const dimensions =
        compactDimensions(
          dimensionsFrom3mfModel(
            modelXml
          )
        )

      return {
        extracted:
          Boolean(
            dimensions ||
              text
          ),
        dimensions,
        profile:
          profileFromText(
            text
          ),
        message:
          dimensions
            ? 'Metadados extraidos do arquivo 3MF. Confira antes de validar a receita.'
            : 'Arquivo 3MF enviado. Confira dimensoes, material e perfil antes de validar.'
      }
    }

    if (detectedFormat === 'gcode') {
      const text =
        await fs.readFile(
          filePath,
          'utf8'
        )

      const dimensions =
        compactDimensions(
          dimensionsFromGcode(
            text
          )
        )

      return {
        extracted:
          true,
        dimensions,
        profile:
          profileFromText(
            text
          ),
        message:
          'Metadados extraidos do G-code. Confira antes de validar a receita.'
      }
    }

    return {
      extracted:
        false,
      message:
        'Formato sem extracao automatica de metadados.'
    }
  }

export const applyPrintFileMetadataToProduct =
  (product, metadata) => {
    const profile =
      metadata?.profile ||
      {}

    const nextPrintProfile = {
      ...(product.printProfile || {})
    }

    if (profile.layerHeightMm) {
      nextPrintProfile.layerHeightMm =
        profile.layerHeightMm
    }

    if (profile.infillPercent) {
      nextPrintProfile.infillPercent =
        profile.infillPercent
    }

    if (profile.nozzleTemperature) {
      nextPrintProfile.nozzleTemperature =
        profile.nozzleTemperature
    }

    if (profile.bedTemperature) {
      nextPrintProfile.bedTemperature =
        profile.bedTemperature
    }

    const nextCompatibility = {
      ...(product.compatibility || {})
    }

    if (profile.nozzleMm) {
      nextCompatibility.nozzleMm =
        profile.nozzleMm
    }

    if (profile.material) {
      nextCompatibility.materials =
        [profile.material]
    }

    return {
      ...product,
      dimensions:
        metadata?.dimensions ||
        product.dimensions ||
        '',
      layer:
        profile.layerHeightMm ||
        product.layer,
      infill:
        profile.infillPercent ||
        product.infill,
      printProfile:
        mergeProfile(
          nextPrintProfile
        ),
      compatibility:
        mergeProfile(
          nextCompatibility
        ),
      validationMessage:
        metadata?.message ||
        product.validationMessage ||
        ''
    }
  }
