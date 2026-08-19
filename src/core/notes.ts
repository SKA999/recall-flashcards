import { newId } from './ids'
import type { Card, Note, NoteKind } from './types'

/** How many cards each note kind generates. */
export function cardCount(kind: NoteKind): number {
  return kind === 'reversed' ? 2 : 1
}

export function blankCard(note: Note, ordinal: number, now = Date.now()): Card {
  return {
    id: newId(),
    noteId: note.id,
    deckId: note.deckId,
    ordinal,
    state: 'new',
    step: 0,
    due: now,
    reps: 0,
    lapses: 0,
    scheduledDays: 0,
    suspended: false,
    created: now,
    updated: now,
  }
}

/**
 * Reconcile a note's cards after an edit: add cards the note now needs, and
 * report cards that should be removed (e.g. reversed -> basic).
 */
export function reconcileCards(
  note: Note,
  existing: Card[],
  now = Date.now(),
): { create: Card[]; remove: Card[] } {
  const wanted = cardCount(note.kind)
  const create: Card[] = []
  const remove: Card[] = []
  for (let ord = 0; ord < wanted; ord++) {
    if (!existing.some((c) => c.ordinal === ord)) create.push(blankCard(note, ord, now))
  }
  for (const card of existing) {
    if (card.ordinal >= wanted) remove.push(card)
  }
  return { create, remove }
}

/** Which side of the note this card asks, given its ordinal. */
export function faces(note: Note, ordinal: number): { question: string; answer: string } {
  return ordinal === 0
    ? { question: note.front, answer: note.back }
    : { question: note.back, answer: note.front }
}

const MEDIA_TOKEN = /\{\{media:([^}]+)\}\}/g

export type FieldPart =
  | { type: 'text'; value: string }
  | { type: 'media'; id: string }

/** Split field text into plain runs and embedded media references. */
export function parseField(text: string): FieldPart[] {
  const parts: FieldPart[] = []
  let last = 0
  for (const match of text.matchAll(MEDIA_TOKEN)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ type: 'text', value: text.slice(last, at) })
    parts.push({ type: 'media', id: match[1] })
    last = at + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export function mediaIdsIn(text: string): string[] {
  return [...text.matchAll(MEDIA_TOKEN)].map((m) => m[1])
}

export function mediaToken(id: string): string {
  return `{{media:${id}}}`
}

/** Field text with media tokens stripped — for list previews and search. */
export function plainText(text: string): string {
  return text.replace(MEDIA_TOKEN, ' ').replace(/\s+/g, ' ').trim()
}
