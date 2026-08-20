// The backup format: everything needed to reconstruct a collection.
//
// A backup is a zip holding `collection.json` plus the raw media files. The
// JSON is deliberately just the stored records - no derived state, no
// re-encoding - so a restore is a copy rather than a translation, and
// scheduling survives byte for byte.

import type {
  Card,
  Deck,
  MediaItem,
  Note,
  Notetype,
  ReviewLog,
} from './types'

export const BACKUP_FORMAT = 'recall-collection'
/** Raised only when a restore of an older file would need converting. */
export const BACKUP_VERSION = 1

export const COLLECTION_ENTRY = 'collection.json'
export const MEDIA_PREFIX = 'media/'

/** Media without its bytes; the bytes live as separate zip entries. */
export interface MediaRecord {
  id: string
  deckId: string
  name: string
  mime: string
  created: number
  updated: number
  /** Zip entry holding this file's bytes. */
  entry: string
}

export interface BackupDocument {
  format: typeof BACKUP_FORMAT
  version: number
  /** When the backup was taken, epoch ms. */
  exported: number
  decks: Deck[]
  notetypes: Notetype[]
  notes: Note[]
  cards: Card[]
  logs: ReviewLog[]
  media: MediaRecord[]
}

export class BackupError extends Error {}

export interface CollectionSnapshot {
  decks: Deck[]
  notetypes: Notetype[]
  notes: Note[]
  cards: Card[]
  logs: ReviewLog[]
  media: MediaItem[]
}

/** Zip entry name for a media file, keeping its extension where it has one. */
export function mediaEntryName(item: Pick<MediaItem, 'id' | 'name'>): string {
  const dot = item.name.lastIndexOf('.')
  const extension = dot > 0 ? item.name.slice(dot).toLowerCase() : ''
  // The id is the filename so entries cannot collide, whatever the media was called.
  return `${MEDIA_PREFIX}${item.id}${extension}`
}

/** Build the JSON document for a snapshot. Media bytes are written separately. */
export function buildBackup(snapshot: CollectionSnapshot, exported: number): BackupDocument {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported,
    decks: snapshot.decks,
    notetypes: snapshot.notetypes,
    notes: snapshot.notes,
    cards: snapshot.cards,
    logs: snapshot.logs,
    media: snapshot.media.map((item) => ({
      id: item.id,
      deckId: item.deckId,
      name: item.name,
      mime: item.mime,
      created: item.created,
      updated: item.updated,
      entry: mediaEntryName(item),
    })),
  }
}

function requireArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new BackupError(`backup is missing its ${what}`)
  return value as T[]
}

/**
 * Validate a parsed backup document. Strict about the envelope, forgiving
 * about the contents: a file this app did not write should be rejected here
 * rather than half-imported.
 */
export function parseBackup(raw: unknown): BackupDocument {
  if (!raw || typeof raw !== 'object') throw new BackupError('backup file is not readable')
  const doc = raw as Partial<BackupDocument>

  if (doc.format !== BACKUP_FORMAT) {
    throw new BackupError('that file is not a Recall collection backup')
  }
  if (typeof doc.version !== 'number') throw new BackupError('backup is missing its version')
  if (doc.version > BACKUP_VERSION) {
    throw new BackupError(
      `this backup was written by a newer version of the app (format ${doc.version}); update before restoring it`,
    )
  }

  return {
    format: BACKUP_FORMAT,
    version: doc.version,
    exported: typeof doc.exported === 'number' ? doc.exported : 0,
    decks: requireArray<Deck>(doc.decks, 'decks'),
    notetypes: requireArray<Notetype>(doc.notetypes, 'note types'),
    notes: requireArray<Note>(doc.notes, 'notes'),
    cards: requireArray<Card>(doc.cards, 'cards'),
    logs: requireArray<ReviewLog>(doc.logs, 'review log'),
    media: Array.isArray(doc.media) ? (doc.media as MediaRecord[]) : [],
  }
}

export interface RestorePlan {
  decks: Deck[]
  notetypes: Notetype[]
  notes: Note[]
  cards: Card[]
  logs: ReviewLog[]
  media: MediaRecord[]
  skipped: {
    decks: number
    notetypes: number
    notes: number
    cards: number
    logs: number
    media: number
  }
}

interface ExistingIds {
  decks: Set<string>
  notetypes: Set<string>
  notes: Set<string>
  cards: Set<string>
  logs: Set<string>
  media: Set<string>
}

/**
 * Work out what a restore should write.
 *
 * Records whose id is already present are skipped rather than overwritten, so
 * restoring into a collection that already has your cards cannot clobber newer
 * scheduling - and restoring the same file twice changes nothing the second
 * time. Cards whose note did not survive are dropped, since a card without its
 * note can never be rendered.
 */
export function planRestore(doc: BackupDocument, existing: ExistingIds): RestorePlan {
  const decks = doc.decks.filter((d) => !existing.decks.has(d.id))
  const notetypes = doc.notetypes.filter((t) => !existing.notetypes.has(t.id))
  const notes = doc.notes.filter((n) => !existing.notes.has(n.id))
  const media = doc.media.filter((m) => !existing.media.has(m.id))
  const logs = doc.logs.filter((l) => !existing.logs.has(l.id))

  const noteIds = new Set([...existing.notes, ...notes.map((n) => n.id)])
  const cards = doc.cards.filter((c) => !existing.cards.has(c.id) && noteIds.has(c.noteId))

  return {
    decks,
    notetypes,
    notes,
    cards,
    logs,
    media,
    skipped: {
      decks: doc.decks.length - decks.length,
      notetypes: doc.notetypes.length - notetypes.length,
      notes: doc.notes.length - notes.length,
      cards: doc.cards.length - cards.length,
      logs: doc.logs.length - logs.length,
      media: doc.media.length - media.length,
    },
  }
}
