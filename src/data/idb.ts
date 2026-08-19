// IndexedDB implementation of the Store interface. Deliberately dependency-free
// so the whole persistence layer is one readable file.

import type { Store } from '../core/storage'
import type {
  Card,
  DayCounter,
  Deck,
  MediaItem,
  Note,
  ReviewLog,
  Tombstone,
  TombstoneKind,
} from '../core/types'

const DB_NAME = 'recall'
/** v2 added tombstones and the `updated` stamp used by sync. */
const DB_VERSION = 2

type StoreName = 'decks' | 'notes' | 'cards' | 'logs' | 'media' | 'counters' | 'tombstones'

/** Stores whose records carry an `updated` stamp. */
const STAMPED: StoreName[] = ['decks', 'notes', 'cards', 'media']

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      const tx = req.transaction!

      if (!db.objectStoreNames.contains('decks')) db.createObjectStore('decks', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' }).createIndex('deckId', 'deckId')
      }
      if (!db.objectStoreNames.contains('cards')) {
        const s = db.createObjectStore('cards', { keyPath: 'id' })
        s.createIndex('deckId', 'deckId')
        s.createIndex('noteId', 'noteId')
      }
      if (!db.objectStoreNames.contains('logs')) {
        const s = db.createObjectStore('logs', { keyPath: 'id' })
        s.createIndex('deckId', 'deckId')
        s.createIndex('reviewed', 'reviewed')
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' }).createIndex('deckId', 'deckId')
      }
      if (!db.objectStoreNames.contains('counters')) {
        db.createObjectStore('counters', { keyPath: 'id' }).createIndex('deckId', 'deckId')
      }
      if (!db.objectStoreNames.contains('tombstones')) {
        db.createObjectStore('tombstones', { keyPath: 'id' }).createIndex('deletedAt', 'deletedAt')
      }

      // Records written before v2 have no `updated`; backfill so a first sync
      // sees a real timestamp rather than undefined.
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const stamp = Date.now()
        for (const name of STAMPED) {
          const store = tx.objectStore(name)
          store.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result
            if (!cursor) return
            const value = cursor.value as { updated?: number; created?: number }
            if (value.updated == null) {
              cursor.update({ ...value, updated: value.created ?? stamp })
            }
            cursor.continue()
          }
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = open()
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function readAll<T>(name: StoreName, index?: string, key?: IDBValidKey): Promise<T[]> {
  const tx = (await db()).transaction(name, 'readonly')
  const store = tx.objectStore(name)
  const source = index && key !== undefined ? store.index(index) : store
  return request(source.getAll(index && key !== undefined ? key : undefined) as IDBRequest<T[]>)
}

async function put(name: StoreName, values: unknown[]): Promise<void> {
  const tx = (await db()).transaction(name, 'readwrite')
  const store = tx.objectStore(name)
  for (const v of values) store.put(v)
  await done(tx)
}

/**
 * Delete records and record a tombstone for each, in one transaction — a delete
 * that lands without its tombstone would be resurrected by the next sync.
 */
async function removeTracked(name: StoreName, kind: TombstoneKind, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return
  const tx = (await db()).transaction([name, 'tombstones'], 'readwrite')
  const store = tx.objectStore(name)
  const graves = tx.objectStore('tombstones')
  const deletedAt = Date.now()
  for (const k of keys) {
    store.delete(k)
    graves.put({ id: String(k), kind, deletedAt } satisfies Tombstone)
  }
  await done(tx)
}

/** Untracked delete, for device-local records sync never sees. */
async function remove(name: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return
  const tx = (await db()).transaction(name, 'readwrite')
  const store = tx.objectStore(name)
  for (const k of keys) store.delete(k)
  await done(tx)
}

async function keysByIndex(name: StoreName, index: string, key: IDBValidKey): Promise<IDBValidKey[]> {
  const tx = (await db()).transaction(name, 'readonly')
  return request(tx.objectStore(name).index(index).getAllKeys(key))
}

export const idbStore: Store = {
  listDecks: () => readAll<Deck>('decks'),
  putDeck: (deck) => put('decks', [deck]),
  async deleteDeck(deckId) {
    await removeTracked('notes', 'note', await keysByIndex('notes', 'deckId', deckId))
    await removeTracked('cards', 'card', await keysByIndex('cards', 'deckId', deckId))
    await removeTracked('media', 'media', await keysByIndex('media', 'deckId', deckId))
    // Logs and counters are device-local history, not synced entities.
    await remove('logs', await keysByIndex('logs', 'deckId', deckId))
    await remove('counters', await keysByIndex('counters', 'deckId', deckId))
    await removeTracked('decks', 'deck', [deckId])
  },

  listNotes: (deckId) => readAll<Note>('notes', 'deckId', deckId),
  putNote: (note) => put('notes', [note]),
  deleteNote: (noteId) => removeTracked('notes', 'note', [noteId]),

  listCards: (deckId) => readAll<Card>('cards', 'deckId', deckId),
  cardsForNote: (noteId) => readAll<Card>('cards', 'noteId', noteId),
  putCards: (cards) => put('cards', cards),
  deleteCards: (ids) => removeTracked('cards', 'card', ids),

  listLogs: (deckId) => readAll<ReviewLog>('logs', 'deckId', deckId),
  addLog: (log) => put('logs', [log]),
  deleteLog: (logId) => remove('logs', [logId]),

  listMedia: (deckId) => readAll<MediaItem>('media', 'deckId', deckId),
  async getMedia(id) {
    const tx = (await db()).transaction('media', 'readonly')
    return request<MediaItem | undefined>(tx.objectStore('media').get(id))
  },
  putMedia: (item) => put('media', [item]),
  deleteMedia: (id) => removeTracked('media', 'media', [id]),

  async getCounter(deckId, day) {
    const id = `${deckId}:${day}`
    const tx = (await db()).transaction('counters', 'readonly')
    const found = await request<DayCounter | undefined>(tx.objectStore('counters').get(id))
    return found ?? { id, deckId, day, newSeen: 0, reviewsDone: 0 }
  },
  putCounter: (counter) => put('counters', [counter]),

  async listTombstones(since = 0) {
    const all = await readAll<Tombstone>('tombstones')
    return all.filter((t) => t.deletedAt >= since)
  },
}
