# backup/ roteren naar de huidige live-versie (origin/main), met rode balk + noindex; hash-check per bestand.
#
#   python tools/backup-roteer.py <versie> <datum>      roteren (zie RELEASE.md, stap 3)
#   python tools/backup-roteer.py --saneer              alleen de bestaande backup/ neutraliseren (zonder te roteren)
#   (beide met --zonder-woordenlijst om te roteren zonder lokale data/klanten.json; dan is er GEEN eindscan: alleen bewust gebruiken)
#
# De repo is PUBLIC. De live versie kan nog een harde klantenregistry bevatten (namen + Moneybird-contact-id's). Bij het
# roteren wordt dat uit de KOPIE in backup/ gehaald (de live bestanden blijven zoals ze zijn): zie neutraliseer().
# De hash-check vergelijkt dus met de live versie NA neutralisatie, plus de drie invoegingen (noindex, titel, rode balk).
#
# FAIL CLOSED: alles wordt eerst in het geheugen opgebouwd en gecontroleerd. Pas als de hash-check klopt én de eindscan (lokale
# klantenlijst als woordenlijst: namen, aliassen, locaties, Moneybird-id's) geen enkele rest vindt, wordt er in backup/ geschreven.
# Anders: melding + exitcode ≠ 0 en backup/ blijft precies zoals hij was. (0 = gelukt, 1 = hash-fout, 2 = rest gevonden,
# 3 = geen woordenlijst, 4 = onbekende fout.)
import subprocess, io, os, tarfile, hashlib, re, sys, fnmatch, functools, json
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')).replace('\\', '/')
PATRONEN = ['v2.html', 'mobiel.html', 'uren.html', 'index.html', 'calc-engine.js', 'mt-*.js', 'track.js', 'sw.js', 'manifest-mobiel.json', 'icons/*', 'vendor/*']
HTML = {'v2.html', 'mobiel.html', 'uren.html', 'index.html'}
TEKST = HTML | {'sw.js', 'manifest-mobiel.json', 'calc-engine.js', 'track.js'}
NEUTRAAL_KLANTEN = "KLANTEN=[{code:'INT',naam:'Intern — Mortise & Tenon',mb_contact_id:null}];"
NEUTRAAL_ALIAS = "KLANT_REGISTRY={ 'intern':'INT','mortise':'INT' };"

class Rest(Exception): pass

@functools.lru_cache(maxsize=1)
def klantenlijst():
    """De LOKALE data/klanten.json (niet in de repo) → lijst klanten, of None als hij ontbreekt."""
    pad = os.path.join(REPO, 'data', 'klanten.json')
    if not os.path.exists(pad): return None
    return [k for k in json.load(io.open(pad, encoding='utf-8-sig')).get('klanten', []) if k.get('code') != 'INT']

@functools.lru_cache(maxsize=1)
def voorbeeldnamen():
    """Namen/aliassen (-> 'Voorbeeldklant') en locaties (-> 'Testlocatie') uit de LOKALE klantenlijst; de repo zelf bevat dus geen
    klantnamen. Zonder lijst: leeg (de structurele blokken worden dan nog wel geneutraliseerd)."""
    klant, loc = set(), set()
    for k in klantenlijst() or []:
        for v in [k.get('naam')] + list(k.get('aliassen') or []):
            if isinstance(v, str) and len(v.strip()) >= 6 and v.strip().lower() != 'styles':
                v = v.strip(); klant.add(v); klant.add(re.sub(r'\s*B\.?V\.?$', '', v, flags=re.I).strip())
        for l in k.get('locaties') or []:
            for v in (l.get('naam'), l.get('code')):
                if isinstance(v, str) and len(v.strip()) >= 4: loc.add(v.strip())
    paren = [(x, 'Voorbeeldklant') for x in klant if len(x) >= 6] + [(x, 'Testlocatie') for x in loc]
    return sorted(paren, key=lambda p: -len(p[0]))

@functools.lru_cache(maxsize=1)
def zoektermen():
    """Alles wat NOOIT in backup/ mag staan: namen, aliassen, locaties en Moneybird-id's (klant én locatie)."""
    termen = set()
    for k in klantenlijst() or []:
        for v in [k.get('naam'), k.get('mb_contact_id')] + list(k.get('aliassen') or []) + [l.get('naam') for l in k.get('locaties') or []] + [l.get('mb_contact_id') for l in k.get('locaties') or []]:
            if isinstance(v, str) and len(v.strip()) >= 6 and v.strip().lower() != 'styles': termen.add(v.strip().lower())
    return sorted(termen)

def is_tekst(naam):
    b = naam.replace('\\', '/').split('/')[-1]
    return b in TEKST or (b.startswith('mt-') and b.endswith('.js'))

def vind_blok(tekst, kop):
    """Zoekt `<let|const|var> <kop> = [ … ] ;` of `{ … }` — onafhankelijk van witruimte en opmaak (ook op één regel), met
    haakjes-tellen dat tekenreeksen, template-strings en commentaar overslaat. → (start, einde) of None."""
    m = re.search(r'\b(let|const|var)\s+' + kop + r'\s*=\s*([\[{])', tekst)
    if not m: return None
    open_c = m.group(2); sluit_c = ']' if open_c == '[' else '}'
    i, diepte, n = m.end() - 1, 0, len(tekst)
    while i < n:
        c = tekst[i]
        if c in '\'"`':
            q = c; i += 1
            while i < n and tekst[i] != q:
                i += 2 if tekst[i] == '\\' else 1
        elif c == '/' and tekst[i:i + 2] == '//':
            i = tekst.find('\n', i); i = n if i < 0 else i
        elif c == '/' and tekst[i:i + 2] == '/*':
            i = tekst.find('*/', i + 2); i = n if i < 0 else i + 1
        elif c == open_c: diepte += 1
        elif c == sluit_c:
            diepte -= 1
            if diepte == 0:
                j = i + 1
                while j < n and tekst[j] in ' \t\r\n': j += 1
                if j < n and tekst[j] == ';': j += 1
                return m.start(), j, m.group(1)
        i += 1
    raise Rest(f'onafgesloten blok bij {kop}: niet te neutraliseren')

def _plat(t): return re.sub(r'\s+', '', t)

def neutraliseer(naam, tekst):
    """Geeft (nieuwe tekst, aantal ingrepen). Idempotent. Alleen op tekstbestanden."""
    if not is_tekst(naam): return tekst, 0
    n = 0
    for kop, neutraal in (('KLANTEN', NEUTRAAL_KLANTEN), ('KLANT_REGISTRY', NEUTRAAL_ALIAS)):
        b = vind_blok(tekst, kop)
        if not b: continue
        start, einde, kw = b
        nieuw = kw + ' ' + neutraal
        if _plat(tekst[start:einde]) == _plat(nieuw): continue
        tekst = tekst[:start] + nieuw + tekst[einde:]; n += 1
    # voorbeeldnamen (uit de lokale klantenlijst); namen hoofdletterongevoelig
    for a, b in voorbeeldnamen():
        tekst, k = re.subn(re.escape(a), b, tekst, flags=re.I)
        n += k
    return tekst, n

def resten(inhoud):
    """inhoud = {relatief pad: tekst}. → {pad: [gevonden termen]} (alleen tekstbestanden)."""
    uit = {}
    for pad, t in inhoud.items():
        if not is_tekst(pad): continue
        low = t.lower(); hit = [x for x in zoektermen() if x in low]
        if hit: uit[pad] = hit
    return uit

def lees_backup():
    uit = {}
    for root, _, files in os.walk(os.path.join(REPO, 'backup')):
        for f in files:
            if is_tekst(f): uit[os.path.relpath(os.path.join(root, f), os.path.join(REPO, 'backup')).replace('\\', '/')] = io.open(os.path.join(root, f), encoding='utf-8', errors='replace', newline='').read()
    return uit

def controleer(gepland, zonder_lijst):
    """gepland = {relatief pad: bytes}. Fail closed: geen woordenlijst of een rest → uitzondering."""
    if klantenlijst() is None or not zoektermen():
        if not zonder_lijst:
            print('GEEN lokale data/klanten.json (of leeg): zonder woordenlijst kan ik niet controleren of er nog klantgegevens in staan. Er is NIETS geschreven.', file=sys.stderr)
            sys.exit(3)
        print('WAARSCHUWING: geen woordenlijst, geen eindscan (--zonder-woordenlijst).')
        return
    r = resten({p: b.decode('utf-8', errors='replace') for p, b in gepland.items() if is_tekst(p)})
    if r:
        print('REST GEVONDEN in de neutraliseerde back-up (geen namen getoond, alleen aantallen):', file=sys.stderr)
        for p, h in sorted(r.items()): print(f'  {p}: {len(h)} term(en)', file=sys.stderr)
        print('Er is NIETS geschreven; backup/ is ongewijzigd. Pas tools/backup-roteer.py aan (neutraliseer()) of de live versie.', file=sys.stderr)
        sys.exit(2)

def schrijf(gepland):
    for pad, data in gepland.items():
        doel = os.path.join(REPO, 'backup', pad); os.makedirs(os.path.dirname(doel), exist_ok=True)
        open(doel, 'wb').write(data)

def saneer_bestaand(zonder_lijst):
    gepland, n_tot = {}, 0
    for pad, t in lees_backup().items():
        t2, n = neutraliseer(pad, t)
        if n: print('geneutraliseerd:', pad, n); n_tot += n
        gepland[pad] = t2.encode('utf-8')
    controleer(gepland, zonder_lijst)
    schrijf({p: b for p, b in gepland.items() if lees_backup().get(p) is not None and b.decode('utf-8') != lees_backup()[p]})
    print('ingrepen totaal:', n_tot)

def roteer(VERSIE, DATUM, zonder_lijst):
    tar = subprocess.run(['git', '-C', REPO, 'archive', '--format=tar', 'origin/main'], capture_output=True, check=True).stdout
    tf = tarfile.open(fileobj=io.BytesIO(tar))
    leden = [m for m in tf.getmembers() if m.isfile() and any(fnmatch.fnmatch(m.name, p) for p in PATRONEN) and '/' not in m.name.replace('icons/', '', 1).replace('vendor/', '', 1).replace('data/', '', 1) or (m.isfile() and (m.name.startswith('icons/') or m.name.startswith('vendor/')))]
    leden = [m for m in leden if not m.name.startswith('backup/')]
    oud_balk = {}
    for h in HTML:
        t = io.open(os.path.join(REPO, 'backup', h), encoding='utf-8').read()
        m = re.search(r'<div id="mt-backup-balk".*?</div>', t); oud_balk[h] = m.group(0)
    rapport, ingrepen, gepland = [], {}, {}
    for m in leden:
        data = tf.extractfile(m).read()
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
            gepland[m.name] = t2.encode('utf-8')
            # controle: zonder de drie invoegingen is het exact de (geneutraliseerde) live-versie
            terug = t2.replace('<meta name="robots" content="noindex,nofollow">' + nl, '', 1).replace(balk + nl, '', 1)
            terug = re.sub(r'<title>BACKUP ' + re.escape(VERSIE) + r' — (.*?)</title>', r'<title>\1</title>', terug, count=1)
            ok = hashlib.sha256(terug.encode('utf-8')).hexdigest() == hashlib.sha256(verwacht.encode('utf-8')).hexdigest()
        elif is_tekst(m.name):
            t, n = neutraliseer(m.name, data.decode('utf-8'))
            if n: ingrepen[m.name] = n
            gepland[m.name] = t.encode('utf-8')
            ok = hashlib.sha256(gepland[m.name]).hexdigest() == hashlib.sha256(t.encode('utf-8')).hexdigest()
        else:
            gepland[m.name] = data
            ok = hashlib.sha256(gepland[m.name]).hexdigest() == hashlib.sha256(data).hexdigest()
        rapport.append((m.name, ok))
    fout = [n for n, ok in rapport if not ok]
    if fout:
        print('HASH-FOUT in', fout, '— er is NIETS geschreven.', file=sys.stderr); sys.exit(1)
    controleer(gepland, zonder_lijst)   # fail closed: rest of geen woordenlijst → exit, niets geschreven
    schrijf(gepland)
    # bestanden in backup/ die live niet meer bestaan (binnen de patronen) -> melden, niet stil laten staan
    namen = {m.name for m in leden}; weg = []
    for root, _, files in os.walk(os.path.join(REPO, 'backup')):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), os.path.join(REPO, 'backup')).replace('\\', '/')
            if rel not in namen: weg.append(rel)
    print('bestanden', len(rapport), 'hash-fout', fout, 'extra in backup (niet live):', weg)
    print('geneutraliseerd (live bevat nog klantgegevens):', ingrepen or 'niets')

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--zonder-woordenlijst']; zonder = '--zonder-woordenlijst' in sys.argv
    try:
        if args == ['--saneer']: saneer_bestaand(zonder)
        elif len(args) == 2 and not args[0].startswith('-'): roteer(args[0], args[1], zonder)
        else: sys.exit(__doc__)
        if klantenlijst() is not None and zoektermen():
            r = resten(lees_backup())
            if r: print('NA HET SCHRIJVEN nog resten in backup/:', {p: len(h) for p, h in r.items()}, file=sys.stderr); sys.exit(2)
            print('resten in backup/ (lokale klantenlijst als woordenlijst): geen')
        else: print('resten-scan overgeslagen (geen lokale data/klanten.json)')
    except SystemExit: raise
    except Rest as e: print('FOUT:', e, '— er is NIETS geschreven.', file=sys.stderr); sys.exit(2)
    except Exception as e: print('ONVERWACHTE FOUT:', repr(e), '— backup/ kan onvolledig zijn; controleer met git status/diff.', file=sys.stderr); sys.exit(4)
