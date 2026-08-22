import { parseField } from '../../core/notes'
import { mediaKind, useMedia } from '../../data/media'

function Media({ id, autoPlay }: { id: string; autoPlay?: boolean }) {
  const item = useMedia(id)
  if (!item) return <span className="media-chip">missing media</span>
  switch (mediaKind(item.mime)) {
    case 'image':
      return <img src={item.url} alt={item.name} />
    case 'audio':
      return <audio src={item.url} controls autoPlay={autoPlay} />
    case 'video':
      return <video src={item.url} controls autoPlay={autoPlay} />
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
  return (
    <div className="media">
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {part.value}
          </span>
        ) : (
          <Media key={part.id} id={part.id} autoPlay={autoPlay} />
        ),
      )}
    </div>
  )
}
