import { useState } from 'react'
import { useApp } from './data/store'
import { DeckList } from './ui/DeckList'
import { DeckView } from './ui/DeckView'
import { Backup } from './ui/Backup'
import { CsvImport } from './ui/CsvImport'
import { DeckSettings } from './ui/DeckSettings'
import { NoteEditor } from './ui/NoteEditor'
import { Review } from './ui/Review'
import { Stats } from './ui/Stats'

export type View =
  | { name: 'decks' }
  | { name: 'deck'; deckId: string }
  | { name: 'review'; deckId: string }
  | { name: 'stats'; deckId?: string }
  | { name: 'editor'; deckId: string; noteId?: string }
  | { name: 'settings'; deckId: string }
  | { name: 'import' }
  | { name: 'backup' }

export function App() {
  const { loading } = useApp()
  const [view, setView] = useState<View>({ name: 'decks' })

  if (loading) {
    return (
      <div className="app">
        <div className="empty">Loading your collection…</div>
      </div>
    )
  }

  switch (view.name) {
    case 'deck':
      return <DeckView deckId={view.deckId} go={setView} />
    case 'review':
      return <Review deckId={view.deckId} go={setView} />
    case 'stats':
      return <Stats deckId={view.deckId} go={setView} />
    case 'editor':
      return <NoteEditor deckId={view.deckId} noteId={view.noteId} go={setView} />
    case 'settings':
      return <DeckSettings deckId={view.deckId} go={setView} />
    case 'import':
      return <CsvImport go={setView} />
    case 'backup':
      return <Backup go={setView} />
    default:
      return <DeckList go={setView} />
  }
}

export type Go = (view: View) => void
