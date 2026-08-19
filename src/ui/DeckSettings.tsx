import { useState } from 'react'
import type { Go } from '../App'
import { intervalForRetention } from '../core/fsrs'
import { useApp } from '../data/store'

export function DeckSettings({ deckId, go }: { deckId: string; go: Go }) {
  const { decks, updateDeck, updateDeckConfig, deleteDeck } = useApp()
  const deck = decks.find((d) => d.id === deckId)
  const [stepsText, setStepsText] = useState(deck?.config.learningSteps.join(', ') ?? '')
  const [relearnText, setRelearnText] = useState(deck?.config.relearningSteps.join(', ') ?? '')

  if (!deck) {
    return (
      <div className="app">
        <div className="empty">Deck not found.</div>
      </div>
    )
  }

  const cfg = deck.config
  const parseSteps = (text: string) =>
    text
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)

  // What a card with one day of stability would be scheduled for at this retention.
  const retentionHint = intervalForRetention(10, cfg.desiredRetention)

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost back" onClick={() => go({ name: 'deck', deckId })}>
          <span aria-hidden="true">←</span>
          <span className="name">{deck.name}</span>
        </button>
        <div className="spacer" />
      </header>

      <div className="card stack" style={{ padding: 16 }}>
        <label className="field">
          Deck name
          <input
            type="text"
            value={deck.name}
            onChange={(e) => updateDeck(deckId, { name: e.target.value })}
          />
        </label>
        <label className="field">
          Description
          <input
            type="text"
            value={deck.description}
            onChange={(e) => updateDeck(deckId, { description: e.target.value })}
          />
        </label>
      </div>

      <section className="card chart" style={{ marginTop: 16 }}>
        <h3>Scheduling</h3>
        <div className="tiny muted">FSRS-5 decides intervals; these settings shape it.</div>

        <div className="stack" style={{ marginTop: 14 }}>
          <label className="field">
            Desired retention — {Math.round(cfg.desiredRetention * 100)}%
            <input
              type="range"
              min={0.7}
              max={0.98}
              step={0.01}
              value={cfg.desiredRetention}
              onChange={(e) => updateDeckConfig(deckId, { desiredRetention: Number(e.target.value) })}
            />
          </label>
          <div className="tiny muted" style={{ marginTop: -6 }}>
            Higher means shorter intervals and more reviews. At this setting a card with 10 days of
            memory strength comes back in about {retentionHint.toFixed(1)} days.
          </div>

          <label className="field">
            Learning steps (minutes, comma separated)
            <input
              type="text"
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
              onBlur={() => {
                const steps = parseSteps(stepsText)
                updateDeckConfig(deckId, { learningSteps: steps })
                setStepsText(steps.join(', '))
              }}
            />
          </label>
          <label className="field">
            Relearning steps after a lapse (minutes)
            <input
              type="text"
              value={relearnText}
              onChange={(e) => setRelearnText(e.target.value)}
              onBlur={() => {
                const steps = parseSteps(relearnText)
                updateDeckConfig(deckId, { relearningSteps: steps })
                setRelearnText(steps.join(', '))
              }}
            />
          </label>

          <div className="row wrap">
            <label className="field grow">
              New cards per day
              <input
                type="number"
                min={0}
                value={cfg.newPerDay}
                onChange={(e) => updateDeckConfig(deckId, { newPerDay: Math.max(0, Number(e.target.value)) })}
              />
            </label>
            <label className="field grow">
              Maximum reviews per day
              <input
                type="number"
                min={0}
                value={cfg.reviewsPerDay}
                onChange={(e) =>
                  updateDeckConfig(deckId, { reviewsPerDay: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label className="field grow">
              Maximum interval (days)
              <input
                type="number"
                min={1}
                value={cfg.maximumInterval}
                onChange={(e) =>
                  updateDeckConfig(deckId, { maximumInterval: Math.max(1, Number(e.target.value)) })
                }
              />
            </label>
          </div>

          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={cfg.fuzz}
              style={{ width: 'auto' }}
              onChange={(e) => updateDeckConfig(deckId, { fuzz: e.target.checked })}
            />
            <span className="tiny">Spread due dates slightly so cards added together don't clump</span>
          </label>
        </div>
      </section>

      <section className="card chart" style={{ marginTop: 16 }}>
        <h3>Danger zone</h3>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn danger"
            onClick={async () => {
              if (confirm(`Delete "${deck.name}" and all its cards? This cannot be undone.`)) {
                await deleteDeck(deckId)
                go({ name: 'decks' })
              }
            }}
          >
            Delete deck
          </button>
        </div>
      </section>
    </div>
  )
}
