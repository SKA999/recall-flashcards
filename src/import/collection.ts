// Reads an Anki collection database into plain objects.
//
// Two schemas are in circulation and a .apkg may hold either:
//   schema 11 — note types and decks are JSON blobs in the `col` table
//   schema 18 — they are real tables (`notetypes`, `fields`, `templates`, `decks`)
// Modern Anki exports schema 18; ticking "support older Anki versions" gives 11.
//
// Nothing here touches sql.js directly: it takes a minimal query interface, so
// the reader is testable in Node and the WASM loading stays platform-specific.

import type { AnkiCardRow } from '../core/anki'

/** The slice of a SQL driver this reader needs. */
export interface SqlQuery {
  exec(sql: string): { columns: string[]; values: unknown[][] }[]
}

/** Anki joins a note's fields with the unit separator. */
export const FIELD_SEPARATOR = '\x1f'

export interface AnkiNotetype {
  id: number
  name: string
  isCloze: boolean
  /** Field names in display order. */
  fields: string[]
  /** One entry per card template. */
  templates: { ord: number; name: string }[]
}

export interface AnkiDeck {
  id: number
  /** Nesting normalised to "Parent::Child" regardless of schema. */
  name: string
}

export interface AnkiNote {
  id: number
  notetypeId: number
  tags: string[]
  fields: string[]
}

export interface AnkiCollection {
  schema: 11 | 18
  /** Collection creation time in epoch seconds; review due dates count from it. */
  crt: number
  decks: AnkiDeck[]
  notetypes: AnkiNotetype[]
  notes: AnkiNote[]
  cards: AnkiCardRow[]
}

export class CollectionError extends Error {}

/** Turn a result set into row objects, since column order is not guaranteed. */
function rows(db: SqlQuery, sql: string): Record<string, unknown>[] {
  const result = db.exec(sql)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
}

const int = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function tableExists(db: SqlQuery, name: string): boolean {
  return rows(db, `select name from sqlite_master where type='table' and name='${name}'`).length > 0
}

/** Anki stores tags space-separated with padding spaces at each end. */
function parseTags(value: unknown): string[] {
  return str(value).split(/\s+/).filter(Boolean)
}

/** Schema 18 nests deck names with the unit separator; schema 11 uses "::". */
const normaliseDeckName = (name: string) => name.split(FIELD_SEPARATOR).join('::')

/**
 * A note type is cloze if it says so (schema 11), or if it has one template yet
 * produces cards at higher ordinals — which only cloze does. The structural
 * test avoids decoding schema 18's protobuf note-type config.
 */
function inferCloze(declared: boolean, templateCount: number, maxOrdinal: number): boolean {
  return declared || (templateCount <= 1 && maxOrdinal > 0)
}

function readCards(db: SqlQuery): AnkiCardRow[] {
  return rows(
    db,
    `select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses,
            left, odue, odid, data from cards`,
  ).map((r) => ({
    id: int(r.id),
    nid: int(r.nid),
    did: int(r.did),
    ord: int(r.ord),
    type: int(r.type),
    queue: int(r.queue),
    due: int(r.due),
    ivl: int(r.ivl),
    factor: int(r.factor),
    reps: int(r.reps),
    lapses: int(r.lapses),
    left: int(r.left),
    odue: int(r.odue),
    odid: int(r.odid),
    data: str(r.data),
  }))
}

function readNotes(db: SqlQuery): AnkiNote[] {
  return rows(db, 'select id, mid, tags, flds from notes').map((r) => ({
    id: int(r.id),
    notetypeId: int(r.mid),
    tags: parseTags(r.tags),
    fields: str(r.flds).split(FIELD_SEPARATOR),
  }))
}

/** Highest card ordinal seen per note type, used for the cloze inference. */
function maxOrdinals(notes: AnkiNote[], cards: AnkiCardRow[]): Map<number, number> {
  const notetypeOf = new Map(notes.map((n) => [n.id, n.notetypeId]))
  const out = new Map<number, number>()
  for (const card of cards) {
    const ntid = notetypeOf.get(card.nid)
    if (ntid == null) continue
    out.set(ntid, Math.max(out.get(ntid) ?? 0, card.ord))
  }
  return out
}

function readSchema11(db: SqlQuery, notes: AnkiNote[], cards: AnkiCardRow[]): Omit<AnkiCollection, 'schema' | 'notes' | 'cards'> {
  const col = rows(db, 'select crt, models, decks from col limit 1')[0]
  if (!col) throw new CollectionError('collection table is empty')

  let models: Record<string, any>
  let decks: Record<string, any>
  try {
    models = JSON.parse(str(col.models))
    decks = JSON.parse(str(col.decks))
  } catch {
    throw new CollectionError('could not read the note types or decks in this collection')
  }

  const ordinals = maxOrdinals(notes, cards)

  return {
    crt: int(col.crt),
    decks: Object.values(decks).map((d: any) => ({
      id: int(d.id),
      name: normaliseDeckName(str(d.name)),
    })),
    notetypes: Object.values(models).map((m: any) => {
      const id = int(m.id)
      const templates = (m.tmpls ?? []).map((t: any, i: number) => ({
        ord: int(t.ord ?? i),
        name: str(t.name) || `Card ${i + 1}`,
      }))
      return {
        id,
        name: str(m.name),
        // type 1 is Anki's cloze note type.
        isCloze: inferCloze(int(m.type) === 1, templates.length, ordinals.get(id) ?? 0),
        fields: (m.flds ?? []).map((f: any) => str(f.name)),
        templates,
      }
    }),
  }
}

function readSchema18(db: SqlQuery, notes: AnkiNote[], cards: AnkiCardRow[]): Omit<AnkiCollection, 'schema' | 'notes' | 'cards'> {
  const col = rows(db, 'select crt from col limit 1')[0]
  if (!col) throw new CollectionError('collection table is empty')

  const fieldsByType = new Map<number, { ord: number; name: string }[]>()
  for (const r of rows(db, 'select ntid, ord, name from fields')) {
    const list = fieldsByType.get(int(r.ntid)) ?? []
    list.push({ ord: int(r.ord), name: str(r.name) })
    fieldsByType.set(int(r.ntid), list)
  }

  const templatesByType = new Map<number, { ord: number; name: string }[]>()
  for (const r of rows(db, 'select ntid, ord, name from templates')) {
    const list = templatesByType.get(int(r.ntid)) ?? []
    list.push({ ord: int(r.ord), name: str(r.name) })
    templatesByType.set(int(r.ntid), list)
  }

  const ordinals = maxOrdinals(notes, cards)
  const byOrd = (a: { ord: number }, b: { ord: number }) => a.ord - b.ord

  return {
    crt: int(col.crt),
    decks: rows(db, 'select id, name from decks').map((d) => ({
      id: int(d.id),
      name: normaliseDeckName(str(d.name)),
    })),
    notetypes: rows(db, 'select id, name from notetypes').map((n) => {
      const id = int(n.id)
      const templates = (templatesByType.get(id) ?? []).sort(byOrd)
      return {
        id,
        name: str(n.name),
        // Schema 18 keeps the cloze flag in a protobuf blob, so infer it instead.
        isCloze: inferCloze(false, templates.length, ordinals.get(id) ?? 0),
        fields: (fieldsByType.get(id) ?? []).sort(byOrd).map((f) => f.name),
        templates,
      }
    }),
  }
}

/** Read a whole collection, whichever schema it uses. */
export function readCollection(db: SqlQuery): AnkiCollection {
  if (!tableExists(db, 'col')) {
    throw new CollectionError('this file does not contain an Anki collection')
  }
  const notes = readNotes(db)
  const cards = readCards(db)
  // The separate note-type tables are what distinguishes 18 from 11.
  const schema = tableExists(db, 'notetypes') ? 18 : 11
  const rest = schema === 18 ? readSchema18(db, notes, cards) : readSchema11(db, notes, cards)
  return { schema, notes, cards, ...rest }
}
