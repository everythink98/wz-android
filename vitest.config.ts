import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    pool: 'forks',
    maxWorkers: 2,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'tests/integration/**/*.test.tsx',
      'tests/tooling/**/*.test.ts',
      'tests/tooling/**/*.test.tsx'
    ],
    exclude: ['node_modules', 'android', '.expo', '.expo-shared']
  }
});
