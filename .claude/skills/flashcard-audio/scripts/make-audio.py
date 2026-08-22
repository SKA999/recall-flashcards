#!/usr/bin/env python3
"""Fill in the audio columns of a deck CSV using macOS speech synthesis.

For every column named "<X> audio" it speaks column "<X>" and writes the file,
then rewrites the table with the filenames — producing exactly the bundle the
importer expects.

    python3 scripts/make-audio.py cards.csv \\
        --voice "Chinese=Tingting" --voice "English=Samantha" \\
        --zip primary-5.zip

Everything here is built into macOS: `say` for synthesis, `afconvert` for
encoding. No API key, no per-character cost, and it works offline. Identical
text is spoken once and shared, and a row whose audio cell is already filled is
left alone, so the script can be re-run as the deck grows.

List the voices you have with `say -v '?'`.
"""

import argparse
import csv
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

AUDIO_SUFFIX = re.compile(r'^(.*?)\s+audio$', re.IGNORECASE)

# Han, Hiragana/Katakana, Hangul: scripts a Latin voice cannot read at all.
CJK = re.compile(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]')

# Anything shorter than this is silence, not speech.
MIN_SPEECH_SECONDS = 0.15

# Preferred voice per language, first one installed wins.
DEFAULT_VOICES = {
    'zh': ['Tingting', 'Meijia', 'Sinji'],
    'ja': ['Kyoko', 'Otoya'],
    'ko': ['Yuna'],
    'en': ['Samantha', 'Alex', 'Daniel', 'Karen'],
}


def script_of(texts: list[str]) -> str:
    """Which language family a column is written in, from its content."""
    sample = ' '.join(texts[:40])
    if CJK.search(sample):
        return 'cjk'
    return 'latin'


def duration_of(path: str) -> float:
    """Length in seconds, via afinfo, which ships with macOS."""
    out = subprocess.run(['afinfo', path], capture_output=True, text=True).stdout
    match = re.search(r'estimated duration:\s*([0-9.]+)', out)
    return float(match.group(1)) if match else 0.0


def die(message: str) -> None:
    print(f'error: {message}', file=sys.stderr)
    sys.exit(1)


def check_platform() -> None:
    if sys.platform != 'darwin':
        die('this script uses macOS speech synthesis; see the README for the cloud options')
    for tool in ('say', 'afconvert'):
        if shutil.which(tool) is None:
            die(f'{tool} not found — it ships with macOS, so something is unusual here')


def known_voices() -> dict[str, str]:
    """Voice name -> locale, as `say` reports them."""
    out = subprocess.run(['say', '-v', '?'], capture_output=True, text=True).stdout
    voices = {}
    for line in out.splitlines():
        # "Tingting            zh_CN    # 你好！我叫婷婷。"
        match = re.match(r'^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s', line)
        if match:
            voices[match.group(1).strip()] = match.group(2)
    return voices


def speak(text: str, voice: str, rate: int, path: str, fmt: str) -> float:
    """Synthesise one phrase to `path`. Returns its length in seconds."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'speech.aiff')
        command = ['say', '-v', voice, '-o', raw]
        if rate:
            command += ['-r', str(rate)]
        # The text goes on stdin so punctuation is never read as an argument.
        result = subprocess.run(command + ['--', text], capture_output=True, text=True)
        if result.returncode != 0:
            die(f'say failed for {text!r}: {result.stderr.strip()}')

        if fmt == 'm4a':
            encode = ['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', raw, path]
        elif fmt == 'mp3':
            if shutil.which('ffmpeg') is None:
                die('mp3 output needs ffmpeg; use --format m4a, which needs nothing extra')
            encode = ['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-codec:a', 'libmp3lame',
                      '-b:a', '64k', path]
        else:
            die(f'unknown format {fmt}')
        seconds = duration_of(raw)
        if seconds < MIN_SPEECH_SECONDS:
            # A voice that cannot read the script returns near-silence rather
            # than failing, so this is the only reliable way to catch it.
            die(f'{voice!r} produced {seconds:.2f}s of silence for {text!r}.\n'
                f'       That voice almost certainly cannot read this script. '
                f'Choose one that can (say -v \'?\').')
        if subprocess.run(encode, capture_output=True).returncode != 0:
            die(f'could not encode {path}')
        return seconds


def stable_name(text: str, voice: str, fmt: str) -> str:
    """A filename that is the same every run, and safe on every filesystem.

    Chinese text cannot supply a readable slug, so the name is a digest of the
    text and the voice: change either and you get a new file, change neither and
    the old one is reused.
    """
    digest = hashlib.sha1(f'{voice}\x00{text}'.encode()).hexdigest()[:12]
    return f'{digest}.{fmt}'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('csv', help='the deck table to fill in')
    parser.add_argument('--voice', action='append', default=[], metavar='COLUMN=VOICE',
                        help='voice for a source column, e.g. "Chinese=Tingting". Repeatable.')
    parser.add_argument('--rate', type=int, default=0,
                        help='words per minute; slower helps beginners (try 140)')
    parser.add_argument('--format', choices=['m4a', 'mp3'], default='m4a')
    parser.add_argument('--out', default=None,
                        help='folder to build in (default: beside the CSV)')
    parser.add_argument('--audio-dir', default='audio', help='folder for the clips')
    parser.add_argument('--zip', default=None, help='also write a ready-to-import zip')
    parser.add_argument('--force', action='store_true',
                        help='replace audio cells that are already filled')
    args = parser.parse_args()

    check_platform()
    voices = known_voices()

    voice_for = {}
    for pair in args.voice:
        if '=' not in pair:
            die(f'--voice wants COLUMN=VOICE, got {pair!r}')
        column, voice = pair.split('=', 1)
        if voice not in voices:
            die(f'no voice called {voice!r}. Run: say -v \'?\'')
        voice_for[column.strip().lower()] = voice

    with open(args.csv, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.reader(f))
    if not rows:
        die('that file is empty')

    header = rows[0]
    lookup = {name.strip().lower(): i for i, name in enumerate(header)}

    # Pair every "<X> audio" column with its source column "<X>".
    pairs = []
    for i, name in enumerate(header):
        match = AUDIO_SUFFIX.match(name.strip())
        if not match:
            continue
        source = match.group(1).strip().lower()
        if source not in lookup:
            print(f'  skipping "{name}": no column called "{match.group(1).strip()}"')
            continue
        source_i = lookup[source]
        column_script = script_of([r[source_i] for r in rows[1:] if len(r) > source_i])
        wanted = 'zh' if column_script == 'cjk' else 'en'

        voice = voice_for.get(source)
        if voice is None:
            voice = next((v for v in DEFAULT_VOICES[wanted] if v in voices), None)
            if voice is None:
                die(f'no voice for the "{match.group(1).strip()}" column and no default '
                    f'installed. Add --voice "{match.group(1).strip()}=SomeVoice" '
                    f'(see: say -v \'?\')')
            print(f'  using {voice} for "{match.group(1).strip()}" '
                  f'({"Chinese" if wanted == "zh" else "English"} text detected)')
        else:
            # Guard the common mistake: an English voice on a Chinese column
            # writes silent files without complaining.
            locale = voices[voice]
            if column_script == 'cjk' and not locale.startswith(('zh', 'ja', 'ko')):
                die(f'"{match.group(1).strip()}" contains Chinese, Japanese or Korean text, '
                    f'but {voice!r} is a {locale} voice.\n'
                    f'       It would write silent files. Try one of: '
                    f'{", ".join(v for v in DEFAULT_VOICES["zh"] if v in voices)}')
            if column_script == 'latin' and locale.startswith(('zh', 'ja', 'ko')):
                print(f'  warning: "{match.group(1).strip()}" looks like Latin text but '
                      f'{voice!r} is a {locale} voice; it will read with a heavy accent')
        pairs.append((source_i, i, voice))

    if not pairs:
        die('no "<column> audio" columns found. See examples/import-template.csv')

    out_dir = args.out or os.path.dirname(os.path.abspath(args.csv))
    audio_dir = os.path.join(out_dir, args.audio_dir)
    os.makedirs(audio_dir, exist_ok=True)

    made, reused, skipped = 0, 0, 0
    for row in rows[1:]:
        if not any(cell.strip() for cell in row):
            continue
        row += [''] * (len(header) - len(row))
        for source_i, audio_i, voice in pairs:
            text = row[source_i].strip()
            if not text:
                continue
            if row[audio_i].strip() and not args.force:
                skipped += 1
                continue
            name = stable_name(text, voice, args.format)
            path = os.path.join(audio_dir, name)
            if os.path.exists(path):
                reused += 1
            else:
                print(f'  {voice:<10} {text}')
                speak(text, voice, args.rate, path, args.format)
                made += 1
            row[audio_i] = f'{args.audio_dir}/{name}'

    out_csv = os.path.join(out_dir, os.path.basename(args.csv))
    with open(out_csv, 'w', newline='', encoding='utf-8') as f:
        csv.writer(f).writerows(rows)

    print(f'\n{made} clips recorded, {reused} already on disk, {skipped} cells left as they were')
    print(f'table written to {out_csv}')

    if args.zip:
        with zipfile.ZipFile(args.zip, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(out_csv, os.path.basename(out_csv))
            for name in sorted(os.listdir(audio_dir)):
                z.write(os.path.join(audio_dir, name), f'{args.audio_dir}/{name}')
        size = os.path.getsize(args.zip)
        print(f'bundle written to {args.zip} ({size // 1024} KB) — import this directly')


if __name__ == '__main__':
    main()
