import { newId } from './ids'
import { cardOrdinals, renderCloze } from './notetypes'
import type { Card, Note, Notetype } from './types'

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
 * Reconcile a note's cards after an edit: add cards it now needs, and report
 * cards that no longer belong — a removed cloze deletion, or a note type with
 * fewer templates than before.
 *
 * Existing cards are never recreated, so editing a note keeps its scheduling.
 */
export function reconcileCards(
  note: Note,
  notetype: Notetype,
  existing: Card[],
  now = Date.now(),
): { create: Card[]; remove: Card[] } {
  const wanted = cardOrdinals(notetype, note.fields)
  const wantedSet = new Set(wanted)
  return {
    create: wanted
      .filter((ord) => !existing.some((c) => c.ordinal === ord))
      .map((ord) => blankCard(note, ord, now)),
    remove: existing.filter((c) => !wantedSet.has(c.ordinal)),
  }
}

export interface CardFaces {
  /** Field values shown as the question, already cloze-rendered. */
  question: string[]
  /** Field values shown once the answer is revealed. */
  answer: string[]
}

const value = (note: Note, index: number) => note.fields[index] ?? ''

/** What this card asks and answers. Empty fields are dropped, not rendered blank. */
export function faces(note: Note, notetype: Notetype, ordinal: number): CardFaces {
  if (notetype.isCloze) {
    const field = notetype.clozeField ?? 0
    const text = value(note, field)
    const number = ordinal + 1
    const extras = notetype.templates[0]?.answer.filter((i) => i !== field) ?? []
    return {
      question: [renderCloze(text, number, 'question')],
      answer: [renderCloze(text, number, 'answer'), ...extras.map((i) => value(note, i))].filter(
        (v) => v.trim() !== '',
      ),
    }
  }

  const template = notetype.templates[ordinal] ?? notetype.templates[0]
  if (!template) return { question: [], answer: [] }
  const pick = (indexes: number[]) => indexes.map((i) => value(note, i)).filter((v) => v.trim() !== '')
  return { question: pick(template.question), answer: pick(template.answer) }
}

/**
 * Turn a label into a single tag. Tags cannot contain spaces - Anki splits on
 * them, which is how "3B-Week 1" becomes two useless tags - so a section name
 * is joined up rather than left to break apart.
 */
export function toTag(label: string): string {
  return label.trim().replace(/\s+/g, '-')
}

/** Case-insensitive tag match, so "Week-1" and "week-1" are the same section. */
export function hasTag(tags: string[], tag: string): boolean {
  const wanted = tag.toLowerCase()
  return tags.some((t) => t.toLowerCase() === wanted)
}

/** Every tag used across these notes, with how many notes carry each. */
export function tagCounts(notes: { tags: string[] }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const note of notes) {
    for (const tag of new Set(note.tags.map((t) => t.trim()).filter(Boolean))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}

/** The field a note is identified by in lists and duplicate checks. */
export function sortField(note: Note): string {
  return note.fields.find((f) => f.trim() !== '') ?? ''
}

const MEDIA_TOKEN = /\{\{media:([^}]+)\}\}/g

export type FieldPart = { type: 'text'; value: string } | { type: 'media'; id: string }

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

/**
 * Which field on a side holds the first media, or -1 for none.
 *
 * Sound is usually a field of its own beside the text it belongs to, so
 * "play the first field" is not the same as "play the first sound".
 */
export function firstFieldWithMedia(fields: string[]): number {
  return fields.findIndex((field) => mediaIdsIn(field).length > 0)
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
