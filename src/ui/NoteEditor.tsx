import { useEffect, useMemo, useRef, useState } from 'react'
import type { Go } from '../App'
import { mediaToken } from '../core/notes'
import { currentRetrievability } from '../core/scheduler'
import type { NoteKind } from '../core/types'
import { useApp } from '../data/store'
import { FieldView } from './components/FieldView'

export function NoteEditor({
  deckId,
  noteId,
  go,
}: {
  deckId: string
  noteId?: string
  go: Go
}) {
  const { decks, notes, cards, saveNote, deleteNote, addMedia, setCardSuspended, resetCard } = useApp()
  const deck = decks.find((d) => d.id === deckId)
  const existing = noteId ? notes.find((n) => n.id === noteId) : undefined

  const [kind, setKind] = useState<NoteKind>(existing?.kind ?? 'basic')
  const [front, setFront] = useState(existing?.front ?? '')
  const [back, setBack] = useState(existing?.back ?? '')
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '')
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const frontRef = useRef<HTMLTextAreaElement>(null)
  const backRef = useRef<HTMLTextAreaElement>(null)
  const noteCards = useMemo(
    () => (noteId ? cards.filter((c) => c.noteId === noteId).sort((a, b) => a.ordinal - b.ordinal) : []),
    [cards, noteId],
  )

  useEffect(() => {
    if (!savedNote) return
    const t = setTimeout(() => setSavedNote(false), 1600)
    return () => clearTimeout(t)
  }, [savedNote])

  /** Insert a media token at the caret of the given field. */
  const attach = async (which: 'front' | 'back', file: File) => {
    const id = await addMedia(deckId, file)
    const token = mediaToken(id)
    const ref = which === 'front' ? frontRef : backRef
    const setter = which === 'front' ? setFront : setBack
    const value = which === 'front' ? front : back
    const el = ref.current
    const at = el?.selectionStart ?? value.length
    const next = `${value.slice(0, at)}${value.slice(0, at) && !value.slice(0, at).endsWith('\n') ? '\n' : ''}${token}\n${value.slice(at)}`
    setter(next)
  }

  const canSave = front.trim().length > 0 || back.trim().length > 0

  const save = async (keepOpen: boolean) => {
    if (!canSave || saving) return
    setSaving(true)
    await saveNote({
      id: noteId,
      deckId,
      kind,
      front,
      back,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    })
    setSaving(false)
    if (keepOpen) {
      setFront('')
      setBack('')
      setSavedNote(true)
      frontRef.current?.focus()
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
        <label className="field" style={{ maxWidth: 260 }}>
          Card type
          <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
            <option value="basic">Basic — front → back</option>
            <option value="reversed">Basic + reversed — both directions</option>
          </select>
        </label>

        <FieldEditor
          label="Front"
          value={front}
          onChange={setFront}
          textareaRef={frontRef}
          onAttach={(f) => attach('front', f)}
        />
        <FieldEditor
          label="Back"
          value={back}
          onChange={setBack}
          textareaRef={backRef}
          onAttach={(f) => attach('back', f)}
        />

        <label className="field">
          Tags (comma separated)
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>

        {!noteId && (
          <div className="row">
            <button className="btn" disabled={!canSave || saving} onClick={() => save(true)}>
              Save and add another
            </button>
            {savedNote && <span className="tiny muted">Saved.</span>}
          </div>
        )}
      </div>

      {(front || back) && (
        <section className="card chart" style={{ marginTop: 16 }}>
          <h3>Preview</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            <FieldView text={front} />
            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', width: '100%' }} />
            <FieldView text={back} />
          </div>
        </section>
      )}

      {noteCards.length > 0 && (
        <section className="card chart" style={{ marginTop: 16 }}>
          <h3>Cards</h3>
          <div className="stack" style={{ marginTop: 10 }}>
            {noteCards.map((card) => {
              const r = currentRetrievability(card)
              return (
                <div key={card.id} className="row wrap" style={{ gap: 8 }}>
                  <span className={`pill ${card.suspended ? '' : card.state}`}>
                    {card.suspended ? 'paused' : card.state}
                  </span>
                  <span className="tiny muted grow">
                    {card.ordinal === 0 ? 'front → back' : 'back → front'} ·{' '}
                    {card.reps} review{card.reps === 1 ? '' : 's'} · {card.lapses} lapse
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
  textareaRef,
  onAttach,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
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
      <textarea ref={textareaRef} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
