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
        target: 'http://localhost:5183',
        changeOrigin: true,
        ws: true,
      },
      '/snibble': {
        target: 'http://localhost:5182',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
