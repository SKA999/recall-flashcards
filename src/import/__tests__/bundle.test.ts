import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  basename,
  BundleError,
  cellMediaNames,
  convertCell,
  mediaIndex,
  readBundle,
} from '../bundle'
import { writeZip } from '../zipwrite'

const EXAMPLES = join(process.cwd(), 'examples')

/** A File built from bytes, the way a picker would hand one over. */
function file(name: string, content: string | Uint8Array, type = ''): File {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return new File([bytes as BlobPart], name, { type })
}

async function zipFile(entries: { name: string; text?: string; bytes?: Uint8Array }[]): Promise<File> {
  const zip = await writeZip(
    entries.map((e) => ({
      name: e.name,
      bytes: e.bytes ?? new TextEncoder().encode(e.text ?? ''),
      compress: true,
    })),
  )
  return new File([zip as BlobPart], 'bundle.zip', { type: 'application/zip' })
}

describe('paths', () => {
  it('takes the filename off a path', () => {
    expect(basename('audio/ni-hao.mp3')).toBe('ni-hao.mp3')
    expect(basename('deck/audio/sub/a.wav')).toBe('a.wav')
    expect(basename('plain.csv')).toBe('plain.csv')
  })
})

describe('reading a bundle', () => {
  it('accepts a lone CSV, with no media', async () => {
    const bundle = await readBundle([file('cards.csv', 'a,b\n1,2\n', 'text/csv')])
    expect(bundle.table.name).toBe('cards.csv')
    expect(bundle.media).toEqual([])
    expect(bundle.fromZip).toBe(false)
  })

  it('accepts a table and its media selected together', async () => {
    const bundle = await readBundle([
      file('cards.csv', 'Chinese,Audio\n你好,ni-hao.wav\n'),
      file('ni-hao.wav', new Uint8Array([1, 2, 3])),
      file('xie-xie.wav', new Uint8Array([4, 5])),
    ])
    expect(bundle.table.name).toBe('cards.csv')
    expect(bundle.media.map((m) => m.name).sort()).toEqual(['ni-hao.wav', 'xie-xie.wav'])
  })

  it('expands a zip and keeps the folder structure in the path', async () => {
    const bundle = await readBundle([
      await zipFile([
        { name: 'cards.csv', text: 'Chinese,Audio\n你好,ni-hao.wav\n' },
        { name: 'audio/ni-hao.wav', bytes: new Uint8Array([1, 2, 3]) },
      ]),
    ])
    expect(bundle.fromZip).toBe(true)
    expect(bundle.table.text).toContain('你好')
    expect(bundle.media[0].path).toBe('audio/ni-hao.wav')
    expect(bundle.media[0].name).toBe('ni-hao.wav')
  })

  it('types media by extension, since a zip carries no MIME', async () => {
    const bundle = await readBundle([
      await zipFile([
        { name: 'cards.csv', text: 'a,b\n1,2\n' },
        { name: 'audio/word.opus', bytes: new Uint8Array([1]) },
        { name: 'pics/word.png', bytes: new Uint8Array([2]) },
      ]),
    ])
    const byName = Object.fromEntries(bundle.media.map((m) => [m.name, m.mime]))
    expect(byName['word.opus']).toBe('audio/ogg')
    expect(byName['word.png']).toBe('image/png')
  })

  it('ignores macOS and zip bookkeeping', async () => {
    const bundle = await readBundle([
      await zipFile([
        { name: 'cards.csv', text: 'a,b\n1,2\n' },
        { name: '__MACOSX/._cards.csv', bytes: new Uint8Array([0]) },
        { name: '.DS_Store', bytes: new Uint8Array([0]) },
        { name: 'audio/a.wav', bytes: new Uint8Array([1]) },
      ]),
    ])
    expect(bundle.media.map((m) => m.name)).toEqual(['a.wav'])
    expect(bundle.ignored).toEqual([])
  })

  it('reports files it cannot use rather than dropping them silently', async () => {
    const bundle = await readBundle([
      file('cards.csv', 'a,b\n1,2\n'),
      file('notes.pdf', new Uint8Array([1])),
    ])
    expect(bundle.ignored).toEqual(['notes.pdf'])
  })

  it('refuses a selection with no table', async () => {
    await expect(readBundle([file('a.wav', new Uint8Array([1]))])).rejects.toThrow(/no CSV or TSV/)
  })

  it('refuses a selection with two tables, rather than guessing', async () => {
    await expect(
      readBundle([file('one.csv', 'a,b\n'), file('two.csv', 'c,d\n')]),
    ).rejects.toThrow(/only one/)
  })

  it('refuses an empty selection', async () => {
    await expect(readBundle([])).rejects.toThrow(BundleError)
  })
})

describe('matching cells to media', () => {
  const index = mediaIndex([
    { path: 'audio/Ni-Hao.wav', name: 'Ni-Hao.wav', mime: 'audio/wav', bytes: new Uint8Array() },
    { path: 'audio/xie-xie.mp3', name: 'xie-xie.mp3', mime: 'audio/mpeg', bytes: new Uint8Array() },
  ])
  const resolve = (name: string) => (index.has(name.trim().toLowerCase()) ? `id-${name.trim().toLowerCase()}` : undefined)

  it('matches a bare filename regardless of case', () => {
    expect(convertCell('ni-hao.wav', resolve).text).toBe('{{media:id-ni-hao.wav}}')
    expect(convertCell('  NI-HAO.WAV ', resolve).text).toBe('{{media:id-ni-hao.wav}}')
  })

  it('matches a cell that names the folder too', () => {
    expect(index.has('audio/ni-hao.wav')).toBe(true)
    expect(convertCell('audio/Ni-Hao.wav', resolve).text).toBe('{{media:id-audio/ni-hao.wav}}')
  })

  it('matches an Anki-style sound reference', () => {
    const out = convertCell('[sound:xie-xie.mp3]', resolve)
    expect(out.usedMedia).toBe(true)
    expect(out.text).toBe('{{media:id-xie-xie.mp3}}')
  })

  it('leaves ordinary text alone for the caller to clean', () => {
    const out = convertCell('  谢谢  ', resolve)
    expect(out.usedMedia).toBe(false)
    expect(out.text).toBe('  谢谢  ')
  })

  it('does not mistake a sentence with a full stop for a filename', () => {
    const out = convertCell('I am fine, thank you.', resolve)
    expect(out.usedMedia).toBe(false)
  })

  it('reports a filename the bundle is missing instead of importing it as text', () => {
    const missing = new Set<string>()
    const out = convertCell('gone.mp3', resolve, missing)
    expect(out.text).toBe('')
    expect([...missing]).toEqual(['gone.mp3'])
  })

  it('keeps the first file when two share a name', () => {
    const dupes = mediaIndex([
      { path: 'a/x.wav', name: 'x.wav', mime: 'audio/wav', bytes: new Uint8Array([1]) },
      { path: 'b/x.wav', name: 'x.wav', mime: 'audio/wav', bytes: new Uint8Array([2]) },
    ])
    expect(dupes.get('x.wav')!.path).toBe('a/x.wav')
  })
})

describe('spotting which files a cell wants', () => {
  it('finds a bare filename', () => {
    expect(cellMediaNames('ni-hao.mp3')).toEqual(['ni-hao.mp3'])
  })

  it('finds an embedded reference', () => {
    expect(cellMediaNames('[sound:a.mp3]')).toEqual(['a.mp3'])
    expect(cellMediaNames('<img src="b.png">')).toEqual(['b.png'])
  })

  it('finds nothing in prose', () => {
    expect(cellMediaNames('to work hard')).toEqual([])
    expect(cellMediaNames('')).toEqual([])
  })
})

describe('the shipped Primary 5 example', () => {
  it('reads as a bundle with audio for both sides of every card', async () => {
    const bytes = readFileSync(join(EXAMPLES, 'primary-5-example.zip'))
    const zip = new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], 'primary-5-example.zip', { type: 'application/zip' })
    const bundle = await readBundle([zip])

    expect(bundle.table.name).toBe('cards.csv')
    // Ten cards, each naming a Chinese clip and an English clip.
    expect(bundle.media).toHaveLength(20)
    expect(bundle.media.every((m) => m.mime === 'audio/wav')).toBe(true)

    const index = mediaIndex(bundle.media)
    const lines = bundle.table.text.trim().split('\n')
    expect(lines[0]).toBe('Chinese,English,Chinese audio,English audio,Tags')

    // Every filename the table names must exist in the bundle.
    for (const line of lines.slice(1)) {
      const cells = line.split(',')
      for (const cell of cells) {
        for (const name of cellMediaNames(cell)) {
          expect(index.has(name.toLowerCase())).toBe(true)
        }
      }
    }
  })

  it('ships a blank template with the same columns', () => {
    const template = readFileSync(join(EXAMPLES, 'import-template.csv'), 'utf8')
    expect(template.split('\n')[0]).toBe('Chinese,English,Chinese audio,English audio,Tags')
  })
})
