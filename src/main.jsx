import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register service worker for PWA / offline support (skip inside Capacitor native app)
if ('serviceWorker' in navigator && !window.Capacitor) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/parkeasy-mobile/sw.js')
      .catch(() => {})
  })
}
