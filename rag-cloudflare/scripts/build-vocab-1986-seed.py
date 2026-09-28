import json, re, unicodedata

def fold(s):
    s = s.lower().replace('ŋ', 'n').replace('ɛ', 'e').replace('ɔ', 'o')
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

vocab = json.load(open('vocab-dump.json', encoding='utf-8'))
have_head = set()
have_trans = set()
for r in vocab:
    have_head.add((r.get('headword_normalized') or fold(r['headword'])).strip())
    try:
        for t in json.loads(r.get('translations') or '[]'):
            have_trans.add(fold(t))
    except Exception:
        pass

VERBS = set('''am is are was were will shall do does did can could may might must have has had
want wants like likes feel feeling look looks go goes going take takes keep keeps make makes
give gives show shows tell tells hold holds speak speaks say says listen listens walk walks
walked return returns help helps allow allows put puts feed feeds call calls ask asks write
writes come comes came shut shuts open opens wash washes blame blames leave leaves forgive
forgives regret regrets know knows think thinks understand understands support supports
experience experiences reduce reduces misbehave be been being sit sat slept sleep rain rained
rains raining shine shines shining play plays playing study studies studying read reads buy
buys sell sells pay pays paid find found wait waits cross crosses climb climbs miss missed
lose lost break broke barked bark barks breed breeds bite bites kill kills sting stings
destroy destroyed work works working learn learns admit admitted belong belongs welcome
bid extend please sweep sweeps lay lays see sees saw deserve deserves weigh weighs cost
costs die dies died dye thank fetch reach reaches ride rides riding cry cries crying
wake woke knock knocks smoke smoking change changes choose chose celebrate marry married
heal recover recovers perspire perspiring sweat sweat wait forgive enjoy enjoyed stay stays
staying live lives living enrol teach teaches taught refresh relax concern concerns
become becomes got get gets'''.split())

def termlevel(r):
    e = r['english'].strip(); g = r['ga'].strip()
    if e.endswith(('.', '?', '!')) or g.endswith(('.', '?')):
        return False
    if len(e.split()) > 5 or len(g.split()) > 5:
        return False
    if ',' in e or ':' in e or ';' in e:
        return False
    toks = [t.strip('()').lower() for t in e.split()]
    if any(t in VERBS for t in toks):
        return False
    return True

recs = [json.loads(l) for l in open('datasets/ga-language-guide-extra.jsonl', encoding='utf-8') if l.strip()]
terms = [r for r in recs if termlevel(r)]

# merge homographs on folded ga headword
groups = {}
order = []
for r in terms:
    # first variant is the headword; rest go to variants
    parts = [p.strip() for p in re.split(r'\s*/\s*', r['ga']) if p.strip()]
    head = parts[0]
    variants = parts[1:]
    # strip parenthetical gloss from headword e.g. "Oshija (Nuu ni bɛ ŋa)"
    hw = re.sub(r'\s*\([^)]*\)\s*$', '', head).strip()
    key = fold(hw)
    if key in have_head:
        continue  # already in vocabulary
    if key not in groups:
        groups[key] = {'headword': hw, 'meanings': [], 'translations': [],
                       'variants': set(variants), 'category': r['topic'], 'page': r['page']}
        order.append(key)
    g = groups[key]
    eng = r['english'].strip()
    cap = eng[0].upper() + eng[1:]
    if cap not in g['meanings']:
        g['meanings'].append(cap)
    low = eng.lower()
    if low not in g['translations']:
        g['translations'].append(low)
    g['variants'].update(variants)

SRC = 'Bureau of Ghana Languages — Language Guide (Ga Version), 1986 (promoted from verified dataset)'
NOW = '2026-09-27T00:00:00Z'
lines = [
    "-- Promoted term-level records extracted from Language Guide (Ga Version),",
    "-- Bureau of Ghana Languages, Accra 1986 (32-page scan, hand-transcribed).",
    "-- Deduped against existing vocab; homograph glosses merged. Generated — do not hand-edit.",
]
n = 374
skipped = len(terms) - sum(len(v['meanings']) and 1 or 0 for k, v in groups.items()) - (len(terms) - len(order))
out_n = 0
for key in order:
    g = groups[key]
    n += 1
    out_n += 1
    vals = [
        f"vocab:{n:04d}", g['headword'], key, 'noun',
        json.dumps(g['meanings']), json.dumps(g['translations']), '[]',
        json.dumps(sorted(g['variants'])), None, g['category'], SRC,
        'guide-1986-dataset-promotion', NOW,
    ]
    def esc(v):
        if v is None: return 'NULL'
        return "'" + str(v).replace("'", "''") + "'"
    lines.append(
        "INSERT OR REPLACE INTO vocabulary (id,headword,headword_normalized,part_of_speech,meanings,translations,examples,variants,phonetic,category,source,verified_by,verified_at) VALUES ("
        + ",".join(esc(v) for v in vals) + ");"
    )

open('src/db/seed-vocabulary-1986.sql', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print(f'{out_n} new vocab rows -> src/db/seed-vocabulary-1986.sql ({len(terms)} candidates)')
for k in order[:12]:
    print('  ', groups[k]['headword'], '=', groups[k]['meanings'])
