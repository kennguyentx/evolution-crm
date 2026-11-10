import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json so tests can import
    // the same way app code does (e.g. `@/lib/schemas`).
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Pure-function / thin-handler tests only: no database, no running app,
    // no network. Keep the suite fast and hermetic.
    include: ['lib/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
})
