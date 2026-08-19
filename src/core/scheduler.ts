// Card state machine: learning steps for fresh material, FSRS for everything
// with a real interval. Pure functions — `answer` never mutates its input, so
// the UI can call it four times to preview all four buttons.

import {
  DEFAULT_WEIGHTS,
  applyFuzz,
  intervalForRetention,
  nextMemoryState,
  retrievability,
} from './fsrs'
import { Rating } from './types'
import type { Card, CardState, DeckConfig, ReviewLog } from './types'

export const MS_DAY = 86_400_000
export const MS_MIN = 60_000
/** Hour of the local day a new "study day" begins. Anki uses 4am too. */
export const DAY_CUTOFF_HOUR = 4

export const DEFAULT_CONFIG: DeckConfig = {
  desiredRetention: 0.9,
  learningSteps: [1, 10],
  relearningSteps: [10],
  newPerDay: 20,
  reviewsPerDay: 200,
  maximumInterval: 36500,
  fuzz: true,
  weights: [...DEFAULT_WEIGHTS],
}

/** Index of the study day containing `ts`, in local time. */
export function dayIndex(ts: number, cutoffHour = DAY_CUTOFF_HOUR): number {
  const d = new Date(ts - cutoffHour * 3600_000)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_DAY)
}

/** Epoch ms at which the study day containing `ts` began. */
export function dayStart(ts: number, cutoffHour = DAY_CUTOFF_HOUR): number {
  const d = new Date(ts - cutoffHour * 3600_000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), cutoffHour).getTime()
}

/** `YYYY-MM-DD` key for the study day containing `ts`. */
export function dayKey(ts: number, cutoffHour = DAY_CUTOFF_HOUR): string {
  const d = new Date(ts - cutoffHour * 3600_000)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Start of the study day `days` days after the one containing `now`. */
function dueInDays(now: number, days: number): number {
  const d = new Date(dayStart(now))
  d.setDate(d.getDate() + Math.round(days))
  return d.getTime()
}

export interface AnswerResult {
  card: Card
  log: Omit<ReviewLog, 'id' | 'durationMs'>
  /** Human-readable gap until this card comes back, e.g. "10m" or "4d". */
  intervalLabel: string
}

function label(dueAt: number, now: number): string {
  const ms = Math.max(dueAt - now, 0)
  const mins = ms / MS_MIN
  if (mins < 60) return `${Math.max(1, Math.round(mins))}m`
  if (mins < 60 * 20) return `${Math.round(mins / 60)}h`
  const days = ms / MS_DAY
  if (days < 30) return `${Math.max(1, Math.round(days))}d`
  if (days < 365) return `${(days / 30.4).toFixed(1)}mo`
  return `${(days / 365).toFixed(1)}y`
}

function stepsFor(state: CardState, config: DeckConfig): number[] {
  return state === 'relearning' ? config.relearningSteps : config.learningSteps
}

/**
 * Apply one answer to a card.
 *
 * `rand` is injectable so tests get deterministic fuzz.
 */
export function answer(
  card: Card,
  rating: Rating,
  config: DeckConfig,
  now: number = Date.now(),
  rand: () => number = Math.random,
): AnswerResult {
  const w = config.weights.length === 19 ? config.weights : DEFAULT_CONFIG.weights
  const elapsedDays = card.lastReview ? Math.max(dayIndex(now) - dayIndex(card.lastReview), 0) : 0
  const prev =
    card.stability != null && card.difficulty != null
      ? { stability: card.stability, difficulty: card.difficulty }
      : undefined

  const memory = nextMemoryState(w, prev, rating, elapsedDays)
  const next: Card = { ...card, reps: card.reps + 1, lastReview: now, ...memory }

  // Which step ladder, if any, is this card on?
  const wasReview = card.state === 'review'
  const enteringRelearn = wasReview && rating === Rating.Again
  if (enteringRelearn) next.lapses = card.lapses + 1

  const targetState: CardState = enteringRelearn
    ? 'relearning'
    : wasReview
      ? 'review'
      : card.state === 'relearning'
        ? 'relearning'
        : 'learning'

  const steps = stepsFor(targetState, config)

  const graduate = () => {
    const days = intervalForRetention(memory.stability, config.desiredRetention)
    const fuzzed = config.fuzz ? applyFuzz(days, rand) : days
    const clamped = Math.min(Math.max(Math.round(fuzzed), 1), config.maximumInterval)
    next.state = 'review'
    next.step = 0
    next.scheduledDays = clamped
    next.due = dueInDays(now, clamped)
  }

  const stayOnStep = (index: number) => {
    const minutes = steps[Math.min(index, steps.length - 1)] ?? 10
    next.state = targetState
    next.step = index
    next.scheduledDays = 0
    next.due = now + minutes * MS_MIN
  }

  if (wasReview && !enteringRelearn) {
    graduate()
  } else if (steps.length === 0 || rating === Rating.Easy) {
    graduate()
  } else if (rating === Rating.Again) {
    stayOnStep(0)
  } else if (rating === Rating.Hard) {
    stayOnStep(card.state === 'new' ? 0 : next.step)
  } else {
    // Good: advance one step, graduating off the end of the ladder.
    const nextStep = (card.state === 'new' ? 0 : card.step) + 1
    if (nextStep >= steps.length) graduate()
    else stayOnStep(nextStep)
  }

  return {
    card: next,
    log: {
      cardId: card.id,
      deckId: card.deckId,
      rating,
      stateBefore: card.state,
      elapsedDays,
      scheduledDays: next.scheduledDays,
      stability: next.stability,
      difficulty: next.difficulty,
      reviewed: now,
    },
    intervalLabel: label(next.due, now),
  }
}

/** Preview all four buttons without committing anything. */
export function previewIntervals(
  card: Card,
  config: DeckConfig,
  now: number = Date.now(),
): Record<Rating, string> {
  // Fuzz is disabled for previews so the label matches what the user sees next.
  const cfg = { ...config, fuzz: false }
  return {
    [Rating.Again]: answer(card, Rating.Again, cfg, now).intervalLabel,
    [Rating.Hard]: answer(card, Rating.Hard, cfg, now).intervalLabel,
    [Rating.Good]: answer(card, Rating.Good, cfg, now).intervalLabel,
    [Rating.Easy]: answer(card, Rating.Easy, cfg, now).intervalLabel,
  }
}

/** Current recall probability, for the card info panel. */
export function currentRetrievability(card: Card, now: number = Date.now()): number | undefined {
  if (card.stability == null || card.lastReview == null || card.state === 'new') return undefined
  return retrievability(Math.max(dayIndex(now) - dayIndex(card.lastReview), 0), card.stability)
}

export interface QueueCounts {
  newCount: number
  learningCount: number
  reviewCount: number
}

export interface Queue {
  cards: Card[]
  counts: QueueCounts
  /** Soonest due time among cards held back by limits or future scheduling. */
  nextDue?: number
}

/**
 * Build the study queue for a deck: due learning steps first, then reviews and
 * new cards interleaved so new material doesn't all land at the front.
 */
export function buildQueue(
  cards: Card[],
  config: DeckConfig,
  used: { newSeen: number; reviewsDone: number },
  now: number = Date.now(),
): Queue {
  const live = cards.filter((c) => !c.suspended)
  const learning = live
    .filter((c) => (c.state === 'learning' || c.state === 'relearning') && c.due <= now)
    .sort((a, b) => a.due - b.due)
  const reviews = live
    .filter((c) => c.state === 'review' && c.due <= now)
    .sort((a, b) => a.due - b.due)
  const fresh = live.filter((c) => c.state === 'new').sort((a, b) => a.created - b.created)

  const reviewRoom = Math.max(config.reviewsPerDay - used.reviewsDone, 0)
  const newRoom = Math.max(config.newPerDay - used.newSeen, 0)
  const takenReviews = reviews.slice(0, reviewRoom)
  const takenNew = fresh.slice(0, newRoom)

  // Spread the new cards evenly through the review queue.
  const mixed: Card[] = []
  const gap = takenNew.length ? (takenReviews.length + 1) / (takenNew.length + 1) : Infinity
  let placed = 0
  for (let i = 0; i <= takenReviews.length; i++) {
    while (placed < takenNew.length && (placed + 1) * gap <= i + 0.5) {
      mixed.push(takenNew[placed++])
    }
    if (i < takenReviews.length) mixed.push(takenReviews[i])
  }
  while (placed < takenNew.length) mixed.push(takenNew[placed++])

  const upcoming = live
    .filter((c) => c.state !== 'new' && c.due > now)
    .reduce<number | undefined>((min, c) => (min == null || c.due < min ? c.due : min), undefined)

  return {
    cards: [...learning, ...mixed],
    counts: {
      newCount: takenNew.length,
      learningCount: learning.length,
      reviewCount: takenReviews.length,
    },
    nextDue: upcoming,
  }
}
