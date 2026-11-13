const http = require('node:http')

const { init } = require('../../dist/index.cjs')
const Sentry = require('@sentry/node')

const PRIVATE_REQUEST = 'ENG559_PRIVATE_REQUEST'
const SAFE_REQUEST = 'ENG559_SAFE_REQUEST'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const call = http.request(
      { host: '127.0.0.1', port, path, headers },
      (response) => {
        response.resume()
        response.once('end', () => resolve(response))
      },
    )
    call.once('error', reject)
    call.end()
  })
}

async function main() {
  const mode = process.argv[2]
  if (mode !== 'sentry' && mode !== 'otel') {
    throw new Error(`Unexpected probe mode: ${mode}`)
  }

  const exports = []
  const startedSpans = []
  let appReceivedPrivateRequestHeader

  const collector = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      exports.push({
        path: req.url,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  const collectorPort = await listen(collector)

  const app = http.createServer((req, res) => {
    if (req.url !== '/exercise') {
      res.writeHead(404)
      res.end()
      return
    }

    appReceivedPrivateRequestHeader = req.headers['x-scope3-origin-ref']
    res.end('ok')
  })
  const appPort = await listen(app)

  try {
    const dataCollection = {
      httpHeaders: {
        request: { deny: ['x-scope3-origin-ref'] },
        response: { deny: ['x-private-response'] },
      },
    }

    init({
      serviceName: 'eng559-data-collection-test',
      environment: 'production',
      enableOtel: mode === 'otel',
      sentry: {
        dsn: `http://local@127.0.0.1:${collectorPort}/1`,
        enabled: true,
        sampleRate: 1,
        dataCollection,
        integrations: [
          Sentry.requestDataIntegration({ include: { headers: false } }),
          Sentry.httpIntegration(),
        ],
      },
      pyroscope: { enabled: false },
      ...(mode === 'otel'
        ? {
            otlp: {
              endpoint: `http://127.0.0.1:${collectorPort}`,
              sampleRate: 1,
            },
          }
        : {}),
    })

    const client = Sentry.getClient()
    if (!client) throw new Error('Compiled init did not initialize Sentry')
    client.on('spanStart', (span) =>
      startedSpans.push(JSON.stringify(Sentry.spanToJSON(span).data)),
    )

    await request(appPort, '/exercise', {
      'X-Scope3-Origin-Ref': PRIVATE_REQUEST,
      'X-Safe-Request': SAFE_REQUEST,
    })

    if (mode === 'otel') await client.traceProvider.forceFlush()
    await Sentry.flush(3000)

    const clientDataCollection = client.getOptions().dataCollection
    const sentryExports = exports.filter((entry) =>
      entry.path.includes('/api/1/envelope/'),
    )
    const otlpExports = exports.filter((entry) => entry.path === '/v1/traces')
    const sentryText = JSON.stringify(sentryExports)
    const otlpText = JSON.stringify(otlpExports)
    const startedText = startedSpans.join('\n')

    process.stdout.write(
      `DATA_COLLECTION_RESULT ${JSON.stringify({
        dataCollection: {
          request: clientDataCollection.httpHeaders.request,
          response: clientDataCollection.httpHeaders.response,
        },
        appReceivedPrivateRequestHeader,
        requestMarkerAtSpanStart: startedText.includes(PRIVATE_REQUEST),
        safeRequestAtSpanStart: startedText.includes(SAFE_REQUEST),
        sentryExportCount: sentryExports.length,
        sentryExportContainsPrivateRequest:
          sentryText.includes(PRIVATE_REQUEST),
        sentryExportContainsSafeRequest: sentryText.includes(SAFE_REQUEST),
        otlpExportCount: otlpExports.length,
        otlpExportContainsPrivateRequest: otlpText.includes(PRIVATE_REQUEST),
        otlpExportContainsSafeRequest: otlpText.includes(SAFE_REQUEST),
      })}\n`,
    )
  } finally {
    await new Promise((resolve) => app.close(resolve))
    await new Promise((resolve) => collector.close(resolve))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
