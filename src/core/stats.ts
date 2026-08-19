// Aggregations over review history. Pure; the UI only draws what comes out.

import { dayIndex, dayKey, MS_DAY } from './scheduler'
import { Rating } from './types'
import type { Card, ReviewLog } from './types'

/** A card is "mature" once its interval reaches three weeks — Anki's convention. */
export const MATURE_DAYS = 21

export interface DayBucket {
  day: string
  index: number
  total: number
  again: number
  hard: number
  good: number
  easy: number
  timeMs: number
}

export function reviewsByDay(logs: ReviewLog[], days: number, now = Date.now()): DayBucket[] {
  const today = dayIndex(now)
  const first = today - days + 1
  const buckets = new Map<number, DayBucket>()
  for (let i = first; i <= today; i++) {
    buckets.set(i, {
      day: dayKey(now - (today - i) * MS_DAY),
      index: i,
      total: 0,
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
      timeMs: 0,
    })
  }
  for (const log of logs) {
    const b = buckets.get(dayIndex(log.reviewed))
    if (!b) continue
    b.total++
    b.timeMs += log.durationMs
    if (log.rating === Rating.Again) b.again++
    else if (log.rating === Rating.Hard) b.hard++
    else if (log.rating === Rating.Good) b.good++
    else b.easy++
  }
  return [...buckets.values()].sort((a, b) => a.index - b.index)
}

export interface ForecastBucket {
  day: string
  index: number
  due: number
  cumulative: number
}

export function forecast(cards: Card[], days: number, now = Date.now()): ForecastBucket[] {
  const today = dayIndex(now)
  const counts = new Map<number, number>()
  for (const c of cards) {
    if (c.suspended || c.state === 'new') continue
    const i = Math.max(dayIndex(c.due), today)
    if (i > today + days - 1) continue
    counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  const out: ForecastBucket[] = []
  let cumulative = 0
  for (let i = today; i < today + days; i++) {
    const due = counts.get(i) ?? 0
    cumulative += due
    out.push({ day: dayKey(now + (i - today) * MS_DAY), index: i, due, cumulative })
  }
  return out
}

export interface StateBreakdown {
  new: number
  learning: number
  young: number
  mature: number
  suspended: number
}

export function stateBreakdown(cards: Card[]): StateBreakdown {
  const out: StateBreakdown = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 }
  for (const c of cards) {
    if (c.suspended) out.suspended++
    else if (c.state === 'new') out.new++
    else if (c.state === 'learning' || c.state === 'relearning') out.learning++
    else if (c.scheduledDays >= MATURE_DAYS) out.mature++
    else out.young++
  }
  return out
}

export interface Summary {
  totalReviews: number
  totalTimeMs: number
  /** Share of *review-state* answers that weren't "Again". */
  retention: number | null
  matureRetention: number | null
  /** Consecutive study days ending today (or yesterday, if today is untouched). */
  streak: number
  reviewsToday: number
  averagePerActiveDay: number
}

export function summarize(logs: ReviewLog[], now = Date.now()): Summary {
  const today = dayIndex(now)
  let totalTimeMs = 0
  let graded = 0
  let passed = 0
  let matureGraded = 0
  let maturePassed = 0
  let reviewsToday = 0
  const activeDays = new Set<number>()

  for (const log of logs) {
    totalTimeMs += log.durationMs
    const i = dayIndex(log.reviewed)
    activeDays.add(i)
    if (i === today) reviewsToday++
    if (log.stateBefore === 'review') {
      graded++
      const ok = log.rating !== Rating.Again
      if (ok) passed++
      if (log.elapsedDays >= MATURE_DAYS) {
        matureGraded++
        if (ok) maturePassed++
      }
    }
  }

  let streak = 0
  const start = activeDays.has(today) ? today : today - 1
  for (let i = start; activeDays.has(i); i--) streak++

  return {
    totalReviews: logs.length,
    totalTimeMs,
    retention: graded ? passed / graded : null,
    matureRetention: matureGraded ? maturePassed / matureGraded : null,
    streak,
    reviewsToday,
    averagePerActiveDay: activeDays.size ? logs.length / activeDays.size : 0,
  }
}
