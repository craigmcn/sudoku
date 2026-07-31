import { defineConfig } from 'vite'
import { pwaPlugin } from './vite-pwa.config'

export default defineConfig({
  base: './',
  plugins: [pwaPlugin()],
  build: {
    // vite-plugin-pwa's generateSW writes sw.js/workbox-*.js straight to
    // build.outDir via fs, not through rollupOptions.output — without this,
    // it defaults to 'dist' and both directories below end up missing a
    // service worker. scripts/copy-netlify-sw.mjs (run after this build via
    // the build:netlify script) duplicates it into netlify/sudoku/.
    outDir: 'netlify',
    rollupOptions: {
      output: [
        { dir: 'netlify' },
        { dir: 'netlify/sudoku' }, // For Netlify subdirectory
      ],
    },
  },
})
