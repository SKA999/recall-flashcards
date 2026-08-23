import { useEffect, useRef } from 'react'
import { parseField } from '../../core/notes'
import { mediaKind, useMedia } from '../../data/media'
import { useApp } from '../../data/store'

/**
 * Keep a media element at the chosen speed.
 *
 * `preservesPitch` is set explicitly rather than left to the default: slowing
 * audio without it drops the pitch, and for a tone language that turns the
 * thing being learned into a different sound.
 */
function useRate<T extends HTMLMediaElement>(rate: number, url?: string) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.preservesPitch = true
    el.playbackRate = rate
  }, [rate, url])
  return ref
}

function Media({ id, autoPlay }: { id: string; autoPlay?: boolean }) {
  const item = useMedia(id)
  const { playbackRate } = useApp()
  const audioRef = useRate<HTMLAudioElement>(playbackRate, item?.url)
  const videoRef = useRate<HTMLVideoElement>(playbackRate, item?.url)
  if (!item) return <span className="media-chip">missing media</span>
  switch (mediaKind(item.mime)) {
    case 'image':
      return <img src={item.url} alt={item.name} />
    case 'audio':
      return <audio ref={audioRef} src={item.url} controls autoPlay={autoPlay} />
    case 'video':
      return <video ref={videoRef} src={item.url} controls autoPlay={autoPlay} />
    default:
      return (
        <a className="media-chip" href={item.url} download={item.name}>
          {item.name}
        </a>
      )
  }
}

/**
 * Render one note field: plain text runs with embedded media.
 * Text is rendered as text — never as HTML — so card content can't inject markup.
 */
export function FieldView({ text, autoPlay }: { text: string; autoPlay?: boolean }) {
  const parts = parseField(text)
  // Only the first sound in a field plays itself; a field with two would
  // otherwise start both at once.
  let played = false
  return (
    <div className="media">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {part.value}
            </span>
          )
        }
        const auto = Boolean(autoPlay) && !played
        played = true
        return <Media key={part.id} id={part.id} autoPlay={auto} />
      })}
    </div>
  )
}
