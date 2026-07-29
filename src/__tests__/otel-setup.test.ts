import { context, propagation, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import * as Sentry from '@sentry/node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { init, resetForTesting } from '../provider'

const SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0'

/**
 * `init()` registers OpenTelemetry globals on `globalThis`, and
 * `context.setGlobalContextManager()` silently refuses to replace an existing
 * registration. Vitest can reuse a worker thread across test files, and
 * `globalThis` outlives the module graph, so the registry is cleared on both
 * sides of every test rather than trusting file-level isolation.
 */
function clearOtelGlobals(): void {
  context.disable()
  trace.disable()
  propagation.disable()
}

function initWithOtel(otlpEndpoint?: string): void {
  init({
    serviceName: 'otel-setup-test',
    otlp: otlpEndpoint ? { endpoint: otlpEndpoint } : undefined,
    // Must be neither 'test' nor a deployed environment. `resolveConfig` derives
    // `isTest` from it and `init()` returns before touching any instrumentation
    // when that is set, and it also derives `pyroscope.enabled`, which would
    // otherwise start the profiler as a side effect of every test.
    environment: 'development',
    enableOtel: true,
    sentry: { dsn: SENTRY_DSN, enabled: false },
  })
}

beforeEach(() => {
  clearOtelGlobals()
})

afterEach(() => {
  resetForTesting()
  clearOtelGlobals()
})

describe('Sentry scope isolation with OpenTelemetry enabled', () => {
  it('hands withIsolationScope a forked scope, not the ambient one', () => {
    initWithOtel()

    const ambient = Sentry.getIsolationScope()
    const forked = Sentry.withIsolationScope((scope) => scope)

    expect(forked).not.toBe(ambient)
  })

  it('does not leak tags between sibling isolation scopes', () => {
    initWithOtel()

    Sentry.withIsolationScope((scope) => {
      scope.setTag('background_job.name', 'first-job')
    })

    let secondJobSaw: Record<string, unknown> = {}
    Sentry.withIsolationScope((scope) => {
      secondJobSaw = { ...scope.getScopeData().tags }
    })

    expect(secondJobSaw['background_job.name']).toBeUndefined()
  })

  it('leaves the process-global isolation scope unmutated', () => {
    initWithOtel()

    Sentry.withIsolationScope((scope) => {
      scope.setTag('area', 'some-sweep-job')
      scope.setExtra('transcriptId', 'abc123')
    })

    const globalScopeData = Sentry.getIsolationScope().getScopeData()

    expect(globalScopeData.tags.area).toBeUndefined()
    expect(globalScopeData.extra.transcriptId).toBeUndefined()
  })

  it('keeps concurrent isolation scopes independent across awaits', async () => {
    initWithOtel()

    // Two callers interleaving is a different mechanism from two sequential
    // ones: sequential leakage only needs the global scope mutated, whereas this
    // needs AsyncLocalStorage to hold two forks apart while their continuations
    // interleave. The delays are staggered so the second caller finishes while
    // the first is still suspended.
    async function runJob(name: string, delayMs: number): Promise<unknown> {
      return Sentry.withIsolationScope(async (scope) => {
        scope.setTag('background_job.name', name)
        await new Promise((tick) => setTimeout(tick, delayMs))
        return Sentry.getIsolationScope().getScopeData().tags[
          'background_job.name'
        ]
      })
    }

    const [slowJobSaw, fastJobSaw] = await Promise.all([
      runJob('slow-job', 20),
      runJob('fast-job', 1),
    ])

    expect(slowJobSaw).toBe('slow-job')
    expect(fastJobSaw).toBe('fast-job')
  })

  it('reports when another context manager holds the registration', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The context manager `SentryContextManager` wraps, so it maintains the OTel
    // context but carries no Sentry scopes. `setGlobalContextManager()` refuses
    // to replace an existing manager, so claiming the registration first is what
    // makes the library's own registration a no-op.
    context.setGlobalContextManager(new AsyncLocalStorageContextManager())

    try {
      initWithOtel()

      expect(Sentry.withIsolationScope((scope) => scope)).toBe(
        Sentry.getIsolationScope(),
      )
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Sentry scope isolation is NOT active'),
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('trace provider registration on the Sentry client', () => {
  it('gives the client a trace provider to flush on shutdown', () => {
    initWithOtel()

    // `NodeClient.flush()` and `.close()` are the only things that force-flush
    // the batched span processors, and they reach them through this reference.
    // Without it a graceful shutdown drops whatever the batch is still holding.
    expect(Sentry.getClient<Sentry.NodeClient>()?.traceProvider).toBeDefined()
  })

  it('flushes the trace provider when the client flushes', async () => {
    initWithOtel()

    const provider = Sentry.getClient<Sentry.NodeClient>()?.traceProvider
    if (!provider) throw new Error('expected a registered trace provider')
    const forceFlush = vi.spyOn(provider, 'forceFlush')

    await Sentry.flush()

    expect(forceFlush).toHaveBeenCalled()
  })

  it('settles the client close when span export fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A port that refuses connections stands in for a collector that is draining
    // at the same time as the pod. `NodeClient.close()` flushes first and then
    // shuts down the provider, so both stages must respect the shutdown budget.
    initWithOtel('http://127.0.0.1:1')

    try {
      Sentry.getClient<Sentry.NodeClient>()
        ?.tracer.startSpan('export-failure-probe')
        .end()

      await expect(Sentry.close(2000)).resolves.not.toThrow()
    } finally {
      consoleError.mockRestore()
    }
  }, 2000)
})
