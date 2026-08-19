// Chooses where data lives. IndexedDB normally; memory when the browser won't
// give us IndexedDB at all (private browsing, storage disabled, sandboxed frame).

import type { Store } from '../core/storage'
import { idbStore } from './idb'
import { createMemoryStore } from './memory'

let active: Store = idbStore
let durable = true

/** The store the app should use. Valid only after `selectBackend` resolves. */
export function backend(): Store {
  return active
}

/** False when data lives in memory and will not survive a reload. */
export function isDurable(): boolean {
  return durable
}

/**
 * Probe IndexedDB once at startup. A failure here is not an error condition —
 * it just means the app runs without persistence, which is better than
 * refusing to start.
 */
export async function selectBackend(): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB')
    await idbStore.listDecks()
    active = idbStore
    durable = true
  } catch {
    active = createMemoryStore()
    durable = false
  }
}
