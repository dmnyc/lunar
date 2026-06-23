import { boot } from 'quasar/wrappers'

// The 2022 lunar shipped as a PWA with a skipWaiting service worker. After the
// Vite overhaul we run in SPA mode (no SW), but a service worker registered by
// a previous visit persists and keeps intercepting requests — serving the old,
// now-incompatible cached shell, which shows up as a blank screen.
//
// Proactively tear down any leftover service worker + its caches on boot so the
// app always loads the live bundle. (When we re-enable PWA in Phase 6 this boot
// file should be removed.)
export default boot(async () => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    if (registrations.length) {
      await Promise.all(registrations.map((r) => r.unregister()))
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      // A controlling SW only stops intercepting after a reload.
      if (navigator.serviceWorker.controller) {
        window.location.reload()
      }
    }
  } catch (err) {
    console.warn('[unregister-sw] failed to clean up old service worker', err)
  }
})
