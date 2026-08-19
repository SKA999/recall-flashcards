// Minimal ZIP reader. The browser can inflate for us via DecompressionStream,
// so all this has to do is walk the central directory and hand back entries —
// no dependency required.
//
// Only the two methods ZIP actually uses in practice are supported: stored (0)
// and deflate (8). Anything else throws rather than returning wrong bytes.

const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/** Marker meaning "the real value is in the Zip64 extra field". */
const U32_MAX = 0xffffffff
const U16_MAX = 0xffff

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipError extends Error {}

/** Locate the End Of Central Directory record, which sits at the very end. */
function findEocd(view: DataView): number {
  // The EOCD is 22 bytes plus a comment of up to 64KB.
  const min = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i
  }
  throw new ZipError('not a zip file: no end-of-central-directory record')
}

interface Directory {
  offset: number
  count: number
}

function readDirectoryLocation(view: DataView): Directory {
  const eocd = findEocd(view)
  let count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)

  // Zip64: the 32-bit fields saturate and the real values live in a separate
  // record. Getting this wrong silently truncates a large archive.
  if (count === U16_MAX || offset === U32_MAX) {
    const locator = eocd - 20
    if (locator < 0 || view.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) {
      throw new ZipError('zip64 archive without a locator record')
    }
    const eocd64 = Number(view.getBigUint64(locator + 8, true))
    if (view.getUint32(eocd64, true) !== SIG_EOCD64) {
      throw new ZipError('zip64 end-of-central-directory record not found')
    }
    count = Number(view.getBigUint64(eocd64 + 32, true))
    offset = Number(view.getBigUint64(eocd64 + 48, true))
  }

  return { offset, count }
}

/**
 * Pull the true sizes and offset out of a Zip64 extra field when the 32-bit
 * header fields are saturated. Order is fixed: uncompressed, compressed,
 * offset — and only the saturated ones are present.
 */
function applyZip64Extra(
  extra: DataView,
  entry: { compressedSize: number; uncompressedSize: number; localHeaderOffset: number },
) {
  let at = 0
  while (at + 4 <= extra.byteLength) {
    const id = extra.getUint16(at, true)
    const size = extra.getUint16(at + 2, true)
    if (id === 0x0001) {
      let field = at + 4
      if (entry.uncompressedSize === U32_MAX) {
        entry.uncompressedSize = Number(extra.getBigUint64(field, true))
        field += 8
      }
      if (entry.compressedSize === U32_MAX) {
        entry.compressedSize = Number(extra.getBigUint64(field, true))
        field += 8
      }
      if (entry.localHeaderOffset === U32_MAX) {
        entry.localHeaderOffset = Number(extra.getBigUint64(field, true))
      }
      return
    }
    at += 4 + size
  }
}

/** Read an archive's table of contents. Entry data is fetched on demand. */
export function readZip(buffer: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const { offset, count } = readDirectoryLocation(view)
  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()

  let at = offset
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError(`corrupt central directory at entry ${i}`)
    }
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)

    const entry: ZipEntry = {
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
      localHeaderOffset: view.getUint32(at + 42, true),
    }

    if (
      entry.compressedSize === U32_MAX ||
      entry.uncompressedSize === U32_MAX ||
      entry.localHeaderOffset === U32_MAX
    ) {
      applyZip64Extra(new DataView(buffer, at + 46 + nameLength, extraLength), entry)
    }

    entries.set(entry.name, entry)
    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Decompress one entry. The local header is re-read because its extra field
 *  length can differ from the central directory's. */
export async function readEntry(buffer: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer)
  const at = entry.localHeaderOffset
  if (view.getUint32(at, true) !== SIG_LOCAL) {
    throw new ZipError(`corrupt local header for "${entry.name}"`)
  }
  const nameLength = view.getUint16(at + 26, true)
  const extraLength = view.getUint16(at + 28, true)
  const start = at + 30 + nameLength + extraLength
  const raw = new Uint8Array(buffer, start, entry.compressedSize)

  if (entry.method === METHOD_STORE) return raw.slice()
  if (entry.method === METHOD_DEFLATE) return inflateRaw(raw)
  throw new ZipError(`unsupported compression method ${entry.method} for "${entry.name}"`)
}
