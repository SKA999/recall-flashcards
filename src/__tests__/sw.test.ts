// The service worker can't be registered in a headless/preview browser, so its
// caching logic is exercised here against a fake ServiceWorkerGlobalScope.
// This covers the parts that actually break; registration itself is browser
// plumbing.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8')

/** Only the shape sw.js touches: method, url and mode. */
interface FakeRequest {
  method: string
  url: string
  mode: string
}

const keyOf = (request: FakeRequest | string) =>
  typeof request === 'string' ? request : request.url

class FakeCache {
  entries = new Map<string, Response>()
  async add(url: string) {
    this.entries.set(url, new Response('shell', { status: 200 }))
  }
  async put(request: FakeRequest | string, response: Response) {
    this.entries.set(keyOf(request), response)
  }
  async match(request: FakeRequest | string) {
    return this.entries.get(keyOf(request))
  }
}

class FakeCacheStorage {
  stores = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }
  async keys() {
    return [...this.stores.keys()]
  }
  async delete(name: string) {
    return this.stores.delete(name)
  }
  async match(request: FakeRequest | string) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(request)
      if (hit) return hit
    }
    return undefined
  }
}

interface Harness {
  handlers: Record<string, (event: any) => void>
  caches: FakeCacheStorage
  fetch: ReturnType<typeof vi.fn>
  skipWaiting: ReturnType<typeof vi.fn>
  claim: ReturnType<typeof vi.fn>
}

function load(): Harness {
  const handlers: Record<string, (event: any) => void> = {}
  const cacheStorage = new FakeCacheStorage()
  const fetchMock = vi.fn()
  const skipWaiting = vi.fn().mockResolvedValue(undefined)
  const claim = vi.fn().mockResolvedValue(undefined)

  const self = {
    addEventListener: (type: string, handler: (event: any) => void) => {
      handlers[type] = handler
    },
    location: new URL('http://localhost/sw.js'),
    skipWaiting,
    clients: { claim },
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('self', 'caches', 'fetch', SOURCE)(self, cacheStorage, fetchMock)
  return { handlers, caches: cacheStorage, fetch: fetchMock, skipWaiting, claim }
}

function lifecycleEvent() {
  const waits: Promise<unknown>[] = []
  return { event: { waitUntil: (p: Promise<unknown>) => waits.push(p) }, waits }
}

function fetchEvent(url: string, init: { mode?: string; method?: string } = {}) {
  let responded: Promise<Response> | undefined
  const request: FakeRequest = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }
  return {
    event: {
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p
      },
    },
    get responded() {
      return responded
    },
  }
}

describe('service worker lifecycle', () => {
  let h: Harness
  beforeEach(() => {
    h = load()
  })

  it('registers the three lifecycle handlers', () => {
    expect(Object.keys(h.handlers).sort()).toEqual(['activate', 'fetch', 'install'])
  })

  it('caches the app shell on install and takes over immediately', async () => {
    const { event, waits } = lifecycleEvent()
    h.handlers.install(event)
    await Promise.all(waits)
    const cache = await h.caches.open('recall-v1')
    expect(await cache.match('./index.html')).toBeTruthy()
    expect(h.skipWaiting).toHaveBeenCalled()
  })

  it('drops caches from previous versions on activate', async () => {
    await h.caches.open('recall-v0')
    await h.caches.open('recall-v1')
    const { event, waits } = lifecycleEvent()
    h.handlers.activate(event)
    await Promise.all(waits)
    expect(await h.caches.keys()).toEqual(['recall-v1'])
    expect(h.claim).toHaveBeenCalled()
  })
})

describe('service worker fetch handling', () => {
  let h: Harness
  beforeEach(async () => {
    h = load()
    const { event, waits } = lifecycleEvent()
    h.handlers.install(event)
    await Promise.all(waits)
  })

  it('ignores non-GET requests', () => {
    const f = fetchEvent('http://localhost/api', { method: 'POST' })
    h.handlers.fetch(f.event)
    expect(f.responded).toBeUndefined()
  })

  it('ignores cross-origin requests', () => {
    const f = fetchEvent('https://example.com/thing.js')
    h.handlers.fetch(f.event)
    expect(f.responded).toBeUndefined()
  })

  it('serves a hashed asset from the network once, then from cache', async () => {
    h.fetch.mockResolvedValue(new Response('asset', { status: 200 }))

    const first = fetchEvent('http://localhost/assets/index-abc123.js')
    h.handlers.fetch(first.event)
    expect(await (await first.responded!).text()).toBe('asset')
    expect(h.fetch).toHaveBeenCalledTimes(1)

    const second = fetchEvent('http://localhost/assets/index-abc123.js')
    h.handlers.fetch(second.event)
    expect(await (await second.responded!).text()).toBe('asset')
    // Still one — the second request was served from cache.
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed asset response', async () => {
    h.fetch.mockResolvedValue(new Response('nope', { status: 500 }))
    const f = fetchEvent('http://localhost/assets/missing.js')
    h.handlers.fetch(f.event)
    await f.responded
    const cache = await h.caches.open('recall-v1')
    expect(await cache.match('http://localhost/assets/missing.js')).toBeUndefined()
  })

  it('prefers the network for navigations so a deploy is picked up', async () => {
    h.fetch.mockResolvedValue(new Response('fresh page', { status: 200 }))
    const f = fetchEvent('http://localhost/', { mode: 'navigate' })
    h.handlers.fetch(f.event)
    expect(await (await f.responded!).text()).toBe('fresh page')
    expect(h.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the cached shell when the network is gone', async () => {
    h.fetch.mockRejectedValue(new TypeError('offline'))
    const f = fetchEvent('http://localhost/', { mode: 'navigate' })
    h.handlers.fetch(f.event)
    expect(await (await f.responded!).text()).toBe('shell')
  })

  it('refreshes the cached shell from a successful navigation', async () => {
    h.fetch.mockResolvedValue(new Response('newer shell', { status: 200 }))
    const online = fetchEvent('http://localhost/', { mode: 'navigate' })
    h.handlers.fetch(online.event)
    await online.responded

    h.fetch.mockRejectedValue(new TypeError('offline'))
    const offline = fetchEvent('http://localhost/', { mode: 'navigate' })
    h.handlers.fetch(offline.event)
    expect(await (await offline.responded!).text()).toBe('newer shell')
  })
})
