import type { Span as OtelSpan } from '@opentelemetry/api'

/** Sentry error monitoring and profiling configuration. */
export interface SentryConfig {
  /** Sentry DSN. Required for Sentry to be enabled in deployed environments. */
  dsn?: string
  /**
   * Explicitly enable or disable Sentry. When omitted, Sentry is enabled
   * automatically if a DSN is provided and the environment is production or staging.
   */
  enabled?: boolean
  /**
   * Fraction of transactions to send to Sentry, between 0 and 1.
   * Defaults to 0.25 in production and 1.0 in all other environments.
   */
  sampleRate?: number
  /**
   * Fraction of sampled transactions to include a profile for, between 0 and 1.
   * Defaults to the resolved `sampleRate`.
   */
  profileSampleRate?: number
}

/** Pyroscope continuous profiling configuration. */
export interface PyroscopeConfig {
  /**
   * Explicitly enable or disable Pyroscope. When omitted, Pyroscope is enabled
   * automatically in production and staging environments.
   */
  enabled?: boolean
  /**
   * Pyroscope server address.
   * Defaults to the in-cluster address in deployed environments,
   * or `http://localhost:4040` locally.
   */
  serverAddress?: string
  /** Additional tags attached to all Pyroscope profiles. */
  tags?: Record<string, string>
}

/** OpenTelemetry OTLP trace export configuration. */
export interface OtlpConfig {
  /** OTLP collector endpoint (e.g. `http://otel-collector:4318`). OTLP export is disabled when omitted. */
  endpoint?: string
  /** HTTP headers sent with every OTLP export request (e.g. for authentication). */
  headers?: Record<string, string>
  /**
   * Fraction of traces to export via OTLP, between 0 and 1.
   * Defaults to 1.0 (all traces).
   */
  sampleRate?: number
}

/** Configuration for filtering out noisy traces, errors, and breadcrumbs. */
export interface FilterConfig {
  /**
   * HTTP routes that should never be sampled (e.g. health checks).
   * Trailing slashes and query strings are handled automatically.
   * Example: `['/health', '/metrics']`
   */
  ignoredRoutes?: string[]
  /**
   * Sentry breadcrumb categories to apply URL-pattern filtering to.
   * Defaults to `['http', 'fetch', 'xhr']`.
   */
  ignoredBreadcrumbCategories?: string[]
  /**
   * URL patterns for breadcrumbs that should be dropped entirely.
   * Defaults to patterns matching Pyroscope and PostHog URLs.
   */
  ignoredBreadcrumbPatterns?: RegExp[]
}

/** Top-level configuration passed to {@link init}. */
export interface ObservabilityConfig {
  /** Identifies this service in Sentry, Pyroscope, and OTLP traces. */
  serviceName: string
  /**
   * Deployment environment (e.g. `'production'`, `'staging'`, `'development'`).
   * Defaults to `NODE_ENV` or `'development'`.
   */
  environment?: string
  /**
   * Release identifier attached to Sentry events and OTLP traces.
   * Defaults to the `COMMIT_SHA` environment variable, or `'unknown'`.
   */
  release?: string

  /** Sentry configuration. */
  sentry?: SentryConfig
  /** Pyroscope continuous profiling configuration. */
  pyroscope?: PyroscopeConfig
  /** OTLP trace export configuration. */
  otlp?: OtlpConfig

  /**
   * Enable the OpenTelemetry SDK in addition to Sentry's built-in tracing.
   * Required when exporting traces via OTLP. Defaults to `false`.
   */
  enableOtel?: boolean
  /**
   * Name used to obtain the OpenTelemetry tracer instance.
   * Defaults to `serviceName`.
   */
  tracerName?: string

  /** Filtering rules for traces, errors, and breadcrumbs. */
  filters?: FilterConfig

  /**
   * Optional predicate to suppress specific errors from being reported to Sentry.
   * Return `true` to drop the error, `false` to allow it through.
   */
  shouldDropError?: (error: unknown) => boolean
}

export interface ResolvedConfig {
  serviceName: string
  environment: string
  release: string
  isTest: boolean
  isDeployed: boolean

  sentry: {
    dsn?: string
    enabled: boolean
    sampleRate: number
    profileSampleRate: number
  }

  pyroscope: {
    enabled: boolean
    serverAddress: string
    tags: Record<string, string>
  }

  otlp: {
    endpoint?: string
    headers: Record<string, string>
    sampleRate: number
    enabled: boolean
  }

  enableOtel: boolean
  tracerName: string

  filters: {
    ignoredRoutes: string[]
    ignoredBreadcrumbCategories: string[]
    ignoredBreadcrumbPatterns: RegExp[]
  }

  shouldDropError?: (error: unknown) => boolean
}

/** Context fields attached to MCP tool spans and error reports. */
export interface MCPSpanContext {
  /** MCP session identifier. */
  sessionId?: string
  /** Customer identifier. */
  customerId?: number
  /** Customer company name. */
  company?: string
  /** MCP tool name. */
  toolName?: string
}

/** Flat map of span attribute key-value pairs. `undefined` values are ignored. */
export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined
}

export type Span = OtelSpan
