import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_SPEEDS,
  formatRate,
  nextRate,
  normaliseRate,
} from '../playback'

describe('normalising a rate', () => {
  it('keeps a valid speed', () => {
    for (const speed of PLAYBACK_SPEEDS) expect(normaliseRate(speed)).toBe(speed)
  })

  it('refuses zero and negatives, which would stop or reverse playback', () => {
    expect(normaliseRate(0)).toBe(DEFAULT_PLAYBACK_RATE)
    expect(normaliseRate(-1)).toBe(DEFAULT_PLAYBACK_RATE)
  })

  it('resets a nonsense value rather than clamping it', () => {
    // Infinity is corruption, not "as fast as possible" - falling back to the
    // default is safer than silently choosing the fastest speed.
    expect(normaliseRate(NaN)).toBe(DEFAULT_PLAYBACK_RATE)
    expect(normaliseRate(Infinity)).toBe(DEFAULT_PLAYBACK_RATE)
    expect(normaliseRate(undefined)).toBe(DEFAULT_PLAYBACK_RATE)
    expect(normaliseRate('nonsense')).toBe(DEFAULT_PLAYBACK_RATE)
  })

  it('clamps a value from outside the offered range', () => {
    expect(normaliseRate(0.1)).toBe(0.5)
    expect(normaliseRate(4)).toBe(1.5)
  })

  it('accepts a numeric string, since settings round-trip through storage', () => {
    expect(normaliseRate('0.75')).toBe(0.75)
  })
})

describe('cycling through the speeds', () => {
  it('steps up one at a time', () => {
    expect(nextRate(0.5)).toBe(0.75)
    expect(nextRate(1)).toBe(1.25)
  })

  it('wraps round from the fastest', () => {
    expect(nextRate(1.5)).toBe(0.5)
  })

  it('falls back for a speed that is not offered', () => {
    expect(nextRate(0.9)).toBe(DEFAULT_PLAYBACK_RATE)
  })
})

describe('labelling', () => {
  it('drops trailing zeros so the control stays narrow', () => {
    expect(formatRate(1)).toBe('1×')
    expect(formatRate(0.75)).toBe('0.75×')
    expect(formatRate(1.5)).toBe('1.5×')
  })

  it('never renders a rate the element would reject', () => {
    expect(formatRate(0)).toBe('1×')
  })
})
