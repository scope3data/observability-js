import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetConfig, resolveConfig } from '../config'
import { buildTracesSampler } from '../provider'

const DEFAULT_FILTER_CONFIG = {
  ignoredRoutes: ['/health', '/health/liveness', '/metrics'],
  ignoredBreadcrumbCategories: ['http', 'fetch', 'xhr'],
  ignoredBreadcrumbPatterns: [
    /pyroscope/i,
    /posthog\.com/i,
    /i\.posthog\.com/i,
  ],
}

describe('Observability Filtering', () => {
  afterEach(() => {
    resetConfig()
  })
  describe('tracesSampler logic', () => {
    const shouldDropTrace = (route: string): boolean => {
      const normalized = route.replace(/\/+$/, '')
      return DEFAULT_FILTER_CONFIG.ignoredRoutes.some(
        (ignored) =>
          normalized === ignored || normalized.startsWith(`${ignored}?`),
      )
    }

    it('drops health check routes', () => {
      expect(shouldDropTrace('/health')).toBe(true)
      expect(shouldDropTrace('/health/liveness')).toBe(true)
      expect(shouldDropTrace('/metrics')).toBe(true)
    })

    it('handles query strings', () => {
      expect(shouldDropTrace('/health?status=ok')).toBe(true)
      expect(shouldDropTrace('/health/liveness?probe=1')).toBe(true)
      expect(shouldDropTrace('/metrics?format=json')).toBe(true)
    })

    it('handles trailing slashes', () => {
      expect(shouldDropTrace('/health/')).toBe(true)
      expect(shouldDropTrace('/health/liveness/')).toBe(true)
      expect(shouldDropTrace('/metrics/')).toBe(true)
      expect(shouldDropTrace('/health//')).toBe(true)
    })

    it('preserves application routes', () => {
      expect(shouldDropTrace('/api/customers')).toBe(false)
      expect(shouldDropTrace('/api/health-data')).toBe(false)
      expect(shouldDropTrace('/healthy')).toBe(false)
      expect(shouldDropTrace('/metrics-dashboard')).toBe(false)
    })

    it('does not match partial route names', () => {
      expect(shouldDropTrace('/health/custom')).toBe(false)
      expect(shouldDropTrace('/healthcheck')).toBe(false)
    })
  })

  describe('shouldDropError callback pattern', () => {
    class MockServiceError extends Error {
      constructor(
        message: string,
        public readonly code: string,
      ) {
        super(message)
        this.name = 'ServiceError'
      }
    }

    const CLIENT_ERROR_CODES = new Set([
      'NOT_FOUND',
      'ACCESS_DENIED',
      'VALIDATION_ERROR',
      'CONFLICT',
      'RATE_LIMITED',
    ])

    const shouldDropError = (error: unknown): boolean => {
      return (
        error instanceof MockServiceError && CLIENT_ERROR_CODES.has(error.code)
      )
    }

    it('filters errors with client error codes', () => {
      for (const code of CLIENT_ERROR_CODES) {
        expect(shouldDropError(new MockServiceError('test', code))).toBe(true)
      }
    })

    it('preserves errors with INTERNAL_ERROR code', () => {
      expect(
        shouldDropError(
          new MockServiceError('db connection failed', 'INTERNAL_ERROR'),
        ),
      ).toBe(false)
    })

    it('preserves non-ServiceError exceptions', () => {
      expect(shouldDropError(new Error('unexpected failure'))).toBe(false)
      expect(shouldDropError(new TypeError('cannot read property'))).toBe(false)
      expect(shouldDropError('string error')).toBe(false)
    })

    it('handles undefined and null gracefully', () => {
      expect(shouldDropError(undefined)).toBe(false)
      expect(shouldDropError(null)).toBe(false)
    })
  })

  describe('classifyError callback pattern', () => {
    class TransportError extends Error {
      constructor(
        message: string,
        public readonly transient: boolean,
      ) {
        super(message)
        this.name = 'TransportError'
      }
    }

    const classifyError = (error: unknown): 'drop' | 'warning' | undefined => {
      if (error instanceof TransportError) {
        return error.transient ? 'warning' : undefined
      }
      if (
        error instanceof Error &&
        error.message.includes('client disconnected')
      ) {
        return 'drop'
      }
      return undefined
    }

    it('returns drop to suppress errors', () => {
      expect(classifyError(new Error('client disconnected unexpectedly'))).toBe(
        'drop',
      )
    })

    it('returns warning to downgrade severity', () => {
      expect(classifyError(new TransportError('timeout', true))).toBe('warning')
    })

    it('returns undefined to leave errors unchanged', () => {
      expect(
        classifyError(new TransportError('connection refused', false)),
      ).toBeUndefined()
      expect(classifyError(new Error('unexpected failure'))).toBeUndefined()
    })

    it('handles non-Error values gracefully', () => {
      expect(classifyError(undefined)).toBeUndefined()
      expect(classifyError(null)).toBeUndefined()
      expect(classifyError('string error')).toBeUndefined()
    })
  })

  describe('beforeBreadcrumb logic', () => {
    type MockBreadcrumb = {
      category?: string
      data?: { url?: string }
    }

    const shouldDropBreadcrumb = (breadcrumb: MockBreadcrumb): boolean => {
      if (
        !breadcrumb.category ||
        !DEFAULT_FILTER_CONFIG.ignoredBreadcrumbCategories.includes(
          breadcrumb.category,
        )
      ) {
        return false
      }

      const url = breadcrumb.data?.url
      if (!url) return false

      return DEFAULT_FILTER_CONFIG.ignoredBreadcrumbPatterns.some((pattern) =>
        pattern.test(url),
      )
    }

    it('drops Pyroscope URLs', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: {
            url: 'http://pyroscope.monitoring.svc.cluster.local:4040/ingest',
          },
        }),
      ).toBe(true)
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://pyroscope.io/api' },
        }),
      ).toBe(true)
    })

    it('drops PostHog URLs', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://us.i.posthog.com/capture' },
        }),
      ).toBe(true)
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://i.posthog.com/track' },
        }),
      ).toBe(true)
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://app.posthog.com/decide' },
        }),
      ).toBe(true)
    })

    it('handles case variations (case-insensitive)', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://POSTHOG.COM/api' },
        }),
      ).toBe(true)
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'http://PYROSCOPE.local/ingest' },
        }),
      ).toBe(true)
    })

    it('preserves non-HTTP breadcrumbs', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'console',
          data: { url: 'https://posthog.com' },
        }),
      ).toBe(false)
      expect(
        shouldDropBreadcrumb({
          category: 'navigation',
          data: { url: 'https://pyroscope.io' },
        }),
      ).toBe(false)
    })

    it('handles fetch and xhr categories', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'fetch',
          data: { url: 'https://posthog.com/capture' },
        }),
      ).toBe(true)
      expect(
        shouldDropBreadcrumb({
          category: 'xhr',
          data: { url: 'https://pyroscope.io/api' },
        }),
      ).toBe(true)
    })

    it('preserves breadcrumbs with missing URL', () => {
      expect(shouldDropBreadcrumb({ category: 'http', data: {} })).toBe(false)
      expect(shouldDropBreadcrumb({ category: 'http' })).toBe(false)
    })

    it('preserves non-matching HTTP breadcrumbs', () => {
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://api.example.com/data' },
        }),
      ).toBe(false)
      expect(
        shouldDropBreadcrumb({
          category: 'http',
          data: { url: 'https://internal-service.local/health' },
        }),
      ).toBe(false)
    })
  })

  describe('custom tracesSampler hook', () => {
    // Minimal stub satisfying TracesSamplerSamplingContext's required fields.
    const ctx = (partial: {
      name?: string
      attributes?: Record<string, unknown>
    }) =>
      ({
        name: '',
        inheritOrSampleWith: (r: number) => r,
        ...partial,
      }) as Parameters<ReturnType<typeof buildTracesSampler>>[0]

    const makeSampler = (
      ignoredRoutes: string[],
      customSampler?: (c: ReturnType<typeof ctx>) => number | undefined,
      defaultRate = 1.0,
    ) => {
      const config = resolveConfig({
        serviceName: 'test',
        filters: { ignoredRoutes },
        sentry: { sampleRate: defaultRate, tracesSampler: customSampler },
      })
      return buildTracesSampler(config)
    }

    it('falls back to sampleRate when no custom sampler provided', () => {
      const sampler = makeSampler(['/health'], undefined, 0.5)
      expect(sampler(ctx({ name: '/api/data' }))).toBe(0.5)
    })

    it('custom sampler return value overrides sampleRate', () => {
      const custom = (c: ReturnType<typeof ctx>) => {
        if (c.attributes?.['customer.id'] === '84') return 0
        return undefined
      }
      const sampler = makeSampler([], custom, 0.5)
      expect(sampler(ctx({ attributes: { 'customer.id': '84' } }))).toBe(0)
      expect(sampler(ctx({ attributes: { 'customer.id': '1' } }))).toBe(0.5)
    })

    it('custom sampler returning undefined falls back to sampleRate', () => {
      const custom = () => undefined
      const sampler = makeSampler([], custom, 0.75)
      expect(sampler(ctx({ name: '/api/data' }))).toBe(0.75)
    })

    it('ignoredRoutes check short-circuits before custom sampler is called', () => {
      const custom = vi.fn(() => 1.0 as number | undefined)
      const sampler = makeSampler(['/health'], custom, 0.5)
      expect(sampler(ctx({ name: '/health' }))).toBe(0)
      expect(custom).not.toHaveBeenCalled()
    })

    it('custom sampler can return fractional sample rates', () => {
      const custom = (c: ReturnType<typeof ctx>) => {
        if (c.attributes?.['tier'] === 'premium') return 1.0
        return 0.1
      }
      const sampler = makeSampler([], custom, 0.5)
      expect(sampler(ctx({ attributes: { tier: 'premium' } }))).toBe(1.0)
      expect(sampler(ctx({ attributes: { tier: 'free' } }))).toBe(0.1)
    })
  })
})
