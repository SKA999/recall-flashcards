import { useMemo, useState } from 'react'
import type { Go } from '../App'
import { plainText } from '../core/notes'
import { buildQueue } from '../core/scheduler'
import { useApp } from '../data/store'

export function DeckView({ deckId, go }: { deckId: string; go: Go }) {
  const { decks, notes, cards, counterFor } = useApp()
  const deck = decks.find((d) => d.id === deckId)
  const [query, setQuery] = useState('')

  const deckNotes = useMemo(
    () => notes.filter((n) => n.deckId === deckId).sort((a, b) => b.modified - a.modified),
    [notes, deckId],
  )
  const deckCards = useMemo(() => cards.filter((c) => c.deckId === deckId), [cards, deckId])

  const queue = useMemo(() => {
    if (!deck) return null
    const now = Date.now()
    return buildQueue(deckCards, deck.config, counterFor(deck.id, now), now)
  }, [deck, deckCards, counterFor])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return deckNotes
    return deckNotes.filter((n) =>
      `${plainText(n.front)} ${plainText(n.back)} ${n.tags.join(' ')}`.toLowerCase().includes(q),
    )
  }, [deckNotes, query])

  if (!deck) {
    return (
      <div className="app">
        <div className="empty">Deck not found.</div>
      </div>
    )
  }

  const total = queue ? queue.counts.newCount + queue.counts.learningCount + queue.counts.reviewCount : 0

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost back" onClick={() => go({ name: 'decks' })}>
          ← Decks
        </button>
        <div className="grow">
          <h1 className="ellipsis">{deck.name}</h1>
        </div>
        <button className="btn ghost" onClick={() => go({ name: 'stats', deckId })}>
          Stats
        </button>
        <button className="btn ghost" onClick={() => go({ name: 'settings', deckId })}>
          Settings
        </button>
      </header>

      <div className="card stack" style={{ padding: 16, marginBottom: 18 }}>
        <div className="row wrap">
          <div className="grow">
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {total > 0 ? `${total} card${total === 1 ? '' : 's'} ready` : 'Nothing due right now'}
            </div>
            <div className="tiny muted">
              {queue
                ? `${queue.counts.newCount} new · ${queue.counts.learningCount} learning · ${queue.counts.reviewCount} due`
                : ''}
              {total === 0 && queue?.nextDue ? ` · next in ${untilLabel(queue.nextDue)}` : ''}
            </div>
          </div>
          <button
            className="btn primary"
            disabled={total === 0}
            onClick={() => go({ name: 'review', deckId })}
          >
            Study
          </button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          className="grow"
          placeholder="Search cards…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn primary" onClick={() => go({ name: 'editor', deckId })}>
          Add card
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">{deckNotes.length ? 'No matches.' : 'This deck is empty.'}</div>
      ) : (
        <div className="card">
          {filtered.map((note) => {
            const own = deckCards.filter((c) => c.noteId === note.id)
            return (
              <div
                key={note.id}
                className="note-row"
                onClick={() => go({ name: 'editor', deckId, noteId: note.id })}
              >
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="front ellipsis">{plainText(note.front) || '(empty)'}</div>
                  <div className="back tiny ellipsis">{plainText(note.back) || '(empty)'}</div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {own.map((c) => (
                    <span key={c.id} className={`pill ${c.suspended ? '' : c.state}`}>
                      {c.suspended ? 'paused' : c.state}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function untilLabel(due: number): string {
  const ms = due - Date.now()
  if (ms <= 0) return 'now'
  const mins = ms / 60000
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / 1440)}d`
}
