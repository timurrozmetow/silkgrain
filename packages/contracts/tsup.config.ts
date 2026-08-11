import { defineConfig } from 'tsup';

export default defineConfig({
  // `money` and `constants` are separate entry points so the browser can import a value object
  // and a couple of literals without pulling in Zod and every schema module along with them.
  entry: ['src/index.ts', 'src/money.ts', 'src/constants.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
