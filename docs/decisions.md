# Decisions

Why things are the way they are. Each entry says what was decided, what it rules
out, and what would justify revisiting it — so a later session can disagree with
a decision on purpose rather than undo it by accident.

## 1. `src/core/` stays free of the platform

The scheduler, note model, FSRS maths and pure mappers import no `window`, no
`document`, no React and no storage. Persistence sits behind the `Store`
interface in `core/storage.ts`.

**Why.** A native phone app is meant to reuse this layer unchanged and supply a
SQLite `Store`. The moment core reaches for a browser API, that stops being
possible, and the breakage is silent — everything still works on the web.

**Rules out.** Convenience access to `localStorage`, `fetch` or the DOM from
core, however small the temptation.

## 2. Card content renders as text, never HTML

`FieldView` parses `{{media:id}}` tokens and renders everything else as plain
text. Anki's field HTML is flattened by `htmlToText` on the way in.

**Why.** Imported decks come from strangers. Rendering their HTML makes every
shared deck an injection surface, in an app that otherwise has no server and no
accounts to protect.

**Rules out.** Rich formatting on cards — bold, colour, tables, layout. If that
is ever wanted, it needs a sanitiser, and the sanitiser is the hard part.

## 3. Anki's template language is not implemented

A `CardTemplate` records which field *indexes* a card asks and answers. Field
references are pulled from `qfmt`/`afmt` with a regex; nothing is evaluated.

**Why.** Anki templates are a small language — conditionals, filters, cloze,
type-in answers. Implementing it means an evaluator, a long tail of
compatibility bugs, and HTML output, which contradicts decision 2. Reading
*which fields a card mentions* captures real note types without any of that.

**Cost.** Imports are content-complete and layout-approximate: conditional
sections and filters flatten, so a field hidden behind `{{#Cond}}` or
`{{hint:}}` simply shows.

## 4. Restore merges; it never overwrites

Records already present are skipped. There is no replace mode.

**Why.** The dangerous restore is the accidental one: opening a three-week-old
backup should not silently erase three weeks of reviews. Merging also makes
restoring twice a no-op, which makes the operation safe to retry.

**Cost.** A newer backup cannot correct older records. Adding a replace mode
needs a confirmation flow, not just a flag.

## 5. Sections are tags kept whole

A week or unit label becomes one tag: `Week 3` → `Week-3`.

**Why.** Anki splits tags on spaces. A real imported deck arrived carrying
`3B-Week` on all 307 notes plus a bare number per note — the week structure was
there and unusable. Keeping the label whole is the entire point.

**How a section is told from a tag column.** Not by length. A tags column is
built from combinations, so its words recur across values (`noun weather` and
`noun time` share "noun"); a section column is a list of names that share
nothing (`Opening`, `Transition`, `Content`). Numbered labels are sections
outright, since `Week 1` and `Week 2` share a word by construction. See
`core/sections.ts`.

## 6. Sync bookkeeping exists before sync does

Every deck, note, card and note type carries an `updated` stamp. Deletes write
tombstones in the same transaction as the delete. `Store.listTombstones()` has
no caller.

**Why.** Retrofitting this later means migrating real review history. Doing it
while the only data was a demo deck cost twenty minutes; doing it after a year
of study would not.

**Note.** A delete without its tombstone is indistinguishable from a record the
other device has not seen yet, and comes straight back on the next sync. That is
why the two are written together rather than in sequence.

## 7. Day counters are device-local and not synced

Per-deck daily counters live in storage but carry no `updated` stamp.

**Why.** They are derivable from the review log, and they describe a device's
day rather than the collection's state. Syncing them would mean merging two
devices' notions of "today".

## 8. Audio is generated locally by default

`.claude/skills/flashcard-audio/` uses macOS speech synthesis. Cloud providers
are documented but not wired in.

**Why.** No account, no API key, no per-character cost, works offline, and good
enough for vocabulary. The cloud options matter when a locale is missing or the
voice quality is not good enough — `references/cloud-tts.md` covers them, and
`speak()` is the only function a provider swap has to touch.

## 9. Playback preserves pitch

`preservesPitch` is set explicitly on every media element rather than left to
the browser default.

**Why.** The reason to slow a word down is to hear its tone. Slowing audio
without pitch preservation drops the pitch and changes the thing being learned,
which defeats the feature in exactly the language it exists for.

## 10. Automatic backup is three mechanisms, not one

Persistent storage is requested every start; a folder backup runs daily on
desktop Chromium; a reminder covers everything else.

**Why.** A browser cannot silently write files. Folder access is Chromium
desktop only, and the eviction risk lives on phones — so the automatic path and
the risk are on different platforms. Persistence is the phone's real mitigation;
the reminder is its fallback.

**Deliberate.** The daily write is attempted silently and abandoned quietly if
it would prompt. A permission dialog on startup is worse than a reminder inside
the app.

## 11. A backup with nothing new in it is never due

`backupDue` returns false when no reviews have happened since the last copy.

**Why.** Rewriting an identical file teaches people to ignore the reminder, and
a reminder people ignore is worse than none.

## 12. Verification prefers a real artefact to a plausible one

Fixtures are generated from published schemas (`scripts/make-apkg-fixture.py`
follows Anki's own DDL and protobuf definitions). The zip writer was checked
against Python's `zipfile` and the `unzip` CLI, not only against its own reader.

**Why.** A reader and writer built together agree with each other and hide
shared mistakes. The UTF-8 filename flag bug round-tripped perfectly in our own
code and was only found by another implementation.
