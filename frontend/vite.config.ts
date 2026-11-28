import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Modes (see package.json scripts):
// - "mock": uses the built-in demonstration data (no backend needed).
// - default: calls the REST API at /api/v1, proxied to the Express server.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin for the browser (ADR-0003, ADR-0005).
      '/api': { target: 'http://127.0.0.1:3000' },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    // Globals let Testing Library register its automatic cleanup after each test.
    globals: true,
    restoreMocks: true,
  },
});
