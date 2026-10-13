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

  // ── Taken: velden met een eigen stempel (zoals de projectvelden van L1) ───────────────────────────────
  // Opslag = mt_project_taken_v2 { projectcode: [taak…], __migratie }, een uitbreiding van het oude mt_project_taken; elke taak: id, project_id, naam, omschrijving,
  // duur_uur (de raming; budget in minuten = duur_uur × 60), activiteit, status, toegewezen (team-slug, optioneel),
  // prioriteit, afhankelijk_van, tg_task_id (optionele Toggl-koppeling), tg_sync (koppeltabel), _vs, _veldconflict, _vervallen.
  // Stempel per veld: {t (ms), dev (apparaat), rev (teller per veld), door, basis (t van de stand waarop de wijziging voortbouwde)}.
  // Totale volgorde: t, dan dev, dan rev. Identieke stempels met verschillende waarden zijn altijd een conflict.
  // tg_sync is een eigen veld met een eigen stempel en hoort bij precies één tg_task_id (external_id); wijzigt tg_task_id, dan vervalt tg_sync.
  P.TAAK_VELDEN = ['naam', 'omschrijving', 'duur_uur', 'activiteit', 'status', 'toegewezen', 'prioriteit', 'afhankelijk_van', 'tg_task_id', 'tg_sync'];
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
  const maxStempel = t => Math.max(Number(t && t._gewijzigd) || 0, ...Object.values((t && t._vs) || {}).map(tijdVan));
  // zonder tg_task_id is alleen een mislukte poging (external_id leeg) een geldige koppeltabel
  const syncGeldig = x => !x.tg_sync || ((x.tg_task_id == null || x.tg_task_id === '') ? String(x.tg_sync.external_id || '') === '' : String(x.tg_sync.external_id) === String(x.tg_task_id));

  // Nieuwe stand van één project wegschrijven: oud = ruwe opslag (met tombstones), nieuw = de actieve taken zoals de
  // bewerkers ze nu hebben. Gewijzigde velden krijgen een stempel; verdwenen taken een tombstone.
  P.takenStempel = function (oud, nieuw, { nu = Date.now(), door = '', dev = '', projectId = '' } = {}) {
    const per = new Map(); (oud || []).forEach(o => { if (o && o.id) per.set(o.id, o); });
    const gezien = new Set(), uit = [];
    (nieuw || []).forEach(t => {
      if (!t || typeof t !== 'object') return;
      const x = kopie(t), o = x.id ? per.get(x.id) : null;
      if (x.id) gezien.add(x.id);
      if (projectId && !x.project_id) x.project_id = projectId;
      if (o && o.project_id && !x.project_id) x.project_id = o.project_id;
      // een koppeltabel van een andere Toggl-taak is waardeloos: nieuwe tg_task_id → oude tg_sync vervalt
      if (o && !gelijk(x.tg_task_id, o.tg_task_id) && gelijk(x.tg_sync, o.tg_sync)) delete x.tg_sync;
      if (!syncGeldig(x)) delete x.tg_sync;
      const vs = Object.assign({}, kopie(o && o._vs) || {}, kopie(x._vs) || {});
      const ovs = (o && o._vs) || {};
      P.TAAK_VELDEN.forEach(f => {
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
      if (o && o._vervallen) x._gewijzigd = Math.max(nu, (Number(o._gewijzigd) || 0) + 1);   // teruggezet na verwijderen
      uit.push(x);
    });
    per.forEach(o => {   // verdwenen = tombstone (niet fysiek wissen: een oude kopie zet de taak anders terug)
      if (gezien.has(o.id)) return;
      if (o._vervallen) { uit.push(o); return; }
      const g = Object.assign({}, kopie(o), { _vervallen: true, _gewijzigd: Math.max(nu, (Number(o._gewijzigd) || 0) + 1) });
      g._ts = { t: g._gewijzigd, dev, rev: revVan(o._ts) + 1, door };
      if (door) g._door = door;
      uit.push(g);
    });
    return uit;
  };
  P.takenActief = lijst => (Array.isArray(lijst) ? lijst : []).filter(t => t && typeof t === 'object' && !t._vervallen);

  // ── Overstap naar mt_project_taken_v2 ─────────────────────────────────────────────────────────────────
  // De nieuwe app leest en schrijft alleen mt_project_taken_v2; het oude bestand mt_project_taken blijft van oude app-versies en wordt door
  // de nieuwe app nooit meer geschreven. De overstap gebeurt één keer, door de eerste nieuwe client die v2 niet vindt (het bestand wordt
  // alleen aangemaakt als het nog niet bestaat; wie een 412/409 krijgt leest dat bestand en migreert NIET opnieuw), zodat de id's maar één
  // keer ontstaan. Bestaande id's blijven; een taak zonder (of met een dubbel) id krijgt een willekeurig id (uuid). Elk ingevuld veld
  // krijgt een stempel met het tijdstip van de overstap. In de sleutel "__migratie" staat wat nodig is om later te zien of een oude
  // app-versie het oude bestand nog wijzigde (hash van het oude bestand, hash per taak, wat de mens al afhandelde).
  const hash36 = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const stabiel = v => Array.isArray(v) ? '[' + v.map(stabiel).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stabiel(v[k])).join(',') + '}' : JSON.stringify(v === undefined ? null : v);
  P.taakInhoudHash = t => hash36(stabiel(P.TAAK_VELDEN.filter(f => f !== 'tg_sync').map(f => norm(t && t[f]))));
  P.takenBestandHash = obj => hash36(stabiel(obj || {}));
  P.takenV2Opbouw = function (oud, { nu = Date.now(), dev = '', door = '', uuid = null } = {}) {
    const maakId = uuid || (() => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    const bron = oud && typeof oud === 'object' && !Array.isArray(oud) ? oud : {};
    const data = {}, basis = {}, gebruikt = new Set();
    for (const code of Object.keys(bron)) {
      if (code.startsWith('__') || !Array.isArray(bron[code])) continue;
      data[code] = [];
      for (const t0 of bron[code]) {
        if (!t0 || typeof t0 !== 'object' || t0._vervallen) continue;
        const t = kopie(t0); delete t._vs; delete t._veldconflict;
        const orgId = t.id;
        if (!t.id || gebruikt.has(t.id)) t.id = maakId();
        gebruikt.add(t.id);
        if (orgId && orgId === t.id) basis[t.id] = P.taakInhoudHash(t0);
        const vs = {};
        P.TAAK_VELDEN.forEach(f => { if (t[f] !== undefined) vs[f] = { t: nu, dev, rev: 1, door, basis: 0 }; });
        if (Object.keys(vs).length) { t._vs = vs; t._gewijzigd = nu; }
        data[code].push(t);
      }
    }
    data.__migratie = { tijd: nu, dev, door, oud_hash: P.takenBestandHash(bron), basis, afgehandeld: {} };
    return data;
  };
  // Wat is er in het OUDE bestand veranderd sinds de overstap? Per taak: 'nieuw' (er is er een bij gekomen), 'gewijzigd' (andere inhoud dan
  // bij de overstap én anders dan nu in v2) of 'verwijderd'. Wat de mens al afhandelde (meta.afgehandeld[id] = inhoudshash, of 'weg') telt niet mee.
  // Nooit automatisch overnemen: de aanroeper laat de mens kiezen. → { gewijzigd, afwijkingen:[{code,id,naam,soort,hash,velden:[{veld,oud,nu}],taak}] }
  P.takenOudAfwijkingen = function (meta, oudNu, v2) {
    if (!meta || !oudNu || typeof oudNu !== 'object') return { gewijzigd: false, afwijkingen: [] };
    const gewijzigd = P.takenBestandHash(oudNu) !== meta.oud_hash;
    if (!gewijzigd) return { gewijzigd: false, afwijkingen: [] };
    const klaar = meta.afgehandeld || {}, basis = meta.basis || {}, nu = new Map(), uit = [];
    Object.keys(v2 || {}).forEach(c => { if (!c.startsWith('__') && Array.isArray(v2[c])) v2[c].forEach(t => { if (t && t.id) nu.set(t.id, { code: c, taak: t }); }); });
    const inOud = new Set(), dubbel = new Set();
    Object.keys(oudNu).forEach(code => {
      if (code.startsWith('__') || !Array.isArray(oudNu[code])) return;
      oudNu[code].forEach(t => {
        if (!t || typeof t !== 'object' || !t.id) return;
        if (inOud.has(t.id)) { dubbel.add(t.id); return; }   // een dubbel id in het oude bestand is niet te volgen: alleen de eerste telt
        inOud.add(t.id);
        const h = P.taakInhoudHash(t), eerder = basis[t.id];
        if (eerder === h || klaar[t.id] === h) return;
        const huidig = nu.get(t.id);
        if (eerder === undefined) { if (!huidig || huidig.taak._vervallen) uit.push({ code, id: t.id, naam: t.naam || '', soort: 'nieuw', hash: h, velden: [], taak: kopie(t) }); return; }
        const velden = P.TAAK_VELDEN.filter(f => f !== 'tg_sync' && !gelijk(t[f], huidig && !huidig.taak._vervallen ? huidig.taak[f] : undefined)).map(f => ({ veld: f, oud: norm(t[f]), nu: huidig ? norm(huidig.taak[f]) : null }));
        if (velden.length) uit.push({ code, id: t.id, naam: t.naam || '', soort: 'gewijzigd', hash: h, velden, taak: kopie(t) });
      });
    });
    Object.keys(basis).forEach(id => { if (!inOud.has(id) && klaar[id] !== 'weg') { const huidig = nu.get(id); if (huidig && !huidig.taak._vervallen) uit.push({ code: huidig.code, id, naam: huidig.taak.naam || '', soort: 'verwijderd', hash: 'weg', velden: [], taak: null }); } });
    return { gewijzigd: true, afwijkingen: uit };
  };

  // Eén taak samenvoegen: per veld wint de hoogste stempel (t, dev, rev). Een verwijdering wint altijd (L1a). Een wijziging die
  // de winnaar niet kende (haar stempel nieuwer dan de basis van de winnaar) of een identieke stempel met een andere waarde
  // wordt bewaard als _veldconflict[veld]; een oude, ongestempelde waarde is nooit "stil" weg. Alleen de koppeltabel (tg_sync)
  // houdt een afwijkende status 'fout' of 'extern-verwijderd' in een conflict; verder wint de nieuwste.
  function taakSamen(l, r) {
    if (l._vervallen || r._vervallen) {   // verwijderen wint; twee verwijderingen: dezelfde totale volgorde (tijd, apparaat, teller)
      if (!(l._vervallen && r._vervallen)) return kopie(l._vervallen ? l : r);
      const sl = l._ts || { t: l._gewijzigd }, sr = r._ts || { t: r._gewijzigd };
      return kopie(volgorde(sl, sr) > 0 ? l : r);
    }
    const nl = maxStempel(l), nr = maxStempel(r);
    const basis = kopie(nl > nr ? l : r);   // niet-getrackte velden (bron, project_id…) van de nieuwste kant
    const andere = nl > nr ? r : l;
    Object.keys(andere).forEach(k => { if (!(k in basis) && !k.startsWith('_')) basis[k] = kopie(andere[k]); });
    const w = basis; w._vs = {}; const conflicten = {};
    P.TAAK_VELDEN.forEach(f => {
      const sl = (l._vs || {})[f], sr = (r._vs || {})[f], c0 = volgorde(sl, sr);
      let win, ander, sw, so;
      if (c0 > 0) { win = l; ander = r; sw = sl; so = sr; } else { win = r; ander = l; sw = sr; so = sl; }   // gelijk → de andere kant (SharePoint)
      if (win[f] === undefined) delete w[f]; else w[f] = kopie(win[f]);
      if (sw) w._vs[f] = kopie(sw);
      const bt = tijdVan(sw), bb = Number(sw && sw.basis) || 0, ot = tijdVan(so), verschil = !gelijk(ander[f], win[f]);
      let c = null;
      if (verschil && !(f === 'tg_sync' && c0 !== 0 && !(ander[f] && (ander[f].status === 'fout' || ander[f].status === 'extern-verwijderd')))) {
        const identiek = c0 === 0, ongestempeld = !ot && !!bt;
        // een ongestempelde afwijking (ook een lege waarde, zolang het veld er expliciet staat) tegenover een gestempelde is zichtbaar
        if (identiek || (ot && ot > bb) || (ongestempeld && (f in ander))) c = { waarde: kopie(norm(ander[f])), door: (so && so.door) || '', t: ot || bt };
      }
      [l, r].forEach(z => { const oc = z._veldconflict && z._veldconflict[f]; if (oc && Number(oc.t) > bb && !gelijk(oc.waarde, win[f]) && (!c || Number(oc.t) > c.t)) c = kopie(oc); });
      if (c) conflicten[f] = c;
    });
    if (!syncGeldig(w)) { delete w.tg_sync; delete w._vs.tg_sync; delete conflicten.tg_sync; }   // koppeltabel van een andere Toggl-taak vervalt
    if (Object.keys(conflicten).length) w._veldconflict = conflicten; else delete w._veldconflict;
    if (!Object.keys(w._vs).length) delete w._vs;
    const m = Math.max(maxStempel(w), Number(l._gewijzigd) || 0, Number(r._gewijzigd) || 0); if (m) w._gewijzigd = m;
    return w;
  }
  // De overstap-metagegevens: de oudste overstap blijft (er is er maar één), wat afgehandeld is wordt samengevoegd.
  function metaSamen(a, b) {
    if (!a || typeof a !== 'object') return b && typeof b === 'object' ? kopie(b) : null;
    if (!b || typeof b !== 'object') return kopie(a);
    const basis = (Number(a.tijd) || 0) <= (Number(b.tijd) || 0) ? a : b;
    const m = kopie(basis); m.afgehandeld = Object.assign({}, kopie(b.afgehandeld) || {}, kopie(a.afgehandeld) || {});
    return m;
  }
  // Samenvoeger voor het hele bestand { code: [taak…] , __migratie }: per code en taak-id samenvoegen. Wat aan één kant staat, blijft staan.
  P.takenSamen = function (lokaal, remote) {
    const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
    const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const L = obj(lees(lokaal)), R = obj(lees(remote)), uit = {};
    for (const code of new Set([...Object.keys(R), ...Object.keys(L)])) {
      if (code.startsWith('__')) continue;   // metagegevens (zie metaSamen)
      const a = Array.isArray(L[code]) ? L[code] : [], b = Array.isArray(R[code]) ? R[code] : [];
      const per = new Map(), los = new Map();
      b.forEach(x => { if (x && x.id) per.set(x.id, { r: x, l: null }); else if (x != null) los.set(JSON.stringify(x), x); });
      a.forEach(x => { if (x && x.id) { const e = per.get(x.id); if (e) e.l = x; else per.set(x.id, { r: null, l: x }); } else if (x != null) los.set(JSON.stringify(x), x); });
      uit[code] = [...[...per.values()].map(e => e.l && e.r ? taakSamen(e.l, e.r) : kopie(e.l || e.r)), ...los.values()];
    }
    const meta = metaSamen(L.__migratie, R.__migratie); if (meta) uit.__migratie = meta;
    return uit;
  };
  // Een conflict oplossen: 'andere' neemt de bewaarde waarde over, 'eigen' houdt de huidige. Beide krijgen een nieuwe stempel
  // die boven het conflict ligt, zodat de keuze ook op de andere pc het conflict wegneemt. Wijzigt `taak` ter plekke.
  P.conflictOplos = function (taak, veld, kies, { nu = Date.now(), door = '', dev = '' } = {}) {
    const c = taak && taak._veldconflict && taak._veldconflict[veld]; if (!c) return false;
    const vs0 = (taak._vs || {})[veld], vorig = tijdVan(vs0);
    if (kies === 'andere') { if (c.waarde === null || c.waarde === undefined) delete taak[veld]; else taak[veld] = kopie(c.waarde); }
    taak._vs = taak._vs || {};
    taak._vs[veld] = { t: Math.max(nu, vorig + 1, Number(c.t) + 1), dev, rev: revVan(vs0) + 1, door, basis: Math.max(vorig, Number(c.t)) };
    delete taak._veldconflict[veld]; if (!Object.keys(taak._veldconflict).length) delete taak._veldconflict;
    taak._gewijzigd = maxStempel(taak);
    return true;
  };

  // ── Toggl-koppeltabel per taak ─────────────────────────────────────────────────────────────────────
  // tg_sync = {provider:'toggl', external_id (= tg_task_id), laatst_gezien (ms), hash (van de gespiegelde velden), status:'ok'|'fout'|'extern-verwijderd', fout}
  // Eenrichting MT → Toggl: gespiegeld worden alleen naam en status. De taak in MT blijft altijd de bron.
  P.tgHash = t => { const s = JSON.stringify([String((t && t.naam) || ''), String((t && t.status) || 'todo')]); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
  // 'koppelen' (nog geen Toggl-taak), 'herkoppelen' (koppeltabel ontbreekt of hoort bij een andere Toggl-taak), 'bijwerken' (MT wijkt af
  // van wat we laatst naar Toggl stuurden), 'actueel', 'extern-verwijderd'
  P.tgActie = t => {
    if (!t) return 'actueel';
    if (!t.tg_task_id) return 'koppelen';
    const s = t.tg_sync;
    if (!s || String(s.external_id) !== String(t.tg_task_id)) return 'herkoppelen';
    if (s.status === 'extern-verwijderd') return 'extern-verwijderd';
    return s.hash === P.tgHash(t) ? 'actueel' : 'bijwerken';
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

  root.MTPlanning = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
