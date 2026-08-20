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

/**
 * One card a note type produces. Rather than Anki's template language, a
 * template just names which fields are asked and which are shown as the answer
 * — enough to carry real note types across without evaluating anything.
 */
export interface CardTemplate {
  name: string
  /** Indexes into the note type's `fields`, shown as the question. */
  question: number[]
  /** Indexes shown once the answer is revealed. */
  answer: number[]
}

/**
 * The shape of a note: its named fields, and the cards they generate.
 * Built-in types use stable ids so imports and migrations can rely on them.
 */
export interface Notetype {
  id: string
  name: string
  /** Field names, in display order. */
  fields: string[]
  templates: CardTemplate[]
  /**
   * Cloze types generate one card per `{{cN::…}}` marker found in
   * `clozeField`, instead of one card per template.
   */
  isCloze: boolean
  clozeField?: number
  created: number
  updated: number
}

/** A note holds the content the user typed. Cards are generated from it. */
export interface Note {
  id: string
  deckId: string
  notetypeId: string
  /**
   * Field values, positionally matching the note type's `fields`.
   * Text may embed media tokens: {{media:<mediaId>}}
   */
  fields: string[]
  tags: string[]
  created: number
  modified: number
  /** Last local write, epoch ms. Sync compares these; never reuse `modified`. */
  updated: number
}

/** A single scheduled item. A note type with two templates produces two. */
export interface Card {
  id: string
  noteId: string
  deckId: string
  /** Which card of the note this is: a template index, or a cloze number - 1. */
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

export type TombstoneKind = 'deck' | 'note' | 'card' | 'media' | 'notetype'

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
