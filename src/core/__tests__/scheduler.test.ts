import { describe, expect, it } from 'vitest'
import {
  answer,
  buildQueue,
  dayIndex,
  dayKey,
  DEFAULT_CONFIG,
  MS_DAY,
  MS_MIN,
  previewIntervals,
} from '../scheduler'
import { Rating } from '../types'
import type { Card, DeckConfig } from '../types'

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime()
const config: DeckConfig = { ...DEFAULT_CONFIG, fuzz: false }
const fixedRand = () => 0.5

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    noteId: 'n1',
    deckId: 'd1',
    ordinal: 0,
    state: 'new',
    step: 0,
    due: NOW,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    suspended: false,
    created: NOW,
    updated: NOW,
    ...overrides,
  }
}

describe('day boundaries', () => {
  it('treats late night as the previous study day', () => {
    const lateNight = new Date(2026, 0, 16, 2, 0, 0).getTime()
    const afternoon = new Date(2026, 0, 15, 15, 0, 0).getTime()
    expect(dayIndex(lateNight)).toBe(dayIndex(afternoon))
    expect(dayKey(lateNight)).toBe('2026-01-15')
  })

  it('rolls over at the 4am cutoff', () => {
    const before = new Date(2026, 0, 16, 3, 59, 0).getTime()
    const after = new Date(2026, 0, 16, 4, 1, 0).getTime()
    expect(dayIndex(after) - dayIndex(before)).toBe(1)
  })
})

describe('learning steps', () => {
  it('puts a new card on the first step after Again', () => {
    const { card: next } = answer(card(), Rating.Again, config, NOW, fixedRand)
    expect(next.state).toBe('learning')
    expect(next.step).toBe(0)
    expect(next.due - NOW).toBe(config.learningSteps[0] * MS_MIN)
  })

  it('advances one step on Good', () => {
    const { card: next } = answer(card(), Rating.Good, config, NOW, fixedRand)
    expect(next.state).toBe('learning')
    expect(next.step).toBe(1)
    expect(next.due - NOW).toBe(config.learningSteps[1] * MS_MIN)
  })

  it('graduates off the end of the ladder', () => {
    const onLastStep = card({ state: 'learning', step: 1, stability: 3, difficulty: 5, reps: 1 })
    const { card: next } = answer(onLastStep, Rating.Good, config, NOW, fixedRand)
    expect(next.state).toBe('review')
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1)
    expect(next.due).toBeGreaterThan(NOW)
  })

  it('skips the ladder entirely on Easy', () => {
    const { card: next } = answer(card(), Rating.Easy, config, NOW, fixedRand)
    expect(next.state).toBe('review')
    expect(next.scheduledDays).toBeGreaterThan(1)
  })

  it('goes straight to review when a deck has no learning steps', () => {
    const noSteps = { ...config, learningSteps: [] }
    const { card: next } = answer(card(), Rating.Good, noSteps, NOW, fixedRand)
    expect(next.state).toBe('review')
  })
})

describe('review answers', () => {
  const mature = card({
    state: 'review',
    stability: 30,
    difficulty: 5,
    scheduledDays: 30,
    reps: 6,
    lastReview: NOW - 30 * MS_DAY,
    due: NOW,
  })

  it('lapses into relearning on Again and counts the lapse', () => {
    const { card: next } = answer(mature, Rating.Again, config, NOW, fixedRand)
    expect(next.state).toBe('relearning')
    expect(next.lapses).toBe(1)
    expect(next.due - NOW).toBe(config.relearningSteps[0] * MS_MIN)
    expect(next.stability!).toBeLessThan(mature.stability!)
  })

  it('orders the three passing grades by interval', () => {
    const hard = answer(mature, Rating.Hard, config, NOW, fixedRand).card.scheduledDays
    const good = answer(mature, Rating.Good, config, NOW, fixedRand).card.scheduledDays
    const easy = answer(mature, Rating.Easy, config, NOW, fixedRand).card.scheduledDays
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
  })

  it('respects the maximum interval', () => {
    const capped = { ...config, maximumInterval: 10 }
    const veryStable = { ...mature, stability: 5000 }
    const { card: next } = answer(veryStable, Rating.Easy, capped, NOW, fixedRand)
    expect(next.scheduledDays).toBe(10)
  })

  it('never schedules a review-state card less than a day out', () => {
    const weak = card({ state: 'review', stability: 0.1, difficulty: 9, lastReview: NOW - MS_DAY })
    const { card: next } = answer(weak, Rating.Hard, config, NOW, fixedRand)
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('graduates back to review from relearning', () => {
    const relearning = card({
      state: 'relearning',
      step: 0,
      stability: 2,
      difficulty: 7,
      lapses: 1,
      lastReview: NOW - MS_DAY,
    })
    const { card: next } = answer(relearning, Rating.Good, config, NOW, fixedRand)
    expect(next.state).toBe('review')
    expect(next.lapses).toBe(1)
  })
})

describe('previews', () => {
  it('labels all four buttons', () => {
    const labels = previewIntervals(card(), config, NOW)
    expect(Object.values(labels)).toHaveLength(4)
    for (const label of Object.values(labels)) expect(label).toMatch(/^\d+(\.\d+)?(m|h|d|mo|y)$/)
  })

  it('does not mutate the card it previews', () => {
    const original = card({ state: 'review', stability: 10, difficulty: 5, reps: 3 })
    const snapshot = JSON.stringify(original)
    previewIntervals(original, config, NOW)
    expect(JSON.stringify(original)).toBe(snapshot)
  })
})

describe('queue building', () => {
  const many = (n: number, make: (i: number) => Partial<Card>) =>
    Array.from({ length: n }, (_, i) => card({ id: `c${i}`, ...make(i) }))

  it('caps new cards at the daily limit', () => {
    const cards = many(50, (i) => ({ state: 'new', created: NOW + i }))
    const queue = buildQueue(cards, { ...config, newPerDay: 5 }, { newSeen: 0, reviewsDone: 0 }, NOW)
    expect(queue.counts.newCount).toBe(5)
  })

  it('subtracts cards already seen today', () => {
    const cards = many(50, (i) => ({ state: 'new', created: NOW + i }))
    const queue = buildQueue(cards, { ...config, newPerDay: 5 }, { newSeen: 3, reviewsDone: 0 }, NOW)
    expect(queue.counts.newCount).toBe(2)
  })

  it('leaves out cards that are not due yet', () => {
    const cards = [
      card({ id: 'due', state: 'review', due: NOW - 1000 }),
      card({ id: 'later', state: 'review', due: NOW + MS_DAY }),
    ]
    const queue = buildQueue(cards, config, { newSeen: 0, reviewsDone: 0 }, NOW)
    expect(queue.cards.map((c) => c.id)).toEqual(['due'])
    expect(queue.nextDue).toBe(NOW + MS_DAY)
  })

  it('excludes suspended cards', () => {
    const cards = [card({ id: 'off', state: 'new', suspended: true })]
    expect(buildQueue(cards, config, { newSeen: 0, reviewsDone: 0 }, NOW).cards).toHaveLength(0)
  })

  it('puts due learning steps ahead of everything else', () => {
    const cards = [
      card({ id: 'review', state: 'review', due: NOW - 1000 }),
      card({ id: 'learn', state: 'learning', due: NOW - 500 }),
    ]
    const queue = buildQueue(cards, config, { newSeen: 0, reviewsDone: 0 }, NOW)
    expect(queue.cards[0].id).toBe('learn')
  })

  it('spreads new cards through the reviews rather than front-loading them', () => {
    const cards = [
      ...many(9, (i) => ({ id: `r${i}`, state: 'review' as const, due: NOW - 1000 + i })),
      ...many(3, (i) => ({ id: `n${i}`, state: 'new' as const, created: NOW + i })),
    ]
    const queue = buildQueue(cards, config, { newSeen: 0, reviewsDone: 0 }, NOW)
    const positions = queue.cards
      .map((c, i) => (c.state === 'new' ? i : -1))
      .filter((i) => i >= 0)
    expect(positions).toHaveLength(3)
    expect(positions[0]).toBeGreaterThan(0)
    expect(Math.max(...positions)).toBeLessThan(queue.cards.length - 1)
  })
})
