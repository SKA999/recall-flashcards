// Media blobs live in IndexedDB; the UI needs object URLs. Cache them per id so
// the same image isn't re-created on every render.

import { useEffect, useState } from 'react'
import { idbStore } from './idb'

export interface ResolvedMedia {
  id: string
  url: string
  mime: string
  name: string
}

const cache = new Map<string, ResolvedMedia>()
const inflight = new Map<string, Promise<ResolvedMedia | undefined>>()

function load(id: string): Promise<ResolvedMedia | undefined> {
  const cached = cache.get(id)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(id)
  if (pending) return pending
  const p = idbStore.getMedia(id).then((item) => {
    inflight.delete(id)
    if (!item) return undefined
    const resolved: ResolvedMedia = {
      id,
      url: URL.createObjectURL(item.blob),
      mime: item.mime,
      name: item.name,
    }
    cache.set(id, resolved)
    return resolved
  })
  inflight.set(id, p)
  return p
}

export function forgetMedia(id: string) {
  const item = cache.get(id)
  if (item) URL.revokeObjectURL(item.url)
  cache.delete(id)
}

/** Resolve a media id to a usable URL. Undefined while loading, or if missing. */
export function useMedia(id: string): ResolvedMedia | undefined {
  const [item, setItem] = useState(() => cache.get(id))
  useEffect(() => {
    const cached = cache.get(id)
    if (cached) {
      setItem(cached)
      return
    }
    let alive = true
    load(id).then((m) => {
      if (alive) setItem(m)
    })
    return () => {
      alive = false
    }
  }, [id])
  return item
}

export function mediaKind(mime: string): 'image' | 'audio' | 'video' | 'other' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'other'
}
