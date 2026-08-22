// The example files ship as documentation, so they are held to the same bar as
// anything else: if the parser stops handling them, this fails.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htmlToText, looksLikeHeader, parseDelimited } from '../csv'

const read = (name: string) => readFileSync(join(process.cwd(), 'examples', name), 'utf8')

describe('example-cards.csv', () => {
  const parsed = parseDelimited(read('example-cards.csv'))

  it('detects commas and three columns', () => {
    expect(parsed.delimiter).toBe(',')
    expect(parsed.rows[0]).toEqual(['Front', 'Back', 'Tags'])
  })

  it('has no ragged rows despite the quoting', () => {
    expect(parsed.raggedRows).toBe(0)
  })

  it('is recognised as having a header', () => {
    expect(looksLikeHeader(parsed.rows)).toBe(true)
  })

  it('keeps a comma that lives inside a quoted field', () => {
    const row = parsed.rows.find((r) => r[0] === 'la sobremesa')!
    expect(row[1]).toBe('the conversation after a meal, once the plates are cleared')
  })

  it('keeps a newline that lives inside a quoted field', () => {
    const row = parsed.rows.find((r) => r[0] === '¿Qué tal?')!
    expect(row[1]).toBe("How's it going?\n(informal greeting)")
  })

  it('unescapes doubled quotes on both sides', () => {
    const row = parsed.rows.find((r) => r[0] === 'el "no sé qué"')!
    expect(row[1]).toBe(`the "certain something" you can't name`)
  })

  it('keeps a trailing comma inside a quoted front', () => {
    expect(parsed.rows.some((r) => r[0] === 'apagar,')).toBe(true)
  })

  it('yields ten cards after the header', () => {
    expect(parsed.rows.length - 1).toBe(10)
  })
})

describe('example-cards-chinese.csv', () => {
  const parsed = parseDelimited(read('example-cards-chinese.csv'))

  it('picks the ASCII comma, not the full-width one inside a field', () => {
    expect(parsed.delimiter).toBe(',')
    expect(parsed.raggedRows).toBe(0)
  })

  it('keeps Chinese characters intact', () => {
    expect(parsed.rows[1]).toEqual(['\u4f60\u597d', 'hello', 'greeting'])
  })

  it('keeps a full-width comma inside a quoted field', () => {
    const row = parsed.rows.find((r) => r[0].includes('\u6211\u5f88\u597d'))!
    expect(row[0]).toBe('\u6211\u5f88\u597d\uff0c\u8c22\u8c22')
    expect(row[1]).toBe("I'm fine, thank you")
  })

  it('yields six cards after the header', () => {
    expect(parsed.rows.length - 1).toBe(6)
  })
})

describe('example-cards-anki.txt', () => {
  const parsed = parseDelimited(read('example-cards-anki.txt'))

  it('reads the Anki preamble', () => {
    expect(parsed.delimiter).toBe('\t')
    expect(parsed.meta.html).toBe(true)
    expect(parsed.meta.tags).toEqual(['imported'])
    expect(parsed.meta.columns).toEqual(['Front', 'Back', 'Tags'])
  })

  it('does not treat the preamble as data', () => {
    expect(parsed.rows[0][0]).toBe('das Fernweh')
    expect(parsed.rows).toHaveLength(5)
  })

  it('turns Anki HTML into readable plain text', () => {
    const row = parsed.rows.find((r) => r[0] === 'der Kummerspeck')!
    expect(htmlToText(row[1])).toBe('"grief bacon"\nweight gained from emotional eating')
  })

  it('decodes entities in the middle of a field', () => {
    const row = parsed.rows.find((r) => r[0] === 'die Schadenfreude')!
    expect(htmlToText(row[1])).toBe("pleasure at another's misfortune")
  })
})
