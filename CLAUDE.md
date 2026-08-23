# Recall — working notes

A spaced-repetition flashcard app. React + TypeScript + Vite, nothing else in
the framework line. Live at https://ska999.github.io/recall-flashcards/,
deployed from `main` by GitHub Actions with the test suite gating the deploy.

```bash
npm run dev          # localhost:5180
npm test             # ~334 tests, all should pass
npm run build        # tsc + vite
npm run icons        # regenerate PWA icons
```

## Read these when you need them

- **`docs/state.md`** — what works, what is half built, what is next, and what
  has *not* been verified. Start here when picking up work.
- **`docs/decisions.md`** — why the odd-looking choices were made, and what each
  rules out. Read before overturning one.
- **`README.md`** — features and usage, written for a user rather than a
  maintainer.

## The one architectural rule

**`src/core/` imports nothing platform-specific.** No `window`, no `document`,
no React, no storage. It holds the FSRS implementation, the card state machine,
the note model and the pure mappers. A native phone app is meant to reuse it
unchanged and supply its own `Store`.

Platform-shaped code lives in `src/data/` (IndexedDB, media, React context) and
`src/import/` (zip, protobuf, CSV, Anki packages). Persistence goes through the
`Store` interface in `src/core/storage.ts`; there are two implementations,
`data/idb.ts` and `data/memory.ts`, the latter being a fallback for browsers
that refuse IndexedDB and what the tests run against.

## Four things that would otherwise be re-derived

Fuller reasoning in `docs/decisions.md`; these four are the ones most easily
broken by accident.

- **Card content renders as text, never HTML.** Imported decks come from
  strangers; rendering their markup is an injection surface.
- **Anki's template language is not implemented** — a template records which
  field *indexes* a card asks and answers. This is what keeps the rule above
  possible.
- **Restore merges, never overwrites**, so an old backup cannot undo newer
  reviews and restoring twice is a no-op.
- **The schema carries sync bookkeeping nothing uses yet** — `updated` stamps
  and tombstones. Retrofitting it after real review history exists means a
  migration; doing it early was free.

## Traps that have already bitten

All fixed, all covered by tests. Recorded because every one of them failed
silently.

- **A TTS voice reading a script it doesn't know writes silence, not an error.**
  `say -v Samantha` on Chinese gives 0.01s of nothing. A whole deck can be
  recorded, imported and reviewed before anyone notices.
- **`say` intermittently hangs** and never returns. Any batch calling it needs a
  timeout, or one wedged call stalls hundreds of files with no output.
- **One odd cell should not end a batch.** A single Chinese character sitting in
  an English column once aborted 648 clips. Skip and report; stop only when a
  large fraction fails, which means the voice is wrong rather than the data.
- **Zip filenames need the UTF-8 flag** (general purpose bit 11), or other tools
  read them as CP437. Our own reader always decodes UTF-8, so it round-tripped
  perfectly with itself and hid the bug.
- **A short field collapses a media player.** The review column centres its
  children, so a field shrink-wraps to its text and `width: 100%` inside it
  resolves against that — two Chinese glyphs made an audio player 42px wide.
- **Autoplay follows the media, not the first field.** Sound usually sits in its
  own field beside the text.
- **The mobile header overflows easily.** Adding a fourth action pushed the
  primary button off-screen. After touching `.topbar`, check
  `document.documentElement.scrollWidth` at 320px.

## How this project verifies things

Prefer a real artefact to a plausible one. Fixtures come from published schemas
(`scripts/make-apkg-fixture.py` follows Anki's own DDL and protobuf
definitions), and the zip writer was checked against Python's `zipfile` and the
`unzip` CLI rather than only its own reader — a reader and writer built together
agree with each other and hide shared mistakes.

Browser behaviour is verified by driving the running app and reading the DOM and
IndexedDB, not by assuming. The preview browser cannot register service workers
and cannot open a native file picker; claims about those need the deployed site
or a real browser, and should say which.

## Bundled skill

`.claude/skills/flashcard-audio/` turns a CSV of vocabulary into an importable
bundle with audio, using macOS speech synthesis.
`references/cloud-tts.md` covers the paid alternatives.
