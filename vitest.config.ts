import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { cortico: fileURLToPath(new URL('../BOT/src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000, pool: 'forks' },
});
