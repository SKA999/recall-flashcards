// In-memory fallback for when IndexedDB isn't available — private browsing,
// storage disabled, or a sandboxed frame. The app stays fully usable; it just
// forgets on reload, and the UI says so.

import type { Store } from '../core/storage'
import { BUILTIN_NOTETYPES } from '../core/notetypes'
import type {
  Card,
  DayCounter,
  Deck,
  MediaItem,
  Note,
  Notetype,
  ReviewLog,
  Tombstone,
} from '../core/types'

export function createMemoryStore(): Store {
  const decks = new Map<string, Deck>()
  const notes = new Map<string, Note>()
  const cards = new Map<string, Card>()
  const logs = new Map<string, ReviewLog>()
  const media = new Map<string, MediaItem>()
  const counters = new Map<string, DayCounter>()
  const graves = new Map<string, Tombstone>()
  const notetypes = new Map<string, Notetype>(BUILTIN_NOTETYPES.map((t) => [t.id, t]))
  const settings = new Map<string, unknown>()

  const byDeck = <T extends { deckId: string }>(map: Map<string, T>, deckId?: string) =>
    [...map.values()].filter((v) => deckId === undefined || v.deckId === deckId)

  const bury = (ids: string[], kind: Tombstone['kind']) => {
    const deletedAt = Date.now()
    for (const id of ids) graves.set(id, { id, kind, deletedAt })
  }

  return {
    async listDecks() {
      return [...decks.values()]
    },
    async putDeck(deck) {
      decks.set(deck.id, deck)
    },
    async deleteDeck(deckId) {
      for (const [id, n] of notes) if (n.deckId === deckId) notes.delete(id), bury([id], 'note')
      for (const [id, c] of cards) if (c.deckId === deckId) cards.delete(id), bury([id], 'card')
      for (const [id, m] of media) if (m.deckId === deckId) media.delete(id), bury([id], 'media')
      for (const [id, l] of logs) if (l.deckId === deckId) logs.delete(id)
      for (const [id, c] of counters) if (c.deckId === deckId) counters.delete(id)
      decks.delete(deckId)
      bury([deckId], 'deck')
    },

    async listNotetypes() {
      return [...notetypes.values()]
    },
    async putNotetype(notetype) {
      notetypes.set(notetype.id, notetype)
    },
    async deleteNotetype(id) {
      notetypes.delete(id)
      bury([id], 'notetype')
    },

    async listNotes(deckId) {
      return byDeck(notes, deckId)
    },
    async putNote(note) {
      notes.set(note.id, note)
    },
    async deleteNote(noteId) {
      notes.delete(noteId)
      bury([noteId], 'note')
    },

    async listCards(deckId) {
      return byDeck(cards, deckId)
    },
    async cardsForNote(noteId) {
      return [...cards.values()].filter((c) => c.noteId === noteId)
    },
    async putCards(list) {
      for (const card of list) cards.set(card.id, card)
    },
    async deleteCards(ids) {
      for (const id of ids) cards.delete(id)
      bury(ids, 'card')
    },

    async listLogs(deckId) {
      return byDeck(logs, deckId)
    },
    async addLog(log) {
      logs.set(log.id, log)
    },
    async deleteLog(logId) {
      logs.delete(logId)
    },

    async listMedia(deckId) {
      return byDeck(media, deckId)
    },
    async getMedia(id) {
      return media.get(id)
    },
    async putMedia(item) {
      media.set(item.id, item)
    },
    async deleteMedia(id) {
      media.delete(id)
      bury([id], 'media')
    },

    async getCounter(deckId, day) {
      const id = `${deckId}:${day}`
      return counters.get(id) ?? { id, deckId, day, newSeen: 0, reviewsDone: 0 }
    },
    async putCounter(counter) {
      counters.set(counter.id, counter)
    },

    async getSetting<T>(key: string) {
      return settings.get(key) as T | undefined
    },
    async putSetting(key, value) {
      settings.set(key, value)
    },

    async listTombstones(since = 0) {
      return [...graves.values()].filter((t) => t.deletedAt >= since)
    },
  }
}
