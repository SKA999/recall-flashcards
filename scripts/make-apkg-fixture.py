#!/usr/bin/env python3
"""Builds a synthetic legacy .apkg for the import tests.

Real Anki exports are the eventual source of truth, but waiting on one blocks
all the work. This constructs a schema-11 collection covering the shapes that
actually matter: a plain note type, a reversed one, one with more fields than we
model, a cloze type, cards carrying FSRS state and cards still on SM-2, a
suspended card, and a media reference.

Layout per anki/rslib/src/storage/schema11.sql.
"""
import json, os, sqlite3, sys, tempfile, zipfile

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'import', '__tests__', 'fixtures')
US = '\x1f'  # Anki joins note fields with the unit separator

CRT = 1735689600  # 2025-01-01 UTC, the collection's day-zero
MOD = 1780000000

BASIC, REVERSED, DETAILED, CLOZE = 1000, 1001, 1002, 1003
DECK_MAIN, DECK_SUB = 2000, 2001


def field(name, ord_):
    return {"name": name, "ord": ord_, "sticky": False, "rtl": False, "font": "Arial", "size": 20}


def template(name, ord_, qfmt, afmt):
    return {"name": name, "ord": ord_, "qfmt": qfmt, "afmt": afmt, "did": None, "bqfmt": "", "bafmt": ""}


MODELS = {
    str(BASIC): {
        "id": BASIC, "name": "Basic", "type": 0, "mod": MOD, "usn": -1, "sortf": 0,
        "did": DECK_MAIN, "css": "", "latexPre": "", "latexPost": "", "req": [[0, "any", [0]]],
        "flds": [field("Front", 0), field("Back", 1)],
        "tmpls": [template("Card 1", 0, "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}")],
    },
    str(REVERSED): {
        "id": REVERSED, "name": "Basic (and reversed card)", "type": 0, "mod": MOD, "usn": -1,
        "sortf": 0, "did": DECK_MAIN, "css": "", "latexPre": "", "latexPost": "",
        "req": [[0, "any", [0]], [1, "any", [1]]],
        "flds": [field("Front", 0), field("Back", 1)],
        "tmpls": [
            template("Card 1", 0, "{{Front}}", "{{FrontSide}}<hr id=answer>{{Back}}"),
            template("Card 2", 1, "{{Back}}", "{{FrontSide}}<hr id=answer>{{Front}}"),
        ],
    },
    str(DETAILED): {
        "id": DETAILED, "name": "Vocab with notes", "type": 0, "mod": MOD, "usn": -1, "sortf": 0,
        "did": DECK_MAIN, "css": "", "latexPre": "", "latexPost": "", "req": [[0, "any", [0]]],
        "flds": [field("Word", 0), field("Meaning", 1), field("Example", 2), field("Audio", 3)],
        "tmpls": [
            template("Recognition", 0, "{{Word}}", "{{Meaning}}<br>{{Example}}"),
            template("Recall", 1, "{{Meaning}}", "{{Word}}"),
            template("Listening", 2, "{{Audio}}", "{{Word}}"),
        ],
    },
    str(CLOZE): {
        "id": CLOZE, "name": "Cloze", "type": 1, "mod": MOD, "usn": -1, "sortf": 0,
        "did": DECK_MAIN, "css": "", "latexPre": "", "latexPost": "", "req": [],
        "flds": [field("Text", 0), field("Extra", 1)],
        "tmpls": [template("Cloze", 0, "{{cloze:Text}}", "{{cloze:Text}}<br>{{Extra}}")],
    },
}

DECKS = {
    str(DECK_MAIN): {"id": DECK_MAIN, "name": "Spanish", "mod": MOD, "usn": -1, "collapsed": False},
    str(DECK_SUB): {"id": DECK_SUB, "name": "Spanish::Verbs", "mod": MOD, "usn": -1, "collapsed": False},
}

# (note id, model, deck, fields, tags)
NOTES = [
    (3001, BASIC, DECK_MAIN, ["la brisa", "breeze"], "noun weather"),
    (3002, BASIC, DECK_MAIN, ["el amanecer", "dawn"], "noun"),
    (3003, BASIC, DECK_MAIN, ['la sobremesa', 'the talk after a meal'], ""),
    (3004, REVERSED, DECK_MAIN, ["el puente", "bridge"], "noun"),
    (3005, DETAILED, DECK_SUB, ["estrenar", "to use for the first time",
                                "Hoy estreno zapatos.", '[sound:estrenar.mp3]'], "verb"),
    (3006, CLOZE, DECK_MAIN, ["El {{c1::gato}} duerme en la {{c2::silla}}.", "animals"], "cloze"),
    (3007, BASIC, DECK_MAIN, ['<img src="brisa.png"> la imagen', 'the picture'], "media"),
]

# (card id, note id, deck, ord, type, queue, due, ivl, factor, reps, lapses, data)
CARDS = [
    # A mature review card carrying FSRS memory state.
    (4001, 3001, DECK_MAIN, 0, 2, 2, 400, 47, 2500, 12, 1, '{"s":47.2,"d":5.4,"lrt":1779000000}'),
    # An SM-2 card: no data column, so stability has to be estimated.
    (4002, 3002, DECK_MAIN, 0, 2, 2, 380, 21, 2350, 8, 0, ''),
    # Suspended.
    (4003, 3003, DECK_MAIN, 0, 2, -1, 390, 15, 2500, 5, 2, ''),
    # Both cards of the reversed note, one still new.
    (4004, 3004, DECK_MAIN, 0, 2, 2, 405, 9, 2500, 4, 0, ''),
    (4005, 3004, DECK_MAIN, 1, 0, 0, 7, 0, 0, 0, 0, ''),
    # Three cards from the four-field note type, including one in a subdeck.
    (4006, 3005, DECK_SUB, 0, 2, 2, 410, 33, 2600, 9, 0, '{"s":33.9,"d":4.1}'),
    (4007, 3005, DECK_SUB, 1, 1, 1, 1780000600, 0, 0, 2, 0, ''),
    (4008, 3005, DECK_SUB, 2, 0, 0, 12, 0, 0, 0, 0, ''),
    # Two cards generated from one cloze note.
    (4009, 3006, DECK_MAIN, 0, 2, 2, 402, 18, 2500, 6, 1, ''),
    (4010, 3006, DECK_MAIN, 1, 0, 0, 13, 0, 0, 0, 0, ''),
    # The card whose field references an image.
    (4011, 3007, DECK_MAIN, 0, 2, 2, 415, 6, 2500, 3, 0, ''),
]


def build(path):
    db = sqlite3.connect(path)
    db.executescript("""
        create table col (id integer primary key, crt integer not null, mod integer not null,
          scm integer not null, ver integer not null, dty integer not null, usn integer not null,
          ls integer not null, conf text not null, models text not null, decks text not null,
          dconf text not null, tags text not null);
        create table notes (id integer primary key, guid text not null, mid integer not null,
          mod integer not null, usn integer not null, tags text not null, flds text not null,
          sfld integer not null, csum integer not null, flags integer not null, data text not null);
        create table cards (id integer primary key, nid integer not null, did integer not null,
          ord integer not null, mod integer not null, usn integer not null, type integer not null,
          queue integer not null, due integer not null, ivl integer not null, factor integer not null,
          reps integer not null, lapses integer not null, left integer not null, odue integer not null,
          odid integer not null, flags integer not null, data text not null);
        create table revlog (id integer primary key, cid integer not null, usn integer not null,
          ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null,
          time integer not null, type integer not null);
        create table graves (usn integer not null, oid integer not null, type integer not null);
    """)
    db.execute(
        "insert into col values (1,?,?,?,11,0,-1,0,?,?,?,?,?)",
        (CRT, MOD, MOD * 1000, json.dumps({"curDeck": DECK_MAIN, "nextPos": 1}),
         json.dumps(MODELS), json.dumps(DECKS), json.dumps({}), json.dumps({})),
    )
    for nid, mid, _did, flds, tags in NOTES:
        joined = US.join(flds)
        db.execute(
            "insert into notes values (?,?,?,?,-1,?,?,?,0,0,'')",
            (nid, f"guid{nid}", mid, MOD, f" {tags} " if tags else "", joined, flds[0]),
        )
    for cid, nid, did, ordn, type_, queue, due, ivl, factor, reps, lapses, data in CARDS:
        db.execute(
            "insert into cards values (?,?,?,?,?,-1,?,?,?,?,?,?,?,0,0,0,0,?)",
            (cid, nid, did, ordn, MOD, type_, queue, due, ivl, factor, reps, lapses, data),
        )
    db.commit()
    db.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        col = os.path.join(tmp, 'collection.anki2')
        build(col)
        target = os.path.abspath(os.path.join(OUT, 'sample-legacy.apkg'))
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(col, 'collection.anki2')
            # Legacy media map: zip entry name -> original filename.
            z.writestr('media', json.dumps({"0": "brisa.png", "1": "estrenar.mp3"}))
            z.writestr('0', b'\x89PNG\r\n\x1a\n' + b'fake image bytes')
            z.writestr('1', b'ID3' + b'fake audio bytes')
        print(f"wrote {target} ({os.path.getsize(target)} bytes)")


if __name__ == '__main__':
    main()
