import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundling workspace packages keeps the production image free of the pnpm symlink tree.
  noExternal: [/^@silkgrain\//],
});
