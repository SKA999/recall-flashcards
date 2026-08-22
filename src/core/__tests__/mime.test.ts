import { describe, expect, it } from 'vitest'
import { extensionOf, guessMime, mediaKind } from '../mime'

describe('extensions', () => {
  it('reads the last one', () => {
    expect(extensionOf('recording.take2.mp3')).toBe('mp3')
  })

  it('is case-insensitive', () => {
    expect(extensionOf('SOUND.WAV')).toBe('wav')
  })

  it('reports none for a bare name or a dotfile', () => {
    expect(extensionOf('noextension')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
  })
})

describe('guessing a media type', () => {
  it('trusts a type the browser supplied', () => {
    expect(guessMime('clip.mp3', 'audio/mpeg')).toBe('audio/mpeg')
    expect(guessMime('odd.name', 'image/png')).toBe('image/png')
  })

  it('falls back to the extension when the picker supplied nothing', () => {
    // This is the real case: a file picker leaves `type` empty whenever the OS
    // has no mapping, which for audio is common.
    expect(guessMime('clip.mp3', '')).toBe('audio/mpeg')
    expect(guessMime('clip.mp3', undefined)).toBe('audio/mpeg')
  })

  it('overrides the generic fallback, which is not a real answer', () => {
    expect(guessMime('clip.opus', 'application/octet-stream')).toBe('audio/ogg')
  })

  it('covers the audio formats that usually arrive untyped', () => {
    for (const [name, expected] of [
      ['a.opus', 'audio/ogg'],
      ['a.flac', 'audio/flac'],
      ['a.m4a', 'audio/mp4'],
      ['a.aac', 'audio/aac'],
      ['a.ogg', 'audio/ogg'],
      ['a.wav', 'audio/wav'],
    ] as const) {
      expect(guessMime(name, '')).toBe(expected)
      expect(mediaKind(guessMime(name, ''))).toBe('audio')
    }
  })

  it('still recognises images and video by extension', () => {
    expect(mediaKind(guessMime('pic.webp', ''))).toBe('image')
    expect(mediaKind(guessMime('clip.mov', ''))).toBe('video')
    expect(mediaKind(guessMime('clip.mkv', ''))).toBe('video')
  })

  it('gives up honestly on something it cannot place', () => {
    expect(guessMime('mystery.xyz', '')).toBe('application/octet-stream')
    expect(mediaKind(guessMime('mystery.xyz', ''))).toBe('other')
  })

  it('is not fooled by a case-varied type or extension', () => {
    expect(guessMime('CLIP.MP3', '')).toBe('audio/mpeg')
    expect(guessMime('clip.mp3', 'AUDIO/MPEG')).toBe('audio/mpeg')
  })
})

describe('classifying a type', () => {
  it('sorts each family', () => {
    expect(mediaKind('image/jpeg')).toBe('image')
    expect(mediaKind('audio/mpeg')).toBe('audio')
    expect(mediaKind('video/mp4')).toBe('video')
    expect(mediaKind('application/pdf')).toBe('other')
  })
})
