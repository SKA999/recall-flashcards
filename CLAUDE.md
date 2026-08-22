# Recall — working notes

A spaced-repetition flashcard app. React + TypeScript + Vite, no framework
beyond that. Live at https://ska999.github.io/recall-flashcards/, deployed from
`main` by GitHub Actions with the test suite gating the deploy.

```bash
npm run dev          # localhost:5180
npm test             # ~315 tests, all should pass
npm run build        # tsc + vite
npm run icons        # regenerate PWA icons
```

## The one architectural rule

**`src/core/` imports nothing platform-specific.** No `window`, no `document`,
no React, no storage. It holds the FSRS implementation, the card state machine,
the note model and the pure mappers. A native phone app is meant to reuse it
unchanged and supply its own `Store`.

Everything platform-shaped lives in `src/data/` (IndexedDB, media, React
context) and `src/import/` (zip, protobuf, CSV, Anki packages).

Persistence goes through the `Store` interface in `src/core/storage.ts`. There
are two implementations: `data/idb.ts` and `data/memory.ts` (a fallback for
browsers that refuse IndexedDB, and what the tests use).

## Decisions that look odd until you know why

**Card content renders as text, never HTML.** `FieldView` parses `{{media:id}}`
tokens and renders the rest as plain text. This is deliberate: imported decks
come from strangers, and rendering their HTML would be an injection surface.
Anki's field HTML is flattened by `htmlToText` on the way in.

**Anki's template language is not implemented.** A `CardTemplate` records which
field *indexes* a card asks and answers. Field references are pulled out of
`qfmt`/`afmt` with a regex — no evaluator. Conditionals and filters flatten, so
imports are content-complete and layout-approximate. This is what keeps the
no-HTML rule possible.

**Restore merges, never overwrites.** Records already present are skipped, so an
old backup cannot undo newer reviews and restoring twice is a no-op. There is no
replace mode; adding one needs a confirmation flow.

**Sections are tags kept whole.** "Week 3" becomes the tag `Week-3`. Splitting
on the space is what Anki does, and it produces `Week` (on every card, useless)
plus `3` (meaningless alone). A real imported deck arrived damaged this way.

**Schema carries sync bookkeeping that nothing uses yet.** Every deck, note,
card and note type has an `updated` stamp; deletes write tombstones in the same
transaction as the delete. `Store.listTombstones()` exists for a sync push that
does not exist. This was done early on purpose — retrofitting it later means
migrating real review history.

## Traps that have already bitten

These are all fixed, with tests. They are recorded because each one was silent.

- **A TTS voice reading a script it doesn't know writes silence, not an error.**
  `say -v Samantha` on Chinese gives 0.01s of nothing. A whole deck can be
  recorded, imported and reviewed before anyone notices. `make-audio.py` checks
  every clip's duration.
- **`say` intermittently hangs** and never returns. Any batch calling it needs a
  timeout, or one wedged call stalls hundreds of files.
- **Zip filenames need the UTF-8 flag** (general purpose bit 11). Without it
  other tools read them as CP437. Our own reader always decodes UTF-8, so it
  round-tripped perfectly with itself and hid the bug — an independent
  implementation found it.
- **A short field collapses a media player.** The review column centres its
  children, so a field shrink-wraps to its text and `width: 100%` inside it
  resolves against that. Two Chinese glyphs made an audio player 42px wide.
- **Autoplay follows the media, not the first field.** Sound usually sits in its
  own field beside the text.
- **The mobile header overflows easily.** Adding a fourth action pushed the
  primary button off-screen. Check `document.documentElement.scrollWidth` at
  320px after touching `.topbar`.

## How this project verifies things

Prefer a real artefact over a plausible one. The Anki importer is tested against
packages built from Anki's published schema and protobuf definitions
(`scripts/make-apkg-fixture.py`), and against a real export. The zip writer was
checked with Python's `zipfile` and the `unzip` CLI, not only its own reader.
Example files in `examples/` are covered by tests so they cannot rot.

Browser behaviour is verified by driving the running app and reading the DOM and
IndexedDB, not by assuming. The in-app preview browser cannot register service
workers and cannot open a native file picker — those need the deployed site or a
real browser, and claims about them should say so.

## Deliberately not built

- **Sync.** The biggest gap. Collections on two devices diverge silently.
- **`.apkg` import UI.** All parsing works (`src/import/package.ts`,
  `collection.ts`, `notetypes.ts`) and is tested against a real 307-note export.
  What is missing is writing it into the collection and the screen to drive it.
- **A native phone app.** The PWA installs today. Building native before sync
  gives two collections that disagree, which is worse than one.

## Bundled skill

`.claude/skills/flashcard-audio/` generates deck audio from a CSV using macOS
speech synthesis, and bundles it for import. `references/cloud-tts.md` covers
the paid alternatives.
