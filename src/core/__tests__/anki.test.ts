import { describe, expect, it } from 'vitest'
import { difficultyFromEase, mapScheduling, parseCardData } from '../anki'
import { MS_DAY } from '../scheduler'
import type { AnkiCardRow } from '../anki'

// 2025-01-01 UTC, a plausible collection creation time.
const CRT = 1735689600
const NOW = new Date(2026, 5, 1, 12, 0, 0).getTime()

function row(overrides: Partial<AnkiCardRow> = {}): AnkiCardRow {
  return {
    id: 1,
    nid: 1,
    did: 1,
    ord: 0,
    type: 2,
    queue: 2,
    due: 400,
    ivl: 30,
    factor: 2500,
    reps: 8,
    lapses: 1,
    left: 0,
    odue: 0,
    odid: 0,
    data: '',
    ...overrides,
  }
}

describe('parsing the data column', () => {
  it('reads FSRS memory state', () => {
    expect(parseCardData('{"s":45.3,"d":6.2,"dr":0.9,"lrt":1750000000}')).toEqual({
      stability: 45.3,
      difficulty: 6.2,
      desiredRetention: 0.9,
      decay: undefined,
      lastReviewSecs: 1750000000,
    })
  })

  it('treats an empty or broken column as absent, the way Anki does', () => {
    expect(parseCardData('')).toEqual({})
    expect(parseCardData('{not json')).toEqual({})
    expect(parseCardData('null')).toEqual({})
  })

  it('ignores non-numeric values', () => {
    expect(parseCardData('{"s":"45","d":null}').stability).toBeUndefined()
  })
})

describe('difficulty from ease', () => {
  it('puts a default-ease card mid-scale', () => {
    expect(difficultyFromEase(2500)).toBeCloseTo(5.5, 5)
  })

  it('orders harder cards above easier ones', () => {
    expect(difficultyFromEase(1300)).toBeGreaterThan(difficultyFromEase(2500))
    expect(difficultyFromEase(2500)).toBeGreaterThan(difficultyFromEase(3200))
  })

  it('stays inside 1..10 for absurd inputs', () => {
    for (const ease of [0, 100, 900, 9000, 50000]) {
      const d = difficultyFromEase(ease)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(10)
    }
  })
})

describe('cards carrying FSRS state', () => {
  const fsrs = row({ data: '{"s":45.3,"d":6.2,"lrt":1780000000}' })

  it('transfers stability and difficulty exactly', () => {
    const mapped = mapScheduling(fsrs, { crt: CRT, now: NOW })
    expect(mapped.exact).toBe(true)
    expect(mapped.stability).toBe(45.3)
    expect(mapped.difficulty).toBe(6.2)
  })

  it('uses the recorded last review time', () => {
    const mapped = mapScheduling(fsrs, { crt: CRT, now: NOW })
    expect(mapped.lastReview).toBe(1780000000 * 1000)
  })

  it('clamps a difficulty outside our range', () => {
    const mapped = mapScheduling(row({ data: '{"s":10,"d":14}' }), { crt: CRT, now: NOW })
    expect(mapped.difficulty).toBe(10)
  })
})

describe('SM-2 cards without FSRS state', () => {
  it('reads the interval as stability, which is what stability means', () => {
    const mapped = mapScheduling(row({ ivl: 30 }), { crt: CRT, now: NOW })
    expect(mapped.exact).toBe(false)
    expect(mapped.stability).toBe(30)
  })

  it('derives difficulty from the ease factor', () => {
    const easy = mapScheduling(row({ factor: 3200 }), { crt: CRT, now: NOW })
    const hard = mapScheduling(row({ factor: 1500 }), { crt: CRT, now: NOW })
    expect(hard.difficulty!).toBeGreaterThan(easy.difficulty!)
  })

  it('never produces a zero stability, which would break the curve', () => {
    const mapped = mapScheduling(row({ ivl: 0, type: 2 }), { crt: CRT, now: NOW })
    expect(mapped.stability!).toBeGreaterThan(0)
  })

  it('works the last review back from the due date', () => {
    const mapped = mapScheduling(row({ due: 400, ivl: 30 }), { crt: CRT, now: NOW })
    expect(mapped.due - mapped.lastReview!).toBe(30 * MS_DAY)
  })
})

describe('card states', () => {
  it('maps the four Anki types onto ours', () => {
    const at = (type: number) => mapScheduling(row({ type, queue: 1 }), { crt: CRT, now: NOW }).state
    // type wins over a stale interval: a reset card is new even if ivl survived.
    expect(at(0)).toBe('new')
    expect(at(1)).toBe('learning')
    expect(at(2)).toBe('review')
    expect(at(3)).toBe('relearning')
  })

  it('falls back to the interval only for an unrecognised type', () => {
    expect(mapScheduling(row({ type: 9, ivl: 30 }), { crt: CRT, now: NOW }).state).toBe('review')
    expect(mapScheduling(row({ type: 9, ivl: 0 }), { crt: CRT, now: NOW }).state).toBe('new')
  })

  it('gives a new card no memory state and a due date of now', () => {
    const mapped = mapScheduling(row({ type: 0, queue: 0, due: 17, ivl: 0 }), { crt: CRT, now: NOW })
    expect(mapped.state).toBe('new')
    expect(mapped.stability).toBeUndefined()
    expect(mapped.difficulty).toBeUndefined()
    expect(mapped.lastReview).toBeUndefined()
    // `due` on a new card is a queue position, not a date — it must not leak through.
    expect(mapped.due).toBe(NOW)
  })
})

describe('due dates', () => {
  it('counts a review card forward from the collection creation date', () => {
    const mapped = mapScheduling(row({ type: 2, queue: 2, due: 400 }), { crt: CRT, now: NOW })
    expect(mapped.due).toBe(CRT * 1000 + 400 * MS_DAY)
  })

  it('reads a learning card due as an absolute timestamp', () => {
    const stamp = 1780000123
    const mapped = mapScheduling(row({ type: 1, queue: 1, due: stamp }), { crt: CRT, now: NOW })
    expect(mapped.due).toBe(stamp * 1000)
  })

  it('reads a day-learning card due as a day count', () => {
    const mapped = mapScheduling(row({ type: 1, queue: 3, due: 500 }), { crt: CRT, now: NOW })
    expect(mapped.due).toBe(CRT * 1000 + 500 * MS_DAY)
  })

  it('keeps an overdue card overdue', () => {
    const mapped = mapScheduling(row({ due: 10 }), { crt: CRT, now: NOW })
    expect(mapped.due).toBeLessThan(NOW)
  })

  it('prefers the original due date of a card in a filtered deck', () => {
    const mapped = mapScheduling(row({ odid: 99, odue: 800, due: 3 }), { crt: CRT, now: NOW })
    expect(mapped.due).toBe(CRT * 1000 + 800 * MS_DAY)
  })
})

describe('suspension', () => {
  it('carries a suspension across', () => {
    expect(mapScheduling(row({ queue: -1 }), { crt: CRT, now: NOW }).suspended).toBe(true)
  })

  it('does not carry burial across, which expires on its own', () => {
    expect(mapScheduling(row({ queue: -2 }), { crt: CRT, now: NOW }).suspended).toBe(false)
    expect(mapScheduling(row({ queue: -3 }), { crt: CRT, now: NOW }).suspended).toBe(false)
  })
})

describe('counters', () => {
  it('carries reps and lapses across', () => {
    const mapped = mapScheduling(row({ reps: 14, lapses: 3 }), { crt: CRT, now: NOW })
    expect(mapped.reps).toBe(14)
    expect(mapped.lapses).toBe(3)
  })

  it('refuses negative counters from a damaged collection', () => {
    const mapped = mapScheduling(row({ reps: -2, lapses: -5 }), { crt: CRT, now: NOW })
    expect(mapped.reps).toBe(0)
    expect(mapped.lapses).toBe(0)
  })

  it('ignores the negative-seconds interval old collections use', () => {
    const mapped = mapScheduling(row({ ivl: -600 }), { crt: CRT, now: NOW })
    expect(mapped.scheduledDays).toBe(0)
  })
})
