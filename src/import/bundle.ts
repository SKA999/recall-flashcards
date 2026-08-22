// Reading an import bundle: a table of cards plus the media it refers to.
//
// Two shapes are accepted, because people have both:
//   - one .zip holding a CSV/TSV and a folder of media
//   - a multi-selection of the same files, picked straight from a folder
//
// Either way the result is one table and a pile of media, keyed by filename so
// a cell saying "ni-hao.mp3" can be resolved to the file of that name.

import { mediaToken } from '../core/notes'
import { guessMime, mediaKind } from '../core/mime'
import { convertField, referencedMedia } from './fields'
import { readEntry, readZip, ZipError } from './zip'

export class BundleError extends Error {}

export interface BundleMedia {
  /** Name as it appeared, including any folder: "audio/ni-hao.mp3". */
  path: string
  /** Just the filename: "ni-hao.mp3". */
  name: string
  mime: string
  bytes: Uint8Array
}

export interface Bundle {
  /** The delimited file the cards come from. */
  table: { name: string; text: string }
  media: BundleMedia[]
  /** Names that were neither a table nor usable media. */
  ignored: string[]
  /** True when this came out of a zip rather than a multi-selection. */
  fromZip: boolean
}

const TABLE_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'tab'])

/** Zip and macOS bookkeeping that should never be treated as content. */
function isJunk(path: string): boolean {
  const name = basename(path)
  return (
    path.endsWith('/') ||
    path.startsWith('__MACOSX/') ||
    path.includes('/__MACOSX/') ||
    name.startsWith('._') ||
    name === '.DS_Store' ||
    name === 'Thumbs.db' ||
    name === ''
  )
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

interface RawFile {
  path: string
  bytes: Uint8Array
}

function classify(files: RawFile[], fromZip: boolean): Bundle {
  const tables: { name: string; bytes: Uint8Array }[] = []
  const media: BundleMedia[] = []
  const ignored: string[] = []

  for (const file of files) {
    if (isJunk(file.path)) continue
    const name = basename(file.path)
    const extension = extensionOf(name)

    if (TABLE_EXTENSIONS.has(extension)) {
      tables.push({ name, bytes: file.bytes })
      continue
    }

    const mime = guessMime(name)
    if (mediaKind(mime) === 'other') {
      ignored.push(name)
      continue
    }
    media.push({ path: file.path, name, mime, bytes: file.bytes })
  }

  if (tables.length === 0) {
    throw new BundleError(
      'no CSV or TSV file found. A bundle needs one table of cards alongside its media.',
    )
  }
  if (tables.length > 1) {
    throw new BundleError(
      `found ${tables.length} table files (${tables.map((t) => t.name).join(', ')}). Include only one.`,
    )
  }

  return {
    table: { name: tables[0].name, text: new TextDecoder().decode(tables[0].bytes) },
    media,
    ignored,
    fromZip,
  }
}

/**
 * Read a bundle from whatever the user picked. A single zip is expanded; any
 * other selection is taken at face value.
 */
export async function readBundle(files: File[]): Promise<Bundle> {
  if (files.length === 0) throw new BundleError('no files selected')

  const single = files.length === 1 ? files[0] : null
  const looksLikeZip = single && (extensionOf(single.name) === 'zip' || single.type === 'application/zip')

  if (looksLikeZip) {
    const buffer = await single.arrayBuffer()
    let entries
    try {
      entries = readZip(buffer)
    } catch (e) {
      throw new BundleError(
        e instanceof ZipError ? 'that zip could not be read' : String(e),
      )
    }
    const raw: RawFile[] = []
    for (const entry of entries.values()) {
      if (isJunk(entry.name)) continue
      raw.push({ path: entry.name, bytes: await readEntry(buffer, entry) })
    }
    return classify(raw, true)
  }

  const raw: RawFile[] = []
  for (const file of files) {
    // A folder selection reports its path in webkitRelativePath.
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    raw.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) })
  }
  return classify(raw, false)
}

/**
 * Index media by filename for cell lookups. Matching ignores case and any
 * folder, because a spreadsheet cell says "ni-hao.mp3" while the file may sit
 * at "audio/Ni-Hao.mp3".
 */
export function mediaIndex(media: BundleMedia[]): Map<string, BundleMedia> {
  const index = new Map<string, BundleMedia>()
  for (const item of media) {
    // Both forms are registered, because a spreadsheet cell may say either
    // "ni-hao.mp3" or "audio/ni-hao.mp3" depending on how it was written.
    // First occurrence wins, so a duplicate name deeper in the tree cannot
    // silently replace the one already found.
    for (const key of [item.name.toLowerCase(), item.path.toLowerCase()]) {
      if (!index.has(key)) index.set(key, item)
    }
  }
  return index
}

const FILENAME = /\.[a-z0-9]{2,5}$/i

/**
 * Filenames a cell might be asking for, before we know what the bundle holds.
 * Used to work out which media to store, so an unreferenced file in the bundle
 * is not imported.
 */
export function cellMediaNames(value: string): string[] {
  const trimmed = value.trim()
  const names = referencedMedia(value)
  if (trimmed && !/[<[]/.test(trimmed) && FILENAME.test(trimmed) && !names.includes(trimmed)) {
    names.unshift(trimmed)
  }
  return names
}

export interface ConvertedCell {
  text: string
  /** True when the cell named a media file rather than carrying text. */
  usedMedia: boolean
}

/**
 * Turn one spreadsheet cell into field text.
 *
 * Three cases, in order: the whole cell is a filename ("ni-hao.mp3"); the cell
 * embeds a reference the Anki way ("[sound:ni-hao.mp3]" or an <img> tag); or it
 * is ordinary text, which is handed back untouched for the caller to clean.
 *
 * `resolve` maps a filename to a stored media id.
 */
export function convertCell(
  value: string,
  resolve: (filename: string) => string | undefined,
  missing?: Set<string>,
): ConvertedCell {
  const trimmed = value.trim()
  if (trimmed === '') return { text: '', usedMedia: false }

  // A bare filename is the common case for a dedicated audio column.
  if (!/[<[]/.test(trimmed) && /\.[a-z0-9]{2,5}$/i.test(trimmed)) {
    const id = resolve(trimmed)
    if (id) return { text: mediaToken(id), usedMedia: true }
    // Looks like a filename but isn't in the bundle - worth reporting rather
    // than silently importing the filename as if it were the answer.
    if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|png|jpe?g|gif|webp|avif|svg|bmp|mp4|m4v|mov|webm|ogv|mkv)$/i.test(trimmed)) {
      missing?.add(trimmed)
      return { text: '', usedMedia: true }
    }
  }

  if (referencedMedia(value).length > 0) {
    return { text: convertField(value, resolve, missing), usedMedia: true }
  }

  return { text: value, usedMedia: false }
}
