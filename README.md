# @scope3/observability-js

Observability utilities for Node.js applications, published by [Scope3](https://scope3.com).

## Installation

```sh
npm install @scope3/observability-js
```

## Usage

```ts
import {} from '@scope3/observability-js'
```

> More documentation will be added as the package evolves.

## Contributing

This package is open source under the [MIT License](./LICENSE). Contributions are welcome via pull request against the `main` branch.

Before submitting a PR, make sure the following pass locally:

```sh
npm run build
npm run typecheck
npm run lint
```

### Releasing

Releases are automated. When a pull request is merged to `main` with a bumped version in `package.json`, the release workflow will:

1. Compare the new version against the latest git tag using semver
2. If the version is greater, create a git tag, a GitHub Release, and publish to npm
3. Prerelease versions (`alpha`, `beta`, `rc`) are published to the `next` npm tag; stable versions to `latest`

## License

[MIT](./LICENSE) - Copyright (c) 2026 Scope3 Data, Inc.
