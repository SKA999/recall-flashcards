import { useMemo, useState } from 'react'
import type { Go } from '../App'
import { forecast, reviewsByDay, stateBreakdown, summarize } from '../core/stats'
import { useApp } from '../data/store'
import { BarChart, StackedBar } from './components/Charts'

const WINDOWS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
]

export function Stats({ deckId, go }: { deckId?: string; go: Go }) {
  const { decks, cards, logs } = useApp()
  const [window, setWindow] = useState(30)
  const deck = deckId ? decks.find((d) => d.id === deckId) : undefined

  const scopedCards = useMemo(
    () => (deckId ? cards.filter((c) => c.deckId === deckId) : cards),
    [cards, deckId],
  )
  const scopedLogs = useMemo(
    () => (deckId ? logs.filter((l) => l.deckId === deckId) : logs),
    [logs, deckId],
  )

  const now = Date.now()
  const summary = useMemo(() => summarize(scopedLogs, now), [scopedLogs, now])
  const history = useMemo(() => reviewsByDay(scopedLogs, window, now), [scopedLogs, window, now])
  const upcoming = useMemo(() => forecast(scopedCards, 30, now), [scopedCards, now])
  const states = useMemo(() => stateBreakdown(scopedCards), [scopedCards])

  const grades = history.reduce(
    (acc, b) => ({
      again: acc.again + b.again,
      hard: acc.hard + b.hard,
      good: acc.good + b.good,
      easy: acc.easy + b.easy,
    }),
    { again: 0, hard: 0, good: 0, easy: 0 },
  )

  const tickEvery = window <= 30 ? 7 : window <= 90 ? 15 : 60

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="btn ghost back"
          onClick={() => (deckId ? go({ name: 'deck', deckId }) : go({ name: 'decks' }))}
        >
          <span aria-hidden="true">←</span>
          <span className="name">{deck ? deck.name : 'Decks'}</span>
        </button>
        <div className="spacer" />
        <select value={window} onChange={(e) => setWindow(Number(e.target.value))} style={{ width: 'auto' }}>
          {WINDOWS.map((w) => (
            <option key={w.days} value={w.days}>
              {w.label}
            </option>
          ))}
        </select>
      </header>

      <div className="tiles" style={{ marginBottom: 16 }}>
        <Tile value={summary.reviewsToday} label="Reviews today" />
        <Tile value={summary.streak} label={`Day streak`} />
        <Tile
          value={summary.retention == null ? '—' : `${Math.round(summary.retention * 100)}%`}
          label="Retention"
        />
        <Tile value={formatDuration(summary.totalTimeMs)} label="Time studied" />
      </div>

      <div className="stack">
        <BarChart
          title="Reviews per day"
          subtitle={`${summary.totalReviews} answers all time · ${summary.averagePerActiveDay.toFixed(0)} per active day`}
          data={history.map((b) => ({
            label: b.day,
            value: b.total,
            detail: `${b.day}${b.timeMs ? ` · ${formatDuration(b.timeMs)}` : ''}`,
          }))}
          unit="reviews"
          tickEvery={tickEvery}
        />

        <StackedBar
          title="How answers went"
          subtitle={
            summary.matureRetention == null
              ? 'Across the selected window'
              : `Mature cards recalled ${Math.round(summary.matureRetention * 100)}% of the time`
          }
          countLabel="Grade"
          segments={[
            { label: 'Again', value: grades.again, color: 'var(--c1)' },
            { label: 'Hard', value: grades.hard, color: 'var(--c2)' },
            { label: 'Good', value: grades.good, color: 'var(--c3)' },
            { label: 'Easy', value: grades.easy, color: 'var(--c4)' },
          ]}
        />

        <BarChart
          title="Due in the next 30 days"
          subtitle={`${upcoming[upcoming.length - 1]?.cumulative ?? 0} reviews scheduled`}
          data={upcoming.map((b) => ({
            label: b.day,
            value: b.due,
            detail: `${b.day} · ${b.cumulative} cumulative`,
          }))}
          variant="forecast"
          unit="cards"
        />

        <StackedBar
          title="Card maturity"
          subtitle="Cards move left to right as their intervals grow"
          countLabel="State"
          segments={[
            { label: 'New', value: states.new, color: 'var(--ord1)' },
            { label: 'Learning', value: states.learning, color: 'var(--ord2)' },
            { label: 'Young', value: states.young, color: 'var(--ord3)' },
            { label: 'Mature', value: states.mature, color: 'var(--ord4)' },
          ]}
        />

        {states.suspended > 0 && (
          <div className="tiny muted" style={{ padding: '0 4px' }}>
            {states.suspended} card{states.suspended === 1 ? '' : 's'} paused and excluded above.
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="card tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const mins = ms / 60_000
  if (mins < 60) return `${Math.round(mins)}m`
  const hours = mins / 60
  return hours < 10 ? `${hours.toFixed(1)}h` : `${Math.round(hours)}h`
}
