// Translating Anki's scheduling state into ours. Pure — no SQLite, no zip — so
// the native app reuses it, and so it can be tested exhaustively.
//
// Field semantics are taken from anki/rslib/src/card/mod.rs and
// rslib/src/storage/card/data.rs, not from guesswork:
//
//   type   0 new · 1 learn · 2 review · 3 relearn
//   queue  0 new · 1 learn (due = unix secs) · 2 review (due = days since crt)
//          3 day-learn (due = days since crt) · 4 preview
//          -1 suspended · -2 buried by scheduler · -3 buried by user
//   ivl    days for review cards; negative means seconds in old collections
//   factor ease x1000, minimum 1300, default 2500
//   data   JSON: s = FSRS stability, d = FSRS difficulty, dr = desired
//          retention, decay = per-card curve, lrt = last review (unix secs)

import { MS_DAY } from './scheduler'
import type { Card, CardState } from './types'

/** One row of Anki's `cards` table. Same shape in schema 11 and 18. */
export interface AnkiCardRow {
  id: number
  nid: number
  did: number
  ord: number
  type: number
  queue: number
  due: number
  ivl: number
  factor: number
  reps: number
  lapses: number
  left: number
  /** Original due, set while the card sits in a filtered deck. */
  odue: number
  /** Original deck id, non-zero while the card sits in a filtered deck. */
  odid: number
  data: string
}

export interface AnkiCardData {
  stability?: number
  difficulty?: number
  desiredRetention?: number
  decay?: number
  lastReviewSecs?: number
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/** Parse the `data` column. Anki itself falls back to defaults on bad JSON. */
export function parseCardData(json: string): AnkiCardData {
  if (!json) return {}
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  return {
    stability: num(parsed.s),
    difficulty: num(parsed.d),
    desiredRetention: num(parsed.dr),
    decay: num(parsed.decay),
    lastReviewSecs: num(parsed.lrt),
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)

/** Anki's ease range, used to place SM-2 cards on the 1..10 difficulty scale. */
const EASE_MIN = 1300
const EASE_MAX = 3700
const EASE_DEFAULT = 2500

/**
 * Estimate FSRS difficulty from an SM-2 ease factor. A default-ease card lands
 * mid-scale; the minimum ease lands at 10. Only used when the collection has no
 * FSRS state of its own.
 */
export function difficultyFromEase(factor: number): number {
  const ease = factor > 0 ? factor : EASE_DEFAULT
  return clamp(1 + (9 * (EASE_MAX - ease)) / (EASE_MAX - EASE_MIN), 1, 10)
}

function ankiState(type: number, ivl: number): CardState {
  switch (type) {
    case 0:
      return 'new'
    case 1:
      return 'learning'
    case 2:
      return 'review'
    case 3:
      return 'relearning'
    default:
      // Unknown type from a damaged or future collection: let the interval decide.
      return ivl > 0 ? 'review' : 'new'
  }
}

export interface MappedScheduling {
  state: CardState
  step: number
  due: number
  stability?: number
  difficulty?: number
  lastReview?: number
  reps: number
  lapses: number
  scheduledDays: number
  suspended: boolean
  /** True when stability and difficulty came across exactly, not estimated. */
  exact: boolean
}

export interface MapOptions {
  /** Collection creation time, epoch seconds — `col.crt`. Review dues count from here. */
  crt: number
  now?: number
}

/**
 * Map one Anki card's scheduling onto ours.
 *
 * Cards with FSRS state transfer as-is. SM-2 cards are estimated: their
 * interval becomes stability — which is exactly what stability means, the gap
 * at which recall sits at 90% — and their ease becomes difficulty.
 */
export function mapScheduling(row: AnkiCardRow, { crt, now = Date.now() }: MapOptions): MappedScheduling {
  const data = parseCardData(row.data)
  // A card sitting in a filtered deck keeps its real due date in `odue`.
  const inFilteredDeck = row.odid !== 0
  const due = inFilteredDeck && row.odue !== 0 ? row.odue : row.due
  const state = ankiState(row.type, row.ivl)

  // Sub-day intervals are stored as negative seconds in older collections.
  const scheduledDays = state === 'review' ? Math.max(row.ivl > 0 ? row.ivl : 0, 0) : 0

  let dueAt: number
  if (state === 'new') {
    dueAt = now
  } else if (row.queue === 1 || row.queue === 4) {
    // Learning and preview queues store an absolute unix timestamp.
    dueAt = due * 1000
  } else {
    dueAt = crt * 1000 + due * MS_DAY
  }

  const exact = data.stability != null && data.difficulty != null
  let stability: number | undefined
  let difficulty: number | undefined
  if (state !== 'new') {
    stability = exact ? data.stability : Math.max(scheduledDays, 0.1)
    difficulty = exact ? clamp(data.difficulty!, 1, 10) : difficultyFromEase(row.factor)
  }

  const lastReview =
    state === 'new'
      ? undefined
      : data.lastReviewSecs != null
        ? data.lastReviewSecs * 1000
        : // No recorded last review: work back from the due date and interval.
          dueAt - Math.max(scheduledDays, 1) * MS_DAY

  return {
    state,
    // Anki's `left` counts down its own deck's steps, which need not match
    // ours, so a card mid-acquisition restarts at the top of our ladder.
    step: 0,
    due: dueAt,
    stability,
    difficulty,
    lastReview,
    reps: Math.max(row.reps, 0),
    lapses: Math.max(row.lapses, 0),
    scheduledDays,
    // Buried is a temporary, self-expiring state in Anki, so only a genuine
    // suspension carries over.
    suspended: row.queue === -1,
    exact,
  }
}

/** Apply mapped scheduling to a freshly created card. */
export function withScheduling(card: Card, mapped: MappedScheduling): Card {
  return {
    ...card,
    state: mapped.state,
    step: mapped.step,
    due: mapped.due,
    stability: mapped.stability,
    difficulty: mapped.difficulty,
    lastReview: mapped.lastReview,
    reps: mapped.reps,
    lapses: mapped.lapses,
    scheduledDays: mapped.scheduledDays,
    suspended: mapped.suspended,
  }
}
