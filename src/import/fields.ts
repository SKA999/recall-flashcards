// Converting an Anki field's contents into ours.
//
// Anki fields are HTML and reference media two ways: <img src="name"> for
// pictures and video, and [sound:name] for audio. Both become the
// {{media:<id>}} token this app renders, and the remaining markup is flattened
// to text - card content is never rendered as HTML here.

import { mediaToken } from '../core/notes'
import { htmlToText } from './csv'

/**
 * Every media reference, in one pass so their positions are known:
 *   1-3  <img src="x">, quoted either way or bare
 *   4-6  <source src="x"> / <object data="x">
 *   7    [sound:x]
 */
const MEDIA =
  /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>|<(?:source|object)\b[^>]*\b(?:src|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>|\[sound:([^\]]+)\]/gi

const nameOf = (m: RegExpMatchArray): string =>
  m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? ''

/** Anki percent-encodes some filenames in src attributes. */
function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.trim())
  } catch {
    return raw.trim()
  }
}

type Part = { media: false; value: string } | { media: true; value: string }

/**
 * Replace media references with tokens, then flatten the remaining HTML.
 *
 * The field is split on its media references rather than having tokens
 * substituted into it, so flattening the HTML can never mangle a token it just
 * inserted.
 *
 * `resolve` maps an Anki filename to a stored media id. A reference it cannot
 * resolve is dropped rather than left as broken markup, and recorded in
 * `missing` so the import can report what the package was short of.
 */
export function convertField(
  html: string,
  resolve: (filename: string) => string | undefined,
  missing?: Set<string>,
): string {
  const parts: Part[] = []
  let at = 0

  for (const match of html.matchAll(MEDIA)) {
    const index = match.index ?? 0
    parts.push({ media: false, value: html.slice(at, index) })
    at = index + match[0].length

    const name = decodeName(nameOf(match))
    const id = resolve(name)
    if (id) parts.push({ media: true, value: mediaToken(id) })
    else if (name) missing?.add(name)
  }
  parts.push({ media: false, value: html.slice(at) })

  // Text either side of a dropped reference belongs on one line, so merge
  // adjacent text runs before flattening each of them.
  const merged: Part[] = []
  for (const part of parts) {
    const previous = merged[merged.length - 1]
    if (!part.media && previous && !previous.media) previous.value += ` ${part.value}`
    else merged.push({ ...part })
  }

  return merged
    .map((part) => (part.media ? part.value : htmlToText(part.value)))
    .filter((value) => value !== '')
    .join('\n')
}

/** Filenames a field refers to, whether or not the package contains them. */
export function referencedMedia(html: string): string[] {
  const names: string[] = []
  for (const match of html.matchAll(MEDIA)) {
    const name = decodeName(nameOf(match))
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}
