// FSRS-5 — the free spaced repetition scheduler Anki uses by default.
// Pure math only: given a memory state and a rating, return the next memory
// state. Nothing here knows about cards, decks or storage.
//
// Reference: https://github.com/open-spaced-repetition/fsrs4anki/wiki

import { Rating } from './types'

/** Power-law forgetting curve exponent. */
export const DECAY = -0.5
/** Chosen so that R = 0.9 exactly when elapsed days equals stability. */
export const FACTOR = 19 / 81

export const MIN_STABILITY = 0.01
export const MAX_STABILITY = 36500

/** FSRS-5 defaults, fitted over a large public review dataset. */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
]

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi)
const clampS = (s: number) => clamp(s, MIN_STABILITY, MAX_STABILITY)

export interface MemoryState {
  stability: number
  difficulty: number
}

/**
 * Probability of recalling a card `elapsedDays` after the last review.
 * Returns 1 for a card reviewed just now.
 */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (FACTOR * Math.max(elapsedDays, 0)) / stability, DECAY)
}

/** Days until retrievability decays to `desiredRetention`. */
export function intervalForRetention(stability: number, desiredRetention: number): number {
  const r = clamp(desiredRetention, 0.7, 0.99)
  return (stability / FACTOR) * (Math.pow(r, 1 / DECAY) - 1)
}

export function initialStability(w: readonly number[], rating: Rating): number {
  return clampS(w[rating - 1])
}

export function initialDifficulty(w: readonly number[], rating: Rating): number {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10)
}

/** Difficulty drifts on each answer, with mean reversion toward an "Easy" start. */
export function nextDifficulty(
  w: readonly number[],
  difficulty: number,
  rating: Rating,
): number {
  const delta = -w[6] * (rating - 3)
  // Linear damping: difficulty moves less the closer it already is to 10.
  const damped = difficulty + (delta * (10 - difficulty)) / 9
  const reverted = w[7] * initialDifficulty(w, Rating.Easy) + (1 - w[7]) * damped
  return clamp(reverted, 1, 10)
}

/** Stability after a successful recall (Hard / Good / Easy). */
export function stabilityAfterRecall(
  w: readonly number[],
  { stability: s, difficulty: d }: MemoryState,
  r: number,
  rating: Rating,
): number {
  const hardPenalty = rating === Rating.Hard ? w[15] : 1
  const easyBonus = rating === Rating.Easy ? w[16] : 1
  const growth =
    1 +
    Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp(w[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus
  return clampS(s * growth)
}

/** Stability after a lapse. Never exceeds the stability the card already had. */
export function stabilityAfterLapse(
  w: readonly number[],
  { stability: s, difficulty: d }: MemoryState,
  r: number,
): number {
  const forgotten =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r))
  return clampS(Math.min(forgotten, s))
}

/**
 * Stability change for a review that happens on the same day as the last one
 * (a learning step, or a card answered twice in one session).
 */
export function stabilityAfterSameDay(
  w: readonly number[],
  stability: number,
  rating: Rating,
): number {
  return clampS(stability * Math.exp(w[17] * (rating - 3 + w[18])))
}

/**
 * Advance the memory state by one answer.
 * `elapsedDays` is the time since the last review — pass 0 for a brand new card.
 */
export function nextMemoryState(
  w: readonly number[],
  prev: MemoryState | undefined,
  rating: Rating,
  elapsedDays: number,
): MemoryState {
  if (!prev) {
    return {
      stability: initialStability(w, rating),
      difficulty: initialDifficulty(w, rating),
    }
  }
  const difficulty = nextDifficulty(w, prev.difficulty, rating)
  if (elapsedDays < 1) {
    return { stability: stabilityAfterSameDay(w, prev.stability, rating), difficulty }
  }
  const r = retrievability(elapsedDays, prev.stability)
  const stability =
    rating === Rating.Again
      ? stabilityAfterLapse(w, prev, r)
      : stabilityAfterRecall(w, prev, r, rating)
  return { stability, difficulty }
}

/**
 * Anki's interval fuzz: spread due dates so cards added together don't all
 * come back on the same day. Grows with the interval, capped at ±5% for long ones.
 */
export function fuzzDelta(interval: number): number {
  const band = (start: number, end: number, factor: number) =>
    factor * Math.max(Math.min(interval, end) - start, 0)
  return 1 + band(2.5, 7, 0.15) + band(7, 20, 0.1) + band(20, Infinity, 0.05)
}

export function applyFuzz(interval: number, rand: () => number): number {
  if (interval < 2.5) return interval
  const delta = fuzzDelta(interval)
  const lo = Math.max(2, Math.round(interval - delta))
  const hi = Math.round(interval + delta)
  if (hi <= lo) return lo
  return lo + Math.floor(rand() * (hi - lo + 1))
}
