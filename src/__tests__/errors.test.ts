import * as Sentry from '@sentry/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetConfig, resolveConfig } from '../config'
import { captureServiceError, captureToolError } from '../errors'

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}))

afterEach(() => {
  resetConfig()
  vi.clearAllMocks()
})

describe('captureToolError', () => {
  it('does not call Sentry when not initialized', () => {
    captureToolError(new Error('boom'), 'my-tool', {})
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('calls Sentry when initialized', () => {
    resolveConfig({ serviceName: 'test-service' })
    captureToolError(new Error('boom'), 'my-tool', { sessionId: 's1' })
    expect(Sentry.captureException).toHaveBeenCalledOnce()
  })
})

describe('captureServiceError', () => {
  it('does not call Sentry when not initialized', () => {
    captureServiceError(new Error('boom'), 'my-service', {})
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('calls Sentry when initialized', () => {
    resolveConfig({ serviceName: 'test-service' })
    captureServiceError(new Error('boom'), 'my-service', { customerId: 1 })
    expect(Sentry.captureException).toHaveBeenCalledOnce()
  })
})
