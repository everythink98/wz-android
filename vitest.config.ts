import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'expo-crypto': fileURLToPath(new URL('./test-stubs/expo-crypto.ts', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    pool: 'forks',
    maxWorkers: 2,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'android', '.expo', '.expo-shared']
  }
});
