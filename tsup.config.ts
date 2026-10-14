import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  // tsup's dts build injects `baseUrl`, which TypeScript 6 deprecates.
  // ponytail: breaks on TypeScript 7; move to tsdown before that upgrade.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
})
