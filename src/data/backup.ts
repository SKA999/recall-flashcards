// Reading and writing collection backups against the actual store.

import {
  BackupError,
  COLLECTION_ENTRY,
  buildBackup,
  mediaEntryName,
  parseBackup,
  planRestore,
} from '../core/backup'
import type { BackupDocument, RestorePlan } from '../core/backup'
import type { Store } from '../core/storage'
import type { MediaItem } from '../core/types'
import { readEntry, readZip, ZipError } from '../import/zip'
import { writeZip } from '../import/zipwrite'
import type { FileToZip } from '../import/zipwrite'

/** Media types that are already compressed, so deflating them just costs time. */
const ALREADY_COMPRESSED = /^(image\/(png|jpeg|gif|webp|avif)|audio\/|video\/)/

export interface ExportResult {
  blob: Blob
  filename: string
  counts: { decks: number; notes: number; cards: number; media: number }
}

/** Serialise the whole collection into a single zip. */
export async function exportCollection(store: Store, now = Date.now()): Promise<ExportResult> {
  const [decks, notetypes, notes, cards, logs, media] = await Promise.all([
    store.listDecks(),
    store.listNotetypes(),
    store.listNotes(),
    store.listCards(),
    store.listLogs(),
    store.listMedia(),
  ])

  const document = buildBackup({ decks, notetypes, notes, cards, logs, media }, now)
  const files: FileToZip[] = [
    {
      name: COLLECTION_ENTRY,
      bytes: new TextEncoder().encode(JSON.stringify(document, null, 2)),
      compress: true,
    },
  ]

  for (const item of media) {
    files.push({
      name: mediaEntryName(item),
      bytes: new Uint8Array(await item.blob.arrayBuffer()),
      compress: !ALREADY_COMPRESSED.test(item.mime),
    })
  }

  const bytes = await writeZip(files)
  const stamp = new Date(now).toISOString().slice(0, 10)
  return {
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
    filename: `recall-backup-${stamp}.zip`,
    counts: { decks: decks.length, notes: notes.length, cards: cards.length, media: media.length },
  }
}

export interface OpenedBackup {
  document: BackupDocument
  /** Read one media file's bytes back out of the archive. */
  readMedia(entry: string): Promise<Uint8Array>
}

/** Open a backup file and validate its envelope, without writing anything. */
export async function openBackup(buffer: ArrayBuffer): Promise<OpenedBackup> {
  let entries
  try {
    entries = readZip(buffer)
  } catch (e) {
    throw new BackupError(
      e instanceof ZipError ? 'that file is not a readable backup archive' : String(e),
    )
  }

  const collection = entries.get(COLLECTION_ENTRY)
  if (!collection) throw new BackupError(`this archive has no ${COLLECTION_ENTRY}`)

  const text = new TextDecoder().decode(await readEntry(buffer, collection))
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupError('the collection inside this backup is not valid JSON')
  }

  return {
    document: parseBackup(raw),
    async readMedia(entry: string) {
      const found = entries.get(entry)
      if (!found) throw new BackupError(`backup is missing media entry "${entry}"`)
      return readEntry(buffer, found)
    },
  }
}

export interface RestoreResult extends RestorePlan {
  /** Media listed in the collection but absent from the archive. */
  missingMedia: string[]
}

/**
 * Write a backup into the store. Existing records are left alone, so a restore
 * can never overwrite scheduling that is newer than the file.
 */
export async function restoreCollection(
  store: Store,
  backup: OpenedBackup,
): Promise<RestoreResult> {
  const [decks, notetypes, notes, cards, logs, media] = await Promise.all([
    store.listDecks(),
    store.listNotetypes(),
    store.listNotes(),
    store.listCards(),
    store.listLogs(),
    store.listMedia(),
  ])

  const plan = planRestore(backup.document, {
    decks: new Set(decks.map((d) => d.id)),
    notetypes: new Set(notetypes.map((t) => t.id)),
    notes: new Set(notes.map((n) => n.id)),
    cards: new Set(cards.map((c) => c.id)),
    logs: new Set(logs.map((l) => l.id)),
    media: new Set(media.map((m) => m.id)),
  })

  // Note types and decks first: notes and cards reference them.
  for (const type of plan.notetypes) await store.putNotetype(type)
  for (const deck of plan.decks) await store.putDeck(deck)

  const missingMedia: string[] = []
  for (const record of plan.media) {
    try {
      const bytes = await backup.readMedia(record.entry)
      const item: MediaItem = {
        id: record.id,
        deckId: record.deckId,
        name: record.name,
        mime: record.mime,
        blob: new Blob([bytes as BlobPart], { type: record.mime }),
        created: record.created,
        updated: record.updated,
      }
      await store.putMedia(item)
    } catch {
      // A missing file costs that one attachment, not the whole restore.
      missingMedia.push(record.name)
    }
  }

  for (const note of plan.notes) await store.putNote(note)
  if (plan.cards.length) await store.putCards(plan.cards)
  for (const log of plan.logs) await store.addLog(log)

  return { ...plan, missingMedia }
}
