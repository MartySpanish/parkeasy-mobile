import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Baked in at build time — every deployment self-identifies in the footer
  // and admin dashboard so it's obvious which version is live.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react()],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        // ── WHY SPLIT AT ALL ─────────────────────────────────────────────────
        // The app shipped as one 1,450 kB chunk and Vite warned about it on
        // every build. Splitting does not remove a byte — it changes WHEN the
        // bytes are paid for.
        //
        // 1. CACHING. A deploy that touches App.jsx used to invalidate React,
        //    Leaflet, Supabase and every icon along with it, so a returning
        //    visitor re-downloaded ~1.4 MB to get a copy change. These four
        //    libraries move when their versions move — a handful of times a
        //    year — so once they are their own files a code deploy invalidates
        //    only the app chunk.
        // 2. PARALLELISM. Five files fetch concurrently on one connection
        //    where one file is strictly serial.
        //
        // WHAT THIS IS NOT. It is not lazy loading: everything still loads on
        // first paint. Deferring Leaflet until the map opens would be the
        // bigger win and is a real refactor of App.jsx, not a config change,
        // so it is deliberately not bundled in with this.
        //
        // Grouped by what changes together, NOT one chunk per package: twenty
        // tiny chunks cost more in requests than they save in cache hits.
        // CoverageGlobe and CorporateScreen are already route-split by dynamic
        // import and are untouched by this.
        manualChunks: {
          // React moves least of all and is needed before anything else.
          //
          // jsx-runtime AND dom/client are named explicitly: listing only
          // 'react' and 'react-dom' produced a 0.0 kB vendor-react chunk,
          // because the plugin's automatic JSX transform imports
          // react/jsx-runtime and the entry imports react-dom/client, so every
          // actual byte of React stayed in the app chunk and the split bought
          // an extra request for nothing.
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
          // Leaflet is the single largest dependency and only the map uses it.
          //
          // react-leaflet is DELIBERATELY NOT HERE. Naming it dragged React's
          // core into vendor-map — the built vendor-react chunk came out at
          // 1 kB and began with `import{c,r}from"./vendor-map"`, which means a
          // Leaflet version bump would have invalidated React and the grouping
          // was backwards. react-leaflet is a thin React binding; left
          // unnamed it stays with the app code that uses it and React
          // separates cleanly.
          'vendor-map': ['leaflet'],
          // The data client: used everywhere, versioned independently.
          'vendor-supabase': ['@supabase/supabase-js'],
          // Icons are many small modules that tree-shake into one blob.
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
