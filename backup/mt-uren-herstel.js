/* ============================================================================
 * mt-uren-herstel.js: "Uren zonder project" in de Uren-tab (herstelbak + datakwaliteitsmeter, ALLEEN LEZEN)
 * ----------------------------------------------------------------------------
 * Brok 1 van T2. Beleid (Bart, 5-11): project nu verplicht, taak later. Deze module verandert daar niets aan; ze maakt het probleem zichtbaar:
 *   1. Datakwaliteitsmeter: per maand (laatste 6) en per persoon het % uren met project, het % uren met taak en de uren zonder project, met een trend.
 *   2. Herstelbak: per maand de entries zonder project (datum, persoon, omschrijving, duur). Entries met project maar zonder taak staan hier niet, ze tellen alleen in de meter.
 * Er is geen enkele schrijfactie: geen koppelen, geen POST/PATCH/DELETE, geen opslag. Koppelen komt in een latere brok.
 * Rechten: wie teamgegevens mag zien (D.teamdata(): eigenaar/beheerder) ziet alle personen; een ander ziet alleen de eigen uren (uit de eigen Toggl-entries).
 * Maanden zijn kalendermaanden in Amsterdam (zomer/wintertijd zit in de module, geen afhankelijkheid van de tijdzone van de browser).
 * Het rekenwerk is los te testen zonder DOM; tekent met DOM-calls (textContent), nooit met opgebouwde HTML. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const H = {};
  let D = null;
  const AANTAL_MAANDEN = 6, MAX_WACHT_MS = 30000, UUR = 3600000;
  const S = { status: 'nieuw', fout: '', modus: 'eigen', maanden: [], meldingen: [], open: {}, bak: {}, entriesEigen: null, gebruikers: [] };
  H.S = S;

  // ── tijd in Amsterdam: zomertijd van de laatste zondag van maart 01:00 UTC tot de laatste zondag van oktober 01:00 UTC ──
  const p2 = n => String(n).padStart(2, '0');
  const laatsteZondag = (jaar, maand0) => { const d = Date.UTC(jaar, maand0 + 1, 0); return d - new Date(d).getUTCDay() * 86400000 + UUR; };
  const offsetMs = utc => { const j = new Date(utc).getUTCFullYear(); return (utc >= laatsteZondag(j, 2) && utc < laatsteZondag(j, 9) ? 2 : 1) * UUR; };
  H.amsterdamYmd = isoOfMs => { const ms = typeof isoOfMs === 'number' ? isoOfMs : Date.parse(isoOfMs); return isNaN(ms) ? '' : new Date(ms + offsetMs(ms)).toISOString().slice(0, 10); };
  H.amsterdamMaand = isoOfMs => H.amsterdamYmd(isoOfMs).slice(0, 7);
  // Het instant waarop de maand 'JJJJ-MM' in Amsterdam begint (middernacht lokale tijd).
  const maandStartMs = ym => { const [j, m] = ym.split('-').map(Number), g = Date.UTC(j, m - 1, 1); return g - offsetMs(g - offsetMs(g)); };
  const volgendeMaand = ym => { const [j, m] = ym.split('-').map(Number); return m === 12 ? (j + 1) + '-01' : j + '-' + p2(m + 1); };
  H.maandGrenzen = ym => ({ van: new Date(maandStartMs(ym)).toISOString(), tot: new Date(maandStartMs(volgendeMaand(ym)) - 1).toISOString() });
  // De laatste n maanden t/m de maand van vandaag (oud → nieuw); vandaag = 'JJJJ-MM-DD'.
  H.laatsteMaanden = (vandaag, n) => { let [j, m] = String(vandaag).slice(0, 7).split('-').map(Number); const uit = []; for (let i = 0; i < (n || AANTAL_MAANDEN); i++) { uit.unshift(j + '-' + p2(m)); m--; if (m === 0) { m = 12; j--; } } return uit; };
  const plusDag = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // Hele dagen waarbinnen alle entries van de maand vallen (een dag ruim aan beide kanten; de maandindeling zelf gebeurt per entry in Amsterdam).
  H.maandDagen = ym => ({ van: plusDag(ym + '-01', -1), tot: plusDag(volgendeMaand(ym) + '-01', 1) });

  // ── getallen ──
  const pct = (deel, geheel) => geheel > 0 ? Math.round(deel / geheel * 1000) / 10 : null;   // één decimaal; null = geen uren (nooit een verzonnen percentage)
  const pctTekst = p => p === null ? 'n.v.t.' : String(p).replace('.', ',') + '%';
  const uurTekst = sec => (Math.round(sec / 360) / 10).toString().replace('.', ',') + ' u';
  const duurTekst = sec => { const m = Math.round(sec / 60); return Math.floor(m / 60) + ':' + p2(m % 60) + ' u'; };
  H.pctTekst = pctTekst; H.uurTekst = uurTekst; H.duurTekst = duurTekst;

  // ── de meter ──
  // rijenPerMaand = { 'JJJJ-MM': [{user, project, taak, sec}] | null (null = niet te laden) }; fouten = { ym: tekst }; users = [{id,naam}]
  // → [{ ym, lopend, status:'ok'|'leeg'|'fout', fout, totaalSec, metProjectSec, metTaakSec, zonderProjectSec, pctProject, pctTaak, personen:[{id,naam,...}] }]
  H.meter = function (o) {
    const users = o.users || [], fouten = o.fouten || {}, vandaagYm = String(o.vandaag || '').slice(0, 7);
    return (o.maanden || []).map(ym => {
      const m = { ym, lopend: ym === vandaagYm, status: 'ok', fout: '', totaalSec: 0, metProjectSec: 0, metTaakSec: 0, zonderProjectSec: 0, pctProject: null, pctTaak: null, personen: [] };
      if (fouten[ym] || !Array.isArray((o.rijenPerMaand || {})[ym])) { m.status = 'fout'; m.fout = fouten[ym] || 'niet geladen'; return m; }
      const per = new Map();
      o.rijenPerMaand[ym].forEach(r => {
        const sec = Number(r.sec); if (!(sec > 0)) return;
        const k = String(r.user), x = per.get(k) || { totaalSec: 0, metProjectSec: 0, metTaakSec: 0 };
        x.totaalSec += sec; if (r.project != null) x.metProjectSec += sec; if (r.taak != null) x.metTaakSec += sec; per.set(k, x);
      });
      per.forEach((x, k) => {
        const u = users.find(y => String(y.id) === k);
        m.personen.push({ id: k, naam: (u && u.naam) || (k === 'eigen' ? 'Jij' : 'Onbekende gebruiker'), totaalSec: x.totaalSec, metProjectSec: x.metProjectSec, metTaakSec: x.metTaakSec, zonderProjectSec: x.totaalSec - x.metProjectSec, pctProject: pct(x.metProjectSec, x.totaalSec), pctTaak: pct(x.metTaakSec, x.totaalSec) });
        m.totaalSec += x.totaalSec; m.metProjectSec += x.metProjectSec; m.metTaakSec += x.metTaakSec;
      });
      m.zonderProjectSec = m.totaalSec - m.metProjectSec;
      m.pctProject = pct(m.metProjectSec, m.totaalSec); m.pctTaak = pct(m.metTaakSec, m.totaalSec);
      if (m.totaalSec <= 0) m.status = 'leeg';
      m.personen.sort((a, b) => (a.pctProject === null) - (b.pctProject === null) || a.pctProject - b.pctProject || String(a.naam).localeCompare(String(b.naam), 'nl'));
      return m;
    });
  };
  // Entries (eigen uren) → rijen per maand in Amsterdam, zodat de meter voor team en eigen hetzelfde rekent.
  H.entriesNaarRijen = function (entries, maanden) {
    const uit = {}; (maanden || []).forEach(ym => { uit[ym] = []; });
    (entries || []).forEach(e => { const ym = H.amsterdamMaand(e.start); if (uit[ym] && e.sec > 0) uit[ym].push({ user: 'eigen', project: e.project || null, taak: e.taak || null, sec: e.sec }); });
    return uit;
  };
  // De trend: laatste twee maanden die af zijn (niet lopend, met uren) naast elkaar. Punten = procentpunten verschil.
  H.trend = function (meter) {
    const af = (meter || []).filter(m => !m.lopend && m.status === 'ok' && m.pctProject !== null);
    if (af.length < 2) return { genoeg: false, tekst: 'Te weinig afgesloten maanden met uren voor een trend.' };
    const a = af[af.length - 2], b = af[af.length - 1];
    const dp = Math.round((b.pctProject - a.pctProject) * 10) / 10, dt = (a.pctTaak !== null && b.pctTaak !== null) ? Math.round((b.pctTaak - a.pctTaak) * 10) / 10 : null;
    const wijs = d => d === null ? 'onbekend' : d > 0 ? '+' + String(d).replace('.', ',') + ' punt' : d < 0 ? String(d).replace('.', ',').replace('-', '−') + ' punt' : 'gelijk';
    return { genoeg: true, van: a.ym, naar: b.ym, project: dp, taak: dt, richting: dp > 0 ? 'beter' : dp < 0 ? 'slechter' : 'gelijk',
      tekst: 'Project: ' + pctTekst(a.pctProject) + ' → ' + pctTekst(b.pctProject) + ' (' + wijs(dp) + ') van ' + a.ym + ' naar ' + b.ym + '. Taak: ' + pctTekst(a.pctTaak) + ' → ' + pctTekst(b.pctTaak) + ' (' + wijs(dt) + ').' };
  };

  // ── de bak ──
  // entries = [{id,persoon,start,sec,project,taak,omschrijving}]  → entries zonder project in de maand (Amsterdam), oud → nieuw
  H.bak = function (entries, ym, o) {
    const nu = (o && o.nu) || 0, lockDagen = o && o.lockDagen;
    const lijst = (entries || []).filter(e => e && e.sec > 0 && e.project == null && H.amsterdamMaand(e.start) === ym)
      .map(e => ({ id: e.id, persoon: e.persoon || 'Onbekende gebruiker', datum: H.amsterdamYmd(e.start), start: e.start, sec: e.sec, omschrijving: e.omschrijving || '', metTaak: e.taak != null,
        vergrendeld: !!(nu && lockDagen != null && (nu - Date.parse(e.start)) / 86400000 > lockDagen) }));
    lijst.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || String(a.persoon).localeCompare(String(b.persoon), 'nl'));
    return { ym, aantal: lijst.length, sec: lijst.reduce((n, e) => n + e.sec, 0), entries: lijst };
  };

  // ── laden (Toggl, alleen lezen) ──
  const metTijdslimiet = (belofte, ms) => new Promise((ok, fout) => {
    const t = setTimeout(() => fout(new Error('Toggl antwoordde niet binnen ' + Math.round(ms / 1000) + ' seconden')), ms);
    Promise.resolve(belofte).then(x => { clearTimeout(t); ok(x); }, e => { clearTimeout(t); fout(e); });
  });
  const foutTekst = e => (D.foutTekst ? D.foutTekst(e) : (e && e.message) || 'onbekende fout');
  H.maanden = () => H.laatsteMaanden(D.vandaag(), AANTAL_MAANDEN);
  H.laad = async function (ververs) {
    if (S.status === 'laden') return;
    S.status = 'laden'; S.fout = ''; S.meldingen = []; S.bak = {}; H.teken();
    const team = !!(D.teamdata && D.teamdata()); S.modus = team ? 'team' : 'eigen';
    const maanden = H.maanden(), vandaag = D.vandaag(); S.maanden = maanden;
    try {
      let rijenPerMaand = {}; const fouten = {}; let users = [];
      if (team) {
        users = await metTijdslimiet(D.gebruikers(), MAX_WACHT_MS);
        // de maanden na elkaar: de wachtrij in mt-toggl.js houdt de snelheid in de hand en wacht zelf bij een 429
        for (const ym of maanden) {
          const g = H.maandGrenzen(ym);
          try { rijenPerMaand[ym] = await metTijdslimiet(D.rijenMaand(g.van, g.tot, !!ververs), MAX_WACHT_MS); } catch (e) { fouten[ym] = foutTekst(e); }
        }
      } else {
        const dagen = { van: H.maandDagen(maanden[0]).van, tot: H.maandDagen(maanden[maanden.length - 1]).tot };
        const r = await metTijdslimiet(D.eigenEntries(dagen.van, dagen.tot), MAX_WACHT_MS);
        S.entriesEigen = r.entries || [];
        if (r.onvolledig) S.meldingen.push('Toggl gaf het maximale aantal entries terug: de oudste maanden kunnen onvolledig zijn.');
        rijenPerMaand = H.entriesNaarRijen(S.entriesEigen, maanden);
      }
      S.gebruikers = users;
      S.meter = H.meter({ maanden, rijenPerMaand, fouten, users, vandaag });
      const gelukt = S.meter.filter(m => m.status !== 'fout');
      if (!gelukt.length) { S.status = 'fout'; S.fout = 'Toggl kon voor geen enkele maand uren leveren: ' + (Object.values(fouten)[0] || 'onbekende fout'); }
      else {
        S.status = 'ok';
        if (gelukt.every(m => m.status === 'leeg')) S.meldingen.push('Toggl gaf voor alle maanden nul uren terug. Dat is ongebruikelijk: controleer in Toggl of dit klopt voordat je deze cijfers vertrouwt.');
        if (S.meter.some(m => m.status === 'fout')) S.meldingen.push('Niet alle maanden konden worden geladen; die staan hieronder als fout aangegeven en tellen niet mee in de trend.');
      }
    } catch (e) { S.status = 'fout'; S.fout = foutTekst(e); }
    H.teken();
  };
  // De bak van een maand. Team: de entries van die maand eerst uit Toggl halen (op verzoek); eigen: al geladen.
  H.laadBak = async function (ym, ververs) {
    const b = S.bak[ym]; if (b && b.status === 'laden') return;
    if (S.modus !== 'team') { S.bak[ym] = Object.assign({ status: 'ok', onvolledig: false }, H.bak(S.entriesEigen, ym, bakOpties())); H.teken(); return; }
    if (b && b.status === 'ok' && !ververs) return;
    S.bak[ym] = { status: 'laden' }; H.teken();
    try {
      const d = H.maandDagen(ym), r = await metTijdslimiet(D.entriesTeam(d.van, d.tot), MAX_WACHT_MS);
      S.bak[ym] = Object.assign({ status: 'ok', onvolledig: !!r.onvolledig }, H.bak(r.entries || [], ym, bakOpties()));
    } catch (e) { S.bak[ym] = { status: 'fout', fout: foutTekst(e) }; }
    H.teken();
  };
  const bakOpties = () => ({ nu: D.nu ? D.nu() : 0, lockDagen: D.lockDagen ? D.lockDagen() : null });
  // Bij het openen van het tabblad: één keer laden (daarna met de knop).
  H.open = function () { if (S.status === 'nieuw') H.laad(false); else H.teken(); };

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
  const STIJL = '#uren-herstel{padding:4px 2px}'
    + '#uren-herstel .uh-kop{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px}#uren-herstel .uh-kop h3{margin:0;font-size:16px}'
    + '#uren-herstel .uh-sub{font-size:12.5px;color:var(--text-dim,#666)}#uren-herstel .uh-meta{color:var(--text-dim,#666);font-size:12px}'
    + '#uren-herstel .uh-trend{border:1px solid var(--border,#ddd);border-radius:10px;padding:10px 14px;background:var(--bg-card,#fff);margin:8px 0;font-size:13.5px}'
    + '#uren-herstel .uh-trend.beter{border-left:4px solid #1f6b3a}#uren-herstel .uh-trend.slechter{border-left:4px solid #8a5a00}'
    + '#uren-herstel .uh-tabel{width:100%;border-collapse:collapse;font-size:13px;background:var(--bg-card,#fff);border:1px solid var(--border,#ddd);border-radius:10px}'
    + '#uren-herstel .uh-tabel th{text-align:left;font-weight:600;font-size:12px;color:var(--text-dim,#666);padding:6px 10px;border-bottom:1px solid var(--border,#ddd)}'
    + '#uren-herstel .uh-tabel td{padding:6px 10px;border-top:1px solid var(--border,#eee);vertical-align:middle;font-variant-numeric:tabular-nums}'
    + '#uren-herstel .uh-tabel tr.uh-pers td{background:rgba(0,0,0,.02);font-size:12.5px}#uren-herstel .uh-tabel .num{text-align:right;white-space:nowrap}'
    + '#uren-herstel .uh-bal{display:inline-block;vertical-align:middle;height:6px;width:70px;background:#e8e8e8;border-radius:3px;overflow:hidden;margin-right:6px}#uren-herstel .uh-bal i{display:block;height:100%;background:#1f6b3a}'
    + '#uren-herstel .uh-bal.taak i{background:#b3762a}'
    + '#uren-herstel .uh-knop{font:inherit;font-size:12.5px;min-height:32px;padding:0 10px;border:1px solid var(--border,#ccc);border-radius:7px;background:transparent;cursor:pointer;color:inherit}'
    + '#uren-herstel .uh-knop:hover{background:rgba(0,0,0,.05)}'
    + '#uren-herstel .uh-lijst{margin:6px 0 10px;padding:0;list-style:none;font-size:13px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--bg-card,#fff)}'
    + '#uren-herstel .uh-lijst li{padding:6px 10px;border-top:1px solid var(--border,#eee);display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}#uren-herstel .uh-lijst li:first-child{border-top:0}'
    + '#uren-herstel .uh-lijst .uh-oms{flex:1;min-width:140px;overflow-wrap:anywhere}#uren-herstel .uh-lijst .uh-dur{font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '#uren-herstel .uh-fout{background:#FBEAEA;border:1px solid #E5B5B5;color:#8a1c1c;border-radius:8px;padding:8px 10px;font-size:13px;margin:6px 0}'
    + '#uren-herstel .uh-let{background:#FBF0E0;border:1px solid #E8D48A;color:#7A6010;border-radius:8px;padding:6px 10px;font-size:12.5px;margin:6px 0}'
    + '@media (max-width:640px){#uren-herstel .uh-bal{width:40px}#uren-herstel .uh-tabel th,#uren-herstel .uh-tabel td{padding:6px 6px}}';
  const knop = (tekst, klik, extra) => el('button', Object.assign({ type: 'button', klass: 'uh-knop', tekst, klik }, extra || {}));
  const maandNaam = ym => { const [j, m] = ym.split('-').map(Number); return ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][m - 1] + ' ' + j; };
  const datumTekst = ymd => ymd.slice(8, 10) + '-' + ymd.slice(5, 7);
  const bal = (p, klasse) => el('span', { klass: 'uh-bal ' + (klasse || ''), 'aria-hidden': 'true' }, el('i', { stijl: 'width:' + (p === null ? 0 : Math.min(100, p)) + '%' }));

  function bakBlok(m) {
    const b = S.bak[m.ym];
    if (!b) return null;
    if (b.status === 'laden') return el('div', { klass: 'uh-meta', role: 'status', tekst: 'Bezig met laden uit Toggl…' });
    if (b.status === 'fout') return el('div', { klass: 'uh-fout', role: 'alert' }, 'Toggl kon de lijst niet leveren: ' + b.fout + '. ', knop('Opnieuw proberen', () => H.laadBak(m.ym, true)));
    const uit = [];
    if (b.onvolledig) uit.push(el('div', { klass: 'uh-let', role: 'status', tekst: 'Onvolledig: Toggl gaf zoveel regels dat niet alles is opgehaald. De lijst hieronder is niet de hele maand.' }));
    if (!b.aantal) uit.push(el('div', { klass: 'uh-meta', tekst: 'Geen entries zonder project in ' + maandNaam(m.ym) + (b.onvolledig ? ' (in het opgehaalde deel).' : '.') }));
    else {
      uit.push(el('div', { klass: 'uh-meta', tekst: b.aantal + (b.aantal === 1 ? ' entry' : ' entries') + ' zonder project · ' + uurTekst(b.sec) + (m.lopend ? ' · de maand loopt nog' : '') }));
      uit.push(el('ul', { klass: 'uh-lijst' }, b.entries.map(e => el('li', null,
        el('span', { klass: 'uh-meta', tekst: datumTekst(e.datum) }),
        el('span', { tekst: e.persoon }),
        el('span', { klass: 'uh-oms', tekst: e.omschrijving || '(geen omschrijving)' }),
        e.vergrendeld ? el('span', { klass: 'uh-meta', title: 'Ouder dan de leeftijdsgrens voor bewerken in de Uren-tab', tekst: 'vergrendeld' }) : null,
        el('span', { klass: 'uh-dur', tekst: duurTekst(e.sec) })))));
    }
    return el('div', null, uit);
  }
  H.teken = function () {
    const w = D && D.doc.getElementById('uren-herstel'); if (!w) return;
    w.textContent = '';
    if (!D.doc.getElementById('uh-stijl')) { const s = el('style', { id: 'uh-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    const team = S.modus === 'team';
    w.appendChild(el('div', { klass: 'uh-kop' }, el('h3', { tekst: 'Uren zonder project' }),
      el('span', { klass: 'uh-sub', tekst: 'Alleen lezen. Dit overzicht toont alleen: er wordt niets gekoppeld of gewijzigd in Toggl. Project is verplicht, taak volgt later.' }),
      S.status === 'laden' ? null : knop('Opnieuw laden', () => H.laad(true))));
    w.appendChild(el('div', { klass: 'uh-meta', tekst: team ? 'Alle personen (alleen voor eigenaar en beheer). Maanden in Amsterdamse tijd.' : 'Je ziet alleen je eigen uren. Maanden in Amsterdamse tijd.' }));
    if (S.status === 'laden') { w.appendChild(el('div', { klass: 'uh-meta', role: 'status', tekst: 'Bezig met laden uit Toggl…' })); return; }
    if (S.status === 'fout') { w.appendChild(el('div', { klass: 'uh-fout', role: 'alert' }, 'Toggl kon dit niet leveren: ' + S.fout + '. ', knop('Opnieuw proberen', () => H.laad(true)))); return; }
    if (S.status !== 'ok') return;
    S.meldingen.forEach(t => w.appendChild(el('div', { klass: 'uh-let', role: 'status', tekst: t })));
    const tr = H.trend(S.meter);
    w.appendChild(el('div', { klass: 'uh-trend ' + (tr.genoeg ? tr.richting : ''), tekst: tr.tekst }));
    const rijen = [];
    S.meter.slice().reverse().forEach(m => {
      const naam = maandNaam(m.ym) + (m.lopend ? ' (loopt nog, onvolledig)' : '');
      if (m.status === 'fout') { rijen.push(el('tr', null, el('td', { tekst: naam }), el('td', { colspan: '5' }, el('span', { klass: 'uh-fout', tekst: 'Kon niet laden: ' + m.fout })))); return; }
      if (m.status === 'leeg') { rijen.push(el('tr', null, el('td', { tekst: naam }), el('td', { colspan: '5', klass: 'uh-meta', tekst: 'Geen uren geregistreerd (volgens Toggl).' }))); return; }
      const open = !!S.open[m.ym];
      rijen.push(el('tr', null, el('td', { tekst: naam }), el('td', { klass: 'num', tekst: uurTekst(m.totaalSec) }),
        el('td', { klass: 'num' }, bal(m.pctProject), pctTekst(m.pctProject)), el('td', { klass: 'num' }, bal(m.pctTaak, 'taak'), pctTekst(m.pctTaak)),
        el('td', { klass: 'num', tekst: uurTekst(m.zonderProjectSec) }),
        el('td', null, knop(open ? 'Verberg' : 'Toon details', () => { S.open[m.ym] = !S.open[m.ym]; if (S.open[m.ym] && m.zonderProjectSec > 0) H.laadBak(m.ym); else H.teken(); }, { 'aria-expanded': open ? 'true' : 'false' }))));
      if (open) {
        if (team) m.personen.forEach(p => rijen.push(el('tr', { klass: 'uh-pers' }, el('td', { tekst: ' ' + p.naam }), el('td', { klass: 'num', tekst: uurTekst(p.totaalSec) }),
          el('td', { klass: 'num', tekst: pctTekst(p.pctProject) }), el('td', { klass: 'num', tekst: pctTekst(p.pctTaak) }), el('td', { klass: 'num', tekst: uurTekst(p.zonderProjectSec) }), el('td'))));
        const bb = m.zonderProjectSec > 0 ? bakBlok(m) : el('div', { klass: 'uh-meta', tekst: 'Alle uren in ' + maandNaam(m.ym) + ' hebben een project.' });
        rijen.push(el('tr', { klass: 'uh-pers' }, el('td', { colspan: '6' }, bb)));
      }
    });
    w.appendChild(el('div', { stijl: 'overflow-x:auto' }, el('table', { klass: 'uh-tabel' },
      el('thead', null, el('tr', null, ['Maand', 'Uren', 'Met project', 'Met taak', 'Zonder project', ''].map(t => el('th', { tekst: t })))),
      el('tbody', null, rijen))));
    w.appendChild(el('div', { klass: 'uh-meta', stijl: 'margin-top:8px', tekst: 'Een entry met project maar zonder taak hoort niet in de bak; die telt alleen mee in het percentage “Met taak”.' }));
  };
  H.init = function (deps) { D = deps; return H; };

  root.MTUrenHerstel = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof window !== 'undefined' ? window : globalThis);
