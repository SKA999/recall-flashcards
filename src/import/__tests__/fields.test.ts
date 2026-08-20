import { describe, expect, it } from 'vitest'
import { convertField, referencedMedia } from '../fields'

const resolver = (map: Record<string, string>) => (name: string) => map[name]

describe('finding media references', () => {
  it('finds images and sounds', () => {
    expect(referencedMedia('<img src="cat.png"> and [sound:meow.mp3]')).toEqual([
      'cat.png',
      'meow.mp3',
    ])
  })

  it('copes with single quotes and with none', () => {
    expect(referencedMedia("<img src='a.png'>")).toEqual(['a.png'])
    expect(referencedMedia('<img src=b.png>')).toEqual(['b.png'])
  })

  it('finds src among other attributes on the same tag', () => {
    expect(referencedMedia('<img class="x" src="c.png" alt="y">')).toEqual(['c.png'])
  })

  it('decodes percent-encoded filenames', () => {
    expect(referencedMedia('<img src="my%20photo.png">')).toEqual(['my photo.png'])
  })

  it('reports each file once', () => {
    expect(referencedMedia('<img src="a.png"><img src="a.png">')).toEqual(['a.png'])
  })

  it('finds none in plain text', () => {
    expect(referencedMedia('just words')).toEqual([])
  })
})

describe('converting a field', () => {
  it('turns an image into a media token', () => {
    expect(convertField('<img src="cat.png">', resolver({ 'cat.png': 'id1' }))).toBe(
      '{{media:id1}}',
    )
  })

  it('turns a sound reference into a media token', () => {
    expect(convertField('[sound:meow.mp3]', resolver({ 'meow.mp3': 'id2' }))).toBe('{{media:id2}}')
  })

  it('keeps surrounding text alongside the token', () => {
    expect(convertField('the cat<br><img src="cat.png">', resolver({ 'cat.png': 'id1' }))).toBe(
      'the cat\n{{media:id1}}',
    )
  })

  it('flattens the remaining markup to text', () => {
    expect(convertField('<b>bold</b><div>line</div>', resolver({}))).toBe('bold\nline')
  })

  it('does not let HTML flattening eat the token it just inserted', () => {
    const out = convertField('<div><img src="cat.png"></div>', resolver({ 'cat.png': 'id1' }))
    expect(out).toContain('{{media:id1}}')
  })

  it('drops a reference it cannot resolve, and reports it', () => {
    const missing = new Set<string>()
    const out = convertField('before <img src="gone.png"> after', resolver({}), missing)
    expect(out).not.toContain('gone.png')
    expect(out).not.toContain('<img')
    expect([...missing]).toEqual(['gone.png'])
  })

  it('handles several references in one field', () => {
    const out = convertField(
      '<img src="a.png"> then [sound:b.mp3]',
      resolver({ 'a.png': 'id1', 'b.mp3': 'id2' }),
    )
    expect(out).toContain('{{media:id1}}')
    expect(out).toContain('{{media:id2}}')
  })

  it('decodes entities in the surrounding text', () => {
    expect(convertField('tom &amp; jerry', resolver({}))).toBe('tom & jerry')
  })
})
