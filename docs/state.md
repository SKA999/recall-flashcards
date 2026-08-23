# Where things stand

Last updated after the composition deck was published. 334 tests, 43 source
files, ~7,300 lines. Deployed from `main` by GitHub Actions with the suite
gating the deploy.

- App — https://ska999.github.io/recall-flashcards/
- Decks — https://ska999.github.io/recall-flashcards/decks/
- Repo — https://github.com/SKA999/recall-flashcards (public)

## Working

**Scheduling.** FSRS-5 — forgetting curve, stability and difficulty updates,
lapse handling, same-day formula, Anki's interval fuzz. Learning steps in front
of it, 4am day rollover, per-deck daily limits.

**Content.** Notes carry named fields; a note type says which fields each card
asks and answers. Basic, Basic (and reversed) and Cloze are built in; imports
create their own. Images, audio and video on any field.

**Review.** True interval previews on each button, keyboard control, undo 30
deep, study-ahead, section filtering, playback speed 0.5×–1.5×.

**Import.** CSV/TSV including Anki's text-export preamble; bundles of a table
plus its media, as a zip or a multi-selection; note types built from the
columns; sections from a week or unit column.

**Backup.** Whole collection to one inspectable zip and back. Restore merges.
Persistent storage requested at startup; daily folder backup on desktop
Chromium; a reminder when a copy is overdue and reviews would be lost.

**Deployment.** PWA — installable, offline, service worker verified active on
the live site.

**Decks published.** Primary 1–5 (1,486 characters, 2,917 clips) and a P5
composition outline, downloadable from the site.

## Half built

**Anki `.apkg` import.** All the parsing works and is tested against both
package formats and against a real 307-note export: zip with zip64, zstd, the
package protobufs, both collection schemas, note-type mapping, media conversion.
Missing: writing a parsed package into the collection, and the screen to drive
it. Roughly a day.

Worth doing when it lands: a real export carried the tag `3B-Week` on every note
plus a bare number per note, because Anki split `3B-Week 1` on the space.
Recombining those into `3B-Week-1` on import would make those weeks usable.

## Not built

**Sync.** The biggest gap. Two devices hold collections that diverge silently,
and a phone's browser storage can be evicted. The local half is done (decision
6); what is missing is a backend, accounts and a conflict policy.

**Native phone app.** The PWA installs today. Building native before sync gives
two collections that disagree, which is worse than one.

**Per-session card limit.** Sessions are bounded by daily limits and the section
filter. A hard "stop after N cards" cap does not exist; it would suit a child's
attention span and is small.

**Replace mode for restore.** See decision 4.

## Next, in dependency order

1. **Finish `.apkg` import** — independent of everything else. Do it when Anki
   decks are actually in play.
2. **Sync** — needs a hosting decision. Blocks the phone app.
3. **Native phone app** — needs sync.

Smaller, any time: per-session limit, replace mode for restore, deck rename and
bulk operations from the browse list, per-user FSRS weight optimisation (the
review log already records everything it would need).

## Verified, and not

Verified by driving the running app: import of real decks, review with audio,
undo, backup round-trip, the v1→v4 storage migrations, section filtering,
playback speed persistence.

**Not verified**, and stated as such rather than assumed:

- **iOS Safari and Android Chrome.** The preview browser used here is neither.
  The PWA install flow and the mobile file picker are correct by construction
  and untested in the real thing.
- **IME input.** Field values were set programmatically, which bypasses the
  composition events a pinyin or zhuyin IME fires. Dropped or duplicated
  characters mid-composition would only show up when a person types.
- **Service worker registration** is verified on the deployed site; it cannot be
  registered in the preview browser at all.
