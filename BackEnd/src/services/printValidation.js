const number =
  (value) =>
    Number(
      value ||
        0
    )

const normalize =
  (value) =>
    String(
      value ||
        ''
    )
      .trim()
      .toLowerCase()

const allowedReadyPrintFormats =
  new Set([
    '3mf',
    'gcode',
    'bgcode'
  ])

const fileExtension =
  (value) =>
    normalize(
      String(
        value ||
          ''
      )
        .split('.')
        .pop()
    )

const normalizeList =
  (value) => {
    if (Array.isArray(value)) {
      return value
        .map(normalize)
        .filter(Boolean)
    }

    return String(
      value ||
        ''
    )
      .split(',')
      .map(normalize)
      .filter(Boolean)
  }

export const parseDimensions =
  (value) => {
    if (!value) return null

    const parts =
      String(value)
        .replace(/,/g, '.')
        .match(/\d+(?:\.\d+)?/g)
        ?.map(Number)
        .filter((item) => Number.isFinite(item) && item > 0) ||
      []

    if (parts.length < 3) return null

    return {
      x:
        parts[0],
      y:
        parts[1],
      z:
        parts[2]
    }
  }

const allowedFormatsByProtocol = {
  bambu:
    new Set(['3mf', 'gcode', 'bgcode']),
  octoprint:
    new Set(['gcode']),
  moonraker:
    new Set(['gcode']),
  prusalink:
    new Set(['gcode', 'bgcode']),
  marlin:
    new Set(['gcode'])
}

const resolveAllowedFormats =
  (printer, product) => {
    const protocol =
      normalize(
        printer?.agent_protocol ||
          printer?.agentProtocol ||
          product?.printer_protocol
      )

    return allowedFormatsByProtocol[protocol] ||
      new Set(['gcode', '3mf', 'bgcode'])
  }

const firstPositiveNumber =
  (...values) => {
    for (const value of values) {
      const numericValue =
        number(value)

      if (numericValue > 0) {
        return numericValue
      }
    }

    return 0
  }

const almostEqual =
  (left, right, tolerance = 0.01) =>
    Math.abs(
      Number(left) -
        Number(right)
    ) <= tolerance

export const validatePrintCompatibility =
  ({
    product,
    printer,
    filament,
    job
  }) => {
    const errors = []
    const warnings = []

    if (!product) {
      return {
        valid: false,
        errors: [
          'Produto nao encontrado.'
        ],
        warnings
      }
    }

    if (!printer) {
      errors.push(
        'Impressora nao encontrada.'
      )
    }

    const format =
      normalize(
        product.print_file_format
      )

    if (!product.print_file_name) {
      errors.push(
        'Arquivo de impressao nao informado.'
      )
    }

    if (!format) {
      errors.push(
        'Formato do arquivo nao informado.'
      )
    } else if (
      !allowedReadyPrintFormats.has(format)
    ) {
      errors.push(
        `Formato ${format.toUpperCase()} ainda nao esta liberado para impressao automatica.`
      )
    } else if (
      printer &&
      !resolveAllowedFormats(
        printer,
        product
      ).has(format)
    ) {
      errors.push(
        `Formato ${format.toUpperCase()} nao e recomendado para esta impressora.`
      )
    }

    const extension =
      fileExtension(
        product.print_file_name
      )

    if (
      extension &&
      format &&
      extension !==
        format
    ) {
      errors.push(
        `Extensao do arquivo (${extension.toUpperCase()}) nao confere com o formato informado (${format.toUpperCase()}).`
      )
    }

    const quantity =
      Number(
        job?.quantity ??
          1
      )

    if (
      !Number.isInteger(quantity) ||
      quantity <=
        0
    ) {
      errors.push(
        'Quantidade da fila precisa ser um numero inteiro maior que zero.'
      )
    }

    if (!product.print_file_hash) {
      warnings.push(
        'Arquivo sem hash/checksum; valide o arquivo antes da producao.'
      )
    }

    if (!product.print_file_storage_key) {
      errors.push(
        'Arquivo ainda nao esta disponivel no storage para o Agent.'
      )
    }

    const productDimensions =
      parseDimensions(
        product.dimensions
      )

    if (!productDimensions) {
      errors.push(
        'Dimensoes reais do produto nao informadas.'
      )
    }

    const printerVolume =
      parseDimensions(
        printer?.volume
      )

    if (
      productDimensions &&
      printerVolume &&
      (
        productDimensions.x > printerVolume.x ||
        productDimensions.y > printerVolume.y ||
        productDimensions.z > printerVolume.z
      )
    ) {
      errors.push(
        `Produto (${productDimensions.x} x ${productDimensions.y} x ${productDimensions.z} mm) excede o volume da impressora (${printerVolume.x} x ${printerVolume.y} x ${printerVolume.z} mm).`
      )
    } else if (
      productDimensions &&
      !printerVolume
    ) {
      warnings.push(
        'Volume da impressora nao informado; confira manualmente antes de imprimir.'
      )
    }

    const compatibility =
      product.compatibility ||
      {}

    const materials =
      normalizeList(
        compatibility.materials
      )

    const filamentMaterial =
      normalize(
        filament?.material ||
          product.filament
      )

    if (
      materials.length &&
      filamentMaterial &&
      !materials.includes(filamentMaterial)
    ) {
      errors.push(
        `Material ${filamentMaterial.toUpperCase()} nao esta liberado para este produto.`
      )
    }

    const nozzle =
      number(
        compatibility.nozzleMm
      )

    if (nozzle <= 0) {
      errors.push(
        'Diametro do bico nao informado.'
      )
    }

    const printerNozzle =
      firstPositiveNumber(
        printer?.nozzle_mm,
        printer?.nozzleMm,
        printer?.metadata?.nozzleMm
      )

    if (
      nozzle > 0 &&
      printerNozzle > 0 &&
      !almostEqual(
        nozzle,
        printerNozzle
      )
    ) {
      errors.push(
        `Receita exige bico de ${nozzle} mm, mas a impressora esta configurada com bico de ${printerNozzle} mm.`
      )
    }

    const profile =
      product.print_profile ||
      {}

    const layerHeight =
      firstPositiveNumber(
        product.layer_height,
        profile.layerHeightMm
      )

    if (
      layerHeight <=
      0
    ) {
      errors.push(
        'Altura de camada nao informada.'
      )
    }

    const minLayerHeight =
      firstPositiveNumber(
        printer?.min_layer_height,
        printer?.minLayerHeight,
        printer?.metadata?.minLayerHeight
      )

    const maxLayerHeight =
      firstPositiveNumber(
        printer?.max_layer_height,
        printer?.maxLayerHeight,
        printer?.metadata?.maxLayerHeight
      )

    if (
      layerHeight > 0 &&
      minLayerHeight > 0 &&
      layerHeight < minLayerHeight
    ) {
      errors.push(
        `Altura de camada ${layerHeight} mm abaixo do minimo da impressora (${minLayerHeight} mm).`
      )
    }

    if (
      layerHeight > 0 &&
      maxLayerHeight > 0 &&
      layerHeight > maxLayerHeight
    ) {
      errors.push(
        `Altura de camada ${layerHeight} mm acima do maximo da impressora (${maxLayerHeight} mm).`
      )
    }

    const infill =
      firstPositiveNumber(
        product.infill,
        profile.infillPercent
      )

    if (
      infill <=
      0
    ) {
      errors.push(
        'Preenchimento nao informado.'
      )
    } else if (
      infill > 100
    ) {
      errors.push(
        'Preenchimento precisa estar entre 1% e 100%.'
      )
    }

    if (
      product.validation_status !==
      'validated'
    ) {
      errors.push(
        'Receita de impressao ainda nao foi marcada como validada.'
      )
    }

    return {
      valid:
        errors.length ===
        0,
      errors,
      warnings
    }
  }
