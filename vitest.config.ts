import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'lcov'],
    },
    include: ['tests/**/*.test.ts']
  },
});
