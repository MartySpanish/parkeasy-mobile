import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { inject } from '@vercel/analytics'

// Vercel Web Analytics — visitor/page-view tracking, viewable in the Vercel
// dashboard (parkeasy project → Analytics). No-ops outside Vercel hosting.
if (!window.Capacitor && /(vercel\.app|parkeasy\.uk)$/.test(location.hostname)) inject()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register service worker for PWA / offline support (skip inside Capacitor native app)
if ('serviceWorker' in navigator && !window.Capacitor) {
  window.addEventListener('load', () => {
    // If a controller already exists, this page is controlled by an older SW.
    // When a new SW takes over (controllerchange), reload once so the user
    // immediately sees the latest deployed build instead of a cached version.
    const hadController = !!navigator.serviceWorker.controller
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; window.location.reload() }
    })

    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => { reg.update?.() })
      .catch(() => {})
  })
}
