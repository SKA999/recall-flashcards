import { describe, expect, it } from 'vitest'
import {
  detectDelimiter,
  htmlToText,
  looksLikeHeader,
  parseDelimited,
  parseRows,
  readAnkiHeader,
} from '../csv'

describe('quoting', () => {
  it('keeps a delimiter that sits inside quotes', () => {
    expect(parseRows('a,"b,c",d', ',')).toEqual([['a', 'b,c', 'd']])
  })

  it('keeps a newline that sits inside quotes', () => {
    expect(parseRows('one,"line one\nline two"\nnext,row', ',')).toEqual([
      ['one', 'line one\nline two'],
      ['next', 'row'],
    ])
  })

  it('unescapes a doubled quote', () => {
    expect(parseRows('a,"she said ""hi""",b', ',')).toEqual([['a', 'she said "hi"', 'b']])
  })

  it('treats a quote in the middle of a field as literal', () => {
    expect(parseRows('5" nail,thing', ',')).toEqual([['5" nail', 'thing']])
  })

  it('handles an empty quoted field', () => {
    expect(parseRows('a,"",c', ',')).toEqual([['a', '', 'c']])
  })
})

describe('line endings', () => {
  it('reads CRLF as one break', () => {
    expect(parseRows('a,b\r\nc,d', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('does not invent a record from a trailing newline', () => {
    expect(parseRows('a,b\n', ',')).toEqual([['a', 'b']])
  })

  it('keeps a genuinely empty middle field', () => {
    expect(parseRows('a,,c', ',')).toEqual([['a', '', 'c']])
  })
})

describe('delimiter detection', () => {
  it('finds tabs', () => {
    expect(detectDelimiter('a\tb\tc\nd\te\tf')).toBe('\t')
  })

  it('finds semicolons', () => {
    expect(detectDelimiter('a;b\nc;d\ne;f')).toBe(';')
  })

  it('prefers the delimiter that gives consistent columns', () => {
    // Commas appear inside the prose, but only the tab splits evenly.
    const text = 'hello, world\tgreeting\nred, green, blue\tcolours'
    expect(detectDelimiter(text)).toBe('\t')
  })

  it('is not fooled by commas inside quoted fields', () => {
    const text = '"a,b,c,d";one\n"e,f";two\n"g,h,i";three'
    expect(detectDelimiter(text)).toBe(';')
  })
})

describe('the Anki header block', () => {
  it('reads a named separator', () => {
    const { meta } = readAnkiHeader('#separator:tab\nfront\tback\n')
    expect(meta.separator).toBe('\t')
  })

  it('reads a literal separator character', () => {
    expect(readAnkiHeader('#separator:;\na;b\n').meta.separator).toBe(';')
  })

  it('reads html, deck and file-wide tags', () => {
    const { meta } = readAnkiHeader('#html:true\n#deck:Spanish\n#tags:imported vocab\n')
    expect(meta.html).toBe(true)
    expect(meta.deck).toBe('Spanish')
    expect(meta.tags).toEqual(['imported', 'vocab'])
  })

  it('reads the tags column index', () => {
    expect(readAnkiHeader('#tags column:3\n').meta.tagsColumn).toBe(3)
  })

  it('reads declared column names using the declared separator', () => {
    const { meta } = readAnkiHeader('#separator:tab\n#columns:Front\tBack\tTags\n')
    expect(meta.columns).toEqual(['Front', 'Back', 'Tags'])
  })

  it('reports where the records start', () => {
    const text = '#separator:,\n#html:false\nfront,back\n'
    const { offset } = readAnkiHeader(text)
    expect(text.slice(offset)).toBe('front,back\n')
  })

  it('leaves a file without a preamble alone', () => {
    const { meta, offset } = readAnkiHeader('front,back\n')
    expect(meta).toEqual({})
    expect(offset).toBe(0)
  })
})

describe('parsing a whole file', () => {
  it('honours the declared separator over detection', () => {
    const result = parseDelimited('#separator:pipe\na|b\nc|d\n')
    expect(result.delimiter).toBe('|')
    expect(result.rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('strips a byte-order mark so the first header is not corrupted', () => {
    const result = parseDelimited('﻿Front,Back\nhola,hello\n')
    expect(result.rows[0][0]).toBe('Front')
  })

  it('drops blank lines rather than importing empty notes', () => {
    const result = parseDelimited('a,b\n\n\nc,d\n')
    expect(result.rows).toHaveLength(2)
  })

  it('counts ragged rows instead of silently dropping them', () => {
    const result = parseDelimited('a,b,c\nd,e\nf,g,h\n')
    expect(result.rows).toHaveLength(3)
    expect(result.raggedRows).toBe(1)
  })
})

describe('header detection', () => {
  it('recognises familiar column names', () => {
    expect(looksLikeHeader([['Front', 'Back'], ['hola', 'hello']])).toBe(true)
    expect(looksLikeHeader([['Term', 'Definition'], ['x', 'y']])).toBe(true)
  })

  it('rejects a first row that is plainly data', () => {
    expect(looksLikeHeader([['hola', 'hello'], ['adios', 'goodbye']])).toBe(false)
  })

  it('rejects duplicate or empty column names', () => {
    expect(looksLikeHeader([['Front', 'Front'], ['a', 'b']])).toBe(false)
    expect(looksLikeHeader([['Front', ''], ['a', 'b']])).toBe(false)
  })

  it('recognises language and section headings', () => {
    expect(
      looksLikeHeader([
        ['Chinese', 'Pinyin', 'English', 'Week'],
        ['\u5b66\u6821', 'xu\u00e9xi\u00e0o', 'school', 'Week 1'],
      ]),
    ).toBe(true)
  })

  it('spots a heading above a column of filenames', () => {
    // None of these words are in the known list; the filenames give it away.
    expect(
      looksLikeHeader([
        ['Prompt', 'Recording'],
        ['\u5b66\u6821', 'audio/xuexiao.wav'],
      ]),
    ).toBe(true)
  })

  it('still says no when the first row is filenames too', () => {
    expect(
      looksLikeHeader([
        ['a.wav', 'b.wav'],
        ['c.wav', 'd.wav'],
      ]),
    ).toBe(false)
  })

  it('needs more than one row to decide', () => {
    expect(looksLikeHeader([['Front', 'Back']])).toBe(false)
  })
})

describe('html fields', () => {
  it('turns breaks and blocks into newlines', () => {
    expect(htmlToText('one<br>two<div>three</div>')).toBe('one\ntwo\nthree')
  })

  it('reads adjacent blocks as one break, the way Anki writes lines', () => {
    expect(htmlToText('line1<div>line2</div><div>line3</div>')).toBe('line1\nline2\nline3')
  })

  it('removes remaining markup', () => {
    expect(htmlToText('<b>bold</b> and <i>italic</i>')).toBe('bold and italic')
  })

  it('decodes typographic and numeric entities', () => {
    expect(htmlToText('a &mdash; b')).toBe('a \u2014 b')
    expect(htmlToText('&#233;cole')).toBe('\u00e9cole')
    expect(htmlToText('&#x2713; done')).toBe('\u2713 done')
  })

  it('leaves an entity it does not know exactly as it found it', () => {
    expect(htmlToText('&frobnicate; &#xZZ;')).toBe('&frobnicate; &#xZZ;')
  })

  it('decodes entities without double-decoding', () => {
    expect(htmlToText('a &amp;lt; b')).toBe('a &lt; b')
    expect(htmlToText('tom &amp; jerry')).toBe('tom & jerry')
    expect(htmlToText('&quot;quoted&quot;')).toBe('"quoted"')
  })
})
