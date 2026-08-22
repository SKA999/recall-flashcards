// Delimited-text parsing for CSV/TSV imports. Pure, dependency-free, and
// deliberately strict about quoting — a parser that splits on commas would
// silently corrupt any field containing one.
//
// Anki's own text exports are supported: it writes `#key:value` lines at the
// top of the file. See https://docs.ankiweb.net/importing/text-files.html

/** Named separators Anki accepts, plus the literal characters. */
const NAMED_SEPARATORS: Record<string, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
  space: ' ',
  pipe: '|',
  colon: ':',
}

const CANDIDATES = ['\t', ',', ';', '|']

export interface AnkiCsvMeta {
  separator?: string
  /** Fields are HTML rather than plain text. */
  html?: boolean
  /** Tags applied to every note in the file. */
  tags?: string[]
  /** Column names declared in the header. */
  columns?: string[]
  /** 1-based column index holding per-note tags. */
  tagsColumn?: number
  deck?: string
  notetype?: string
}

export interface ParsedDelimited {
  rows: string[][]
  meta: AnkiCsvMeta
  delimiter: string
  /** Lines that produced a different column count than the first row. */
  raggedRows: number
}

/** Strip a UTF-8 BOM, which Excel writes and which otherwise poisons the first header. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Read Anki's `#key:value` preamble. Returns the metadata and the offset where
 * the actual records begin.
 */
export function readAnkiHeader(text: string): { meta: AnkiCsvMeta; offset: number } {
  const meta: AnkiCsvMeta = {}
  let offset = 0

  while (offset < text.length && text[offset] === '#') {
    let end = text.indexOf('\n', offset)
    if (end === -1) end = text.length
    const line = text.slice(offset + 1, end).replace(/\r$/, '')
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).trim().toLowerCase()
      const value = line.slice(colon + 1).trim()
      switch (key) {
        case 'separator':
          meta.separator = NAMED_SEPARATORS[value.toLowerCase()] ?? value
          break
        case 'html':
          meta.html = value.toLowerCase() === 'true'
          break
        case 'tags':
          meta.tags = value.split(/\s+/).filter(Boolean)
          break
        case 'deck':
          meta.deck = value
          break
        case 'notetype':
          meta.notetype = value
          break
        case 'tags column':
          meta.tagsColumn = Number(value) || undefined
          break
        case 'columns':
          // Split with whatever separator was declared above it.
          meta.columns = parseRows(value, meta.separator ?? ',')[0]
          break
      }
    }
    offset = end + 1
  }

  return { meta, offset }
}

/**
 * Guess the delimiter by which candidate yields the most consistent column
 * count across the first few records. Consistency matters more than frequency:
 * prose full of commas still splits into ragged rows.
 */
export function detectDelimiter(text: string): string {
  let best = ','
  let bestScore = -1
  for (const candidate of CANDIDATES) {
    const rows = parseRows(text, candidate).slice(0, 20).filter((r) => r.length > 0)
    if (rows.length === 0) continue
    const width = rows[0].length
    if (width < 2) continue
    const consistent = rows.filter((r) => r.length === width).length / rows.length
    // Prefer consistency, break ties on how many columns it finds.
    const score = consistent * 100 + Math.min(width, 10)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** RFC 4180 parser: quoted fields may hold delimiters, newlines and "" escapes. */
export function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
    started = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"' && !started) {
      quoted = true
      started = true
      i++
      continue
    }
    if (char === delimiter) {
      endField()
      i++
      continue
    }
    if (char === '\r') {
      // Swallow CRLF as a single break.
      if (text[i + 1] === '\n') i++
      endRow()
      i++
      continue
    }
    if (char === '\n') {
      endRow()
      i++
      continue
    }

    field += char
    started = true
    i++
  }

  // A trailing newline shouldn't manufacture an empty final record.
  if (field !== '' || row.length > 0) endRow()

  return rows
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
  laquo: '\u00ab',
  raquo: '\u00bb',
  times: '\u00d7',
  deg: '\u00b0',
  middot: '\u00b7',
}

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g

/**
 * Decode one entity. Done in a single pass over the string, so `&amp;lt;`
 * yields the literal `&lt;` rather than being decoded twice into `<`.
 * Anything unrecognised is left exactly as it was found.
 */
function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const code =
      body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match
}

/** Convert Anki's HTML fields to the plain text this app renders. */
export function htmlToText(value: string): string {
  return (
    value
      .replace(/<br\s*\/?>/gi, '\n')
      // Anki wraps each line in its own block, so a </div><div> boundary is one
      // line break, not two.
      .replace(/<\/(?:div|p|li|tr)>\s*<(?:div|p|li|tr)[^>]*>/gi, '\n')
      .replace(/<\/(?:div|p|li|tr)>/gi, '\n')
      .replace(/<(?:div|p|li|tr)[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(ENTITY, decodeEntity)
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

export interface ParseOptions {
  /** Override the detected delimiter. */
  delimiter?: string
}

/** Parse a whole file: Anki preamble, delimiter, records. */
export function parseDelimited(input: string, options: ParseOptions = {}): ParsedDelimited {
  const text = stripBom(input)
  const { meta, offset } = readAnkiHeader(text)
  const body = text.slice(offset)
  const delimiter = options.delimiter ?? meta.separator ?? detectDelimiter(body)

  // Drop rows that are entirely empty — trailing blank lines, mostly.
  const all = parseRows(body, delimiter).filter((r) => r.some((f) => f.trim() !== ''))
  const width = all.length ? all[0].length : 0
  const raggedRows = all.filter((r) => r.length !== width).length

  return { rows: all, meta, delimiter, raggedRows }
}

/**
 * Words that appear as column headings across the decks people actually
 * import - card sides, annotations, media columns and section labels.
 */
const KNOWN_HEADINGS =
  /^(front|back|question|answer|term|definition|tags?|word|words|meaning|translation|phrase|sentence|example|notes?|hint|reading|pronunciation|pinyin|romaji|jyutping|zhuyin|bopomofo|furigana|audio|sound|image|picture|media|week|month|unit|lesson|chapter|section|topic|level|deck|english|chinese|mandarin|japanese|korean|spanish|french|german|italian)\b/i

/** Something with a file extension, e.g. "audio/ni-hao.mp3". */
const FILENAME = /\.[a-z0-9]{2,5}$/i

/**
 * Does the first row look like column names rather than data? Headings are
 * short, non-empty, and distinct.
 */
export function looksLikeHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const first = rows[0]
  if (first.some((f) => f.trim() === '')) return false
  if (first.some((f) => f.length > 40 || f.includes('\n'))) return false
  if (new Set(first.map((f) => f.toLowerCase().trim())).size !== first.length) return false

  if (first.some((f) => KNOWN_HEADINGS.test(f.trim()))) return true

  const second = rows[1]

  // A column whose data are filenames but whose first row is not: that first
  // row is a heading. "Chinese audio" above "audio/xuexiao.wav" is the case.
  const looksLikeFile = (v: string) => FILENAME.test(v.trim())
  for (let i = 0; i < first.length; i++) {
    if (looksLikeFile(second[i] ?? '') && !looksLikeFile(first[i] ?? '')) return true
  }

  // Otherwise: headings rarely look like the data beneath them.
  const numeric = (v: string) => /^-?\d+([.,]\d+)?$/.test(v.trim())
  return second.filter(numeric).length > first.filter(numeric).length
}
