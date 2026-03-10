import type { ObservabilityConfig, ResolvedConfig } from './types'

let resolvedConfig: ResolvedConfig | null = null

export function resolveConfig(config: ObservabilityConfig): ResolvedConfig {
  const environment =
    config.environment ?? process.env.NODE_ENV ?? 'development'
  const isProduction = environment === 'production'
  const isStaging = environment === 'staging'
  const isTest = environment === 'test' || Boolean(process.env.JEST_WORKER_ID)
  const isDeployed = isProduction || isStaging

  const defaultSampleRate = isProduction ? 0.25 : 1.0

  const sentryEnabled =
    config.sentry?.enabled !== undefined
      ? config.sentry.enabled
      : Boolean(config.sentry?.dsn) && isDeployed && !isTest

  const sentrySampleRate = clampSampleRate(
    config.sentry?.sampleRate ?? defaultSampleRate,
  )

  const pyroscopeEnabled =
    config.pyroscope?.enabled !== undefined
      ? config.pyroscope.enabled
      : isDeployed && !isTest

  const pyroscopeServerAddress =
    config.pyroscope?.serverAddress ??
    (isDeployed
      ? 'http://pyroscope.monitoring.svc.cluster.local.:4040'
      : 'http://localhost:4040')

  const otlpEnabled = Boolean(config.otlp?.endpoint)
  const otlpSampleRate = clampSampleRate(config.otlp?.sampleRate ?? 1.0)

  resolvedConfig = {
    serviceName: config.serviceName,
    environment,
    release: config.release ?? process.env.COMMIT_SHA ?? 'unknown',
    isTest,
    isDeployed,

    sentry: {
      dsn: config.sentry?.dsn,
      enabled: sentryEnabled,
      sampleRate: sentrySampleRate,
      profileSampleRate: config.sentry?.profileSampleRate ?? sentrySampleRate,
    },

    pyroscope: {
      enabled: pyroscopeEnabled,
      serverAddress: pyroscopeServerAddress,
      tags: config.pyroscope?.tags ?? {},
    },

    otlp: {
      endpoint: config.otlp?.endpoint,
      headers: config.otlp?.headers ?? {},
      sampleRate: otlpSampleRate,
      enabled: otlpEnabled,
    },

    enableOtel: config.enableOtel ?? false,
    tracerName: config.tracerName ?? config.serviceName,

    filters: {
      ignoredRoutes: config.filters?.ignoredRoutes ?? [],
      ignoredBreadcrumbCategories: config.filters
        ?.ignoredBreadcrumbCategories ?? ['http', 'fetch', 'xhr'],
      ignoredBreadcrumbPatterns: config.filters?.ignoredBreadcrumbPatterns ?? [
        /pyroscope/i,
        /posthog\.com/i,
        /i\.posthog\.com/i,
      ],
    },

    shouldDropError: config.shouldDropError,
  }

  return resolvedConfig
}

export function getConfig(): ResolvedConfig {
  if (!resolvedConfig) {
    throw new Error(
      'Observability not initialized. Call init() before using observability utilities.',
    )
  }
  return resolvedConfig
}

export function resetConfig(): void {
  resolvedConfig = null
}

function clampSampleRate(rate: number): number {
  return Math.max(0, Math.min(1, rate))
}
