/* ============================================================================
 * mt-planfilter.js: één filterbalk voor alle planningsweergaven (planning brok P0, "weergave-schil")
 * ----------------------------------------------------------------------------
 * De schermstand die Mijn werk, de Capaciteit, het Bord en de Planning van een project delen: project, persoon, status, periode (begindatum en zoom) en de geselecteerde taak.
 * Eén bron, één balk: elke weergave tekent dezelfde balk (F.balk), leest dezelfde stand en laat het filter in de link staan, dus wisselen van weergave behoudt wat je
 * koos, een gekopieerde link toont dezelfde stand en de laatste keuze (project, persoon, status) wordt per gebruiker onthouden.
 * Alleen schermstand: niets hiervan gaat naar SharePoint; de enige opslag is localStorage (altijd in try/catch, het scherm werkt ook zonder).
 * De link: #tab=agenda&weergave=capaciteit&project=<code>&wie=<ik|iedereen|slug>&status=<open|bezig|wacht|klaar>&van=<jjjj-mm-dd>&zoom=<week|…>
 *   en voor een project: #projecten/<code>/planning?status=…&wie=…  (een oude #tab=agenda blijft werken: dan geldt de onthouden stand).
 * Rekenwerk zonder DOM (leesLink, linkStaart, statusPast, persoonPast) is los te testen; tekent met DOM-calls, nooit met opgebouwde HTML. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const F = {};
  let D = null;
  const LS = 'mt-planfilter';
  const WEERGAVEN = ['mijnwerk', 'capaciteit', 'bord', 'tijdlijn', 'grid', 'lijst', 'plan'];
  const ZOOMS = ['kwartaal', 'maand', 'week', '3d', 'dag'];
  const STATUSSEN = [['open', 'Open', 'todo'], ['bezig', 'Bezig', 'bezig'], ['wacht', 'Wacht', 'wacht'], ['klaar', 'Klaar', 'klaar']];   // [linkwaarde, label, taakstatus]
  const BORDEN = ['status', 'stroom', 'fase', 'week'];   // de indeling van het Bord (P3)
  const SLEUTELS = ['project', 'persoon', 'status', 'van', 'zoom', 'bord'];
  const LINK = { project: 'project', persoon: 'wie', status: 'status', van: 'van', zoom: 'zoom', bord: 'bord' };
  const S = { project: '', persoon: '', status: '', van: '', zoom: '', bord: '', selectie: null, rev: 0, hashAchter: false };
  let geladen = false;
  const luisteraars = [];

  // ── rekenwerk (geen DOM) ──
  const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const code = v => { const s = String(v == null ? '' : v).trim(); return /^[\w.\- ]{1,80}$/.test(s) ? s : ''; };   // een project- of persoonscode: letters, cijfers, punt, streepje, spatie
  const GELDIG = {
    project: code,
    persoon: v => { const s = code(v); return s.toLowerCase() === 'ik' || s.toLowerCase() === 'iedereen' ? s.toLowerCase() : s; },
    status: v => STATUSSEN.some(x => x[0] === v) ? v : '',
    van: v => isYmd(v) ? v : '',
    zoom: v => ZOOMS.includes(v) ? v : '',
    bord: v => BORDEN.includes(v) ? v : ''
  };
  F.WEERGAVEN = WEERGAVEN; F.ZOOMS = ZOOMS; F.STATUSSEN = STATUSSEN;
  F.isYmd = isYmd;
  // Uit de tekst van een link (alles na #tab=agenda of ?): { weergave?, filter? } met alleen geldige waarden, of null als er niets bruikbaars staat
  F.leesLink = function (tekst) {
    const uit = {}, filter = {};
    String(tekst || '').split(/[&]/).forEach(deel => {
      const i = deel.indexOf('='); if (i < 1) return;
      let k, v; try { k = decodeURIComponent(deel.slice(0, i)); v = decodeURIComponent(deel.slice(i + 1)); } catch (e) { return; }
      if (k === 'weergave') { if (WEERGAVEN.includes(v)) uit.weergave = v; return; }
      const s = SLEUTELS.find(x => LINK[x] === k); if (!s) return;
      const w = GELDIG[s](v); if (w) filter[s] = w;
    });
    if (Object.keys(filter).length) uit.filter = filter;
    return uit.weergave || uit.filter ? uit : null;
  };
  // De staart van een link: '&weergave=…&project=…' in vaste volgorde; lege waarden ontbreken
  F.linkStaart = function (weergave, filter) {
    const f = filter || {}, enc = encodeURIComponent, delen = [];
    if (WEERGAVEN.includes(weergave)) delen.push('weergave=' + enc(weergave));
    SLEUTELS.forEach(s => { const w = f[s]; if (w !== undefined && w !== null && w !== '' && GELDIG[s](w)) delen.push(LINK[s] + '=' + enc(GELDIG[s](w))); });
    return delen.length ? '&' + delen.join('&') : '';
  };
  // Dezelfde stand als vrije sleutels voor een project-link (#projecten/<code>/planning?status=…&wie=…): alleen wat voor één project zinvol is
  F.projectFilter = function (st) {
    const s = st || S, uit = {};
    if (GELDIG.status(s.status)) uit[LINK.status] = s.status;
    if (s.persoon) uit[LINK.persoon] = s.persoon;
    return uit;
  };
  F.statusTaak = linkwaarde => { const x = STATUSSEN.find(y => y[0] === linkwaarde); return x ? x[2] : ''; };
  // Past een taakstatus bij de gekozen status? ('' = alles). Een planblok zonder taak heeft geen status: bij een statusfilter valt hij af.
  F.statusPast = (taakStatus, status) => !status || F.statusTaak(status) === (taakStatus || 'todo');
  // Past een taak bij de gekozen persoon? slug '' = iedereen; mensen = de toegewezenen van de taak; zelfde = vergelijkfunctie (MTPlanning.zelfdePersoon)
  F.persoonPast = (mensen, slug, zelfde) => !slug || (Array.isArray(mensen) && mensen.some(m => zelfde ? zelfde(m, slug) : String(m).toLowerCase() === String(slug).toLowerCase()));

  // ── stand ──
  const sleutelLS = () => { const ik = D && D.ik ? String(D.ik() || '').trim().toLowerCase() : ''; return ik ? LS + ':' + ik : ''; };
  function ensure() {   // de onthouden stand van deze gebruiker, eenmalig (zodra bekend wie er is); een link die al gelezen is wint
    if (geladen || !D) return;
    const sl = sleutelLS(); if (!sl) return;
    geladen = true;
    try {
      const o = JSON.parse(D.storage.getItem(sl) || 'null');
      if (o && typeof o === 'object') ['project', 'persoon', 'status', 'bord'].forEach(k => { const w = GELDIG[k](o[k]); if (w) S[k] = w; });
    } catch (e) {}
  }
  function bewaar() {
    const sl = sleutelLS(); if (!sl || !D || !D.storage) return;
    try { D.storage.setItem(sl, JSON.stringify({ project: S.project, persoon: S.persoon, status: S.status, bord: S.bord })); } catch (e) {}
  }
  function meld(wat) { luisteraars.slice().forEach(fn => { try { fn(wat); } catch (e) {} }); }
  F.aanWijziging = fn => { luisteraars.push(fn); return () => { const i = luisteraars.indexOf(fn); if (i >= 0) luisteraars.splice(i, 1); }; };
  F.get = function () { ensure(); return S; };
  F.rev = () => S.rev;
  // Stand wijzigen (uit de balk of een weergave). patch = { project, persoon, status, van, zoom }; o.stil: de link niet bijwerken
  F.zet = function (patch, o) {
    ensure(); o = o || {};
    let veranderd = false;
    SLEUTELS.forEach(k => { if (patch && Object.prototype.hasOwnProperty.call(patch, k)) { const w = patch[k] === '' ? '' : GELDIG[k](patch[k]); if (S[k] !== w) { S[k] = w; veranderd = true; } } });
    if (!veranderd) return false;
    S.rev++; bewaar();
    if (!o.stil) F.routeZet();
    meld('stand');
    return true;
  };
  // Stand uit een link (r.planfilter): de link is de hele stand, wat er niet in staat valt terug op de standaard. o.alleen: alleen deze sleutels (een project-link kent geen project of periode)
  F.zetUitLink = function (filter, o) {
    o = o || {}; geladen = true;
    if (S.hashAchter && !o.alleen) { S.hashAchter = false; F.routeZet(); return false; }   // de stand veranderde terwijl het paneel open stond: de link in de geschiedenis is verouderd, de stand wint
    const sleutels = o.alleen || SLEUTELS, f = filter || {}; let veranderd = false;
    sleutels.forEach(k => { const w = GELDIG[k](f[k] !== undefined ? f[k] : (f[LINK[k]] !== undefined ? f[LINK[k]] : '')); if (S[k] !== w) { S[k] = w; veranderd = true; } });
    if (veranderd) { S.rev++; bewaar(); meld('link'); }
    return veranderd;
  };
  // De link bijwerken, behalve zolang er een objectpaneel open staat: dat heeft de adresbalk (#taak/…); de stand wordt dan bij de eerstvolgende gelegenheid na sluiten rechtgezet
  F.routeZet = function () {
    if (!D || !D.route) return;
    if (D.paneelOpen && D.paneelOpen()) { S.hashAchter = true; return; }
    S.hashAchter = false;
    try { D.route(); } catch (e) {}
  };
  F.wis = function () { return F.zet({ project: '', persoon: '', status: '' }); };
  // Is er iets gefilterd (anders dan de standaard van deze weergave)?
  F.actief = function (std) { ensure(); return !!(S.project || S.status || (S.persoon && S.persoon !== (std || 'iedereen'))); };
  // De gekozen persoon voor een weergave: '' = de standaard van die weergave (Mijn werk: ik, de rest: iedereen)
  F.persoonWaarde = std => { ensure(); return S.persoon || std || 'iedereen'; };
  F.mijnSlug = () => (D && D.mijnSlug ? String(D.mijnSlug() || '') : '');
  // Voor weergaven die een slug nodig hebben: '' = iedereen, 'ik' = mijn eigen slug
  F.persoonSlug = function (std) {
    const w = F.persoonWaarde(std);
    if (w === 'iedereen') return '';
    if (w === 'ik') return F.mijnSlug();
    return w;
  };

  // ── selectie (de taak die je het laatst opende; blijft gemarkeerd bij het wisselen van weergave) ──
  F.kies = function (c, id) {
    if (c == null || id == null || id === '') return;
    const nu = { code: String(c), id: String(id) };
    if (S.selectie && S.selectie.code === nu.code && S.selectie.id === nu.id) return;
    S.selectie = nu; meld('selectie'); F.markeerAlles();
  };
  F.selectieWis = function () { if (!S.selectie) return; S.selectie = null; meld('selectie'); F.markeerAlles(); };
  F.isGekozen = (c, id) => !!S.selectie && String(c).toLowerCase() === S.selectie.code.toLowerCase() && String(id) === S.selectie.id;
  F.markeer = function (wortel) {   // zet de markering op de elementen met data-pf-code en data-pf-taak die bij de selectie horen
    if (!wortel || !wortel.querySelectorAll) return;
    wortel.querySelectorAll('[data-pf-code][data-pf-taak]').forEach(e => { e.classList.toggle('pf-gekozen', F.isGekozen(e.getAttribute('data-pf-code'), e.getAttribute('data-pf-taak'))); });
  };
  F.markeerAlles = function () { if (D && D.doc) F.markeer(D.doc.body); };
  F.taakNaam = () => { const s = S.selectie; if (!s || !D || !D.taakNaam) return ''; try { return String(D.taakNaam(s.code, s.id) || ''); } catch (e) { return ''; } };

  // ── de balk ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v);
      else if (k === 'wijzig') e.addEventListener('change', v); else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const STIJL = '.pf-balk{display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
    + '.pf-sel{height:34px;min-width:0;max-width:220px;padding:0 28px 0 12px;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1f2a24);font:500 13px/18px var(--sans,inherit);cursor:pointer;width:auto}'
    + '.pf-sel.aan{border-color:var(--primary,#2A4A38);font-weight:600}'
    + '.pf-knop{height:34px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:var(--ink-2,#555);font:500 13px/18px var(--sans,inherit);cursor:pointer;text-decoration:underline}'
    + '.pf-chip{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 4px 0 10px;border:1px solid var(--primary,#2A4A38);border-radius:17px;font:500 12px/16px var(--sans,inherit);color:var(--ink,#1f2a24);background:var(--surface,#fff);max-width:260px}'
    + '.pf-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pf-chip button{width:28px;height:28px;border:0;border-radius:14px;background:transparent;cursor:pointer;color:inherit;font:inherit}'
    + '.pf-teller{font:500 12px/16px var(--sans,inherit);color:var(--ink-2,#666)}'
    + '.pf-sel:focus-visible,.pf-knop:focus-visible,.pf-chip button:focus-visible{outline:2px solid var(--focus,var(--primary,#2A4A38));outline-offset:2px}'
    + '.pf-gekozen{outline:2px solid var(--primary,#2A4A38);outline-offset:-2px}'
    + '@media (max-width:640px){.pf-sel,.pf-knop,.pf-chip{height:44px}.pf-sel{max-width:100%;flex:1 1 140px}.pf-chip button{width:36px;height:36px}}';
  function stijl() { if (D.doc.getElementById('pf-stijl') || !D.doc.head) return; const s = el('style', { id: 'pf-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
  const projLijst = () => (D.projecten ? D.projecten() : []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));

  // o = { std: 'ik'|'iedereen' (standaardpersoon van de weergave), project: false = het project staat vast (project-Planning), status: true/false, statussen: [linkwaarden die hier bestaan], klaar: fn }
  // klaar() wordt aangeroepen nadat de stand veranderd is: de weergave tekent zichzelf opnieuw. Geeft het element terug (steeds opnieuw te bouwen bij een hertekening).
  F.balk = function (o) {
    o = o || {}; ensure(); stijl();
    const pre = 'pf-' + (o.pre || 'x') + '-', std = o.std || 'iedereen', klaar = () => { if (o.klaar) o.klaar(); };
    const kind = [];
    const keuze = (id, label, opties, waarde, bijWijzig) => {
      const s = el('select', { id, 'aria-label': label, klass: 'pf-sel' + (waarde !== opties[0][0] && waarde !== '' ? ' aan' : ''), wijzig: ev => bijWijzig(ev.target.value) },
        opties.map(([v, t]) => el('option', { value: v, tekst: t })));
      s.value = waarde; if (s.value !== waarde) s.value = opties[0][0];
      return s;
    };
    const team = (D.team ? D.team() : []) || [];
    const persoonOpties = [['ik', 'Wie: ik'], ['iedereen', 'Wie: iedereen']].concat(team.filter(t => t && t.slug).map(t => ['' + t.slug, t.naam || t.slug]));
    let pw = F.persoonWaarde(std);
    if (!persoonOpties.some(x => x[0] === pw)) persoonOpties.push([pw, pw]);   // een persoon uit een link die niet (meer) in het team staat
    const wieOpties = persoonOpties.slice(); const std0 = wieOpties.findIndex(x => x[0] === std); if (std0 > 0) wieOpties.unshift(wieOpties.splice(std0, 1)[0]);
    if (o.persoon !== false) kind.push(keuze(pre + 'wie', 'Wie', wieOpties, pw, w => { F.zet({ persoon: w === std ? '' : w }); klaar(); }));
    if (o.project !== false) {
      const pr = projLijst(), opties = [['', 'Project: alle']].concat(pr.map(p => [p.code, p.label || p.code]));
      if (S.project && !opties.some(x => x[0] === S.project)) opties.push([S.project, S.project]);
      kind.push(keuze(pre + 'project', 'Project', opties, S.project, w => { F.zet({ project: w }); klaar(); }));
    }
    if (o.status !== false) {
      const toegestaan = o.statussen || STATUSSEN.map(x => x[0]);
      const opties = [['', 'Status: alle']].concat(STATUSSEN.filter(x => toegestaan.includes(x[0])).map(x => [x[0], x[1]]));
      kind.push(keuze(pre + 'status', 'Status', opties, toegestaan.includes(S.status) ? S.status : '', w => { F.zet({ status: w }); klaar(); }));
    }
    if (F.actief(std)) kind.push(el('button', { type: 'button', klass: 'pf-knop', id: pre + 'wis', title: 'Zet de filters terug op de standaard', tekst: 'Wis filters', klik: () => { F.wis(); klaar(); } }));
    const naam = F.taakNaam();
    if (S.selectie) kind.push(el('span', { klass: 'pf-chip', id: pre + 'selectie', title: 'De taak die je het laatst opende blijft gemarkeerd bij het wisselen van weergave' },
      el('span', { tekst: 'Gekozen: ' + (naam || 'taak') }), el('button', { type: 'button', 'aria-label': 'Selectie wissen', title: 'Selectie wissen', tekst: '✕', klik: () => { F.selectieWis(); klaar(); } })));
    return el('div', { klass: 'pf-balk', role: 'group', 'aria-label': 'Filters voor de planning' }, kind);
  };

  // Planning van één project: de taakrijen (tr met data-taak, data-st = taakstatus, data-wie = toegewezenen) tonen of verbergen. Een verborgen rij wordt nooit mee-aangevinkt voor verwijderen.
  F.pasRijenToe = function (tabel) {
    if (!tabel || !tabel.querySelectorAll) return { totaal: 0, zichtbaar: 0 };
    const zelfde = D && D.zelfdePersoon ? D.zelfdePersoon : null, slug = F.persoonSlug('iedereen');
    let totaal = 0, zichtbaar = 0;
    tabel.querySelectorAll('tr[data-pf-taak]').forEach(tr => {
      totaal++;
      const mensen = String(tr.getAttribute('data-pf-wie') || '').split(' ').filter(Boolean);
      const toon = F.statusPast(tr.getAttribute('data-pf-st'), S.status) && F.persoonPast(mensen, slug, zelfde);
      tr.hidden = !toon;
      if (toon) zichtbaar++; else { const c = tr.querySelector('input.pt-check'); if (c) c.checked = false; }
    });
    return { totaal, zichtbaar };
  };
  // De balk en de filtering van de Planning-sectie van één project (host = een leeg element in de sectie, tabel = de takentabel)
  F.monteerProject = function (host, tabelId) {
    if (!D || !host) return;
    const teken = () => {
      host.textContent = '';
      const tabel = D.doc.getElementById(tabelId), t = F.pasRijenToe(tabel);
      host.appendChild(F.balk({ pre: 'pj', std: 'iedereen', project: false, klaar: teken }));
      const filtert = !!(S.status || F.persoonSlug('iedereen'));
      if (filtert && t.totaal) host.firstChild.appendChild(el('span', { klass: 'pf-teller', role: 'status', tekst: t.zichtbaar + ' van ' + t.totaal + ' taken' + (t.zichtbaar ? '' : ' · geen taak bij dit filter') }));
      F.markeer(tabel);
    };
    teken();
  };

  F.init = function (deps) {
    D = deps; geladen = false;
    // Een taak openen (in welk scherm dan ook) maakt hem de geselecteerde taak
    try {
      if (D.doc && !F._luistert) { F._luistert = true; D.doc.addEventListener('mt-paneel-open', ev => { const d = ev && ev.detail; if (d && d.soort === 'taak' && d.sleutel) F.kies(d.sleutel.code, d.sleutel.id); }); }
    } catch (e) {}
    return F;
  };
  F._reset = function () { Object.assign(S, { project: '', persoon: '', status: '', van: '', zoom: '', bord: '', selectie: null, rev: 0, hashAchter: false }); geladen = false; luisteraars.length = 0; };
  F.S = S;
  root.MTPlanFilter = F;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof window !== 'undefined' ? window : globalThis);
