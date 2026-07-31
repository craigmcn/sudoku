// vite-plugin-pwa's generateSW strategy writes sw.js/workbox-*.js directly to
// build.outDir ('netlify/') rather than through rollupOptions.output, so the
// netlify/sudoku/ (GitHub Pages) copy never gets one from the build itself.
// Everything else in that directory is already byte-identical between the
// two outputs (same base: './'), so copying the service worker files across
// is sufficient rather than trying to make the plugin build twice.
import { copyFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = 'netlify'
const DEST_DIR = 'netlify/sudoku'

const swFiles = readdirSync(SRC_DIR).filter(
  (name) => name === 'sw.js' || /^workbox-.*\.js$/.test(name),
)

if (swFiles.length === 0) {
  throw new Error(`No service worker files found in ${SRC_DIR}/ to copy`)
}

for (const file of swFiles) {
  copyFileSync(join(SRC_DIR, file), join(DEST_DIR, file))
  console.log(`Copied ${file} → ${DEST_DIR}/`)
}
