# Recall

A spaced-repetition flashcard app, Anki-shaped but built from scratch. This is
the **web app**; the core is deliberately portable so a phone app can reuse it.

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # FSRS, scheduler and service-worker tests
npm run build
npm run preview  # serve the production build (needed to exercise offline mode)
npm run icons    # regenerate the PWA icons in public/
```

## Importing

**CSV / TSV** works today. Import from the deck list, pick a file, map the
columns, and preview before committing. The parser is RFC 4180 — quoted fields
keep their commas, newlines and doubled quotes — and it reads Anki's own text
exports, including the `#separator:`, `#html:`, `#tags:` and `#columns:`
preamble. Two sample files live in `examples/` and are covered by tests, so they
can't rot.

**Anki `.apkg`** is partly built: the zip reader, the package protobuf decoder,
and the scheduling mapper are done and tested. What remains is reading the
SQLite collection and deciding how Anki note types with more than two templates
map onto this app's two card shapes.

## What works

- **Decks** — create, rename, configure, delete.
- **Notes and cards** — basic (front → back) and reversed (both directions, two
  cards from one note). Editing a note reconciles its cards.
- **Media** — images, audio and video attach to either field, stored as blobs in
  IndexedDB and referenced by a `{{media:<id>}}` token. Audio and video on the
  answer side autoplay on reveal.
- **Review** — learning steps, FSRS intervals, four-button grading with the real
  next interval shown on each button, keyboard shortcuts (space reveals, 1–4
  grade, z undoes), daily new/review limits, study-ahead when the queue drains.
- **Undo** — up to 30 answers deep, for the session. It restores the card's exact
  scheduling state, deletes the review log, and rolls back the day's counters;
  the card comes back on screen already revealed.
- **Stats** — reviews per day, grade breakdown, 30-day due forecast, card
  maturity, retention, streak, time studied. Per-deck or across everything.

- **Offline** — a hand-written service worker caches the app shell and the
  hashed build assets. Installable on a phone home screen (manifest + icons).

Not built yet: `.apkg` import, cloze deletion, sync.

## Layout

```
src/
  core/        pure TypeScript — no React, no DOM, no storage
    types.ts       Deck / Note / Card / ReviewLog / DeckConfig
    fsrs.ts        FSRS-5 memory model (stability, difficulty, retrievability)
    scheduler.ts   card state machine, queue building, interval previews
    stats.ts       aggregations over review history
    notes.ts       note → card generation, media-token parsing
    storage.ts     the Store interface persistence must satisfy
  data/        web platform bindings
    idb.ts         IndexedDB implementation of Store
    media.ts       blob → object URL cache
    store.tsx      React context: in-memory collection mirrored to IndexedDB
  ui/          screens and components
```

**`src/core` is the shared layer.** It imports nothing platform-specific, so the
native app reuses it as-is and only supplies a new `Store` implementation
(SQLite) and its own views. Keep it that way: no `window`, no `document`, no
React inside `core/`.

## Sync readiness

Nothing syncs yet, but the schema is ready for it, because retrofitting this
later means migrating real review history:

- Every deck, note, card and media record carries an `updated` stamp, written on
  every local change — including an undo, which is a new write, not a rewind.
- Deletes write a **tombstone** in the same IndexedDB transaction as the delete
  itself. Without one, a deleted row is indistinguishable from a row the other
  device hasn't seen, and the delete gets undone by the next sync.
- Review logs are append-only and immutable; `reviewed` is their sync key.
- Day counters are deliberately *not* synced — they're per-device and can be
  rebuilt from the log.

`Store.listTombstones(since)` is the hook a future sync push would use.

## How scheduling works

New cards walk a ladder of sub-day **learning steps** (1m, 10m by default).
Answering *Good* on the last step, or *Easy* at any point, graduates the card to
FSRS scheduling. From then on every answer updates two numbers:

- **stability** — how many days until recall probability decays to 90%
- **difficulty** — 1–10, how hard this card is for you

The next interval is whatever gap brings recall probability down to the deck's
**desired retention** (default 90%). Raising desired retention shortens
intervals and costs more reviews; lowering it does the opposite. A failed review
lapses the card into relearning steps and cuts its stability.

Intervals are then fuzzed by a few percent so cards added on the same day don't
come back on the same day forever. Day boundaries roll over at 4am local time,
so a late-night session counts toward the previous day.

The 19 FSRS-5 weights live in each deck's config. They're the published defaults
right now — per-user optimisation from review history is a future addition, and
the log records everything that optimisation would need.

## Charts

Chart colours are a validated palette: four categorical slots for the grade
breakdown and a single-hue ordinal ramp for card maturity, each checked for
colour-vision separation and surface contrast in both light and dark mode. The
same four slots colour the answer buttons, so "Good" is one colour everywhere.
Every stacked chart also offers a table view — colour never carries meaning
alone.

## Toward the phone app

The web app is installable: mobile-first layout with safe-area padding, a full
manifest with regular and maskable icons, and a service worker that keeps it
working offline. Navigations are network-first (so a deploy is picked up at
once) and fall back to the cached shell; content-hashed assets are cache-first.

**Caveat on verification.** The service worker's caching logic is covered by
tests in `src/__tests__/sw.test.ts` — install, activate, cache-first assets,
network-first navigation, offline fallback. But *registration* itself was never
exercised in a real browser: the preview browser available here refuses to
register service workers at all. Load `npm run preview` in Chrome or Safari,
confirm the worker registers, then tick offline mode in devtools before
trusting it.

For a native app:

1. Reuse `src/core` unchanged.
2. Implement `Store` against SQLite (expo-sqlite or GRDB).
3. Rebuild the views natively; `Review.tsx` is the only screen with real logic
   in it, and that logic is a thin wrapper over `buildQueue` and `answer`.

Sync still needs a backend and a conflict-resolution policy, but the local
bookkeeping it depends on is in place — see **Sync readiness** above.
