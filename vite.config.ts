import { defineConfig } from 'vite';

// Client bundle. In dev, /socket.io is proxied to the TS server (tsx watch).
export default defineConfig({
  root: 'src/client',
  base: '/',
  publicDir: 'public',
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022'
  },
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:8080', ws: true },
      '/health': 'http://localhost:8080'
    }
  }
});
