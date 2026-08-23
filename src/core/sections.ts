// Deciding whether a column of labels partitions the deck or tags its cards.

/**
 * Is a tag column really a section?
 *
 * The distinction only matters for multi-word values: a tags cell splits into
 * several tags, while a section cell is kept whole. "5A-Week 1" split gives the
 * useless pair "5A-Week" and "1" - exactly what Anki does to a tag containing a
 * space - whereas "noun place" is genuinely two tags.
 *
 * What separates them is not length but vocabulary. A tags column is built from
 * combinations, so its words recur across different values: "noun weather" and
 * "noun time" share "noun". A section column is a list of distinct labels that
 * share nothing - Opening, Transition, Content. Numbered labels are treated as
 * sections outright, since "Week 1" and "Week 2" share a word by construction.
 */
export function looksLikeSectionColumn(values: string[]): boolean {
  const present = values.map((v) => v.trim()).filter(Boolean)
  if (present.length < 4) return false

  const distinct = [...new Set(present)]
  // Sections repeat: a handful of labels across many rows.
  if (distinct.length > Math.max(3, present.length / 3)) return false
  if (distinct.some((v) => v.split(/\s+/).length > 4)) return false

  // Numbered labels are sections whatever else they look like.
  if (distinct.every((v) => /\d/.test(v))) return true

  const seen = new Map<string, number>()
  for (const value of distinct) {
    for (const word of new Set(value.toLowerCase().split(/\s+/))) {
      seen.set(word, (seen.get(word) ?? 0) + 1)
    }
  }
  // A word used by more than one label means these are combinations, not names.
  return [...seen.values()].every((count) => count === 1)
}
