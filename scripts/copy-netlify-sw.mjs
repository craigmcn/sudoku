// vite-plugin-pwa's generateSW strategy writes sw.js/workbox-*.js directly to
// build.outDir ('netlify/') rather than through rollupOptions.output, so the
// netlify/sudoku/ (GitHub Pages) copy never gets one from the build itself.
// Everything else in that directory is already byte-identical between the
// two outputs (same base: './'), so copying the service worker files across
// is sufficient rather than trying to make the plugin build twice.
import { copyFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = 'netlify'
const DEST_DIR = 'netlify/sudoku'

const swFiles = readdirSync(SRC_DIR).filter(
  (name) => name === 'sw.js' || /^workbox-.*\.js$/.test(name),
)

if (swFiles.length === 0) {
  throw new Error(`No service worker files found in ${SRC_DIR}/ to copy`)
}

// Workbox aborts the whole install if any precache URL 404s, so a nested
// sudoku/ entry here silently disables offline support on the /sudoku/ copy.
// The index.html check makes a Workbox output-format change fail loudly
// instead of letting the nested-path check quietly match nothing.
const swSource = readFileSync(join(SRC_DIR, 'sw.js'), 'utf8')
if (!/url:\s*["']index\.html["']/.test(swSource)) {
  throw new Error('sw.js precache manifest format not recognised; update this check')
}
const nested = swSource.match(/url:\s*["']sudoku\/[^"']*["']/g)
if (nested) {
  throw new Error(`sw.js precaches nested sudoku/ paths: ${nested.join(', ')}`)
}

for (const file of swFiles) {
  copyFileSync(join(SRC_DIR, file), join(DEST_DIR, file))
  console.log(`Copied ${file} → ${DEST_DIR}/`)
}
