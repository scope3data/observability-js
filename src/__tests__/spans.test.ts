import { trace } from '@opentelemetry/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTracer, startManualSpan, startMCPToolSpan, startSpan } from '../spans'
import { resetConfig, resolveConfig } from '../config'

afterEach(() => {
  resetConfig()
  vi.restoreAllMocks()
})

describe('getTracer', () => {
  it('does not throw when init() has not been called', () => {
    expect(() => getTracer()).not.toThrow()
  })

  it('returns a tracer when no name is given and init() has not been called', () => {
    const tracer = getTracer()
    expect(tracer).toBeDefined()
  })

  it('uses the provided name when given', () => {
    const spy = vi.spyOn(trace, 'getTracer')
    getTracer('my-library')
    expect(spy).toHaveBeenCalledWith('my-library')
  })

  it('uses the config tracerName after resolveConfig() has been called', () => {
    resolveConfig({ serviceName: 'test-service', tracerName: 'custom-tracer' })
    const spy = vi.spyOn(trace, 'getTracer')
    getTracer()
    expect(spy).toHaveBeenCalledWith('custom-tracer')
  })

  it('falls back to serviceName as tracerName when tracerName is not set', () => {
    resolveConfig({ serviceName: 'my-service' })
    const spy = vi.spyOn(trace, 'getTracer')
    getTracer()
    expect(spy).toHaveBeenCalledWith('my-service')
  })

  it('falls back to observability-js when no name and no config', () => {
    const spy = vi.spyOn(trace, 'getTracer')
    getTracer()
    expect(spy).toHaveBeenCalledWith('observability-js')
  })
})

describe('startSpan without init()', () => {
  it('executes the callback and returns its value', async () => {
    const result = await startSpan('op', 'name', {}, async () => 42)
    expect(result).toBe(42)
  })

  it('re-throws errors from the callback', async () => {
    await expect(
      startSpan('op', 'name', {}, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('uses the provided tracerName', async () => {
    const spy = vi.spyOn(trace, 'getTracer')
    await startSpan('op', 'name', {}, async () => {}, 'adcp-client')
    expect(spy).toHaveBeenCalledWith('adcp-client')
  })
})

describe('startMCPToolSpan without init()', () => {
  it('executes the callback and returns its value', async () => {
    const result = await startMCPToolSpan('my-tool', {}, async () => 'done')
    expect(result).toBe('done')
  })

  it('re-throws errors from the callback', async () => {
    await expect(
      startMCPToolSpan('my-tool', {}, async () => {
        throw new Error('tool error')
      }),
    ).rejects.toThrow('tool error')
  })

  it('uses the provided tracerName', async () => {
    const spy = vi.spyOn(trace, 'getTracer')
    await startMCPToolSpan('my-tool', {}, async () => {}, 'adcp-client')
    expect(spy).toHaveBeenCalledWith('adcp-client')
  })
})

describe('startManualSpan without init()', () => {
  it('returns a span without throwing', () => {
    expect(() => startManualSpan('op', 'name', {})).not.toThrow()
  })

  it('returns an object with end() and setStatus() methods', () => {
    const span = startManualSpan('op', 'name', {})
    expect(typeof span.end).toBe('function')
    expect(typeof span.setStatus).toBe('function')
  })

  it('uses the provided tracerName', () => {
    const spy = vi.spyOn(trace, 'getTracer')
    startManualSpan('op', 'name', {}, 'adcp-client')
    expect(spy).toHaveBeenCalledWith('adcp-client')
  })
})
