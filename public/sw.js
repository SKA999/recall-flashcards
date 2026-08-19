// Offline support. Deliberately hand-written: the asset set is small and a
// build-time precache manifest would need a plugin for very little gain.
//
// Bump CACHE whenever this file changes — the old cache is dropped on activate.

const CACHE = 'recall-v1'

/** The one URL a cold offline start needs. Hashed assets are cached on use.
 *  Relative, so the app works when served from a subpath. */
const SHELL = './index.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone())
  return response
}

/**
 * Navigations go to the network first so a deploy is picked up immediately,
 * and fall back to the cached shell when offline.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) (await caches.open(CACHE)).put(SHELL, response.clone())
    return response
  } catch {
    const cached = await caches.match(SHELL)
    if (cached) return cached
    throw new Error('offline and no cached shell')
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // Vite's built assets carry a content hash, so a hit is always correct.
  event.respondWith(cacheFirst(request))
})
