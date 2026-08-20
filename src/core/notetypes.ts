// Built-in note types, and the cloze handling that sits alongside them.
//
// Anki's template language is deliberately not implemented. A template here
// only says which fields are asked and which are answered, which is enough to
// carry real note types across while keeping card content plain text.

import type { Notetype } from './types'

export const BASIC_ID = 'basic'
export const REVERSED_ID = 'reversed'
export const CLOZE_ID = 'cloze'

const EPOCH = 0

function builtin(
  id: string,
  name: string,
  fields: string[],
  templates: Notetype['templates'],
  cloze?: number,
): Notetype {
  return {
    id,
    name,
    fields,
    templates,
    isCloze: cloze !== undefined,
    clozeField: cloze,
    created: EPOCH,
    updated: EPOCH,
  }
}

export const BUILTIN_NOTETYPES: Notetype[] = [
  builtin(BASIC_ID, 'Basic', ['Front', 'Back'], [
    { name: 'Card 1', question: [0], answer: [1] },
  ]),
  builtin(REVERSED_ID, 'Basic (and reversed)', ['Front', 'Back'], [
    { name: 'Card 1', question: [0], answer: [1] },
    { name: 'Card 2', question: [1], answer: [0] },
  ]),
  builtin(CLOZE_ID, 'Cloze', ['Text', 'Extra'], [
    { name: 'Cloze', question: [0], answer: [0, 1] },
  ], 0),
]

export function isBuiltin(id: string): boolean {
  return BUILTIN_NOTETYPES.some((n) => n.id === id)
}

/** `{{c1::hidden}}` or `{{c1::hidden::hint}}` — Anki's cloze markers. */
const CLOZE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs

/** Which cloze numbers appear in this text, in order. */
export function clozeNumbers(text: string): number[] {
  const seen = new Set<number>()
  for (const match of text.matchAll(CLOZE)) seen.add(Number(match[1]))
  return [...seen].sort((a, b) => a - b)
}

export function hasCloze(text: string): boolean {
  return clozeNumbers(text).length > 0
}

/**
 * Render one cloze card. The deletion being tested is blanked on the question
 * side and revealed on the answer side; every other deletion always shows its
 * text, so the sentence stays readable either way.
 */
export function renderCloze(text: string, number: number, side: 'question' | 'answer'): string {
  return text.replace(CLOZE, (_match, index, content, hint) => {
    if (Number(index) !== number) return content
    if (side === 'answer') return content
    return hint ? `[${hint}]` : '[…]'
  })
}

/**
 * How many cards this note produces. Cloze types generate one per deletion;
 * everything else generates one per template.
 */
export function cardCount(notetype: Notetype, fields: string[]): number {
  if (!notetype.isCloze) return notetype.templates.length
  const text = fields[notetype.clozeField ?? 0] ?? ''
  return clozeNumbers(text).length
}

/**
 * The ordinals a note should have cards for. Cloze ordinals follow Anki's
 * convention of `cN - 1`, so gaps are preserved: a note with only c1 and c3
 * keeps ordinals 0 and 2 rather than renumbering.
 */
export function cardOrdinals(notetype: Notetype, fields: string[]): number[] {
  if (!notetype.isCloze) return notetype.templates.map((_, i) => i)
  const text = fields[notetype.clozeField ?? 0] ?? ''
  return clozeNumbers(text).map((n) => n - 1)
}
