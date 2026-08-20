import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Go } from '../App'
import { faces } from '../core/notes'
import { buildQueue, previewIntervals } from '../core/scheduler'
import { Rating } from '../core/types'
import type { Card } from '../core/types'
import { useApp } from '../data/store'
import { FieldView } from './components/FieldView'

const RATINGS: { rating: Rating; label: string; key: string }[] = [
  { rating: Rating.Again, label: 'Again', key: '1' },
  { rating: Rating.Hard, label: 'Hard', key: '2' },
  { rating: Rating.Good, label: 'Good', key: '3' },
  { rating: Rating.Easy, label: 'Easy', key: '4' },
]

/** How far ahead a learning card may be pulled forward when nothing else is due. */
const STUDY_AHEAD_MS = 20 * 60_000

export function Review({ deckId, go }: { deckId: string; go: Go }) {
  const { decks, notes, cards, counterFor, answerCard, undoAnswer, canUndo, notetype } = useApp()
  const deck = decks.find((d) => d.id === deckId)

  const [revealed, setRevealed] = useState(false)
  const [answered, setAnswered] = useState(0)
  /** A card shown out of queue order: pulled forward, or restored by undo. */
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const shownAt = useRef(Date.now())
  const busy = useRef(false)
  /** Show the next card already revealed — set by undo, consumed on card change. */
  const revealNext = useRef(false)

  const deckCards = useMemo(() => cards.filter((c) => c.deckId === deckId), [cards, deckId])

  const queue = useMemo(() => {
    if (!deck) return null
    return buildQueue(deckCards, deck.config, counterFor(deck.id), Date.now())
    // `answered` forces a rebuild after each rating so learning steps re-enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, deckCards, counterFor, answered])

  const pinnedCard = useMemo(() => {
    if (!pinnedId) return null
    return deckCards.find((c) => c.id === pinnedId) ?? null
  }, [pinnedId, deckCards])

  // A pinned card wins over queue order — that is the point of pinning it.
  const card: Card | null = pinnedCard ?? queue?.cards[0] ?? null

  const note = card ? notes.find((n) => n.id === card.noteId) : undefined

  useEffect(() => {
    setRevealed(revealNext.current)
    revealNext.current = false
    shownAt.current = Date.now()
  }, [card?.id])

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || !revealed || busy.current) return
      busy.current = true
      revealNext.current = false
      try {
        await answerCard(card, rating, Date.now() - shownAt.current)
        setPinnedId(null)
        setAnswered((n) => n + 1)
      } finally {
        busy.current = false
      }
    },
    [card, revealed, answerCard],
  )

  const undo = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const restoredId = await undoAnswer()
      if (restoredId) {
        // Show the card again rather than dropping the user wherever the queue
        // now points — undo is only useful if you get another go at it. It
        // comes back revealed: you undid because you misgraded, not because you
        // forgot the answer.
        revealNext.current = true
        setPinnedId(restoredId)
        setRevealed(true)
        setAnswered((n) => Math.max(0, n - 1))
      }
    } finally {
      busy.current = false
    }
  }, [undoAnswer])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undo()
        return
      }
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (revealed) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          void rate(Rating.Good)
          return
        }
        const hit = RATINGS.find((r) => r.key === e.key)
        if (hit) {
          e.preventDefault()
          void rate(hit.rating)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, rate, undo])

  if (!deck) {
    return (
      <div className="app">
        <div className="empty">Deck not found.</div>
      </div>
    )
  }

  const remaining = queue?.cards.length ?? 0
  const done = answered
  const progress = done + remaining > 0 ? done / (done + remaining) : 1

  if (!card || !note) {
    const soon = queue?.nextDue
    const gap = soon ? soon - Date.now() : undefined
    return (
      <div className="app">
        <Header
          deck={deck.name}
          go={go}
          deckId={deckId}
          done={done}
          remaining={0}
          progress={1}
          canUndo={canUndo}
          onUndo={undo}
        />
        <div className="empty">
          <div style={{ fontSize: 17, color: 'var(--text)', marginBottom: 8 }}>
            {done > 0 ? `Done — ${done} card${done === 1 ? '' : 's'} reviewed.` : 'Nothing due right now.'}
          </div>
          {gap != null && gap > 0 && <div>Next card in {formatGap(gap)}.</div>}
          <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
            {gap != null && gap > 0 && gap < STUDY_AHEAD_MS && queue && (
              <button
                className="btn"
                onClick={() => {
                  const next = deckCards
                    .filter((c) => !c.suspended && c.state !== 'new' && c.due > Date.now())
                    .sort((a, b) => a.due - b.due)[0]
                  if (next) setPinnedId(next.id)
                }}
              >
                Study ahead
              </button>
            )}
            <button className="btn primary" onClick={() => go({ name: 'deck', deckId })}>
              Back to deck
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { question, answer } = faces(note, notetype(note.notetypeId), card.ordinal)
  const previews = previewIntervals(card, deck.config)

  return (
    <div className="app">
      <Header
        deck={deck.name}
        go={go}
        deckId={deckId}
        done={done}
        remaining={remaining}
        progress={progress}
        canUndo={canUndo}
        onUndo={undo}
      />

      <div className="review-shell">
        <div className="qa">
          <div className="side">
            {question.map((text, i) => (
              <FieldView key={i} text={text} />
            ))}
          </div>
          {revealed && (
            <>
              <hr />
              <div className="side answer">
                {answer.map((text, i) => (
                  <FieldView key={i} text={text} autoPlay={i === 0} />
                ))}
              </div>
            </>
          )}
        </div>

        {revealed ? (
          <div className="answer-buttons">
            {RATINGS.map(({ rating, label }) => (
              <button key={rating} className={`r${rating}`} onClick={() => void rate(rating)}>
                <span className="label">{label}</span>
                <span className="ivl">{previews[rating]}</span>
              </button>
            ))}
          </div>
        ) : (
          <button className="btn primary" style={{ padding: 14 }} onClick={() => setRevealed(true)}>
            Show answer
          </button>
        )}
        <div className="tiny muted" style={{ textAlign: 'center', marginTop: 10 }}>
          Space reveals · 1–4 rate · z undoes
        </div>
      </div>
    </div>
  )
}

function Header({
  deck,
  go,
  deckId,
  done,
  remaining,
  progress,
  canUndo,
  onUndo,
}: {
  deck: string
  go: Go
  deckId: string
  done: number
  remaining: number
  progress: number
  canUndo: boolean
  onUndo: () => void
}) {
  return (
    <>
      <header className="topbar">
        <button className="btn ghost back" onClick={() => go({ name: 'deck', deckId })}>
          <span aria-hidden="true">←</span>
          <span className="name">{deck}</span>
        </button>
        <div className="spacer" />
        <button className="btn ghost small" disabled={!canUndo} onClick={onUndo} title="Undo (z)">
          Undo
        </button>
        <span className="sub">
          {done} done · {remaining} left
        </span>
      </header>
      <div className="progress" style={{ marginBottom: 12 }}>
        <div style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </>
  )
}

function formatGap(ms: number): string {
  const mins = ms / 60000
  if (mins < 60) return `${Math.max(1, Math.round(mins))} min`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`
  return `${Math.round(mins / 1440)} days`
}
