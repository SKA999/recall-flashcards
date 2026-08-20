// Minimal ZIP writer, the counterpart to zip.ts.
//
// Backups are written as a zip so the file is inspectable with any unzip tool
// rather than being an opaque blob, and so media rides along as raw bytes
// instead of base64 - which would inflate every image and sound by a third.
//
// Deflate comes from the platform's CompressionStream, so there is still no
// compression dependency.

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

/**
 * General purpose bit 11, the language encoding flag. Without it a reader is
 * entitled to decode filenames as CP437, which turns any non-ASCII name into
 * mojibake everywhere except in our own reader.
 */
const FLAG_UTF8 = 0x0800

/** Zip's 32-bit size fields; beyond this a writer must emit zip64. */
const MAX_SIZE = 0xfffffffe

export class ZipWriteError extends Error {}

export interface FileToZip {
  name: string
  bytes: Uint8Array
  /**
   * Compress this entry. Leave off for data that is already compressed - PNG,
   * JPEG, MP3 - where deflate costs time and saves nothing.
   */
  compress?: boolean
}

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[i] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

interface Staged {
  name: Uint8Array
  method: number
  crc: number
  compressed: Uint8Array
  uncompressedSize: number
  offset: number
}

/** Build a zip archive in memory. */
export async function writeZip(files: FileToZip[]): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const staged: Staged[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const compressed = file.compress ? await deflateRaw(file.bytes) : file.bytes
    // Deflate can inflate incompressible input; store it instead when it does.
    const useDeflate = file.compress === true && compressed.length < file.bytes.length
    const payload = useDeflate ? compressed : file.bytes

    if (file.bytes.length > MAX_SIZE || offset > MAX_SIZE) {
      throw new ZipWriteError('archive is too large to write without zip64 support')
    }

    staged.push({
      name,
      method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
      crc: crc32(file.bytes),
      compressed: payload,
      uncompressedSize: file.bytes.length,
      offset,
    })
    offset += 30 + name.length + payload.length
  }

  const centralSize = staged.reduce((sum, s) => sum + 46 + s.name.length, 0)
  const total = offset + centralSize + 22
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let at = 0

  const u16 = (v: number) => {
    view.setUint16(at, v, true)
    at += 2
  }
  const u32 = (v: number) => {
    view.setUint32(at, v, true)
    at += 4
  }
  const raw = (bytes: Uint8Array) => {
    out.set(bytes, at)
    at += bytes.length
  }

  for (const s of staged) {
    u32(SIG_LOCAL)
    u16(20) // version needed
    u16(FLAG_UTF8)
    u16(s.method)
    u16(0) // mod time
    u16(0) // mod date
    u32(s.crc)
    u32(s.compressed.length)
    u32(s.uncompressedSize)
    u16(s.name.length)
    u16(0) // extra length
    raw(s.name)
    raw(s.compressed)
  }

  const centralStart = at
  for (const s of staged) {
    u32(SIG_CENTRAL)
    u16(20) // version made by
    u16(20) // version needed
    u16(FLAG_UTF8)
    u16(s.method)
    u16(0) // mod time
    u16(0) // mod date
    u32(s.crc)
    u32(s.compressed.length)
    u32(s.uncompressedSize)
    u16(s.name.length)
    u16(0) // extra length
    u16(0) // comment length
    u16(0) // disk number
    u16(0) // internal attributes
    u32(0) // external attributes
    u32(s.offset)
    raw(s.name)
  }

  // Capture the size before the EOCD write moves the cursor past it.
  const centralSizeWritten = at - centralStart

  u32(SIG_EOCD)
  u16(0) // disk number
  u16(0) // disk with central directory
  u16(staged.length)
  u16(staged.length)
  u32(centralSizeWritten)
  u32(centralStart)
  u16(0) // comment length

  return out
}
