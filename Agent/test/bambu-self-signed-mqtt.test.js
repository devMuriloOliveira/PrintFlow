import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import test from 'node:test'

import mqttPacket from 'mqtt-packet'

import {
  bambuAdapter
} from '../src/printers/adapters/bambuAdapter.js'

const opensslCandidates = () => {
  const candidates = ['openssl']

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    candidates.push(
      path.join(programFiles, 'Git', 'usr', 'bin', 'openssl.exe'),
      path.join(programFiles, 'Git', 'mingw64', 'bin', 'openssl.exe')
    )
  }

  return candidates
}

const findOpenSsl = () => {
  for (const candidate of opensslCandidates()) {
    const result = spawnSync(candidate, ['version'], {
      encoding: 'utf8',
      windowsHide: true
    })

    if (result.status === 0) return candidate
  }

  throw new Error('OpenSSL nao encontrado para criar a fixture TLS do teste.')
}

const runOpenSsl = args => {
  const executable = findOpenSsl()
  const result = spawnSync(
    executable,
    args,
    {
      encoding: 'utf8',
      windowsHide: true
    }
  )

  if (result.status !== 0) {
    throw new Error(
      `OpenSSL TLS fixture failed: ${result.stderr || result.stdout}`
    )
  }
}

const createTlsFixture = async directory => {
  const keyPath = path.join(directory, 'bambu-test.key.pem')
  const certPath = path.join(directory, 'bambu-test.cert.pem')

  runOpenSsl([
    'req',
    '-x509',
    '-newkey', 'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout', keyPath,
    '-out', certPath,
    '-days', '1',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
  ])

  return {
    key: await fs.readFile(keyPath),
    cert: await fs.readFile(certPath)
  }
}

const startBambuTlsBroker = async ({ key, cert, serial, accessCode }) => {
  const received = []
  let authenticated = false
  let subscribed = false

  const server = tls.createServer(
    {
      key,
      cert,
      minVersion: 'TLSv1.2'
    },
    socket => {
      const parser = mqttPacket.parser()
      socket.on('data', chunk => parser.parse(chunk))

      parser.on('packet', packet => {
        received.push(packet)

        if (packet.cmd === 'connect') {
          assert.equal(packet.username, 'bblp')
          assert.equal(packet.password.toString(), accessCode)
          authenticated = true
          socket.write(mqttPacket.generate({
            cmd: 'connack',
            returnCode: 0,
            sessionPresent: false
          }))
          return
        }

        if (packet.cmd === 'subscribe') {
          assert.equal(packet.subscriptions[0].topic, `device/${serial}/report`)
          subscribed = true
          socket.write(mqttPacket.generate({
            cmd: 'suback',
            messageId: packet.messageId,
            granted: [0]
          }))
          return
        }

        if (packet.cmd === 'publish') {
          const payload = JSON.parse(packet.payload.toString())

          if (packet.qos === 1) {
            socket.write(mqttPacket.generate({
              cmd: 'puback',
              messageId: packet.messageId
            }))
          }

          if (payload?.pushing?.command === 'pushall') {
            socket.write(mqttPacket.generate({
              cmd: 'publish',
              topic: `device/${serial}/report`,
              payload: Buffer.from(JSON.stringify({
                print: {
                  gcode_state: 'IDLE',
                  mc_percent: 0,
                  nozzle_temper: 24,
                  bed_temper: 23
                }
              })),
              qos: 0,
              retain: false,
              dup: false
            }))
          }
        }
      })
    }
  )

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  return {
    server,
    port: server.address().port,
    received,
    wasAuthenticated: () => authenticated,
    wasSubscribed: () => subscribed
  }
}

const connectWithStrictCertificateValidation = port =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: '127.0.0.1',
      port,
      rejectUnauthorized: true
    })

    socket.once('secureConnect', () => {
      socket.destroy()
      resolve()
    })
    socket.once('error', reject)
  })

test(
  'Bambu conecta, autentica e recebe telemetria por MQTT TLS autoassinado',
  {
    timeout: 30_000
  },
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'printflow-bambu-tls-')
    )
    let fixture = null
    let broker = null
    let connection = null

    const serial = 'PFTESTA1MINI001'
    const accessCode = 'TEST-CODE-1234'

    try {
      fixture = await createTlsFixture(directory)
      broker = await startBambuTlsBroker({
        key: fixture.key,
        cert: fixture.cert,
        serial,
        accessCode
      })

      await assert.rejects(
        connectWithStrictCertificateValidation(broker.port),
        /self-signed certificate/i
      )

      connection = await bambuAdapter.connect(
        {
          name: 'Bambu Lab A1 mini - TLS test',
          ip: '127.0.0.1',
          port: broker.port,
          serial,
          protocol: 'bambu'
        },
        {
          accessCode
        }
      )

      assert.equal(connection.connected, true)
      assert.equal(broker.wasAuthenticated(), true)
      assert.equal(broker.wasSubscribed(), true)

      const status = await bambuAdapter.getStatus(connection)
      assert.equal(status.connected, true)
      assert.equal(status.protocol, 'bambu')
      assert.equal(status.serial, serial)
      assert.equal(status.state, 'IDLE')
      assert.equal(status.nozzleTemperature, 24)
      assert.equal(status.bedTemperature, 23)

      await bambuAdapter.pause(connection)
      await bambuAdapter.resume(connection)
      await bambuAdapter.cancel(connection)

      const commands = broker.received
        .filter(packet => packet.cmd === 'publish')
        .map(packet => JSON.parse(packet.payload.toString())?.print?.command)
        .filter(Boolean)

      assert.deepEqual(
        commands.filter(command => ['pause', 'resume', 'stop'].includes(command)),
        ['pause', 'resume', 'stop']
      )
    } finally {
      if (connection) {
        await bambuAdapter.disconnect(connection)
      }
      if (broker) {
        await new Promise(resolve => broker.server.close(resolve))
      }
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)
