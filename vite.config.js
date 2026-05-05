import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_APP_CAPACITOR ? '/' : '/parkeasy-mobile/',
  server: {
    port: 3000,
    open: true,
  },
})
