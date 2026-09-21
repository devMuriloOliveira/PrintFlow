import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildOrcaSlicerArgs, normalizeOrcaProfile, sliceWithOrcaSlicer } from '../src/slicing/orcaSlicer.js'
import { buildOfficialBambuP1SProfile, resolveOfficialOrcaProfileForPrinter } from '../src/slicing/orcaProfiles.js'
import { analyzeModelFile } from '../src/slicing/modelAnalyzer.js'
import { sliceModelWithOrcaSlicer } from '../src/slicing/sliceModel.js'

const storedZip = (entries) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(content)
    const local = Buffer.alloc(30 + nameBytes.length + data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    nameBytes.copy(local, 30)
    data.copy(local, 30 + nameBytes.length)
    locals.push(local)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

test('perfil oficial de referencia deriva presets da instalacao Orca', () => {
  const profile = buildOfficialBambuP1SProfile({ executablePath: 'C:/Program Files/OrcaSlicer/orca-slicer.exe' })
  assert.equal(profile.id, 'bambu-p1s-pla-basic')
  assert.equal(profile.version, '2.4.2')
  assert.match(profile.settingsPaths[0], /resources[\\/]profiles[\\/]BBL[\\/]machine[\\/]Bambu Lab P1S 0\.4 nozzle\.json$/)
  assert.match(profile.filamentPaths[0], /Bambu PLA Basic @BBL X1C\.json$/)
})

test('registro resolve modelos oficiais sem reutilizar perfil de outra impressora', () => {
  const profile = resolveOfficialOrcaProfileForPrinter({
    printer: { manufacturer: 'Bambu Lab', model: 'A1 mini' },
    executablePath: 'C:/Program Files/OrcaSlicer/orca-slicer.exe'
  })
  assert.equal(profile.id, 'bambu-a1-mini-pla-basic')
  assert.match(profile.settingsPaths[0], /machine[\\/]Bambu Lab A1 mini 0\.4 nozzle\.json$/)
  assert.match(profile.settingsPaths[1], /process[\\/]0\.20mm Standard @BBL A1M\.json$/)
})

test('registro recusa modelo sem perfil oficial cadastrado', () => {
  assert.throws(
    () => resolveOfficialOrcaProfileForPrinter({
      printer: { manufacturer: 'Creality', model: 'Ender-3 V3' },
      executablePath: 'C:/Program Files/OrcaSlicer/orca-slicer.exe'
    }),
    /Perfil OrcaSlicer oficial nao cadastrado/
  )
})

test('analisador local extrai limites e triangulos de STL', async () => {
  const result = await analyzeModelFile('test/fixtures/orca-cube.stl')
  assert.equal(result.format, 'stl')
  assert.equal(result.encoding, 'ascii')
  assert.equal(result.triangleCount, 12)
  assert.deepEqual(result.bounds.size, [20, 20, 20])
})

test('analisador local extrai geometria principal de 3MF', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printflow-3mf-'))
  try {
    const inputPath = path.join(root, 'cube.3mf')
    const model = '<model><resources><object><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="2" y="3" z="4"/><vertex x="1" y="2" z="3"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>'
    await writeFile(inputPath, storedZip([
      ['[Content_Types].xml', '<Types/>'],
      ['3D/3dmodel.model', model]
    ]))
    const result = await analyzeModelFile(inputPath)
    assert.equal(result.format, '3mf')
    assert.equal(result.triangleCount, 1)
    assert.deepEqual(result.bounds.size, [2, 3, 4])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pipeline local analisa, seleciona perfil e fatia sem enviar a impressora', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printflow-orca-pipeline-'))
  try {
    const executablePath = path.join(root, 'orca-slicer.exe')
    const inputPath = path.resolve('test/fixtures/orca-cube.stl')
    const outputPath = path.join(root, 'cube.gcode')
    const resources = path.join(root, 'resources', 'profiles', 'BBL')
    const settings = [
      path.join(resources, 'machine', 'Bambu Lab P1S 0.4 nozzle.json'),
      path.join(resources, 'process', '0.20mm Standard @BBL X1C.json')
    ]
    const filament = path.join(resources, 'filament', 'Bambu PLA Basic @BBL X1C.json')
    await Promise.all([
      mkdir(path.dirname(settings[0]), { recursive: true }),
      mkdir(path.dirname(settings[1]), { recursive: true }),
      mkdir(path.dirname(filament), { recursive: true })
    ])
    await Promise.all([
      writeFile(executablePath, 'mock executable'),
      writeFile(settings[0], '{}'),
      writeFile(settings[1], '{}'),
      writeFile(filament, '{}')
    ])

    const result = await sliceModelWithOrcaSlicer({
      inputPath,
      outputPath,
      executablePath,
      printer: { manufacturer: 'Bambu Lab', model: 'P1S' },
      spawnImpl: (file, args, options) => {
        const listeners = {}
        return {
          stdout: { on: () => {} },
          stderr: { on: () => {} },
          once: (event, handler) => {
            listeners[event] = handler
            if (event === 'close') setImmediate(async () => {
              await writeFile(outputPath, '; generated by test\nG1 X1 Y1\n')
              handler(0)
            })
          },
          kill: () => {}
        }
      }
    })
    assert.equal(result.analysis.triangleCount, 12)
    assert.equal(result.profile.id, 'bambu-p1s-pla-basic')
    assert.equal(result.artifact.format, 'gcode')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OrcaSlicer exige perfil versionado e monta args sem shell', () => {
  const profile = { id: 'bambu-x1c-pla', version: '2026.09.1', path: 'profiles/bambu.json' }
  assert.deepEqual(normalizeOrcaProfile(profile), {
    id: 'bambu-x1c-pla',
    version: '2026.09.1',
    path: path.resolve('profiles/bambu.json'),
    settingsPaths: [path.resolve('profiles/bambu.json')],
    filamentPaths: [],
    sha256: ''
  })
  assert.deepEqual(buildOrcaSlicerArgs({
    inputPath: 'models/part.3mf',
    outputPath: 'out/part.gcode',
    profile
  }).slice(0, 6), [
    path.resolve('models/part.3mf'), '--slice', '0', '--load-settings', path.resolve('profiles/bambu.json'), '--outputdir'
  ])
})

test('OrcaSlicer valida perfil, executa sem shell e retorna hash do G-code', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printflow-orca-'))
  try {
    const profilePath = path.join(root, 'profile.json')
    const inputPath = path.join(root, 'part.3mf')
    const outputPath = path.join(root, 'part.gcode')
    const executablePath = path.join(root, 'orca-slicer.exe')
    await mkdir(path.dirname(outputPath), { recursive: true })
    await Promise.all([
      writeFile(profilePath, '{"printer":"mock"}'),
      writeFile(inputPath, '3mf fixture'),
      writeFile(executablePath, 'mock executable')
    ])

    let invocation
    const result = await sliceWithOrcaSlicer({
      executablePath,
      inputPath,
      outputPath,
      profile: { id: 'mock', version: '1.0.0', path: profilePath },
      spawnImpl: (file, args, options) => {
        invocation = { file, args, options }
        const listeners = {}
        return {
          stdout: { on: (event, handler) => { listeners.stdout = handler } },
          stderr: { on: (event, handler) => { listeners.stderr = handler } },
          once: (event, handler) => {
            listeners[event] = handler
            if (event === 'close') {
              setImmediate(async () => {
                await writeFile(outputPath, '; generated by OrcaSlicer\\nG1 X1 Y1\\n')
                handler(0)
              })
            }
          },
          kill: () => {}
        }
      }
    })

    assert.equal(invocation.options.shell, false)
    assert.equal(invocation.args[0], inputPath)
    assert.equal(result.format, 'gcode')
    assert.match(result.sha256, /^[a-f0-9]{64}$/)
    assert.equal(result.profile.id, 'mock')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OrcaSlicer rejeita perfil alterado quando sha256 foi fixado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printflow-orca-hash-'))
  try {
    const profilePath = path.join(root, 'profile.json')
    const inputPath = path.join(root, 'part.stl')
    const executablePath = path.join(root, 'orca-slicer.exe')
    await Promise.all([
      writeFile(profilePath, '{"printer":"changed"}'),
      writeFile(inputPath, 'stl fixture'),
      writeFile(executablePath, 'mock executable')
    ])

    await assert.rejects(
      sliceWithOrcaSlicer({
        executablePath,
        inputPath,
        outputPath: path.join(root, 'part.gcode'),
        profile: { id: 'mock', version: '1.0.0', path: profilePath, sha256: '0'.repeat(64) },
        spawnImpl: () => { throw new Error('nao deveria executar') }
      }),
      /Hash do perfil OrcaSlicer divergente/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OrcaSlicer nao aceita G-code antigo como resultado novo', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'printflow-orca-stale-'))
  try {
    const profilePath = path.join(root, 'profile.json')
    const inputPath = path.join(root, 'part.stl')
    const outputPath = path.join(root, 'part.gcode')
    const executablePath = path.join(root, 'orca-slicer.exe')
    await Promise.all([
      writeFile(profilePath, '{"printer":"mock"}'),
      writeFile(inputPath, 'stl fixture'),
      writeFile(outputPath, '; stale output\n'),
      writeFile(executablePath, 'mock executable')
    ])

    await assert.rejects(
      sliceWithOrcaSlicer({
        executablePath,
        inputPath,
        outputPath,
        profile: { id: 'mock', version: '1.0.0', path: profilePath },
        spawnImpl: (file, args, options) => {
          const listeners = {}
          return {
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            once: (event, handler) => {
              listeners[event] = handler
              if (event === 'close') setImmediate(() => handler(0))
            },
            kill: () => {}
          }
        }
      }),
      /sem gerar um G-code valido/
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
