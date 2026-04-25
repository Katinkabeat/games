import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SQ doubles as the dev-origin host: visiting localhost:8080/games/ runs SQ,
// and /wordy/ + /rungles/ are proxied to the sibling apps' dev servers so
// all three live under one origin and share a single Supabase session via
// localStorage — mirroring production at katinkabeat.github.io.
export default defineConfig({
  plugins: [react()],
  base: '/games/',
  server: {
    port: 8080,
    host: true,
    proxy: {
      '/wordy': {
        target: 'http://localhost:5181',
        changeOrigin: true,
        ws: true,
      },
      '/rungles': {
        target: 'http://localhost:5176',
        changeOrigin: true,
        // Python http.server doesn't know about the /rungles/ path prefix
        // (it just serves files from the rungles directory), so we strip
        // the prefix before forwarding. Wordy doesn't need this because
        // its Vite is configured with base: '/wordy/'.
        rewrite: (path) => path.replace(/^\/rungles/, ''),
      },
    },
  },
});
