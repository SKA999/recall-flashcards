import { useEffect, useMemo, useRef, useState } from 'react'
import type { Go } from '../App'
import { faces, mediaToken } from '../core/notes'
import { cardOrdinals } from '../core/notetypes'
import { currentRetrievability } from '../core/scheduler'
import type { Note } from '../core/types'
import { useApp } from '../data/store'
import { FieldView } from './components/FieldView'

/** Resize a field list when the note type changes, keeping values by position. */
function fitFields(values: string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => values[i] ?? '')
}

export function NoteEditor({ deckId, noteId, go }: { deckId: string; noteId?: string; go: Go }) {
  const {
    decks,
    notes,
    cards,
    notetypes,
    notetype,
    saveNote,
    deleteNote,
    addMedia,
    setCardSuspended,
    resetCard,
  } = useApp()
  const deck = decks.find((d) => d.id === deckId)
  const existing = noteId ? notes.find((n) => n.id === noteId) : undefined

  const [notetypeId, setNotetypeId] = useState(existing?.notetypeId ?? notetypes[0]?.id ?? 'basic')
  const type = notetype(notetypeId)
  const [fields, setFields] = useState<string[]>(() =>
    fitFields(existing?.fields ?? [], notetype(existing?.notetypeId ?? notetypeId).fields.length),
  )
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const refs = useRef<(HTMLTextAreaElement | null)[]>([])
  const noteCards = useMemo(
    () => (noteId ? cards.filter((c) => c.noteId === noteId).sort((a, b) => a.ordinal - b.ordinal) : []),
    [cards, noteId],
  )

  useEffect(() => {
    if (!savedNote) return
    const t = setTimeout(() => setSavedNote(false), 1600)
    return () => clearTimeout(t)
  }, [savedNote])

  const changeType = (id: string) => {
    setNotetypeId(id)
    setFields((current) => fitFields(current, notetype(id).fields.length))
  }

  const setField = (index: number, value: string) =>
    setFields((current) => current.map((v, i) => (i === index ? value : v)))

  /** Insert a media token at the caret of the given field. */
  const attach = async (index: number, file: File) => {
    const id = await addMedia(deckId, file)
    const el = refs.current[index]
    const value = fields[index] ?? ''
    const at = el?.selectionStart ?? value.length
    const before = value.slice(0, at)
    const gap = before && !before.endsWith('\n') ? '\n' : ''
    setField(index, `${before}${gap}${mediaToken(id)}\n${value.slice(at)}`)
  }

  const canSave = fields.some((f) => f.trim() !== '')
  // A note that generates no cards would vanish from every deck; warn instead.
  const generated = cardOrdinals(type, fields).length

  const save = async (keepOpen: boolean) => {
    if (!canSave || saving) return
    setSaving(true)
    await saveNote({
      id: noteId,
      deckId,
      notetypeId,
      fields,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
    setSaving(false)
    if (keepOpen) {
      setFields(fitFields([], type.fields.length))
      setSavedNote(true)
      refs.current[0]?.focus()
    } else {
      go({ name: 'deck', deckId })
    }
  }

  if (!deck) {
    return (
      <div className="app">
        <div className="empty">Deck not found.</div>
      </div>
    )
  }

  const preview: Note = {
    id: noteId ?? 'preview',
    deckId,
    notetypeId,
    fields,
    tags: [],
    created: 0,
    modified: 0,
    updated: 0,
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost back" onClick={() => go({ name: 'deck', deckId })}>
          <span aria-hidden="true">←</span>
          <span className="name">{deck.name}</span>
        </button>
        <div className="spacer" />
        {noteId && (
          <button
            className="btn ghost danger"
            onClick={async () => {
              if (confirm('Delete this note and its cards?')) {
                await deleteNote(noteId)
                go({ name: 'deck', deckId })
              }
            }}
          >
            Delete
          </button>
        )}
        <button className="btn primary" disabled={!canSave || saving} onClick={() => save(false)}>
          Save
        </button>
      </header>

      <div className="card stack" style={{ padding: 16 }}>
        <label className="field" style={{ maxWidth: 320 }}>
          Note type
          <select value={notetypeId} onChange={(e) => changeType(e.target.value)}>
            {notetypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {type.fields.map((name, index) => (
          <FieldEditor
            key={`${type.id}:${index}`}
            label={name}
            value={fields[index] ?? ''}
            onChange={(v) => setField(index, v)}
            assignRef={(el) => {
              refs.current[index] = el
            }}
            onAttach={(file) => attach(index, file)}
          />
        ))}

        <label className="field">
          Tags (comma separated)
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>

        {type.isCloze && generated === 0 && canSave && (
          <div className="notice">
            This note type makes a card for each cloze deletion, and there aren't any yet. Wrap the
            hidden part in {'{{c1::…}}'} to create one.
          </div>
        )}

        {!noteId && (
          <div className="row">
            <button className="btn" disabled={!canSave || saving} onClick={() => save(true)}>
              Save and add another
            </button>
            {savedNote && <span className="tiny muted">Saved.</span>}
          </div>
        )}
      </div>

      {canSave && generated > 0 && (
        <section className="card chart" style={{ marginTop: 16 }}>
          <h3>
            Preview — {generated} card{generated === 1 ? '' : 's'}
          </h3>
          <div className="stack" style={{ marginTop: 10, gap: 18 }}>
            {cardOrdinals(type, fields).map((ord) => {
              const f = faces(preview, type, ord)
              return (
                <div key={ord} className="stack" style={{ gap: 6 }}>
                  <div className="tiny muted">
                    {type.isCloze ? `Cloze ${ord + 1}` : type.templates[ord]?.name}
                  </div>
                  {f.question.map((text, i) => (
                    <FieldView key={`q${i}`} text={text} />
                  ))}
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />
                  {f.answer.map((text, i) => (
                    <FieldView key={`a${i}`} text={text} />
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {noteCards.length > 0 && (
        <section className="card chart" style={{ marginTop: 16 }}>
          <h3>Cards</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            {noteCards.map((card) => {
              const r = currentRetrievability(card)
              const label = type.isCloze
                ? `cloze ${card.ordinal + 1}`
                : (type.templates[card.ordinal]?.name ?? `card ${card.ordinal + 1}`)
              return (
                <div key={card.id} className="row wrap" style={{ gap: 8 }}>
                  <span className={`pill ${card.suspended ? '' : card.state}`}>
                    {card.suspended ? 'paused' : card.state}
                  </span>
                  <span className="tiny muted grow">
                    {label} · {card.reps} review{card.reps === 1 ? '' : 's'} · {card.lapses} lapse
                    {card.lapses === 1 ? '' : 's'}
                    {card.stability != null && ` · stability ${card.stability.toFixed(1)}d`}
                    {card.difficulty != null && ` · difficulty ${card.difficulty.toFixed(1)}/10`}
                    {r != null && ` · recall ${Math.round(r * 100)}%`}
                  </span>
                  <button
                    className="btn small ghost"
                    onClick={() => setCardSuspended(card.id, !card.suspended)}
                  >
                    {card.suspended ? 'Resume' : 'Pause'}
                  </button>
                  <button className="btn small ghost" onClick={() => resetCard(card.id)}>
                    Reset
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function FieldEditor({
  label,
  value,
  onChange,
  assignRef,
  onAttach,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  assignRef: (el: HTMLTextAreaElement | null) => void
  onAttach: (file: File) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <span className="tiny muted grow">{label}</span>
        <button className="btn small ghost" onClick={() => fileRef.current?.click()}>
          Attach media
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,audio/*,video/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onAttach(file)
            e.target.value = ''
          }}
        />
      </div>
      <textarea ref={assignRef} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
