import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions'
import Pyroscope from '@pyroscope/nodejs'
import * as Sentry from '@sentry/node'
import {
  SentryPropagator,
  SentrySampler,
  SentrySpanProcessor,
} from '@sentry/opentelemetry'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import { errors as joseErrors } from 'jose'

import { resetConfig, resolveConfig } from './config'
import type { ObservabilityConfig, ResolvedConfig } from './types'

let initialized = false

/**
 * Initialize Sentry, Pyroscope, and (optionally) the OpenTelemetry SDK.
 *
 * Must be called once at process startup, before any other observability
 * utilities are used. Subsequent calls are no-ops — the function is idempotent.
 *
 * In test environments (`NODE_ENV=test`) all instrumentation is skipped and
 * only the config is resolved, so tests remain fast and side-effect free.
 *
 * @param config - Observability configuration for this service.
 */
export function init(config: ObservabilityConfig): void {
  if (initialized) {
    return
  }

  const resolved = resolveConfig(config)

  if (resolved.isTest) {
    initialized = true
    return
  }

  console.log('Initializing observability', {
    serviceName: resolved.serviceName,
    environment: resolved.environment,
    sentryEnabled: resolved.sentry.enabled,
    pyroscopeEnabled: resolved.pyroscope.enabled,
    otelEnabled: resolved.enableOtel,
    otlpEnabled: resolved.otlp.enabled,
  })

  initializeSentry(resolved)

  if (resolved.pyroscope.enabled) {
    initializePyroscope(resolved)
  } else {
    console.log('Pyroscope profiling disabled')
  }

  if (resolved.enableOtel) {
    console.log('OpenTelemetry tracing enabled', {
      otlpEnabled: resolved.otlp.enabled,
      otlpEndpoint: resolved.otlp.endpoint,
      otlpSampleRate: resolved.otlp.sampleRate,
    })
    initializeOtelProvider(resolved)
  } else {
    console.log('OpenTelemetry disabled, using Sentry-only tracing')
  }

  initialized = true
}

/**
 * Reset the initialized state and config, allowing {@link init} to be called
 * again. Intended exclusively for use in test teardown (`afterEach`/`afterAll`).
 *
 * Do not call this in production code.
 */
export function resetForTesting(): void {
  initialized = false
  resetConfig()
}

function initializeSentry(config: ResolvedConfig): void {
  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.environment,
    release: config.release,
    integrations: [Sentry.expressIntegration(), nodeProfilingIntegration()],
    enabled: config.sentry.enabled,
    tracesSampler: (samplingContext) => {
      const { name, attributes } = samplingContext
      const httpTarget = attributes?.['http.target'] as string | undefined
      const rawRoute = httpTarget || name || ''
      const route = rawRoute.replace(/\/+$/, '')

      for (const ignoredRoute of config.filters.ignoredRoutes) {
        if (route === ignoredRoute || route.startsWith(`${ignoredRoute}?`)) {
          return 0
        }
      }
      return config.sentry.sampleRate
    },
    beforeSend(event, hint) {
      const error = hint?.originalException

      if (config.shouldDropError?.(error)) {
        return null
      }

      if (error instanceof joseErrors.JWTExpired) {
        return null
      }

      return event
    },
    beforeBreadcrumb: (breadcrumb) => {
      if (
        !breadcrumb.category ||
        !config.filters.ignoredBreadcrumbCategories.includes(
          breadcrumb.category,
        )
      ) {
        return breadcrumb
      }

      const url = breadcrumb.data?.url as string | undefined
      if (!url) return breadcrumb

      for (const pattern of config.filters.ignoredBreadcrumbPatterns) {
        if (pattern.test(url)) return null
      }

      return breadcrumb
    },
    profileSessionSampleRate: config.sentry.profileSampleRate,
    profileLifecycle: 'trace',
    sendDefaultPii: true,
    skipOpenTelemetrySetup: config.enableOtel,
  })
}

function initializeOtelProvider(config: ResolvedConfig): void {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment,
    [ATTR_SERVICE_VERSION]: config.release,
  })

  const sentryClient = Sentry.getClient()
  const provider = new NodeTracerProvider({
    resource,
    sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
  })

  provider.addSpanProcessor(
    new SentrySpanProcessor() as unknown as SpanProcessor,
  )

  if (config.otlp.enabled && config.otlp.endpoint) {
    const otlpExporter = new OTLPTraceExporter({
      url: `${config.otlp.endpoint}/v1/traces`,
      headers: config.otlp.headers,
    })

    provider.addSpanProcessor(
      new BatchSpanProcessor(otlpExporter, {
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000,
      }),
    )
  }

  provider.register({
    propagator: new SentryPropagator(),
  })
}

function initializePyroscope(config: ResolvedConfig): void {
  const pyroscopeConfig = {
    serverAddress: config.pyroscope.serverAddress,
    appName: config.serviceName,
    tags: {
      environment: config.environment,
      ...config.pyroscope.tags,
    },
    wall: {
      collectCpuTime: true,
    },
    heap: {
      samplingIntervalBytes: 512 * 1024,
    },
  }

  console.log('Pyroscope initializing', {
    serverAddress: config.pyroscope.serverAddress,
    appName: config.serviceName,
  })

  try {
    Pyroscope.init(pyroscopeConfig)
    Pyroscope.start()
    console.log('Pyroscope profiling started successfully')
  } catch (error) {
    console.error('Pyroscope initialization failed', error)
    Sentry.captureException(error, {
      tags: { component: 'pyroscope' },
      level: 'error',
    })
  }
}
