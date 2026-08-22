---
name: flashcard-audio
description: Generate spoken audio for flashcard decks and vocabulary lists using text-to-speech, then bundle it for import. Use this whenever someone wants to add pronunciation, audio, recordings, or "sound" to cards — language decks, Anki decks, Chinese/Japanese/Spanish vocabulary, spelling lists — or asks how to make audio for a deck, which TTS service to use, or mentions HyperTTS, AwesomeTTS, or generating voice files in bulk. Also use it when a deck already has audio that is silent, wrong-sounding, or read in the wrong language.
---

# Audio for flashcard decks

Generating a hundred sound files is a batch job, not a hundred small tasks. The
work is: pick a voice that can actually read the text, synthesise once per
distinct phrase, and hand the result to the importer as files with a table that
names them.

## Start here

If the deck is a CSV with a column per side, `scripts/make-audio.py` does the
whole job:

```bash
python3 scripts/make-audio.py cards.csv --zip deck.zip
```

For every column named `<X> audio` it speaks column `<X>`, writes the clip, and
fills the cell with the filename. It picks a voice matching the script it finds
in each column, skips cells already filled, and shares one file between rows
with identical text.

Override a voice when the default isn't the one you want:

```bash
python3 scripts/make-audio.py cards.csv \
  --voice "Chinese=Tingting" --voice "English=Samantha" \
  --rate 150 --zip deck.zip
```

`--rate 150` slows delivery to roughly 150 words per minute, which is worth
doing for beginners and for young learners.

The table it expects looks like this — audio columns left blank for the script
to fill:

```csv
Chinese,Pinyin,English,Chinese audio,English audio,Week
学校,xuéxiào,school,,,Week 1
```

## The failure that matters: silent files

A voice asked to read a script it doesn't know **does not fail**. macOS `say`
writes a valid audio file containing about a hundredth of a second of nothing:

```
say -v Samantha -o out.aiff "学校 老师 图书馆"   →  0.01 seconds
say -v Tingting -o out.aiff "学校 老师 图书馆"   →  1.77 seconds
```

Nothing errors. The file exists, the import succeeds, the cards look right, and
every clip is silent — which you discover during a review session, after
recording the whole deck.

The script guards this three ways: it detects the script each column is written
in, it refuses a voice whose locale can't match, and it measures every clip and
stops if one comes out under 0.15 seconds. If you generate audio some other way,
**check durations before trusting a batch**:

```bash
for f in audio/*.m4a; do
  printf "%s %s\n" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")" "$f"
done | sort -n | head
```

The shortest files come first. Anything near zero is silence.

## Choosing a voice

List what's installed:

```bash
say -v '?'
```

The locale column is the part that matters — `zh_CN` for mainland Mandarin,
`zh_TW` for Taiwan, `zh_HK` for Cantonese, `ja_JP`, `ko_KR`, `en_GB`, `en_US`.
Match the locale to the content, not the voice name: several voices ship in
multiple locales under one name.

On macOS, higher-quality voices are downloadable in **System Settings →
Accessibility → Spoken Content → System Voice → Manage Voices**. The default
install is often the older compact voice; the downloadable "Premium" and
"Enhanced" versions are noticeably better and cost nothing. This is the single
cheapest quality improvement available.

## Local or cloud

The built-in route needs no account, no key, no per-character cost, and works
offline — which for a few hundred cards is usually the right answer. Reach for a
cloud service when you need a voice quality the system voices can't reach, a
locale that isn't installed, or SSML control over pauses and emphasis.

`references/cloud-tts.md` covers the services, what they cost, and how to call
them. Read it when the local voices aren't good enough, or when the person
asking has already decided on a provider.

## Human recordings

TTS is a stand-in for a voice, and for a language deck the real thing is better
when it's available. A native speaker reading a hundred words takes under an
hour, and for tone languages the difference is audible. Suggest it when the deck
is for a child, or for a language where the synthetic voice mangles prosody.
Keep the same filename convention and the importer doesn't care where the audio
came from.

## Bundling for import

The importer wants a table and its media together — either a zip or a
multi-selection of the same files:

```
deck.zip
├── cards.csv
└── audio/
    ├── 80d13d2436ca.m4a
    └── 4b6e4bbec57c.m4a
```

`--zip` writes exactly this. Filenames are a digest of the text and the voice
rather than a slug, because Chinese and Japanese give no usable ASCII slug, and
because a stable name means re-running the script reuses files instead of
duplicating them.

`m4a` is the default: it needs only `afconvert`, which ships with macOS, and it
is well supported everywhere. `--format mp3` needs `ffmpeg` installed and is
worth it only when something downstream insists on MP3.

## Working with an existing deck

When a deck already has audio, find out where it came from before regenerating.
Anki decks made with HyperTTS or AwesomeTTS name their files after the service —
`google-<hash>.mp3` means Google TTS. That tells you the voice to match if
you're adding cards to an existing set, so the new clips don't sound different
from the old ones.

To add audio only to the rows that lack it, leave the filled cells alone: the
script skips any audio cell that already has content, so pointing it at a
partly-finished deck fills in just the gaps. Use `--force` only when you mean to
replace everything.
