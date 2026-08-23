// Playback speed for card audio.
//
// Slowing speech down is the point here: a synthesised word is short, and a
// learner hearing a tone for the first time needs it stretched. Speeding up is
// offered too, for material you already half know.

/** Offered speeds. Enough choice to be useful, few enough to be one tap. */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const

export const DEFAULT_PLAYBACK_RATE = 1

const MIN = PLAYBACK_SPEEDS[0]
const MAX = PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1]

/**
 * Bring a stored or restored value back into range.
 *
 * A rate of zero pauses playback and a negative one is rejected outright by
 * the media element, so a bad value must never reach it — this is the guard
 * between persisted settings and the DOM.
 */
export function normaliseRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_PLAYBACK_RATE
  return Math.min(Math.max(rate, MIN), MAX)
}

/** The next speed up, wrapping back to the slowest. For a cycling control. */
export function nextRate(current: number): number {
  const at = PLAYBACK_SPEEDS.indexOf(normaliseRate(current) as (typeof PLAYBACK_SPEEDS)[number])
  if (at === -1) return DEFAULT_PLAYBACK_RATE
  return PLAYBACK_SPEEDS[(at + 1) % PLAYBACK_SPEEDS.length]
}

/** "1×", "0.75×" — trailing zeros dropped so the control stays narrow. */
export function formatRate(rate: number): string {
  const value = normaliseRate(rate)
  return `${Number(value.toFixed(2))}×`
}
