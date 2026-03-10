export { SpanStatusCode } from '@opentelemetry/api'

export { setSpanAttributes, setSpanError } from './attributes'
export { captureServiceError, captureToolError } from './errors'
export { init, resetForTesting } from './provider'
export {
  getTracer,
  startManualSpan,
  startMCPToolSpan,
  startSpan,
} from './spans'
export type {
  MCPSpanContext,
  ObservabilityConfig,
  Span,
  SpanAttributes,
} from './types'
