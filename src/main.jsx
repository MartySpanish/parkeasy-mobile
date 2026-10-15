import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { inject } from '@vercel/analytics'
import { refreshPushSubscription, savePushSubscription } from './push'

// Vercel Web Analytics — visitor/page-view tracking, viewable in the Vercel
// dashboard (parkeasy project → Analytics). No-ops outside Vercel hosting.
// The Android app (Capacitor) loads the live parkeasy.uk site, so its hostname
// passes this test and its visits are counted alongside the web — that is
// deliberate: an install that is never opened is what the store numbers hide.
if (/(vercel\.app|parkeasy\.uk)$/.test(location.hostname)) inject()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register service worker for PWA / offline support. Skipped inside the
// Capacitor native app: the Android WebView cannot deliver web push, and a
// worker that reloads the page on takeover fights the native shell's own
// lifecycle. Native push is a later step (see docs/ANDROID_RELEASE.md).
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

    // Keep an existing push subscription alive. This NEVER prompts — it only
    // re-saves a subscription the browser already holds, because an endpoint
    // the push service has rotated is one we cannot reach any more and the
    // only symptom is silence. See src/push.js.
    refreshPushSubscription().catch(() => {})
    // The worker re-subscribes on its own when the push service retires an
    // endpoint, then hands the new one to whichever page is open. Without this
    // listener that message goes nowhere and the new endpoint is never stored.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push-subscription-changed' && e.data.subscription) {
        savePushSubscription(e.data.subscription).catch(() => {})
      }
    })
  })
}
