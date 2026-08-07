import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa'

// Shared between vite.config.ts (dist/) and vite.config.netlify.ts (netlify/,
// netlify/sudoku/) so both build outputs get the same manifest/service worker
// behavior rather than drifting apart. `base: './'` in both configs keeps
// every generated URL relative, which is what makes the same manifest work
// whether the app is served from a domain root (Netlify) or a /sudoku/
// subdirectory (GitHub Pages).
export function pwaPlugin(): ReturnType<typeof VitePWA> {
  const options: Partial<VitePWAOptions> = {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Sudoku',
      short_name: 'Sudoku',
      description:
        'A browser-based Sudoku game with four difficulty levels, pencil marks, undo, hints, and a timer.',
      theme_color: '#005b99',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: '.',
      scope: '.',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: 'icons/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      // The albertcss stylesheet (which itself @imports the Outfit font from
      // Google Fonts) and the Font Awesome kit script are loaded from CDNs
      // (see index.html) and drive most of this app's visual styling —
      // without them cached, an offline reload would still be playable but
      // would lose fonts/colors/icons. CacheFirst is safe here since these
      // are versioned/pinned URLs that don't change without a code change.
      // Font Awesome's kit script fetches its actual icon data from a
      // per-account subdomain (observed as ka-p.fontawesome.com, "p" for
      // this account's Pro kit) rather than kit.fontawesome.com itself, so
      // the pattern below matches any *.fontawesome.com subdomain.
      runtimeCaching: [
        {
          urlPattern: /^https:\/\/albertcss\.craigmcn\.com\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'albertcss-cdn',
            expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
        {
          urlPattern: /^https:\/\/([a-z0-9-]+\.)?fontawesome\.com\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'fontawesome-cdn',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'google-fonts',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
    },
  }

  return VitePWA(options)
}
