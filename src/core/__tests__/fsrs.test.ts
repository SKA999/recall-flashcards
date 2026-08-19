import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS,
  applyFuzz,
  fuzzDelta,
  initialDifficulty,
  initialStability,
  intervalForRetention,
  nextDifficulty,
  nextMemoryState,
  retrievability,
  stabilityAfterLapse,
  stabilityAfterRecall,
} from '../fsrs'
import { Rating } from '../types'

const w = DEFAULT_WEIGHTS

describe('forgetting curve', () => {
  it('is certain at zero elapsed time', () => {
    expect(retrievability(0, 5)).toBeCloseTo(1, 10)
  })

  it('hits exactly 90% when elapsed days equal stability', () => {
    for (const s of [1, 5, 37, 400]) {
      expect(retrievability(s, s)).toBeCloseTo(0.9, 6)
    }
  })

  it('decays monotonically', () => {
    const points = [1, 2, 4, 8, 16].map((t) => retrievability(t, 10))
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeLessThan(points[i - 1])
  })

  it('inverts back to the interval that produces the target retention', () => {
    const s = 12.5
    for (const r of [0.8, 0.9, 0.95]) {
      const days = intervalForRetention(s, r)
      expect(retrievability(days, s)).toBeCloseTo(r, 6)
    }
  })

  it('schedules an interval equal to stability at 90% retention', () => {
    expect(intervalForRetention(30, 0.9)).toBeCloseTo(30, 6)
  })
})

describe('initial state', () => {
  it('takes first stability straight from the weights', () => {
    expect(initialStability(w, Rating.Again)).toBeCloseTo(w[0])
    expect(initialStability(w, Rating.Easy)).toBeCloseTo(w[3])
  })

  it('gives an easier first answer a lower difficulty', () => {
    expect(initialDifficulty(w, Rating.Easy)).toBeLessThan(initialDifficulty(w, Rating.Again))
  })

  it('keeps difficulty inside 1..10 for every rating', () => {
    for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      const d = initialDifficulty(w, r)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(10)
    }
  })
})

describe('difficulty updates', () => {
  it('rises after Again and falls after Easy', () => {
    expect(nextDifficulty(w, 5, Rating.Again)).toBeGreaterThan(5)
    expect(nextDifficulty(w, 5, Rating.Easy)).toBeLessThan(5)
  })

  it('never escapes the 1..10 band, even under repeated pressure', () => {
    let d = 5
    for (let i = 0; i < 200; i++) d = nextDifficulty(w, d, Rating.Again)
    expect(d).toBeLessThanOrEqual(10)
    for (let i = 0; i < 200; i++) d = nextDifficulty(w, d, Rating.Easy)
    expect(d).toBeGreaterThanOrEqual(1)
  })
})

describe('stability updates', () => {
  const state = { stability: 10, difficulty: 5 }
  const r = retrievability(10, 10)

  it('grows more the better the answer', () => {
    const hard = stabilityAfterRecall(w, state, r, Rating.Hard)
    const good = stabilityAfterRecall(w, state, r, Rating.Good)
    const easy = stabilityAfterRecall(w, state, r, Rating.Easy)
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
    expect(hard).toBeGreaterThan(state.stability)
  })

  it('rewards a successful recall more when it was less likely', () => {
    const soon = stabilityAfterRecall(w, state, retrievability(2, 10), Rating.Good)
    const late = stabilityAfterRecall(w, state, retrievability(30, 10), Rating.Good)
    expect(late).toBeGreaterThan(soon)
  })

  it('never increases stability on a lapse', () => {
    for (const s of [0.5, 3, 40, 500]) {
      const lapsed = stabilityAfterLapse(w, { stability: s, difficulty: 6 }, retrievability(s, s))
      expect(lapsed).toBeLessThanOrEqual(s)
      expect(lapsed).toBeGreaterThan(0)
    }
  })
})

describe('nextMemoryState', () => {
  it('bootstraps from nothing on the first answer', () => {
    const first = nextMemoryState(w, undefined, Rating.Good, 0)
    expect(first.stability).toBeCloseTo(w[2])
    expect(first.difficulty).toBeCloseTo(initialDifficulty(w, Rating.Good))
  })

  it('uses the same-day formula when no day boundary was crossed', () => {
    const prev = { stability: 4, difficulty: 5 }
    const sameDay = nextMemoryState(w, prev, Rating.Good, 0)
    const nextDay = nextMemoryState(w, prev, Rating.Good, 1)
    expect(sameDay.stability).not.toBeCloseTo(nextDay.stability, 4)
  })
})

describe('fuzz', () => {
  it('leaves short intervals alone', () => {
    expect(applyFuzz(1, () => 0.5)).toBe(1)
    expect(applyFuzz(2, () => 0)).toBe(2)
  })

  it('stays inside the delta band', () => {
    const interval = 100
    const delta = fuzzDelta(interval)
    for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
      const fuzzed = applyFuzz(interval, () => roll)
      expect(fuzzed).toBeGreaterThanOrEqual(Math.round(interval - delta))
      expect(fuzzed).toBeLessThanOrEqual(Math.round(interval + delta))
    }
  })

  it('widens the band as intervals grow', () => {
    expect(fuzzDelta(3)).toBeLessThan(fuzzDelta(30))
    expect(fuzzDelta(30)).toBeLessThan(fuzzDelta(300))
  })
})
