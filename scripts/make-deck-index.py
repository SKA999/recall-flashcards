#!/usr/bin/env python3
"""Builds public/decks/index.html from the deck bundles actually present.

Generated rather than hand-written so the card counts, clip counts and file
sizes cannot drift away from the files they describe.
"""

import csv
import html
import io
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DECKS = os.path.join(HERE, '..', 'public', 'decks')


def describe(path):
    """Read a bundle without unpacking it."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        table = next(n for n in names if n.endswith('.csv'))
        rows = list(csv.reader(io.StringIO(z.read(table).decode('utf-8'))))
    header = rows[0]
    tag_column = next((i for i, h in enumerate(header) if h.strip().lower() in ('tag', 'tags', 'week')), None)
    sections = []
    if tag_column is not None:
        for row in rows[1:]:
            if len(row) > tag_column and row[tag_column].strip() and row[tag_column] not in sections:
                sections.append(row[tag_column].strip())
    return {
        'cards': len(rows) - 1,
        'clips': sum(1 for n in names if not n.endswith('.csv')),
        'sections': sections,
        'bytes': os.path.getsize(path),
    }


def grade_of(filename):
    match = re.match(r'(\d+)', filename)
    return int(match.group(1)) if match else 99


def main():
    files = sorted(
        (f for f in os.listdir(DECKS) if f.endswith('.zip')),
        key=lambda f: grade_of(f),
    )
    if not files:
        raise SystemExit('no deck bundles in public/decks')

    cards = []
    for name in files:
        info = describe(os.path.join(DECKS, name))
        grade = grade_of(name)
        weeks = len(info['sections'])
        cards.append(f'''      <li class="deck">
        <div class="grow">
          <h2>Primary {grade}</h2>
          <p class="meta">{info['cards']} characters · {info['clips']} recordings · {weeks} weeks</p>
          <p class="range">{html.escape(info['sections'][0])} – {html.escape(info['sections'][-1])}</p>
        </div>
        <a class="get" href="./{html.escape(name)}" download>
          Download<span>{info['bytes'] // 1024 // 1024}.{(info['bytes'] // 1024 % 1024) * 10 // 1024} MB</span>
        </a>
      </li>''')

    page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Chinese decks for Recall</title>
<style>
  :root {{
    --bg: #f7f7f8; --surface: #fff; --border: #e2e2e6;
    --text: #1a1a1e; --muted: #6b6b76; --accent: #4f46e5; --accent-text: #fff;
    color-scheme: light dark;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #0f1115; --surface: #171a21; --border: #2a2f3a;
      --text: #e8e9ed; --muted: #9aa0ad; --accent: #7c7cf7; --accent-text: #0f1115;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .wrap {{ max-width: 34rem; margin: 0 auto; padding: 32px 18px calc(48px + env(safe-area-inset-bottom)); }}
  h1 {{ font-size: 26px; margin: 0 0 6px; letter-spacing: -0.02em; }}
  .lede {{ color: var(--muted); margin: 0 0 26px; }}
  ul {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }}
  .deck {{
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: 15px 16px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px;
  }}
  .grow {{ flex: 1; min-width: 11rem; }}
  h2 {{ font-size: 16px; margin: 0; font-weight: 620; }}
  .meta {{ margin: 3px 0 0; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }}
  .range {{ margin: 1px 0 0; font-size: 12px; color: var(--muted); }}
  .get {{
    display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
    padding: 9px 16px; border-radius: 9px; text-decoration: none;
    background: var(--accent); color: var(--accent-text); font-weight: 550; font-size: 14px;
  }}
  .get span {{ font-size: 11px; opacity: .8; font-weight: 400; }}
  .how {{
    margin-top: 30px; padding: 16px 18px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px;
  }}
  .how h3 {{ margin: 0 0 8px; font-size: 14px; }}
  .how ol {{ margin: 0; padding-left: 18px; color: var(--muted); font-size: 14px; }}
  .how li {{ margin-bottom: 5px; }}
  a {{ color: var(--accent); }}
  footer {{ margin-top: 26px; color: var(--muted); font-size: 13px; }}
</style>
</head>
<body>
  <div class="wrap">
    <h1>Chinese decks</h1>
    <p class="lede">Character, pinyin and meaning, with Mandarin and English audio on every card. Grouped by week.</p>
    <ul>
{chr(10).join(cards)}
    </ul>

    <div class="how">
      <h3>Using one</h3>
      <ol>
        <li>Open <a href="../">the app</a> and add it to your home screen.</li>
        <li>Download a deck above — it saves to Files or Downloads.</li>
        <li>In the app: <strong>Import</strong> → <strong>Choose files</strong> → pick the zip.</li>
        <li>Tap a week to study just that week.</li>
      </ol>
    </div>

    <footer>Audio is speech synthesis, not a native speaker. Good enough to learn from; worth replacing if you can record the real thing.</footer>
  </div>
</body>
</html>
'''
    out = os.path.join(DECKS, 'index.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    total = sum(os.path.getsize(os.path.join(DECKS, f)) for f in files)
    print(f'wrote {out} listing {len(files)} decks ({total // 1024 // 1024} MB total)')


if __name__ == '__main__':
    main()
