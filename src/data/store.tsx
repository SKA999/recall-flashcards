// App state. The whole collection is held in memory and mirrored to IndexedDB —
// simple, synchronous reads for the UI, durable writes underneath.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { newId } from '../core/ids'
import { reconcileCards } from '../core/notes'
import { answer as applyAnswer, dayKey, DEFAULT_CONFIG } from '../core/scheduler'
import { BASIC_ID, BUILTIN_NOTETYPES } from '../core/notetypes'
import type {
  Card,
  DayCounter,
  Deck,
  DeckConfig,
  MediaItem,
  Note,
  Notetype,
  Rating,
  ReviewLog,
} from '../core/types'
import { backend, isDurable, selectBackend } from './backend'
import { seedDemo } from './demo'

interface Collection {
  decks: Deck[]
  notetypes: Notetype[]
  notes: Note[]
  cards: Card[]
  logs: ReviewLog[]
  counters: Record<string, DayCounter>
}

const empty: Collection = {
  decks: [],
  notetypes: [],
  notes: [],
  cards: [],
  logs: [],
  counters: {},
}

/** Enough to put the collection back exactly as it was before one answer. */
interface UndoEntry {
  card: Card
  logId: string
  counterKey: string
  counterBefore: DayCounter
}

/** Answers you can take back in this session. Anki keeps a similar depth. */
const UNDO_DEPTH = 30

export interface NoteInput {
  id?: string
  deckId: string
  notetypeId: string
  fields: string[]
  tags: string[]
}

interface AppApi extends Collection {
  loading: boolean
  /** False when storage is in memory only and will not survive a reload. */
  durable: boolean
  /** Look up a note type, falling back to Basic if it has gone missing. */
  notetype(id: string): Notetype
  saveNotetype(notetype: Notetype): Promise<void>
  createDeck(name: string, description?: string): Promise<Deck>
  updateDeck(deckId: string, patch: Partial<Omit<Deck, 'id'>>): Promise<void>
  updateDeckConfig(deckId: string, patch: Partial<DeckConfig>): Promise<void>
  deleteDeck(deckId: string): Promise<void>
  saveNote(input: NoteInput): Promise<Note>
  /** Bulk create, for imports. Writes once rather than per note. */
  addNotes(inputs: NoteInput[]): Promise<number>
  deleteNote(noteId: string): Promise<void>
  setCardSuspended(cardId: string, suspended: boolean): Promise<void>
  resetCard(cardId: string): Promise<void>
  answerCard(card: Card, rating: Rating, durationMs: number): Promise<void>
  /** Take back the last answer. Resolves to the restored card's id. */
  undoAnswer(): Promise<string | undefined>
  canUndo: boolean
  addMedia(deckId: string, file: File): Promise<string>
  counterFor(deckId: string, now?: number): DayCounter
}

const AppContext = createContext<AppApi | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Collection>(empty)
  const [loading, setLoading] = useState(true)
  const [durable, setDurable] = useState(true)
  const stateRef = useRefLike(state)
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const undoRef = useRefLike(undoStack)

  useEffect(() => {
    let alive = true
    ;(async () => {
      await selectBackend()
      // Prototype builds open on a sample deck rather than an empty screen.
      if (import.meta.env.VITE_DEMO === '1' && (await backend().listDecks()).length === 0) {
        await seedDemo(backend())
      }
      const [decks, notetypes, notes, cards, logs] = await Promise.all([
        backend().listDecks(),
        backend().listNotetypes(),
        backend().listNotes(),
        backend().listCards(),
        backend().listLogs(),
      ])
      if (!alive) return
      // The memory backend seeds these, but a store that has lost them would
      // leave every note unrenderable, so top them up rather than assume.
      const present = new Set(notetypes.map((t) => t.id))
      const missing = BUILTIN_NOTETYPES.filter((t) => !present.has(t.id))
      for (const type of missing) await backend().putNotetype(type)
      setState({ decks, notetypes: [...notetypes, ...missing], notes, cards, logs, counters: {} })
      setDurable(isDurable())
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const notetype = useCallback(
    (id: string): Notetype =>
      stateRef.current.notetypes.find((t) => t.id === id) ??
      stateRef.current.notetypes.find((t) => t.id === BASIC_ID) ??
      BUILTIN_NOTETYPES[0],
    [stateRef],
  )

  const saveNotetype = useCallback(async (type: Notetype) => {
    const stamped = { ...type, updated: Date.now() }
    await backend().putNotetype(stamped)
    setState((s) => ({
      ...s,
      notetypes: s.notetypes.some((t) => t.id === stamped.id)
        ? s.notetypes.map((t) => (t.id === stamped.id ? stamped : t))
        : [...s.notetypes, stamped],
    }))
  }, [])

  const createDeck = useCallback(async (name: string, description = '') => {
    const now = Date.now()
    const deck: Deck = {
      id: newId(),
      name: name.trim() || 'Untitled deck',
      description,
      config: { ...DEFAULT_CONFIG, weights: [...DEFAULT_CONFIG.weights] },
      created: now,
      updated: now,
    }
    await backend().putDeck(deck)
    setState((s) => ({ ...s, decks: [...s.decks, deck] }))
    return deck
  }, [])

  const patchDeck = useCallback(async (deckId: string, update: (d: Deck) => Deck) => {
    const current = stateRef.current.decks.find((d) => d.id === deckId)
    if (!current) return
    const saved = { ...update(current), updated: Date.now() }
    await backend().putDeck(saved)
    setState((s) => ({ ...s, decks: s.decks.map((d) => (d.id === deckId ? saved : d)) }))
  }, [stateRef])

  const updateDeck = useCallback(
    (deckId: string, patch: Partial<Omit<Deck, 'id'>>) =>
      patchDeck(deckId, (d) => ({ ...d, ...patch })),
    [patchDeck],
  )

  const updateDeckConfig = useCallback(
    (deckId: string, patch: Partial<DeckConfig>) =>
      patchDeck(deckId, (d) => ({ ...d, config: { ...d.config, ...patch } })),
    [patchDeck],
  )

  const deleteDeck = useCallback(async (deckId: string) => {
    await backend().deleteDeck(deckId)
    setState((s) => ({
      ...s,
      decks: s.decks.filter((d) => d.id !== deckId),
      notes: s.notes.filter((n) => n.deckId !== deckId),
      cards: s.cards.filter((c) => c.deckId !== deckId),
      logs: s.logs.filter((l) => l.deckId !== deckId),
      counters: s.counters,
    }))
  }, [])

  const saveNote = useCallback(async (input: NoteInput) => {
    const now = Date.now()
    const existingCards = input.id ? await backend().cardsForNote(input.id) : []
    const note: Note = {
      id: input.id ?? newId(),
      deckId: input.deckId,
      notetypeId: input.notetypeId,
      fields: input.fields,
      tags: input.tags,
      created: now,
      modified: now,
      updated: now,
    }
    const type =
      stateRef.current.notetypes.find((t) => t.id === note.notetypeId) ?? BUILTIN_NOTETYPES[0]
    const { create, remove } = reconcileCards(note, type, existingCards, now)

    await backend().putNote(note)
    if (create.length) await backend().putCards(create)
    if (remove.length) await backend().deleteCards(remove.map((c) => c.id))

    setState((s) => {
      const prior = s.notes.find((n) => n.id === note.id)
      const merged = prior ? { ...note, created: prior.created } : note
      const removed = new Set(remove.map((c) => c.id))
      return {
        ...s,
        notes: prior
          ? s.notes.map((n) => (n.id === note.id ? merged : n))
          : [...s.notes, merged],
        cards: [...s.cards.filter((c) => !removed.has(c.id)), ...create],
      }
    })
    return note
  }, [stateRef])

  const addNotes = useCallback(async (inputs: NoteInput[]) => {
    if (!inputs.length) return 0
    const now = Date.now()
    const notes: Note[] = []
    const cards: Card[] = []

    inputs.forEach((input, index) => {
      const note: Note = {
        id: newId(),
        deckId: input.deckId,
        notetypeId: input.notetypeId,
        fields: input.fields,
        tags: input.tags,
        // Nudge each note's timestamp so an import keeps its file order in the
        // browse list rather than collapsing into one instant.
        created: now + index,
        modified: now + index,
        updated: now + index,
      }
      notes.push(note)
      const type =
        stateRef.current.notetypes.find((t) => t.id === note.notetypeId) ?? BUILTIN_NOTETYPES[0]
      cards.push(...reconcileCards(note, type, [], now).create)
    })

    for (const note of notes) await backend().putNote(note)
    await backend().putCards(cards)

    setState((s) => ({ ...s, notes: [...s.notes, ...notes], cards: [...s.cards, ...cards] }))
    return notes.length
  }, [stateRef])

  const deleteNote = useCallback(async (noteId: string) => {
    const cards = await backend().cardsForNote(noteId)
    await backend().deleteCards(cards.map((c) => c.id))
    await backend().deleteNote(noteId)
    setState((s) => ({
      ...s,
      notes: s.notes.filter((n) => n.id !== noteId),
      cards: s.cards.filter((c) => c.noteId !== noteId),
    }))
  }, [])

  const writeCard = useCallback(async (card: Card) => {
    const stamped = { ...card, updated: Date.now() }
    await backend().putCards([stamped])
    setState((s) => ({ ...s, cards: s.cards.map((c) => (c.id === stamped.id ? stamped : c)) }))
  }, [])

  const setCardSuspended = useCallback(
    async (cardId: string, suspended: boolean) => {
      const card = stateRef.current.cards.find((c) => c.id === cardId)
      if (card) await writeCard({ ...card, suspended })
    },
    [writeCard],
  )

  const resetCard = useCallback(
    async (cardId: string) => {
      const card = stateRef.current.cards.find((c) => c.id === cardId)
      if (!card) return
      await writeCard({
        ...card,
        state: 'new',
        step: 0,
        due: Date.now(),
        stability: undefined,
        difficulty: undefined,
        lastReview: undefined,
        reps: 0,
        lapses: 0,
        scheduledDays: 0,
      })
    },
    [writeCard],
  )

  const answerCard = useCallback(
    async (card: Card, rating: Rating, durationMs: number) => {
      const deck = stateRef.current.decks.find((d) => d.id === card.deckId)
      const config = deck?.config ?? DEFAULT_CONFIG
      const now = Date.now()
      const result = applyAnswer(card, rating, config, now)
      const log: ReviewLog = { ...result.log, id: newId(), durationMs }

      const day = dayKey(now)
      const key = `${card.deckId}:${day}`
      const prior =
        stateRef.current.counters[key] ??
        (await backend().getCounter(card.deckId, day))
      const counter: DayCounter = {
        ...prior,
        newSeen: prior.newSeen + (card.state === 'new' ? 1 : 0),
        reviewsDone: prior.reviewsDone + (card.state === 'review' ? 1 : 0),
      }

      const answered = { ...result.card, updated: now }

      await Promise.all([
        backend().putCards([answered]),
        backend().addLog(log),
        backend().putCounter(counter),
      ])

      setState((s) => ({
        ...s,
        cards: s.cards.map((c) => (c.id === card.id ? answered : c)),
        logs: [...s.logs, log],
        counters: { ...s.counters, [key]: counter },
      }))
      setUndoStack((stack) =>
        [...stack, { card, logId: log.id, counterKey: key, counterBefore: prior }].slice(-UNDO_DEPTH),
      )
    },
    [],
  )

  const undoAnswer = useCallback(async () => {
    const entry = undoRef.current[undoRef.current.length - 1]
    if (!entry) return undefined
    // The undo is itself a local write, so it gets a fresh stamp — otherwise a
    // sync peer would see old content wearing an old timestamp and re-apply the
    // answer we just took back.
    const restored = { ...entry.card, updated: Date.now() }

    await Promise.all([
      backend().putCards([restored]),
      backend().deleteLog(entry.logId),
      backend().putCounter(entry.counterBefore),
    ])

    setUndoStack((stack) => stack.slice(0, -1))
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === restored.id ? restored : c)),
      logs: s.logs.filter((l) => l.id !== entry.logId),
      counters: { ...s.counters, [entry.counterKey]: entry.counterBefore },
    }))
    return restored.id
  }, [undoRef])

  const addMedia = useCallback(async (deckId: string, file: File) => {
    const item: MediaItem = {
      id: newId(),
      deckId,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      blob: file,
      created: Date.now(),
      updated: Date.now(),
    }
    await backend().putMedia(item)
    return item.id
  }, [])

  const counterFor = useCallback(
    (deckId: string, now = Date.now()) => {
      const key = `${deckId}:${dayKey(now)}`
      return (
        state.counters[key] ?? {
          id: key,
          deckId,
          day: dayKey(now),
          newSeen: 0,
          reviewsDone: 0,
        }
      )
    },
    [state.counters],
  )

  // Hydrate today's counters once the decks are known, so daily limits survive
  // a reload mid-session.
  useEffect(() => {
    if (loading) return
    let alive = true
    const day = dayKey(Date.now())
    Promise.all(state.decks.map((d) => backend().getCounter(d.id, day))).then((list) => {
      if (!alive || !list.length) return
      setState((s) => {
        const next = { ...s.counters }
        let changed = false
        for (const c of list) {
          if (!next[c.id]) {
            next[c.id] = c
            changed = true
          }
        }
        return changed ? { ...s, counters: next } : s
      })
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, state.decks.length])

  const value = useMemo<AppApi>(
    () => ({
      ...state,
      loading,
      durable,
      notetype,
      saveNotetype,
      createDeck,
      updateDeck,
      updateDeckConfig,
      deleteDeck,
      saveNote,
      addNotes,
      deleteNote,
      setCardSuspended,
      resetCard,
      answerCard,
      undoAnswer,
      canUndo: undoStack.length > 0,
      addMedia,
      counterFor,
    }),
    [
      state,
      loading,
      durable,
      notetype,
      saveNotetype,
      undoStack.length,
      createDeck,
      updateDeck,
      updateDeckConfig,
      deleteDeck,
      saveNote,
      addNotes,
      deleteNote,
      setCardSuspended,
      resetCard,
      answerCard,
      undoAnswer,
      addMedia,
      counterFor,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

/** Keeps a mutable mirror of state for callbacks that must not re-create. */
function useRefLike<T>(value: T) {
  const [ref] = useState(() => ({ current: value }))
  ref.current = value
  return ref
}

export function useApp(): AppApi {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
