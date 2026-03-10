import { SpanStatusCode, trace } from '@opentelemetry/api'

import { getConfig } from './config'
import type { MCPSpanContext, Span, SpanAttributes } from './types'

function getTracer() {
  const config = getConfig()
  return trace.getTracer(config.tracerName)
}

/**
 * Start an active span for an MCP tool invocation.
 *
 * Automatically attaches MCP-specific attributes (`mcp.tool.name`,
 * `mcp.session.id`, `mcp.transport`, `customer.id`, `customer.company`) to the
 * span. On success the span status is set to `OK`; on error the exception is
 * recorded, the status is set to `ERROR`, and the error is re-thrown. The span
 * is always ended when the callback resolves or rejects.
 *
 * @param toolName - Name of the MCP tool being invoked.
 * @param context - MCP session and customer context to attach to the span.
 * @param callback - Async function that performs the tool work. Receives the active span.
 * @returns The resolved value of `callback`.
 */
export function startMCPToolSpan<T>(
  toolName: string,
  context: MCPSpanContext,
  callback: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    `tools/call ${toolName}`,
    {
      attributes: filterUndefined({
        'sentry.op': 'mcp.server',
        'mcp.tool.name': toolName,
        'mcp.session.id': context.sessionId,
        'mcp.transport': 'streamable-http',
        'network.transport': 'tcp',
        'customer.id': context.customerId,
        'customer.company': context.company,
      }),
    },
    async (span) => {
      try {
        const result = await callback(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.recordException(error as Error)
        throw error
      } finally {
        span.end()
      }
    },
  )
}

/**
 * Start a generic active span.
 *
 * On success the span status is set to `OK`; on error the exception is
 * recorded, the status is set to `ERROR`, and the error is re-thrown. The span
 * is always ended when the callback resolves or rejects.
 *
 * @param op - Sentry operation name (e.g. `'db.query'`, `'http.client'`).
 * @param name - Human-readable span name.
 * @param attributes - Additional span attributes to attach.
 * @param callback - Async function that performs the work. Receives the active span.
 * @returns The resolved value of `callback`.
 */
export function startSpan<T>(
  op: string,
  name: string,
  attributes: SpanAttributes,
  callback: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    name,
    {
      attributes: filterUndefined({
        ...attributes,
        'sentry.op': op,
      }),
    },
    async (span) => {
      try {
        const result = await callback(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        })
        span.recordException(error as Error)
        throw error
      } finally {
        span.end()
      }
    },
  )
}

/**
 * Start a span whose lifecycle is managed manually.
 *
 * Use this for fire-and-forget or streaming operations (e.g. SSE) where the
 * work outlives a single async callback. The caller is responsible for calling
 * `span.end()` and setting the span status.
 *
 * Unlike {@link startSpan} and {@link startMCPToolSpan}, this creates a
 * non-active span — child operations will not automatically inherit it as their
 * parent in the trace context.
 *
 * @param op - Sentry operation name (e.g. `'http.server'`).
 * @param name - Human-readable span name.
 * @param attributes - Additional span attributes to attach.
 * @returns The started (but not yet ended) span.
 */
export function startManualSpan(
  op: string,
  name: string,
  attributes: SpanAttributes,
): Span {
  const tracer = getTracer()
  return tracer.startSpan(name, {
    attributes: filterUndefined({
      ...attributes,
      'sentry.op': op,
    }),
  })
}

function filterUndefined(
  attributes: SpanAttributes,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}
