// The folder-writing half of automatic backup. A real directory handle can
// only come from a native picker, which no test can drive, so the handle is
// stubbed and the file it receives is checked for real.

import { describe, expect, it } from 'vitest'
import { COLLECTION_ENTRY } from '../../core/backup'
import {
  readBackupMarks,
  recordBackup,
  writeBackupToFolder,
} from '../../data/autobackup'
import { createMemoryStore } from '../../data/memory'
import type { Store } from '../../core/storage'
import type { Deck, Note } from '../../core/types'
import { readZip } from '../zip'

const NOW = 1780000000000

function deck(): Deck {
  return {
    id: 'd1',
    name: 'Chinese',
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

function note(id: string): Note {
  return {
    id,
    deckId: 'd1',
    notetypeId: 'basic',
    fields: ['学校', 'school'],
    tags: [],
    created: NOW,
    modified: NOW,
    updated: NOW,
  }
}

/** Just enough of FileSystemDirectoryHandle for the writer to use. */
function stubFolder(name = 'Backups') {
  const files = new Map<string, Uint8Array>()
  const handle = {
    name,
    kind: 'directory' as const,
    async getFileHandle(filename: string, options?: { create?: boolean }) {
      if (!options?.create && !files.has(filename)) throw new Error('not found')
      return {
        name: filename,
        kind: 'file' as const,
        async createWritable() {
          const chunks: Uint8Array[] = []
          return {
            async write(data: Blob | Uint8Array) {
              chunks.push(
                data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data,
              )
            },
            async close() {
              const total = chunks.reduce((n, c) => n + c.length, 0)
              const merged = new Uint8Array(total)
              let at = 0
              for (const c of chunks) {
                merged.set(c, at)
                at += c.length
              }
              files.set(filename, merged)
            },
          }
        },
      }
    },
  }
  return { handle: handle as unknown as FileSystemDirectoryHandle, files }
}

async function seeded(): Promise<Store> {
  const store = createMemoryStore()
  await store.putDeck(deck())
  await store.putNote(note('n1'))
  await store.putNote(note('n2'))
  return store
}

describe('writing a backup into a folder', () => {
  it('writes a readable archive under a dated name', async () => {
    const store = await seeded()
    const { handle, files } = stubFolder()

    const written = await writeBackupToFolder(store, handle, NOW)

    expect(written.filename).toMatch(/^recall-backup-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(written.at).toBe(NOW)
    expect(written.bytes).toBeGreaterThan(0)
    expect([...files.keys()]).toEqual([written.filename])
  })

  it('produces the same archive the manual export does', async () => {
    const store = await seeded()
    const { handle, files } = stubFolder()
    const written = await writeBackupToFolder(store, handle, NOW)

    const bytes = files.get(written.filename)!
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const entries = readZip(buffer as ArrayBuffer)
    expect(entries.has(COLLECTION_ENTRY)).toBe(true)
    expect(written.bytes).toBe(bytes.length)
  })

  it('overwrites the same day rather than piling up files', async () => {
    const store = await seeded()
    const { handle, files } = stubFolder()

    await writeBackupToFolder(store, handle, NOW)
    await store.putNote(note('n3'))
    await writeBackupToFolder(store, handle, NOW + 3_600_000)

    // Same calendar day, so one file, and it holds the later collection.
    expect(files.size).toBe(1)
  })

  it('starts a new file on a new day', async () => {
    const store = await seeded()
    const { handle, files } = stubFolder()
    await writeBackupToFolder(store, handle, NOW)
    await writeBackupToFolder(store, handle, NOW + 86_400_000)
    expect(files.size).toBe(2)
  })
})

describe('remembering that a copy was taken', () => {
  it('reports nothing before the first backup', async () => {
    const store = createMemoryStore()
    expect(await readBackupMarks(store)).toEqual({ lastBackupAt: undefined, reviewsAtBackup: 0 })
  })

  it('round-trips the time and the review count', async () => {
    const store = createMemoryStore()
    await recordBackup(store, NOW, 42)
    expect(await readBackupMarks(store)).toEqual({ lastBackupAt: NOW, reviewsAtBackup: 42 })
  })

  it('keeps only the most recent mark', async () => {
    const store = createMemoryStore()
    await recordBackup(store, NOW, 42)
    await recordBackup(store, NOW + 1000, 45)
    expect(await readBackupMarks(store)).toEqual({ lastBackupAt: NOW + 1000, reviewsAtBackup: 45 })
  })
})
