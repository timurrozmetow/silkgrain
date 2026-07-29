import { defineConfig } from 'tsup';

export default defineConfig({
  // `money` is a second entry point so the browser can import the value object without
  // pulling in Zod and every schema module along with it.
  entry: ['src/index.ts', 'src/money.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
