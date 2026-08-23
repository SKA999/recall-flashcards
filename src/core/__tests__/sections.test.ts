import { describe, expect, it } from 'vitest'
import { looksLikeSectionColumn } from '../sections'

/** Repeat a set of labels across enough rows to look like a real column. */
const spread = (labels: string[], rows = 20) =>
  Array.from({ length: rows }, (_, i) => labels[i % labels.length])

describe('columns that partition a deck', () => {
  it('recognises numbered weeks', () => {
    expect(looksLikeSectionColumn(spread(['5A-Week 1', '5A-Week 2', '5A-Week 3']))).toBe(true)
  })

  it('recognises named stages that share no words', () => {
    // A composition outline: Opening, Content, Ending are labels, not tags.
    expect(
      looksLikeSectionColumn(
        spread(['Opening', 'Transition', 'Content', 'Resolution', 'Ending', 'Picture Prompt']),
      ),
    ).toBe(true)
  })

  it('recognises units and lessons', () => {
    expect(looksLikeSectionColumn(spread(['Unit 1', 'Unit 2']))).toBe(true)
  })
})

describe('columns that tag cards', () => {
  it('rejects combinations built from a shared vocabulary', () => {
    // "noun" recurs across values, so these are tags to be split apart.
    expect(
      looksLikeSectionColumn(spread(['noun weather', 'noun time', 'verb', 'noun idiom'])),
    ).toBe(false)
  })

  it('rejects a column with too many distinct values to be a partition', () => {
    expect(looksLikeSectionColumn(Array.from({ length: 20 }, (_, i) => `label-${i}`))).toBe(false)
  })

  it('rejects values too long to be labels', () => {
    expect(
      looksLikeSectionColumn(spread(['this is a rather long descriptive phrase', 'short'])),
    ).toBe(false)
  })
})

describe('not enough to judge', () => {
  it('declines on a handful of rows', () => {
    expect(looksLikeSectionColumn(['Opening', 'Ending'])).toBe(false)
  })

  it('ignores blanks when counting', () => {
    expect(looksLikeSectionColumn(['Opening', '', '  ', 'Ending'])).toBe(false)
  })

  it('handles an empty column', () => {
    expect(looksLikeSectionColumn([])).toBe(false)
  })
})
