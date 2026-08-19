// Exercised against a synthetic schema-11 package built by
// scripts/make-apkg-fixture.py. A real Anki export is the eventual check;
// this covers the shapes the reader has to get right.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { readEntry, readZip } from '../zip'
import { CollectionError, readCollection } from '../collection'
import type { AnkiCollection, SqlQuery } from '../collection'
import { mapScheduling } from '../../core/anki'

const FIXTURES = join(process.cwd(), 'src', 'import', '__tests__', 'fixtures')

let collection: AnkiCollection
let mediaMap: Record<string, string>
let archive: ArrayBuffer

beforeAll(async () => {
  const buf = readFileSync(join(FIXTURES, 'sample-legacy.apkg'))
  archive = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const entries = readZip(archive)

  const SQL = await initSqlJs()
  const bytes = await readEntry(archive, entries.get('collection.anki2')!)
  const db = new SQL.Database(bytes) as unknown as SqlQuery
  collection = readCollection(db)
  mediaMap = JSON.parse(new TextDecoder().decode(await readEntry(archive, entries.get('media')!)))
})

describe('opening the package', () => {
  it('identifies the schema', () => {
    expect(collection.schema).toBe(11)
  })

  it('reads the collection creation time, which review due dates count from', () => {
    expect(collection.crt).toBe(1735689600)
  })

  it('refuses a database that is not a collection', async () => {
    const SQL = await initSqlJs()
    const empty = new SQL.Database() as unknown as SqlQuery
    expect(() => readCollection(empty)).toThrow(CollectionError)
  })
})

describe('decks', () => {
  it('reads every deck', () => {
    expect(collection.decks.map((d) => d.name).sort()).toEqual(['Spanish', 'Spanish::Verbs'])
  })
})

describe('note types', () => {
  const find = (name: string) => collection.notetypes.find((n) => n.name === name)!

  it('reads fields in order', () => {
    expect(find('Basic').fields).toEqual(['Front', 'Back'])
    expect(find('Vocab with notes').fields).toEqual(['Word', 'Meaning', 'Example', 'Audio'])
  })

  it('reads every card template', () => {
    expect(find('Basic').templates).toHaveLength(1)
    expect(find('Basic (and reversed card)').templates).toHaveLength(2)
    expect(find('Vocab with notes').templates.map((t) => t.name)).toEqual([
      'Recognition',
      'Recall',
      'Listening',
    ])
  })

  it('spots the cloze note type', () => {
    expect(find('Cloze').isCloze).toBe(true)
    expect(find('Basic').isCloze).toBe(false)
    expect(find('Basic (and reversed card)').isCloze).toBe(false)
  })
})

describe('notes', () => {
  it('splits fields on the unit separator', () => {
    const note = collection.notes.find((n) => n.fields[0] === 'la brisa')!
    expect(note.fields).toEqual(['la brisa', 'breeze'])
  })

  it('keeps every field of a wider note type', () => {
    const note = collection.notes.find((n) => n.fields[0] === 'estrenar')!
    expect(note.fields).toHaveLength(4)
    expect(note.fields[2]).toBe('Hoy estreno zapatos.')
  })

  it('reads tags without the padding spaces Anki writes', () => {
    const note = collection.notes.find((n) => n.fields[0] === 'la brisa')!
    expect(note.tags).toEqual(['noun', 'weather'])
  })

  it('gives an untagged note an empty list', () => {
    const note = collection.notes.find((n) => n.fields[0] === 'la sobremesa')!
    expect(note.tags).toEqual([])
  })

  it('reads all seven notes', () => {
    expect(collection.notes).toHaveLength(7)
  })
})

describe('cards', () => {
  it('reads all eleven cards', () => {
    expect(collection.cards).toHaveLength(11)
  })

  it('keeps both cards of a reversed note, at their own ordinals', () => {
    const note = collection.notes.find((n) => n.fields[0] === 'el puente')!
    const own = collection.cards.filter((c) => c.nid === note.id).sort((a, b) => a.ord - b.ord)
    expect(own.map((c) => c.ord)).toEqual([0, 1])
    expect(own[1].type).toBe(0)
  })

  it('keeps a card that lives in a subdeck', () => {
    const sub = collection.decks.find((d) => d.name === 'Spanish::Verbs')!
    expect(collection.cards.some((c) => c.did === sub.id)).toBe(true)
  })
})

describe('scheduling survives the round trip', () => {
  const at = (front: string, ord = 0) => {
    const note = collection.notes.find((n) => n.fields[0] === front)!
    const card = collection.cards.find((c) => c.nid === note.id && c.ord === ord)!
    return mapScheduling(card, { crt: collection.crt })
  }

  it('transfers FSRS memory state exactly', () => {
    const mapped = at('la brisa')
    expect(mapped.exact).toBe(true)
    expect(mapped.stability).toBeCloseTo(47.2, 5)
    expect(mapped.difficulty).toBeCloseTo(5.4, 5)
    expect(mapped.reps).toBe(12)
    expect(mapped.lapses).toBe(1)
  })

  it('estimates an SM-2 card from its interval and ease', () => {
    const mapped = at('el amanecer')
    expect(mapped.exact).toBe(false)
    expect(mapped.stability).toBe(21)
    expect(mapped.difficulty).toBeGreaterThan(1)
    expect(mapped.difficulty).toBeLessThan(10)
  })

  it('carries a suspension across', () => {
    expect(at('la sobremesa').suspended).toBe(true)
  })

  it('leaves a new card new', () => {
    const mapped = at('el puente', 1)
    expect(mapped.state).toBe('new')
    expect(mapped.stability).toBeUndefined()
  })

  it('reads a learning card due as a timestamp, not a day count', () => {
    const mapped = at('estrenar', 1)
    expect(mapped.state).toBe('learning')
    expect(mapped.due).toBe(1780000600 * 1000)
  })
})

describe('media', () => {
  it('maps zip entry names to original filenames', () => {
    expect(mediaMap).toEqual({ '0': 'brisa.png', '1': 'estrenar.mp3' })
  })

  it('can read the media bytes back out', async () => {
    const entries = readZip(archive)
    const png = await readEntry(archive, entries.get('0')!)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('has a note referencing the image by its original name', () => {
    const note = collection.notes.find((n) => n.fields[0].includes('<img'))!
    expect(note.fields[0]).toContain('brisa.png')
  })
})
