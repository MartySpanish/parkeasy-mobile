import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Baked in at build time — every deployment self-identifies in the footer
  // and admin dashboard so it's obvious which version is live.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [react()],
  base: '/',
  server: {
    port: 3000,
    open: true,
  },
})
