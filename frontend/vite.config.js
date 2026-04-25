import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8787'
const frontendRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  build: {
    outDir: path.join(frontendRoot, 'dist'),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget
    }
  }
})
