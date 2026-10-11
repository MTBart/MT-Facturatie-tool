# backup/ roteren naar de huidige live-versie (origin/main), met rode balk + noindex; hash-check per bestand.
#
#   python tools/backup-roteer.py <versie> <datum>      roteren (zie RELEASE.md, stap 3)
#   python tools/backup-roteer.py --saneer              alleen de bestaande backup/ neutraliseren (zonder te roteren)
#
# De repo is PUBLIC. De live versie kan nog een harde klantenregistry bevatten (namen + Moneybird-contact-id's). Bij het
# roteren wordt dat uit de KOPIE in backup/ gehaald (de live bestanden blijven zoals ze zijn): zie neutraliseer().
# De hash-check vergelijkt dus met de live versie NA neutralisatie, plus de drie invoegingen (noindex, titel, rode balk).
import subprocess, io, os, tarfile, hashlib, re, sys, fnmatch
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')).replace('\\', '/')
PATRONEN = ['v2.html', 'mobiel.html', 'uren.html', 'index.html', 'calc-engine.js', 'mt-*.js', 'track.js', 'sw.js', 'manifest-mobiel.json', 'icons/*', 'vendor/*']
HTML = {'v2.html', 'mobiel.html', 'uren.html', 'index.html'}
TEKST = HTML | {'sw.js', 'manifest-mobiel.json', 'calc-engine.js', 'track.js'}
NEUTRAAL_KLANTEN = "let KLANTEN=[{code:'INT',naam:'Intern — Mortise & Tenon',mb_contact_id:null}];"
NEUTRAAL_ALIAS = "const KLANT_REGISTRY={ 'intern':'INT','mortise':'INT' };"
# Vaste voorbeeldnamen in placeholders en demodata (geen registry, wel klant-/locatienamen).
VERVANG = [('CompaNanny', 'Voorbeeldklant'), ('Styles Concepts', 'Voorbeeldklant'), ('Bajeskwartier', 'Testlocatie'), ('BAJES', 'LOC')]

def is_tekst(naam):
    return naam in TEKST or naam.startswith('mt-') and naam.endswith('.js')

def neutraliseer(naam, tekst):
    """Geeft (nieuwe tekst, aantal ingrepen). Idempotent. Alleen op tekstbestanden."""
    if not is_tekst(naam): return tekst, 0
    n = 0
    # 1. de harde klantenregistry:  let KLANTEN=[ ... ];   (alleen als er meer dan het neutrale item in staat)
    def reg(m):
        nonlocal n
        if m.group(0).replace(' ', '') == NEUTRAAL_KLANTEN.replace(' ', ''): return m.group(0)
        n += 1; return NEUTRAAL_KLANTEN
    tekst = re.sub(r"let KLANTEN=\[.*?\n?\];", reg, tekst, count=1, flags=re.S) if re.search(r"let KLANTEN=\[\s*\n\s*\{", tekst) else tekst
    # 2. de naam->code tabel:  const KLANT_REGISTRY={ ... };
    def alias(m):
        nonlocal n
        if m.group(0).replace(' ', '').replace('\n', '') == NEUTRAAL_ALIAS.replace(' ', ''): return m.group(0)
        n += 1; return NEUTRAAL_ALIAS
    tekst = re.sub(r"const KLANT_REGISTRY=\{.*?\};", alias, tekst, count=1, flags=re.S)
    # 3. voorbeeldnamen
    for a, b in VERVANG:
        k = tekst.count(a)
        if k: tekst = tekst.replace(a, b); n += k
    return tekst, n

def wacht_op_resten():
    """Scant backup/ met de lokale klanten.json als woordenlijst (namen, aliassen, MB-id's). Geeft {bestand: [termen]}."""
    pad = os.path.join(REPO, 'data', 'klanten.json')
    if not os.path.exists(pad): return None
    import json
    d = json.load(io.open(pad, encoding='utf-8-sig'))
    termen = set()
    for k in d.get('klanten', []):
        if k.get('code') == 'INT': continue
        for v in [k.get('naam'), k.get('mb_contact_id')] + [l.get('naam') for l in k.get('locaties', [])] + [l.get('mb_contact_id') for l in k.get('locaties', [])]:
            if isinstance(v, str) and len(v.strip()) >= 6: termen.add(v.strip())
    res = {}
    for root, _, files in os.walk(os.path.join(REPO, 'backup')):
        for f in files:
            if not is_tekst(f): continue
            t = io.open(os.path.join(root, f), encoding='utf-8', errors='replace').read().lower()
            hit = sorted(x for x in termen if x.lower() in t)
            if hit: res[os.path.relpath(os.path.join(root, f), os.path.join(REPO, 'backup')).replace('\\', '/')] = hit
    return res

def saneer_bestaand():
    n_tot = 0
    for root, _, files in os.walk(os.path.join(REPO, 'backup')):
        for f in files:
            if not is_tekst(f): continue
            doel = os.path.join(root, f)
            t = io.open(doel, encoding='utf-8', newline='').read()
            t2, n = neutraliseer(f, t)
            if n: io.open(doel, 'w', encoding='utf-8', newline='').write(t2); n_tot += n; print('geneutraliseerd:', f, n)
    print('ingrepen totaal:', n_tot)

def roteer(VERSIE, DATUM):
    tar = subprocess.run(['git', '-C', REPO, 'archive', '--format=tar', 'origin/main'], capture_output=True, check=True).stdout
    tf = tarfile.open(fileobj=io.BytesIO(tar))
    leden = [m for m in tf.getmembers() if m.isfile() and any(fnmatch.fnmatch(m.name, p) for p in PATRONEN) and '/' not in m.name.replace('icons/', '', 1).replace('vendor/', '', 1).replace('data/', '', 1) or (m.isfile() and (m.name.startswith('icons/') or m.name.startswith('vendor/')))]
    leden = [m for m in leden if not m.name.startswith('backup/')]
    oud_balk = {}
    for h in HTML:
        t = io.open(os.path.join(REPO, 'backup', h), encoding='utf-8').read()
        m = re.search(r'<div id="mt-backup-balk".*?</div>', t); oud_balk[h] = m.group(0)
    rapport = []; ingrepen = {}
    for m in leden:
        data = tf.extractfile(m).read()
        doel = os.path.join(REPO, 'backup', m.name)
        os.makedirs(os.path.dirname(doel), exist_ok=True)
        if m.name in HTML:
            live = data.decode('utf-8')
            t, n = neutraliseer(m.name, live)           # verwacht: live minus klantregistry
            if n: ingrepen[m.name] = n
            verwacht = t
            nl = '\r\n' if '\r\n' in t else '\n'
            assert t.count('<head>') >= 1 and '<title>' in t
            t2 = t.replace('<head>' + nl, '<head>' + nl + '<meta name="robots" content="noindex,nofollow">' + nl, 1)
            t2 = re.sub(r'<title>(.*?)</title>', lambda x: f'<title>BACKUP {VERSIE} — {x.group(1)}</title>', t2, count=1)
            balk = re.sub(r'\(v[0-9.]+, [^)]*\)', f'({VERSIE}, {DATUM})', oud_balk[m.name])
            mb = re.search(r'<body[^>]*>' + re.escape(nl), t2); assert mb, m.name
            t2 = t2[:mb.end()] + balk + nl + t2[mb.end():]
            io.open(doel, 'w', encoding='utf-8', newline='').write(t2)
            # controle: zonder de drie invoegingen is het exact de (geneutraliseerde) live-versie
            terug = io.open(doel, encoding='utf-8', newline='').read()
            terug = terug.replace('<meta name="robots" content="noindex,nofollow">' + nl, '', 1).replace(balk + nl, '', 1)
            terug = re.sub(r'<title>BACKUP ' + re.escape(VERSIE) + r' — (.*?)</title>', r'<title>\1</title>', terug, count=1)
            ok = hashlib.sha256(terug.encode('utf-8')).hexdigest() == hashlib.sha256(verwacht.encode('utf-8')).hexdigest()
        elif is_tekst(m.name):
            t, n = neutraliseer(m.name, data.decode('utf-8'))
            if n: ingrepen[m.name] = n
            open(doel, 'wb').write(t.encode('utf-8'))
            ok = hashlib.sha256(open(doel, 'rb').read()).hexdigest() == hashlib.sha256(t.encode('utf-8')).hexdigest()
        else:
            open(doel, 'wb').write(data)
            ok = hashlib.sha256(open(doel, 'rb').read()).hexdigest() == hashlib.sha256(data).hexdigest()
        rapport.append((m.name, ok))
    # bestanden in backup/ die live niet meer bestaan (binnen de patronen) -> melden, niet stil laten staan
    namen = {m.name for m in leden}
    weg = []
    for root, _, files in os.walk(os.path.join(REPO, 'backup')):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), os.path.join(REPO, 'backup')).replace('\\', '/')
            if rel not in namen: weg.append(rel)
    fout = [n for n, ok in rapport if not ok]
    print('bestanden', len(rapport), 'hash-fout', fout, 'extra in backup (niet live):', weg)
    print('geneutraliseerd (live bevat nog klantgegevens):', ingrepen or 'niets')

if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--saneer':
        saneer_bestaand()
    elif len(sys.argv) == 3:
        roteer(sys.argv[1], sys.argv[2])
    else:
        sys.exit(__doc__)
    r = wacht_op_resten()
    if r is None: print('resten-scan overgeslagen (geen lokale data/klanten.json)')
    else: print('resten in backup/ (lokale klantenlijst als woordenlijst):', r or 'geen')
