import { rmSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const samplesDir = fileURLToPath(new URL('./dist/samples', import.meta.url))

function omitDevSamples() {
  return {
    name: 'omit-dev-samples',
    apply: 'build' as const,
    closeBundle() {
      rmSync(samplesDir, { recursive: true, force: true })
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), omitDevSamples()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
