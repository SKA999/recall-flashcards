import { useMemo, useRef, useState } from 'react'
import type { Go } from '../App'
import { htmlToText, looksLikeHeader, parseDelimited } from '../import/csv'
import type { ParsedDelimited } from '../import/csv'
import { plainText } from '../core/notes'
import type { NoteKind } from '../core/types'
import { useApp } from '../data/store'

/** What each column of the file becomes. */
type Role = 'front' | 'back' | 'tags' | 'ignore'

const ROLE_LABELS: Record<Role, string> = {
  front: 'Front',
  back: 'Back',
  tags: 'Tags',
  ignore: 'Ignore',
}

const DELIMITERS: { value: string; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: '\t', label: 'Tab' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' },
]

interface Loaded {
  filename: string
  text: string
}

interface Report {
  added: number
  skippedDuplicate: number
  skippedEmpty: number
  deckName: string
}

export function CsvImport({ go }: { go: Go }) {
  const { decks, notes, createDeck, addNotes } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [delimiter, setDelimiter] = useState<string | undefined>(undefined)
  const [hasHeader, setHasHeader] = useState(true)
  const [roles, setRoles] = useState<Role[]>([])
  const [kind, setKind] = useState<NoteKind>('basic')
  const [target, setTarget] = useState<string>('new')
  const [newDeckName, setNewDeckName] = useState('')
  const [stripHtml, setStripHtml] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed: ParsedDelimited | null = useMemo(() => {
    if (!loaded) return null
    try {
      return parseDelimited(loaded.text, { delimiter })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that file')
      return null
    }
  }, [loaded, delimiter])

  const columnCount = parsed?.rows[0]?.length ?? 0
  const headerRow = parsed && hasHeader ? parsed.rows[0] : null
  const dataRows = useMemo(
    () => (parsed ? (hasHeader ? parsed.rows.slice(1) : parsed.rows) : []),
    [parsed, hasHeader],
  )

  const load = async (file: File) => {
    setError(null)
    setReport(null)
    const text = await file.text()
    const first = parseDelimited(text)
    setLoaded({ filename: file.name, text })
    setDelimiter(undefined)
    setHasHeader(first.meta.columns ? false : looksLikeHeader(first.rows))
    setStripHtml(first.meta.html ?? false)
    if (first.meta.deck) setNewDeckName(first.meta.deck)

    // Default mapping: first column asks, second answers, a column literally
    // called "tags" carries tags, everything else is ignored.
    const width = first.rows[0]?.length ?? 0
    const names = first.meta.columns ?? (looksLikeHeader(first.rows) ? first.rows[0] : [])
    const tagsIndex = first.meta.tagsColumn
      ? first.meta.tagsColumn - 1
      : names.findIndex((n) => n.toLowerCase().trim() === 'tags')
    setRoles(
      Array.from({ length: width }, (_, i): Role => {
        if (i === tagsIndex) return 'tags'
        if (i === 0) return 'front'
        if (i === 1) return 'back'
        return 'ignore'
      }),
    )
  }

  const setRole = (index: number, role: Role) =>
    setRoles((current) => current.map((r, i) => (i === index ? role : r)))

  const frontIndex = roles.indexOf('front')
  const backIndex = roles.indexOf('back')
  const tagIndexes = roles.flatMap((r, i) => (r === 'tags' ? [i] : []))
  const ready = frontIndex >= 0 && backIndex >= 0 && dataRows.length > 0
  const targetName = target === 'new' ? newDeckName.trim() : decks.find((d) => d.id === target)?.name

  const clean = (value: string | undefined) => {
    const raw = value ?? ''
    return stripHtml ? htmlToText(raw) : raw.trim()
  }

  const runImport = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      let deckId = target
      let deckName = targetName ?? 'Imported'
      if (target === 'new') {
        const deck = await createDeck(newDeckName.trim() || 'Imported deck')
        deckId = deck.id
        deckName = deck.name
      }

      const existing = new Set(
        notes.filter((n) => n.deckId === deckId).map((n) => plainText(n.front).toLowerCase()),
      )
      const fileTags = parsed?.meta.tags ?? []
      const inputs = []
      let skippedDuplicate = 0
      let skippedEmpty = 0

      for (const row of dataRows) {
        const front = clean(row[frontIndex])
        const back = clean(row[backIndex])
        if (!front && !back) {
          skippedEmpty++
          continue
        }
        const key = front.toLowerCase()
        if (skipDuplicates && key && existing.has(key)) {
          skippedDuplicate++
          continue
        }
        existing.add(key)
        const rowTags = tagIndexes.flatMap((i) => (row[i] ?? '').split(/[\s,]+/)).filter(Boolean)
        inputs.push({
          deckId,
          kind,
          front,
          back,
          tags: [...new Set([...fileTags, ...rowTags])],
        })
      }

      const added = await addNotes(inputs)
      setReport({ added, skippedDuplicate, skippedEmpty, deckName })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'import failed')
    } finally {
      setBusy(false)
    }
  }

  if (report) {
    return (
      <div className="app">
        <header className="topbar">
          <button className="btn ghost back" onClick={() => go({ name: 'decks' })}>
            <span aria-hidden="true">←</span>
            <span className="name">Decks</span>
          </button>
          <div className="spacer" />
        </header>
        <div className="card chart">
          <h3>Imported</h3>
          <div className="stack" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 650 }}>
              {report.added} card{report.added === 1 ? '' : 's'} added to {report.deckName}
            </div>
            {report.skippedDuplicate > 0 && (
              <div className="tiny muted">
                {report.skippedDuplicate} skipped as duplicates of cards already in the deck.
              </div>
            )}
            {report.skippedEmpty > 0 && (
              <div className="tiny muted">{report.skippedEmpty} empty rows skipped.</div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => go({ name: 'decks' })}>
                Done
              </button>
              <button
                className="btn"
                onClick={() => {
                  setReport(null)
                  setLoaded(null)
                }}
              >
                Import another file
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
        <button className="btn ghost back" onClick={() => go({ name: 'decks' })}>
          <span aria-hidden="true">←</span>
          <span className="name">Decks</span>
        </button>
        <div className="grow">
          <h1>Import cards</h1>
        </div>
      </header>

      <div className="card stack" style={{ padding: 16 }}>
        <div className="row wrap">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>
            Choose a file
          </button>
          <span className="tiny muted grow">
            {loaded ? loaded.filename : 'CSV, TSV or a text file exported from Anki'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void load(file)
              e.target.value = ''
            }}
          />
        </div>
        {error && <div className="notice">{error}</div>}
      </div>

      {parsed && (
        <>
          <section className="card chart" style={{ marginTop: 16 }}>
            <div className="row wrap">
              <div className="grow">
                <h3>What the file looks like</h3>
                <div className="tiny muted">
                  {dataRows.length} row{dataRows.length === 1 ? '' : 's'} · {columnCount} column
                  {columnCount === 1 ? '' : 's'}
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
                        <select value={roles[i] ?? 'ignore'} onChange={(e) => setRole(i, e.target.value as Role)}>
                          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
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
                        <td key={c} className={roles[c] === 'ignore' ? 'muted' : undefined}>
                          {clean(row[c]).slice(0, 60) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  Card type
                  <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
                    <option value="basic">Basic — front → back</option>
                    <option value="reversed">Basic + reversed — both directions</option>
                  </select>
                </label>
              </div>

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
                <span className="tiny">Skip rows whose front already exists in the deck</span>
              </label>

              <div className="row" style={{ marginTop: 4 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={runImport}>
                  {busy ? 'Importing…' : `Import ${dataRows.length} row${dataRows.length === 1 ? '' : 's'}`}
                </button>
                {!ready && (
                  <span className="tiny muted">
                    Assign a Front and a Back column to continue.
                  </span>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
