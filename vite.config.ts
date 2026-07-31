import { defineConfig } from 'vite'
import { pwaPlugin } from './vite-pwa.config'

export default defineConfig({
  base: './',
  server: {
    port: 3110,
  },
  plugins: [pwaPlugin()],
})
