// Opens an .apkg: works out which of the three package formats it is,
// decompresses what needs decompressing, and hands back the collection bytes
// and media map.
//
// Per anki/rslib/src/import_export/package/meta.rs:
//   no `meta`, collection.anki2   -> legacy 1, uncompressed, JSON media map
//   no `meta`, collection.anki21  -> legacy 2, uncompressed, JSON media map
//   `meta` version 3              -> collection.anki21b, zstd, protobuf media list

import { decompress } from 'fzstd'
import { decodeMediaEntries, decodePackageMeta, PackageVersion } from './protobuf'
import { readEntry, readZip, ZipError } from './zip'
import type { ZipEntry } from './zip'

export class PackageError extends Error {}

export interface PackageMedia {
  /** Name of the zip entry holding the bytes. */
  entry: string
  /** Original filename, as referenced from note fields. */
  filename: string
}

export interface OpenedPackage {
  version: PackageVersion
  /** True when the collection and media entries are zstd-compressed. */
  compressed: boolean
  /** Raw bytes of the SQLite collection. */
  collection: Uint8Array
  media: PackageMedia[]
  /** Read one media file's bytes, decompressing if the package requires it. */
  readMedia(entry: string): Promise<Uint8Array>
}

const COLLECTION_NAMES: Record<number, string> = {
  [PackageVersion.Legacy1]: 'collection.anki2',
  [PackageVersion.Legacy2]: 'collection.anki21',
  [PackageVersion.Latest]: 'collection.anki21b',
}

/** Work out the format from the `meta` entry, or from which collection is present. */
function detectVersion(entries: Map<string, ZipEntry>, meta: Uint8Array | null): PackageVersion {
  if (meta) {
    const declared = decodePackageMeta(meta)
    if (declared !== PackageVersion.Unknown) return declared
  }
  if (entries.has('collection.anki21b')) return PackageVersion.Latest
  if (entries.has('collection.anki21')) return PackageVersion.Legacy2
  if (entries.has('collection.anki2')) return PackageVersion.Legacy1
  throw new PackageError('this file does not look like an Anki deck package')
}

/** Legacy packages map zip entry name -> original filename as JSON. */
function readLegacyMedia(bytes: Uint8Array): PackageMedia[] {
  try {
    const map = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>
    return Object.entries(map).map(([entry, filename]) => ({ entry, filename }))
  } catch {
    // A damaged media map costs the media, not the import.
    return []
  }
}

export async function openPackage(buffer: ArrayBuffer): Promise<OpenedPackage> {
  let entries: Map<string, ZipEntry>
  try {
    entries = readZip(buffer)
  } catch (e) {
    throw new PackageError(
      e instanceof ZipError ? 'that file is not a readable .apkg archive' : String(e),
    )
  }

  const metaEntry = entries.get('meta')
  const meta = metaEntry ? await readEntry(buffer, metaEntry) : null
  const version = detectVersion(entries, meta)
  const compressed = version === PackageVersion.Latest

  const collectionName = COLLECTION_NAMES[version]
  const collectionEntry = entries.get(collectionName)
  if (!collectionEntry) {
    throw new PackageError(`this package declares ${collectionName}, but does not contain it`)
  }

  const raw = await readEntry(buffer, collectionEntry)
  const collection = compressed ? decompress(raw) : raw

  let media: PackageMedia[] = []
  const mediaEntry = entries.get('media')
  if (mediaEntry) {
    const bytes = await readEntry(buffer, mediaEntry)
    media = compressed
      ? // Modern packages name each file by its index in this list.
        decodeMediaEntries(bytes).map((m, i) => ({ entry: String(i), filename: m.name }))
      : readLegacyMedia(bytes)
  }

  return {
    version,
    compressed,
    collection,
    media,
    async readMedia(entry: string) {
      const found = entries.get(entry)
      if (!found) throw new PackageError(`media entry "${entry}" is missing from the package`)
      const bytes = await readEntry(buffer, found)
      return compressed ? decompress(bytes) : bytes
    },
  }
}
