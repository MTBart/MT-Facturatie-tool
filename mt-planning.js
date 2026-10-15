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

  // ── Uurtarieven synchroniseren (ronde 8) ──
  // mt_uurtarieven = { <naam>: tarief, _std: tarief, _vs: stempel per tarief, _veldconflict, _gewijzigd }. De lezers (uurtarief, uurtariefStd) zien alleen de tarieven;
  // de stempels maken de samenvoeging per tarief mogelijk: de hoogste stempel (tijd, apparaat, teller) wint, deterministisch. Een ongestempelde waarde (zoals de
  // lokale waarde van vóór de synchronisatie) of een gelijktijdige afwijkende wijziging wordt nooit stil overschreven maar blijft zichtbaar als _veldconflict.
  const tariefMeta = k => k === '_vs' || k === '_veldconflict' || k === '_gewijzigd' || k === '_door' || k === 'id';
  const tarievenLees = (v, naam) => {
    if (v === null || v === undefined || v === '') return {};
    let o = v; if (typeof v === 'string') { try { o = JSON.parse(v); } catch (e) { throw new Error(naam + ': ongeldige JSON'); } }
    if (o === null) return {};
    if (typeof o !== 'object' || Array.isArray(o)) throw new Error(naam + ': geen object');
    const uit = {};
    Object.keys(o).forEach(k => { if (tariefMeta(k)) { if (o[k] !== undefined) uit[k] = kopie(o[k]); return; } const n = typeof o[k] === 'string' && o[k].trim() !== '' ? Number(o[k]) : o[k]; if (typeof n === 'number' && isFinite(n)) uit[k] = n; });
    return uit;
  };
  P.tariefVelden = (...recs) => [...new Set(recs.flatMap(r => Object.keys(r || {}).filter(k => !tariefMeta(k))))].sort();
  P.tarievenSamen = function (lokaal, remote) {
    const L = tarievenLees(lokaal, 'tarieven'), R = tarievenLees(remote, 'tarieven'), velden = P.tariefVelden(L, R);
    if (!velden.length) return canon(Object.keys(L).length >= Object.keys(R).length ? L : R);
    if (!P.tariefVelden(L).length) return canon(R);
    if (!P.tariefVelden(R).length) return canon(L);
    return canon(recSamen(velden, {}, L, R));
  };
  // Een nieuwe stand wegschrijven: alleen de gewijzigde tarieven krijgen een stempel; een tarief dat bewust wordt aangepast lost zijn conflict op.
  P.tarievenStempel = function (oud, nieuw, { nu = Date.now(), door = '', dev = '' } = {}) {
    const O = tarievenLees(oud, 'tarieven'), N = tarievenLees(nieuw, 'tarieven'), velden = P.tariefVelden(O, N), x = {};
    velden.forEach(f => { if (N[f] !== undefined) x[f] = N[f]; });
    if (O._veldconflict) { const c = {}; Object.keys(O._veldconflict).forEach(f => { if (gelijk(x[f], O[f])) c[f] = O._veldconflict[f]; }); if (Object.keys(c).length) x._veldconflict = c; }
    const r = stempelMet(velden, [Object.assign({ id: 'uurtarieven' }, kopie(O))], [Object.assign({ id: 'uurtarieven' }, x)], { nu, door, dev })[0];
    delete r.id; return canon(r);
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
  P.TAAK_BASIS_VELDEN = ['naam', 'omschrijving', 'duur_uur', 'activiteit', 'status', 'toegewezen', 'prioriteit', 'afhankelijk_van', 'tg_task_id', 'tg_sync',
    'start', 'eind', 'duur_dagen', 'soort', 'fase', 'sleutel'];   // de velden van de eerste versie: de hashes voor de overstap (oud_hash, basis) blijven hierop rekenen
  // klaar_op = de dag waarop de taak klaar is gemeld (ymd); tg_pending = de duurzame Toggl-intentie {op, ts, ...} die vóór een Toggl-actie wordt opgeslagen.
  // wacht_reden = waarom een taak op status 'wacht' staat (stap 2, mobiel: Bezig · Klaar · Wacht met een verplichte reden).
  // Alle drie zijn gestempelde velden, maar zonder conflictmelding: de nieuwste stempel wint (ZONDER_CONFLICT).
  // voorstel = de markering "door werkplaats" van een gemelde taak of bestelregel (wie, rol, wanneer); kantoor haalt hem er met Overnemen af.
  P.TAAK_VELDEN = P.TAAK_BASIS_VELDEN.concat(['klaar_op', 'tg_pending', 'wacht_reden', 'voorstel']);
  const ZONDER_CONFLICT = new Set(['klaar_op', 'tg_pending', 'wacht_reden', 'voorstel']);
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
  // Rollenmatrix (ronde 8): welk recht heeft een wijziging van de takenlijst van een project nodig? Eén plek, ook voor de pure tests.
  //   'taken:alles'                = elk ander veld wijzigen, een taak verwijderen of de Toggl-koppeling (tg_task_id) wijzigen;
  //   'taken:status-nieuw|alles'   = alleen de status wijzigen (met de bijbehorende Toggl-markeringen en de afrondingsdatum) en/of nieuwe taken toevoegen;
  //   null                         = niets inhoudelijks gewijzigd.
  // Velden die met een status meebewegen: status, klaar_op, wacht_reden, tg_pending, tg_sync. Meta-velden (met _ ervoor) tellen niet mee.
  P.TAAK_STATUS_VELDEN = ['status', 'klaar_op', 'tg_pending', 'tg_sync', 'wacht_reden'];
  // batch: een bulk-actie (AI-takenlijst, takenketen, sjabloon) vraagt altijd "alles", ook als de regels alleen maar nieuw zijn. Een Toggl-intentie met een andere actie dan
  // "status" (koppelen, bijwerken, verwijderen) is nooit een gewone statuswijziging: ook dat vraagt "alles", zodat het opslaan van de intentie de Toggl-actie niet legitimeert.
  P.tgPendingOp = p => (!p || typeof p !== 'object') ? '' : (p.op || (p.verwijderen ? 'verwijderen' : (p.status ? 'status' : '')));
  P.takenRechtNodig = function (oud, nieuw, { batch = false } = {}) {
    const o = P.takenActief(oud), n = P.takenActief(nieuw), oudBy = new Map(o.map(t => [t.id, t]));
    const nieuwIds = new Set(n.map(t => t.id));
    if (o.some(t => !nieuwIds.has(t.id))) return 'taken:alles';          // verwijderd
    let statusOfNieuw = false;
    for (const t of n) {
      const v = oudBy.get(t.id);
      if (!v) { statusOfNieuw = true; continue; }                          // nieuwe taak
      const sleutels = new Set(Object.keys(t).concat(Object.keys(v)));
      for (const k of sleutels) {
        if (k.charAt(0) === '_') continue;
        if (stabiel(norm(t[k])) === stabiel(norm(v[k]))) continue;
        if (P.TAAK_STATUS_VELDEN.indexOf(k) < 0) return 'taken:alles';
        if (k === 'tg_pending' && [P.tgPendingOp(t[k]), P.tgPendingOp(v[k])].some(o => o && o !== 'status')) return 'taken:alles';
        statusOfNieuw = true;
      }
    }
    return statusOfNieuw ? (batch ? 'taken:alles' : 'taken:status-nieuw|alles') : null;
  };

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
  P.taakInhoudHash = t => hash36(stabiel(P.TAAK_BASIS_VELDEN.filter(f => f !== 'tg_sync').map(f => norm(t && t[f]))));
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
        const velden = P.TAAK_BASIS_VELDEN.filter(f => f !== 'tg_sync' && !gelijk(x.taak[f], s[f])).map(f => ({ veld: f, oud: norm(x.taak[f]), nu: norm(s[f]) }));
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
      const velden = P.TAAK_BASIS_VELDEN.filter(f => f !== 'tg_sync' && !gelijk(t[f], huidig.taak[f])).map(f => ({ veld: f, oud: norm(t[f]), nu: norm(huidig.taak[f]) }));
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
      if (verschil && !ZONDER_CONFLICT.has(f) && !(f === 'tg_sync' && c0 !== 0 && !(ander[f] && (ander[f].status === 'fout' || ander[f].status === 'extern-verwijderd')))) {
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
    const zonderKlaar = m => { const c = Object.assign({}, m); delete c.afgehandeld; return stabiel(c); };
    const ta = Number(a.tijd) || 0, tb = Number(b.tijd) || 0;
    const basis = ta !== tb ? (ta < tb ? a : b) : (zonderKlaar(a) <= zonderKlaar(b) ? a : b);   // gelijke tijd: de laagste JSON-tekst, onafhankelijk van de argumentvolgorde
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
  // Een opvolger wacht (ronde 8) tot de voorganger klaar is PLUS de wachttijd (lag) in werkdagen: voorganger klaar op dag D met lag L → de opvolger kan starten op de
  // L-de werkdag na D (lag 0: direct). D is de dag waarop de taak klaar is gemeld (klaar_op); zonder die datum (een oude taak) geldt de berekende datum: het geplande
  // einde van de voorganger. Zonder beide gebeurt er niets extra. Vrije dagen: opts.vrij, anders P.vrijeDagenBron() (v2 zet die op de vrije dagen uit Beheer).
  // → per taak { wacht, op: [{id, naam, lag, tot?, bron?}], tot? }: een voorganger die nog niet klaar is heeft geen "tot"; een lopende wachttijd wel (ymd, bron 'klaar_op' | 'berekend').
  P.vrijeDagenBron = null;
  P.wachtOverzicht = function (taken, depsRuw, opts) {
    const o = opts || {}, T = P.takenActief(taken), by = new Map(T.map(t => [t.id, t])), uit = {};
    const V = P.vrijSet(o.vrij !== undefined && o.vrij !== null ? o.vrij : (typeof P.vrijeDagenBron === 'function' ? P.vrijeDagenBron() : null)), vandaag = P.isYmd(o.vandaag) ? o.vandaag : P.vandaagYmd();
    T.forEach(t => { uit[t.id] = { wacht: false, op: [] }; });
    actieveKant(P.depsEffectief(T, depsRuw)).forEach(e => {
      const v = by.get(e.van), n = by.get(e.naar);
      if (!v || !n || n.status === 'klaar') return;
      if (v.status !== 'klaar') { uit[n.id].wacht = true; uit[n.id].op.push({ id: v.id, naam: v.naam, lag: e.lag }); return; }
      const lag = Math.max(0, Math.round(getal(e.lag))); if (!lag) return;   // geen wachttijd: een klare voorganger geeft direct vrij
      const gemeld = P.isYmd(v.klaar_op), basis = gemeld ? v.klaar_op : (P.isYmd(v.eind) ? v.eind : ''); if (!basis) return;
      const tot = P.addWerkdagen(basis, lag, V);
      if (vandaag < tot) { const w = uit[n.id]; w.wacht = true; w.op.push({ id: v.id, naam: v.naam, lag, tot, bron: gemeld ? 'klaar_op' : 'berekend' }); if (!w.tot || tot > w.tot) w.tot = tot; }
    });
    return uit;
  };
  P.taakWacht = (taak, taken, depsRuw, opts) => (taak && P.wachtOverzicht(taken, depsRuw, opts)[taak.id]) || { wacht: false, op: [] };
  // De status zoals getoond: een taak die nog niet gestart is en wacht, heet 'wachten'.
  P.taakStatusEff = (taak, taken, depsRuw, opts) => {
    const st = (taak && taak.status) || 'todo';
    return st === 'todo' && P.taakWacht(taak, taken, depsRuw, opts).wacht ? 'wachten' : st;
  };
  // Tekst voor "wacht op": de naam, bij een lopende wachttijd ook tot wanneer (de aanroeper geeft de datumopmaak mee).
  P.wachtOpTekst = (w, datumTekst) => ((w && w.op) || []).map(x => x.naam + (x.tot ? ' (wachttijd ' + x.lag + ' werkdag' + (x.lag === 1 ? '' : 'en') + ', tot ' + (datumTekst ? datumTekst(x.tot) : x.tot) + ')' : '')).join(', ');

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
    // Stabiele id's per project en sjabloonstap (ronde 8): twee keer toepassen (ook op twee pc's tegelijk) geeft dezelfde taken en dus geen dubbelen; zonder project willekeurig.
    const mk = nieuwId || ((soort, k) => projectId ? P.stabielId(soort === 'dep' ? 'd_' : 't_', 'sjabloon', projectId, s.id, k) : (soort === 'dep' ? 'd' : 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + k);
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
    if (bestaandeSleutels.size) waarsch.push('Dit project heeft al ' + bestaandeSleutels.size + ' taak/taken uit dit sjabloon: die worden niet nog een keer toegevoegd; alleen wat ontbreekt komt erbij.');
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
  // BASIS = de velden van de overstap (de hashes en de vergelijking met het oude bestand blijven hierop rekenen); voorstel = de markering "door werkplaats" (stap 2):
  // een gestempeld veld, zodat "Overnemen" (de markering eraf) ook na samenvoegen blijft staan.
  P.BESTEL_BASIS_VELDEN = ['materiaal', 'omschrijving', 'artikel', 'artikelsleutel', 'aantal', 'eenheid', 'leverancier', 'status', 'besteld', 'project', 'project_id', 'bron'];
  P.BESTEL_VELDEN = P.BESTEL_BASIS_VELDEN.concat(['voorstel']);
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
  // Stabiele id's (ronde 8): dezelfde invoer geeft op elke pc dezelfde id, zodat twee keer importeren of toepassen (ook gelijktijdig op twee pc's) na het samenvoegen
  // geen dubbele regels geeft. SHA-256 van de canonieke delen; een voorvoegsel maakt de soort herkenbaar.
  P.stabielId = (voorvoegsel, ...delen) => String(voorvoegsel) + P.sha256(stabiel(delen.map(d => String(d == null ? '' : d)))).slice(0, 24);
  // Een geïmporteerde bestelregel (VW-kostenberekening of HHOS-NCR): project + bron + bronbestand + artikel + eenheid.
  P.bestelImportId = ({ project_id = '', project = '', bron = '', bestand = '', artikel = '', eenheid = '' } = {}) =>
    P.stabielId('imp_', 'bestel-import', project_id || project, bron, String(bestand || '').trim().toLowerCase(), kleinNorm(artikel), P.eenheidNorm(eenheid));
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
  P.bestelInhoudHash = b => hash36(stabiel(P.BESTEL_BASIS_VELDEN.map(f => norm(b && b[f])).concat([!!(b && b._vervallen)])));
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
        const s = spId.get(id), velden = P.BESTEL_BASIS_VELDEN.filter(f => !gelijk(x.regel[f], s[f])).map(f => ({ veld: f, oud: norm(x.regel[f]), nu: norm(s[f]) }));
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
  // Verweesde back-up (ronde 8): wat staat in de back-up van een verweesde lokale v2 dat niet (met dezelfde inhoud) in de lijst staat die de overstap gaat aanmaken?
  // Alleen weergave en export: overnemen gaat met de hand. MULTISET per (project, inhoudshash), alleen actieve regels. → { backup, nieuw, gelijk, alleenBackup:[…] }
  P.bestelBackupVergelijk = function (backup, nieuw) {
    const act = l => (Array.isArray(l) ? l : []).filter(b => b && typeof b === 'object' && !isMeta(b) && !b._vervallen);
    const bk = act(backup), nw = act(nieuw), alleen = P.bestelLokaalAfwijking(bk, nw, null);
    return { backup: bk.length, nieuw: nw.length, gelijk: bk.length - alleen.length,
      alleenBackup: alleen.map(a => ({ id: a.regel.id, naam: a.regel.materiaal || a.regel.omschrijving || '', aantal: a.regel.aantal, eenheid: a.regel.eenheid || '', project: bestelProjectCode(a.regel) })) };
  };
  P.takenBackupVergelijk = function (backup, nieuw) {
    const act = o => { const u = {}; Object.keys(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).forEach(c => { if (c.startsWith('__') || !Array.isArray(o[c])) return; u[c] = P.takenActief(o[c]); }); return u; };
    const tel = o => Object.keys(o).reduce((n, c) => n + o[c].length, 0), bk = act(backup), nw = act(nieuw), alleen = P.takenLokaalAfwijking(bk, nw, null);
    return { backup: tel(bk), nieuw: tel(nw), gelijk: tel(bk) - alleen.length, alleenBackup: alleen.map(a => ({ code: a.code, id: a.taak.id, naam: a.taak.naam || '', status: a.taak.status || 'todo' })) };
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
      const velden = P.BESTEL_BASIS_VELDEN.filter(f => !gelijk(b[f], huidig[f])).map(f => ({ veld: f, oud: norm(b[f]), nu: norm(huidig[f]) }));
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

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // Stap 2 — Mijn werk / Vandaag (telefoon) en de gedeelde schrijfkern
  // ----------------------------------------------------------------------------------------------
  // Wat v2.html en mobiel.html samen gebruiken: de rechtnamen, de laadstanden van de takenlijst en de bestellijst (met hun
  // meldingen), de back-up van een verweesde lokale kopie, de schemaversie, de status van een taak (Open · Bezig · Wacht · Klaar)
  // en het lezen-samenvoegen-schrijven naar SharePoint (ETag/412-merge) met dezelfde stempels en tombstones als de cockpit.
  // Alle opslag komt van buiten (sp = de _SP uit mt-core.js, storage = localStorage), zodat dit zonder browser te testen is.
  // ══════════════════════════════════════════════════════════════════════════════════════════════

  // ── Schemaversie van de projecttaken ──
  // De laagste app-versie die mt_project_taken_v2 mag schrijven staat in de teller (GET /teller/status → schema_min). Is die hoger dan
  // de versie van déze app (v2.html: PROJ_SCHEMA), dan schrijft de app niet meer. Onbekend (nog niet gelezen) = geen blokkade.
  P.SCHEMA = 5;
  P.SCHEMA_TEKST = 'Er is een nieuwere versie van de tool in gebruik — herlaad de pagina. Wijzigingen aan projecten en taken worden tot dan niet opgeslagen in SharePoint.';
  P.schemaGeblokkeerd = (schemaMin, eigen) => schemaMin !== null && schemaMin !== undefined && schemaMin !== '' && Number.isFinite(Number(schemaMin)) && Number(schemaMin) > (eigen == null ? P.SCHEMA : Number(eigen));

  // ── De rechtnamen (zelfde matrix als de worker en de cockpit) ──
  // taken "status-nieuw|alles" = de status wijzigen en een nieuwe taak toevoegen; taken "alles" = velden, uren, afhankelijkheden, verwijderen;
  // bestellijst "toevoegen|alles" = een nieuwe regel; bestellijst "alles" = status, aantal, verwijderen. UREN_BOEKEN: tijd boeken en de timer.
  P.ROL = { TAAK_STATUS: 'taken:status-nieuw|alles', TAAK_ALLES: 'taken:alles', BESTEL_TOEV: 'bestellijst:toevoegen|alles', BESTEL_ALLES: 'bestellijst:alles', UREN_BOEKEN: 'uren:eigen|team|alles' };

  // ── De laadstand van een gedeelde lijst (takenlijst of bestellijst) ──
  // 'klaar' = geladen en bewerkbaar; alles anders is alleen-lezen met een melding. De volgorde van de controles is die van de cockpit:
  // backup-mislukt > verweesd > geblokkeerd > (time-out | laden) > (klaar | overzetten).
  P.lijstStaat = function ({ backupFout = false, verweesd = false, geblokkeerd = false, gereed = true, timeout = false, heeftV2 = false } = {}) {
    if (backupFout) return 'backup-mislukt';
    if (verweesd) return 'verweesd';
    if (geblokkeerd) return 'geblokkeerd';
    if (!gereed) return timeout ? 'time-out' : 'laden';
    return heeftV2 ? 'klaar' : 'overzetten';
  };
  P.lijstStatusTekst = function (soort, staat, vormFout) {
    const t = soort === 'bestel';
    switch (staat) {
      case 'backup-mislukt': return t
        ? 'De nieuwe bestellijst ontbreekt op SharePoint en er kon geen back-up van de lokale kopie worden gemaakt (opslag vol?). Maak eerst ruimte vrij of exporteer de lokale bestellijst; er is niets gewijzigd of overgezet.'
        : 'De nieuwe takenlijst ontbreekt op SharePoint en er kon geen back-up van de lokale kopie worden gemaakt (opslag vol?). Maak eerst ruimte vrij of exporteer de lokale takenlijst; er is niets gewijzigd of overgezet.';
      case 'verweesd': return t
        ? 'De nieuwe bestellijst bestaat niet (meer) op SharePoint terwijl deze browser een lokale kopie had; die is als back-up bewaard en wordt niet gebruikt. Beheer moet de bestellijst opnieuw overzetten.'
        : 'De nieuwe takenlijst bestaat niet (meer) op SharePoint terwijl deze browser een lokale kopie had; die is als back-up bewaard en wordt niet gebruikt. Beheer moet de taken opnieuw overzetten.';
      case 'geblokkeerd': return vormFout
        ? (t ? 'De nieuwe bestellijst op SharePoint heeft een verkeerde vorm (' : 'De nieuwe takenlijst op SharePoint heeft een verkeerde vorm (') + vormFout + '). Er is niets gewijzigd; laat beheer dit controleren.'
        : (t ? 'De bestellijst is geblokkeerd: de laadstap voor de nieuwe bestellijst is mislukt. Er is niets gewijzigd.'
          : 'De taken zijn geblokkeerd (de laadstap voor de nieuwe takenlijst is mislukt): herlaad de pagina. Taken bewerken kan pas daarna.');
      case 'time-out': return t ? 'De bestellijst laden duurt te lang of is mislukt.' : 'Taken laden duurt te lang of is mislukt. Probeer het opnieuw.';
      case 'overzetten': return t ? 'De bestellijst wordt overgezet door beheer. Tot die tijd is hij alleen-lezen.' : 'De taken worden overgezet door beheer. Tot die tijd zijn ze alleen-lezen.';
      case 'laden': return t ? 'De bestellijst wordt geladen…' : 'Taken laden…';
      case 'schema': return P.SCHEMA_TEKST;
      default: return '';
    }
  };

  // ── Een lokale v2 zonder v2 op SharePoint wordt NIET gebruikt (verweesd) ──
  // De lokale kopie gaat naar een back-upsleutel (<sleutel>_verweesd_<tijd>) en de sleutel zelf wordt leeggemaakt. Fail-closed: de back-up telt pas
  // als hij is teruggelezen; mislukt dat, dan blijft de lokale kopie staan en is de uitkomst 'backup-mislukt'.
  // → { actie: 'geen' | 'verweesd' | 'backup-mislukt', backupSleutel? }
  P.verweesdOpruimen = function (storage, sleutel, nu) {
    let raw = null; try { raw = storage.getItem(sleutel); } catch (e) { raw = null; }
    if (raw === null || raw === undefined) return { actie: 'geen' };
    const bk = sleutel + '_verweesd_' + (nu == null ? Date.now() : nu); let bewaard = false;
    try { storage.setItem(bk, raw); bewaard = storage.getItem(bk) === raw; } catch (e) { bewaard = false; }
    if (!bewaard) { try { storage.removeItem(bk); } catch (e) {} return { actie: 'backup-mislukt' }; }
    try { storage.removeItem(sleutel); } catch (e) {}
    return { actie: 'verweesd', backupSleutel: bk };
  };

  // ── De status van een taak: Open (todo) · Bezig · Wacht (altijd met een reden) · Klaar ──
  P.TAAK_STATUSSEN = ['todo', 'bezig', 'wacht', 'klaar'];
  P.TAAK_STATUS_LABEL = { todo: 'Open', bezig: 'Bezig', wacht: 'Wacht', klaar: 'Klaar' };
  // De dag waarop een taak klaar is gemeld (lokale datum); weg zodra de taak weer open staat.
  P.klaarOp = function (t, status) { if (status === 'klaar') { if (!P.isYmd(t.klaar_op)) t.klaar_op = P.vandaagYmd(); } else delete t.klaar_op; };
  // Zet de status van `t` (wijzigt ter plekke). Wacht vraagt een reden; een andere status wist die. → { ok: true } | { ok: false, fout }
  P.statusZet = function (t, status, { reden = '' } = {}) {
    if (!t || typeof t !== 'object' || !P.TAAK_STATUSSEN.includes(status)) return { ok: false, fout: 'Onbekende status.' };
    const r = String(reden == null ? '' : reden).replace(/\s+/g, ' ').trim();
    if (status === 'wacht' && r.length < 2) return { ok: false, fout: 'Bij Wacht hoort een reden.' };
    t.status = status;
    if (status === 'wacht') t.wacht_reden = r.slice(0, 200); else delete t.wacht_reden;
    P.klaarOp(t, status);
    return { ok: true };
  };
  P.taakId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  // ── Uren in gewone taal: 150 → "2u30", 120 → "2u", 45 → "0u45" ──
  P.fmtUurMin = m => { const n = Math.max(0, Math.round(getal(m))), h = Math.floor(n / 60), r = n % 60; return r ? h + 'u' + String(r).padStart(2, '0') : h + 'u'; };
  // Een datum in gewone taal: "vr 16 okt" (voor Vandaag, Mijn werk en de tv).
  const DAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'], MND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  P.datumKort = ymd => { if (!P.isYmd(ymd)) return ''; const n = dnr(ymd), d = Number(ymd.slice(8, 10)), m = Number(ymd.slice(5, 7)); return DAG_KORT[((n + 4) % 7 + 7) % 7] + ' ' + d + ' ' + MND_KORT[m - 1]; };
  // De markering van een gemelde taak of bestelregel in gewone taal: "Probleem gemeld door werkplaats — Wim, di 14 okt".
  P.voorstelTekst = function (v) {
    if (!v || typeof v !== 'object') return '';
    const wie = String(v.doorNaam || v.door || '').trim(), dag = /^\d{4}-\d{2}-\d{2}/.test(String(v.ts || '')) ? P.datumKort(String(v.ts).slice(0, 10)) : '';
    return (v.soort === 'probleem' ? 'Probleem gemeld' : v.soort === 'bestel' ? 'Bestelvoorstel' : 'Voorstel') + (v.rol === 'werkplaats' ? ' door werkplaats' : '') + (wie ? ' — ' + wie : '') + (dag ? ', ' + dag : '');
  };
  // ... en terug: "2,5", "2.5", "2u30", "2:15", "1 uur", "45m" → minuten. Leeg, onleesbaar, 0 of meer dan 16 uur → null (er wordt dan niets geboekt).
  P.duurNaarMin = function (tekst) {
    const x = String(tekst == null ? '' : tekst).trim().toLowerCase().replace(',', '.'); let m, min = null;
    if ((m = /^(\d{1,2})\s*(?:u|uur|h|:)\s*(\d{1,2})?\s*(?:m|min)?$/.exec(x))) min = Number(m[1]) * 60 + Number(m[2] || 0);
    else if ((m = /^(\d+(?:\.\d+)?)\s*(?:m|min|minuten)$/.exec(x))) min = Math.round(Number(m[1]));
    else if ((m = /^(\d+(?:\.\d+)?)\s*(?:u|uur|h)?$/.exec(x))) min = Math.round(Number(m[1]) * 60);
    return min !== null && isFinite(min) && min > 0 && min <= 16 * 60 ? min : null;
  };

  // ── Projectkleur: een vaste kleur per projectcode (geen rood, oranje of groen: die zijn voor alarm) ──
  const KLEUR_TINTEN = [195, 210, 225, 240, 255, 270, 285, 300];
  P.projectKleur = function (code) {
    const s = String(code == null ? '' : code).trim().toLowerCase(); let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + KLEUR_TINTEN[h % KLEUR_TINTEN.length] + ', 42%, ' + ((h >>> 3) % 2 ? 46 : 36) + '%)';
  };

  // ── Mijn werk: de taken van één persoon in groepen, plus de planblokken ──
  // takenObj = { projectcode: [taak…] } (mt_project_taken_v2), depsObj = { projectcode: [afhankelijkheid…] } (mt_project_afhank), blokken = mt_planblokken.
  // opties: mijn (team-slug of e-mailadres), team, vandaag (ymd), nu (ms), vrij (vrije dagen), gezien ({taak-id: stempel van de toewijzing die je al zag}),
  //         nieuwDagen (een toewijzing die je nog nooit zag telt 7 dagen als nieuw).
  //         Voor kantoor (desktop): iedereen (alle taken en blokken, ook van niemand), project (alleen die projectcode), nieuw:false (geen "nieuw voor mij"),
  //         voorstellen (taken met een voorstel-markering komen apart in groepen.voorstel, ook als ze al van iemand zijn). Bij iedereen geldt de weekbalk niet (null).
  // Groepen: nieuw · teLaat · vandaag · week · later · zonderDatum, plus nietVrij (een open afhankelijkheid: de taak is nog niet gestart en wacht op een voorganger).
  // Een taak met een planblok krijgt de datum van dat blok als dat eerder is dan zijn eigen datum; een blok zonder taak staat er zelf (soort 'blok').
  const MIJN_RANG = { nieuw: 0, teLaat: 1, vandaag: 2, week: 3, later: 4, zonderDatum: 5 };
  const maandagVan = ymd => { const n = dnr(ymd), w = ((n + 4) % 7 + 7) % 7, ma = n - ((w + 6) % 7); return { ma: dymd(ma), zo: dymd(ma + 6), maNr: ma }; };
  const zelfdeCode = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const blokGeldig = (b, mijn, team, alle) => !!b && typeof b === 'object' && !b._vervallen && P.isYmd(b.datum) && !(b.voorstel && b.voorstel.afgewezen) && (alle || P.zelfdePersoon(b.persoon, mijn, team));
  const blokStartTekst = b => { const m = /^(\d{1,2}):(\d{2})/.exec(String(b && b.start || '')); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : ''; };
  // De planblokken van een taak: op taak-id, of (zonder id) op exact dezelfde, unieke naam binnen hetzelfde project.
  const taakBlokken = (t, code, naamAantal, blokken) => { const n = nrm(t.naam); return blokken.filter(b => (b.taak_id != null && b.taak_id !== '') ? String(b.taak_id) === String(t.id) : (zelfdeCode(b.project_code, code) && !!n && nrm(b.taak) === n && naamAantal.get(n) === 1)); };
  P.mijnWerk = function (takenObj, depsObj, blokken, opt) {
    const o = opt || {}, mijn = o.mijn || '', team = o.team || null, alle = !!o.iedereen, metNieuw = o.nieuw !== false && !alle;
    const projF = o.project ? String(o.project).trim().toLowerCase() : '';
    const vandaag = P.isYmd(o.vandaag) ? o.vandaag : P.vandaagYmd(), nu = Number(o.nu) || Date.now();
    const nieuwMs = (o.nieuwDagen == null ? 7 : Number(o.nieuwDagen)) * 864e5, gezien = o.gezien && typeof o.gezien === 'object' ? o.gezien : {};
    const wk = maandagVan(vandaag), zo = wk.zo;
    const groepVan = (s, e) => { s = s || e; e = e || s; if (!s) return 'zonderDatum'; if (e < vandaag) return 'teLaat'; if (s <= vandaag) return 'vandaag'; if (s <= zo) return 'week'; return 'later'; };
    const groepen = { voorstel: [], nieuw: [], teLaat: [], vandaag: [], week: [], later: [], zonderDatum: [], nietVrij: [] };
    const alleBlokken = (Array.isArray(blokken) ? blokken : []).filter(b => blokGeldig(b, mijn, team, alle) && (!projF || zelfdeCode(b.project_code, projF)));
    const gekoppeld = new Set(), mijnTaken = [], dekt = new Set(), PRIO = { high: 0, medium: 1, low: 2 };
    const takenPer = takenObj && typeof takenObj === 'object' && !Array.isArray(takenObj) ? takenObj : {};
    Object.keys(takenPer).sort().forEach(code => {
      if (code.startsWith('__') || !Array.isArray(takenPer[code]) || (projF && !zelfdeCode(code, projF))) return;
      const lijst = P.takenActief(takenPer[code]);
      const mijnL = lijst.filter(t => (alle || (t.toegewezen && P.zelfdePersoon(t.toegewezen, mijn, team))) && (t.status || 'todo') !== 'klaar');
      if (!mijnL.length) return;
      const wacht = P.wachtOverzicht(lijst, depsObj && depsObj[code], { vrij: o.vrij, vandaag });
      const naamAantal = new Map(); lijst.forEach(t => { const n = nrm(t.naam); if (n) naamAantal.set(n, (naamAantal.get(n) || 0) + 1); });
      mijnL.forEach(t => {
        const st = t.status || 'todo', w = wacht[t.id] || { wacht: false, op: [] }, n = nrm(t.naam);
        const bl = taakBlokken(t, code, naamAantal, alleBlokken);
        bl.forEach(b => gekoppeld.add(String(b.id)));
        if (bl.length) dekt.add(t.id);
        const komend = bl.filter(b => b.datum >= vandaag).sort((a, b) => (a.datum + blokStartTekst(a)) < (b.datum + blokStartTekst(b)) ? -1 : 1);
        const eerste = komend[0] || null;
        const gD = groepVan(P.isYmd(t.start) ? t.start : '', P.isYmd(t.eind) ? t.eind : ''), gB = eerste ? groepVan(eerste.datum, eerste.datum) : '';
        let groep = gD;
        if (gB && (gD === 'zonderDatum' || (gD !== 'teLaat' && MIJN_RANG[gB] < MIJN_RANG[gD]))) groep = gB;
        const ts = t.toegewezen && t._vs && t._vs.toegewezen ? t._vs.toegewezen : null, stempelT = ts ? Number(ts.t) || 0 : 0;
        const doorMij = !!(ts && ts.door && P.zelfdePersoon(ts.door, mijn, team)), g = gezien[t.id];
        const isNieuw = metNieuw && st === 'todo' && stempelT > 0 && !doorMij && (g === undefined || g === null ? (nu - stempelT) <= nieuwMs : stempelT > Number(g));
        const nietVrij = st === 'todo' && w.wacht;
        const eindGroep = (o.voorstellen && t.voorstel) ? 'voorstel' : nietVrij ? 'nietVrij' : (isNieuw ? 'nieuw' : groep);
        mijnTaken.push(Object.assign({ _code: code }, t));
        groepen[eindGroep].push({
          soort: 'taak', id: t.id, code, taak: t, persoon: P.persoonSlug(t.toegewezen, team) || String(t.toegewezen || ''), status: st, wacht: w, wachtTekst: P.wachtOpTekst(w), nieuw: isNieuw, groep: eindGroep, stempelToegewezen: stempelT,
          gepland_min: P.taakBudgetMin(t), start: P.isYmd(t.start) ? t.start : '', eind: P.isYmd(t.eind) ? t.eind : '',
          blokken: bl.map(b => ({ id: b.id, datum: b.datum, start: blokStartTekst(b), duurMin: Math.max(0, Math.round(getal(b.duurMin))), voorstel: b.status === 'voorstel' })),
          sleutel: (eerste ? eerste.datum + ' ' + (blokStartTekst(eerste) || '99:99') : (P.isYmd(t.start) ? t.start : (P.isYmd(t.eind) ? t.eind : '9999-99-99')) + ' ~') + '|' + (PRIO[t.prioriteit] !== undefined ? PRIO[t.prioriteit] : 3) + '|' + String(t.naam || '').toLowerCase()
        });
      });
    });
    alleBlokken.forEach(b => {
      if (gekoppeld.has(String(b.id)) || b.datum < vandaag) return;
      const groep = groepVan(b.datum, b.datum), s = blokStartTekst(b);
      groepen[groep].push({ soort: 'blok', id: 'blok:' + b.id, code: b.project_code || '', blok: b, persoon: P.persoonSlug(b.persoon, team) || String(b.persoon || ''), naam: b.taak || b.project_code || 'Planblok', datum: b.datum, start: s, duurMin: Math.max(0, Math.round(getal(b.duurMin))),
        voorstel: b.status === 'voorstel', groep, sleutel: b.datum + ' ' + (s || '99:99') + '|0|' + String(b.taak || '').toLowerCase() });
    });
    Object.keys(groepen).forEach(k => groepen[k].sort((a, b) => a.sleutel < b.sleutel ? -1 : a.sleutel > b.sleutel ? 1 : 0));
    const week = alle ? null : P.weekBezetting(mijnTaken, alleBlokken, { vandaag, vrij: o.vrij, dagMin: o.dagMin, gedekt: dekt, verlof: P.verlofDagen(o.verlof, mijn, team), capPerDag: typeof o.capPerDag === 'function' ? o.capPerDag : null });
    return { vandaag, weekgrens: { van: wk.ma, tot: zo }, groepen, week, aantal: Object.keys(groepen).reduce((s, k) => s + groepen[k].length, 0) };
  };

  // ── Verlof (Beheer ▸ mt_verlof): [{persoon (slug), van, tm}] → de dagen waarop die persoon vrij is (als Set van ymd) ──
  P.verlofDagen = function (verlof, persoon, team) {
    const uit = new Set();
    (Array.isArray(verlof) ? verlof : []).forEach(v => {
      if (!v || typeof v !== 'object' || !P.isYmd(v.van) || !P.isYmd(v.tm) || !P.zelfdePersoon(v.persoon, persoon, team)) return;
      for (let n = dnr(v.van), e = Math.min(dnr(v.tm), dnr(v.van) + 400); n <= e; n++) uit.add(dymd(n));
    });
    return uit;
  };
  // De vrije dagen uit Beheer (mt_vrijedagen: [{datum, type 'verplicht'|'optioneel'}]) als lijst van ymd: een optionele dag (bv. een brugdag) telt als gewone werkdag.
  P.vrijeDagenLijst = lijst => (Array.isArray(lijst) ? lijst : []).filter(v => v && v.datum && v.type !== 'optioneel').map(v => v.datum).filter(P.isYmd);

  // ── Werktijden per medewerker (Admin ▸ Team en werktijden; gedeelde store mt_werktijden.json) ──
  // Eén record per medewerker: { slug, dagen: { ma: { werk, start: '08:00', eind: '17:00' }, di, wo, do, vr }, pauze (minuten), _gewijzigd, _door }.
  // Beschikbaar per dag = eind - begin - pauze (de pauze telt alleen op een dag langer dan 5 uur). Zonder record van die persoon rekent alles zoals voorheen:
  // werkuren per week (Beheer) / 5 op ma-vr, standaard 40 uur (8 uur per dag). De werkuren per week blijven het terugvalgetal; er is geen tweede waarheid:
  // met een record volgen het weektotaal en de capaciteit overal uit de werktijden (P.werkuurWeek, P.dagCapMin).
  P.WERKTIJD_DAGEN = ['ma', 'di', 'wo', 'do', 'vr'];
  const tMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim()); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); return h < 24 && mi < 60 ? h * 60 + mi : null; };
  const tTekst = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  // '' = geldig, anders de reden in gewone taal
  P.werktijdenVorm = function (r) {
    if (!r || typeof r !== 'object' || !r.slug) return 'Geen medewerker.';
    if (!r.dagen || typeof r.dagen !== 'object') return 'De dagen ontbreken.';
    if (r.pauze != null && !(getal(r.pauze) >= 0 && getal(r.pauze) <= 180)) return 'De pauze moet tussen 0 en 3 uur liggen.';
    for (const k of P.WERKTIJD_DAGEN) {
      const x = r.dagen[k]; if (!x || typeof x !== 'object') return 'De dag ' + k + ' ontbreekt.';
      if (x.werk) { const a = tMin(x.start), e = tMin(x.eind); if (a === null || e === null) return 'Ongeldige tijd op ' + k + '.'; if (e <= a) return 'Op ' + k + ' moet het einde na het begin liggen.'; }
    }
    return '';
  };
  // lijst (of { slug: record }) -> { slug: record } met alleen geldige, niet-vervallen records
  P.werktijdenMap = function (lijst) {
    const uit = {}, arr = Array.isArray(lijst) ? lijst : (lijst && typeof lijst === 'object' ? Object.values(lijst) : []);
    arr.forEach(r => { if (r && typeof r === 'object' && r.slug && !r._vervallen && !P.werktijdenVorm(r)) uit[String(r.slug).toLowerCase()] = r; });
    return uit;
  };
  P.werktijdDagMin = function (r, i) {
    const x = r && r.dagen && r.dagen[P.WERKTIJD_DAGEN[i]]; if (!x || !x.werk) return 0;
    const a = tMin(x.start), e = tMin(x.eind); if (a === null || e === null || e <= a) return 0;
    const span = e - a, pauze = Math.max(0, Math.round(getal(r.pauze)));
    return Math.max(0, span - (span > 300 ? pauze : 0));
  };
  P.werkweekMin = r => [0, 1, 2, 3, 4].reduce((s, i) => s + P.werktijdDagMin(r, i), 0);
  // Beschikbare minuten van deze medewerker op weekdag i (0 = ma ... 4 = vr). o = { werkuren: { slug: uren }, werktijden }.
  P.dagCapMin = function (slug, i, o) {
    o = o || {}; const rec = P.werktijdenMap(o.werktijden)[String(slug).toLowerCase()];
    if (rec) return P.werktijdDagMin(rec, i);
    const u = o.werkuren && Number(o.werkuren[slug]) > 0 ? Number(o.werkuren[slug]) : 40; return u / 5 * 60;
  };
  P.werkuurWeek = function (slug, o) {
    o = o || {}; const rec = P.werktijdenMap(o.werktijden)[String(slug).toLowerCase()];
    return rec ? P.werkweekMin(rec) / 60 : ((o.werkuren && o.werkuren[slug]) || 40);
  };
  // De beschikbare minuten per dag van deze persoon als functie ymd -> minuten (voor weekBezetting/mijnWerk), of null zonder werktijden-record (dan geldt 8 uur per werkdag, zoals altijd).
  P.capPerDagVoor = function (slug, werktijden) {
    const rec = P.werktijdenMap(werktijden)[String(slug == null ? '' : slug).toLowerCase()]; if (!rec) return null;
    return ymd => { const w = ((dnr(ymd) + 4) % 7 + 7) % 7, i = (w + 6) % 7; return i > 4 ? 0 : P.werktijdDagMin(rec, i); };
  };
  // De tijd van de dagvraag "Klopt je dag?": 15 minuten voor de eindtijd (alleen berekend en getoond; de vraag zelf is een latere stap).
  // -> { perDag: { ma: '16:45'|'' ... }, laatste: '16:45'|'' }
  P.dagvraagTijd = function (r) {
    const perDag = {}; let laatste = 0;
    P.WERKTIJD_DAGEN.forEach(k => { const x = r && r.dagen && r.dagen[k], e = x && x.werk ? tMin(x.eind) : null; perDag[k] = e === null || e === undefined ? '' : tTekst(Math.max(0, e - 15)); if (e !== null && e !== undefined) laatste = Math.max(laatste, e - 15); });
    return { perDag, laatste: laatste ? tTekst(laatste) : '' };
  };
  // Het moment van de dagvraag voor één persoon op één datum: 15 min voor de eindtijd van die dag uit zijn werktijden (zonder record: 16:45 op ma-vr), '' op een weekend of
  // een dag waarop deze persoon volgens zijn werktijden niet werkt. Verlof en een verplichte vrije dag gelden ook als "geen vraag" (opt.verlof, opt.vrijedagen, opt.team).
  // -> 'HH:MM' | ''
  P.dagvraagMoment = function (slug, werktijden, datum, opt) {
    const o = opt || {}; if (!P.isYmd(datum)) return '';
    const w = ((dnr(datum) + 4) % 7 + 7) % 7, i = (w + 6) % 7; if (i > 4) return '';   // i: 0 = ma ... 6 = zo
    if ((Array.isArray(o.vrijedagen) ? o.vrijedagen : []).some(v => v && v.datum === datum && v.type === 'verplicht')) return '';
    if ((Array.isArray(o.verlof) ? o.verlof : []).some(v => v && P.isYmd(v.van) && P.isYmd(v.tm) && datum >= v.van && datum <= v.tm && P.zelfdePersoon(v.persoon, slug, Array.isArray(o.team) ? o.team : []))) return '';
    const rec = P.werktijdenMap(werktijden)[String(slug || '').toLowerCase()] || null;
    if (!rec) return '16:45';
    if (P.werktijdDagMin(rec, i) <= 0) return '';
    return P.dagvraagTijd(rec).perDag[P.WERKTIJD_DAGEN[i]] || '';
  };
  // Samenvoegen per medewerker: de nieuwste stempel (_gewijzigd) wint; bij een gelijke stempel beslist een vaste volgorde (wie schreef het, dan de inhoud), niet lokaal/remote; een record aan één kant blijft staan (dus twee beheerders die
  // verschillende mensen wijzigen verliezen niets). Een tombstone (_vervallen) is een gewoon record met een stempel: "terug naar standaard".
  P.werktijdenSamen = function (lokaal, remote) {
    const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
    const arr = v => { const x = lees(v); return Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []); };
    const tijd = x => { const v = x && x._gewijzigd; return typeof v === 'number' ? v : (Date.parse(v || '') || 0); };
    const per = new Map();
    // Gelijke stempel (twee beheerders in dezelfde milliseconde): een vaste volgorde die niet van lokaal/remote afhangt, zodat alle apparaten dezelfde winnaar kiezen:
    // eerst wie het schreef (_door, bij een tombstone _vervallen.door), dan de inhoud zelf.
    const wie = x => String(x._door || (x._vervallen && x._vervallen.door) || '').toLowerCase();
    const wint = (x, o) => { const a = tijd(x), b = tijd(o); if (a !== b) return a > b; const w1 = wie(x), w2 = wie(o); if (w1 !== w2) return w1 > w2; return JSON.stringify(x) > JSON.stringify(o); };
    [...arr(remote), ...arr(lokaal)].forEach(x => { if (!x || typeof x !== 'object' || !x.slug) return; const k = String(x.slug).toLowerCase(), o = per.get(k); if (!o || wint(x, o)) per.set(k, x); });
    return [...per.values()].sort((a, b) => String(a.slug) < String(b.slug) ? -1 : 1);
  };

  // ── Afwijkingen per medewerker en maand: extra gewerkt en vrij genomen (afgeleid, geen eigen store) ──
  // Basis = de werkweek van die persoon: de werktijden uit mt_werktijden, en zonder record ma-vr (werkuren per week / 5). Een dag telt als "niet werken" bij een
  // weekend, een weekdag zonder werk volgens de werktijden, een verlofdag of een verplichte vrije dag (een optionele vrije dag is een gewone werkdag).
  //  - Extra gewerkt: op zo'n dag staan planblokken (niet vervallen, geen open voorstel) en/of zijn er geklokte uren (entries uit Toggl, alleen wat lokaal is binnengekomen);
  //    per dag de geplande en de geklokte minuten, met de reden. De dag telt mee zodra een van beide er is.
  //  - Vrij genomen: de werkdagen van die persoon binnen de verlofperioden uit mt_verlof (een halve dag of een eigen aantal dagen in de boeking telt naar verhouding mee,
  //    overlappende boekingen tellen een dag één keer), met de uren van die dag; en apart de verplichte vrije dagen die op een werkdag van die persoon vallen.
  // Alle datums zijn kalenderdagen (UTC-dagnummers): de zomertijdwissel (25-10, 29-03) verandert niets aan het aantal dagen of de uren.
  // o = { slug, maand: 'YYYY-MM', team, werkuren, werktijden, verlof, vrijedagen, blokken, entries } -> { maand, van, tot, extra, vrij }
  P.afwijkingen = function (o) {
    o = o || {}; const slug = String(o.slug || '').toLowerCase(), team = Array.isArray(o.team) ? o.team : [];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(o.maand || ''))) throw new Error('Ongeldige maand: ' + o.maand);
    const j = Number(o.maand.slice(0, 4)), m = Number(o.maand.slice(5, 7)), eerste = dnr(o.maand + '-01'), laatste = dnr(j + '-' + String(m).padStart(2, '0') + '-' + String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0'));
    const rec = P.werktijdenMap(o.werktijden)[slug] || null, wu = o.werkuren || {};
    const idxVan = n => (((n + 4) % 7 + 7) % 7 + 6) % 7;                              // 0 = ma ... 6 = zo
    const capMin = n => { const i = idxVan(n); return i > 4 ? 0 : P.dagCapMin(slug, i, { werkuren: wu, werktijden: o.werktijden }); };
    const werktDag = n => idxVan(n) <= 4 && (rec ? P.werktijdDagMin(rec, idxVan(n)) > 0 : true);
    const verplicht = new Set((Array.isArray(o.vrijedagen) ? o.vrijedagen : []).filter(v => v && v.type === 'verplicht' && P.isYmd(v.datum)).map(v => v.datum));
    const mijnVerlof = (Array.isArray(o.verlof) ? o.verlof : []).filter(v => v && P.isYmd(v.van) && P.isYmd(v.tm) && v.tm >= v.van && P.zelfdePersoon(v.persoon, slug, team));
    const verlofDag = new Set(); mijnVerlof.forEach(v => { for (let n = dnr(v.van), e = Math.min(dnr(v.tm), dnr(v.van) + 400); n <= e; n++) verlofDag.add(dymd(n)); });
    // geplande minuten per dag (alleen blokken die echt gelden) en geklokte minuten per dag
    const gepl = new Map(), klok = new Map();
    (Array.isArray(o.blokken) ? o.blokken : []).forEach(b => { if (!b || b._vervallen || b.status === 'voorstel' || (b.voorstel && b.voorstel.afgewezen) || !P.isYmd(b.datum) || !P.zelfdePersoon(b.persoon, slug, team)) return; gepl.set(b.datum, (gepl.get(b.datum) || 0) + Math.max(0, Math.round(getal(b.duurMin)))); });
    P.entriesFilter(Array.isArray(o.entries) ? o.entries : [], { pers: [slug], van: dymd(eerste), tot: dymd(laatste), team }).forEach(e => { const d = String(e.datum || e.start || '').slice(0, 10); if (P.isYmd(d)) klok.set(d, (klok.get(d) || 0) + P.entryMin(e)); });
    // 1. extra gewerkt
    const dagen = []; let totG = 0, totK = 0;
    for (let n = eerste; n <= laatste; n++) {
      const d = dymd(n), nietWerk = !werktDag(n) || verlofDag.has(d) || verplicht.has(d); if (!nietWerk) continue;
      const g = gepl.get(d) || 0, k = klok.get(d) || 0; if (!(g > 0 || k > 0)) continue;
      const reden = verlofDag.has(d) ? 'verlof' : verplicht.has(d) ? 'verplichte vrije dag' : idxVan(n) > 4 ? 'weekend' : 'werkt niet';
      dagen.push({ datum: d, reden, gepland_min: g, geklokt_min: k }); totG += g; totK += k;
    }
    // 2. vrij genomen: gewicht per verlofdag (halve dagen), een dag één keer
    const gewicht = new Map(), perioden = [];
    mijnVerlof.forEach(v => {
      const wd = []; for (let n = dnr(v.van), e = Math.min(dnr(v.tm), dnr(v.van) + 400); n <= e; n++) if (werktDag(n) && !verplicht.has(dymd(n))) wd.push(n);
      const w = wd.length && getal(v.dagen) > 0 ? getal(v.dagen) / wd.length : 1;
      let dagenM = 0, minM = 0; wd.forEach(n => { if (n < eerste || n > laatste) return; const d = dymd(n); if (!(gewicht.get(d) >= w)) gewicht.set(d, w); dagenM += w; minM += w * capMin(n); });
      if (dagenM > 0) perioden.push({ van: v.van, tm: v.tm, dagen: Math.round(dagenM * 100) / 100, min: Math.round(minM), opm: String(v.opm || '') });
    });
    let verlofD = 0, verlofMin = 0; gewicht.forEach((w, d) => { verlofD += w; verlofMin += w * capMin(dnr(d)); });
    const verplichtLijst = []; for (let n = eerste; n <= laatste; n++) { const d = dymd(n); if (verplicht.has(d) && werktDag(n)) verplichtLijst.push({ datum: d, min: capMin(n) }); }
    return { maand: o.maand, van: dymd(eerste), tot: dymd(laatste), basis: rec ? 'werktijden' : 'ma-vr',
      extra: { dagen, aantal: dagen.length, gepland_min: totG, geklokt_min: totK },
      vrij: { verlofDagen: Math.round(verlofD * 100) / 100, verlofMin: Math.round(verlofMin), perioden, verplichtDagen: verplichtLijst.length, verplichtMin: verplichtLijst.reduce((s, x) => s + x.min, 0), verplichtLijst } };
  };

  // ── Capaciteit van de week: 8 uur per werkdag, geplande uren in dagdelen ──
  // Gepland = de planblokken van de persoon (geen open voorstellen) plus de taken met een start/eind in die week die geen planblok hebben (de uren
  // verdeeld over hun werkdagen). Per dag telt een begonnen dagdeel (4 uur) voor een heel dagdeel: de werkplaats plant in dagdelen.
  // → { van, tot, dagen: [{datum, werkdag, cap_min, gepland_min, dagdelen}], cap_min, gepland_min (in dagdelen), vrij_min, over_min, dagdelen, dagdelenTotaal }
  // capPerDag (optioneel, ymd -> minuten): de beschikbare minuten per dag uit de werktijden van die persoon (P.dagCapMin); zonder is het 8 uur (dagMin) per werkdag, zoals altijd.
  P.weekBezetting = function (taken, blokken, { vandaag = '', vrij = null, dagMin = 0, gedekt = null, verlof = null, capPerDag = null } = {}) {
    const dm = dagMin > 0 ? dagMin : P.DAG_MIN, V = P.vrijSet(vrij), wk = maandagVan(P.isYmd(vandaag) ? vandaag : P.vandaagYmd()), VL = verlof instanceof Set ? verlof : new Set(Array.isArray(verlof) ? verlof : []);   // verlof = de dagen waarop deze persoon vrij is (zie verlofDagen): geen capaciteit
    const dagen = []; for (let i = 0; i < 5; i++) { const nr = wk.maNr + i, cd = capPerDag ? Math.max(0, Math.round(getal(capPerDag(dymd(nr))))) : dm, w = isWerk(nr, V) && !VL.has(dymd(nr)) && cd > 0; dagen.push({ datum: dymd(nr), nr, werkdag: w, cap_min: w ? cd : 0, gepland_min: 0 }); }
    const per = new Map(dagen.map(d => [d.datum, d])), dekt = gedekt instanceof Set ? gedekt : new Set();
    (blokken || []).forEach(b => {
      if (!b || b._vervallen || b.status === 'voorstel' || (b.voorstel && b.voorstel.afgewezen)) return;
      const d = per.get(b.datum); if (d) d.gepland_min += Math.max(0, Math.round(getal(b.duurMin)));
    });
    (taken || []).forEach(t => {
      if (!t || dekt.has(t.id) || t.voorstel || (t.status || 'todo') === 'klaar') return;   // een taak met een open voorstel-markering telt niet mee (zie weekRooster)
      const min = P.taakBudgetMin(t); if (min <= 0) return;
      const s = P.isYmd(t.start) ? t.start : (P.isYmd(t.eind) ? t.eind : ''); if (!s) return;
      const e = P.isYmd(t.eind) ? t.eind : s, a = dnr(s), z = Math.max(a, dnr(e)); let n = 0;
      for (let i = a; i <= z && i - a < 400; i++) if (isWerk(i, V)) n++;
      if (!n) return;
      for (let i = a; i <= z && i - a < 400; i++) { if (!isWerk(i, V)) continue; const d = per.get(dymd(i)); if (d) d.gepland_min += min / n; }
    });
    const half = dm / 2; let cap = 0, gepl = 0, over = 0, dd = 0, ddTot = 0;
    dagen.forEach(d => {
      d.gepland_min = Math.round(d.gepland_min); delete d.nr;
      const hd = capPerDag ? d.cap_min / 2 : half;   // een halve dag van déze dag (met werktijden verschilt dat per dag)
      d.dagdelen = d.werkdag && hd > 0 ? Math.min(2, Math.ceil(d.gepland_min / hd - 1e-9)) : 0;
      cap += d.cap_min; gepl += d.dagdelen * hd; dd += d.dagdelen; ddTot += d.werkdag ? 2 : 0; over += Math.max(0, d.gepland_min - d.cap_min);
    });
    return { van: dagen[0].datum, tot: dagen[4].datum, dagen, cap_min: cap, gepland_min: gepl, vrij_min: Math.max(0, cap - gepl), over_min: Math.round(over), dagdelen: dd, dagdelenTotaal: ddTot };
  };

  // ── Werkplaats-tv: de kalender (een rij per persoon, werkdagen van deze en volgende week, per dagdeel) ──
  // → { van, tot, dagen: [{datum, werkdag, nu, week}], rijen: [{slug, naam, cellen}] }; cellen[dag] = [ochtend-items, middag-items].
  // Een rij per teamlid, plus "Niet toegewezen" (taken van niemand, blokken van een onbekende) zodra daar iets staat. Items zijn de planblokken (op hun starttijd: voor 12:00 de
  // ochtend, erna de middag, eroverheen beide) en de taken met een start of eind zonder eigen planblok (de uren verdeeld over hun werkdagen; één dagdeel, of beide bij meer dan 4 uur
  // per dag). Een planblok van een taak toont die taak. item: {soort 'taak'|'blok', id, code, naam, status, wacht, wachtTekst, voorstel, taak?, start?, min, persoon}.
  const dagdeelVanBlok = b => {
    const s = blokStartTekst(b); if (!s) return [0];
    const m = Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)), e = m + Math.max(0, Math.round(getal(b.duurMin)));
    return m < 720 ? (e > 720 ? [0, 1] : [0]) : [1];
  };
  P.weekRooster = function (takenObj, depsObj, blokken, opt) {
    const o = opt || {}, team = Array.isArray(o.team) ? o.team : [], vandaag = P.isYmd(o.vandaag) ? o.vandaag : P.vandaagYmd();
    const weken = o.weken > 0 ? Math.min(6, Math.round(o.weken)) : 2, V = P.vrijSet(o.vrij), wk = maandagVan(vandaag), half = P.DAG_MIN / 2;
    const dagen = [];
    for (let w = 0; w < weken; w++) for (let d = 0; d < 5; d++) { const nr = wk.maNr + w * 7 + d; dagen.push({ datum: dymd(nr), werkdag: isWerk(nr, V), nu: dymd(nr) === vandaag, week: w }); }
    // opt.extra = extra datums (bv. een weekenddag waar iemand toch werkte) die als losse kolommen achter de werkdagen komen, in de laatste week; alleen voor de dagweergave van één dag
    (Array.isArray(o.extra) ? o.extra : []).forEach(ymd => { if (P.isYmd(ymd) && !dagen.some(d => d.datum === ymd)) dagen.push({ datum: ymd, werkdag: isWerk(dnr(ymd), V), nu: ymd === vandaag, week: weken - 1, extra: true }); });
    const idx = new Map(dagen.map((d, i) => [d.datum, i]));
    const nieuwRij = (slug, naam) => { const vl = slug ? P.verlofDagen(o.verlof, slug, team) : new Set(); return { slug, naam, verlofDag: dagen.map(d => vl.has(d.datum)), cellen: dagen.map(() => [[], []]) }; };   // verlofDag: de persoon is die dag vrij (Beheer ▸ verlof)
    const rijen = team.map(m => nieuwRij(String(m.slug || '').toLowerCase(), m.naam || m.slug)), rest = nieuwRij('', 'Niet toegewezen');
    const rijVan = x => { const s = P.persoonSlug(x, team); return (s && rijen.find(r => r.slug === s)) || rest; };
    const kies = (r, i) => r.cellen[i][0].length <= r.cellen[i][1].length ? 0 : 1;
    const geldig = (Array.isArray(blokken) ? blokken : []).filter(b => blokGeldig(b, '', null, true) && idx.has(b.datum) && (!o.project || zelfdeCode(b.project_code, o.project)));
    const koppel = new Map(), takenPer = takenObj && typeof takenObj === 'object' && !Array.isArray(takenObj) ? takenObj : {};
    Object.keys(takenPer).sort().forEach(code => {
      if (code.startsWith('__') || !Array.isArray(takenPer[code]) || (o.project && !zelfdeCode(code, o.project))) return;
      const lijst = P.takenActief(takenPer[code]); if (!lijst.length) return;
      const wacht = P.wachtOverzicht(lijst, depsObj && depsObj[code], { vrij: o.vrij, vandaag });
      const naamAantal = new Map(); lijst.forEach(t => { const n = nrm(t.naam); if (n) naamAantal.set(n, (naamAantal.get(n) || 0) + 1); });
      lijst.forEach(t => {
        const st = t.status || 'todo'; if (st === 'klaar') return;
        const w = wacht[t.id] || { wacht: false, op: [] };
        const basis = { soort: 'taak', id: t.id, code, naam: t.naam, status: st, wacht: st === 'wacht' || (st === 'todo' && !!w.wacht), wachtTekst: P.wachtOpTekst(w), voorstel: !!t.voorstel, taak: t, persoon: P.persoonSlug(t.toegewezen, team) || '' };
        const bl = taakBlokken(t, code, naamAantal, geldig);
        if (bl.length) { bl.forEach(b => koppel.set(String(b.id), basis)); return; }
        const s = P.isYmd(t.start) ? t.start : (P.isYmd(t.eind) ? t.eind : ''); if (!s) return;
        const e = P.isYmd(t.eind) ? t.eind : s, a = dnr(s), z = Math.max(a, dnr(e)); let n = 0;
        for (let i = a; i <= z && i - a < 400; i++) if (isWerk(i, V)) n++;
        if (!n) return;
        const bud = P.taakBudgetMin(t), per = bud > 0 ? bud / n : half, r = t.toegewezen ? rijVan(t.toegewezen) : rest;
        for (let i = a; i <= z && i - a < 400; i++) {
          if (!isWerk(i, V)) continue;
          const di = idx.get(dymd(i)); if (di === undefined) continue;
          // Een taak met een open voorstel-markering (door de werkplaats gemeld, nog niet overgenomen) blijft zichtbaar maar telt niet mee, net als een voorstel-planblok.
          const item = Object.assign({}, basis, { min: Math.round(per), datum: dymd(i) }, t.voorstel ? { planvoorstel: true } : {});
          (per > half ? [0, 1] : [kies(r, di)]).forEach(dl => r.cellen[di][dl].push(item));
        }
      });
    });
    geldig.forEach(b => {
      const k = koppel.get(String(b.id)), s = blokStartTekst(b);
      // Een open voorstel (status voorstel) telt nooit mee in de capaciteit, ook niet als het aan een taak hangt: pas na Overnemen (status niet meer voorstel). Het blijft wel zichtbaar.
      const item = k ? Object.assign({}, k, { start: s, blokId: b.id, datum: b.datum, min: Math.max(0, Math.round(getal(b.duurMin))) }, b.status === 'voorstel' ? { planvoorstel: true } : {})
        : { soort: 'blok', id: 'blok:' + b.id, datum: b.datum, code: b.project_code || '', naam: b.taak || b.project_code || 'Planblok', status: '', wacht: false, voorstel: false, planvoorstel: b.status === 'voorstel', start: s, min: Math.max(0, Math.round(getal(b.duurMin))), persoon: P.persoonSlug(b.persoon, team) || '' };
      const r = rijVan(b.persoon), di = idx.get(b.datum);
      dagdeelVanBlok(b).forEach(dl => r.cellen[di][dl].push(item));
    });
    const alle = rest.cellen.some(c => c[0].length || c[1].length) ? rijen.concat([rest]) : rijen;
    alle.forEach(r => r.cellen.forEach(c => c.forEach(l => l.sort((x, y) => (String(x.code).toLowerCase() + '|' + String(x.naam).toLowerCase()) < (String(y.code).toLowerCase() + '|' + String(y.naam).toLowerCase()) ? -1 : 1))));
    return { van: dagen[0].datum, tot: dagen[dagen.length - 1].datum, dagen, rijen: alle };
  };

  // ── Teamcapaciteit: per persoon per dag gepland tegenover beschikbaar (alleen lezen) ──
  // Rijen = het team (en "Niet toegewezen" zonder capaciteit), kolommen = de werkdagen van deze en volgende week. Beschikbaar = werkuren per week / 5 (standaard 40 uur,
  // opt.werkuren = { slug: uren }) op een werkdag die geen vrije dag (opt.vrij) en geen verlof (opt.verlof) is. Gepland = de planblokken (geen open voorstel) en de taken met een datum
  // (geen taken met een open voorstel-markering; zie weekRooster), per dag samengeteld; een begonnen dagdeel telt voor een heel dagdeel (de werkplaats plant in dagdelen). vrij = wat er van de dag overblijft, over = wat erboven zit.
  // → { van, tot, dagen, rijen: [{ slug, naam, heeftCap, dagen: [{datum, werkdag, verlof, cap_min, gepland_min, dagdelen, vrij_min, over_min, items}], weken: [{cap_min, gepland_min, vrij_min, over_min}] }] }
  P.teamCapaciteit = function (takenObj, depsObj, blokken, opt) {
    const o = opt || {}, team = Array.isArray(o.team) ? o.team : [], r = P.weekRooster(takenObj, depsObj, blokken, o), wu = o.werkuren && typeof o.werkuren === 'object' ? o.werkuren : {}, wt = P.werktijdenMap(o.werktijden);   // wt: de werktijden per medewerker (leeg = alles als voorheen)
    const aantalWeken = r.dagen.length ? r.dagen[r.dagen.length - 1].week + 1 : 0;
    const rijen = r.rijen.map(rij => {
      const lid = !!rij.slug && team.some(m => String(m.slug).toLowerCase() === rij.slug), uren = Number(wu[rij.slug]) > 0 ? Number(wu[rij.slug]) : 40, dagCap = lid ? Math.round(uren / 5 * 60) : 0, rec = lid ? wt[rij.slug] || null : null;
      const weken = []; for (let w = 0; w < aantalWeken; w++) weken.push({ cap_min: 0, gepland_min: 0, vrij_min: 0, over_min: 0 });
      const dagen = r.dagen.map((d, i) => {
        const wdIdx = Math.min(4, (((dnr(d.datum) + 4) % 7 + 7) % 7 + 6) % 7), verlof = !!(rij.verlofDag && rij.verlofDag[i]), werktNiet = !!rec && P.werktijdDagMin(rec, wdIdx) <= 0, cap = lid && d.werkdag && !verlof ? (rec ? Math.round(P.werktijdDagMin(rec, wdIdx)) : dagCap) : 0, uniek = new Set();   // wdIdx = de weekdag van DEZE datum (0 = ma), ook voor een extra weekenddag
        rij.cellen[i].forEach(c => c.forEach(it => uniek.add(it)));
        const items = [...uniek], gepland = Math.round(items.reduce((s, it) => s + (it.planvoorstel ? 0 : (it.min || 0)), 0));
        const dd = cap > 0 ? Math.min(2, Math.ceil(gepland / (cap / 2) - 1e-9)) : 0, telt = cap > 0 ? dd * (cap / 2) : 0;
        const vrij = Math.max(0, cap - telt), over = Math.max(0, gepland - cap), wk = weken[d.week];
        wk.cap_min += cap; wk.gepland_min += telt || (cap > 0 ? 0 : gepland); wk.vrij_min += vrij; wk.over_min += over;
        const dag = { datum: d.datum, werkdag: d.werkdag, verlof, cap_min: cap, gepland_min: gepland, dagdelen: dd, vrij_min: Math.round(vrij), over_min: Math.round(over), items };
        if (werktNiet && d.werkdag && !verlof) dag.werktNiet = true;   // alleen met een ingevuld rooster: deze persoon werkt op deze weekdag niet
        return dag;
      });
      weken.forEach(w => { w.cap_min = Math.round(w.cap_min); w.gepland_min = Math.round(w.gepland_min); w.vrij_min = Math.round(w.vrij_min); w.over_min = Math.round(w.over_min); });
      return { slug: rij.slug, naam: rij.naam, heeftCap: lid, dagen, weken };
    });
    return { van: r.van, tot: r.tot, dagen: r.dagen, rijen };
  };

  // ── Werkplaats-tv: de stroom van de actieve projecten door de keten, en "Let op" ──
  // Stations (van werkvoorbereiding tot montage): voorbereiding, materiaal, productie, spuiten, montage. Een taak hoort bij een station via zijn sleutel (de standaardketen:
  // wvb, bestellen, materiaal_geleverd, zagen, cnc, afmonteren, spuiten, montage, oplevering) of anders zijn activiteit. Een station is: klaar (alles klaar), bezig (iets bezig),
  // wacht (iets wacht op een voorganger of staat op Wacht), open, of leeg (geen taken); materiaal zonder taken volgt de bestelregels van het project.
  P.STROOM_STATIONS = [['voorbereiding', 'Voorbereiding'], ['materiaal', 'Materiaal'], ['productie', 'Productie'], ['spuiten', 'Spuiten'], ['montage', 'Montage']];
  const stationVan = t => {
    const k = String((t && t.sleutel) || ''), a = String((t && t.activiteit) || '');
    if (k === 'wvb') return 'voorbereiding'; if (k === 'bestellen' || k === 'materiaal_geleverd') return 'materiaal';
    if (k === 'zagen' || k === 'cnc' || k === 'afmonteren') return 'productie'; if (k === 'spuiten') return 'spuiten'; if (k === 'montage' || k === 'oplevering') return 'montage';
    return (a === 'tekenwerk' || a === 'werkvoorbereiding') ? 'voorbereiding' : a === 'werkplaats' ? 'productie' : a === 'spuiten' ? 'spuiten' : a === 'montage' ? 'montage' : '';
  };
  const PROJECT_ACTIEF = ['werkvoorbereiding', 'inkoop', 'productie', 'klaar_levering'];
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfdeCode(k, code));
  const takenVan = (obj, code) => { const k = sleutelVan(obj, code); return k && Array.isArray(obj[k]) ? P.takenActief(obj[k]) : []; };
  const bestelVan = (bestel, p) => (Array.isArray(bestel) ? bestel : []).filter(b => b && typeof b === 'object' && !b._vervallen && b.id !== '__migratie' && ((b.project_id && p.project_id && b.project_id === p.project_id) || zelfdeCode(b.project, p.code)));
  const isKlaar = t => (t.status || 'todo') === 'klaar';
  P.projectStroom = function (takenObj, depsObj, projecten, o) {
    o = o || {}; const vandaag = P.isYmd(o.vandaag) ? o.vandaag : P.vandaagYmd(), rijen = [];
    (Array.isArray(projecten) ? projecten : []).forEach(p => {
      if (!p || typeof p !== 'object' || p._vervallen || !p.code) return;
      const lijst = takenVan(takenObj, p.code), open = lijst.filter(t => !isKlaar(t));
      if (!(PROJECT_ACTIEF.includes(p.fase) || (!p.fase && open.length))) return;
      const dk = sleutelVan(depsObj, p.code), deps = dk ? depsObj[dk] : [], wacht = P.wachtOverzicht(lijst, deps, { vrij: o.vrij, vandaag }), regels = bestelVan(o.bestel, p);
      const stations = P.STROOM_STATIONS.map(([k, l]) => {
        const ts = lijst.filter(t => stationVan(t) === k); let staat = 'leeg';
        if (ts.length) staat = ts.every(isKlaar) ? 'klaar' : ts.some(t => t.status === 'bezig') ? 'bezig' : ts.some(t => t.status === 'wacht' || ((t.status || 'todo') === 'todo' && wacht[t.id] && wacht[t.id].wacht)) ? 'wacht' : 'open';
        else if (k === 'materiaal' && regels.length) { const st = regels.map(P.bestelStatus); staat = st.every(s => s === 'geleverd') ? 'klaar' : st.some(s => s !== 'nodig') ? 'bezig' : 'open'; }
        return { k, l, staat, n: ts.length, klaar: ts.filter(isKlaar).length };
      });
      const lever = P.isYmd(p.gegevens && p.gegevens.leverdatum) ? p.gegevens.leverdatum : '';
      let tekort = 0, eindVroegst = '';
      if (lever && lijst.length) { try { const r = P.rooster(lijst, deps, { start: vandaag, leverdatum: lever, vrij: o.vrij }); tekort = r.tekort; eindVroegst = r.eindVroegst; } catch (e) { tekort = 0; } }
      const teLaat = open.filter(t => P.isYmd(t.eind) && t.eind < vandaag).length;
      let reden = '';
      if (lever && tekort > 0) reden = 'Op zijn vroegst klaar op ' + P.datumKort(eindVroegst) + ': ' + tekort + ' werkdag' + (tekort === 1 ? '' : 'en') + ' na de leverdatum';
      else if (lever && lever < vandaag && open.length) reden = 'De leverdatum is voorbij en er staan nog ' + open.length + ' taken open';
      rijen.push({ code: p.code, project_id: p.project_id || '', naam: p.naam || p.code, fase: p.fase || '', lever, stations, klaar: lijst.length - open.length, totaal: lijst.length, open: open.length, teLaat, vlag: !!reden, reden, tekort, eindVroegst });
    });
    rijen.sort((a, b) => (b.vlag - a.vlag) || (a.lever && b.lever ? (a.lever < b.lever ? -1 : a.lever > b.lever ? 1 : 0) : (a.lever ? -1 : b.lever ? 1 : 0)) || (String(a.code).toLowerCase() < String(b.code).toLowerCase() ? -1 : 1));
    return rijen;
  };
  // Let op: wat aandacht vraagt. → { wachtMateriaal, wachtVoorganger, wachtAnders, teLaat, nieuwGemeld, teLeveren } (lijsten van items; zie hieronder).
  // Wacht op materiaal = een taak op Wacht waarvan de reden over materiaal gaat, plus per project de bestelregels die besteld maar nog niet geleverd zijn. Wacht op een voorganger =
  // een nog niet gestarte taak met een open afhankelijkheid. Te laat = een taak die niet klaar is en waarvan het einde voorbij is. Nieuw gemeld = taken en bestelregels met een
  // voorstel-markering. Te leveren = actieve projecten met de leverdatum in de rest van deze week.
  const MATERIAAL_RE = /\b(materiaal|plaat|platen|beslag|bestel|besteld|bestelling|levering|leverancier|geleverd|order)/i;
  P.letOp = function (takenObj, depsObj, projecten, bestel, o) {
    o = o || {}; const vandaag = P.isYmd(o.vandaag) ? o.vandaag : P.vandaagYmd(), zo = maandagVan(vandaag).zo, team = o.team || null;
    const uit = { wachtMateriaal: [], wachtVoorganger: [], wachtAnders: [], teLaat: [], nieuwGemeld: [], teLeveren: [] };
    const projVan = (code, pid) => (Array.isArray(projecten) ? projecten : []).find(p => p && !p._vervallen && ((code && zelfdeCode(p.code, code)) || (pid && p.project_id && p.project_id === pid))) || null;
    Object.keys(takenObj && typeof takenObj === 'object' ? takenObj : {}).sort().forEach(code => {
      const lijst = takenVan(takenObj, code); if (!lijst.length) return;
      const dk = sleutelVan(depsObj, code), wacht = P.wachtOverzicht(lijst, dk ? depsObj[dk] : [], { vrij: o.vrij, vandaag });
      lijst.forEach(t => {
        if (isKlaar(t)) return;
        const st = t.status || 'todo', w = wacht[t.id] || { wacht: false, op: [] };
        const item = { soort: 'taak', id: t.id, code, naam: t.naam, status: st, wacht: st === 'wacht' || (st === 'todo' && !!w.wacht), wachtTekst: P.wachtOpTekst(w, P.datumKort), taak: t, voorstel: t.voorstel || null, persoon: P.persoonSlug(t.toegewezen, team) || '' };
        if (t.voorstel) uit.nieuwGemeld.push(item);
        if (st === 'wacht') (MATERIAAL_RE.test(String(t.wacht_reden || '')) ? uit.wachtMateriaal : uit.wachtAnders).push(Object.assign({ reden: String(t.wacht_reden || '') }, item));
        else if (st === 'todo' && w.wacht) uit.wachtVoorganger.push(item);
        if (P.isYmd(t.eind) && t.eind < vandaag) uit.teLaat.push(Object.assign({ eind: t.eind, dagen: P.werkdagenTussen(t.eind, vandaag, o.vrij) }, item));
      });
    });
    const perProject = new Map();
    (Array.isArray(bestel) ? bestel : []).forEach(b => {
      if (!b || typeof b !== 'object' || b._vervallen || b.id === '__migratie') return;
      const p = projVan(b.project, b.project_id), code = p ? p.code : String(b.project || ''), st = P.bestelStatus(b), oms = P.bestelOms(b) || 'regel';
      const regel = [['Materiaal', oms], ['Aantal', (b.aantal || 1) + ' ' + P.eenheidTekst(b.eenheid, b.aantal)], ['Status', P.BESTEL_STATUS_LABEL[st] || st], ['Project', code]];
      if (b.voorstel) uit.nieuwGemeld.push({ soort: 'bestel', id: b.id, code, naam: oms, regels: regel.concat([['Gemeld', P.voorstelTekst(b.voorstel)]]), voorstel: b.voorstel });
      if (st === 'besteld') { const e = perProject.get(code) || { soort: 'bestel', id: 'bestel:' + code, code, naam: '', regels: [], aantal: 0, lijst: [] }; e.aantal++; e.lijst.push(oms); perProject.set(code, e); }
    });
    perProject.forEach(e => { e.naam = e.aantal + ' bestelregel' + (e.aantal === 1 ? '' : 's') + ' onderweg: ' + e.lijst.slice(0, 3).join(', ') + (e.lijst.length > 3 ? ' …' : ''); e.regels = [['Project', e.code], ['Besteld, nog niet geleverd', e.lijst.join(', ')]]; uit.wachtMateriaal.push(e); });
    (Array.isArray(projecten) ? projecten : []).forEach(p => {
      if (!p || p._vervallen || !p.code || !PROJECT_ACTIEF.includes(p.fase)) return;
      const lever = P.isYmd(p.gegevens && p.gegevens.leverdatum) ? p.gegevens.leverdatum : ''; if (!lever || lever < vandaag || lever > zo) return;
      const open = takenVan(takenObj, p.code).filter(t => !isKlaar(t)).length;
      uit.teLeveren.push({ soort: 'project', id: 'project:' + p.code, code: p.code, naam: p.naam || p.code, lever, open, regels: [['Project', p.naam || p.code], ['Leverdatum', P.datumKort(lever)], ['Nog open', open + ' taken']] });
    });
    const op = k => (a, b) => (String(a[k] || '') < String(b[k] || '') ? -1 : String(a[k] || '') > String(b[k] || '') ? 1 : 0);
    uit.teLaat.sort(op('eind')); uit.teLeveren.sort(op('lever'));
    ['wachtMateriaal', 'wachtVoorganger', 'wachtAnders', 'nieuwGemeld'].forEach(k => uit[k].sort((a, b) => (String(a.code).toLowerCase() + '|' + String(a.naam).toLowerCase()) < (String(b.code).toLowerCase() + '|' + String(b.naam).toLowerCase()) ? -1 : 1));
    return uit;
  };

  // ── Deep links naar de telefoon (vanaf de tv): mobiel.html#taak/<projectcode>/<taak-id> en mobiel.html#project/<projectcode> ──
  P.deepLinkTaak = (basis, code, id) => String(basis || '') + '#taak/' + encodeURIComponent(String(code)) + '/' + encodeURIComponent(String(id));
  P.deepLinkProject = (basis, code) => String(basis || '') + '#project/' + encodeURIComponent(String(code));
  // → { soort: 'taak'|'project', code, id } of null (geen geldige link). Alleen de vorm wordt gecontroleerd; wat erin staat is alleen een zoeksleutel.
  P.deepLinkLees = function (hash) {
    const m = /^#?(taak|project)\/([^/#?]+)(?:\/([^/#?]+))?$/.exec(String(hash == null ? '' : hash).trim()); if (!m) return null;
    const dec = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
    if (m[1] === 'taak' && !m[3]) return null; if (m[1] === 'project' && m[3]) return null;
    return { soort: m[1], code: dec(m[2]), id: m[3] ? dec(m[3]) : '' };
  };

  // ── Journaal (alleen toevoegen): vereniging op id, gesorteerd op tijd, de laatste `max` ──
  P.journaalSamen = function (lokaal, remote, max) {
    const L = Array.isArray(lees(lokaal)) ? lees(lokaal) : [], R = Array.isArray(lees(remote)) ? lees(remote) : [], per = new Map();
    [...R, ...L].forEach(x => { if (x && x.id && !per.has(x.id)) per.set(x.id, x); });
    return [...per.values()].sort((a, b) => String(a.tijd).localeCompare(String(b.tijd))).slice(-(max > 0 ? max : 1000));
  };
  // Eén regel aan een gedeeld journaalbestand toevoegen (lezen, samenvoegen, schrijven met ETag). → true | false (mislukt; er is niets overschreven)
  P.journaalSchrijf = async function (sp, bestand, regel, max) {
    try {
      const r = await sp.read(bestand);
      if (r !== null && r !== undefined && !Array.isArray(r)) return false;   // geen lijst: nooit overschrijven
      return !!(await sp.write(bestand, P.journaalSamen([regel], r, max), (remote, lokaal) => P.journaalSamen(lokaal, remote, max)));
    } catch (e) { return false; }
  };

  // ── De schrijfkern voor taken ──
  // Leest mt_project_taken_v2 vers van SharePoint (met de ETag), voegt de lokale kopie (met nog niet gedeelde wijzigingen) erbij, laat `muteer` de actieve taken van
  // één project wijzigen, stempelt wat veranderde (stempel per veld, tombstone voor wat verdween) en schrijft het geheel terug. Een 412 (iemand schreef tussendoor)
  // wordt door de _SP opgelost met takenSamen. Het recht dat de wijziging vraagt wordt na het lezen en vlak vóór het schrijven gecontroleerd (mag(spec) → boolean),
  // en `voorWrite()` mag nog een laatste controle doen (bijvoorbeeld de schemaversie). Maakt het bestand NOOIT aan.
  //   muteer(actieveTaken) → de nieuwe lijst, undefined (de gewijzigde kopie telt) of false / { fout } (afwijzen).
  // → { ok, reden, fout?, recht?, data?, taken?, oud?, nieuw? }; reden: lezen | ontbreekt | vorm | weigering | recht | geblokkeerd | schrijven | aanroep.
  //   Bij reden 'schrijven' staat `data` (de samengevoegde stand mét de wijziging) er nog: de aanroeper bewaart die lokaal om later te delen.
  P.takenSchrijf = async function (sp, o) {
    o = o || {};
    const bestand = o.bestand || 'mt_project_taken_v2.json', nu = Number(o.nu) || Date.now(), code = o.code;
    if (!sp || typeof o.muteer !== 'function' || !code) return { ok: false, reden: 'aanroep', fout: 'Onvolledige aanroep.' };
    let raw; try { raw = await sp.read(bestand); } catch (e) { return { ok: false, reden: 'lezen', fout: String((e && e.message) || e) }; }
    if (raw === null || raw === undefined) return { ok: false, reden: 'ontbreekt' };
    const vorm = P.takenBestandVorm(raw); if (vorm) return { ok: false, reden: 'vorm', fout: vorm };
    let basis; try { basis = P.takenSamen(o.lokaal === undefined ? null : o.lokaal, raw); } catch (e) { return { ok: false, reden: 'vorm', fout: String((e && e.message) || e) }; }
    const oud = Array.isArray(basis[code]) ? basis[code] : [], actiefOud = P.takenActief(oud), werk = kopie(actiefOud);
    const r = o.muteer(werk);
    if (r === false || r === null || (r && !Array.isArray(r) && r.fout)) return { ok: false, reden: 'weigering', fout: (r && r.fout) || '' };
    const nieuw = Array.isArray(r) ? r : werk;
    const recht = P.takenRechtNodig(actiefOud, nieuw, { batch: !!o.batch }), toegestaan = () => !recht || typeof o.mag !== 'function' || !!o.mag(recht);
    if (!toegestaan()) return { ok: false, reden: 'recht', recht };
    const gestempeld = P.takenStempel(oud, nieuw, { nu, door: o.door || '', dev: o.dev || '', projectId: o.projectId || '' });
    const data = Object.assign({}, basis); data[code] = gestempeld;
    if (typeof o.voorWrite === 'function') { let toe; try { toe = await o.voorWrite(); } catch (e) { toe = false; } if (toe === false) return { ok: false, reden: 'geblokkeerd' }; }
    if (!toegestaan()) return { ok: false, reden: 'recht', recht };   // opnieuw na de await: het recht kan intussen veranderd zijn
    const ok = await sp.write(bestand, data, (remote, lokaal) => { try { return P.takenSamen(lokaal, remote); } catch (e) { return null; } });
    return { ok: !!ok, reden: ok ? '' : 'schrijven', data, taken: P.takenActief(gestempeld), oud: actiefOud, nieuw };
  };
  // Wijzigingen die lokaal bleven staan (schrijven mislukte eerder) alsnog delen: voeg lokaal en SharePoint samen en schrijf alleen als dat iets toevoegt.
  // o.remote = het al gelezen bestand (anders wordt het hier gelezen). → { ok, gewijzigd, data, reden? }
  P.takenPush = async function (sp, o) {
    o = o || {}; const bestand = o.bestand || 'mt_project_taken_v2.json';
    let raw = o.remote; if (raw === undefined) { try { raw = await sp.read(bestand); } catch (e) { return { ok: false, gewijzigd: false, reden: 'lezen' }; } }
    if (raw === null || raw === undefined) return { ok: false, gewijzigd: false, reden: 'ontbreekt' };
    let basis, alleen; try { basis = P.takenSamen(o.lokaal === undefined ? null : o.lokaal, raw); alleen = P.takenSamen(null, raw); } catch (e) { return { ok: false, gewijzigd: false, reden: 'vorm', fout: String((e && e.message) || e) }; }
    if (JSON.stringify(basis) === JSON.stringify(alleen)) return { ok: true, gewijzigd: false, data: basis };
    if (typeof o.voorWrite === 'function') { let toe; try { toe = await o.voorWrite(); } catch (e) { toe = false; } if (toe === false) return { ok: false, gewijzigd: true, data: basis, reden: 'geblokkeerd' }; }
    const ok = await sp.write(bestand, basis, (remote, lokaal) => { try { return P.takenSamen(lokaal, remote); } catch (e) { return null; } });
    return { ok: !!ok, gewijzigd: true, data: basis, reden: ok ? '' : 'schrijven' };
  };

  // ── Een nieuwe taak als melding (Taak melden / Probleem melden) ──
  // Komt meteen in het project, gemarkeerd als voorstel (`voorstel`: wie, welke rol, wanneer); kantoor ziet het en beslist. Een probleem krijgt prioriteit high.
  P.meldingTaak = function ({ naam = '', omschrijving = '', soort = 'taak', door = '', doorNaam = '', rol = '', nu = Date.now(), id = '' } = {}) {
    const n = String(naam).replace(/\s+/g, ' ').trim(); if (!n) return null;
    const probleem = soort === 'probleem';
    return { id: id || P.taakId(), naam: n.slice(0, 160), omschrijving: String(omschrijving || '').trim().slice(0, 1000), duur_uur: 0, prioriteit: probleem ? 'high' : '', afhankelijk_van: [], status: 'todo', tg_task_id: null,
      bron: 'melding', activiteit: P.activiteitUitNaam(n) || undefined, voorstel: { soort: probleem ? 'probleem' : 'taak', door, doorNaam, rol, ts: new Date(nu).toISOString() } };
  };
  // Een bestelvoorstel: een gewone bestelregel (status nodig) met de markering `voorstel`. project_id/project: zoals de cockpit (code en technische sleutel).
  P.meldingBestel = function ({ omschrijving = '', aantal = 1, eenheid = '', project = '', project_id = '', opmerking = '', door = '', doorNaam = '', rol = '', nu = Date.now(), datum = '', id = '' } = {}) {
    const oms = String(omschrijving).replace(/\s+/g, ' ').trim(); if (!oms) return null;
    const r = P.bestelRegelNieuw({ omschrijving: oms.slice(0, 200), aantal, eenheid, bron: 'hand', project, project_id, datum: P.isYmd(datum) ? datum : P.vandaagYmd(), id });
    if (opmerking && String(opmerking).trim()) r.opmerking = String(opmerking).trim().slice(0, 300);
    r.voorstel = { soort: 'bestel', door, doorNaam, rol, ts: new Date(nu).toISOString() };
    return r;
  };
  // Een nieuwe bestelregel toevoegen aan mt_bestellijst_v2 (lezen, samenvoegen met de lokale kopie, stempelen, schrijven met ETag/412-merge). Maakt het bestand nooit aan.
  // o.journaal(regel) → belofte van true: eerst het herstelspoor (zoals de cockpit); lukt dat niet, dan gebeurt er niets. → { ok, reden, data?, regel? }
  P.bestelNieuwSchrijf = async function (sp, o) {
    o = o || {}; const bestand = o.bestand || 'mt_bestellijst_v2.json', nu = Number(o.nu) || Date.now(), regel = o.regel;
    if (!sp || !regel || !regel.id) return { ok: false, reden: 'aanroep', fout: 'Onvolledige aanroep.' };
    let raw; try { raw = await sp.read(bestand); } catch (e) { return { ok: false, reden: 'lezen', fout: String((e && e.message) || e) }; }
    if (raw === null || raw === undefined) return { ok: false, reden: 'ontbreekt' };
    const vorm = P.bestelBestandVorm(raw); if (vorm) return { ok: false, reden: 'vorm', fout: vorm };
    let samen; try { samen = P.bestelSamen(o.lokaal === undefined ? null : o.lokaal, raw); } catch (e) { return { ok: false, reden: 'vorm', fout: String((e && e.message) || e) }; }
    if (samen.some(b => b && String(b.id) === String(regel.id))) return { ok: false, reden: 'bestaat' };
    const toegestaan = () => typeof o.mag !== 'function' || !!o.mag(P.ROL.BESTEL_TOEV);
    if (!toegestaan()) return { ok: false, reden: 'recht', recht: P.ROL.BESTEL_TOEV };
    regel._gewijzigd = new Date(nu).toISOString(); if (o.door) regel._door = o.door;
    P.bestelVeldStempel(null, regel, { t: nu, door: o.door || '', dev: o.dev || '' });
    if (typeof o.journaal === 'function') { let j; try { j = await o.journaal(regel); } catch (e) { j = false; } if (!j) return { ok: false, reden: 'journaal' }; }
    if (typeof o.voorWrite === 'function') { let toe; try { toe = await o.voorWrite(); } catch (e) { toe = false; } if (toe === false) return { ok: false, reden: 'geblokkeerd' }; }
    if (!toegestaan()) return { ok: false, reden: 'recht', recht: P.ROL.BESTEL_TOEV };
    const data = P.bestelSamen(JSON.stringify(samen.concat([regel])), null);
    const ok = await sp.write(bestand, data, (remote, lokaal) => { try { return P.bestelSamen(lokaal, remote); } catch (e) { return null; } });
    return { ok: !!ok, reden: ok ? '' : 'schrijven', data, regel };
  };

  root.MTPlanning = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
