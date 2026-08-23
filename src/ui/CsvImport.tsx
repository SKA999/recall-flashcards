import { useMemo, useRef, useState } from 'react'
import type { Go } from '../App'
import { newId } from '../core/ids'
import { plainText, toTag } from '../core/notes'
import { looksLikeSectionColumn } from '../core/sections'
import type { Notetype } from '../core/types'
import { cellMediaNames, convertCell, mediaIndex, readBundle } from '../import/bundle'
import type { Bundle } from '../import/bundle'
import { htmlToText, looksLikeHeader, parseDelimited } from '../import/csv'
import type { ParsedDelimited } from '../import/csv'
import { useApp } from '../data/store'

/**
 * What a column becomes. With an existing note type these are its field
 * indexes; with a new one they are simply which side of the card the column
 * belongs on.
 */
const IGNORE = 'ignore'
const TAGS = 'tags'
/** One tag for the whole cell - a week or unit label, not a list. */
const SECTION = 'section'
const QUESTION = 'question'
const ANSWER = 'answer'
const fieldRole = (index: number) => `f${index}`
const roleFieldIndex = (role: string) => (role.startsWith('f') ? Number(role.slice(1)) : -1)

/** Sentinel for "build a note type out of these columns". */
const NEW_TYPE = '__new__'

/** Headers that annotate a neighbouring column rather than stand on their own. */
const ANNOTATION = /^(pinyin|hanyu ?pinyin|romaji|romanisation|romanization|reading|readings|pronunciation|furigana|jyutping|zhuyin|bopomofo|transliteration|ipa)$/i

/** Headers that name a section of the deck rather than card content. */
const SECTION_HEADER = /^(week|month|unit|lesson|chapter|section|term|topic|set|day)\b/i

/** Headers that hold tags. Singular included: spreadsheets use both. */
const TAG_HEADER = /^tags?$/i



const DELIMITERS = [
  { value: ',', label: 'Comma' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' },
]

interface Report {
  added: number
  skippedDuplicate: number
  skippedEmpty: number
  deckName: string
  mediaAdded: number
  missingMedia: string[]
}

export function CsvImport({ go }: { go: Go }) {
  const { decks, notes, notetypes, notetype, createDeck, addNotes, addMedia, saveNotetype } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [delimiter, setDelimiter] = useState<string | undefined>(undefined)
  const [hasHeader, setHasHeader] = useState(true)
  const [roles, setRoles] = useState<string[]>([])
  const [notetypeId, setNotetypeId] = useState('basic')
  const [newTypeName, setNewTypeName] = useState('')
  const [target, setTarget] = useState('new')
  const [newDeckName, setNewDeckName] = useState('')
  const [stripHtml, setStripHtml] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  const creatingType = notetypeId === NEW_TYPE
  const type = creatingType ? null : notetype(notetypeId)

  const parsed: ParsedDelimited | null = useMemo(() => {
    if (!bundle) return null
    try {
      return parseDelimited(bundle.table.text, { delimiter })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that file')
      return null
    }
  }, [bundle, delimiter])

  const index = useMemo(() => (bundle ? mediaIndex(bundle.media) : new Map()), [bundle])
  const columnCount = parsed?.rows[0]?.length ?? 0
  const headerRow = parsed && hasHeader ? parsed.rows[0] : null
  const dataRows = useMemo(
    () => (parsed ? (hasHeader ? parsed.rows.slice(1) : parsed.rows) : []),
    [parsed, hasHeader],
  )

  const load = async (files: File[]) => {
    setError(null)
    setReport(null)
    try {
      const read = await readBundle(files)
      const first = parseDelimited(read.table.text)
      setBundle(read)
      setSourceName(files.length === 1 ? files[0].name : `${files.length} files`)
      setDelimiter(undefined)
      setHasHeader(first.meta.columns ? false : looksLikeHeader(first.rows))
      setStripHtml(first.meta.html ?? false)
      if (first.meta.deck) setNewDeckName(first.meta.deck)

      const width = first.rows[0]?.length ?? 0
      const names = first.meta.columns ?? (looksLikeHeader(first.rows) ? first.rows[0] : [])
      const tagsIndex = first.meta.tagsColumn
        ? first.meta.tagsColumn - 1
        : names.findIndex((n) => TAG_HEADER.test((n ?? '').trim()))
      const body = looksLikeHeader(first.rows) ? first.rows.slice(1) : first.rows
      const columnValues = (i: number) => body.map((r) => r[i] ?? '')

      // A bundle with media is almost always a multi-column deck, so default to
      // building a note type from the columns rather than squeezing into Basic.
      const wantsNewType = read.media.length > 0 || width > 2
      setNotetypeId(wantsNewType ? NEW_TYPE : 'basic')
      if (wantsNewType && !newTypeName) {
        setNewTypeName(read.table.name.replace(/\.[^.]+$/, '') || 'Imported')
      }

      if (wantsNewType) {
        // First column asks, the rest answer - the shape of nearly every deck.
        const guess: string[] = Array.from({ length: width }, (_, i) =>
          i === tagsIndex ? TAGS : i === 0 ? QUESTION : ANSWER,
        )
        // A column named for a week or unit is a section of the deck, not
        // something to show on a card - and a tag column whose contents look
        // like section labels is one too.
        for (let i = 0; i < width; i++) {
          const label = (names[i] ?? '').trim()
          if (SECTION_HEADER.test(label)) guess[i] = SECTION
          else if (guess[i] === TAGS && looksLikeSectionColumn(columnValues(i))) guess[i] = SECTION
        }
        // An annotation follows the column it annotates: Pinyin sits with the
        // Chinese, not on the back by default.
        for (let i = 1; i < width; i++) {
          if (guess[i] === TAGS || guess[i] === SECTION) continue
          if (ANNOTATION.test((names[i] ?? '').trim())) guess[i] = guess[i - 1]
        }
        // Then let a companion column follow its parent: "Chinese audio"
        // belongs on whichever side "Chinese" is on, not automatically the back.
        const labels = names.map((n) => (n ?? '').toLowerCase().trim())
        for (let i = 0; i < width; i++) {
          if (guess[i] === TAGS || guess[i] === SECTION || !labels[i]) continue
          for (let j = 0; j < width; j++) {
            if (i === j || guess[j] === TAGS || guess[j] === SECTION || labels[j].length < 2) continue
            if (labels[i] !== labels[j] && labels[i].includes(labels[j])) {
              guess[i] = guess[j]
              break
            }
          }
        }
        setRoles(guess)
      } else {
        const fieldCount = notetype('basic').fields.length
        let next = 0
        setRoles(
          Array.from({ length: width }, (_, i) =>
            i === tagsIndex ? TAGS : next < fieldCount ? fieldRole(next++) : IGNORE,
          ),
        )
      }
    } catch (e) {
      setBundle(null)
      setError(e instanceof Error ? e.message : 'could not read that file')
    }
  }

  const setRole = (i: number, role: string) =>
    setRoles((current) => current.map((r, at) => (at === i ? role : r)))

  /** Column order for the fields of whichever note type we end up using. */
  const columnForField: number[] = creatingType
    ? roles.flatMap((r, i) => (r === QUESTION || r === ANSWER ? [i] : []))
    : (type?.fields.map((_, f) => roles.findIndex((r) => roleFieldIndex(r) === f)) ?? [])

  const tagColumns = roles.flatMap((r, i) => (r === TAGS ? [i] : []))
  const sectionColumns = roles.flatMap((r, i) => (r === SECTION ? [i] : []))
  const ready = columnForField.some((c) => c >= 0) && dataRows.length > 0

  const columnLabel = (i: number) => headerRow?.[i]?.trim() || `Column ${i + 1}`

  const clean = (value: string | undefined) => {
    const raw = value ?? ''
    return stripHtml ? htmlToText(raw) : raw.trim()
  }

  /** What a cell will look like once imported, for the preview table. */
  const sectionPreview = useMemo(() => {
    if (!sectionColumns.length) return []
    const seen = new Set<string>()
    for (const row of dataRows) {
      for (const i of sectionColumns) {
        const tag = toTag(row[i] ?? '')
        if (tag) seen.add(tag)
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [dataRows, sectionColumns])

  const previewCell = (value: string | undefined) => {
    const names = cellMediaNames(value ?? '')
    const hit = names.find((n) => index.has(n.toLowerCase()))
    if (hit) return `♪ ${hit}`
    return clean(value).slice(0, 60)
  }

  const runImport = async () => {
    if (!ready || busy || !parsed) return
    setBusy(true)
    setError(null)
    try {
      let deckId = target
      let deckName = decks.find((d) => d.id === target)?.name ?? newDeckName.trim()
      if (target === 'new') {
        const deck = await createDeck(newDeckName.trim() || 'Imported deck')
        deckId = deck.id
        deckName = deck.name
      }

      // Build the note type first: everything below indexes into its fields.
      let useTypeId = notetypeId
      if (creatingType) {
        const questionFields: number[] = []
        const answerFields: number[] = []
        columnForField.forEach((column, fieldIndex) => {
          if (roles[column] === QUESTION) questionFields.push(fieldIndex)
          else answerFields.push(fieldIndex)
        })
        const created: Notetype = {
          id: newId(),
          name: newTypeName.trim() || 'Imported note type',
          fields: columnForField.map((c) => columnLabel(c)),
          templates: [
            {
              name: 'Card 1',
              question: questionFields.length ? questionFields : [0],
              answer: answerFields.length ? answerFields : [1],
            },
          ],
          isCloze: false,
          created: Date.now(),
          updated: Date.now(),
        }
        await saveNotetype(created)
        useTypeId = created.id
      }

      // Store only the media the table actually refers to.
      const wanted = new Set<string>()
      for (const row of dataRows) {
        for (const cell of row) {
          for (const name of cellMediaNames(cell ?? '')) {
            const key = name.toLowerCase()
            if (index.has(key)) wanted.add(key)
          }
        }
      }
      const idByName = new Map<string, string>()
      for (const key of wanted) {
        const item = index.get(key)!
        const file = new File([item.bytes as BlobPart], item.name, { type: item.mime })
        idByName.set(key, await addMedia(deckId, file))
      }
      const resolve = (name: string) => idByName.get(name.trim().toLowerCase())

      const existing = new Set(
        notes.filter((n) => n.deckId === deckId).map((n) => plainText(n.fields[0] ?? '').toLowerCase()),
      )
      const fileTags = parsed.meta.tags ?? []
      const missingMedia = new Set<string>()
      const inputs = []
      let skippedDuplicate = 0
      let skippedEmpty = 0

      for (const row of dataRows) {
        const fields = columnForField.map((column) => {
          if (column < 0) return ''
          const converted = convertCell(row[column] ?? '', resolve, missingMedia)
          return converted.usedMedia ? converted.text : clean(converted.text)
        })
        if (fields.every((f) => f === '')) {
          skippedEmpty++
          continue
        }
        const key = plainText(fields[0]).toLowerCase()
        if (skipDuplicates && key && existing.has(key)) {
          skippedDuplicate++
          continue
        }
        if (key) existing.add(key)
        const rowTags = tagColumns.flatMap((i) => (row[i] ?? '').split(/[\s,]+/)).filter(Boolean)
        // A section cell is one tag, whitespace and all: "Week 3" -> "Week-3".
        const sectionTags = sectionColumns.map((i) => toTag(row[i] ?? '')).filter(Boolean)
        inputs.push({
          deckId,
          notetypeId: useTypeId,
          fields,
          tags: [...new Set([...fileTags, ...rowTags, ...sectionTags])],
        })
      }

      const added = await addNotes(inputs)
      setReport({
        added,
        skippedDuplicate,
        skippedEmpty,
        deckName,
        mediaAdded: idByName.size,
        missingMedia: [...missingMedia],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'import failed')
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button className="btn ghost back" onClick={() => go({ name: 'decks' })}>
      <span aria-hidden="true">←</span>
      <span className="name">Decks</span>
    </button>
  )

  if (report) {
    return (
      <div className="app">
        <header className="topbar">
          {back}
          <div className="spacer" />
        </header>
        <div className="card chart">
          <h3>Imported</h3>
          <div className="stack" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 650 }}>
              {report.added} card{report.added === 1 ? '' : 's'} added to {report.deckName}
            </div>
            {report.mediaAdded > 0 && (
              <div className="tiny muted">
                {report.mediaAdded} media file{report.mediaAdded === 1 ? '' : 's'} imported with them.
              </div>
            )}
            {report.skippedDuplicate > 0 && (
              <div className="tiny muted">
                {report.skippedDuplicate} skipped as duplicates of cards already in the deck.
              </div>
            )}
            {report.skippedEmpty > 0 && (
              <div className="tiny muted">{report.skippedEmpty} empty rows skipped.</div>
            )}
            {report.missingMedia.length > 0 && (
              <div className="notice">
                {report.missingMedia.length} file
                {report.missingMedia.length === 1 ? ' was' : 's were'} named in the table but not
                found in the bundle: {report.missingMedia.slice(0, 4).join(', ')}
                {report.missingMedia.length > 4 ? '…' : ''}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => go({ name: 'decks' })}>
                Done
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReport(null)
                  setBundle(null)
                }}
              >
                Import another
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        {back}
        <div className="grow">
          <h1>Import cards</h1>
        </div>
      </header>

      <div className="card stack" style={{ padding: 16 }}>
        <div className="row wrap">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Choose files
          </button>
          <span className="tiny muted grow">
            {bundle ? sourceName : 'A CSV or TSV on its own, or a zip holding one plus its media'}
          </span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.zip,audio/*,image/*,video/*,text/csv,text/plain,application/zip,application/x-zip-compressed,application/octet-stream"
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              if (files.length) void load(files)
              e.target.value = ''
            }}
          />
        </div>
        <div className="tiny muted">
          To bring audio or pictures in, put them beside the table and refer to them by filename —
          a cell reading <code>ni-hao.mp3</code> becomes that sound. You can select the table and
          its media together, or zip them up first.
        </div>
        {error && <div className="notice">{error}</div>}
      </div>

      {parsed && bundle && (
        <>
          <section className="card chart" style={{ marginTop: 16 }}>
            <div className="row wrap">
              <div className="grow">
                <h3>What the file looks like</h3>
                <div className="tiny muted">
                  {dataRows.length} row{dataRows.length === 1 ? '' : 's'} · {columnCount} column
                  {columnCount === 1 ? '' : 's'}
                  {bundle.media.length > 0 && ` · ${bundle.media.length} media files alongside`}
                  {parsed.raggedRows > 0 &&
                    ` · ${parsed.raggedRows} row${parsed.raggedRows === 1 ? '' : 's'} with a different column count`}
                </div>
              </div>
              <label className="field">
                Separator
                <select
                  value={parsed.delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                  style={{ width: 'auto' }}
                >
                  {DELIMITERS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ overflowX: 'auto', marginTop: 14 }}>
              <table className="viz-table preview">
                <thead>
                  <tr>
                    {Array.from({ length: columnCount }, (_, i) => (
                      <th key={i}>
                        <select value={roles[i] ?? IGNORE} onChange={(e) => setRole(i, e.target.value)}>
                          {creatingType ? (
                            <>
                              <option value={QUESTION}>Question side</option>
                              <option value={ANSWER}>Answer side</option>
                            </>
                          ) : (
                            type?.fields.map((name, f) => (
                              <option key={f} value={fieldRole(f)}>
                                {name}
                              </option>
                            ))
                          )}
                          <option value={SECTION}>Section (week / unit)</option>
                          <option value={TAGS}>Tags</option>
                          <option value={IGNORE}>Ignore</option>
                        </select>
                        {headerRow && <div className="tiny muted">{headerRow[i]}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, r) => (
                    <tr key={r}>
                      {Array.from({ length: columnCount }, (_, c) => (
                        <td key={c} className={roles[c] === IGNORE ? 'muted' : undefined}>
                          {previewCell(row[c]) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bundle.media.length > 0 && (
              <div className="tiny muted" style={{ marginTop: 10 }}>
                ♪ marks a cell that resolved to a file in the bundle.
              </div>
            )}
          </section>

          <section className="card chart" style={{ marginTop: 16 }}>
            <h3>Options</h3>
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="row wrap">
                <label className="field grow">
                  Add to
                  <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="new">A new deck…</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                {target === 'new' && (
                  <label className="field grow">
                    New deck name
                    <input
                      type="text"
                      value={newDeckName}
                      placeholder="Imported deck"
                      onChange={(e) => setNewDeckName(e.target.value)}
                    />
                  </label>
                )}
                <label className="field grow">
                  Note type
                  <select
                    value={notetypeId}
                    onChange={(e) => {
                      const id = e.target.value
                      setNotetypeId(id)
                      const keep = (r: string) => r === TAGS || r === SECTION
                      if (id === NEW_TYPE) {
                        setRoles((current) =>
                          current.map((r, i) => (keep(r) ? r : i === 0 ? QUESTION : ANSWER)),
                        )
                      } else {
                        const count = notetype(id).fields.length
                        let next = 0
                        setRoles((current) =>
                          current.map((r) =>
                            keep(r) ? r : next < count ? fieldRole(next++) : IGNORE,
                          ),
                        )
                      }
                    }}
                  >
                    <option value={NEW_TYPE}>Build one from these columns…</option>
                    {notetypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                {creatingType && (
                  <label className="field grow">
                    Note type name
                    <input
                      type="text"
                      value={newTypeName}
                      placeholder="Imported note type"
                      onChange={(e) => setNewTypeName(e.target.value)}
                    />
                  </label>
                )}
              </div>

              {sectionPreview.length > 0 && (
                <div className="tiny muted">
                  {sectionPreview.length} section{sectionPreview.length === 1 ? '' : 's'} found:{' '}
                  {sectionPreview.slice(0, 6).join(', ')}
                  {sectionPreview.length > 6 ? '…' : ''}. You can study one at a time from the deck.
                </div>
              )}

              {creatingType && ready && (
                <div className="tiny muted">
                  Each card will ask{' '}
                  <strong>
                    {roles
                      .flatMap((r, i) => (r === QUESTION ? [columnLabel(i)] : []))
                      .join(' + ') || 'nothing'}
                  </strong>{' '}
                  and answer with{' '}
                  <strong>
                    {roles.flatMap((r, i) => (r === ANSWER ? [columnLabel(i)] : [])).join(' + ') ||
                      'nothing'}
                  </strong>
                  .
                </div>
              )}

              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={hasHeader}
                  onChange={(e) => setHasHeader(e.target.checked)}
                />
                <span className="tiny">First row is column names, not a card</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={stripHtml}
                  onChange={(e) => setStripHtml(e.target.checked)}
                />
                <span className="tiny">Fields contain HTML — convert it to plain text</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span className="tiny">Skip rows whose first field already exists in the deck</span>
              </label>

              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={runImport}>
                  {busy
                    ? 'Importing…'
                    : `Import ${dataRows.length} row${dataRows.length === 1 ? '' : 's'}`}
                </button>
                {!ready && (
                  <span className="tiny muted">Map at least one column onto a field to continue.</span>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
