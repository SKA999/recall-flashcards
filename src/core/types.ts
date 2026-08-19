// Pure data model. No DOM, no React — this layer is shared with the future
// native app, so keep it free of platform dependencies.

/** How well the answer was recalled. Matches Anki's four buttons. */
export const Rating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const
export type Rating = (typeof Rating)[keyof typeof Rating]

export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export type NoteKind = 'basic' | 'reversed'

/** A note holds the content the user typed. Cards are generated from it. */
export interface Note {
  id: string
  deckId: string
  kind: NoteKind
  /** Field text may embed media tokens: {{media:<mediaId>}} */
  front: string
  back: string
  tags: string[]
  created: number
  modified: number
  /** Last local write, epoch ms. Sync compares these; never reuse `modified`. */
  updated: number
}

/** A single scheduled item. A reversed note produces two of these. */
export interface Card {
  id: string
  noteId: string
  deckId: string
  /** 0 = front->back, 1 = back->front */
  ordinal: number
  state: CardState
  /** Index into the deck's learning/relearning steps. */
  step: number
  /** Epoch ms the card becomes due. */
  due: number
  /** FSRS memory state. Undefined until the first review. */
  stability?: number
  difficulty?: number
  /** Last review timestamp, epoch ms. */
  lastReview?: number
  reps: number
  lapses: number
  /** Interval in days that produced the current due date (0 for sub-day). */
  scheduledDays: number
  suspended: boolean
  created: number
  updated: number
}

export interface ReviewLog {
  id: string
  cardId: string
  deckId: string
  rating: Rating
  /** State the card was in *before* this answer. */
  stateBefore: CardState
  /** Days since the previous review; 0 for same-day / first review. */
  elapsedDays: number
  /** Days until the next review after this answer. */
  scheduledDays: number
  stability?: number
  difficulty?: number
  /** Milliseconds spent on the card. */
  durationMs: number
  reviewed: number
}

export interface DeckConfig {
  /** Target probability of recall when scheduling, 0..1. */
  desiredRetention: number
  /** Sub-day learning steps in minutes, applied to new cards. */
  learningSteps: number[]
  /** Sub-day steps after a lapse, in minutes. */
  relearningSteps: number[]
  /** Max new cards introduced per day. */
  newPerDay: number
  /** Max reviews per day. */
  reviewsPerDay: number
  /** Cap on any scheduled interval, in days. */
  maximumInterval: number
  /** Randomise intervals slightly so cards don't clump. */
  fuzz: boolean
  /** 19 FSRS-5 weights. */
  weights: number[]
}

export interface Deck {
  id: string
  name: string
  description: string
  config: DeckConfig
  created: number
  updated: number
}

export interface MediaItem {
  id: string
  deckId: string
  name: string
  mime: string
  blob: Blob
  created: number
  updated: number
}

export type TombstoneKind = 'deck' | 'note' | 'card' | 'media'

/**
 * A record of something deleted. Sync needs these: without a tombstone a delete
 * on one device looks identical to a record the other device hasn't seen yet,
 * and the deleted row comes straight back.
 */
export interface Tombstone {
  id: string
  kind: TombstoneKind
  deletedAt: number
}

/**
 * Per-deck daily counters so new/review limits survive a page reload.
 * Device-local and rebuildable from the review log — deliberately not synced.
 */
export interface DayCounter {
  /** `${deckId}:${YYYY-MM-DD}` */
  id: string
  deckId: string
  day: string
  newSeen: number
  reviewsDone: number
}
