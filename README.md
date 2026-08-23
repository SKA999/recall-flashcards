# Recall

A spaced-repetition flashcard app, Anki-shaped but built from scratch. This is
the **web app**; the core is deliberately portable so a phone app can reuse it.

**Live: https://ska999.github.io/recall-flashcards/**
**Decks: https://ska999.github.io/recall-flashcards/decks/** — deployed from `main` by
GitHub Actions on every push, gated on the test suite.

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # FSRS, scheduler and service-worker tests
npm run build
npm run preview  # serve the production build (needed to exercise offline mode)
npm run icons    # regenerate the PWA icons in public/
```

## Backup

Your collection lives in one browser's IndexedDB. **Backup → Export collection**
writes all of it to a single zip: decks, note types, notes, cards, review
history, scheduling and media. It is an ordinary zip holding `collection.json`
plus the media files, so you can open it and check what's in there.

### Keeping a copy without remembering to

Two mechanisms, because what a browser allows depends on the platform:

- **Persistent storage** is requested on every start. It asks the browser not to
  evict the data when the device runs short of space, and it is the only
  eviction protection that works on a phone. Browsers decide for themselves;
  installing the app to the home screen makes a yes much more likely. The
  Backup screen shows whether it was granted.
- **A backup folder**, on desktop Chrome and Edge. Pick one once and a copy is
  written there on the first visit each day, silently, overwriting that day's
  file. No phone browser offers folder access, so this is unavailable exactly
  where the eviction risk is highest — which is why the reminder exists too.

When a copy is overdue and there are reviews that would be lost, the deck list
says so and links straight to the backup screen. A collection with nothing new
in it is never nagged about: rewriting an identical file only teaches people to
ignore the message.

Restoring **adds what isn't already present and leaves everything else alone**.
It never overwrites a record that exists, so restoring an old backup cannot undo
reviews done since, and restoring the same file twice is a no-op.

There is still no sync. A backup is the only way to move a collection between
devices, and the only protection against clearing your browser data.

## Importing

Non-Latin scripts are fine throughout — Chinese, Japanese and Korean text works
in fields, deck names, search, CSV import and backups. `examples/` includes a
Chinese deck and two audio clips to try it with.

### Bringing media in with your cards

Put the media beside the table and refer to it by filename. Either select the
table and its files together in the file picker, or zip them up first:

```
primary-5.zip
├── cards.csv
└── audio/
    ├── xuexiao.wav
    └── school.wav
```

```csv
Chinese,Pinyin,English,Chinese audio,English audio,Week
学校,xuéxiào,school,audio/xuexiao.wav,audio/school.wav,Week 1
```

A cell holding a filename becomes that sound or picture. Anki's
`[sound:name.mp3]` and `<img src="name.png">` are understood too, and a
filename the bundle doesn't contain is reported rather than imported as text.

Columns become the fields of a note type built on import, and each column is
marked as belonging to the question side, the answer side, or a section.
Companion columns follow the column they belong to — "Chinese audio" sits with
"Chinese", and an annotation like "Pinyin" joins the column to its left — so the
layout above asks *Chinese + Pinyin + Chinese audio* and answers with *English +
English audio*. Sound plays by itself on both sides.

### Making the audio

`.claude/skills/flashcard-audio/` holds a skill for generating the recordings.
Leave the audio columns blank and let it fill them in:

```bash
python3 .claude/skills/flashcard-audio/scripts/make-audio.py cards.csv --zip deck.zip
```

It uses the speech synthesis built into macOS — no account, no key, no
per-character cost — picks a voice matching the script each column is written
in, shares one clip between rows with identical text, and skips cells that are
already filled so it can be re-run as a deck grows.

The trap it exists to prevent: a voice asked to read a script it doesn't know
writes a *silent file* rather than failing. `say -v Samantha` reading Chinese
produces 0.01 seconds of nothing, with no error — so a whole deck can be
recorded, imported and reviewed before anyone notices. The script detects the
script of each column, refuses a mismatched voice, and measures every clip.

`references/cloud-tts.md` in the skill covers Azure, Google, Polly, OpenAI,
ElevenLabs and Forvo for when the system voices aren't good enough.

### Sections

A column named for a week, month, unit or lesson becomes a **section**: one tag
per card, kept whole. "Week 3" becomes the tag `Week-3` rather than splitting
into `Week` and `3`, which is what happens if you type a space into an Anki tag.

A deck with sections shows them as filters. Picking one narrows the card list
and studies only that week; the counts, the queue and the daily limits all
follow the filter.

`examples/` has `import-template.csv` to fill in and `primary-5-example.zip` to
try immediately.

**CSV / TSV** works today. Import from the deck list, pick a file, map the
columns, and preview before committing. The parser is RFC 4180 — quoted fields
keep their commas, newlines and doubled quotes — and it reads Anki's own text
exports, including the `#separator:`, `#html:`, `#tags:` and `#columns:`
preamble. Two sample files live in `examples/` and are covered by tests, so they
can't rot.

**Anki `.apkg`** is partly built: the zip reader, the package protobuf decoder,
the scheduling mapper and the collection reader are done and tested, for both
schema 11 and schema 18. What remains is mapping Anki note types onto the ones
here, extracting media, and the import screen itself.

Anki's template *language* is deliberately not implemented. A template here
records which fields are asked and which are answered — enough to carry real
note types across, while card content keeps rendering as text rather than HTML,
so an imported deck can't inject markup.

## What works

- **Decks** — create, rename, configure, delete.
- **Note types** — a note has named fields, and its note type says which fields
  each card asks and answers. Built in: Basic, Basic (and reversed), and Cloze,
  which makes one card per `{{c1::…}}` deletion. Editing a note reconciles its
  cards without disturbing the scheduling of the ones that survive.
- **Media** — images, audio and video attach to any field, stored as blobs in
  IndexedDB and referenced by a `{{media:<id>}}` token. Sound plays on its own
  on both sides: on the question for listening cards, on the answer on reveal.
  A file whose type the picker leaves blank is identified by its extension, so
  `.opus`, `.flac`, `.m4a` and friends still get a player.
- **Playback speed** — 0.5× to 1.5×, offered on any card that makes a sound and
  remembered across decks and sessions. Pitch is preserved, which matters for a
  tone language: slowing audio without it drops the pitch and changes the thing
  being learned.
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

## For maintainers

- `CLAUDE.md` — the short version, loaded automatically at the start of a
  session: the architectural rule, the decisions most easily broken by accident,
  and the traps that have already bitten.
- `docs/state.md` — what works, what is half built, what is next, and what has
  not been verified.
- `docs/decisions.md` — why each odd-looking choice was made and what it rules
  out.

## Layout

```
src/
  core/        pure TypeScript — no React, no DOM, no storage
    types.ts       Deck / Note / Card / ReviewLog / DeckConfig
    fsrs.ts        FSRS-5 memory model (stability, difficulty, retrievability)
    scheduler.ts   card state machine, queue building, interval previews
    stats.ts       aggregations over review history
    notes.ts       note → card generation, faces, media-token parsing
    notetypes.ts   built-in note types, cloze parsing and rendering
    storage.ts     the Store interface persistence must satisfy
    backup.ts      the backup document, and what a restore should write
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

Verified on the live site: the worker registers, activates, scopes itself to
`/recall-flashcards/`, and caches the shell at that subpath. Its caching logic
is separately covered by tests in `src/__tests__/sw.test.ts` — install,
activate, cache-first assets, network-first navigation, offline fallback.

For a native app:

1. Reuse `src/core` unchanged.
2. Implement `Store` against SQLite (expo-sqlite or GRDB).
3. Rebuild the views natively; `Review.tsx` is the only screen with real logic
   in it, and that logic is a thin wrapper over `buildQueue` and `answer`.

Sync still needs a backend and a conflict-resolution policy, but the local
bookkeeping it depends on is in place — see **Sync readiness** above.
