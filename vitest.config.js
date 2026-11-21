import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests boot real PGlite (WASM Postgres), which is slow on shared CI runners.
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
