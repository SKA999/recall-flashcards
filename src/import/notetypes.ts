// Maps an Anki note type onto one of ours.
//
// Anki's templates are a small language; we don't evaluate it. All we need is
// which fields a template *mentions*, which a regex answers. Conditionals and
// filters get flattened — a field hidden behind {{#Cond}} or {{hint:}} simply
// shows — so the result is content-complete and layout-approximate.

import { BUILTIN_NOTETYPES } from '../core/notetypes'
import type { CardTemplate, Notetype } from '../core/types'
import type { AnkiNotetype } from './collection'

/** Any {{...}} reference in a template. */
const REFERENCE = /\{\{([^}]+)\}\}/g

/** Names that address the card itself rather than a field. */
const SPECIAL = new Set([
  'frontside',
  'tags',
  'type',
  'deck',
  'subdeck',
  'card',
  'cardflag',
])

/**
 * Field indexes a template references, in order of first appearance.
 * Section markers ({{#Field}}, {{^Field}}, {{/Field}}) are conditions rather
 * than content, so they are not treated as displayed fields.
 */
export function referencedFields(format: string, fieldNames: string[]): number[] {
  const lookup = new Map(fieldNames.map((name, i) => [name.toLowerCase().trim(), i]))
  const found: number[] = []
  for (const match of format.matchAll(REFERENCE)) {
    let token = match[1].trim()
    if (token.startsWith('#') || token.startsWith('^') || token.startsWith('/')) continue
    // Strip any filter chain: "cloze:Text", "text:hint:Back".
    const name = token.split(':').pop()?.trim() ?? ''
    if (!name || SPECIAL.has(name.toLowerCase())) continue
    const index = lookup.get(name.toLowerCase())
    if (index != null && !found.includes(index)) found.push(index)
  }
  return found
}

/** The field a cloze template pulls its deletions from. */
export function clozeFieldOf(anki: AnkiNotetype): number {
  for (const template of anki.templates) {
    for (const match of template.qfmt.matchAll(REFERENCE)) {
      const token = match[1].trim()
      if (!token.toLowerCase().startsWith('cloze:')) continue
      const name = token.split(':').pop()?.trim().toLowerCase() ?? ''
      const index = anki.fields.findIndex((f) => f.toLowerCase().trim() === name)
      if (index >= 0) return index
    }
  }
  return 0
}

function toTemplate(
  name: string,
  qfmt: string,
  afmt: string,
  fields: string[],
  index: number,
): CardTemplate {
  const question = referencedFields(qfmt, fields)
  const answerRefs = referencedFields(afmt, fields)
  // The question stays on screen when the answer is revealed, so don't repeat it.
  let answer = answerRefs.filter((i) => !question.includes(i))
  if (answer.length === 0) {
    // An answer format that only used {{FrontSide}}, or one we couldn't read:
    // show whatever the question didn't.
    answer = fields.map((_, i) => i).filter((i) => !question.includes(i))
  }
  return {
    name: name || `Card ${index + 1}`,
    // A template referencing no field at all would produce a blank card.
    question: question.length ? question : [0],
    answer,
  }
}

/** Does this Anki type match a built-in exactly enough to reuse it? */
function matchingBuiltin(fields: string[], templates: CardTemplate[], isCloze: boolean) {
  const sameFields = (a: string[], b: string[]) =>
    a.length === b.length && a.every((f, i) => f.toLowerCase() === b[i].toLowerCase())
  const sameTemplate = (a: CardTemplate, b: CardTemplate) =>
    String(a.question) === String(b.question) && String(a.answer) === String(b.answer)

  return BUILTIN_NOTETYPES.find(
    (b) =>
      b.isCloze === isCloze &&
      sameFields(b.fields, fields) &&
      b.templates.length === templates.length &&
      b.templates.every((t, i) => sameTemplate(t, templates[i])),
  )
}

/**
 * Convert an Anki note type. Types that match a built-in reuse it, so a
 * collection full of ordinary Basic notes doesn't clutter the picker with
 * near-duplicates. Everything else gets a stable id derived from Anki's, so
 * re-importing the same collection updates rather than duplicates.
 */
export function toNotetype(anki: AnkiNotetype, now = Date.now()): Notetype {
  const fields = anki.fields.length ? anki.fields : ['Front', 'Back']
  const templates = anki.templates
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((t, i) => toTemplate(t.name, t.qfmt, t.afmt, fields, i))

  const resolved = templates.length
    ? templates
    : [{ name: 'Card 1', question: [0], answer: fields.map((_, i) => i).slice(1) }]

  const builtin = matchingBuiltin(fields, resolved, anki.isCloze)
  if (builtin) return builtin

  return {
    id: `anki-${anki.id}`,
    name: anki.name || 'Imported note type',
    fields,
    templates: resolved,
    isCloze: anki.isCloze,
    clozeField: anki.isCloze ? clozeFieldOf(anki) : undefined,
    created: now,
    updated: now,
  }
}
