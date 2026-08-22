import { describe, expect, it } from 'vitest'
import { faces, firstFieldWithMedia, reconcileCards } from '../notes'
import {
  BASIC_ID,
  BUILTIN_NOTETYPES,
  CLOZE_ID,
  REVERSED_ID,
  cardCount,
  cardOrdinals,
  clozeNumbers,
  hasCloze,
  renderCloze,
} from '../notetypes'
import type { Card, Note, Notetype } from '../types'

const type = (id: string) => BUILTIN_NOTETYPES.find((n) => n.id === id)!

function note(fields: string[], notetypeId = BASIC_ID): Note {
  return {
    id: 'n1',
    deckId: 'd1',
    notetypeId,
    fields,
    tags: [],
    created: 0,
    modified: 0,
    updated: 0,
  }
}

function card(ordinal: number): Card {
  return {
    id: `c${ordinal}`,
    noteId: 'n1',
    deckId: 'd1',
    ordinal,
    state: 'review',
    step: 0,
    due: 0,
    reps: 5,
    lapses: 0,
    scheduledDays: 10,
    suspended: false,
    created: 0,
    updated: 0,
  }
}

describe('cloze markers', () => {
  it('finds each deletion number once, in order', () => {
    expect(clozeNumbers('El {{c2::gato}} y el {{c1::perro}} y {{c2::otro}}')).toEqual([1, 2])
  })

  it('reports none for ordinary text', () => {
    expect(hasCloze('just a sentence')).toBe(false)
    expect(clozeNumbers('')).toEqual([])
  })

  it('is not confused by a media token, which shares the braces', () => {
    expect(clozeNumbers('{{media:abc123}} and {{c1::word}}')).toEqual([1])
  })

  it('spans newlines inside a deletion', () => {
    expect(clozeNumbers('{{c1::two\nlines}}')).toEqual([1])
  })
})

describe('rendering a cloze card', () => {
  const text = 'El {{c1::gato}} duerme en la {{c2::silla}}.'

  it('blanks the deletion under test and shows the others', () => {
    expect(renderCloze(text, 1, 'question')).toBe('El […] duerme en la silla.')
    expect(renderCloze(text, 2, 'question')).toBe('El gato duerme en la […].')
  })

  it('reveals everything on the answer side', () => {
    expect(renderCloze(text, 1, 'answer')).toBe('El gato duerme en la silla.')
  })

  it('shows a hint in place of the blank when one is given', () => {
    expect(renderCloze('The {{c1::cat::animal}} sat', 1, 'question')).toBe('The [animal] sat')
    expect(renderCloze('The {{c1::cat::animal}} sat', 1, 'answer')).toBe('The cat sat')
  })

  it('leaves text without markers alone', () => {
    expect(renderCloze('nothing here', 1, 'question')).toBe('nothing here')
  })
})

describe('how many cards a note produces', () => {
  it('one per template for ordinary note types', () => {
    expect(cardCount(type(BASIC_ID), ['a', 'b'])).toBe(1)
    expect(cardCount(type(REVERSED_ID), ['a', 'b'])).toBe(2)
  })

  it('one per deletion for cloze', () => {
    expect(cardCount(type(CLOZE_ID), ['{{c1::a}} {{c2::b}} {{c3::c}}', ''])).toBe(3)
  })

  it('none for a cloze note with no deletions yet', () => {
    expect(cardCount(type(CLOZE_ID), ['not written yet', ''])).toBe(0)
  })

  it('keeps gaps in cloze numbering rather than renumbering', () => {
    // c1 and c3 only: ordinals 0 and 2, so an existing card 3 keeps its history.
    expect(cardOrdinals(type(CLOZE_ID), ['{{c1::a}} and {{c3::c}}', ''])).toEqual([0, 2])
  })
})

describe('what a card asks', () => {
  it('asks the front and answers the back', () => {
    const f = faces(note(['hola', 'hello']), type(BASIC_ID), 0)
    expect(f.question).toEqual(['hola'])
    expect(f.answer).toEqual(['hello'])
  })

  it('reverses for the second template', () => {
    const f = faces(note(['hola', 'hello']), type(REVERSED_ID), 1)
    expect(f.question).toEqual(['hello'])
    expect(f.answer).toEqual(['hola'])
  })

  it('drops empty fields rather than rendering blanks', () => {
    const f = faces(note(['hola', '   ']), type(BASIC_ID), 0)
    expect(f.answer).toEqual([])
  })

  it('renders a cloze card and appends the extra field', () => {
    const n = note(['El {{c1::gato}} y la {{c2::silla}}', 'animals'], CLOZE_ID)
    const f = faces(n, type(CLOZE_ID), 0)
    expect(f.question).toEqual(['El […] y la silla'])
    expect(f.answer).toEqual(['El gato y la silla', 'animals'])
  })

  it('omits an empty extra field on a cloze card', () => {
    const n = note(['{{c1::solo}}', ''], CLOZE_ID)
    expect(faces(n, type(CLOZE_ID), 0).answer).toEqual(['solo'])
  })

  it('supports note types wider than two fields', () => {
    const wide: Notetype = {
      id: 'wide',
      name: 'Vocab',
      fields: ['Word', 'Meaning', 'Example'],
      templates: [
        { name: 'Recognition', question: [0], answer: [1, 2] },
        { name: 'Recall', question: [1], answer: [0] },
      ],
      isCloze: false,
      created: 0,
      updated: 0,
    }
    const n = note(['estrenar', 'to use for the first time', 'Hoy estreno zapatos.'], 'wide')
    expect(faces(n, wide, 0).answer).toEqual(['to use for the first time', 'Hoy estreno zapatos.'])
    expect(faces(n, wide, 1).question).toEqual(['to use for the first time'])
  })
})

describe('which field plays its sound', () => {
  const token = '{{media:abc-123}}'

  it('finds a sound in a field of its own, beside the text', () => {
    expect(firstFieldWithMedia(['\u5b66\u6821', token])).toBe(1)
  })

  it('finds a sound sharing a field with text', () => {
    expect(firstFieldWithMedia([`\u5b66\u6821\n${token}`])).toBe(0)
  })

  it('picks the first of several', () => {
    expect(firstFieldWithMedia(['a', token, '{{media:def-456}}'])).toBe(1)
  })

  it('reports none when the side is all text', () => {
    expect(firstFieldWithMedia(['\u5b66\u6821', 'school'])).toBe(-1)
    expect(firstFieldWithMedia([])).toBe(-1)
  })

  it('is not confused by a cloze marker, which shares the braces', () => {
    expect(firstFieldWithMedia(['{{c1::word}}'])).toBe(-1)
  })

  it('gives the same answer when asked twice', () => {
    const fields = ['a', token]
    expect(firstFieldWithMedia(fields)).toBe(firstFieldWithMedia(fields))
  })
})

describe('reconciling cards after an edit', () => {
  it('creates the missing cards and keeps the ones that exist', () => {
    const n = note(['a', 'b'])
    const { create, remove } = reconcileCards(n, type(REVERSED_ID), [card(0)])
    expect(create.map((c) => c.ordinal)).toEqual([1])
    expect(remove).toEqual([])
  })

  it('removes a card whose template is gone', () => {
    const n = note(['a', 'b'])
    const { create, remove } = reconcileCards(n, type(BASIC_ID), [card(0), card(1)])
    expect(create).toEqual([])
    expect(remove.map((c) => c.ordinal)).toEqual([1])
  })

  it('adds a card when a cloze deletion is added', () => {
    const n = note(['{{c1::a}} {{c2::b}}', ''], CLOZE_ID)
    const { create } = reconcileCards(n, type(CLOZE_ID), [card(0)])
    expect(create.map((c) => c.ordinal)).toEqual([1])
  })

  it('removes a card when its cloze deletion is deleted', () => {
    const n = note(['{{c1::a}} only', ''], CLOZE_ID)
    const { remove } = reconcileCards(n, type(CLOZE_ID), [card(0), card(1)])
    expect(remove.map((c) => c.ordinal)).toEqual([1])
  })

  it('never recreates an existing card, so scheduling survives an edit', () => {
    const n = note(['{{c1::a}} {{c2::b}}', ''], CLOZE_ID)
    const existing = [card(0), card(1)]
    const { create, remove } = reconcileCards(n, type(CLOZE_ID), existing)
    expect(create).toEqual([])
    expect(remove).toEqual([])
  })
})
