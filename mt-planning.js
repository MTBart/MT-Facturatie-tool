/* ============================================================================
 * mt-planning.js — planning-kern (P0/P1), gedeeld door v2.html en mobiel.html
 * ----------------------------------------------------------------------------
 * Pure functies, geen DOM en geen opslag: zo zijn ze te testen zonder browser.
 *
 *  • Eenheden: ÉÉN tijdseenheid = minuten. Toggl-entries staan in seconden (`duur`), planblokken
 *    in minuten (`duurMin`), taakramingen in uren (`duur_uur`). Alles gaat via de helpers hieronder.
 *  • Persoonsleutel: ÉÉN sleutel = het team-slug ('bart'). Planblokken hebben slug of e-mail,
 *    entries een naam of "User 123". `persoonSlug` brengt ze op dezelfde noemer.
 *  • Tarief: ÉÉN bron = Instellingen ▸ Uurtarieven (`mt_uurtarieven`); de standaard staat hier.
 *  • Taken per project (uitbreiding van het bestaande mt_project_taken, geen tweede model):
 *    activiteit, budget in minuten, toegewezen, stempel per veld (`_vs`), tombstone (`_vervallen`).
 *  • Meter: budget / gepland / geklokt (gekoppeld aan een taak) / geklokt (ongekoppeld) / resterend.
 * ========================================================================== */
(function (root) {
  'use strict';
  const P = {};

  // ── Eenheden: minuten ────────────────────────────────────────────────────────────────────────────
  const getal = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  P.secNaarMin = s => Math.round(getal(s) / 60);
  P.urenNaarMin = u => Math.round(getal(u) * 60);
  P.minNaarUren = m => Math.round(getal(m) / 60 * 100) / 100;
  // "12,5 u" (één decimaal, komma)
  P.fmtUur = m => (Math.round(getal(m) / 60 * 10) / 10).toString().replace('.', ',') + ' u';
  // Duur van een geklokte entry in minuten (`duur` in seconden; `duration` is de ruwe Toggl-naam).
  P.entryMin = e => {
    if (!e) return 0;
    const s = e.duur != null ? e.duur : e.duration;
    const n = getal(s);
    return n > 0 ? Math.round(n / 60) : 0;
  };

  // ── Persoonsleutel: team-slug ────────────────────────────────────────────────────────────────────
  // team = [{slug, email, naam, label}]. Slug, e-mail, naam of label (hoofdletterongevoelig) → slug.
  // Zonder team (mobiel): een e-mailadres geeft het deel voor de @. Onbekend → ''.
  P.persoonSlug = function (x, team) {
    const s = String(x == null ? '' : x).trim().toLowerCase();
    if (!s) return '';
    for (const m of (team || [])) {
      if (!m) continue;
      const kand = [m.slug, m.email, m.naam, m.label].filter(Boolean).map(v => String(v).trim().toLowerCase());
      if (kand.includes(s)) return String(m.slug || '').toLowerCase();
    }
    if (!(team && team.length) && s.includes('@')) return s.split('@')[0];
    return (team && team.length) ? '' : s;
  };
  P.zelfdePersoon = (a, b, team) => {
    const sa = P.persoonSlug(a, team), sb = P.persoonSlug(b, team);
    if (sa && sb) return sa === sb;
    return String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase() && !!String(a || '').trim();
  };

  // ── Geklokte entries filteren zoals de Agenda (lege set = alles; AG_NONE = niets) ─────────────────
  // codes/pers: Set of array; van/tot: ymd (inclusief), op de startdatum van de entry.
  P.AG_NONE = '__none__';
  P.entriesFilter = function (entries, { codes = null, pers = null, van = null, tot = null, team = null } = {}) {
    const set = x => x instanceof Set ? x : (Array.isArray(x) ? new Set(x) : null);
    const c = set(codes), p = set(pers);
    if ((c && c.has(P.AG_NONE)) || (p && p.has(P.AG_NONE))) return [];
    const persSlugs = p && p.size ? new Set([...p].map(v => P.persoonSlug(v, team) || String(v).trim().toLowerCase())) : null;
    return (entries || []).filter(e => {
      if (!e) return false;
      const dag = String(e.datum || e.start || '').slice(0, 10);
      if (van && dag < van) return false;
      if (tot && dag > tot) return false;
      if (c && c.size && !c.has(e.project_code)) return false;
      if (persSlugs) {
        const sl = P.persoonSlug(e.teamlid, team) || String(e.teamlid == null ? '' : e.teamlid).trim().toLowerCase();
        if (!persSlugs.has(sl)) return false;
      }
      return true;
    });
  };

  // ── Planblokken als agenda-blokken voor één persoon en één week (mobiel) ───────────────────────────
  // blokken: planblokken {id, persoon, project_code, taak, datum, start, duurMin, status, _vervallen}.
  // van: ymd van de maandag. Geeft {id, datum, dagIdx (0 = ma … 6 = zo), start, end, name, proj, voorstel}.
  // Een open voorstel telt mee als `voorstel:true` (de aanroeper bepaalt of hij het toont); een afgewezen of
  // verwijderd blok nooit. Blokken zonder duur worden overgeslagen; zonder starttijd begint het blok om 08:00.
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const dagNr = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  P.agendaBlokken = function (blokken, { van, mijn, team = null } = {}) {
    const uit = [], v0 = van ? dagNr(van) : null;
    (blokken || []).forEach(b => {
      if (!b || b._vervallen || !b.datum || !P.zelfdePersoon(b.persoon, mijn, team)) return;
      if (b.voorstel && b.voorstel.afgewezen) return;
      const idx = v0 == null ? 0 : dagNr(b.datum) - v0;
      if (idx < 0 || idx > 6) return;
      const dur = Math.round(getal(b.duurMin)); if (dur <= 0) return;
      const m = /^(\d{1,2}):(\d{2})/.exec(String(b.start || ''));
      const s = m ? Math.min(23 * 60 + 59, parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : 8 * 60;
      uit.push({ id: String(b.id), datum: b.datum, dagIdx: idx, start: hhmm(s), end: hhmm(Math.min(24 * 60 - 1, s + dur)),
        name: b.taak || b.project_code || 'Planblok', proj: b.project_code || '', voorstel: b.status === 'voorstel' });
    });
    return uit;
  };

  // ── Uurtarief: één bron ──────────────────────────────────────────────────────────────────────────
  // Instellingen ▸ Uurtarieven (`mt_uurtarieven`: {bart: 55, …, _std: 55}). Ontbreekt de standaard daar,
  // dan geldt deze waarde. Ook de calculatie (nieuwe uurregels) en de nacalculatie gebruiken deze bron.
  P.UURTARIEF_STD = 90;   // besluit Bart 13-10: standaard €90 per uur
  P.uurtariefStd = cfg => {
    const v = cfg && cfg._std;
    return (v != null && v !== '' && isFinite(Number(v))) ? Number(v) : P.UURTARIEF_STD;
  };
  P.uurtarief = function (cfg, naam) {
    const t = cfg || {}, k = String(naam || '').toLowerCase().trim(), k1 = k.split(/[ @.]/)[0];   // "bart witte" / "bart@…" → "bart"
    const v = t[k] != null ? t[k] : (t[k1] != null ? t[k1] : null);
    return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : P.uurtariefStd(t);
  };

  // ══ P1: taken per project, activiteiten, meter ═══════════════════════════════════════════════════════
  // ── Activiteitencatalogus (stabiele sleutels; dezelfde lijst geldt later voor uursoorten en tarieven) ──
  // `soort` is de rollup voor de meter (besluit Bart 13-10): tekenwerk, werkvoorbereiding en kantoor zijn KANTOORUREN;
  // werkplaats, spuiten en montage zijn werkplaatsuren. Reizen blijft een eigen activiteit en telt voorlopig bij de Werkplaatsuren (aanname).
  P.ACTIVITEITEN = [
    { k: 'tekenwerk', l: 'Tekenwerk', soort: 'kantoor' },
    { k: 'werkvoorbereiding', l: 'Werkvoorbereiding', soort: 'kantoor' },
    { k: 'werkplaats', l: 'Werkplaats', soort: 'wp' },
    { k: 'spuiten', l: 'Spuiten', soort: 'wp' },
    { k: 'montage', l: 'Montage', soort: 'wp' },
    { k: 'reizen', l: 'Reizen', soort: 'wp' },
    { k: 'kantoor', l: 'Kantoor', soort: 'kantoor' }];
  // 'overig' = nog niet ingedeeld (taken zonder activiteit); wordt in het scherm niet als soort getoond.
  P.SOORTEN = { kantoor: 'Kantooruren', wp: 'Werkplaatsuren', overig: 'Niet ingedeeld' };
  P.SOORT_TOELICHTING = 'Kantooruren: tekenwerk, werkvoorbereiding, kantoor. Werkplaatsuren: werkplaats, spuiten, montage en (aanname, voorlopig) reizen.';
  P.activiteit = k => P.ACTIVITEITEN.find(a => a.k === k) || null;
  // De uursoorten van de calculatie (Instellingen/Calculatie) → activiteit.
  const UURSOORT_ACT = { calculatie: 'kantoor', ontwerpen: 'tekenwerk', werkvoorbereiding: 'werkvoorbereiding', productie: 'werkplaats', afwerking: 'spuiten', transport: 'reizen', montage: 'montage' };
  // Voorstel voor een activiteit op grond van de naam (alleen een suggestie bij het aanmaken; de mens kan het wijzigen).
  const SLEUTELWOORDEN = [['reizen', /\b(transport|reis|reizen|rijden|levering|leveren|ophalen)\b/i], ['montage', /\b(montage|monteren|plaatsen|installeren|opleveren|oplevering)\b/i],
    ['spuiten', /\b(spuit|spuiten|lakken|lak|verf|schilder|afwerk|olie|oliën|beits)/i], ['werkvoorbereiding', /\b(wvb|werkvoorbereiding|stuklijst|nesten|nesting|cnc-?programma|productietekening)/i],
    ['tekenwerk', /\b(teken|tekenen|tekening|tekeningen|ontwerp|ontwerpen|schets|3d|render|opname)\b/i], ['werkplaats', /\b(zagen|cnc|frezen|kantenband|assemblage|samenbouwen|bankwerk|productie|werkplaats|slijpen|monteren in de werkplaats)\b/i],
    ['kantoor', /\b(offerte|calculatie|bestel|bestellen|inkoop|administratie|factuur|overleg|mail|afspraak|plannen|planning)\b/i]];
  P.activiteitUitNaam = naam => { const s = String(naam || ''); for (const [k, re] of SLEUTELWOORDEN) if (re.test(s)) return k; return ''; };
  P.activiteitUitUursoort = oms => { const s = String(oms || '').toLowerCase().trim(); return UURSOORT_ACT[s] || P.activiteitUitNaam(s); };

  // ── Stempelmodel: velden met een eigen stempel (zoals de projectvelden van L1) ───────────────────────────
  // Eén motor voor drie soorten records: taken, afhankelijkheden en bestelregels. Per record `_vs[veld]`, `_gewijzigd`
  // (laatste wijziging), `_veldconflict[veld]` en een tombstone `_vervallen`.
  // Stempel per veld: {t (ms), dev (apparaat), rev (teller per veld), door, basis (t van de stand waarop de wijziging voortbouwde)}.
  // Totale volgorde: t, dan dev, dan rev. Identieke stempels met verschillende waarden zijn altijd een conflict.
  // Opslag taken = mt_project_taken_v2 { projectcode: [taak…], __migratie }, een uitbreiding van het oude mt_project_taken; elke taak: id, project_id, naam, omschrijving,
  // duur_uur (de raming; budget in minuten = duur_uur × 60), activiteit, status, toegewezen (team-slug, optioneel),
  // prioriteit, afhankelijk_van (oud, zie de afhankelijkheden hieronder), tg_task_id (optionele Toggl-koppeling), tg_sync
  // (koppeltabel; een eigen veld met een eigen stempel dat bij precies één tg_task_id hoort, external_id; wijzigt tg_task_id, dan vervalt
  // tg_sync), planvelden (start, eind, duur_dagen, soort 'taak'|'mijlpaal', fase, sleutel), _vs, _veldconflict, _vervallen.
  P.TAAK_VELDEN = ['naam', 'omschrijving', 'duur_uur', 'activiteit', 'status', 'toegewezen', 'prioriteit', 'afhankelijk_van', 'tg_task_id', 'tg_sync',
    'start', 'eind', 'duur_dagen', 'soort', 'fase', 'sleutel'];
  const kopie = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const norm = v => v === undefined ? null : v;
  const gelijk = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  const leeg = v => v === undefined || v === null || v === '';
  const tijdVan = s => Number(s && s.t) || 0;
  const revVan = s => Number(s && s.rev) || 0;
  const devVan = s => String((s && s.dev) || '');
  // <0: a is ouder dan b; 0: identiek (of beide zonder stempel)
  const volgorde = (a, b) => (tijdVan(a) - tijdVan(b)) || (devVan(a) < devVan(b) ? -1 : devVan(a) > devVan(b) ? 1 : 0) || (revVan(a) - revVan(b));
  P.taakBudgetMin = t => (t && t.budget_min != null && isFinite(Number(t.budget_min)) && Number(t.budget_min) > 0) ? Math.round(Number(t.budget_min)) : P.urenNaarMin(t && t.duur_uur);
  // `_gewijzigd` is bij taken en afhankelijkheden een getal (ms) en bij bestelregels een ISO-tekst (oude opslag): één lezer.
  const recTijd = x => {
    const v = x && x._gewijzigd;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'string' && v) { if (/^\d+$/.test(v)) return Number(v); const t = Date.parse(v); return isNaN(t) ? 0 : t; }
    return 0;
  };
  const maxStempel = t => Math.max(recTijd(t), ...Object.values((t && t._vs) || {}).map(tijdVan));
  const zetTijd = (iso, ms) => iso ? new Date(ms).toISOString() : ms;
  // zonder tg_task_id is alleen een mislukte poging (external_id leeg) een geldige koppeltabel
  const syncGeldig = x => !x.tg_sync || ((x.tg_task_id == null || x.tg_task_id === '') ? String(x.tg_sync.external_id || '') === '' : String(x.tg_sync.external_id) === String(x.tg_task_id));

  // Nieuwe stand van één project wegschrijven: oud = ruwe opslag (met tombstones), nieuw = de actieve records zoals de
  // bewerkers ze nu hebben. Gewijzigde velden krijgen een stempel; verdwenen records een tombstone. taak: ook de regels van de Toggl-koppeltabel.
  function stempelMet(velden, oud, nieuw, { nu = Date.now(), door = '', dev = '', projectId = '' } = {}, taak = false) {
    const per = new Map(); (oud || []).forEach(o => { if (o && o.id) per.set(o.id, o); });
    const gezien = new Set(), uit = [];
    (nieuw || []).forEach(t => {
      if (!t || typeof t !== 'object') return;
      const x = kopie(t), o = x.id ? per.get(x.id) : null;
      if (x.id) gezien.add(x.id);
      if (projectId && !x.project_id) x.project_id = projectId;
      if (o && o.project_id && !x.project_id) x.project_id = o.project_id;
      if (taak) {
        // een koppeltabel van een andere Toggl-taak is waardeloos: nieuwe tg_task_id → oude tg_sync vervalt
        if (o && !gelijk(x.tg_task_id, o.tg_task_id) && gelijk(x.tg_sync, o.tg_sync)) delete x.tg_sync;
        if (!syncGeldig(x)) delete x.tg_sync;
      }
      const vs = Object.assign({}, kopie(o && o._vs) || {}, kopie(x._vs) || {});
      const ovs = (o && o._vs) || {};
      velden.forEach(f => {
        const veranderd = !o || !gelijk(x[f], o[f]);
        const bewust = x._vs && x._vs[f] && JSON.stringify(x._vs[f]) !== JSON.stringify(ovs[f]);   // stempel zelf gezet (conflictkeuze)
        if (!veranderd || bewust) return;
        if (!o && x[f] === undefined) return;
        const vorig = tijdVan(ovs[f]);
        vs[f] = { t: Math.max(nu, vorig + 1), dev, rev: revVan(ovs[f]) + 1, door, basis: vorig };
      });
      if (Object.keys(vs).length) x._vs = vs;
      delete x._vervallen;
      const m = maxStempel(x); if (m) x._gewijzigd = m; else if (o && o._gewijzigd) x._gewijzigd = o._gewijzigd;
      if (o && o._vervallen) x._gewijzigd = Math.max(nu, recTijd(o) + 1);   // teruggezet na verwijderen
      uit.push(x);
    });
    per.forEach(o => {   // verdwenen = tombstone (niet fysiek wissen: een oude kopie zet het record anders terug)
      if (gezien.has(o.id)) return;
      if (o._vervallen) { uit.push(o); return; }
      const g = Object.assign({}, kopie(o), { _vervallen: true, _gewijzigd: Math.max(nu, recTijd(o) + 1) });
      g._ts = { t: g._gewijzigd, dev, rev: revVan(o._ts) + 1, door };
      if (door) g._door = door;
      uit.push(g);
    });
    return uit;
  }
  P.takenStempel = (oud, nieuw, opts) => stempelMet(P.TAAK_VELDEN, oud, nieuw, opts, true);
  P.takenActief = lijst => (Array.isArray(lijst) ? lijst : []).filter(t => t && typeof t === 'object' && !t._vervallen);

  // ── Overstap naar mt_project_taken_v2 ─────────────────────────────────────────────────────────────────
  // De nieuwe app leest en schrijft alleen mt_project_taken_v2; het oude bestand mt_project_taken blijft van oude app-versies en wordt door
  // de nieuwe app nooit meer geschreven. De overstap gebeurt één keer, door de eerste nieuwe client die v2 niet vindt (het bestand wordt
  // alleen aangemaakt als het nog niet bestaat; wie een 412/409 krijgt leest dat bestand en migreert NIET opnieuw), zodat de id's maar één
  // keer ontstaan. Bestaande id's blijven; een taak zonder (of met een dubbel) id krijgt een willekeurig id (uuid). Elk ingevuld veld
  // krijgt een stempel met het tijdstip van de overstap.
  // In de sleutel "__migratie" staat wat nodig is om later te zien of een oude app-versie het oude bestand nog wijzigde:
  //   oud_hash  = hash van PRECIES het gelezen SharePoint-bestand;  basis = {id: inhoudshash}, codes = {id: projectcode} van wat daarin stond;
  //   bron      = {bronsleutel: nieuw id} per legacy-record (bronsleutel = projectcode | inhoudsfingerprint | volgnummer);
  //   zonder_id / dubbel = records die bij de overstap een nieuw id kregen; lokaal = {id: hash} lokale aanvullingen (niet uit SharePoint);
  //   migratie_afwijkingen = lokale versies van een bestaand id die van SharePoint afweken (SharePoint won; de mens kan alsnog kiezen);
  //   afgehandeld = {sleutel: [hash…]} wat de mens al afhandelde (een verzameling: alleen toevoegen).
  // SHA-256 (hex), synchroon en zonder afhankelijkheden zodat de pure kern overal testbaar blijft (WebCrypto is asynchroon). UTF-8 zoals overal.
  const K256 = (() => { const k = []; let n = 2; while (k.length < 64) { let prim = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { prim = false; break; } if (prim) k.push(Math.floor((Math.cbrt(n) % 1) * 4294967296) >>> 0); n++; } return k; })();
  P.sha256 = function (tekst) {
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const bytes = unescape(encodeURIComponent(String(tekst))).split('').map(c => c.charCodeAt(0));
    const bits = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bits / 4294967296), lo = bits >>> 0; [hi, lo].forEach(w => { bytes.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255); });
    const H0 = [2, 3, 5, 7, 11, 13, 17, 19].map(n => Math.floor((Math.sqrt(n) % 1) * 4294967296) >>> 0), W = new Array(64);
    for (let o = 0; o < bytes.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = ((bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3]) >>> 0;
      for (let i = 16; i < 64; i++) { const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H0;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K256[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H0[i] = (H0[i] + v) >>> 0; });
    }
    return H0.map(v => v.toString(16).padStart(8, '0')).join('');
  };
  const hash36 = s => P.sha256(s);   // naam uit een eerdere versie; het is nu SHA-256 (hex)
  const stabiel = v => Array.isArray(v) ? '[' + v.map(stabiel).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stabiel(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
  P.taakInhoudHash = t => hash36(stabiel(P.TAAK_VELDEN.filter(f => f !== 'tg_sync').map(f => norm(t && t[f]))));
  P.takenBestandHash = obj => hash36(stabiel(obj || {}));
  const fingerprint = t => hash36(stabiel([t && t.naam, t && t.omschrijving, t && t.bron, t && t.duur_uur].map(norm)));
  // Per legacy-record een bronsleutel; het volgnummer telt gelijke fingerprints binnen een project.
  P.legacyBronSleutels = function (obj) {
    const uit = [];
    for (const code of Object.keys(obj || {})) {
      if (code.startsWith('__') || !Array.isArray(obj[code])) continue;
      const teller = {};
      obj[code].forEach(t => { if (!t || typeof t !== 'object' || t._vervallen) return; const fp = fingerprint(t); teller[fp] = (teller[fp] || 0) + 1; uit.push({ code, taak: t, sleutel: code + '|' + fp + '|' + teller[fp] }); });
    }
    return uit;
  };
  const heeftKlaar = (meta, sleutel, hash) => { const k = meta && meta.afgehandeld && meta.afgehandeld[sleutel]; return Array.isArray(k) ? k.includes(hash) : k === hash; };
  P.takenKlaarVoegToe = function (meta, sleutel, hash) { meta.afgehandeld = meta.afgehandeld || {}; const k = meta.afgehandeld[sleutel]; const lijst = Array.isArray(k) ? k : (k ? [k] : []); if (!lijst.includes(hash)) lijst.push(hash); meta.afgehandeld[sleutel] = lijst; return meta; };
  // Vorm van een (oud) takenbestand: een object { projectcode: [taak…] }. Geldige JSON met een andere vorm (array, tekst, getal, een project dat
  // geen lijst is, een taak die geen object is) is een FOUT en nooit "leeg". → '' of een foutomschrijving; null/undefined = er is geen bestand (toegestaan).
  P.takenBestandVorm = function (obj) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object' || Array.isArray(obj)) return 'het bestand is geen object met projecten (verwacht { projectcode: [taken] })';
    for (const code of Object.keys(obj)) {
      if (code.startsWith('__')) continue;
      if (!Array.isArray(obj[code])) return 'project "' + code + '" is geen lijst met taken';
      if (obj[code].some(t => !t || typeof t !== 'object' || Array.isArray(t))) return 'project "' + code + '" bevat een taak die geen object is';
    }
    return '';
  };
  // Het voorbeeld dat beheer ziet vóór de overstap: aantallen per project, id-loze en dubbele records, lokale aanvullingen en afwijkingen tussen lokaal
  // en SharePoint (volledige inhoud van elke taak, niet een fingerprint). Gebruikt dezelfde opbouw als de echte overstap.
  P.takenOverstapVoorbeeld = function (sp, lokaal) {
    const fout = P.takenBestandVorm(sp) || P.takenBestandVorm(lokaal);
    if (fout) return { fout };
    const v = P.takenV2Opbouw(sp || {}, { lokaal: lokaal || null, nu: 0, uuid: () => 'voorbeeld' }), m = v.__migratie;
    const per = {}; Object.keys(v).forEach(c => { if (!c.startsWith('__')) per[c] = { totaal: v[c].length, sharepoint: 0, lokaal_erbij: 0 }; });
    P.legacyBronSleutels(sp || {}).forEach(x => { if (per[x.code]) per[x.code].sharepoint++; });
    Object.keys(per).forEach(c => { per[c].lokaal_erbij = per[c].totaal - per[c].sharepoint; });
    const totaal = Object.values(per).reduce((a, x) => ({ totaal: a.totaal + x.totaal, sharepoint: a.sharepoint + x.sharepoint, lokaal_erbij: a.lokaal_erbij + x.lokaal_erbij }), { totaal: 0, sharepoint: 0, lokaal_erbij: 0 });
    return { projecten: per, totaal, zonderId: m.zonder_id.length, dubbel: m.dubbel.length, afwijkingen: m.migratie_afwijkingen, bestaatAl: false };
  };
  // Wijkt de oude takenlijst van déze browser af van het oude remote bestand? Vergeleken als MULTISET: per (projectcode, inhoudshash) tellen we hoe vaak
  // een taak er lokaal en remote in staat; wat er lokaal méér staat is een niet-gesynchroniseerde oude wijziging van deze browser (twee identieke taken tellen
  // dus dubbel). Hier hoort GEEN schrijfroute bij: de gebruiker kan het alleen downloaden of naar beheer sturen.
  // negeer = verzameling "projectcode|hash". → [{code, taak, hash, sleutel}]
  P.takenLokaalAfwijking = function (lokaal, remote, negeer) {
    if (!lokaal || P.takenBestandVorm(lokaal) || P.takenBestandVorm(remote)) return [];
    const nee = negeer instanceof Set ? negeer : new Set(negeer || []), tel = {}, uit = [];
    Object.keys(remote || {}).forEach(c => { if (c.startsWith('__')) return; remote[c].forEach(t => { const k = c + '|' + P.taakInhoudHash(t); tel[k] = (tel[k] || 0) + 1; }); });
    Object.keys(lokaal).forEach(c => { if (c.startsWith('__')) return; lokaal[c].forEach(t => { const h = P.taakInhoudHash(t), k = c + '|' + h; if (tel[k] > 0) { tel[k]--; return; } if (!nee.has(k)) uit.push({ code: c, taak: kopie(t), hash: h, sleutel: k }); }); });
    return uit;
  };
  P.takenV2Opbouw = function (sp, { lokaal = null, nu = Date.now(), dev = '', door = '', uuid = null } = {}) {
    const maakId = uuid || (() => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    const spObj = sp && typeof sp === 'object' && !Array.isArray(sp) ? sp : {};
    const spRecs = P.legacyBronSleutels(spObj), spBron = new Set(spRecs.map(x => x.sleutel)), spId = new Map();
    spRecs.forEach(x => { if (x.taak.id && !spId.has(x.taak.id)) spId.set(x.taak.id, x); });
    // samenvoegen: SharePoint is leidend; lokale aanvullingen (nieuwe taken, id-loze die er niet in staan) blijven; een afwijkende lokale versie wordt gemeld
    const samen = {}; const migratieAfwijkingen = [], lokaalSleutel = new Set();
    for (const x of spRecs) (samen[x.code] = samen[x.code] || []).push({ t: x.taak, sleutel: x.sleutel, uitSP: true });
    for (const x of P.legacyBronSleutels(lokaal || {})) {
      if (x.taak.id && spId.has(x.taak.id)) {
        const s = spId.get(x.taak.id).taak;
        const velden = P.TAAK_VELDEN.filter(f => f !== 'tg_sync' && !gelijk(x.taak[f], s[f])).map(f => ({ veld: f, oud: norm(x.taak[f]), nu: norm(s[f]) }));
        if (velden.length) migratieAfwijkingen.push({ code: x.code, id: x.taak.id, naam: x.taak.naam || s.naam || '', velden, hash: P.taakInhoudHash(x.taak) });
        continue;
      }
      if (!x.taak.id && spBron.has(x.sleutel)) continue;   // hetzelfde id-loze record staat al in het SharePoint-bestand
      (samen[x.code] = samen[x.code] || []).push({ t: x.taak, sleutel: x.sleutel, uitSP: false }); lokaalSleutel.add(x.sleutel);
    }
    const data = {}, basis = {}, codes = {}, bron = {}, zonderId = [], dubbel = [], lokaalMeta = {}, gebruikt = new Set();
    for (const code of Object.keys(samen)) {
      data[code] = [];
      for (const e of samen[code]) {
        const t = kopie(e.t); delete t._vs; delete t._veldconflict;
        const orgId = t.id; let nieuw = false;
        if (!orgId) { t.id = maakId(); zonderId.push({ code, naam: t.naam || '', id: t.id, sleutel: e.sleutel }); nieuw = true; }
        else if (gebruikt.has(orgId)) { t.id = maakId(); dubbel.push({ code, naam: t.naam || '', oud_id: orgId, id: t.id, sleutel: e.sleutel }); nieuw = true; }
        gebruikt.add(t.id); bron[e.sleutel] = t.id;
        if (!nieuw) { if (e.uitSP) { basis[t.id] = P.taakInhoudHash(e.t); codes[t.id] = code; } else lokaalMeta[t.id] = P.taakInhoudHash(e.t); }
        const vs = {};
        P.TAAK_VELDEN.forEach(f => { if (t[f] !== undefined) vs[f] = { t: nu, dev, rev: 1, door, basis: 0 }; });
        if (Object.keys(vs).length) { t._vs = vs; t._gewijzigd = nu; }
        data[code].push(t);
      }
    }
    data.__migratie = { tijd: nu, dev, door, oud_hash: P.takenBestandHash(spObj), basis, codes, bron, zonder_id: zonderId, dubbel, lokaal: lokaalMeta, migratie_afwijkingen: migratieAfwijkingen, afgehandeld: {} };
    return data;
  };
  // Wat is er te bekijken voor beheer? (a) wat bij de overstap een nieuw id kreeg of van SharePoint afweek, (b) wat een oude app-versie sindsdien
  // in het OUDE bestand veranderde: 'nieuw', 'gewijzigd', 'verwijderd', 'verhuisd', en 'herstel' (gewijzigd terwijl de taak in v2 verwijderd is).
  // Nooit automatisch overnemen: de aanroeper laat de mens kiezen. Een afgehandelde afwijking (sleutel + inhoudshash) komt niet terug.
  // → { gewijzigd, afwijkingen:[{soort, sleutel, code, id, naam, hash, velden:[{veld,oud,nu}], taak}] }
  P.takenOudAfwijkingen = function (meta, oudNu, v2) {
    if (!meta || typeof meta !== 'object') return { gewijzigd: false, afwijkingen: [], info: [] };
    const uit = []; const voeg = a => { if (!heeftKlaar(meta, a.sleutel, a.hash)) uit.push(Object.assign({ velden: [], taak: null }, a)); };
    (meta.zonder_id || []).forEach(z => voeg({ soort: 'info-zonder-id', sleutel: 'zid:' + z.id, code: z.code, id: z.id, naam: z.naam, hash: 'i' }));
    (meta.dubbel || []).forEach(z => voeg({ soort: 'info-dubbel-id', sleutel: 'dub:' + z.id, code: z.code, id: z.id, naam: z.naam, hash: 'i' }));
    (meta.migratie_afwijkingen || []).forEach(z => voeg({ soort: 'migratie', sleutel: 'mig:' + z.id, code: z.code, id: z.id, naam: z.naam, hash: z.hash, velden: z.velden }));
    const gewijzigd = !!oudNu && typeof oudNu === 'object' && P.takenBestandHash(oudNu) !== meta.oud_hash;
    const INFO = ['info-zonder-id', 'info-dubbel-id', 'migratie'];
    const klaarMelden = () => ({ gewijzigd, afwijkingen: uit.filter(a => !INFO.includes(a.soort)), info: uit.filter(a => INFO.includes(a.soort)) });
    if (!gewijzigd) return klaarMelden();
    const basis = meta.basis || {}, lok = meta.lokaal || {}, codes = meta.codes || {}, bron = meta.bron || {}, nu = new Map();
    Object.keys(v2 || {}).forEach(c => { if (!c.startsWith('__') && Array.isArray(v2[c])) v2[c].forEach(t => { if (t && t.id) nu.set(t.id, { code: c, taak: t }); }); });
    const inOud = new Set();
    P.legacyBronSleutels(oudNu).forEach(({ code, taak: t, sleutel }) => {
      const id = t.id, h = P.taakInhoudHash(t);
      if (!id) { if (!bron[sleutel]) voeg({ soort: 'nieuw', sleutel: 'bron:' + sleutel, code, id: null, naam: t.naam || '', hash: h, taak: kopie(t) }); return; }
      if (inOud.has(id)) { if (!bron[sleutel]) voeg({ soort: 'dubbel-nieuw', sleutel: 'dubnu:' + sleutel, code, id, naam: t.naam || '', hash: h, taak: kopie(t) }); return; }   // dubbel id in het oude bestand: alleen de eerste is te volgen
      inOud.add(id);
      const eerder = basis[id] !== undefined ? basis[id] : lok[id], huidig = nu.get(id);
      const verwijderdInV2 = !huidig || !!huidig.taak._vervallen;
      if (eerder === undefined) { if (verwijderdInV2) voeg({ soort: 'nieuw', sleutel: id, code, id, naam: t.naam || '', hash: h, taak: kopie(t) }); return; }
      const verhuisd = codes[id] !== undefined && codes[id] !== code;
      if (eerder === h && !verhuisd) return;
      if (verwijderdInV2) {   // de oude app wijzigde of verhuisde (alleen een andere projectcode telt ook) een taak die in v2 verwijderd is
        if (eerder !== h || verhuisd) voeg({ soort: 'herstel', sleutel: id, code, id, naam: t.naam || '', hash: h + (verhuisd ? '@' + code : ''), velden: verhuisd ? [{ veld: 'project', oud: code, nu: codes[id] }] : [], taak: kopie(t) });
        return;
      }
      const velden = P.TAAK_VELDEN.filter(f => f !== 'tg_sync' && !gelijk(t[f], huidig.taak[f])).map(f => ({ veld: f, oud: norm(t[f]), nu: norm(huidig.taak[f]) }));
      if (verhuisd) voeg({ soort: 'verhuisd', sleutel: id, code, id, naam: t.naam || '', hash: h + '@' + code, velden: [{ veld: 'project', oud: code, nu: huidig.code }].concat(velden), taak: kopie(t) });
      else if (velden.length) voeg({ soort: 'gewijzigd', sleutel: id, code, id, naam: t.naam || '', hash: h, velden, taak: kopie(t) });
    });
    Object.keys(basis).forEach(id => { if (!inOud.has(id)) { const huidig = nu.get(id); if (huidig && !huidig.taak._vervallen) voeg({ soort: 'verwijderd', sleutel: id, code: huidig.code, id, naam: huidig.taak.naam || '', hash: 'weg' }); } });
    return klaarMelden();
  };

  // Eén record samenvoegen: per veld wint de hoogste stempel (t, dev, rev). Een wijziging die de winnaar niet kende (haar stempel
  // nieuwer dan de basis van de winnaar) of een identieke stempel met een andere waarde wordt bewaard als _veldconflict[veld]; een oude,
  // ongestempelde waarde is nooit "stil" weg. Alleen de koppeltabel (tg_sync) houdt een afwijkende status 'fout' of 'extern-verwijderd'
  // in een conflict; verder wint de nieuwste. opt.verwijderWint (taken, afhankelijkheden): een verwijdering wint altijd (L1a).
  // Zonder: het nieuwste record beslist ook over de tombstone (bestelregels: terugzetten kan). opt.legacy (bestelregels): zonder stempels
  // aan beide kanten wint het nieuwste record, en een veld zonder stempel telt voor de volgorde met de tijd van zijn record.
  const nieuwste = (l, r) => recTijd(l) !== recTijd(r) ? (recTijd(l) > recTijd(r) ? l : r) : (stabiel(l) >= stabiel(r) ? l : r);   // gelijke tijd: de inhoud beslist
  function recSamen(velden, opt, l, r) {
    if (l._vervallen || r._vervallen) {
      if (opt.verwijderWint) {   // verwijderen wint; twee verwijderingen: dezelfde totale volgorde (tijd, apparaat, teller)
        if (!(l._vervallen && r._vervallen)) return kopie(l._vervallen ? l : r);
        const sl = l._ts || { t: recTijd(l) }, sr = r._ts || { t: recTijd(r) }, o = volgorde(sl, sr);
        if (o !== 0) return kopie(o > 0 ? l : r);
        return kopie(stabiel(l) >= stabiel(r) ? l : r);   // exact gelijke stempels: de inhoud beslist (deterministisch, ongeacht de volgorde)
      }
      return kopie(nieuwste(l, r));
    }
    if (opt.legacy && !Object.keys(l._vs || {}).length && !Object.keys(r._vs || {}).length) return kopie(nieuwste(l, r));
    const nl = maxStempel(l), nr = maxStempel(r);
    const linksBasis = nl !== nr ? nl > nr : stabiel(l) > stabiel(r);   // gelijke stempels: een stabiele volgorde op de inhoud, nooit "rechts"
    const basis = kopie(linksBasis ? l : r);   // niet-getrackte velden (bron, project_id…) van de nieuwste kant
    const andere = linksBasis ? r : l;
    Object.keys(andere).forEach(k => { if (!(k in basis) && !k.startsWith('_')) basis[k] = kopie(andere[k]); });
    const w = basis; w._vs = {}; const conflicten = {};
    // legacy: een veld zonder stempel telt voor de volgorde (niet voor conflicten) met de tijd van het record; een veld dat er niet is, beslist niets
    const eff = (x, f) => { const s = (x._vs || {})[f]; return s || (opt.legacy && x[f] !== undefined ? { t: recTijd(x) } : undefined); };
    velden.forEach(f => {
      const sl = (l._vs || {})[f], sr = (r._vs || {})[f], c0 = volgorde(sl, sr), ord = opt.legacy ? volgorde(eff(l, f), eff(r, f)) : c0;
      let win, ander, sw, so;
      const linksWint = ord > 0 || (ord === 0 && stabiel(norm(l[f])) > stabiel(norm(r[f])));   // identieke stempel: de waarde beslist (deterministisch)
      if (linksWint) { win = l; ander = r; sw = sl; so = sr; } else { win = r; ander = l; sw = sr; so = sl; }
      if (win[f] === undefined) delete w[f]; else w[f] = kopie(win[f]);
      if (sw) w._vs[f] = kopie(sw);
      const bt = tijdVan(sw), bb = Number(sw && sw.basis) || 0, ot = tijdVan(so), verschil = !gelijk(ander[f], win[f]);
      let c = null;
      if (verschil && !(f === 'tg_sync' && c0 !== 0 && !(ander[f] && (ander[f].status === 'fout' || ander[f].status === 'extern-verwijderd')))) {
        const identiek = c0 === 0 && (!opt.legacy || !!(sl || sr)), ongestempeld = !ot && !!bt && !opt.legacy;
        if (identiek || (ot && ot > bb) || (ongestempeld && (f in ander))) c = { waarde: kopie(norm(ander[f])), door: (so && so.door) || '', t: ot || bt };
      }
      [l, r].forEach(z => { const oc = z._veldconflict && z._veldconflict[f]; if (oc && Number(oc.t) > bb && !gelijk(oc.waarde, win[f]) && (!c || Number(oc.t) > c.t || (Number(oc.t) === c.t && stabiel(oc.waarde) > stabiel(c.waarde)))) c = kopie(oc); });   // gelijke tijd: deterministisch op de waarde
      if (c) conflicten[f] = c;
    });
    if (opt.taak && !syncGeldig(w)) { delete w.tg_sync; delete w._vs.tg_sync; delete conflicten.tg_sync; }   // koppeltabel van een andere Toggl-taak vervalt
    if (Object.keys(conflicten).length) w._veldconflict = conflicten; else delete w._veldconflict;
    if (!Object.keys(w._vs).length) delete w._vs;
    const m = Math.max(maxStempel(w), recTijd(l), recTijd(r)); if (m) w._gewijzigd = zetTijd(opt.iso, m);
    return w;
  }
  const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
  // Lijst van records met een id samenvoegen; wat aan één kant staat, blijft staan. Records zonder id blijven staan (ontdubbeld).
  function lijstSamenMet(velden, opt, a, b) {
    const per = new Map(), los = new Map();
    (b || []).forEach(x => { if (x && x.id) per.set(x.id, { r: x, l: null }); else if (x != null) los.set(JSON.stringify(x), x); });
    (a || []).forEach(x => { if (x && x.id) { const e = per.get(x.id); if (e) e.l = x; else per.set(x.id, { r: null, l: x }); } else if (x != null) los.set(JSON.stringify(x), x); });
    return [...[...per.values()].map(e => e.l && e.r ? recSamen(velden, opt, e.l, e.r) : kopie(e.l || e.r)), ...los.values()];
  }
  // De overstap-metagegevens: de oudste overstap blijft (er is er maar één), wat afgehandeld is wordt samengevoegd.
  function metaSamen(a, b) {
    if (!a || typeof a !== 'object') return b && typeof b === 'object' ? kopie(b) : null;
    if (!b || typeof b !== 'object') return kopie(a);
    const basis = (Number(a.tijd) || 0) <= (Number(b.tijd) || 0) ? a : b;
    const m = kopie(basis), ver = {};   // afgehandeld = verzameling per sleutel (vereniging): alleen toevoegen, nooit "lokaal wint"
    [a.afgehandeld, b.afgehandeld].forEach(o => Object.keys(o || {}).forEach(k => { const w = Array.isArray(o[k]) ? o[k] : [o[k]]; ver[k] = [...new Set([...(ver[k] || []), ...w])].sort(); }));
    m.afgehandeld = {}; Object.keys(ver).sort().forEach(k => { m.afgehandeld[k] = ver[k]; });   // vaste volgorde: hetzelfde resultaat ongeacht de argumentvolgorde
    return m;
  }
  // Samenvoeger voor het hele bestand { code: [record…] }: per code, per id. migreer: eerst oude records migreren (alleen taken).
  // Strikt: leeg (null, undefined, '') is een leeg bestand; ongeldige JSON of een andere vorm is een FOUT en wordt nooit stil tot leeg teruggebracht
  // (dat zou bij het terugschrijven het hele bestand wissen). De aanroeper (hydrate/412-merge) blokkeert de sleutel dan.
  const leesStrikt = (v, vormFn, leegWaarde, naam) => {
    if (v === null || v === undefined || v === '') return leegWaarde;
    let o = v; if (typeof v === 'string') { try { o = JSON.parse(v); } catch (e) { throw new Error(naam + ': ongeldige JSON'); } }
    if (o === null) return leegWaarde;
    const f = vormFn(o); if (f) throw new Error(naam + ': ' + f); return o;
  };
  // Canonieke uitvoer: records op id, sleutels in vaste volgorde: samenvoegen(A,B) en samenvoegen(B,A) geven dezelfde JSON-tekst.
  const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
  const sorteerOpId = lijst => lijst.map(canon).sort((x, y) => { const a = x && x.id != null ? String(x.id) : '\uffff' + stabiel(x), b = y && y.id != null ? String(y.id) : '\uffff' + stabiel(y); return a < b ? -1 : a > b ? 1 : 0; });
  function storeSamenMet(velden, opt, lokaal, remote) {
    const L = leesStrikt(lokaal, o => P.takenBestandVorm(o), {}, 'samenvoegen'), R = leesStrikt(remote, o => P.takenBestandVorm(o), {}, 'samenvoegen'); const uit = {};
    for (const code of new Set([...Object.keys(R), ...Object.keys(L)])) {
      if (code.startsWith('__')) continue;   // metagegevens (zie metaSamen)
      uit[code] = lijstSamenMet(velden, opt, Array.isArray(L[code]) ? L[code] : [], Array.isArray(R[code]) ? R[code] : []);
    }
    const klaar = {}; Object.keys(uit).sort().forEach(code => { klaar[code] = sorteerOpId(uit[code]); });
    if (opt.taak) { const meta = metaSamen(L.__migratie, R.__migratie); if (meta) klaar.__migratie = canon(meta); }
    return klaar;
  }
  const OPT_VW = { verwijderWint: true };
  P.takenSamen = (lokaal, remote) => storeSamenMet(P.TAAK_VELDEN, Object.assign({ taak: true }, OPT_VW), lokaal, remote);
  // Een conflict oplossen: 'andere' neemt de bewaarde waarde over, 'eigen' houdt de huidige. Beide krijgen een nieuwe stempel
  // die boven het conflict ligt, zodat de keuze ook op de andere pc het conflict wegneemt. Wijzigt `taak` ter plekke.
  P.conflictOplos = function (taak, veld, kies, { nu = Date.now(), door = '', dev = '' } = {}) {
    const c = taak && taak._veldconflict && taak._veldconflict[veld]; if (!c) return false;
    const vs0 = (taak._vs || {})[veld], vorig = tijdVan(vs0);
    if (kies === 'andere') { if (c.waarde === null || c.waarde === undefined) delete taak[veld]; else taak[veld] = kopie(c.waarde); }
    taak._vs = taak._vs || {};
    taak._vs[veld] = { t: Math.max(nu, vorig + 1, Number(c.t) + 1), dev, rev: revVan(vs0) + 1, door, basis: Math.max(vorig, Number(c.t)) };
    delete taak._veldconflict[veld]; if (!Object.keys(taak._veldconflict).length) delete taak._veldconflict;
    taak._gewijzigd = zetTijd(typeof taak._gewijzigd === 'string', maxStempel(taak));
    return true;
  };

  // ── Toggl-koppeltabel per taak ─────────────────────────────────────────────────────────────────────
  // tg_sync = {provider:'toggl', external_id (= tg_task_id), laatst_gezien (ms), hash (van de gespiegelde velden), status:'ok'|'fout'|'extern-verwijderd', fout}
  // Eenrichting MT → Toggl: gespiegeld worden alleen naam en status. De taak in MT blijft altijd de bron.
  // De oude (base36, 32-bits) hash uit eerdere versies: bestaande koppelingen blijven "actueel" in plaats van allemaal op "bijwerken" te springen.
  P.tgHashOud = t => { const s = JSON.stringify([String((t && t.naam) || ''), String((t && t.status) || 'todo')]); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  P.tgHash = t => P.sha256(JSON.stringify([String((t && t.naam) || ''), String((t && t.status) || 'todo')]));
  // 'koppelen' (nog geen Toggl-taak), 'herkoppelen' (koppeltabel ontbreekt of hoort bij een andere Toggl-taak), 'bijwerken' (MT wijkt af
  // van wat we laatst naar Toggl stuurden), 'actueel', 'extern-verwijderd'
  P.tgActie = t => {
    if (!t) return 'actueel';
    if (!t.tg_task_id) return 'koppelen';
    const s = t.tg_sync;
    if (!s || String(s.external_id) !== String(t.tg_task_id)) return 'herkoppelen';
    if (s.status === 'extern-verwijderd') return 'extern-verwijderd';
    return (s.hash === P.tgHash(t) || s.hash === P.tgHashOud(t)) ? 'actueel' : 'bijwerken';
  };

  // ── De meter: budget / gepland / geklokt (gekoppeld, ongekoppeld) / resterend ────────────────────────
  const nrm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const actKey = k => (P.activiteit(k) ? k : '');
  // Budget (min) uit een offerte-calculatie: uren per uursoort → activiteit. null = geen (ingevulde) calculatie.
  P.calcBudget = function (offerte) {
    const rijen = offerte && Array.isArray(offerte.uren) ? offerte.uren : [];
    const per = {}; let totaal = 0;
    rijen.forEach(u => { const min = P.urenNaarMin(u && u.uren); if (min <= 0) return; const k = P.activiteitUitUursoort(u.omschrijving) || ''; per[k] = (per[k] || 0) + min; totaal += min; });
    return totaal > 0 ? { per, totaal } : null;
  };
  // taken: actieve taken; blokken: planblokken van het project; geklokt: [{taak_id, min}] (taak_id = Toggl-taak of null);
  // calc: de offerte of null; opties: tgProject (heeft het project een Toggl-project), tgTijd (laatste sync, ms).
  P.meter = function ({ taken = [], blokken = [], geklokt = [], calc = null, tgProject = true, tgTijd = null } = {}) {
    taken = P.takenActief(taken);
    const rij = {}, rijVoor = k => rij[k] || (rij[k] = { k, l: k ? P.activiteit(k).l : 'Niet ingedeeld', soort: k ? P.activiteit(k).soort : 'overig', taakBudget: 0, calcBudget: 0, gepland: 0, gekoppeld: 0, taken: 0 });
    const perTaak = {}, taakVoorTg = new Map(), taakVoorId = new Map(), taakVoorNaam = new Map();
    taken.forEach(t => {
      const k = actKey(t.activiteit), b = P.taakBudgetMin(t), r = rijVoor(k);
      r.taakBudget += b; r.taken++;
      perTaak[t.id] = { id: t.id, k, budget: b, gepland: 0, gekoppeld: 0 };
      taakVoorId.set(String(t.id), t);
      if (t.tg_task_id != null && t.tg_task_id !== '') taakVoorTg.set(String(t.tg_task_id), t);
      const n = nrm(t.naam); if (n) taakVoorNaam.set(n, taakVoorNaam.has(n) ? null : t);   // dubbele namen: niet gokken
    });
    // gepland
    let geplandTotaal = 0, geplandLos = 0;
    (blokken || []).forEach(b => {
      if (!b || b._vervallen || b.status === 'voorstel') return;
      const min = Math.round(getal(b.duurMin)); if (min <= 0) return;
      let t = b.taak_id != null ? taakVoorId.get(String(b.taak_id)) : null;
      if (!t && b.taak_id == null) t = taakVoorNaam.get(nrm(b.taak)) || null;   // alleen een exacte, unieke naam
      const k = t ? actKey(t.activiteit) : actKey(b.activiteit);
      rijVoor(k).gepland += min; geplandTotaal += min;
      if (t) perTaak[t.id].gepland += min; else geplandLos += min;
    });
    // geklokt
    let gekoppeld = 0, ongekoppeld = 0; const onbekend = new Set();
    (geklokt || []).forEach(g => {
      const min = Math.round(getal(g && g.min)); if (min <= 0) return;
      const tid = g.taak_id == null || g.taak_id === '' ? null : String(g.taak_id), t = tid ? taakVoorTg.get(tid) : null;
      if (t) { rijVoor(actKey(t.activiteit)).gekoppeld += min; perTaak[t.id].gekoppeld += min; gekoppeld += min; }
      else { ongekoppeld += min; if (tid) onbekend.add(tid); }
    });
    // budget: calculatie als die er is, anders de taakbudgetten
    const cb = P.calcBudget(calc), bron = cb ? 'calculatie' : (taken.some(t => P.taakBudgetMin(t) > 0) ? 'taken' : 'geen');
    if (cb) Object.entries(cb.per).forEach(([k, min]) => { rijVoor(actKey(k)).calcBudget += min; });
    const rijen = [...P.ACTIVITEITEN.map(a => a.k), ''].filter(k => rij[k]).map(k => {
      const r = rij[k], budget = cb ? r.calcBudget : r.taakBudget;
      return Object.assign({}, r, { budget, resterend: budget - r.gekoppeld });
    }).filter(r => r.budget || r.gepland || r.gekoppeld || r.taken);
    const budget = cb ? cb.totaal : rijen.reduce((s, r) => s + r.taakBudget, 0);
    const geklokt_ = gekoppeld + ongekoppeld;
    const totaal = { budget, gepland: geplandTotaal, gekoppeld, ongekoppeld, geklokt: geklokt_, resterend: budget - geklokt_, pct: budget > 0 ? geklokt_ / budget : null };
    // rollup kantooruren / Werkplaatsuren
    const perSoort = {}; Object.keys(P.SOORTEN).forEach(s => { perSoort[s] = { budget: 0, gepland: 0, gekoppeld: 0 }; });
    rijen.forEach(r => { const p = perSoort[r.soort]; p.budget += r.budget; p.gepland += r.gepland; p.gekoppeld += r.gekoppeld; });
    // waarschuwingen
    const w = [], titels = ts => ts.slice(0, 5).map(t => t.naam).join(', ') + (ts.length > 5 ? ' …' : '');
    if (!tgProject) w.push({ soort: 'geen-toggl-project', niveau: 'let-op', tekst: 'Dit project heeft geen Toggl-project: geklokte uren kunnen niet aan taken worden gekoppeld.' });
    const zonderKoppeling = taken.filter(t => t.status !== 'klaar' && (t.tg_task_id == null || t.tg_task_id === ''));
    if (tgProject && zonderKoppeling.length) w.push({ soort: 'taak-niet-gekoppeld', niveau: 'let-op', tekst: `${zonderKoppeling.length} taak/taken niet aan een Toggl-taak gekoppeld (${titels(zonderKoppeling)}): uren op die taken tellen als ongekoppeld.`, taken: zonderKoppeling.map(t => t.id) });
    const syncFout = taken.filter(t => t.tg_sync && (t.tg_sync.status === 'fout' || t.tg_sync.status === 'extern-verwijderd'));
    if (syncFout.length) w.push({ soort: 'sync-fout', niveau: 'fout', tekst: `${syncFout.length} taak/taken met een Toggl-probleem (${titels(syncFout)}): ${syncFout.some(t => t.tg_sync.status === 'extern-verwijderd') ? 'een taak is in Toggl verwijderd, besluit zelf wat er met de MT-taak gebeurt.' : 'de laatste synchronisatie is mislukt.'}`, taken: syncFout.map(t => t.id) });
    if (onbekend.size) w.push({ soort: 'onbekende-toggltaak', niveau: 'let-op', tekst: `Uren op ${onbekend.size} Toggl-taak/taken die niet aan een MT-taak gekoppeld zijn; ze tellen als ongekoppeld.` });
    const conflict = taken.filter(t => t._veldconflict && Object.keys(t._veldconflict).length);
    if (conflict.length) w.push({ soort: 'conflict', niveau: 'let-op', tekst: `${conflict.length} taak/taken met een conflict (twee gelijktijdige wijzigingen): kies welke waarde blijft (${titels(conflict)}).`, taken: conflict.map(t => t.id) });
    if (budget > 0 && geplandTotaal > budget) w.push({ soort: 'meer-gepland', niveau: 'let-op', tekst: `Er is meer gepland (${P.fmtUur(geplandTotaal)}) dan het budget (${P.fmtUur(budget)}).` });
    const sig = P.signaal({ totaal });
    if (sig) w.push(sig);
    return { rijen, totaal, perSoort, perTaak, budgetBron: bron, geplandLos, waarschuwingen: w, tgTijd };
  };
  // Het budget-signaal: ≥ 90% van het budget geklokt (let op), ≥ 100% (over).
  P.signaal = function (m) {
    const tt = m && m.totaal; if (!tt || !(tt.budget > 0)) return null;
    const p = tt.geklokt / tt.budget;
    if (p >= 1) return { soort: 'budget-100', niveau: 'fout', tekst: `Budget overschreden: ${P.fmtUur(tt.geklokt)} geklokt van ${P.fmtUur(tt.budget)} (${Math.round(p * 100)}%).` };
    if (p >= 0.9) return { soort: 'budget-90', niveau: 'let-op', tekst: `${Math.round(p * 100)}% van het budget is geklokt (${P.fmtUur(tt.geklokt)} van ${P.fmtUur(tt.budget)}).` };
    return null;
  };

  // De standaardregels van de calculatie (mt_calc_defaults.uren) volgen het standaardtarief niet vanzelf. Geeft de regels die
  // afwijken van `std` (Transport heeft een eigen tarief en telt niet mee); null = alles gelijk of niets om te vergelijken.
  P.defaultsAfwijking = function (defaults, std) {
    const rijen = (defaults && Array.isArray(defaults.uren)) ? defaults.uren : [];
    const af = rijen.filter(u => u && String(u.omschrijving || '').trim().toLowerCase() !== 'transport' && u.uurtarief !== '' && u.uurtarief != null && isFinite(Number(u.uurtarief)) && Number(u.uurtarief) !== Number(std))
      .map(u => ({ omschrijving: u.omschrijving, uurtarief: Number(u.uurtarief) }));
    return af.length ? { std: Number(std), rijen: af } : null;
  };
  // Zet het tarief van die standaardregels op `std` (wijzigt `defaults` ter plekke); geeft het aantal aangepaste regels terug.
  P.defaultsGelijkTrekken = function (defaults, std) {
    let n = 0;
    ((defaults && defaults.uren) || []).forEach(u => { if (u && String(u.omschrijving || '').trim().toLowerCase() !== 'transport' && u.uurtarief !== '' && u.uurtarief != null && isFinite(Number(u.uurtarief)) && Number(u.uurtarief) !== Number(std)) { u.uurtarief = Number(std); n++; } });
    return n;
  };

  // ══ P2: afhankelijkheden, wachten, kritiek pad, verschuiven ════════════════════════════════════════════════
  // Datums zijn ymd-teksten; alle rekenwerk gaat over dagnummers (UTC) zodat zomertijd niets uitmaakt. Een werkdag is geen
  // weekend en geen vrije dag (`vrij`: lijst of Set met ymd of {datum}, bv. mt_vrijedagen van Beheer).
  const MAXD = 4000;
  const dnr = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const dymd = n => { const d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
  P.isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dymd(dnr(s)) === s;
  P.vrijSet = lijst => lijst instanceof Set ? lijst : new Set((Array.isArray(lijst) ? lijst : []).map(x => typeof x === 'string' ? x : x && x.datum).filter(P.isYmd));
  const isWerk = (n, V) => { const w = ((n + 4) % 7 + 7) % 7; return w !== 0 && w !== 6 && !V.has(dymd(n)); };
  const naarW = (n, vooruit, V) => { let i = 0; while (!isWerk(n, V) && i++ < MAXD) n += vooruit ? 1 : -1; return n; };
  const plusW = (n, k, V) => { n = naarW(n, k >= 0, V); let te = Math.abs(k), i = 0; const st = k >= 0 ? 1 : -1; while (te > 0 && i++ < MAXD) { n += st; if (isWerk(n, V)) te--; } return n; };
  const tussenW = (a, b, V) => { let n = 0, i = 0; const st = b >= a ? 1 : -1; while (a !== b && i++ < MAXD) { a += st; if (isWerk(a, V)) n += st; } return n; };
  P.isWerkdag = (ymd, vrij) => isWerk(dnr(ymd), P.vrijSet(vrij));
  P.naarWerkdag = (ymd, vooruit, vrij) => dymd(naarW(dnr(ymd), vooruit !== false, P.vrijSet(vrij)));
  P.addWerkdagen = (ymd, n, vrij) => dymd(plusW(dnr(ymd), Math.round(getal(n)), P.vrijSet(vrij)));
  P.werkdagenTussen = (a, b, vrij) => tussenW(dnr(a), dnr(b), P.vrijSet(vrij));
  P.vandaagYmd = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  // Duur van een taak in werkdagen. Een mijlpaal duurt 0 dagen. Expliciet `duur_dagen` wint; anders volgt de duur uit het budget
  // (één persoon, een werkdag van 8 uur = 480 min); zonder budget 1 dag.
  P.DAG_MIN = 480;
  P.taakDagen = (t, dagMin) => {
    if (t && t.soort === 'mijlpaal') return 0;
    const d = t && t.duur_dagen;
    if (d !== undefined && d !== null && d !== '' && isFinite(Number(d)) && Number(d) >= 0) return Math.round(Number(d));
    const b = P.taakBudgetMin(t); return b > 0 ? Math.max(1, Math.ceil(b / (dagMin || P.DAG_MIN))) : 1;
  };
  // Duur zoals de datums nu staan (een met de hand verzette taak houdt zijn lengte); anders de berekende duur.
  const datumDagen = (t, dagMin, V) => {
    if (t && t.soort === 'mijlpaal') return 0;
    if (t && P.isYmd(t.start) && P.isYmd(t.eind) && t.eind >= t.start) return tussenW(naarW(dnr(t.start), true, V), dnr(t.eind), V) + 1;
    return P.taakDagen(t, dagMin);
  };

  // ── De afhankelijkheid als eigen entiteit ──────────────────────────────────────────────────────────
  // { id, project_id, van_taak, naar_taak, type:'FS', lag_dagen, status:'actief'|'uit', _vs, _gewijzigd, _vervallen }
  // FS = finish-to-start: de opvolger start pas nadat de voorganger klaar is plus `lag_dagen` werkdagen (bv. de levertijd).
  // Uitbreidbaar met SS/FF: het type staat al in het record, de berekening kent nu alleen FS.
  // Opslag per project (mt_project_afhank: { projectcode: [dep…] }) met hetzelfde merge-model als de taken: stempel per veld,
  // tombstone, conflict.
  P.DEP_VELDEN = ['van_taak', 'naar_taak', 'type', 'lag_dagen', 'status'];
  P.afhStempel = (oud, nieuw, opts) => stempelMet(P.DEP_VELDEN, oud, nieuw, opts);
  P.afhSamen = (lokaal, remote) => storeSamenMet(P.DEP_VELDEN, OPT_VW, lokaal, remote);
  P.afhActief = P.takenActief;
  const lagDagen = d => Math.max(0, Math.round(getal(d && d.lag_dagen)));
  // De koppelingen waarmee gerekend wordt: de afhankelijkheden plus de oude `afhankelijk_van`-lijsten op taken die er (nog)
  // geen afhankelijkheid voor hebben. Een bewust verwijderde afhankelijkheid (tombstone) laat de oude koppeling niet terugkomen.
  P.depsEffectief = function (taken, depsRuw) {
    const T = P.takenActief(taken), ids = new Set(T.map(t => t.id)), uit = [], paren = new Set();
    (Array.isArray(depsRuw) ? depsRuw : []).forEach(d => {
      if (!d || typeof d !== 'object') return;
      paren.add(d.van_taak + '>' + d.naar_taak);
      if (d._vervallen) return;
      if (!ids.has(d.van_taak) || !ids.has(d.naar_taak) || d.van_taak === d.naar_taak) return;
      uit.push({ id: d.id, van: d.van_taak, naar: d.naar_taak, lag: lagDagen(d), type: d.type || 'FS', inactief: d.status === 'uit', bron: 'dep' });
    });
    T.forEach(t => (Array.isArray(t.afhankelijk_van) ? t.afhankelijk_van : []).forEach(v => {
      const sl = v + '>' + t.id;
      if (!ids.has(v) || v === t.id || paren.has(sl)) return;
      paren.add(sl); uit.push({ id: 'oud:' + sl, van: v, naar: t.id, lag: 0, type: 'FS', inactief: false, bron: 'oud' });
    }));
    return uit;
  };
  const actieveKant = edges => edges.filter(e => !e.inactief);
  function kortstePad(edges, a, b) {   // pad van a naar b langs de koppelingen (lijst taak-id's) of null
    const buur = new Map(); edges.forEach(e => { if (!buur.has(e.van)) buur.set(e.van, []); buur.get(e.van).push(e.naar); });
    const vorige = new Map([[a, null]]), rij = [a];
    while (rij.length) {
      const x = rij.shift();
      if (x === b) { const p = []; for (let y = b; y !== null; y = vorige.get(y)) p.unshift(y); return p; }
      (buur.get(x) || []).forEach(y => { if (!vorige.has(y)) { vorige.set(y, x); rij.push(y); } });
    }
    return null;
  }
  // Zou een nieuwe afhankelijkheid van → naar een kring maken? Geeft de kring ([van, naar, …, van]) of null.
  P.depKring = function (taken, depsRuw, van, naar) {
    if (van === naar) return [van, van];
    const p = kortstePad(actieveKant(P.depsEffectief(taken, depsRuw)), naar, van);
    return p ? [van].concat(p) : null;
  };
  // Staat er al een kring in de opslag (bv. na het samenvoegen van twee pc's)? Geeft de taak-id's die erin zitten.
  P.depKringen = function (taken, depsRuw) {
    const T = P.takenActief(taken); return topo(T.map(t => t.id), actieveKant(P.depsEffectief(T, depsRuw))).kring;
  };
  function topo(ids, edges) {   // Kahn, stabiel in de volgorde van ids; kring = wat overblijft
    const inn = new Map(ids.map(i => [i, 0])), buur = new Map(ids.map(i => [i, []]));
    edges.forEach(e => { if (inn.has(e.van) && inn.has(e.naar)) { inn.set(e.naar, inn.get(e.naar) + 1); buur.get(e.van).push(e.naar); } });
    const rij = ids.filter(i => inn.get(i) === 0), volgorde = [];
    while (rij.length) { const x = rij.shift(); volgorde.push(x); buur.get(x).forEach(y => { inn.set(y, inn.get(y) - 1); if (inn.get(y) === 0) rij.push(y); }); }
    return { volgorde, kring: ids.filter(i => !volgorde.includes(i)) };
  }
  const naamVan = (taken, id) => { const t = P.takenActief(taken).find(x => x.id === id); return t ? t.naam : id; };
  // Mag deze afhankelijkheid? { ok, fout, kring }. Weigert zichzelf, een bestaande en een kring.
  P.depControle = function (taken, depsRuw, { van, naar }) {
    const T = P.takenActief(taken);
    if (!T.some(t => t.id === van) || !T.some(t => t.id === naar)) return { ok: false, fout: 'Een van de taken bestaat niet (meer).' };
    if (van === naar) return { ok: false, fout: 'Een taak kan niet van zichzelf afhangen.' };
    if (P.depsEffectief(T, depsRuw).some(e => e.van === van && e.naar === naar)) return { ok: false, fout: 'Deze afhankelijkheid bestaat al.' };
    const k = P.depKring(T, depsRuw, van, naar);
    if (k) return { ok: false, kring: k, fout: 'Dit maakt een kring: ' + k.map(i => naamVan(T, i)).join(' → ') + '.' };
    return { ok: true };
  };
  // Een nieuwe afhankelijkheid maken (valt hij af, dan staat de reden in `fout`). Slaat niets op.
  P.depNieuw = function (taken, depsRuw, { van, naar, lag_dagen = 0, type = 'FS', id = '', project_id = '' } = {}) {
    const c = P.depControle(taken, depsRuw, { van, naar }); if (!c.ok) return c;
    const d = { id: id || ('d' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), van_taak: van, naar_taak: naar, type: type || 'FS', lag_dagen: Math.max(0, Math.round(getal(lag_dagen))), status: 'actief' };
    if (project_id) d.project_id = project_id;
    return { ok: true, dep: d };
  };
  // Oude `afhankelijk_van`-lijsten omzetten naar afhankelijkheden (droogloop: er wordt niets geschreven). Een koppeling die een
  // kring zou maken of naar een verdwenen taak wijst, wordt overgeslagen met de reden.
  P.depMigratie = function (taken, depsRuw, { project_id = '', nieuwId = null } = {}) {
    const T = P.takenActief(taken), ids = new Set(T.map(t => t.id)), nieuw = [], overgeslagen = [];
    let werk = Array.isArray(depsRuw) ? depsRuw.slice() : [], n = 0;
    const paren = new Set(werk.map(d => d && (d.van_taak + '>' + d.naar_taak)));
    T.forEach(t => (Array.isArray(t.afhankelijk_van) ? t.afhankelijk_van : []).forEach(v => {
      if (!ids.has(v)) { overgeslagen.push({ van: v, naar: t.id, reden: 'voorganger bestaat niet meer' }); return; }
      if (paren.has(v + '>' + t.id)) return;   // al omgezet (of bewust verwijderd)
      // controleren zonder de oude koppeling zelf (die telt in het rooster al mee en zou als "bestaat al" tellen)
      const T2 = T.map(x => x.id === t.id ? Object.assign({}, x, { afhankelijk_van: (x.afhankelijk_van || []).filter(y => y !== v) }) : x);
      const r = P.depNieuw(T2, werk, { van: v, naar: t.id, project_id, id: nieuwId ? nieuwId(n++) : '' });
      if (!r.ok) { overgeslagen.push({ van: v, naar: t.id, reden: r.fout }); return; }
      nieuw.push(r.dep); werk = werk.concat([r.dep]); paren.add(v + '>' + t.id);
    }));
    return { nieuw, overgeslagen };
  };

  // ── Wachten: een afhankelijke taak staat op "wachten" zolang een voorganger niet klaar is (zoals Odoo) ──
  // Afgeleid, niet opgeslagen: zodra de voorganger klaar is, is de wachttoestand er vanzelf niet meer.
  P.wachtOverzicht = function (taken, depsRuw) {
    const T = P.takenActief(taken), by = new Map(T.map(t => [t.id, t])), uit = {};
    T.forEach(t => { uit[t.id] = { wacht: false, op: [] }; });
    actieveKant(P.depsEffectief(T, depsRuw)).forEach(e => {
      const v = by.get(e.van), n = by.get(e.naar);
      if (v && n && n.status !== 'klaar' && v.status !== 'klaar') { uit[n.id].wacht = true; uit[n.id].op.push({ id: v.id, naam: v.naam, lag: e.lag }); }
    });
    return uit;
  };
  P.taakWacht = (taak, taken, depsRuw) => (taak && P.wachtOverzicht(taken, depsRuw)[taak.id]) || { wacht: false, op: [] };
  // De status zoals getoond: een taak die nog niet gestart is en wacht, heet 'wachten'.
  P.taakStatusEff = (taak, taken, depsRuw) => {
    const st = (taak && taak.status) || 'todo';
    return st === 'todo' && P.taakWacht(taak, taken, depsRuw).wacht ? 'wachten' : st;
  };

  // ── Rooster: vroegste en laatste datums en het kritieke pad ──────────────────────────────────────────
  // Voorwaarts vanaf `start` (vroegste datums) en achterwaarts vanaf de leverdatum (laatste datums). Per koppeling
  // voorganger → opvolger met lag L: de opvolger start op zijn vroegst L werkdagen + 1 na het einde van de voorganger; een
  // mijlpaal (duur 0) valt L werkdagen na dat einde (lag 0: dezelfde dag). Speling = werkdagen tussen vroegste en laatste start.
  // Kritiek = de taken met de kleinste speling (negatief: de leverdatum wordt niet gehaald). Het kritieke pad is dus de ketting
  // die, gerekend vanaf de leverdatum terug, geen ruimte heeft.
  const eerstMogelijk = (efNr, opvolgerIs0, lag, V) => plusW(efNr, (opvolgerIs0 ? 0 : 1) + lag, V);
  P.rooster = function (taken, depsRuw, { start = '', leverdatum = '', vrij = null, dagMin = 0 } = {}) {
    const V = P.vrijSet(vrij), T = P.takenActief(taken), by = new Map(T.map(t => [t.id, t]));
    const edges = actieveKant(P.depsEffectief(T, depsRuw)).filter(e => by.has(e.van) && by.has(e.naar));
    const s0 = naarW(dnr(P.isYmd(start) ? start : P.vandaagYmd()), true, V);
    const ids = T.map(t => t.id), { volgorde, kring } = topo(ids, edges);
    const dag = {}; T.forEach(t => { dag[t.id] = datumDagen(t, dagMin, V); });
    const inn = new Map(), uitg = new Map(); ids.forEach(i => { inn.set(i, []); uitg.set(i, []); });
    edges.forEach(e => { inn.get(e.naar).push(e); uitg.get(e.van).push(e); });
    const es = {}, ef = {};
    const eindVan = (s, d) => d >= 1 ? plusW(s, d - 1, V) : s;
    volgorde.forEach(i => {
      let s = s0; inn.get(i).forEach(e => { if (ef[e.van] !== undefined) s = Math.max(s, eerstMogelijk(ef[e.van], dag[i] === 0, e.lag, V)); });
      es[i] = naarW(s, true, V); ef[i] = eindVan(es[i], dag[i]);
    });
    kring.forEach(i => { es[i] = s0; ef[i] = eindVan(s0, dag[i]); });
    const eindVroegst = ids.length ? Math.max(...ids.map(i => ef[i])) : s0;
    const D = P.isYmd(leverdatum) ? naarW(dnr(leverdatum), false, V) : eindVroegst;
    const lf = {}, ls = {};
    const begin = (e, d) => d >= 1 ? plusW(e, -(d - 1), V) : e;
    volgorde.slice().reverse().forEach(i => {
      let l = D; uitg.get(i).forEach(e => { if (ls[e.naar] !== undefined) l = Math.min(l, plusW(ls[e.naar], -((dag[e.naar] === 0 ? 0 : 1) + e.lag), V)); });
      lf[i] = l; ls[i] = begin(l, dag[i]);
    });
    kring.forEach(i => { lf[i] = D; ls[i] = begin(D, dag[i]); });
    const uit = {}; let min = Infinity;
    ids.forEach(i => { const sp = tussenW(es[i], ls[i], V); if (sp < min) min = sp; uit[i] = { es: dymd(es[i]), ef: dymd(ef[i]), ls: dymd(ls[i]), lf: dymd(lf[i]), slack: sp, dagen: dag[i], kring: kring.includes(i), kritiek: false }; });
    const metKoppeling = new Set(); edges.forEach(e => { metKoppeling.add(e.van); metKoppeling.add(e.naar); });
    ids.forEach(i => { if (uit[i].slack === min && !uit[i].kring) uit[i].kritiek = true; });
    const pad = volgorde.filter(i => uit[i].kritiek && metKoppeling.has(i));
    return { taken: uit, volgorde, kring, start: dymd(s0), eindVroegst: dymd(eindVroegst), leverdatum: dymd(D), tekort: Math.max(0, tussenW(D, eindVroegst, V)),
      minSlack: ids.length ? min : 0, pad, padTaken: pad.map(i => ({ id: i, naam: by.get(i).naam })) };
  };
  // Het kritieke pad alleen: de ketting taken (in volgorde) die de leverdatum bepaalt.
  P.kritiekPad = (taken, depsRuw, opts) => { const r = P.rooster(taken, depsRuw, opts); return { pad: r.padTaken, tekort: r.tekort, eindVroegst: r.eindVroegst, leverdatum: r.leverdatum, kring: r.kring }; };
  // Terugrekenen vanaf de leverdatum: elke taak zo laat mogelijk, zodat het geheel op de leverdatum klaar is.
  // eerste = de vroegste start; tekort = hoeveel werkdagen die voor `start` (vandaag) ligt (0 = haalbaar).
  P.plantTerug = function (taken, depsRuw, opts) {
    const r = P.rooster(taken, depsRuw, opts), V = P.vrijSet(opts && opts.vrij), datums = {};
    let eerste = null;
    Object.keys(r.taken).forEach(i => { const x = r.taken[i]; if (x.kring) return; datums[i] = { start: x.ls, eind: x.lf }; if (eerste === null || x.ls < eerste) eerste = x.ls; });
    const tekort = eerste && eerste < r.start ? Math.max(0, tussenW(dnr(eerste), dnr(r.start), V)) : 0;
    return { datums, eerste, tekort, start: r.start, leverdatum: r.leverdatum, eindVroegst: r.eindVroegst, kring: r.kring };
  };
  // Vooruitrekenen vanaf `start`: elke taak zo vroeg mogelijk.
  P.plantVooruit = function (taken, depsRuw, opts) {
    const r = P.rooster(taken, depsRuw, opts), datums = {};
    Object.keys(r.taken).forEach(i => { const x = r.taken[i]; if (!x.kring) datums[i] = { start: x.es, eind: x.ef }; });
    return { datums, eind: r.eindVroegst, start: r.start, kring: r.kring };
  };
  // Staat een opvolger vóór zijn vroegste mogelijke start (voorganger + lag)? Alleen taken met datums.
  P.planConflicten = function (taken, depsRuw, { vrij = null, dagMin = 0 } = {}) {
    const V = P.vrijSet(vrij), T = P.takenActief(taken), by = new Map(T.map(t => [t.id, t])), uit = [];
    actieveKant(P.depsEffectief(T, depsRuw)).forEach(e => {
      const v = by.get(e.van), n = by.get(e.naar);
      if (!v || !n || !P.isYmd(v.eind) || !P.isYmd(n.start)) return;
      const eerst = eerstMogelijk(dnr(v.eind), datumDagen(n, dagMin, V) === 0, e.lag, V);
      if (dnr(n.start) < eerst) uit.push({ van: v.id, naar: n.id, vanNaam: v.naam, naarNaam: n.naam, vroegst: dymd(eerst), start: n.start, dagen: tussenW(dnr(n.start), eerst, V) });
    });
    return uit;
  };

  // ── Verschuiven: een VOORSTEL voor de opvolgers, nooit automatisch ──────────────────────────────────
  // Verzet je een taak, dan rekent dit uit welke opvolgers daardoor te vroeg komen te staan en waar ze heen moeten (zelfde duur).
  // Flexible (standaard): alleen een voorstel, je mag ook de taak alleen verzetten. Strict: de taak mag alleen mee met zijn
  // opvolgers (`blokkerend`), nog steeds pas na bevestiging. `gelijk`: opvolgers schuiven ook mee als ze er niet voor in de weg
  // staan (dezelfde verschuiving in werkdagen). Taken zonder datums blijven buiten beeld.
  P.depModus = proj => (proj && proj.gegevens && proj.gegevens.afhankelijkheid_modus === 'strict') ? 'strict' : 'flexible';
  P.verschuifVoorstel = function (taken, depsRuw, { id, start = '', eind = '' } = {}, { modus = 'flexible', vrij = null, gelijk = false, dagMin = 0 } = {}) {
    const V = P.vrijSet(vrij), T = P.takenActief(taken).map(kopie), by = new Map(T.map(t => [t.id, t]));
    const m = by.get(id); if (!m) return { ok: false, fout: 'Taak niet gevonden.' };
    const dur = {}; T.forEach(t => { dur[t.id] = datumDagen(t, dagMin, V); });
    const eindVan = (s, d) => d >= 1 ? plusW(s, d - 1, V) : s;
    let ns = P.isYmd(start) ? dnr(start) : null, ne = P.isYmd(eind) ? dnr(eind) : null;
    if (ns !== null) ns = naarW(ns, true, V);
    if (ns !== null && ne === null) ne = eindVan(ns, dur[id]);
    else if (ns === null && ne !== null) { ne = naarW(ne, false, V); ns = dur[id] >= 1 ? plusW(ne, -(dur[id] - 1), V) : ne; }
    if (ns === null || ne === null) return { ok: false, fout: 'Geen nieuwe datum opgegeven.' };
    const oud = { start: m.start || '', eind: m.eind || '' };
    const nieuw = new Map([[id, { start: dymd(ns), eind: dymd(ne) }]]);
    const edges = actieveKant(P.depsEffectief(T, depsRuw)), inn = new Map(), uitg = new Map();
    T.forEach(t => { inn.set(t.id, []); uitg.set(t.id, []); });
    edges.forEach(e => { inn.get(e.naar).push(e); uitg.get(e.van).push(e); });
    const afstammelingen = new Set(), rij = [id];
    while (rij.length) { const x = rij.shift(); uitg.get(x).forEach(e => { if (!afstammelingen.has(e.naar)) { afstammelingen.add(e.naar); rij.push(e.naar); } }); }
    const delta = P.isYmd(oud.eind) ? tussenW(dnr(oud.eind), ne, V) : 0;
    const wijz = [];
    topo(T.map(t => t.id), edges).volgorde.forEach(i => {
      if (i === id || !afstammelingen.has(i)) return;
      const t = by.get(i); if (!P.isYmd(t.start) || !P.isYmd(t.eind)) return;
      let eis = null, door = '';
      inn.get(i).forEach(e => {
        const pv = nieuw.get(e.van) || by.get(e.van); if (!pv || !P.isYmd(pv.eind)) return;
        const c = eerstMogelijk(dnr(pv.eind), dur[i] === 0, e.lag, V);
        if (eis === null || c > eis) { eis = c; door = naamVan(T, e.van); }
      });
      const huidig = dnr(t.start); let nieuwS = huidig, reden = '';
      if (eis !== null && huidig < eis) { nieuwS = eis; reden = 'komt na ' + door; }
      else if (gelijk && delta !== 0) { nieuwS = Math.max(eis === null ? -Infinity : eis, plusW(huidig, delta, V)); reden = 'schuift mee'; }
      if (nieuwS !== huidig) { const s = naarW(nieuwS, true, V); nieuw.set(i, { start: dymd(s), eind: dymd(eindVan(s, dur[i])) }); wijz.push({ id: i, naam: t.naam, van: { start: t.start, eind: t.eind }, naar: nieuw.get(i), reden }); }
    });
    const alleEinden = T.map(t => (nieuw.get(t.id) || t).eind).filter(P.isYmd).sort();
    return { ok: true, modus: modus === 'strict' ? 'strict' : 'flexible', taak: { id, naam: m.naam, van: oud, naar: nieuw.get(id) }, wijzigingen: wijz,
      blokkerend: modus === 'strict' && wijz.length > 0, laatsteEind: alleEinden[alleEinden.length - 1] || '' };
  };
  // Een voorstel toepassen op een lijst taken (kopie). metOpvolgers=false: alleen de verzette taak zelf.
  P.voorstelToepassen = function (taken, voorstel, { metOpvolgers = true } = {}) {
    if (!voorstel || !voorstel.ok) return P.takenActief(taken).map(kopie);
    const nw = new Map([[voorstel.taak.id, voorstel.taak.naar]]);
    if (metOpvolgers) voorstel.wijzigingen.forEach(w => nw.set(w.id, w.naar));
    return P.takenActief(taken).map(t => { const x = kopie(t), n = nw.get(t.id); if (n) { x.start = n.start; x.eind = n.eind; } return x; });
  };

  // ══ P2: projectsjabloon ("Standaard interieurproject") ═════════════════════════════════════════════════
  // Een sjabloon is een startpunt, geen wet: fases, taken (activiteit, aandeel van het budget in %, duur) en afhankelijkheden met
  // lag. Bij "Gewonnen → project" en "Direct project" wordt het VOORGESTELD; toepassen gebeurt pas na bevestiging.
  //   { id, naam, omschrijving, fases:[{k, naam}], taken:[{k, naam, fase, activiteit, soort?:'mijlpaal', aandeel_pct, mensen?, duur_dagen?}],
  //     deps:[{van, naar, lag_dagen}], _gewijzigd, _vervallen }
  // Het aandeel is een percentage van de uren van de SOORT van de activiteit: de kantooruren (werkvoorbereiding, tekenwerk, kantoor)
  // en de werkplaatsuren (werkplaats, spuiten, montage, reizen) uit de calculatie worden elk apart over hun taken verdeeld.
  P.SJABLOON_STD_ID = 'std-interieur';
  P.sjabloonStd = () => kopie({
    id: P.SJABLOON_STD_ID, naam: 'Standaard interieurproject',
    omschrijving: 'Werkvoorbereiding, materiaal bestellen en leveren, zagen, CNC, afmonteren, spuiten, montage en oplevering. Start hiermee en pas aan wat in de praktijk anders loopt.',
    fases: [{ k: 'voorbereiding', naam: 'Voorbereiding' }, { k: 'productie', naam: 'Productie' }, { k: 'montage', naam: 'Montage en oplevering' }],
    taken: [
      { k: 'wvb', naam: 'Werkvoorbereiding', fase: 'voorbereiding', activiteit: 'werkvoorbereiding', aandeel_pct: 80, mensen: 1 },
      { k: 'bestellen', naam: 'Materiaal bestellen', fase: 'voorbereiding', activiteit: 'kantoor', aandeel_pct: 20, mensen: 1 },
      { k: 'materiaal_geleverd', naam: 'Materiaal geleverd', fase: 'voorbereiding', soort: 'mijlpaal' },
      { k: 'zagen', naam: 'Zagen', fase: 'productie', activiteit: 'werkplaats', aandeel_pct: 15, mensen: 1 },
      { k: 'cnc', naam: 'CNC', fase: 'productie', activiteit: 'werkplaats', aandeel_pct: 15, mensen: 1 },
      { k: 'afmonteren', naam: 'Afmonteren', fase: 'productie', activiteit: 'werkplaats', aandeel_pct: 25, mensen: 1 },
      { k: 'spuiten', naam: 'Spuiten', fase: 'productie', activiteit: 'spuiten', aandeel_pct: 15, mensen: 1 },
      { k: 'montage', naam: 'Montage', fase: 'montage', activiteit: 'montage', aandeel_pct: 30, mensen: 1 },
      { k: 'oplevering', naam: 'Oplevering', fase: 'montage', soort: 'mijlpaal' }],
    deps: [
      { van: 'wvb', naar: 'bestellen', lag_dagen: 0 }, { van: 'bestellen', naar: 'materiaal_geleverd', lag_dagen: 10 },   // 10 = levertijd in werkdagen (standaard)
      { van: 'materiaal_geleverd', naar: 'zagen', lag_dagen: 0 }, { van: 'zagen', naar: 'cnc', lag_dagen: 0 }, { van: 'cnc', naar: 'afmonteren', lag_dagen: 0 },
      { van: 'afmonteren', naar: 'spuiten', lag_dagen: 0 }, { van: 'spuiten', naar: 'montage', lag_dagen: 0 }, { van: 'montage', naar: 'oplevering', lag_dagen: 0 }],
  });
  // De sjablonen zoals de gebruiker ze ziet: de opgeslagen (zonder tombstones) plus de standaard als die er niet in staat.
  P.sjablonenEffectief = opgeslagen => {
    const l = (Array.isArray(opgeslagen) ? opgeslagen : []).filter(s => s && typeof s === 'object' && s.id && !s._vervallen);
    return l.some(s => s.id === P.SJABLOON_STD_ID) ? l : [P.sjabloonStd()].concat(l);
  };
  const soortVanActiviteit = k => { const a = P.activiteit(k); return a ? a.soort : 'overig'; };
  P.sjabloonSoort = t => t && t.soort === 'mijlpaal' ? 'mijlpaal' : soortVanActiviteit(t && t.activiteit);
  // Kloppen de gegevens? fouten (niet op te slaan) en waarschuwingen (mag wel).
  P.sjabloonControle = function (s) {
    const fouten = [], waarsch = [];
    if (!s || typeof s !== 'object') return { fouten: ['Geen sjabloon.'], waarschuwingen: [] };
    if (!String(s.naam || '').trim()) fouten.push('Geef het sjabloon een naam.');
    const taken = Array.isArray(s.taken) ? s.taken : [], keys = new Set();
    taken.forEach((t, i) => {
      const k = String(t && t.k || '').trim();
      if (!k) fouten.push('Taak ' + (i + 1) + ' mist een sleutel.'); else if (keys.has(k)) fouten.push('De sleutel "' + k + '" komt twee keer voor.'); else keys.add(k);
      if (!String(t && t.naam || '').trim()) fouten.push('Taak ' + (i + 1) + ' mist een naam.');
      if (t && t.soort !== 'mijlpaal' && t.activiteit && !P.activiteit(t.activiteit)) fouten.push('De activiteit van "' + (t.naam || k) + '" is onbekend.');
      if (t && t.soort !== 'mijlpaal' && !t.activiteit) waarsch.push('"' + (t.naam || k) + '" heeft geen activiteit: er komt geen budget.');
      if (t && Number(t.aandeel_pct) < 0) fouten.push('Het aandeel van "' + (t.naam || k) + '" is negatief.');
    });
    if (!taken.length) fouten.push('Een sjabloon heeft minstens één taak.');
    const deps = Array.isArray(s.deps) ? s.deps : [], paren = new Set();
    deps.forEach(d => {
      if (!keys.has(d.van) || !keys.has(d.naar)) { fouten.push('Een afhankelijkheid wijst naar een taak die niet bestaat.'); return; }
      if (d.van === d.naar) fouten.push('Een taak kan niet van zichzelf afhangen.');
      if (paren.has(d.van + '>' + d.naar)) fouten.push('Dubbele afhankelijkheid ' + d.van + ' → ' + d.naar + '.'); paren.add(d.van + '>' + d.naar);
      if (!(getal(d.lag_dagen) >= 0)) fouten.push('Een lag kan niet negatief zijn.');
    });
    if (!fouten.length && topo([...keys], deps.map(d => ({ van: d.van, naar: d.naar }))).kring.length) fouten.push('De afhankelijkheden vormen een kring.');
    ['kantoor', 'wp'].forEach(so => {
      const som = taken.filter(t => P.sjabloonSoort(t) === so).reduce((a, t) => a + (getal(t.aandeel_pct) || 0), 0), n = taken.filter(t => P.sjabloonSoort(t) === so).length;
      if (n && Math.round(som * 100) !== 10000) waarsch.push('De aandelen van de ' + P.SOORTEN[so].toLowerCase() + ' tellen op tot ' + (Math.round(som * 10) / 10) + '% in plaats van 100%.');
    });
    return { fouten, waarschuwingen: waarsch };
  };
  // Uren (minuten) uit de calculatie per soort: { kantoor, wp, overig }. null = geen ingevulde calculatie.
  P.calcBudgetSoorten = function (offerte) {
    const cb = P.calcBudget(offerte); if (!cb) return null;
    const uit = { kantoor: 0, wp: 0, overig: 0 };
    Object.entries(cb.per).forEach(([k, min]) => { uit[P.activiteit(k) ? P.activiteit(k).soort : 'overig'] += min; });
    return uit;
  };
  // Het budget over de taken verdelen volgens de percentages. Per soort sluit het op het hele budget (de laatste taak krijgt de rest).
  // Aandelen die niet op 100 uitkomen, worden naar verhouding omgerekend. { sleutel: minuten }
  P.sjabloonVerdeling = function (s, budget) {
    const uit = {};
    ['kantoor', 'wp'].forEach(so => {
      const ts = (s.taken || []).filter(t => P.sjabloonSoort(t) === so && getal(t.aandeel_pct) > 0), tot = Math.round(getal(budget && budget[so]));
      const som = ts.reduce((a, t) => a + getal(t.aandeel_pct), 0); if (!ts.length || !(tot > 0) || !(som > 0)) return;
      let rest = tot; ts.forEach((t, i) => { const m = i === ts.length - 1 ? rest : Math.min(rest, Math.round(tot * getal(t.aandeel_pct) / som)); uit[t.k] = m; rest -= m; });
    });
    return uit;
  };
  // Een kopie van het sjabloon zonder bepaalde taken (die je bij het toepassen overslaat). De keten blijft heel: elke voorganger wordt
  // gekoppeld aan elke opvolger van de weggelaten taak, met de wachttijden opgeteld. Het aandeel van de weggelaten taak vervalt (de
  // verdeling rekent de overige aandelen naar verhouding om).
  P.sjabloonZonder = function (s, keys) {
    const uit = new Set(keys || []), z = kopie(s);
    let deps = (z.deps || []).map(d => ({ van: d.van, naar: d.naar, lag_dagen: Math.max(0, Math.round(getal(d.lag_dagen))) }));
    uit.forEach(k => {
      const inn = deps.filter(d => d.naar === k), uitg = deps.filter(d => d.van === k);
      deps = deps.filter(d => d.van !== k && d.naar !== k);
      inn.forEach(a => uitg.forEach(b => { if (a.van !== b.naar && !deps.some(d => d.van === a.van && d.naar === b.naar)) deps.push({ van: a.van, naar: b.naar, lag_dagen: a.lag_dagen + b.lag_dagen }); }));
    });
    z.taken = (z.taken || []).filter(t => !uit.has(t.k)); z.deps = deps; if (uit.size) z._aangepast = true;
    return z;
  };
  // Het sjabloon omzetten in taken en afhankelijkheden voor een project (alleen berekenen; opslaan doet de aanroeper).
  // budget: { kantoor, wp } in minuten of null; leverdatum: ymd of ''; modus: 'terug' | 'vooruit' | '' (automatisch: terug met leverdatum).
  P.sjabloonToepassen = function (s, { budget = null, leverdatum = '', start = '', vrij = null, projectId = '', nieuwId = null, dagMin = 0, bestaand = [], modus = '' } = {}) {
    const ctl = P.sjabloonControle(s), waarsch = ctl.waarschuwingen.filter(w => !(s && s._aangepast && /tellen op tot/.test(w)));   // na weglaten rekent de verdeling naar verhouding om
    if (ctl.fouten.length) return { ok: false, fouten: ctl.fouten, waarschuwingen: waarsch };
    const mk = nieuwId || ((soort, k) => (soort === 'dep' ? 'd' : 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + k);
    const fase = {}; (s.fases || []).forEach(f => { fase[f.k] = f.naam; });
    const verd = P.sjabloonVerdeling(s, budget), idVan = {}, taken = [];
    s.taken.forEach(t => {
      const mijl = t.soort === 'mijlpaal', min = verd[t.k] || 0, mensen = Math.max(1, Math.round(getal(t.mensen)) || 1);
      const vast = Math.round(getal(t.vast_dagen));   // bij het toepassen met de hand aangepast
      const dagen = mijl ? 0 : (vast >= 1 ? vast : (min > 0 ? Math.max(1, Math.ceil(min / ((dagMin || P.DAG_MIN) * mensen))) : Math.max(1, Math.round(getal(t.duur_dagen)) || 1)));
      const x = { id: mk('taak', t.k), naam: t.naam, omschrijving: '', duur_uur: mijl ? 0 : P.minNaarUren(min), status: 'todo', tg_task_id: null, bron: 'sjabloon',
        soort: mijl ? 'mijlpaal' : 'taak', duur_dagen: dagen, sleutel: t.k, sjabloon_id: s.id };
      if (!mijl && t.activiteit) x.activiteit = t.activiteit;
      if (t.fase && fase[t.fase]) x.fase = fase[t.fase];
      if (projectId) x.project_id = projectId;
      idVan[t.k] = x.id; taken.push(x);
    });
    const deps = (s.deps || []).map((d, i) => { const x = { id: mk('dep', d.van + '_' + d.naar), van_taak: idVan[d.van], naar_taak: idVan[d.naar], type: 'FS', lag_dagen: Math.max(0, Math.round(getal(d.lag_dagen))), status: 'actief' }; if (projectId) x.project_id = projectId; return x; });
    const bestaandeSleutels = new Set(P.takenActief(bestaand).filter(t => t.sjabloon_id === s.id).map(t => t.sleutel));
    if (bestaandeSleutels.size) waarsch.push('Dit project heeft al ' + bestaandeSleutels.size + ' taak/taken uit dit sjabloon: toepassen voegt ze er nog een keer bij.');
    if (!budget) waarsch.push('Er is geen ingevulde calculatie: de taken krijgen geen budget (vul de raming per taak zelf in).');
    else ['kantoor', 'wp'].forEach(so => {
      if (getal(budget[so]) > 0 && !s.taken.some(t => P.sjabloonSoort(t) === so && getal(t.aandeel_pct) > 0)) waarsch.push('De ' + P.SOORTEN[so].toLowerCase() + ' uit de calculatie hebben in dit sjabloon geen taak met een aandeel: ze worden niet verdeeld.');
    });
    if (budget && budget.overig > 0) waarsch.push('Een deel van de calculatie (' + P.fmtUur(budget.overig) + ') is aan geen activiteit te koppelen en wordt niet verdeeld.');
    const wil = modus || (P.isYmd(leverdatum) ? 'terug' : 'vooruit'), opts = { start, leverdatum, vrij, dagMin };
    const terug = P.isYmd(leverdatum) ? P.plantTerug(taken, deps, opts) : null, vooruit = P.plantVooruit(taken, deps, opts);
    let gebruikt = wil === 'terug' && terug ? 'terug' : 'vooruit';
    const dat = gebruikt === 'terug' ? terug.datums : vooruit.datums;
    taken.forEach(t => { const d = dat[t.id]; if (d) { t.start = d.start; t.eind = d.eind; } });
    let tekort = 0, alternatief = null;
    if (gebruikt === 'terug' && terug.tekort > 0) {
      tekort = terug.tekort;
      waarsch.push('Terugrekenen vanaf ' + terug.leverdatum + ': de eerste taak had ' + tekort + ' werkdag' + (tekort === 1 ? '' : 'en') + ' voor ' + terug.start + ' moeten beginnen. Vooruit vanaf ' + terug.start + ' is het op zijn vroegst klaar op ' + vooruit.eind + '.');
      alternatief = { modus: 'vooruit', eind: vooruit.eind, datums: vooruit.datums };
    }
    const eersten = taken.map(t => t.start).filter(Boolean).sort(), einden = taken.map(t => t.eind).filter(Boolean).sort();
    return { ok: true, taken, deps, modus: gebruikt, waarschuwingen: waarsch, begin: eersten[0] || '', eind: einden[einden.length - 1] || '', tekort, alternatief, leverdatum: P.isYmd(leverdatum) ? leverdatum : '', verdeling: verd };
  };

  // ══ P2: bestelregels per project, gebundeld in de Bestellijst ═══════════════════════════════════════════
  // Dit bouwt voort op de bestaande Bestellijst (mt_bestellijst, v2.html): geen nieuw opslagmodel, geen gebroken data. Een bestelregel
  // is een bestaande regel met extra velden:
  //   { id, project_id, project (code), artikelsleutel, omschrijving (= materiaal), aantal, eenheid, bron:'vw'|'hhos'|'hand',
  //     status:'nodig'|'besteld'|'geleverd', besteld (afgeleid: status ≠ nodig, voor de oude schermen), _vs, _gewijzigd, _vervallen }
  // Oude regels zonder deze velden werken gewoon door: sleutel, status en bron worden dan afgeleid (de migratie legt ze vast).
  P.BESTEL_STATUS = ['nodig', 'besteld', 'geleverd'];
  P.BESTEL_STATUS_LABEL = { nodig: 'Nodig', besteld: 'Besteld', geleverd: 'Geleverd' };
  P.BESTEL_VELDEN = ['materiaal', 'omschrijving', 'artikel', 'artikelsleutel', 'aantal', 'eenheid', 'leverancier', 'status', 'besteld', 'project', 'project_id', 'bron'];
  const kleinNorm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(\d)\s*(mm|cm|m|x)\b/g, '$1 $2').replace(/[^a-z0-9.,\u00d7]+/g, ' ').trim().replace(/\s+/g, ' ');
  const EENHEDEN = { plaat: 'plaat', platen: 'plaat', pl: 'plaat', stuk: 'stuk', stuks: 'stuk', st: 'stuk', stk: 'stuk', pcs: 'stuk', 'm2': 'm²', 'm²': 'm²', 'vierkante meter': 'm²', m: 'm', mtr: 'm', meter: 'm', strekkende: 'm', lm: 'm', set: 'set', sets: 'set', paar: 'paar', liter: 'liter', l: 'liter', kg: 'kg', doos: 'doos', dozen: 'doos', rol: 'rol', rollen: 'rol' };
  P.eenheidNorm = e => { const s = String(e == null ? '' : e).trim().toLowerCase().replace(/\.$/, ''); return s === '' ? '' : (EENHEDEN[s] || s); };
  P.eenheidTekst = (eenheid, aantal) => {
    const e = P.eenheidNorm(eenheid), een = Math.abs(getal(aantal) - 1) < 1e-9;
    if (e === '') return een ? 'stuk' : 'stuks';
    if (e === 'plaat') return een ? 'plaat' : 'platen';
    if (e === 'stuk') return een ? 'stuk' : 'stuks';
    if (e === 'doos') return een ? 'doos' : 'dozen';
    if (e === 'rol') return een ? 'rol' : 'rollen';
    return e;
  };
  // Dezelfde artikelen krijgen dezelfde sleutel: de artikelcode als die er is (VW), anders de genormaliseerde omschrijving, plus de
  // platenmaat (HHOS) want twee maten van dezelfde plaat zijn twee artikelen. Hoofdletters, spaties en leestekens tellen niet.
  P.artikelSleutel = b => {
    const art = kleinNorm(b && b.artikel), oms = kleinNorm((b && (b.omschrijving || b.materiaal)) || ''), maat = kleinNorm(b && b.platenmaat);
    return (art ? 'a:' + art : 'm:' + oms) + (maat ? '|' + maat : '');
  };
  P.bestelSleutelVan = b => (b && b.artikelsleutel) || P.artikelSleutel(b);
  P.bestelOms = b => String((b && (b.omschrijving || b.materiaal || b.artikel)) || '');
  P.bestelStatus = b => {
    const s = b && b.status;
    if (P.BESTEL_STATUS.includes(s)) return s === 'nodig' && b.besteld ? 'besteld' : s;
    return b && b.besteld ? 'besteld' : 'nodig';
  };
  P.bestelBron = b => (b && ['vw', 'hhos', 'hand'].includes(b.bron)) ? b.bron : (b && b.platenmaat ? 'hhos' : (b && b.artikel ? 'vw' : 'hand'));
  P.bestelProject = b => String((b && (b.project_id || b.project)) || '');
  // Een nieuwe regel (alle velden gevuld). datum: ymd van vandaag (de aanroeper geeft die mee: geen klok in deze module).
  P.bestelRegelNieuw = function ({ omschrijving = '', artikel = '', aantal = 1, eenheid = '', bron = 'hand', project = '', project_id = '', leverancier = '', categorie = 'overig', platenmaat = '', prijsLaatst = 0, datum = '', id = '' } = {}) {
    const r = { id: id || ('bl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), materiaal: String(omschrijving), omschrijving: String(omschrijving),
      categorie, leverancier, prijsLaatst, datum, besteld: false, status: 'nodig', aantal: getal(aantal) > 0 ? getal(aantal) : 1, eenheid: P.eenheidNorm(eenheid), bron: ['vw', 'hhos', 'hand'].includes(bron) ? bron : 'hand' };
    if (artikel) r.artikel = String(artikel);
    if (platenmaat) r.platenmaat = platenmaat;
    if (project) r.project = project;
    if (project_id) r.project_id = project_id;
    r.artikelsleutel = P.artikelSleutel(r);
    return r;
  };
  // Status zetten: houdt het oude `besteld` gelijk. Wijzigt de regel ter plekke.
  P.bestelStatusZet = (b, status) => { if (!P.BESTEL_STATUS.includes(status)) return false; b.status = status; b.besteld = status !== 'nodig'; return true; };
  // Na een wijziging: de velden die anders zijn dan voor de wijziging krijgen een stempel (voor het samenvoegen per veld).
  P.bestelVeldStempel = function (voor, na, { t = Date.now(), door = '', dev = '' } = {}) {
    const vs = Object.assign({}, kopie((voor && voor._vs) || {}), kopie(na._vs) || {}), ovs = (voor && voor._vs) || {};
    P.BESTEL_VELDEN.forEach(f => {
      if (gelijk(na[f], voor && voor[f])) return;
      if (na._vs && na._vs[f] && JSON.stringify(na._vs[f]) !== JSON.stringify(ovs[f])) return;   // stempel bewust gezet (conflictkeuze): niet overschrijven
      const vorig = tijdVan(ovs[f]); vs[f] = { t: Math.max(t, vorig + 1), dev, rev: revVan(ovs[f]) + 1, door, basis: vorig };
    });
    if (Object.keys(vs).length) na._vs = vs;
    return na;
  };
  // Samenvoegen van de hele bestellijst (twee arrays): per regel (id) per veld de nieuwste stempel; zonder stempels het nieuwste
  // record (zoals het oude gedrag); een tombstone volgt het nieuwste record, dus terugzetten blijft kunnen.
  const isMeta = x => !!x && typeof x === 'object' && x.id === '__migratie';
  P.bestelSamen = (lokaal, spData) => {
    const L = leesStrikt(lokaal, o => P.bestelBestandVorm(o), [], 'samenvoegen'), R = leesStrikt(spData, o => P.bestelBestandVorm(o), [], 'samenvoegen');
    const uit = sorteerOpId(lijstSamenMet(P.BESTEL_VELDEN, { iso: true, legacy: true }, L.filter(x => !isMeta(x)), R.filter(x => !isMeta(x))));
    const meta = metaSamen(L.find(isMeta), R.find(isMeta)); if (meta) { meta.id = '__migratie'; uit.push(canon(meta)); }
    return uit;
  };
  // ── Overstap naar mt_bestellijst_v2 (zelfde patroon als mt_project_taken_v2) ──────────────────────────
  // De nieuwe app leest en schrijft alleen mt_bestellijst_v2; het oude mt_bestellijst blijft van oude app-versies. De overstap gebeurt één keer
  // (de eerste nieuwe client die v2 niet vindt, aanmaken met If-None-Match: *; wie 412/409 krijgt leest dat bestand). Bestaande regel-id's
  // blijven; een regel zonder (of met een dubbel) id krijgt een willekeurig id. Alle regels blijven, ook de van de lijst gehaalde (tombstones).
  // Elk ingevuld veld zonder stempel krijgt er een met het tijdstip van de overstap. In de regel met id "__migratie" staat wat nodig is om later
  // te zien of een oude app-versie het oude bestand nog wijzigde. lijst = de regels van de overstap; oud (optioneel) = de lijst waarvan de hash komt.
  P.bestelConflictOplos = P.conflictOplos;
  P.bestelInhoudHash = b => hash36(stabiel(P.BESTEL_VELDEN.map(f => norm(b && b[f])).concat([!!(b && b._vervallen)])));
  const bestelProjectCode = b => String((b && (b.project || b.project_id)) || '');
  const bestelFingerprint = b => hash36(stabiel([b && b.materiaal, b && b.omschrijving, b && b.artikel, bestelProjectCode(b), b && b.datum, b && b.categorie, b && b.leverancier].map(norm)));
  // Per legacy-regel een bronsleutel (fingerprint + volgnummer voor gelijke regels); ook de van de lijst gehaalde regels tellen mee.
  P.bestelBronSleutels = function (lijst) {
    const uit = [], teller = {};
    (Array.isArray(lijst) ? lijst : []).forEach(b => { if (!b || typeof b !== 'object' || isMeta(b)) return; const fp = bestelFingerprint(b); teller[fp] = (teller[fp] || 0) + 1; uit.push({ regel: b, sleutel: fp + '|' + teller[fp] }); });
    return uit;
  };
  // sp = het oude bestand PRECIES zoals gelezen (leidend); lokaal = de lokale kopie van het oude bestand (aanvullingen, ook zonder id, blijven;
  // een afwijkende lokale versie van een regel die SharePoint al kent wordt een zichtbare afwijking, SharePoint wint).
  P.bestelV2Opbouw = function (sp, { lokaal = null, nu = Date.now(), dev = '', door = '', uuid = null } = {}) {
    const maakId = uuid || (() => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    const spLijst = Array.isArray(sp) ? sp : [], spRecs = P.bestelBronSleutels(spLijst), spBron = new Set(spRecs.map(x => x.sleutel)), spId = new Map();
    spRecs.forEach(x => { if (x.regel.id !== undefined && x.regel.id !== null && x.regel.id !== '' && !spId.has(String(x.regel.id))) spId.set(String(x.regel.id), x.regel); });
    const samen = spRecs.map(x => ({ r: x.regel, sleutel: x.sleutel, uitSP: true })), migratieAfwijkingen = [];
    P.bestelBronSleutels(lokaal).forEach(x => {
      const id = x.regel.id !== undefined && x.regel.id !== null && x.regel.id !== '' ? String(x.regel.id) : '';
      if (id && spId.has(id)) {
        const s = spId.get(id), velden = P.BESTEL_VELDEN.filter(f => !gelijk(x.regel[f], s[f])).map(f => ({ veld: f, oud: norm(x.regel[f]), nu: norm(s[f]) }));
        if (!!x.regel._vervallen !== !!s._vervallen) velden.push({ veld: '_vervallen', oud: x.regel._vervallen ? 'van de lijst gehaald' : null, nu: s._vervallen ? 'van de lijst gehaald' : null });
        if (velden.length) migratieAfwijkingen.push({ id, naam: P.bestelOms(x.regel), velden, hash: P.bestelInhoudHash(x.regel) });
        return;
      }
      if (!id && spBron.has(x.sleutel)) return;   // hetzelfde id-loze record staat al in het SharePoint-bestand
      samen.push({ r: x.regel, sleutel: x.sleutel, uitSP: false });
    });
    const uit = [], basis = {}, codes = {}, bron = {}, zonderId = [], dubbel = [], lokaalMeta = {}, gebruikt = new Set();
    samen.forEach(e => {
      const b = kopie(e.r), orgId = b.id; let nieuw = false;
      if (orgId === undefined || orgId === null || orgId === '') { b.id = maakId(); zonderId.push({ naam: P.bestelOms(b), id: b.id, sleutel: e.sleutel }); nieuw = true; }
      else if (gebruikt.has(String(orgId))) { b.id = maakId(); dubbel.push({ naam: P.bestelOms(b), oud_id: String(orgId), id: b.id, sleutel: e.sleutel }); nieuw = true; }
      gebruikt.add(String(b.id)); bron[e.sleutel] = b.id;
      if (!nieuw) { if (e.uitSP) { basis[b.id] = P.bestelInhoudHash(e.r); codes[b.id] = bestelProjectCode(e.r); } else lokaalMeta[b.id] = P.bestelInhoudHash(e.r); }
      const vs = Object.assign({}, b._vs || {});
      P.BESTEL_VELDEN.forEach(f => { if (b[f] !== undefined && !vs[f]) vs[f] = { t: nu, dev, rev: 1, door, basis: 0 }; });
      if (Object.keys(vs).length) b._vs = vs;
      if (!b._gewijzigd) b._gewijzigd = new Date(nu).toISOString();
      uit.push(b);
    });
    uit.push({ id: '__migratie', _meta: true, tijd: nu, dev, door, oud_hash: hash36(stabiel(spLijst)), basis, codes, bron, zonder_id: zonderId, dubbel, lokaal: lokaalMeta, migratie_afwijkingen: migratieAfwijkingen, afgehandeld: {} });
    return uit;
  };
  // Vorm van een (oud) bestellijstbestand: een array van objecten. Geldige JSON met een andere vorm is een FOUT en nooit "leeg". → '' of een foutomschrijving; null = er is geen bestand.
  P.bestelBestandVorm = function (lijst) {
    if (lijst === null || lijst === undefined) return '';
    if (!Array.isArray(lijst)) return 'het bestand is geen lijst met bestelregels';
    if (lijst.some(b => !b || typeof b !== 'object' || Array.isArray(b))) return 'de lijst bevat een regel die geen object is';
    return '';
  };
  // Het voorbeeld dat beheer ziet vóór de overstap: aantallen, id-loze en dubbele regels, lokale aanvullingen en afwijkingen tussen lokaal en SharePoint
  // (volledige inhoud per veld). Gebruikt dezelfde opbouw als de echte overstap.
  P.bestelOverstapVoorbeeld = function (sp, lokaal) {
    const fout = P.bestelBestandVorm(sp) || P.bestelBestandVorm(lokaal);
    if (fout) return { fout };
    const v = P.bestelV2Opbouw(sp || [], { lokaal: lokaal || null, nu: 0, uuid: () => 'voorbeeld' }), m = v.find(isMeta), regels = v.filter(x => !isMeta(x));
    const sharepoint = (sp || []).length;
    return { totaal: regels.length, sharepoint, lokaal_erbij: regels.length - sharepoint, vervallen: regels.filter(x => x._vervallen).length, zonderId: m.zonder_id.length, dubbel: m.dubbel.length, afwijkingen: m.migratie_afwijkingen };
  };
  // Wijkt de oude bestellijst van déze browser af van het oude remote bestand? MULTISET per (projectcode, inhoudshash); wat er lokaal méér staat is een niet-
  // gesynchroniseerde oude wijziging van deze browser. Geen schrijfroute: alleen downloaden of naar beheer sturen. negeer = "project|hash". → [{regel, hash, sleutel}]
  P.bestelLokaalAfwijking = function (lokaal, remote, negeer) {
    if (!lokaal || P.bestelBestandVorm(lokaal) || P.bestelBestandVorm(remote)) return [];
    const nee = negeer instanceof Set ? negeer : new Set(negeer || []), tel = {}, uit = [];
    (remote || []).forEach(b => { if (!b || isMeta(b)) return; const k = bestelProjectCode(b) + '|' + P.bestelInhoudHash(b); tel[k] = (tel[k] || 0) + 1; });
    lokaal.forEach(b => { if (!b || isMeta(b)) return; const h = P.bestelInhoudHash(b), k = bestelProjectCode(b) + '|' + h; if (tel[k] > 0) { tel[k]--; return; } if (!nee.has(k)) uit.push({ regel: kopie(b), hash: h, sleutel: k }); });
    return uit;
  };
  // Wat is er te bekijken voor beheer? (a) wat bij de overstap een nieuw id kreeg of van SharePoint afweek (info), (b) wat een oude app-versie sindsdien
  // in het OUDE bestand veranderde: 'nieuw', 'dubbel-nieuw', 'gewijzigd', 'verwijderd', 'verhuisd' (ander project) en 'herstel' (gewijzigd terwijl de regel
  // in v2 van de lijst gehaald is). Nooit automatisch overnemen. Een afgehandelde afwijking (sleutel + inhoudshash) komt niet terug.
  // → { gewijzigd, afwijkingen, info }, elk { soort, sleutel, id, naam, hash, velden:[{veld,oud,nu}], regel }
  P.bestelOudAfwijkingen = function (meta, oudNu, v2) {
    if (!meta || typeof meta !== 'object') return { gewijzigd: false, afwijkingen: [], info: [] };
    const uit = [], voeg = a => { if (!heeftKlaar(meta, a.sleutel, a.hash)) uit.push(Object.assign({ velden: [], regel: null }, a)); };
    (meta.zonder_id || []).forEach(z => voeg({ soort: 'info-zonder-id', sleutel: 'zid:' + z.id, id: z.id, naam: z.naam, hash: 'i' }));
    (meta.dubbel || []).forEach(z => voeg({ soort: 'info-dubbel-id', sleutel: 'dub:' + z.id, id: z.id, naam: z.naam, hash: 'i' }));
    (meta.migratie_afwijkingen || []).forEach(z => voeg({ soort: 'migratie', sleutel: 'mig:' + z.id, id: z.id, naam: z.naam, hash: z.hash, velden: z.velden }));
    const INFO = ['info-zonder-id', 'info-dubbel-id', 'migratie'];
    const gewijzigd = Array.isArray(oudNu) && hash36(stabiel(oudNu)) !== meta.oud_hash;
    const klaarMelden = () => ({ gewijzigd, afwijkingen: uit.filter(a => !INFO.includes(a.soort)), info: uit.filter(a => INFO.includes(a.soort)) });
    if (!gewijzigd) return klaarMelden();
    const basis = meta.basis || {}, lok = meta.lokaal || {}, codes = meta.codes || {}, bron = meta.bron || {}, nu = new Map(), inOud = new Set();
    (Array.isArray(v2) ? v2 : []).forEach(b => { if (b && typeof b === 'object' && !isMeta(b) && b.id !== undefined) nu.set(String(b.id), b); });
    P.bestelBronSleutels(oudNu).forEach(({ regel: b, sleutel }) => {
      const hasId = b.id !== undefined && b.id !== null && b.id !== '', h = P.bestelInhoudHash(b);
      if (!hasId) { if (!bron[sleutel]) voeg({ soort: 'nieuw', sleutel: 'bron:' + sleutel, id: null, naam: P.bestelOms(b), hash: h, regel: kopie(b) }); return; }
      const id = String(b.id);
      if (inOud.has(id)) { if (!bron[sleutel]) voeg({ soort: 'dubbel-nieuw', sleutel: 'dubnu:' + sleutel, id, naam: P.bestelOms(b), hash: h, regel: kopie(b) }); return; }   // dubbel id: alleen de eerste is te volgen
      inOud.add(id);
      const eerder = basis[id] !== undefined ? basis[id] : lok[id], huidig = nu.get(id), verwijderdInV2 = !huidig || !!huidig._vervallen;
      if (eerder === undefined) { if (verwijderdInV2) voeg({ soort: 'nieuw', sleutel: id, id, naam: P.bestelOms(b), hash: h, regel: kopie(b) }); return; }
      const verhuisd = codes[id] !== undefined && codes[id] !== bestelProjectCode(b);
      if (eerder === h && !verhuisd) return;
      if (verwijderdInV2) {   // de oude app wijzigde of verhuisde (alleen een andere projectcode telt ook) een regel die in v2 van de lijst gehaald is
        if (eerder !== h || verhuisd) voeg({ soort: 'herstel', sleutel: id, id, naam: P.bestelOms(b), hash: h + (verhuisd ? '@' + bestelProjectCode(b) : ''), velden: verhuisd ? [{ veld: 'project', oud: bestelProjectCode(b), nu: codes[id] }] : [], regel: kopie(b) });
        return;
      }
      const velden = P.BESTEL_VELDEN.filter(f => !gelijk(b[f], huidig[f])).map(f => ({ veld: f, oud: norm(b[f]), nu: norm(huidig[f]) }));
      if (!!b._vervallen !== !!huidig._vervallen) velden.push({ veld: '_vervallen', oud: b._vervallen ? 'van de lijst gehaald' : null, nu: huidig._vervallen ? 'van de lijst gehaald' : null });
      if (verhuisd) voeg({ soort: 'verhuisd', sleutel: id, id, naam: P.bestelOms(b), hash: h + '@' + bestelProjectCode(b), velden: [{ veld: 'project', oud: bestelProjectCode(b), nu: bestelProjectCode(huidig) }].concat(velden.filter(v => v.veld !== 'project' && v.veld !== 'project_id')), regel: kopie(b) });
      else if (velden.length) voeg({ soort: 'gewijzigd', sleutel: id, id, naam: P.bestelOms(b), hash: h, velden, regel: kopie(b) });
    });
    Object.keys(basis).forEach(id => { if (!inOud.has(id)) { const huidig = nu.get(id); if (huidig && !huidig._vervallen) voeg({ soort: 'verwijderd', sleutel: id, id, naam: P.bestelOms(huidig), hash: 'weg' }); } });
    return klaarMelden();
  };

  // ── Gebundelde weergave over alle projecten ────────────────────────────────────────────────────────
  // Dezelfde artikelsleutel en eenheid worden opgeteld, ook regels zonder project (met de hand toegevoegd). Per groep de verdeling per project.
  // opts.nummerVan(regel) → het projectnummer om te tonen (bv. 260803); zonder: de projectcode.
  const fmtAantal = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
  // opts.projectSleutel(regel) → de sleutel van het project (bv. project_id, ook voor oude regels met alleen een projectcode), zodat één
  // project niet als twee telt; zonder: project_id, anders de projectcode.
  P.bestelBundel = function (regels, { nummerVan = null, projectSleutel = null, toonGeleverd = false } = {}) {
    const groepen = new Map();
    (Array.isArray(regels) ? regels : []).forEach(b => {
      if (!b || typeof b !== 'object' || b._vervallen) return;
      const st = P.bestelStatus(b); if (st === 'geleverd' && !toonGeleverd) return;
      const sleutel = P.bestelSleutelVan(b), eenheid = P.eenheidNorm(b.eenheid), gk = sleutel + '|' + eenheid;
      let g = groepen.get(gk);
      if (!g) { g = { sleutel, eenheid, omschrijving: P.bestelOms(b), aantal: 0, regels: [], perProject: [], statussen: { nodig: 0, besteld: 0, geleverd: 0 }, leveranciers: [] }; groepen.set(gk, g); }
      const aantal = getal(b.aantal) > 0 ? getal(b.aantal) : 1, pk = String((projectSleutel && projectSleutel(b)) || P.bestelProject(b) || '');
      const nr = pk ? String((nummerVan && nummerVan(b)) || b.project || pk) : '';
      g.aantal += aantal; g.regels.push({ id: b.id, project: pk, nummer: nr, aantal, status: st, bron: P.bestelBron(b) }); g.statussen[st]++;
      let p = g.perProject.find(x => x.project === pk);
      if (!p) { p = { project: pk, nummer: nr, aantal: 0, ids: [], statussen: { nodig: 0, besteld: 0, geleverd: 0 } }; g.perProject.push(p); }
      p.aantal += aantal; p.ids.push(b.id); p.statussen[st]++;
      if (b.leverancier && !g.leveranciers.includes(b.leverancier)) g.leveranciers.push(b.leverancier);
    });
    const alle = [...groepen.values()];
    alle.forEach(g => {
      g.projectNrs = [...new Set(g.perProject.map(p => p.nummer).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'nl', { numeric: true }));
      g.perProject.sort((x, y) => x.nummer.localeCompare(y.nummer, 'nl', { numeric: true }));
      const s = g.statussen, n = s.nodig + s.besteld + s.geleverd;
      g.status = s.nodig === n ? 'nodig' : s.besteld === n ? 'besteld' : s.geleverd === n ? 'geleverd' : 'gemengd';
      g.tekst = P.bestelBundelTekst(g);
    });
    return alle.sort((x, y) => x.omschrijving.localeCompare(y.omschrijving, 'nl', { sensitivity: 'base' }));
  };
  // "Egger W980 18 mm — 7 platen (260803, 260807)"
  P.bestelBundelTekst = g => g.omschrijving + ' — ' + fmtAantal(g.aantal) + ' ' + P.eenheidTekst(g.eenheid, g.aantal) + (g.projectNrs && g.projectNrs.length ? ' (' + g.projectNrs.join(', ') + ')' : '');
  // Afvinken in de bundel: welke regels veranderen? projecten = null (alle) of een lijst projectsleutels (bv. [één project]).
  // Dezelfde regels als in het project: wat hier verandert, ziet het project, en andersom.
  P.bestelAfvinkPlan = function (groep, status, { projecten = null } = {}) {
    if (!groep || !P.BESTEL_STATUS.includes(status)) return [];
    const sel = projecten ? new Set(projecten) : null;
    return groep.regels.filter(r => (!sel || sel.has(r.project)) && r.status !== status).map(r => ({ id: r.id, van: r.status, naar: status }));
  };
  // Moet de vraag "alle projecten of één?" gesteld worden? Alleen bij een groep met regels voor meer dan één project.
  P.bestelMeerdereProjecten = g => !!g && new Set(g.regels.filter(r => r.project).map(r => r.project)).size > 1;
  // Het plan toepassen op een lijst regels (kopie, voor de tests en voor het scherm als je het pure resultaat wilt).
  P.bestelPlanToepassen = (regels, plan) => { const per = new Map(plan.map(p => [String(p.id), p.naar])); return regels.map(b => { const n = per.get(String(b.id)); if (!n) return b; const x = kopie(b); P.bestelStatusZet(x, n); return x; }); };

  // ── Migratie van oude regels (droogloop: er wordt niets geschreven) ───────────────────────────────────
  // Per actieve regel zonder de nieuwe velden: wat er bij komt. projectVoor(code) → project_id of ''; een regel waarvan het project niet
  // te vinden is, krijgt geen project_id en staat in `onbekend`. Bestaande waarden worden nooit overschreven.
  P.bestelMigratie = function (regels, { projectVoor = null } = {}) {
    const patches = [], onbekend = [];
    (Array.isArray(regels) ? regels : []).forEach(b => {
      if (!b || typeof b !== 'object' || b._vervallen) return;
      const p = {};
      if (!b.artikelsleutel) p.artikelsleutel = P.artikelSleutel(b);
      if (!P.BESTEL_STATUS.includes(b.status)) p.status = P.bestelStatus(b);
      if (!['vw', 'hhos', 'hand'].includes(b.bron)) p.bron = P.bestelBron(b);
      if (!b.omschrijving && (b.materiaal || b.artikel)) p.omschrijving = P.bestelOms(b);
      if (b.eenheid !== undefined && b.eenheid !== P.eenheidNorm(b.eenheid) && P.eenheidNorm(b.eenheid)) p.eenheid = P.eenheidNorm(b.eenheid);
      if (b.project && !b.project_id) { const pid = projectVoor ? projectVoor(b.project) : ''; if (pid) p.project_id = pid; else onbekend.push({ id: b.id, project: b.project }); }
      if (Object.keys(p).length) patches.push({ id: b.id, omschrijving: P.bestelOms(b), patch: p });
    });
    return { patches, onbekend, aantal: patches.length };
  };

  // ── Taken die op klaar kunnen: voorstellen, nooit automatisch ────────────────────────────────────────
  // "Materiaal geleverd" (sleutel materiaal_geleverd) mag op klaar als ALLE bestelregels van het project geleverd zijn;
  // "Materiaal bestellen" (sleutel bestellen) als alles minstens besteld is. Zonder bestelregels geen voorstel.
  P.bestelTaakVoorstellen = function (taken, regels, { project_id = '', codes = [] } = {}) {
    const mijn = (Array.isArray(regels) ? regels : []).filter(b => b && typeof b === 'object' && !b._vervallen && ((project_id && b.project_id === project_id) || (b.project && codes.includes(b.project))));
    if (!mijn.length) return [];
    const st = mijn.map(P.bestelStatus), alleGeleverd = st.every(s => s === 'geleverd'), alleBesteld = st.every(s => s !== 'nodig');
    const uit = [];
    P.takenActief(taken).forEach(t => {
      if (t.status === 'klaar') return;
      if (t.sleutel === 'materiaal_geleverd' && alleGeleverd) uit.push({ taak_id: t.id, naam: t.naam, reden: 'alle ' + mijn.length + ' bestelregels zijn geleverd' });
      else if (t.sleutel === 'bestellen' && alleBesteld) uit.push({ taak_id: t.id, naam: t.naam, reden: 'alle ' + mijn.length + ' bestelregels zijn besteld of geleverd' });
    });
    return uit;
  };

  // ── Uploads herkennen aan het projectnummer ──────────────────────────────────────────────────────────
  // tekst = bestandsnaam, mapnaam of de Commission uit het bestand; kandidaten = [{key, nummers:[projectnummer, werkcode, …]}].
  // Een nummer moet als los woord voorkomen (260803 in "260803 keuken.csv", niet in 12608034). 0 treffers = onbekend, >1 = kiezen.
  P.projectUitTekst = function (tekst, kandidaten) {
    const t = String(tekst == null ? '' : tekst).toLowerCase(), uit = [];
    (kandidaten || []).forEach(k => {
      const hit = (k.nummers || []).map(n => String(n || '').trim().toLowerCase()).filter(n => n.length >= 4).find(n => {
        const re = new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)'); return re.test(t);
      });
      if (hit) uit.push({ key: k.key, nummer: hit });
    });
    return uit;
  };

  root.MTPlanning = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
