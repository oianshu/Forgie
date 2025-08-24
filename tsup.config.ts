import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'scripts/register-commands.ts'],
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
  clean: true,
  target: 'node18',
  format: ['esm'],
  dts: true,
});
