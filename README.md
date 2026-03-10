# @scope3/observability-js

Unified observability for Scope3 Node.js services. A single `init()` call wires up [Sentry](https://sentry.io) (error monitoring, tracing, and profiling), [Pyroscope](https://pyroscope.io) (continuous CPU and heap profiling), and optionally the [OpenTelemetry](https://opentelemetry.io) SDK with OTLP trace export.

## Installation

```sh
npm install @scope3/observability-js
```

Requires Node.js >= 24.

## Quick start

Call `init()` once at process startup, before anything else runs:

```ts
import { init } from '@scope3/observability-js'

init({
  serviceName: 'my-service',
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
})
```

`environment` defaults to `NODE_ENV` and `release` defaults to `COMMIT_SHA`, so in most Scope3 deployments those fields can be omitted.

## Configuration

All options are passed to `init()` as an `ObservabilityConfig` object.

### Top-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `serviceName` | `string` | — | **Required.** Identifies this service in Sentry, Pyroscope, and OTLP traces. |
| `environment` | `string` | `NODE_ENV \|\| 'development'` | Deployment environment. |
| `release` | `string` | `COMMIT_SHA \|\| 'unknown'` | Release identifier attached to Sentry events and traces. |
| `enableOtel` | `boolean` | `false` | Enable the OpenTelemetry SDK. Required when using OTLP export or the tracing helpers. |
| `tracerName` | `string` | `serviceName` | Name used to obtain the OTel tracer instance. |
| `sentry` | `SentryConfig` | — | Sentry configuration. See below. |
| `pyroscope` | `PyroscopeConfig` | — | Pyroscope configuration. See below. |
| `otlp` | `OtlpConfig` | — | OTLP trace export configuration. See below. |
| `filters` | `FilterConfig` | — | Filtering rules for traces, errors, and breadcrumbs. See below. |
| `shouldDropError` | `(error: unknown) => boolean` | — | Predicate to suppress specific errors from Sentry. Return `true` to drop. |

### `SentryConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `dsn` | `string` | — | Sentry DSN. Required for Sentry to activate in deployed environments. |
| `enabled` | `boolean` | auto | Override automatic enable/disable logic. By default Sentry is enabled when a DSN is present and the environment is `production` or `staging`. |
| `sampleRate` | `number` | `0.25` (prod), `1.0` (other) | Fraction of transactions sent to Sentry, between 0 and 1. |
| `profileSampleRate` | `number` | `sampleRate` | Fraction of sampled transactions to profile, between 0 and 1. |

### `PyroscopeConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | auto | Override automatic enable/disable logic. By default Pyroscope is enabled in `production` and `staging`. |
| `serverAddress` | `string` | in-cluster address (deployed), `http://localhost:4040` (local) | Pyroscope server address. |
| `tags` | `Record<string, string>` | `{}` | Additional tags attached to all profiles. `environment` is always included automatically. |

### `OtlpConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `endpoint` | `string` | — | OTLP collector endpoint (e.g. `http://otel-collector:4318`). OTLP export is disabled when omitted. |
| `headers` | `Record<string, string>` | `{}` | HTTP headers sent with every export request. |
| `sampleRate` | `number` | `1.0` | Fraction of traces to export via OTLP, between 0 and 1. |

### `FilterConfig`

| Field | Type | Default | Description |
|---|---|---|---|
| `ignoredRoutes` | `string[]` | `[]` | Routes never sampled by Sentry (e.g. `['/health', '/metrics']`). Trailing slashes and query strings are handled automatically. |
| `ignoredBreadcrumbCategories` | `string[]` | `['http', 'fetch', 'xhr']` | Breadcrumb categories to apply URL-pattern filtering to. |
| `ignoredBreadcrumbPatterns` | `RegExp[]` | Pyroscope + PostHog patterns | URL patterns for breadcrumbs that should be dropped entirely. |

## API

### Initialization

#### `init(config: ObservabilityConfig): void`

Initialize Sentry, Pyroscope, and (optionally) the OpenTelemetry SDK. Idempotent — subsequent calls are no-ops.

In `test` environments (`NODE_ENV=test`) all instrumentation is skipped and only the config is resolved, so tests remain fast and side-effect free.

```ts
init({
  serviceName: 'my-service',
  enableOtel: true,
  sentry: { dsn: process.env.SENTRY_DSN },
  otlp: { endpoint: process.env.OTLP_ENDPOINT },
  filters: {
    ignoredRoutes: ['/health', '/health/liveness', '/metrics'],
  },
  shouldDropError: (error) =>
    error instanceof MyClientError && error.code === 'NOT_FOUND',
})
```

#### `resetForTesting(): void`

Reset the initialized state so `init()` can be called again. For use in test teardown only — do not call in production code.

```ts
afterEach(() => {
  resetForTesting()
})
```

### Tracing

All tracing helpers require `enableOtel: true` in the config passed to `init()`.

#### `startSpan<T>(op, name, attributes, callback): Promise<T>`

Start a generic active span. Automatically sets status to `OK` on success, records the exception and sets status to `ERROR` on failure, and always ends the span.

```ts
const result = await startSpan('db.query', 'fetch user', { 'db.table': 'users' }, async (span) => {
  const user = await db.findUser(id)
  setSpanAttributes(span, { 'user.id': user.id })
  return user
})
```

#### `startMCPToolSpan<T>(toolName, context, callback): Promise<T>`

Start an active span for an MCP tool invocation. Automatically attaches `mcp.tool.name`, `mcp.session.id`, `mcp.transport`, `customer.id`, and `customer.company` as span attributes. Same automatic status and lifecycle management as `startSpan`.

```ts
const result = await startMCPToolSpan('search_campaigns', { sessionId, customerId, company }, async (span) => {
  return await searchCampaigns(args)
})
```

#### `startManualSpan(op, name, attributes): Span`

Start a span whose lifecycle is managed by the caller. Use this for streaming operations (e.g. SSE) where the work outlives a single async callback. The caller must call `span.end()` and set the span status.

Unlike `startSpan` and `startMCPToolSpan`, this creates a non-active span — child operations will not automatically inherit it as their parent.

```ts
const span = startManualSpan('http.server', 'stream response', { 'stream.id': id })

stream.on('end', () => {
  span.setStatus({ code: SpanStatusCode.OK })
  span.end()
})

stream.on('error', (err) => {
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
  span.end()
})
```

### Span utilities

#### `setSpanAttributes(span, attributes): void`

Set multiple attributes on a span in one call. `undefined` values are silently skipped.

```ts
setSpanAttributes(span, {
  'customer.id': customerId,
  'request.size': body?.length,
})
```

#### `setSpanError(span, isError): void`

Mark a span as representing a tool-level error result — distinct from an unhandled exception. Sets the `mcp.tool.result.is_error` attribute and, when `true`, sets the span status to `ERROR`.

```ts
const response = await callTool(args)
setSpanError(span, response.isError)
```

### Error capture

#### `captureToolError(error, toolName, context): void`

Capture an error thrown during an MCP tool invocation and report it to Sentry. `toolName` and `sessionId` are attached as indexed Sentry tags. `customerId`, `company`, and `args` are attached as extra context. `args` is JSON-serialised and truncated to 2000 characters.

```ts
try {
  await runTool(args)
} catch (error) {
  captureToolError(error, 'search_campaigns', { sessionId, customerId, company, args })
  throw error
}
```

#### `captureServiceError(error, serviceName, context): void`

Capture a general service error and report it to Sentry. `serviceName`, `sessionId`, and `customerId` are attached as indexed tags. All remaining context fields are attached as extras.

```ts
captureServiceError(error, 'billing-service', {
  customerId,
  sessionId,
  invoiceId,
})
```

## Automatic behaviors

Several things happen without any additional configuration:

- **`JWTExpired` errors are silently dropped** from Sentry — expired tokens are expected and not actionable.
- **Pyroscope initialization failures are caught** — if Pyroscope fails to start, the error is reported to Sentry and the process continues normally.
- **Pyroscope and PostHog breadcrumbs are filtered** from Sentry by default via `filters.ignoredBreadcrumbPatterns`.
- **Test environments are inert** — when `NODE_ENV=test`, `init()` resolves the config but skips all instrumentation. No Sentry, no Pyroscope, no OTel side effects.
- **Pyroscope wall-clock and heap profiling** are both enabled by default (`collectCpuTime: true`, heap sampling every 512 KB).
- **OTLP spans are batched** with a max batch size of 512, a 5-second flush interval, and a 30-second export timeout.

## Environment variables

| Variable | Description |
|---|---|
| `NODE_ENV` | Determines the environment when `config.environment` is omitted. `production` and `staging` activate Sentry and Pyroscope automatically. |
| `COMMIT_SHA` | Used as the `release` identifier when `config.release` is omitted. |

## Contributing

This package is open source under the [MIT License](./LICENSE). Contributions are welcome via pull request against the `main` branch.

Before submitting a PR, make sure the following pass locally:

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

### Releasing

Releases are automated. When a pull request is merged to `main` with a bumped version in `package.json`, the release workflow will:

1. Compare the new version against the latest git tag using semver
2. If the version is greater, create a git tag, a GitHub Release, and publish to npm
3. Prerelease versions (`alpha`, `beta`, `rc`) are published to the `next` npm tag; stable versions to `latest`

## License

[MIT](./LICENSE) - Copyright (c) 2026 Scope3 Data, Inc.
