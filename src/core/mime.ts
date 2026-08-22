// Working out what a media file is.
//
// A file picker only supplies a MIME type when the operating system has a
// mapping for the extension, and for audio it often doesn't - .opus, .flac,
// .m4a and .aac all commonly arrive with an empty type. Falling back to
// application/octet-stream would render a playable sound as a download link,
// so the extension is consulted instead.

export type MediaKind = 'image' | 'audio' | 'video' | 'other'

const BY_EXTENSION: Record<string, string> = {
  // audio
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  weba: 'audio/webm',
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  // video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
}

const FALLBACK = 'application/octet-stream'

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * The MIME type to store for a file. A type the browser supplied wins, unless
 * it is the generic fallback, in which case the extension gets a say.
 */
export function guessMime(filename: string, declared?: string): string {
  const supplied = (declared ?? '').trim().toLowerCase()
  if (supplied && supplied !== FALLBACK) return supplied
  return BY_EXTENSION[extensionOf(filename)] ?? FALLBACK
}

export function mediaKind(mime: string): MediaKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'other'
}
