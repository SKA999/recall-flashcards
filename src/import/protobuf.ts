// An .apkg carries exactly two protobuf messages, both tiny. Decoding them by
// hand is cheaper than a protobuf runtime and keeps the import path
// dependency-light.
//
// Definitions (anki/proto/anki/import_export.proto):
//   PackageMetadata { Version version = 1 }
//   MediaEntries    { repeated MediaEntry entries = 1 }
//   MediaEntry      { string name = 1; uint32 size = 2; bytes sha1 = 3;
//                     optional uint32 legacy_zip_filename = 255 }

export class ProtobufError extends Error {}

const WIRE_VARINT = 0
const WIRE_64BIT = 1
const WIRE_LENGTH = 2
const WIRE_32BIT = 5

class Reader {
  private at = 0
  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.bytes.length
  }

  varint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      if (this.done) throw new ProtobufError('truncated varint')
      const byte = this.bytes[this.at++]
      // Beyond 2^53 the arithmetic stops being exact; nothing here goes near it.
      result += (byte & 0x7f) * Math.pow(2, shift)
      if ((byte & 0x80) === 0) return result
      shift += 7
      if (shift > 63) throw new ProtobufError('varint too long')
    }
  }

  bytesField(): Uint8Array {
    const length = this.varint()
    if (this.at + length > this.bytes.length) throw new ProtobufError('truncated length-delimited field')
    const slice = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return slice
  }

  /** Returns null at the end of the buffer. */
  tag(): { field: number; wire: number } | null {
    if (this.done) return null
    const key = this.varint()
    return { field: key >>> 3, wire: key & 0x07 }
  }

  /** Skip a field this decoder doesn't care about, so unknown fields are safe. */
  skip(wire: number) {
    switch (wire) {
      case WIRE_VARINT:
        this.varint()
        return
      case WIRE_64BIT:
        this.at += 8
        return
      case WIRE_LENGTH:
        this.bytesField()
        return
      case WIRE_32BIT:
        this.at += 4
        return
      default:
        throw new ProtobufError(`unsupported wire type ${wire}`)
    }
  }
}

export const PackageVersion = {
  Unknown: 0,
  /** `meta` absent, collection.anki2 */
  Legacy1: 1,
  /** `meta` absent, collection.anki21 */
  Legacy2: 2,
  /** collection.anki21b, zstd-compressed, protobuf media list */
  Latest: 3,
} as const
export type PackageVersion = (typeof PackageVersion)[keyof typeof PackageVersion]

/** Decode the archive's `meta` entry. Unknown fields are ignored. */
export function decodePackageMeta(bytes: Uint8Array): PackageVersion {
  const reader = new Reader(bytes)
  let version: number = PackageVersion.Unknown
  for (let tag = reader.tag(); tag; tag = reader.tag()) {
    if (tag.field === 1 && tag.wire === WIRE_VARINT) version = reader.varint()
    else reader.skip(tag.wire)
  }
  return version as PackageVersion
}

export interface MediaEntry {
  name: string
  size: number
  sha1: Uint8Array
  /** Set when the package was built from a legacy hashmap with index gaps. */
  legacyZipFilename?: number
}

function decodeMediaEntry(bytes: Uint8Array): MediaEntry {
  const reader = new Reader(bytes)
  const entry: MediaEntry = { name: '', size: 0, sha1: new Uint8Array() }
  const decoder = new TextDecoder()
  for (let tag = reader.tag(); tag; tag = reader.tag()) {
    if (tag.field === 1 && tag.wire === WIRE_LENGTH) entry.name = decoder.decode(reader.bytesField())
    else if (tag.field === 2 && tag.wire === WIRE_VARINT) entry.size = reader.varint()
    else if (tag.field === 3 && tag.wire === WIRE_LENGTH) entry.sha1 = reader.bytesField().slice()
    else if (tag.field === 255 && tag.wire === WIRE_VARINT) entry.legacyZipFilename = reader.varint()
    else reader.skip(tag.wire)
  }
  return entry
}

/**
 * Decode a schema-18 card template's config blob.
 * Template.Config { string q_format = 1; string a_format = 2; }
 */
export function decodeTemplateConfig(bytes: Uint8Array): { qfmt: string; afmt: string } {
  const reader = new Reader(bytes)
  const decoder = new TextDecoder()
  let qfmt = ''
  let afmt = ''
  for (let tag = reader.tag(); tag; tag = reader.tag()) {
    if (tag.field === 1 && tag.wire === WIRE_LENGTH) qfmt = decoder.decode(reader.bytesField())
    else if (tag.field === 2 && tag.wire === WIRE_LENGTH) afmt = decoder.decode(reader.bytesField())
    else reader.skip(tag.wire)
  }
  return { qfmt, afmt }
}

/**
 * Decode a schema-18 note type's kind.
 * Notetype.Config { Kind kind = 1 } where KIND_NORMAL = 0, KIND_CLOZE = 1.
 * Returns 0 for a blob we cannot read, so callers fall back rather than guess.
 */
export function decodeNotetypeKind(bytes: Uint8Array): number {
  try {
    const reader = new Reader(bytes)
    for (let tag = reader.tag(); tag; tag = reader.tag()) {
      if (tag.field === 1 && tag.wire === WIRE_VARINT) return reader.varint()
      reader.skip(tag.wire)
    }
  } catch {
    // A malformed config should not stop the import.
  }
  return 0
}

/** Decode the modern media list. Index in the array is the file's name in the zip. */
export function decodeMediaEntries(bytes: Uint8Array): MediaEntry[] {
  const reader = new Reader(bytes)
  const entries: MediaEntry[] = []
  for (let tag = reader.tag(); tag; tag = reader.tag()) {
    if (tag.field === 1 && tag.wire === WIRE_LENGTH) entries.push(decodeMediaEntry(reader.bytesField()))
    else reader.skip(tag.wire)
  }
  return entries
}
