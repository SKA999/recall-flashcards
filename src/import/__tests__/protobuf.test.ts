import { describe, expect, it } from 'vitest'
import {
  decodeMediaEntries,
  decodePackageMeta,
  PackageVersion,
  ProtobufError,
} from '../protobuf'

// Hand-rolled encoders, so the fixtures are readable rather than opaque blobs.
function varint(value: number): number[] {
  const out: number[] = []
  let v = value
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

const tag = (field: number, wire: number) => varint(field * 8 + wire)
const varintField = (field: number, value: number) => [...tag(field, 0), ...varint(value)]
const lengthField = (field: number, payload: number[]) => [
  ...tag(field, 2),
  ...varint(payload.length),
  ...payload,
]
const utf8 = (s: string) => [...new TextEncoder().encode(s)]

describe('package meta', () => {
  it('reads the version', () => {
    expect(decodePackageMeta(new Uint8Array(varintField(1, 3)))).toBe(PackageVersion.Latest)
    expect(decodePackageMeta(new Uint8Array(varintField(1, 2)))).toBe(PackageVersion.Legacy2)
  })

  it('reports unknown for an empty message', () => {
    expect(decodePackageMeta(new Uint8Array())).toBe(PackageVersion.Unknown)
  })

  it('ignores fields a future Anki might add', () => {
    const bytes = new Uint8Array([
      ...varintField(1, 3),
      ...varintField(7, 12345),
      ...lengthField(8, utf8('something new')),
    ])
    expect(decodePackageMeta(bytes)).toBe(PackageVersion.Latest)
  })

  it('throws on a truncated varint rather than guessing', () => {
    expect(() => decodePackageMeta(new Uint8Array([0x08, 0x80]))).toThrow(ProtobufError)
  })
})

describe('media entries', () => {
  const entry = (name: string, size: number, sha1: number[], legacy?: number) =>
    lengthField(1, [
      ...lengthField(1, utf8(name)),
      ...varintField(2, size),
      ...lengthField(3, sha1),
      ...(legacy === undefined ? [] : varintField(255, legacy)),
    ])

  it('reads name, size and sha1 in order', () => {
    const bytes = new Uint8Array([
      ...entry('cat.png', 2048, [1, 2, 3]),
      ...entry('dog.mp3', 999, [4, 5]),
    ])
    const entries = decodeMediaEntries(bytes)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ name: 'cat.png', size: 2048 })
    expect([...entries[0].sha1]).toEqual([1, 2, 3])
    expect(entries[1].name).toBe('dog.mp3')
  })

  it('keeps the legacy index when one is present', () => {
    const entries = decodeMediaEntries(new Uint8Array(entry('old.png', 10, [], 42)))
    expect(entries[0].legacyZipFilename).toBe(42)
  })

  it('leaves the legacy index unset otherwise', () => {
    const entries = decodeMediaEntries(new Uint8Array(entry('new.png', 10, [])))
    expect(entries[0].legacyZipFilename).toBeUndefined()
  })

  it('handles non-ASCII filenames', () => {
    const entries = decodeMediaEntries(new Uint8Array(entry('ünïcode–ø.png', 1, [])))
    expect(entries[0].name).toBe('ünïcode–ø.png')
  })

  it('returns nothing for an empty list', () => {
    expect(decodeMediaEntries(new Uint8Array())).toEqual([])
  })

  it('survives a field 255 tag, which needs a two-byte key', () => {
    // Guards the tag reader: field 255 encodes as 0xF8 0x0F, not one byte.
    const bytes = new Uint8Array(entry('x', 0, [], 300))
    expect(decodeMediaEntries(bytes)[0].legacyZipFilename).toBe(300)
  })
})
