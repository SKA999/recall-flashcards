import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readEntry, readZip, ZipError } from '../zip'

const FIXTURES = join(process.cwd(), 'src', 'import', '__tests__', 'fixtures')

/** Buffers share a pool, so copy out rather than handing over `.buffer`. */
function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('reading the directory', () => {
  it('lists every entry', () => {
    const entries = readZip(fixture('mixed.zip'))
    expect([...entries.keys()].sort()).toEqual(
      ['0', 'collection.anki21', 'media', 'meta', 'ünïcode–name.txt'].sort(),
    )
  })

  it('records the compression method and sizes', () => {
    const entries = readZip(fixture('mixed.zip'))
    expect(entries.get('collection.anki21')).toMatchObject({ method: 8, uncompressedSize: 5000 })
    expect(entries.get('meta')).toMatchObject({ method: 0, uncompressedSize: 2 })
  })

  it('finds the directory past a trailing archive comment', () => {
    const entries = readZip(fixture('commented.zip'))
    expect([...entries.keys()]).toEqual(['a.txt'])
  })

  it('rejects something that is not a zip', () => {
    expect(() => readZip(new TextEncoder().encode('not a zip at all').buffer as ArrayBuffer)).toThrow(
      ZipError,
    )
  })
})

describe('reading entries', () => {
  it('inflates a deflated entry', async () => {
    const buffer = fixture('mixed.zip')
    const entries = readZip(buffer)
    const bytes = await readEntry(buffer, entries.get('collection.anki21')!)
    expect(bytes.length).toBe(5000)
    expect(text(bytes)).toBe('A'.repeat(5000))
  })

  it('returns a stored entry byte for byte', async () => {
    const buffer = fixture('mixed.zip')
    const entries = readZip(buffer)
    const bytes = await readEntry(buffer, entries.get('0')!)
    expect(bytes.length).toBe(1024)
    expect([...bytes.subarray(0, 4)]).toEqual([0, 1, 2, 3])
    expect(bytes[255]).toBe(255)
  })

  it('handles non-ASCII entry names and contents', async () => {
    const buffer = fixture('mixed.zip')
    const entries = readZip(buffer)
    const bytes = await readEntry(buffer, entries.get('ünïcode–name.txt')!)
    expect(text(bytes)).toBe('held—dash')
  })

  it('reads the media map an apkg carries', async () => {
    const buffer = fixture('mixed.zip')
    const entries = readZip(buffer)
    expect(JSON.parse(text(await readEntry(buffer, entries.get('media')!)))).toEqual({
      '0': 'cat.png',
    })
  })

  it('refuses an unsupported compression method rather than returning garbage', async () => {
    const buffer = fixture('mixed.zip')
    const entry = readZip(buffer).get('collection.anki21')!
    await expect(readEntry(buffer, { ...entry, method: 99 })).rejects.toThrow(/unsupported/)
  })
})

describe('zip64', () => {
  it('follows the 64-bit records when the 32-bit fields are saturated', async () => {
    const buffer = fixture('zip64.zip')
    const entries = readZip(buffer)
    expect([...entries.keys()]).toEqual(['big.bin'])
    // The offset was 0xFFFFFFFF in the header; the real one comes from the extra field.
    expect(entries.get('big.bin')!.localHeaderOffset).toBe(0)
    expect(text(await readEntry(buffer, entries.get('big.bin')!))).toBe('Z'.repeat(100))
  })
})
