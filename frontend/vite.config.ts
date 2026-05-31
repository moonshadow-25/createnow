import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

const versionFile = path.resolve(__dirname, '../version.json')
const versionInfo = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(versionInfo.version || 'unknown'),
    __APP_RELEASE_DATE__: JSON.stringify(versionInfo.release_date || ''),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
})
