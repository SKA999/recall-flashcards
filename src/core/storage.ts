import type {
  Card,
  DayCounter,
  Deck,
  MediaItem,
  Note,
  Notetype,
  ReviewLog,
  Tombstone,
} from './types'

/**
 * Everything the app needs from persistence. The web app backs this with
 * IndexedDB; a native app can back it with SQLite without touching the core.
 *
 * Contract for implementers: every `delete*` method must also write a
 * tombstone, and every write must carry the caller's `updated` stamp through
 * unchanged. Sync depends on both.
 */
export interface Store {
  listDecks(): Promise<Deck[]>
  putDeck(deck: Deck): Promise<void>
  deleteDeck(deckId: string): Promise<void>

  /** Note types are collection-wide, not per deck. */
  listNotetypes(): Promise<Notetype[]>
  putNotetype(notetype: Notetype): Promise<void>
  deleteNotetype(notetypeId: string): Promise<void>

  listNotes(deckId?: string): Promise<Note[]>
  putNote(note: Note): Promise<void>
  deleteNote(noteId: string): Promise<void>

  listCards(deckId?: string): Promise<Card[]>
  cardsForNote(noteId: string): Promise<Card[]>
  putCards(cards: Card[]): Promise<void>
  deleteCards(cardIds: string[]): Promise<void>

  listLogs(deckId?: string): Promise<ReviewLog[]>
  addLog(log: ReviewLog): Promise<void>
  /** Only ever used to undo an answer the user just gave. */
  deleteLog(logId: string): Promise<void>

  listMedia(deckId?: string): Promise<MediaItem[]>
  getMedia(id: string): Promise<MediaItem | undefined>
  putMedia(item: MediaItem): Promise<void>
  deleteMedia(id: string): Promise<void>

  getCounter(deckId: string, day: string): Promise<DayCounter>
  putCounter(counter: DayCounter): Promise<void>

  /** Deletions since `since`, for a future sync push. */
  listTombstones(since?: number): Promise<Tombstone[]>

  /**
   * Device-local settings: never synced, and able to hold values that are
   * structured-cloneable but not JSON, such as a filesystem handle.
   */
  getSetting<T>(key: string): Promise<T | undefined>
  putSetting(key: string, value: unknown): Promise<void>
}
