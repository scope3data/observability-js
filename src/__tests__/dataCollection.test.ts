import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { resolveConfig } from '../config'

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const integrationProbe = resolve(
  fileURLToPath(new URL('./dataCollection.probe.cjs', import.meta.url)),
)

describe('Sentry dataCollection configuration', () => {
  it('preserves existing defaults when no dataCollection option is supplied', () => {
    const resolved = resolveConfig({ serviceName: 'test-service' })

    expect(resolved.sentry.dataCollection).toBeUndefined()
    expect(resolved.sentry.enabled).toBe(false)
    expect(resolved.sentry.sampleRate).toBe(1)
  })

  it('resolves caller supplied request and response controls unchanged', () => {
    const dataCollection = {
      httpHeaders: {
        request: { deny: ['x-scope3-origin-ref'] },
        response: { deny: ['x-private-response'] },
      },
    }

    const resolved = resolveConfig({
      serviceName: 'test-service',
      sentry: { dataCollection },
    })

    expect(resolved.sentry.dataCollection).toEqual(dataCollection)
    expect(resolved.sentry.dataCollection).toBe(dataCollection)
  })

  describe('compiled package initialization and HTTP instrumentation', () => {
    beforeAll(() => {
      execFileSync('npm', ['run', 'build'], {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 60_000,
      })
    }, 65_000)

    it.each([
      ['Sentry-only', 'sentry'],
      ['OpenTelemetry-enabled', 'otel'],
    ])(
      'forwards controls through the compiled package in %s mode',
      (_label, mode) => {
        const output = execFileSync(
          process.execPath,
          [integrationProbe, mode],
          {
            cwd: projectRoot,
            encoding: 'utf8',
            timeout: 30_000,
            env: { ...process.env, NODE_ENV: 'production' },
          },
        )
        const resultLine = output
          .split('\n')
          .find((line) => line.startsWith('DATA_COLLECTION_RESULT '))

        if (!resultLine) throw new Error(output)
        const result = JSON.parse(
          resultLine.slice('DATA_COLLECTION_RESULT '.length),
        )

        expect(result.dataCollection).toEqual({
          request: { deny: ['x-scope3-origin-ref'] },
          response: { deny: ['x-private-response'] },
        })
        expect(result.appReceivedPrivateRequestHeader).toBe(
          'ENG559_PRIVATE_REQUEST',
        )
        expect(result.requestMarkerAtSpanStart).toBe(false)
        expect(result.safeRequestAtSpanStart).toBe(true)
        expect(result.sentryExportCount).toBeGreaterThan(0)
        expect(result.sentryExportContainsPrivateRequest).toBe(false)
        expect(result.sentryExportContainsSafeRequest).toBe(true)

        if (mode === 'otel') {
          expect(result.otlpExportCount).toBeGreaterThan(0)
          expect(result.otlpExportContainsPrivateRequest).toBe(false)
          expect(result.otlpExportContainsSafeRequest).toBe(true)
        }
      },
      40_000,
    )
  })
})
