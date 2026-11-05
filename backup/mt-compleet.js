/* ============================================================================
 * mt-compleet.js: het paneel "Planning compleet?" in Planning (controle, alleen lezen)
 * ----------------------------------------------------------------------------
 * Toont vier controles die zeggen of de planning betrouwbaar is, elk met een aantal, een uitleg in een zin en een doorklik naar de lijst:
 *   a. open taken zonder schatting (per project);
 *   b. werkuren in de capaciteit bij inactieve Toggl-gebruikers (en gebruikers waarvan Toggl de status niet meegeeft: dan staat dat erbij);
 *   c. mensen zonder werkuren, werkuren die afwijken van Beheer, en verlof (komende 8 weken) dat niet in de Toggl-capaciteit zit;
 *   d. uren van de laatste 4 weken zonder project en zonder taak, per persoon als percentage (nooit omschrijvingen).
 * De controles b, c en d lezen teamgegevens uit Toggl en zijn er alleen voor wie teamgegevens mag zien (D.teamdata()). Controle a gebruikt de taken die
 * in de planning al zichtbaar zijn. Er wordt niets geschreven en niets in Toggl gewijzigd.
 * Het rekenwerk (C.zonderSchatting, C.gebruikers, C.urenZonderKoppeling, C.telling) is los te testen zonder DOM; tekent met DOM-calls, nooit met
 * opgebouwde HTML. Alles van buiten via init(deps). C.telling() levert de compacte teller voor "Heeft jou nodig".
 * ========================================================================== */
(function (root) {
  'use strict';
  const C = {};
  let D = null, P = null;
  const WEKEN_VOORUIT = 8, DAGEN_TERUG = 28, AFWIJKING_UUR = 1.5, DREMPEL_PCT = 20, MAX_WACHT_MS = 30000;
  const S = { toggl: { status: 'nieuw' }, uren: { status: 'nieuw' }, open: {}, bezig: false };
  C.S = S;

  // ── datums ──
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const naarDatum = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const plusDagen = (s, n) => { const d = naarDatum(s); d.setDate(d.getDate() + n); return ymd(d); };
  const weekdag = s => (naarDatum(s).getDay() + 6) % 7;   // 0 = maandag
  // De periode vooruit: van de maandag van deze week tot en met 8 weken later (56 dagen); de periode terug: de laatste 28 dagen t/m gisteren.
  C.vensterVooruit = vandaag => { const van = plusDagen(vandaag, -weekdag(vandaag)); return { van, tot: plusDagen(van, WEKEN_VOORUIT * 7 - 1), weken: WEKEN_VOORUIT }; };
  C.vensterTerug = vandaag => ({ van: plusDagen(vandaag, -DAGEN_TERUG), tot: plusDagen(vandaag, -1) });
  const uurTekst = u => (Math.round(u * 10) / 10).toString().replace('.', ',') + ' u';

  // ── a. open taken zonder schatting ──
  // o = { taken: { code: [taak] }, projecten: [{code,label}], team, planning }  →  { totaal, groepen: [{ code, label, aantal, taken: [{ id, naam, persoon }] }] }
  C.zonderSchatting = function (o) {
    const Pl = o.planning || P, team = o.team || [], taken = o.taken || {};
    const label = new Map((o.projecten || []).map(p => [String(p.code).toLowerCase(), p.label || p.code]));
    const groepen = [];
    Object.keys(taken).forEach(code => {
      if (code.startsWith('__') || !Array.isArray(taken[code])) return;
      const lijst = [];
      Pl.takenActief(taken[code]).forEach(t => {
        if ((t.status || 'todo') === 'klaar' || t.soort === 'mijlpaal') return;
        if (Pl.taakRamingMin(t) > 0) return;
        lijst.push({ id: t.id, naam: t.naam || '', persoon: Pl.persoonSlug(Pl.taakMensen(t)[0], team) || '' });
      });
      if (lijst.length) groepen.push({ code, label: label.get(String(code).toLowerCase()) || code, aantal: lijst.length, taken: lijst });
    });
    groepen.sort((a, b) => b.aantal - a.aantal || String(a.label).localeCompare(String(b.label), 'nl'));
    return { totaal: groepen.reduce((n, g) => n + g.aantal, 0), groepen };
  };

  // ── b en c. capaciteit per gebruiker ──
  const eersteWoord = s => String(s || '').trim().toLowerCase().split(/\s+/)[0] || '';
  C.teamLid = function (u, team) {
    const em = String(u.email || '').toLowerCase();
    const echt = (team || []).filter(m => m && !m.placeholder);
    return echt.find(m => em && String(m.email || '').toLowerCase() === em) || echt.find(m => eersteWoord(u.naam) && eersteWoord(u.naam) === String(m.slug || '').toLowerCase()) || null;
  };
  // o = { users: [{id,naam,email,actief}], cap: { id: { ymd: {werk,gepland,vrij,verlof} } }, fouten: { id: code }, team, werkuren: { slug: uren/week }, verlof: [{persoon,van,tm}], vandaag, planning }
  C.gebruikers = function (o) {
    const Pl = o.planning || P, team = o.team || [], users = o.users || [], cap = o.cap || {}, fouten = o.fouten || {};
    const v = C.vensterVooruit(o.vandaag || Pl.vandaagYmd()), werkuren = o.werkuren || {};
    const uit = { inactief: [], statusOnbekend: false, zonderWerkuren: [], afwijkend: [], verlofMist: [], geenCapaciteit: [] };
    uit.statusOnbekend = users.length > 0 && users.every(u => u.actief == null);
    users.forEach(u => {
      const dagen = cap[u.id];
      if (!dagen) { if (u.actief !== false) uit.geenCapaciteit.push({ id: u.id, naam: u.naam, code: fouten[u.id] || '' }); return; }
      const lid = C.teamLid(u, team), slug = lid ? String(lid.slug || '').toLowerCase() : '';
      let som = 0; Object.keys(dagen).forEach(d => { if (d >= v.van && d <= v.tot) som += Number(dagen[d].werk) || 0; });
      if (u.actief === false) { if (som > 0) uit.inactief.push({ id: u.id, naam: u.naam, uren: som }); return; }
      if (som === 0) uit.zonderWerkuren.push({ id: u.id, naam: u.naam, slug });
      else if (slug && isFinite(Number(werkuren[slug]))) {
        const pw = som / v.weken, beheer = Number(werkuren[slug]);
        if (Math.abs(pw - beheer) > AFWIJKING_UUR) uit.afwijkend.push({ id: u.id, naam: u.naam, slug, toggl: pw, beheer });
      }
      if (slug) {
        const vrij = Pl.verlofDagen(o.verlof, slug, team), mist = [];
        vrij.forEach(d => { const x = dagen[d]; if (d >= (o.vandaag || v.van) && d <= v.tot && weekdag(d) < 5 && x && x.werk > 0 && !(x.verlof > 0)) mist.push(d); });
        mist.sort();
        if (mist.length) uit.verlofMist.push({ id: u.id, naam: u.naam, slug, dagen: mist.length, eerste: mist[0], laatste: mist[mist.length - 1] });
      }
    });
    uit.inactief.sort((a, b) => b.uren - a.uren);
    return uit;
  };

  // ── d. uren zonder project en zonder taak ──
  // o = { rijen: [{user, project, taak, sec}], users: [{id,naam,email}], team }  →  { totaalUur, zonderUur, pct, personen: [{ id, naam, slug, uur, zonderUur, pct, boven }] }
  C.urenZonderKoppeling = function (o) {
    const users = o.users || [], per = new Map();
    (o.rijen || []).forEach(r => {
      const k = String(r.user), x = per.get(k) || { sec: 0, zonder: 0 };
      x.sec += r.sec; if (r.project == null && r.taak == null) x.zonder += r.sec; per.set(k, x);
    });
    const personen = [];
    per.forEach((x, k) => {
      if (x.sec <= 0) return;
      const u = users.find(y => String(y.id) === k) || { id: k, naam: 'Onbekende gebruiker' }, lid = C.teamLid(u, o.team);
      const pct = Math.round(x.zonder / x.sec * 100);
      personen.push({ id: u.id, naam: u.naam || (lid && lid.naam) || 'Onbekende gebruiker', slug: lid ? String(lid.slug || '').toLowerCase() : '', uur: x.sec / 3600, zonderUur: x.zonder / 3600, pct, boven: pct >= DREMPEL_PCT });
    });
    personen.sort((a, b) => b.pct - a.pct || b.zonderUur - a.zonderUur);
    const tot = personen.reduce((n, p) => n + p.uur, 0), zonder = personen.reduce((n, p) => n + p.zonderUur, 0);
    return { totaalUur: tot, zonderUur: zonder, pct: tot > 0 ? Math.round(zonder / tot * 100) : 0, personen };
  };

  // ── de vier controles op een rij (voor het paneel en de teller) ──
  // m = { a, g (C.gebruikers), u (C.urenZonderKoppeling) } → [{ k, titel, aantal, uitleg, gereed }]
  C.controles = function (m) {
    const g = m.g, u = m.u;
    return [
      { k: 'a', titel: 'Open taken zonder schatting', aantal: m.a ? m.a.totaal : null, gereed: !!m.a, uitleg: 'Zonder schatting is de capaciteit onbetrouwbaar: de vrije uren lijken groter dan ze zijn.' },
      { k: 'b', titel: 'Werkuren bij inactieve gebruikers', aantal: g ? g.inactief.length : null, gereed: !!g, uitleg: 'Een inactieve gebruiker met werkuren telt nog mee in de capaciteit van het team.' },
      { k: 'c', titel: 'Werkuren en verlof kloppen niet', aantal: g ? g.zonderWerkuren.length + g.afwijkend.length + g.verlofMist.length : null, gereed: !!g, uitleg: 'Mensen zonder werkuren, werkuren die afwijken van Beheer, of verlof dat niet in de Toggl-capaciteit staat.' },
      { k: 'd', titel: 'Uren zonder project en taak', aantal: u ? u.personen.filter(p => p.boven).length : null, gereed: !!u, uitleg: 'Per persoon het aandeel uren van de laatste 4 weken dat nergens aan hangt (drempel ' + DREMPEL_PCT + '%); aantal = personen boven de drempel.' },
    ];
  };
  // De compacte teller voor "Heeft jou nodig": hoeveel controles hebben een bevinding, plus de totalen. Alleen wat al berekend is telt mee.
  C.telling = function (m) {
    const lijst = C.controles(m || {}).filter(c => c.gereed);
    const bevind = lijst.filter(c => c.aantal > 0);
    return { controles: lijst.length, metBevinding: bevind.length, totaal: bevind.reduce((n, c) => n + c.aantal, 0), tekst: bevind.length ? bevind.length + (bevind.length === 1 ? ' controle' : ' controles') + ' in Planning compleet? met een bevinding' : '' };
  };

  // ── laden (Toggl, alleen lezen) ──
  const metTijdslimiet = (belofte, ms) => new Promise((ok, fout) => {
    const t = setTimeout(() => fout(new Error('Toggl antwoordde niet binnen ' + Math.round(ms / 1000) + ' seconden')), ms);
    belofte.then(x => { clearTimeout(t); ok(x); }, e => { clearTimeout(t); fout(e); });
  });
  const foutTekst = e => (D.foutTekst ? D.foutTekst(e) : (e && e.message) || 'onbekende fout');
  C.laadToggl = async function (ververs) {
    const st = S.toggl; if (st.status === 'laden') return;
    st.status = 'laden'; st.fout = ''; C.teken();
    try {
      const vandaag = P.vandaagYmd(), v = C.vensterVooruit(vandaag);
      const users = await metTijdslimiet(D.gebruikers(), MAX_WACHT_MS);
      if (!users.length) throw new Error('Toggl gaf geen gebruikers terug');
      const cap = await metTijdslimiet(D.capaciteit(users.map(u => u.id), v.van, v.tot, !!ververs), MAX_WACHT_MS);
      const fouten = (D.capaciteitFouten && D.capaciteitFouten()) || {};
      if (!Object.keys(cap || {}).length) throw new Error('Toggl gaf voor niemand capaciteit terug' + (D.capaciteitReden ? ' (' + D.capaciteitReden() + ')' : ''));
      st.g = C.gebruikers({ users, cap, fouten, team: D.team(), werkuren: D.werkuren(), verlof: D.verlof(), vandaag, planning: P });
      st.users = users; st.status = 'ok'; st.reden = D.capaciteitReden ? D.capaciteitReden() : '';
    } catch (e) { st.status = 'fout'; st.fout = foutTekst(e); }
    C.teken(); C.meld();
  };
  C.laadUren = async function (ververs) {
    const st = S.uren; if (st.status === 'laden') return;
    st.status = 'laden'; st.fout = ''; C.teken();
    try {
      const vandaag = P.vandaagYmd(), v = C.vensterTerug(vandaag);
      const users = await metTijdslimiet(D.gebruikers(), MAX_WACHT_MS);
      const rijen = await metTijdslimiet(D.uren(v.van, v.tot, !!ververs), MAX_WACHT_MS);
      st.u = C.urenZonderKoppeling({ rijen, users, team: D.team() }); st.van = v.van; st.tot = v.tot; st.status = 'ok';
    } catch (e) { st.status = 'fout'; st.fout = foutTekst(e); }
    C.teken(); C.meld();
  };
  C.model = function () {
    const a = C.zonderSchatting({ taken: D.taken(), projecten: D.projecten(), team: D.team(), planning: P });
    return { a, g: S.toggl.status === 'ok' ? S.toggl.g : null, u: S.uren.status === 'ok' ? S.uren.u : null };
  };
  // Na elke berekening de compacte teller doorgeven (de plek in "Heeft jou nodig" luistert via D.naTelling).
  C.meld = function () { try { if (D && D.naTelling) D.naTelling(C.telling(C.model())); } catch (e) { console.warn('Planning compleet (teller):', e); } };

  // ── tekenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v);
      else if (k === 'stijl') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const STIJL = '#agenda-compleet{padding:4px 2px}'
    + '#agenda-compleet .pc-kop{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:10px}#agenda-compleet .pc-kop h3{margin:0;font-size:16px}#agenda-compleet .pc-sub{font-size:12px;color:var(--text-dim,#666)}'
    + '#agenda-compleet .pc-raster{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}'
    + '#agenda-compleet .pc-kaart{border:1px solid var(--border,#ddd);border-radius:10px;padding:12px 14px;background:var(--bg-card,#fff)}'
    + '#agenda-compleet .pc-rij{display:flex;align-items:baseline;gap:10px}#agenda-compleet .pc-aantal{font-size:26px;font-weight:600;min-width:34px;font-variant-numeric:tabular-nums}'
    + '#agenda-compleet .pc-aantal.goed{color:#1f6b3a}#agenda-compleet .pc-aantal.let{color:#8a5a00}#agenda-compleet .pc-aantal.nvt{color:var(--text-faint,#888)}'
    + '#agenda-compleet .pc-titel{font-weight:600;font-size:14px}#agenda-compleet .pc-uitleg{font-size:12.5px;color:var(--text-dim,#666);margin:4px 0 8px}'
    + '#agenda-compleet .pc-knop{font:inherit;font-size:12.5px;min-height:32px;padding:0 10px;border:1px solid var(--border,#ccc);border-radius:7px;background:transparent;cursor:pointer;color:inherit}'
    + '#agenda-compleet .pc-knop:hover{background:rgba(0,0,0,.05)}#agenda-compleet .pc-link{border:0;background:none;padding:2px 0;cursor:pointer;color:var(--accent,#1f5c36);font:inherit;text-align:left;text-decoration:underline}'
    + '#agenda-compleet .pc-lijst{margin:8px 0 0;padding:0;list-style:none;font-size:13px}#agenda-compleet .pc-lijst li{padding:3px 0;border-top:1px solid var(--border,#eee);display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}'
    + '#agenda-compleet .pc-groep{font-weight:600;margin-top:8px;font-size:13px}#agenda-compleet .pc-meta{color:var(--text-dim,#666);font-size:12px}'
    + '#agenda-compleet .pc-fout{background:#FBEAEA;border:1px solid #E5B5B5;color:#8a1c1c;border-radius:8px;padding:8px 10px;font-size:13px;margin-top:6px}'
    + '#agenda-compleet .pc-let{background:#FBF0E0;border:1px solid #E8D48A;color:#7A6010;border-radius:8px;padding:6px 10px;font-size:12.5px;margin-top:6px}'
    + '#agenda-compleet .pc-bal{height:6px;background:#e8e8e8;border-radius:3px;overflow:hidden;width:90px}#agenda-compleet .pc-bal i{display:block;height:100%;background:#b3762a}';

  const aantalEl = (n, gereed) => el('span', { klass: 'pc-aantal ' + (!gereed ? 'nvt' : n > 0 ? 'let' : 'goed'), tekst: gereed ? String(n) : '–', 'aria-label': gereed ? n + ' gevonden' : 'nog niet berekend' });
  const knop = (tekst, klik, extra) => el('button', Object.assign({ type: 'button', klass: 'pc-knop', tekst, klik }, extra || {}));
  const link = (tekst, klik, titel) => el('button', { type: 'button', klass: 'pc-link', tekst, klik, title: titel || null });
  const wisselKnop = (k, n) => n > 0 ? knop(S.open[k] ? 'Verberg lijst' : 'Toon lijst (' + n + ')', () => { S.open[k] = !S.open[k]; C.teken(); }, { 'aria-expanded': S.open[k] ? 'true' : 'false' }) : null;
  const opnieuw = (soort) => knop('Opnieuw proberen', () => (soort === 'uren' ? C.laadUren(true) : C.laadToggl(true)));
  const laadStatus = (st, soort) => st.status === 'laden' ? el('div', { klass: 'pc-meta', role: 'status', tekst: 'Bezig met laden uit Toggl…' })
    : st.status === 'fout' ? el('div', { klass: 'pc-fout', role: 'alert' }, 'Toggl kon dit niet leveren: ' + st.fout + '. ', opnieuw(soort))
    : st.status === 'nieuw' ? knop('Controleer nu', () => (soort === 'uren' ? C.laadUren() : C.laadToggl())) : null;
  const persoonKnop = (naam, slug) => slug && D.openPersoon ? link(naam, () => D.openPersoon(slug), 'Open de capaciteit van ' + naam) : el('span', { tekst: naam });

  function kaartA(m) {
    const a = m.a, c = C.controles(m)[0];
    const k = el('div', { klass: 'pc-kaart', 'data-controle': 'a' }, el('div', { klass: 'pc-rij' }, aantalEl(a.totaal, true), el('div', { klass: 'pc-titel', tekst: c.titel })), el('div', { klass: 'pc-uitleg', tekst: c.uitleg }), wisselKnop('a', a.totaal));
    if (!a.totaal) k.appendChild(el('div', { klass: 'pc-meta', tekst: 'Alle open taken hebben een schatting.' }));
    if (S.open.a) a.groepen.forEach(g => {
      k.appendChild(el('div', { klass: 'pc-groep' }, link(g.label, () => D.openProject(g.code), 'Open de planning van dit project'), el('span', { klass: 'pc-meta', tekst: ' · ' + g.aantal })));
      k.appendChild(el('ul', { klass: 'pc-lijst' }, g.taken.map(t => el('li', null, link(t.naam || '(zonder naam)', ev => D.openTaak(g.code, t.id, ev.currentTarget), 'Open de taak'), t.persoon ? el('span', { klass: 'pc-meta', tekst: t.persoon }) : null))));
    });
    return k;
  }
  function kaartB(m) {
    const st = S.toggl, g = m.g, c = C.controles(m)[1];
    const k = el('div', { klass: 'pc-kaart', 'data-controle': 'b' }, el('div', { klass: 'pc-rij' }, aantalEl(g ? g.inactief.length : 0, !!g), el('div', { klass: 'pc-titel', tekst: c.titel })), el('div', { klass: 'pc-uitleg', tekst: c.uitleg }));
    const ls = laadStatus(st, 'toggl'); if (ls) k.appendChild(ls);
    if (g) {
      if (g.statusOnbekend) k.appendChild(el('div', { klass: 'pc-let', tekst: 'Toggl geeft in de gebruikerslijst niet door wie inactief is, dus deze controle kan niets vinden. Controleer de gebruikers in Toggl zelf.' }));
      else if (!g.inactief.length) k.appendChild(el('div', { klass: 'pc-meta', tekst: 'Geen inactieve gebruiker met werkuren in de komende 8 weken.' }));
      const w = wisselKnop('b', g.inactief.length); if (w) k.appendChild(w);
      if (S.open.b && g.inactief.length) k.appendChild(el('ul', { klass: 'pc-lijst' }, g.inactief.map(x => el('li', null, el('span', { tekst: x.naam || 'Onbekend' }), el('span', { klass: 'pc-meta', tekst: uurTekst(x.uren) + ' werkuren in 8 weken · haal weg of zet op 0 in Toggl' })))));
    }
    return k;
  }
  function kaartC(m) {
    const st = S.toggl, g = m.g, c = C.controles(m)[2];
    const n = g ? g.zonderWerkuren.length + g.afwijkend.length + g.verlofMist.length : 0;
    const k = el('div', { klass: 'pc-kaart', 'data-controle': 'c' }, el('div', { klass: 'pc-rij' }, aantalEl(n, !!g), el('div', { klass: 'pc-titel', tekst: c.titel })), el('div', { klass: 'pc-uitleg', tekst: c.uitleg }));
    const ls = laadStatus(st, 'toggl'); if (ls) k.appendChild(ls);
    if (g) {
      if (g.geenCapaciteit.length) k.appendChild(el('div', { klass: 'pc-let', tekst: 'Geen capaciteit van Toggl voor: ' + g.geenCapaciteit.map(x => x.naam || 'onbekend').join(', ') + (st.reden ? ' (' + st.reden + ')' : '') + '.' }));
      if (!n) k.appendChild(el('div', { klass: 'pc-meta', tekst: 'Werkuren en verlof kloppen met Beheer.' }));
      const w = wisselKnop('c', n); if (w) k.appendChild(w);
      if (S.open.c && n) {
        const blok = (kop, rijen) => rijen.length ? [el('div', { klass: 'pc-groep', tekst: kop }), el('ul', { klass: 'pc-lijst' }, rijen)] : [];
        k.appendChild(el('div', null,
          blok('Geen werkuren in de komende 8 weken', g.zonderWerkuren.map(x => el('li', null, persoonKnop(x.naam, x.slug)))),
          blok('Werkuren wijken af van Beheer (per week)', g.afwijkend.map(x => el('li', null, persoonKnop(x.naam, x.slug), el('span', { klass: 'pc-meta', tekst: 'Toggl ' + uurTekst(x.toggl) + ' · Beheer ' + uurTekst(x.beheer) })))),
          blok('Verlof (Beheer) dat niet in de Toggl-capaciteit zit', g.verlofMist.map(x => el('li', null, persoonKnop(x.naam, x.slug), el('span', { klass: 'pc-meta', tekst: x.dagen + (x.dagen === 1 ? ' werkdag' : ' werkdagen') + ' · ' + x.eerste + (x.laatste !== x.eerste ? ' t/m ' + x.laatste : '') }))))));
      }
    }
    return k;
  }
  function kaartD(m) {
    const st = S.uren, u = m.u, c = C.controles(m)[3];
    const n = u ? u.personen.filter(p => p.boven).length : 0;
    const k = el('div', { klass: 'pc-kaart', 'data-controle': 'd' }, el('div', { klass: 'pc-rij' }, aantalEl(n, !!u), el('div', { klass: 'pc-titel', tekst: c.titel })), el('div', { klass: 'pc-uitleg', tekst: c.uitleg }));
    const ls = laadStatus(st, 'uren'); if (ls) k.appendChild(ls);
    if (u) {
      k.appendChild(el('div', { klass: 'pc-meta', tekst: st.van + ' t/m ' + st.tot + ': ' + uurTekst(u.zonderUur) + ' van ' + uurTekst(u.totaalUur) + ' (' + u.pct + '%) hangt nergens aan.' }));
      const w = wisselKnop('d', u.personen.length); if (w) k.appendChild(w);
      if (S.open.d) k.appendChild(el('ul', { klass: 'pc-lijst' }, u.personen.map(p => el('li', null, persoonKnop(p.naam, p.slug), el('span', { klass: 'pc-bal', 'aria-hidden': 'true' }, el('i', { stijl: 'width:' + Math.min(100, p.pct) + '%' })), el('span', { klass: 'pc-meta', tekst: p.pct + '% · ' + uurTekst(p.zonderUur) + ' van ' + uurTekst(p.uur) })))));
    }
    return k;
  }

  C.teken = function () {
    const w = D && D.doc.getElementById('agenda-compleet'); if (!w) return;
    w.textContent = '';
    if (!D.doc.getElementById('pc-stijl')) { const s = el('style', { id: 'pc-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    let m;
    try { m = C.model(); } catch (e) { console.warn('Planning compleet:', e); w.appendChild(el('div', { klass: 'pc-fout', tekst: 'Het overzicht kon niet worden berekend.' })); return; }
    const mag = !!(D.teamdata && D.teamdata()), t = C.telling(m);
    w.appendChild(el('div', { klass: 'pc-kop' }, el('h3', { tekst: 'Planning compleet?' }), el('span', { klass: 'pc-sub', tekst: 'Alleen lezen. Er wordt niets in Toggl gewijzigd.' + (t.controles ? ' ' + (t.metBevinding ? t.metBevinding + ' van ' + t.controles + ' controles met een bevinding.' : 'Alle berekende controles zijn in orde.') : '') }),
      mag ? knop('Opnieuw controleren', () => { C.laadToggl(true); C.laadUren(true); }) : null));
    if (D.takenKlaar && !D.takenKlaar()) w.appendChild(el('div', { klass: 'pc-let', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const raster = el('div', { klass: 'pc-raster' }, kaartA(m));
    if (mag) raster.appendChild(kaartB(m)), raster.appendChild(kaartC(m)), raster.appendChild(kaartD(m));
    else w.appendChild(el('div', { klass: 'pc-meta', tekst: 'De controles op werkuren, verlof en geklokte uren zijn er alleen voor beheerders.' }));
    w.appendChild(raster);
  };
  // Bij het openen van het tabblad: de lokale controle meteen, de Toggl-controles één keer (daarna met de knop).
  C.open = function () {
    C.teken(); C.meld();
    if (D.teamdata && D.teamdata()) { if (S.toggl.status === 'nieuw') C.laadToggl(); if (S.uren.status === 'nieuw') C.laadUren(); }
  };

  C.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return C; };
  root.MTCompleet = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
