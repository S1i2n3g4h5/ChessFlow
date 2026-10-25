import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The game rules and the room store are plain TypeScript, so a Node environment is all the tests need.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
