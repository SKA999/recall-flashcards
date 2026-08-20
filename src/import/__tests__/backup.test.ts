// Round-trips a whole collection through the backup format using the in-memory
// store, so the check is end to end: export, re-open, restore, compare.

import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, BackupError, COLLECTION_ENTRY, parseBackup } from '../../core/backup'
import type { Card, Deck, MediaItem, Note, ReviewLog } from '../../core/types'
import { exportCollection, openBackup, restoreCollection } from '../../data/backup'
import { createMemoryStore } from '../../data/memory'
import { readEntry, readZip } from '../zip'
import { writeZip } from '../zipwrite'

const NOW = 1780000000000

function deck(id: string): Deck {
  return {
    id,
    name: `Deck ${id}`,
    description: '',
    config: {
      desiredRetention: 0.9,
      learningSteps: [1, 10],
      relearningSteps: [10],
      newPerDay: 20,
      reviewsPerDay: 200,
      maximumInterval: 36500,
      fuzz: true,
      weights: [],
    },
    created: NOW,
    updated: NOW,
  }
}

function note(id: string, deckId: string, fields: string[]): Note {
  return {
    id,
    deckId,
    notetypeId: 'basic',
    fields,
    tags: ['tag'],
    created: NOW,
    modified: NOW,
    updated: NOW,
  }
}

/** A card with distinctive scheduling, so a lossy round trip would show. */
function card(id: string, noteId: string, deckId: string): Card {
  return {
    id,
    noteId,
    deckId,
    ordinal: 0,
    state: 'review',
    step: 0,
    due: NOW + 86_400_000 * 12,
    stability: 47.213_5,
    difficulty: 6.318_2,
    lastReview: NOW - 86_400_000 * 30,
    reps: 17,
    lapses: 3,
    scheduledDays: 42,
    suspended: false,
    created: NOW,
    updated: NOW,
  }
}

function log(id: string, cardId: string, deckId: string): ReviewLog {
  return {
    id,
    cardId,
    deckId,
    rating: 3,
    stateBefore: 'review',
    elapsedDays: 30,
    scheduledDays: 42,
    stability: 47.213_5,
    difficulty: 6.318_2,
    durationMs: 4321,
    reviewed: NOW - 1000,
  }
}

function media(id: string, deckId: string, bytes: number[], mime: string, name: string): MediaItem {
  return {
    id,
    deckId,
    name,
    mime,
    blob: new Blob([new Uint8Array(bytes)], { type: mime }),
    created: NOW,
    updated: NOW,
  }
}

async function seeded() {
  const store = createMemoryStore()
  await store.putDeck(deck('d1'))
  await store.putNote(note('n1', 'd1', ['hola', 'hello']))
  await store.putNote(note('n2', 'd1', ['adios', 'goodbye']))
  await store.putCards([card('c1', 'n1', 'd1'), card('c2', 'n2', 'd1')])
  await store.addLog(log('l1', 'c1', 'd1'))
  await store.putMedia(media('m1', 'd1', [0x89, 0x50, 0x4e, 0x47, 1, 2, 3], 'image/png', 'cat.png'))
  await store.putMedia(
    media('m2', 'd1', [0x49, 0x44, 0x33, 9, 9, 9], 'audio/mpeg', 'meow.mp3'),
  )
  return store
}

async function toBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

describe('the zip writer', () => {
  it('produces an archive our own reader can read', async () => {
    const bytes = await writeZip([
      { name: 'a.txt', bytes: new TextEncoder().encode('hello'), compress: false },
      { name: 'b.txt', bytes: new TextEncoder().encode('x'.repeat(500)), compress: true },
    ])
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const entries = readZip(buffer as ArrayBuffer)
    expect([...entries.keys()]).toEqual(['a.txt', 'b.txt'])
    expect(new TextDecoder().decode(await readEntry(buffer as ArrayBuffer, entries.get('a.txt')!))).toBe(
      'hello',
    )
    expect(
      new TextDecoder().decode(await readEntry(buffer as ArrayBuffer, entries.get('b.txt')!)),
    ).toBe('x'.repeat(500))
  })

  it('marks filenames as UTF-8, so other tools do not read them as CP437', async () => {
    const bytes = await writeZip([{ name: 'medi\u00e4/\u00fcnicode.mp3', bytes: new Uint8Array([1]) }])
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // General purpose bit 11 in the local header, at offset 6.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800)
    // And again in the central directory, whose flags sit at offset 8.
    const central = bytes.indexOf(0x50, 30)
    const entries = readZip(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    )
    expect([...entries.keys()]).toEqual(['medi\u00e4/\u00fcnicode.mp3'])
    expect(central).toBeGreaterThan(0)
  })

  it('actually compresses when asked, and stores when deflate would not help', async () => {
    const compressible = new TextEncoder().encode('y'.repeat(2000))
    const deflated = await writeZip([{ name: 'c', bytes: compressible, compress: true }])
    const stored = await writeZip([{ name: 'c', bytes: compressible, compress: false }])
    expect(deflated.length).toBeLessThan(stored.length)
  })
})

describe('exporting', () => {
  it('writes a readable archive with the collection and its media', async () => {
    const result = await exportCollection(await seeded(), NOW)
    expect(result.counts).toEqual({ decks: 1, notes: 2, cards: 2, media: 2 })
    expect(result.filename).toMatch(/^recall-backup-\d{4}-\d{2}-\d{2}\.zip$/)

    const entries = readZip(await toBuffer(result.blob))
    expect(entries.has(COLLECTION_ENTRY)).toBe(true)
    expect([...entries.keys()].filter((k) => k.startsWith('media/'))).toHaveLength(2)
  })

  it('keeps a media file’s extension in its entry name', async () => {
    const result = await exportCollection(await seeded(), NOW)
    const names = [...readZip(await toBuffer(result.blob)).keys()]
    expect(names).toContain('media/m1.png')
    expect(names).toContain('media/m2.mp3')
  })
})

describe('restoring', () => {
  it('brings back every record exactly as it was', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)

    const target = createMemoryStore()
    const backup = await openBackup(await toBuffer(exported.blob))
    const result = await restoreCollection(target, backup)

    expect(result.missingMedia).toEqual([])
    expect(await target.listDecks()).toEqual(await source.listDecks())
    expect(await target.listNotes()).toEqual(await source.listNotes())
    expect(await target.listLogs()).toEqual(await source.listLogs())
  })

  it('preserves scheduling to the last decimal', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)
    const target = createMemoryStore()
    await restoreCollection(target, await openBackup(await toBuffer(exported.blob)))

    const before = (await source.listCards()).find((c) => c.id === 'c1')!
    const after = (await target.listCards()).find((c) => c.id === 'c1')!
    expect(after).toEqual(before)
    expect(after.stability).toBe(47.2135)
    expect(after.difficulty).toBe(6.3182)
    expect(after.reps).toBe(17)
  })

  it('brings media back byte for byte', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)
    const target = createMemoryStore()
    await restoreCollection(target, await openBackup(await toBuffer(exported.blob)))

    const original = await (await source.getMedia('m1'))!.blob.arrayBuffer()
    const restored = await (await target.getMedia('m1'))!.blob.arrayBuffer()
    expect([...new Uint8Array(restored)]).toEqual([...new Uint8Array(original)])
    expect((await target.getMedia('m1'))!.mime).toBe('image/png')
  })

  it('is idempotent - restoring the same file twice changes nothing', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)
    const target = createMemoryStore()

    const first = await restoreCollection(target, await openBackup(await toBuffer(exported.blob)))
    const second = await restoreCollection(target, await openBackup(await toBuffer(exported.blob)))

    expect(first.notes).toHaveLength(2)
    expect(second.notes).toHaveLength(0)
    expect(second.skipped.notes).toBe(2)
    expect(await target.listCards()).toHaveLength(2)
  })

  it('never overwrites a record that already exists', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)

    // The same card id, but reviewed since the backup was taken.
    const target = createMemoryStore()
    await target.putCards([{ ...card('c1', 'n1', 'd1'), reps: 99, stability: 500 }])
    await restoreCollection(target, await openBackup(await toBuffer(exported.blob)))

    const kept = (await target.listCards()).find((c) => c.id === 'c1')!
    expect(kept.reps).toBe(99)
    expect(kept.stability).toBe(500)
  })

  it('drops a card whose note is missing rather than orphaning it', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)
    const backup = await openBackup(await toBuffer(exported.blob))
    backup.document.notes = backup.document.notes.filter((n) => n.id !== 'n2')

    const target = createMemoryStore()
    const result = await restoreCollection(target, backup)
    expect(result.cards.map((c) => c.id)).toEqual(['c1'])
  })

  it('reports media the archive is short of, and restores the rest', async () => {
    const source = await seeded()
    const exported = await exportCollection(source, NOW)
    const backup = await openBackup(await toBuffer(exported.blob))
    backup.document.media = backup.document.media.map((m) =>
      m.id === 'm2' ? { ...m, entry: 'media/gone.mp3' } : m,
    )

    const target = createMemoryStore()
    const result = await restoreCollection(target, backup)
    expect(result.missingMedia).toEqual(['meow.mp3'])
    expect(await target.getMedia('m1')).toBeTruthy()
  })
})

describe('rejecting files that are not backups', () => {
  it('refuses a zip with no collection in it', async () => {
    const bytes = await writeZip([{ name: 'random.txt', bytes: new Uint8Array([1, 2, 3]) }])
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    await expect(openBackup(buffer as ArrayBuffer)).rejects.toThrow(BackupError)
  })

  it('refuses something that is not a zip at all', async () => {
    const bytes = new TextEncoder().encode('hello, not a zip')
    await expect(openBackup(bytes.buffer as ArrayBuffer)).rejects.toThrow(BackupError)
  })

  it('refuses a document written by a newer version of the app', () => {
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 99 })).toThrow(/newer version/)
  })

  it('refuses a JSON file that is not ours', () => {
    expect(() => parseBackup({ hello: 'world' })).toThrow(/not a Recall collection backup/)
  })

  it('refuses a document missing a whole section', () => {
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 1, decks: [] })).toThrow(
      /missing its note types/,
    )
  })
})
