// A sample deck with plausible history, so a prototype build opens on something
// worth looking at instead of an empty screen. Only used when VITE_DEMO is set.

import { newId } from '../core/ids'
import { blankCard } from '../core/notes'
import { DEFAULT_CONFIG, MS_DAY } from '../core/scheduler'
import { Rating } from '../core/types'
import type { Card, Deck, Note, ReviewLog } from '../core/types'
import type { Store } from '../core/storage'

const WORDS: [string, string][] = [
  ['el amanecer', 'dawn'],
  ['la brisa', 'breeze'],
  ['el esfuerzo', 'effort'],
  ['la huella', 'footprint'],
  ['el idioma', 'language'],
  ['la llave', 'key'],
  ['el olvido', 'oblivion'],
  ['la rama', 'branch'],
  ['el sabor', 'flavour'],
  ['el umbral', 'threshold'],
  ['la mariposa', 'butterfly'],
  ['el puente', 'bridge'],
  ['la tormenta', 'storm'],
  ['el bosque', 'forest'],
  ['la escalera', 'stairs'],
  ['el hilo', 'thread'],
  ['la isla', 'island'],
  ['el nudo', 'knot'],
  ['la ola', 'wave'],
  ['el zorro', 'fox'],
]

/** Deterministic, so the demo looks the same every time it is built. */
function makeRandom(seed: number) {
  let state = seed
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
}

export async function seedDemo(store: Store, now = Date.now()): Promise<void> {
  const rnd = makeRandom(7)
  const deck: Deck = {
    id: newId(),
    name: 'Spanish vocabulary',
    description: 'Sample deck',
    config: { ...DEFAULT_CONFIG, weights: [...DEFAULT_CONFIG.weights] },
    created: now - 60 * MS_DAY,
    updated: now,
  }

  const notes: Note[] = []
  const cards: Card[] = []
  const logs: ReviewLog[] = []

  WORDS.forEach(([front, back], i) => {
    const created = now - (60 - i * 2) * MS_DAY
    const note: Note = {
      id: newId(),
      deckId: deck.id,
      kind: 'basic',
      front,
      back,
      tags: ['noun'],
      created,
      modified: created,
      updated: created,
    }
    notes.push(note)

    const card = blankCard(note, 0, created)
    // A spread across the ladder: some new, a few learning, the rest reviewing.
    if (i < 5) {
      cards.push(card)
      return
    }
    if (i < 8) {
      cards.push({ ...card, state: 'learning', step: 1, due: now - 60_000, reps: 2,
        stability: 1 + rnd(), difficulty: 4 + rnd() * 3, lastReview: now - 20 * 60_000 })
      return
    }
    const interval = i < 14 ? 2 + Math.floor(rnd() * 12) : 25 + Math.floor(rnd() * 120)
    const overdue = rnd() < 0.4
    cards.push({
      ...card,
      state: 'review',
      due: now + (overdue ? -1 : Math.floor(rnd() * 20)) * MS_DAY,
      reps: 4 + Math.floor(rnd() * 10),
      lapses: Math.floor(rnd() * 3),
      scheduledDays: interval,
      stability: interval * (0.9 + rnd() * 0.3),
      difficulty: 3 + rnd() * 4,
      lastReview: now - interval * MS_DAY,
    })
  })

  // Two months of review history, so the stats screen has a shape.
  for (const card of cards) {
    for (let k = 0; k < card.reps; k++) {
      const rating = rnd() < 0.12 ? Rating.Again : rnd() < 0.25 ? Rating.Hard : rnd() < 0.92 ? Rating.Good : Rating.Easy
      logs.push({
        id: newId(),
        cardId: card.id,
        deckId: deck.id,
        rating,
        stateBefore: 'review',
        elapsedDays: Math.floor(rnd() * 30),
        scheduledDays: Math.floor(rnd() * 50),
        durationMs: 3000 + Math.floor(rnd() * 9000),
        reviewed: now - Math.floor(rnd() * 55) * MS_DAY - Math.floor(rnd() * 10) * 3_600_000,
      })
    }
  }

  await store.putDeck(deck)
  for (const note of notes) await store.putNote(note)
  await store.putCards(cards)
  for (const log of logs) await store.addLog(log)
}
