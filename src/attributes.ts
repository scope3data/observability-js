import { SpanStatusCode } from '@opentelemetry/api'

import type { Span, SpanAttributes } from './types'

/**
 * Set multiple attributes on a span in one call. `undefined` values are
 * silently skipped.
 *
 * @param span - The span to annotate.
 * @param attributes - Key-value pairs to set. Keys with `undefined` values are ignored.
 */
export function setSpanAttributes(
  span: Span,
  attributes: SpanAttributes,
): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value)
    }
  }
}

/**
 * Mark a span as representing a tool-level error result (distinct from an
 * unhandled exception). Sets the `mcp.tool.result.is_error` attribute and,
 * when `isError` is `true`, sets the span status to `ERROR`.
 *
 * @param span - The span to update.
 * @param isError - Whether the tool result is an error.
 */
export function setSpanError(span: Span, isError: boolean): void {
  span.setAttribute('mcp.tool.result.is_error', isError)
  if (isError) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'error' })
  }
}
