import { useMemo, useState } from 'react'
import type { Go } from '../App'
import { backupUrgency } from '../core/backup-policy'
import { buildQueue } from '../core/scheduler'
import { useApp } from '../data/store'

export function DeckList({ go }: { go: Go }) {
  const { decks, cards, createDeck, counterFor, durable, backupState } = useApp()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const rows = useMemo(() => {
    const now = Date.now()
    return decks.map((deck) => {
      const own = cards.filter((c) => c.deckId === deck.id)
      const counter = counterFor(deck.id, now)
      const { counts } = buildQueue(own, deck.config, counter, now)
      return { deck, counts, total: own.length }
    })
  }, [decks, cards, counterFor])

  const submit = async () => {
    if (!name.trim()) return
    const deck = await createDeck(name)
    setName('')
    setAdding(false)
    go({ name: 'deck', deckId: deck.id })
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Recall</h1>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => go({ name: 'import' })}>
          Import
        </button>
        <button className="btn ghost" onClick={() => go({ name: 'backup' })}>
          Backup
        </button>
        <button className="btn ghost" onClick={() => go({ name: 'stats' })}>
          Stats
        </button>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          New deck
        </button>
      </header>

      {(() => {
        const urgency = backupUrgency(backupState, Date.now())
        if (urgency === 'none' || !durable) return null
        const reviews = `${backupState.changesSince} review${backupState.changesSince === 1 ? '' : 's'}`
        return (
          <button
            className="card notice row"
            style={{ marginBottom: 16, width: '100%', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => go({ name: 'backup' })}
          >
            <span className="grow">
              {urgency === 'never'
                ? `No copy of your cards has ever been saved, and there are ${reviews} to lose.`
                : urgency === 'stale'
                  ? `Your last copy is over a week old — ${reviews} since.`
                  : `${reviews} since your last copy.`}
            </span>
            <span className="pill">Save</span>
          </button>
        )
      })()}

      {!durable && (
        <div className="card notice" style={{ marginBottom: 16 }}>
          This browser won't let the app store data, so your cards will disappear when you close
          the tab. Everything else works.
        </div>
      )}

      {adding && (
        <div className="card stack" style={{ padding: 14, marginBottom: 16 }}>
          <label className="field">
            Deck name
            <input
              type="text"
              autoFocus
              value={name}
              placeholder="Spanish vocabulary"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          <div className="row">
            <button className="btn primary" onClick={submit}>
              Create
            </button>
            <button className="btn ghost" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !adding ? (
        <div className="empty">
          No decks yet.
          <br />
          Create one to start adding cards.
        </div>
      ) : (
        <div className="stack">
          {rows.map(({ deck, counts, total }) => (
            <button key={deck.id} className="deck" onClick={() => go({ name: 'deck', deckId: deck.id })}>
              <div className="grow">
                <div className="name ellipsis">{deck.name}</div>
                <div className="tiny muted">
                  {total} card{total === 1 ? '' : 's'}
                  {deck.description ? ` · ${deck.description}` : ''}
                </div>
              </div>
              <div className="counts">
                <span className={counts.newCount ? 'count-new' : 'count-zero'}>{counts.newCount}</span>
                <span className={counts.learningCount ? 'count-learn' : 'count-zero'}>
                  {counts.learningCount}
                </span>
                <span className={counts.reviewCount ? 'count-review' : 'count-zero'}>
                  {counts.reviewCount}
                </span>
              </div>
            </button>
          ))}
          {rows.length > 0 && (
            <div className="tiny muted" style={{ padding: '0 4px' }}>
              Counts are new · learning · due.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
