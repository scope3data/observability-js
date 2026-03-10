import * as Sentry from '@sentry/node'

import type { MCPSpanContext } from './types'

function truncateForSentry(value: unknown, maxLength: number): string {
  if (value === undefined) return ''
  const str = JSON.stringify(value)
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength - 3)}...`
}

/**
 * Capture an error thrown during an MCP tool invocation and report it to Sentry.
 *
 * `toolName` and `sessionId` are attached as Sentry tags (indexed, searchable).
 * `customerId`, `company`, and `args` are attached as extra context.
 * `args` is JSON-serialised and truncated to 2000 characters to stay within
 * Sentry's payload limits.
 *
 * @param error - The error to report.
 * @param toolName - Name of the MCP tool that threw.
 * @param context - MCP session/customer context, plus optional tool arguments.
 */
export function captureToolError(
  error: unknown,
  toolName: string,
  context: MCPSpanContext & { args?: unknown },
): void {
  Sentry.captureException(error, {
    tags: {
      'mcp.tool.name': toolName,
      'mcp.session.id': context.sessionId,
      'customer.id': context.customerId
        ? String(context.customerId)
        : undefined,
    },
    extra: {
      customerId: context.customerId,
      company: context.company,
      toolArguments:
        context.args !== undefined
          ? truncateForSentry(context.args, 2000)
          : undefined,
    },
  })
}

/**
 * Capture a general service error and report it to Sentry.
 *
 * `serviceName`, `sessionId`, and `customerId` are attached as Sentry tags
 * (indexed, searchable). All remaining `context` fields are attached as extra
 * context.
 *
 * @param error - The error to report.
 * @param serviceName - Name of the service or component where the error originated.
 * @param context - Additional context to attach. `customerId` and `sessionId`
 *   are promoted to tags; all other keys are included as extras.
 */
export function captureServiceError(
  error: unknown,
  serviceName: string,
  context: {
    customerId?: number
    sessionId?: string
    [key: string]: unknown
  },
): void {
  const { customerId, sessionId, ...extra } = context
  Sentry.captureException(error, {
    tags: {
      service: serviceName,
      'mcp.session.id': sessionId,
      'customer.id': customerId ? String(customerId) : undefined,
    },
    extra: {
      customerId,
      ...extra,
    },
  })
}
