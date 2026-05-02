import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/{{slug}}/',
  server: {
    port: {{port}},
    strictPort: true,
  },
})
