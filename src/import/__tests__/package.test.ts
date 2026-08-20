import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { readCollection } from '../collection'
import type { SqlQuery } from '../collection'
import { toNotetype, referencedFields } from '../notetypes'
import { openPackage, PackageError } from '../package'
import { PackageVersion } from '../protobuf'

const FIXTURES = join(process.cwd(), 'src', 'import', '__tests__', 'fixtures')

function load(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

async function open(name: string) {
  const pkg = await openPackage(load(name))
  const SQL = await initSqlJs()
  const db = new SQL.Database(pkg.collection) as unknown as SqlQuery
  return { pkg, collection: readCollection(db) }
}

describe.each([
  ['sample-legacy.apkg', PackageVersion.Legacy1, 11, false],
  ['sample-modern.apkg', PackageVersion.Latest, 18, true],
] as const)('%s', (file, version, schema, compressed) => {
  it('detects the package format', async () => {
    const { pkg } = await open(file)
    expect(pkg.version).toBe(version)
    expect(pkg.compressed).toBe(compressed)
  })

  it('yields a readable collection at the expected schema', async () => {
    const { collection } = await open(file)
    expect(collection.schema).toBe(schema)
    expect(collection.crt).toBe(1735689600)
    expect(collection.notes).toHaveLength(7)
    expect(collection.cards).toHaveLength(11)
  })

  it('reads deck names with nesting normalised', async () => {
    const { collection } = await open(file)
    expect(collection.decks.map((d) => d.name).sort()).toEqual(['Spanish', 'Spanish::Verbs'])
  })

  it('identifies the cloze note type', async () => {
    const { collection } = await open(file)
    expect(collection.notetypes.find((n) => n.name === 'Cloze')!.isCloze).toBe(true)
    expect(collection.notetypes.find((n) => n.name === 'Basic')!.isCloze).toBe(false)
  })

  it('recovers each template’s front and back formats', async () => {
    const { collection } = await open(file)
    const basic = collection.notetypes.find((n) => n.name === 'Basic')!
    expect(basic.templates[0].qfmt).toBe('{{Front}}')
    expect(basic.templates[0].afmt).toContain('{{Back}}')
  })

  it('lists media with their original filenames', async () => {
    const { pkg } = await open(file)
    expect(pkg.media.map((m) => m.filename).sort()).toEqual(['brisa.png', 'estrenar.mp3'])
  })

  it('reads media bytes back, decompressing when the format requires it', async () => {
    const { pkg } = await open(file)
    const image = pkg.media.find((m) => m.filename === 'brisa.png')!
    const bytes = await pkg.readMedia(image.entry)
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})

describe('rejecting bad input', () => {
  it('refuses something that is not a zip', async () => {
    const bytes = new TextEncoder().encode('definitely not an apkg')
    await expect(openPackage(bytes.buffer as ArrayBuffer)).rejects.toThrow(PackageError)
  })
})

describe('reading field references out of a template', () => {
  const fields = ['Front', 'Back', 'Notes']

  it('finds a plain reference', () => {
    expect(referencedFields('{{Front}}', fields)).toEqual([0])
  })

  it('ignores the special names that are not fields', () => {
    expect(referencedFields('{{FrontSide}}<hr>{{Back}} {{Tags}} {{Deck}}', fields)).toEqual([1])
  })

  it('sees through a filter chain', () => {
    expect(referencedFields('{{cloze:Front}} {{text:hint:Notes}}', fields)).toEqual([0, 2])
  })

  it('does not count a conditional section as displayed content', () => {
    expect(referencedFields('{{#Notes}}{{Back}}{{/Notes}}', fields)).toEqual([1])
    expect(referencedFields('{{^Notes}}nothing{{/Notes}}', fields)).toEqual([])
  })

  it('reports each field once, in order of first appearance', () => {
    expect(referencedFields('{{Back}} {{Front}} {{Back}}', fields)).toEqual([1, 0])
  })

  it('ignores a reference to a field that does not exist', () => {
    expect(referencedFields('{{Nonexistent}}', fields)).toEqual([])
  })
})

describe('converting note types', () => {
  it('reuses the built-in Basic rather than making a near-duplicate', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const basic = toNotetype(collection.notetypes.find((n) => n.name === 'Basic')!)
    expect(basic.id).toBe('basic')
  })

  it('reuses the built-in for a reversed type too', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const reversed = toNotetype(
      collection.notetypes.find((n) => n.name === 'Basic (and reversed card)')!,
    )
    expect(reversed.id).toBe('reversed')
  })

  it('keeps every field and template of a wider type', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const wide = toNotetype(collection.notetypes.find((n) => n.name === 'Vocab with notes')!)
    expect(wide.id).toBe('anki-1002')
    expect(wide.fields).toEqual(['Word', 'Meaning', 'Example', 'Audio'])
    expect(wide.templates).toHaveLength(3)
  })

  it('maps each template to the fields it actually asks and answers', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const wide = toNotetype(collection.notetypes.find((n) => n.name === 'Vocab with notes')!)
    // Recognition: {{Word}} -> {{Meaning}}<br>{{Example}}
    expect(wide.templates[0].question).toEqual([0])
    expect(wide.templates[0].answer).toEqual([1, 2])
    // Recall: {{Meaning}} -> {{Word}}
    expect(wide.templates[1].question).toEqual([1])
    expect(wide.templates[1].answer).toEqual([0])
    // Listening: {{Audio}} -> {{Word}}
    expect(wide.templates[2].question).toEqual([3])
    expect(wide.templates[2].answer).toEqual([0])
  })

  it('finds which field a cloze type draws its deletions from', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const cloze = toNotetype(collection.notetypes.find((n) => n.name === 'Cloze')!)
    expect(cloze.isCloze).toBe(true)
    expect(cloze.clozeField).toBe(0)
  })

  it('gives a stable id, so re-importing updates rather than duplicates', async () => {
    const { collection } = await open('sample-legacy.apkg')
    const anki = collection.notetypes.find((n) => n.name === 'Vocab with notes')!
    expect(toNotetype(anki).id).toBe(toNotetype(anki).id)
  })
})
