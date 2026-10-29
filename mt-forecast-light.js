// mt-forecast-light.js — tabblad Forecast (light): een schetsschema voor de facturatie (verzoek Mathijs en Bart, 29-10).
// Links de offertes uit Moneybird met hun totaalbedrag, kolommen = maanden, in elk vakje typ je vrij een bedrag. Onderaan staat per maand
// het totaal, rechts per offerte. Meer gebeurt er niet: de bedragen tellen NERGENS anders mee (niet in de prognose, niet in Financiën, niet
// in Moneybird). De uitgebreide Forecast (mt-forecast.js) staat sinds 29-10 bij Financiën.
// Opslag: /geld/schets (worker, Durable Object): per offerte { cellen: { 'JJJJ-MM': centen }, zeker }. Bij elk vakje gaat mee wat je zag
// (oud); heeft een collega het intussen gewijzigd, dan weigert de worker (409) en zie je zijn bedrag, zodat nooit iets ongezien overschreven
// wordt. Elke wijziging staat in de historie van de worker. Rekenregels (L.*) zijn zonder DOM te testen; de weergave bouwt met DOM-methoden.
(function (root) {
  'use strict';
  const L = root.MTForecastLight = root.MTForecastLight || {};
  const MND_K = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const AANTAL = 12;                                         // maanden in beeld (de tabel scrolt zijwaarts)
  const maandPlus = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; };
  const maandTekst = ym => MND_K[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  const duizend = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  L.maandPlus = maandPlus; L.maandTekst = maandTekst;
  L.maanden = (start, n) => Array.from({ length: n }, (_, i) => maandPlus(start, i));

  // 150000 → "1.500"; 150050 → "1.500,50"; negatief met een echt minteken.
  L.fmt = function (cc) {
    if (cc == null) return '';
    const a = Math.abs(cc), eur = Math.floor(a / 100), ct = a % 100;
    return (cc < 0 ? '\u2212' : '') + duizend(eur) + (ct ? ',' + String(ct).padStart(2, '0') : '');
  };
  // Invoer in een vakje → { c: centen | null (leeg) } of { fout }. Nederlandse notatie ("1.500,50", "1500,5", "1500.50", "€ 1.500"),
  // een minteken mag (creditnota), en "50%" is dat deel van het getoonde offertebedrag (basisC), afgerond op hele centen.
  L.leesInvoer = function (t, basisC) {
    let s = String(t == null ? '' : t).replace(/[€\s]/g, '').replace(/\u2212/g, '-');
    if (s === '') return { c: null };
    const pm = /^(-?)(\d+(?:[.,]\d+)?)%$/.exec(s);
    if (pm) {
      if (!(basisC > 0)) return { fout: 'Percentage kan hier niet: deze offerte heeft geen bedrag.' };
      const p = Number(pm[2].replace(',', '.')); if (!(p > 0) || p > 1000) return { fout: 'Percentage tussen 0 en 1000.' };
      return { c: (pm[1] ? -1 : 1) * Math.round(basisC * p / 100) };
    }
    const neg = s.startsWith('-'); if (neg) s = s.slice(1);
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { fout: 'Geen geldig bedrag. Typ bijvoorbeeld 5.000 of 2500,50 of 50%.' };
    const c = Math.round(Number(s) * 100);
    if (c > 1e11) return { fout: 'Bedrag te groot.' };
    return { c: neg ? -c : c };
  };

  // Rijen: elke offerte uit Moneybird (genormaliseerd met MTForecast.schatNorm), plus schets-records van offertes die niet (meer) in de
  // Moneybird-lijst staan (bv. intussen gefactureerd): die blijven zichtbaar zolang er bedragen in staan, zodat er nooit iets uit beeld verdwijnt.
  L.rijen = function (schatten, schets, uitbeeld) {
    const uit = [], gezien = new Set(); schets = schets || {}; uitbeeld = uitbeeld || {};
    for (const s of schatten || []) {
      if (!s || gezien.has(s.id)) continue; gezien.add(s.id);
      const rec = schets[s.id] || null;
      uit.push({ id: s.id, naam: [s.naam, s.ref].filter(Boolean).join(' \u2014 ') || s.nummer || s.id, nummer: s.nummer, datum: s.datum, status: s.status,
        inclC: s.totaalC, exclC: s.exclC, cellen: (rec && rec.cellen) || {}, zeker: rec && typeof rec.zeker === 'boolean' ? rec.zeker : s.status === 'geaccepteerd',
        uitbeeld: !!uitbeeld[s.id], los: false });
    }
    for (const [id, rec] of Object.entries(schets)) {
      if (gezien.has(id) || !rec) continue;
      const cellen = rec.cellen || {}; if (!Object.keys(cellen).length) continue;
      uit.push({ id, naam: rec.naam || ('Offerte ' + (rec.nummer || id)), nummer: rec.nummer || '', datum: '', status: 'los', inclC: null, exclC: null, cellen,
        zeker: typeof rec.zeker === 'boolean' ? rec.zeker : false, uitbeeld: !!uitbeeld[id], los: true });
    }
    return uit;
  };
  L.FILTERS = ['geaccepteerd', 'openstaand', 'concept', 'los', 'uitbeeld'];
  L.filter = (rijen, aan) => { const mag = new Set(aan); return rijen.filter(r => r.uitbeeld ? mag.has('uitbeeld') : mag.has(r.status)); };
  L.tel = rijen => { const t = { geaccepteerd: 0, openstaand: 0, concept: 0, los: 0, uitbeeld: 0 }; for (const r of rijen) { if (r.uitbeeld) t.uitbeeld++; else if (t[r.status] != null) t[r.status]++; } return t; };
  L.bedrag = (r, btw) => btw === 'excl' ? r.exclC : r.inclC;
  L.rijTotaal = (r, maanden) => maanden.reduce((a, m) => a + (r.cellen[m] || 0), 0);
  // Totalen onderaan: per maand, het geheel, wat gaat zeker door, en wat er buiten de getoonde maanden staat (zodat niets onopgemerkt blijft).
  L.totalen = function (rijen, maanden) {
    const per = maanden.map(() => 0), zeker = maanden.map(() => 0), inBeeld = new Set(maanden); let buiten = 0;
    for (const r of rijen) {
      maanden.forEach((m, i) => { const v = r.cellen[m] || 0; per[i] += v; if (r.zeker) zeker[i] += v; });
      for (const [m, v] of Object.entries(r.cellen)) if (!inBeeld.has(m)) buiten += v || 0;
    }
    return { per, zeker, som: per.reduce((a, b) => a + b, 0), somZeker: zeker.reduce((a, b) => a + b, 0), buiten };
  };
  const SORT_RE = /^(offerte|datum|status|zeker|bedrag|totaal|m:\d{4}-\d{2}):(op|af)$/;
  L.SORT_STANDAARD = { sleutel: 'datum', richting: 'af' };
  L.sortLees = t => { const m = SORT_RE.exec(String(t || '')); return m ? { sleutel: m[1], richting: m[2] } : L.SORT_STANDAARD; };
  const STATUS = ['geaccepteerd', 'openstaand', 'concept', 'los'];
  L.sorteer = function (rijen, sort, btw, maanden) {
    const s = sort || L.SORT_STANDAARD, f = s.richting === 'op' ? 1 : -1, nl = (a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true, sensitivity: 'base' });
    const getal = (a, b) => (a == null) - (b == null) || (a == null ? 0 : a - b);
    const waarde = {
      offerte: (a, b) => nl(a.naam, b.naam), datum: (a, b) => nl(a.datum || '', b.datum || ''), status: (a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status),
      zeker: (a, b) => (a.zeker ? 1 : 0) - (b.zeker ? 1 : 0), bedrag: (a, b) => getal(L.bedrag(a, btw), L.bedrag(b, btw)), totaal: (a, b) => L.rijTotaal(a, maanden) - L.rijTotaal(b, maanden) };
    const cmp = s.sleutel.startsWith('m:') ? (a, b) => (a.cellen[s.sleutel.slice(2)] || 0) - (b.cellen[s.sleutel.slice(2)] || 0) : waarde[s.sleutel] || waarde.datum;
    const leegAchter = s.sleutel === 'bedrag' ? (a, b) => (L.bedrag(a, btw) == null) - (L.bedrag(b, btw) == null) : () => 0;   // zonder bedrag altijd onderaan
    return rijen.slice().sort((a, b) => leegAchter(a, b) || f * cmp(a, b) || -nl(a.datum || '', b.datum || '') || nl(a.id, b.id));
  };

  if (typeof document === 'undefined') return;   // tests: alleen de rekenregels

  // ── Weergave ─────────────────────────────────────────────────────────────────
  const h = function (tag, attr) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attr || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'data') for (const [d, w] of Object.entries(v)) e.dataset[d] = w; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) { const c = arguments[i]; if (c == null || c === false) continue; for (const x of Array.isArray(c) ? c : [c]) if (x != null && x !== false) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }
    return e;
  };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  const nu = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const st = L._st = { el: null, opt: null, mag: false, schatten: null, schattenT: 0, afgekapt: false, schets: null, uitbeeld: {}, start: nu(), btw: 'incl', filter: null, sort: null,
    bezig: false, fout: null, bewaren: new Map(), keten: new Map(), mislukt: new Map(), zekerBezig: new Set(), sessie: Math.random().toString(36).slice(2), laadNr: 0 };
  const STATUS_TEKST = { geaccepteerd: 'Geaccepteerd', openstaand: 'Openstaand', concept: 'Concept', los: 'Niet meer open', uitbeeld: 'Uit beeld' };

  function css() {
    if (document.getElementById('mtl-css')) return;
    const s = document.createElement('style'); s.id = 'mtl-css';
    s.textContent = `
.mtl,.mtl-toast{--l-surface:var(--surface,#fff);--l-surface2:var(--surface-2,#f1ede5);--l-line:var(--line,#dfd8cb);--l-soft:var(--line-soft,#ece7de);--l-strong:var(--line-strong,#9a917f);--l-ink:var(--ink,#1b211e);--l-ink2:var(--ink-2,#5e655f);--l-ink3:var(--ink-3,#8c918a);--l-primary:var(--primary,#17643f);--l-psoft:var(--primary-soft,#ddefe3);--l-ptext:var(--primary-text,#17643f);--l-ok:var(--ok,#1a6e3b);--l-okbg:var(--ok-bg,#e3f3e8);--l-warn:var(--warn,#8f5508);--l-warnbg:var(--warn-bg,#fcefd9);--l-err:var(--err,#c4322a);--l-errbg:var(--err-bg,#fce6e4);--l-mono:var(--font-mono,"Geist Mono",ui-monospace,Menlo,monospace);--l-ui:var(--font-ui,"Geist",system-ui,-apple-system,"Segoe UI",sans-serif);--l-head:var(--font-head,"Bricolage Grotesque","Geist",system-ui,sans-serif);--l-r:var(--radius-ctl,4px);--l-rp:var(--radius-panel,8px);--l-pop:var(--shadow-pop,0 24px 60px rgba(40,34,20,.2))}
.mtl{font-family:var(--l-ui);font-size:14px;line-height:20px;color:var(--l-ink);display:flex;flex-direction:column;gap:12px;min-height:360px}
.mtl button{font-family:inherit}
.mtl-kop{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;flex:none}.mtl-titelblok{flex:1;min-width:220px}
.mtl-titel{font-family:var(--l-head);font-size:28px;line-height:32px;font-weight:600;letter-spacing:-.015em;margin:0}
.mtl-sub{margin:2px 0 0;font-size:13px;color:var(--l-ink2)}
.mtl-acties{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mtl-seg{display:inline-flex}.mtl-seg .ui-knop{border-radius:0;margin-left:-1px}.mtl-seg .ui-knop:first-child{border-radius:var(--l-r) 0 0 var(--l-r);margin-left:0}.mtl-seg .ui-knop:last-child{border-radius:0 var(--l-r) var(--l-r) 0}
.mtl-kaart{background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-rp);flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.mtl-balk{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--l-line);flex:none}
.mtl-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--l-r);border:1px solid var(--l-line);background:var(--l-surface);color:var(--l-ink3);font-size:12px;font-weight:500;cursor:pointer}
.mtl-chip:hover{background:var(--l-surface2)}.mtl-chip[aria-pressed=true]{background:var(--l-psoft);border-color:var(--l-psoft);color:var(--l-ptext)}.mtl-tel{font-family:var(--l-mono);font-size:11px;opacity:.75}
.mtl-nav{display:inline-flex;align-items:center;gap:4px;margin-left:auto}.mtl-nav .ui-knop{height:28px;padding:0 10px;font-size:12px}.mtl-periode{font-size:12px;color:var(--l-ink2);margin:0 6px;white-space:nowrap}
.mtl-scroll{flex:1 1 auto;min-height:0;overflow:auto;position:relative;scrollbar-width:thin;scrollbar-color:var(--l-strong) var(--l-surface2)}
.mtl-tabel{border-collapse:separate;border-spacing:0;min-width:100%;min-height:100%;font-size:13px}
.mtl-tabel tr.vul td,.mtl-tabel tr.vul th{height:100%;padding:0;border-bottom:0}.mtl-tabel tbody tr.vul:hover td,.mtl-tabel tbody tr.vul:hover th{background:var(--l-surface)}
.mtl-tabel th,.mtl-tabel td{padding:4px 8px;border-bottom:1px solid var(--l-soft);white-space:nowrap;text-align:right;vertical-align:middle;background:var(--l-surface)}
.mtl-tabel thead th{position:sticky;top:0;z-index:3;font-size:12px;font-weight:500;color:var(--l-ink2);border-bottom:1px solid var(--l-line);height:38px}
.mtl-tabel .s{position:sticky;left:0;z-index:2;text-align:left;min-width:300px;max-width:320px;white-space:normal;box-shadow:1px 0 0 var(--l-soft)}
.mtl-tabel thead th.s{z-index:5}.mtl-tabel tfoot th.s{z-index:5}
.mtl-tabel .num{font-family:var(--l-mono);font-variant-numeric:tabular-nums}
.mtl-tabel th.nu,.mtl-tabel td.nu{background:var(--l-surface2)}.mtl-tabel th.nu{color:var(--l-ptext)}
.mtl-tabel tbody tr:not(.vul){height:42px}.mtl-tabel tbody tr:hover td,.mtl-tabel tbody tr:hover th{background:color-mix(in srgb,var(--l-surface2) 55%,var(--l-surface))}
.mtl-tabel tfoot th,.mtl-tabel tfoot td{position:sticky;z-index:3;font-weight:600;color:var(--l-ink);height:34px;box-sizing:border-box}
.mtl-tabel tfoot tr.som th,.mtl-tabel tfoot tr.som td{bottom:28px;border-top:1px solid var(--l-strong)}
.mtl-tabel tfoot tr.zeker th,.mtl-tabel tfoot tr.zeker td{bottom:0;height:28px;font-weight:400;color:var(--l-ink2);font-size:12px;border-bottom:0}
.mtl-naam b{display:block;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:290px}
.mtl-naam a{color:inherit;text-decoration:none}.mtl-naam a:hover,.mtl-naam a:focus-visible{color:var(--l-primary);text-decoration:underline}
.mtl-meta{display:flex;gap:4px 8px;align-items:center;flex-wrap:wrap;font-size:11px;line-height:16px;color:var(--l-ink3)}
.mtl-st{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--l-r);font-size:11px;font-weight:500}
.mtl-st.geaccepteerd{color:var(--l-ok);background:var(--l-okbg)}.mtl-st.openstaand{color:var(--l-warn);background:var(--l-warnbg)}.mtl-st.concept,.mtl-st.los,.mtl-st.uitbeeld{color:var(--l-ink2);background:var(--l-surface2)}
.mtl-tabel .zk{width:72px;min-width:72px;text-align:center}.mtl-tabel .bd{min-width:96px;color:var(--l-ink2)}.mtl-tabel .tot{min-width:96px;font-weight:500;box-shadow:inset 1px 0 0 var(--l-line)}
.mtl-sw{position:relative;display:inline-block;width:34px;height:20px;vertical-align:middle;cursor:pointer}.mtl-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}
.mtl-sw span{position:absolute;inset:0;border-radius:10px;background:var(--l-strong);transition:background .15s}.mtl-sw span::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--l-surface);box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.mtl-sw input:checked+span{background:var(--l-primary)}.mtl-sw input:checked+span::after{transform:translateX(14px)}.mtl-sw input:focus-visible+span{outline:2px solid var(--l-primary);outline-offset:2px}.mtl-sw input:disabled{cursor:not-allowed}.mtl-sw input:disabled+span{opacity:.45}
.mtl-in{width:96px;height:28px;box-sizing:border-box;text-align:right;border:1px solid var(--l-soft);border-radius:var(--l-r);padding:0 6px;background:var(--l-surface);color:var(--l-ink);font:inherit;font-family:var(--l-mono);font-variant-numeric:tabular-nums}
.mtl-in::placeholder{color:var(--l-ink3);opacity:.6}.mtl-in:hover:not(:disabled){border-color:var(--l-strong)}.mtl-in:focus{outline:2px solid var(--l-primary);outline-offset:1px;border-color:var(--l-strong)}
.mtl-in.bewaren{color:var(--l-ink3)}.mtl-in.fout{border-color:var(--l-err);background:var(--l-errbg)}.mtl-in:disabled{background:transparent;border-color:transparent;cursor:default}
.mtl-sortknop{border:0;background:none;font:inherit;color:inherit;cursor:pointer;padding:2px 4px;border-radius:var(--l-r);white-space:nowrap}.mtl-sortknop:hover{background:var(--l-surface2);color:var(--l-ink)}.mtl-sortknop.actief{color:var(--l-ink);font-weight:600}
.mtl-sortrij{display:flex;gap:2px;align-items:center;flex-wrap:wrap}.mtl-0{color:var(--l-ink3);font-weight:400}
.mtl-melding{padding:24px;color:var(--l-ink2)}.mtl-fout{padding:10px 14px;border:1px solid var(--l-err);background:var(--l-errbg);color:var(--l-err);border-radius:var(--l-rp);font-size:13px;flex:none}
.mtl-voet{font-size:12px;color:var(--l-ink3);flex:none}
.mtl-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--l-surface);color:var(--l-ink);border:1px solid var(--l-line);box-shadow:var(--l-pop);padding:10px 16px;border-radius:var(--l-rp);font-family:var(--l-ui);font-size:13px;z-index:9999;max-width:90vw}
.mtl-toast button{margin-left:12px;border:0;background:none;color:var(--l-primary);font:inherit;font-weight:600;cursor:pointer;padding:0;text-decoration:underline}
@media (max-width:700px){.mtl-titel{font-size:24px;line-height:29px}.mtl-tabel .s{min-width:170px;max-width:180px}.mtl-naam b{max-width:160px}.mtl-nav{margin-left:0}.mtl-in{width:84px}}
`;
    document.head.appendChild(s);
  }
  let toastTimer = null;
  function toast(tekst, actie) {
    document.querySelectorAll('.mtl-toast').forEach(x => x.remove()); clearTimeout(toastTimer);
    const t = h('div', { class: 'mtl-toast', role: 'status' }, tekst, actie ? h('button', { type: 'button', onclick: () => { t.remove(); actie.fn(); } }, actie.label) : null);
    document.body.appendChild(t); toastTimer = setTimeout(() => t.remove(), actie ? 12000 : 4500);
  }
  const knop = (tekst, attr) => h('button', Object.assign({ type: 'button', class: 'ui-knop' }, attr), tekst);

  // ── Laden ──
  L.start = function (el, opt) {
    st.el = el; st.opt = opt || {}; st.mag = !!st.opt.magWijzigen; css();
    st.btw = ls.get('mtl:btw') === 'excl' ? 'excl' : 'incl';
    try { const f = JSON.parse(ls.get('mtl:filter') || 'null'); st.filter = Array.isArray(f) ? f.filter(x => L.FILTERS.includes(x)) : null; } catch (e) { st.filter = null; }
    if (!st.filter) st.filter = ['geaccepteerd', 'openstaand', 'los'];
    st.sort = L.sortLees(ls.get('mtl:sort'));
    if (!L._resize) { L._resize = true; window.addEventListener('resize', () => { if (st.el && st.el.isConnected) pasHoogte(); });
      meldLevend(); setInterval(() => meldLevend(), 10000); window.addEventListener('pagehide', () => meldLevend(true));
      window.addEventListener('beforeunload', ev => { if (eigenConcepten() || st.bewaren.size || st.zekerBezig.size) { ev.preventDefault(); ev.returnValue = ''; } }); }
    return L.laad();
  };
  // ── Concepten: wat je typt staat meteen op deze computer (mtl:concept), tot de worker het bevestigt. Herlaad je, sluit je de tab of valt de
  // verbinding weg vóór het opslaan, dan zet herstel() het bij het volgende laden terug: staat er op de server nog wat je zag, dan wordt het
  // alsnog opgeslagen; heeft een collega het intussen gewijzigd, dan wordt het vakje rood met jouw bedrag en kies je zelf (Toch zetten / Esc).
  // Opslag per tabblad: sleutel "<offerte>|<maand>#<sessie>", en elke wijziging leest eerst de actuele stand uit localStorage, zodat twee open
  // tabbladen elkaars concepten nooit overschrijven.
  function leesConcepten() { try { const c = JSON.parse(ls.get('mtl:concept') || '{}'); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (e) { return {}; } }
  function schrijfConcepten(m) { ls.set('mtl:concept', JSON.stringify(m)); }
  const ck = sl => sl + '#' + st.sessie;
  function zetConcept(sl, c) { const m = leesConcepten(); m[ck(sl)] = Object.assign({ ts: Date.now() }, c); schrijfConcepten(m); }
  function wisConcept(sl) { const m = leesConcepten(); if (ck(sl) in m) { delete m[ck(sl)]; schrijfConcepten(m); } }
  function heeftConcept(sl) { return ck(sl) in leesConcepten(); }
  function eigenConcepten() { return Object.keys(leesConcepten()).filter(k => k.endsWith('#' + st.sessie)).length; }
  // Open tabbladen melden zich elke 10 s (mtl:levend); bij sluiten of herladen (pagehide) meldt een tabblad zich af. Concepten van een tabblad
  // dat nog leeft laat herstel() met rust (daar wordt misschien nog getypt).
  function leesLevend() { try { const m = JSON.parse(ls.get('mtl:levend') || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } }
  function meldLevend(weg) { const m = leesLevend(), nu = Date.now(); for (const k of Object.keys(m)) if (nu - m[k] > 60000) delete m[k]; if (weg) delete m[st.sessie]; else m[st.sessie] = nu; ls.set('mtl:levend', JSON.stringify(m)); }
  function serverWaarde(id, ym) { const r = st.schets && st.schets[id]; return r && r.cellen && ym in r.cellen ? r.cellen[ym] : null; }
  // Pakt alleen concepten op van tabbladen die niet meer open zijn (eigen tabblad: dat regelt de open pagina zelf). Een opgepakt concept gaat
  // over naar dit tabblad (blijft dus bewaard als ook deze pagina herlaadt). Per vakje telt het nieuwste; een ouder concept voor hetzelfde vakje
  // is door later typen achterhaald. Onleesbare invoer (bv. "1.") gaat niet weg: het vakje wordt rood met die tekst.
  function herstel() {
    const auto = [], botsing = [], onleesbaar = [], levend = leesLevend(), m = leesConcepten(), perSl = {};
    for (const [k, c] of Object.entries(m)) {
      const i = k.lastIndexOf('#'), sl = i > 0 ? k.slice(0, i) : '', ses = i > 0 ? k.slice(i + 1) : '', [id, ym] = sl.split('|');
      if (!c || !/^\d{6,25}$/.test(id || '') || !/^\d{4}-\d{2}$/.test(ym || '')) { delete m[k]; continue; }
      if (ses === st.sessie) continue;
      if (levend[ses] && Date.now() - levend[ses] < 25000) continue;                                      // van een ander tabblad dat nog open is
      if (perSl[sl] && (perSl[sl].c.ts || 0) >= (c.ts || 0)) { delete m[k]; continue; }
      if (perSl[sl]) delete m[perSl[sl].k];
      perSl[sl] = { k, c };
    }
    for (const [sl, { k, c }] of Object.entries(perSl)) {
      delete m[k];
      if (ck(sl) in m || st.bewaren.has(sl)) continue;                                                     // in dit tabblad wordt er al aan gewerkt
      const [id, ym] = sl.split('|'), server = serverWaarde(id, ym);
      let nieuw = c.nieuw;
      if (nieuw === undefined) {
        const rij = rijVan(id), x = L.leesInvoer(c.tekst, rij ? L.bedrag(rij, c.btw || st.btw) : null);
        if (x.fout) { m[ck(sl)] = Object.assign({}, c, { ts: Date.now() }); st.mislukt.set(sl, { tekst: String(c.tekst), oud: server }); onleesbaar.push(sl); continue; }
        nieuw = x.c;
      }
      if (nieuw === server) continue;
      if (server === c.oud && !c.botsing) { m[ck(sl)] = { ts: Date.now(), nieuw, oud: server }; auto.push([id, ym, nieuw, server]); }
      else { m[ck(sl)] = { ts: Date.now(), nieuw, oud: c.oud, botsing: true }; st.mislukt.set(sl, { nieuw, oud: server }); botsing.push([id, ym, nieuw, server]); }
    }
    schrijfConcepten(m);
    for (const x of auto) bewaar(x[0], x[1], x[2], x[3], null);
    if (onleesbaar.length) toast(`${onleesbaar.length === 1 ? 'Eén niet-opgeslagen invoer is' : onleesbaar.length + ' niet-opgeslagen invoeren zijn'} niet als bedrag te lezen. Die vakjes staan rood: verbeter het bedrag, of Esc om weg te gooien.`);
    else
    if (botsing.length === 1) { const [id, ym, nieuw, server] = botsing[0]; toast(`Een niet-opgeslagen bedrag (${nieuw == null ? 'wissen' : L.fmt(nieuw)}, ${maandTekst(ym)}) botst met wat er nu staat (${server == null ? 'leeg' : L.fmt(server)}). Het vakje staat rood; Esc in het vakje gooit het weg.`, { label: 'Toch zetten', fn: () => bewaar(id, ym, nieuw, server, null) }); }
    else if (botsing.length) toast(`${botsing.length} niet-opgeslagen bedragen botsen met wat er nu staat. Die vakjes staan rood: typ opnieuw om op te slaan, of Esc om weg te gooien.`);
    else if (auto.length) toast(`${auto.length === 1 ? 'Eén niet-opgeslagen bedrag' : auto.length + ' niet-opgeslagen bedragen'} van eerder teruggezet en opgeslagen.`);
  }
  // Elke keer dat de tab opent: de schets altijd vers (goedkoop); de offertes uit Moneybird hooguit elke 2 minuten (of met Vernieuwen).
  L.laad = async function (o) {
    if (!st.el) return;
    const nr = ++st.laadNr, offertesOok = (o && o.vers) || !st.schatten || Date.now() - st.schattenT > 120000;
    st.bezig = true; st.fout = null; teken();
    try {
      let [sch, ub, sr] = await Promise.all([st.opt.bron.haal('/geld/schets'), st.opt.bron.haal('/geld/uitbeeld').catch(() => null), offertesOok ? st.opt.schatten() : Promise.resolve(null)]);
      if (nr !== st.laadNr) return;
      if (!sch || sch.error || !sch.items) throw new Error((sch && sch.error) || 'de schets is niet te lezen');
      // Eenmalig (de eerste keer dat iemand met schrijfrecht de light opent): de planning uit de uitgebreide Forecast overnemen. De worker vult
      // alleen lege vakjes en doet het nooit twee keer; mislukt het, dan gewoon de volgende keer opnieuw.
      if (sch.import === null && st.mag && !st.importGeprobeerd) {
        st.importGeprobeerd = true;
        let im = null; try { im = await st.opt.bron.haal('/geld/schets/import', { method: 'POST', body: {} }); } catch (e) { im = { error: String(e.message || e) }; }
        if (im && im.ok) {
          const sch2 = await st.opt.bron.haal('/geld/schets'); if (sch2 && sch2.items) sch = sch2;
          const x = im.import || {}; if (!im.al && (x.vakjes || x.offertes)) toast(`De planning uit de uitgebreide forecast is overgenomen: ${x.vakjes} bedragen bij ${x.offertes} offertes${x.zonder_offerte ? ` (${x.zonder_offerte} zonder offerte niet: die staan alleen in de uitgebreide forecast)` : ''}.`);
        } else { st.importGeprobeerd = false; toast('Overnemen uit de uitgebreide forecast lukte nog niet (' + ((im && im.error) || 'geen verbinding') + '); de volgende keer opnieuw.'); }
        if (nr !== st.laadNr) return;
      }
      st.schets = sch.items; ls.set('mtl:kopie', JSON.stringify({ ts: Date.now(), items: sch.items }));   // reservekopie op deze computer
      if (ub && ub.items) st.uitbeeld = ub.items;
      if (sr) { st.schatten = (sr.lijst || []).map(e => root.MTForecast.schatNorm(e)).filter(Boolean); st.afgekapt = !!sr.afgekapt; st.schattenT = Date.now(); }
    } catch (e) { if (nr === st.laadNr) st.fout = String(e.message || e); }
    if (nr !== st.laadNr) return;
    st.bezig = false; teken();
    if (!st.fout && st.schets && st.schatten && st.mag) { herstel(); werkBij(); }
  };

  // ── Opslaan van één vakje ──
  function rijVan(id) { return L.rijen(st.schatten, st.schets, st.uitbeeld).find(r => r.id === id) || null; }
  // Per vakje één opslag tegelijk, op volgorde. Loopt er al een opslag voor dit vakje, dan zag je die waarde: die geldt als "oud" (anders gaf
  // snel twee keer wijzigen een vals conflict met jezelf). Mislukt de eerdere, dan weigert de worker ook de volgende (409): niets gaat stil verloren.
  function bewaar(id, ym, nieuw, oud, inp) {
    const sl = id + '|' + ym;
    if (st.bewaren.has(sl)) oud = st.bewaren.get(sl);
    st.bewaren.set(sl, nieuw); st.mislukt.delete(sl); if (inp) { inp.classList.add('bewaren'); inp.classList.remove('fout'); }
    // kwam de vorige opslag niet aan (netwerk), dan staat op de server nog wat díe zag: die waarde is dan de juiste "oud"
    const job = (st.keten.get(sl) || Promise.resolve()).then(vorige => stuur(id, ym, nieuw, vorige && vorige.netwerk ? vorige.oud : oud, inp, sl, job));
    st.keten.set(sl, job);
    return job;
  }
  async function stuur(id, ym, nieuw, oud, inp, sl, job) {
    const rij = rijVan(id);
    let r; try { r = await st.opt.bron.haal('/geld/schets', { method: 'POST', body: { eid: id, ym, bedrag: nieuw, oud, naam: rij ? rij.naam : undefined, nummer: rij && rij.nummer ? rij.nummer : undefined } }); } catch (e) { r = { error: String(e.message || e) }; }
    const laatste = st.keten.get(sl) === job;
    if (laatste) { st.keten.delete(sl); st.bewaren.delete(sl); }
    if (r && r.ok && r.item) { if (laatste) wisConcept(sl); st.schets[id] = r.item; ls.set('mtl:kopie', JSON.stringify({ ts: Date.now(), items: st.schets })); werkBij(inp ? undefined : sl); return; }   // vanuit de melding (Toch/Opnieuw): het vakje altijd bijwerken
    if (r && 'huidig' in r) {                                   // een collega was je voor: zijn bedrag tonen, het jouwe niet stilletjes wegschrijven
      if (r.item) st.schets[id] = r.item; else delete st.schets[id];
      if (!laatste) { werkBij(); return; }                    // een nieuwere opslag voor dit vakje volgt en meldt zelf
      if (heeftConcept(sl)) zetConcept(sl, { nieuw, oud, botsing: true });   // na herladen: rood + zelf kiezen, nooit automatisch over de collega heen
      werkBij(sl);
      toast(`Dit vakje (${maandTekst(ym)}) was intussen gewijzigd${r.item && r.item.door ? ' door ' + r.item.door : ''}: nu ${r.huidig == null ? 'leeg' : L.fmt(r.huidig)}. Jouw ${nieuw == null ? 'wissen' : L.fmt(nieuw)} is niet opgeslagen.`,
        { label: nieuw == null ? 'Toch wissen' : 'Toch ' + L.fmt(nieuw) + ' zetten', fn: () => bewaar(id, ym, nieuw, r.huidig, null) });
      return;
    }
    if (!laatste) return { netwerk: true, oud };                  // de nieuwere opslag gaat met deze "oud" verder en meldt zelf
    st.mislukt.set(sl, { nieuw, oud }); werkBij();
    toast('Niet opgeslagen: ' + ((r && r.error) || 'geen verbinding') + '. Het vakje staat rood.', { label: 'Opnieuw', fn: () => bewaar(id, ym, nieuw, oud, null) });
    return { netwerk: true, oud };
  }
  // Gaat zeker door: met dezelfde controle als de vakjes (oud = de stand die je zag; null = nog nooit gezet). Bij een conflict of fout springt de
  // schakelaar terug naar wat er echt staat en zie je waarom (met Toch / Opnieuw); tijdens het opslaan waarschuwt de browser bij sluiten.
  async function zetZeker(id, ja, oudOpt) {
    const rij = rijVan(id), rec = st.schets && st.schets[id], oud = oudOpt !== undefined ? oudOpt : rec && typeof rec.zeker === 'boolean' ? rec.zeker : null;
    st.zekerBezig.add(id);
    let r; try { r = await st.opt.bron.haal('/geld/schets', { method: 'POST', body: { eid: id, zeker: ja, oud, naam: rij ? rij.naam : undefined, nummer: rij && rij.nummer ? rij.nummer : undefined } }); } catch (e) { r = { error: String(e.message || e) }; }
    st.zekerBezig.delete(id);
    const wat = (ja ? 'aan' : 'uit') + 'zetten van "Gaat zeker door"' + (rij ? ' (' + rij.naam + ')' : '');
    if (r && r.ok && r.item) st.schets[id] = r.item;
    else if (r && 'huidig' in r) { if (r.item) st.schets[id] = r.item; toast(`Het ${wat} is niet opgeslagen: iemand anders had het intussen ${r.huidig ? 'aan' : 'uit'}gezet.`, { label: 'Toch ' + (ja ? 'aan' : 'uit'), fn: () => zetZeker(id, ja, r.huidig) }); }
    else toast(`Het ${wat} is niet opgeslagen: ${(r && r.error) || 'geen verbinding'}.`, { label: 'Opnieuw', fn: () => zetZeker(id, ja, oud) });
    werkBij();
  }

  // ── Tekenen ──
  function pasHoogte() {
    const w = st.el && st.el.querySelector('.mtl'); if (!w) return;
    const top = w.getBoundingClientRect().top, hgt = Math.max(420, window.innerHeight - Math.max(0, top) - 16);
    w.style.height = hgt + 'px';
  }
  function maanden() { return L.maanden(st.start, AANTAL); }
  function zichtbareRijen() { return L.sorteer(L.filter(L.rijen(st.schatten, st.schets, st.uitbeeld), st.filter), st.sort, st.btw, maanden()); }
  // Na een opslag alleen de cijfers bijwerken (geen hertekening: de focus en een half getypt vakje blijven staan).
  function werkBij(forceer) {
    const t = st.el && st.el.querySelector('.mtl-tabel'); if (!t) return;
    const ms = maanden(), rijen = zichtbareRijen(), perId = new Map(rijen.map(r => [r.id, r]));
    t.querySelectorAll('input.mtl-in').forEach(inp => {
      const r = perId.get(inp.dataset.id); if (!r) return; const sl = inp.dataset.id + '|' + inp.dataset.ym;
      inp.classList.toggle('fout', st.mislukt.has(sl)); inp.classList.toggle('bewaren', st.bewaren.has(sl));
      const v = r.cellen[inp.dataset.ym]; inp.dataset.oud = v == null ? '' : String(v);              // altijd de laatst bekende stand van de server
      if ((document.activeElement === inp && sl !== forceer) || st.bewaren.has(sl)) return;   // niet door iemands getyp heen schrijven
      const m = st.mislukt.get(sl), toon = m ? m.nieuw : v;                                    // rood vakje: jouw niet-opgeslagen bedrag blijft staan
      inp.value = m && m.tekst != null ? m.tekst : toon == null ? '' : L.fmt(toon);
    });
    t.querySelectorAll('td.tot[data-id]').forEach(td => { const r = perId.get(td.dataset.id); if (r) zetGetal(td, L.rijTotaal(r, ms)); });
    t.querySelectorAll('input.mtl-zk').forEach(cb => { const r = perId.get(cb.dataset.id); if (r) cb.checked = r.zeker; });
    const tot = L.totalen(rijen, ms);
    t.querySelectorAll('tfoot tr.som td[data-i]').forEach(td => zetGetal(td, tot.per[Number(td.dataset.i)]));
    t.querySelectorAll('tfoot tr.zeker td[data-i]').forEach(td => zetGetal(td, tot.zeker[Number(td.dataset.i)]));
    const s = t.querySelector('tfoot tr.som td.tot'); if (s) zetGetal(s, tot.som); const z = t.querySelector('tfoot tr.zeker td.tot'); if (z) zetGetal(z, tot.somZeker);
    const v = st.el.querySelector('.mtl-voet'); if (v) v.textContent = voetTekst(tot);
  }
  function zetGetal(td, c) { td.textContent = c ? L.fmt(c) : '\u2013'; td.classList.toggle('mtl-0', !c); }
  function voetTekst(tot) {
    const d = [];
    if (tot.buiten) d.push(`Buiten deze ${AANTAL} maanden staat nog ${L.fmt(tot.buiten)} (blader met ‹ ›).`);
    if (st.afgekapt) d.push('Let op: niet alle offertes uit Moneybird zijn geladen.');
    d.push('De schets telt nergens anders mee. Typ een bedrag, of een percentage van het offertebedrag (bv. 50%). Leeg maken = wissen.');
    return d.join(' ');
  }
  function sortKnop(sleutel, tekst) {
    const actief = st.sort.sleutel === sleutel, pijl = actief ? (st.sort.richting === 'op' ? ' \u2191' : ' \u2193') : '';
    return h('button', { type: 'button', class: 'mtl-sortknop' + (actief ? ' actief' : ''), 'aria-sort': actief ? (st.sort.richting === 'op' ? 'ascending' : 'descending') : null, title: 'Sorteren op ' + tekst.toLowerCase(),
      onclick: () => { st.sort = { sleutel, richting: actief && st.sort.richting === 'af' ? 'op' : 'af' }; ls.set('mtl:sort', st.sort.sleutel + ':' + st.sort.richting); teken(); } }, tekst + pijl);
  }
  function teken() {
    if (!st.el) return;
    const sl = st.el.querySelector('.mtl-scroll'), sx = sl ? sl.scrollLeft : 0, sy = sl ? sl.scrollTop : 0;
    // wie aan het typen is houdt zijn vakje, tekst en cursor bij een hertekening (bv. Vernieuwen of het laden na het openen van de tab)
    const a = document.activeElement, typ = a && a.classList && a.classList.contains('mtl-in') && st.el.contains(a) ? { id: a.dataset.id, ym: a.dataset.ym, v: a.value, s: a.selectionStart, e: a.selectionEnd } : null;
    const ms = maanden(), dezeMaand = nu();
    const kop = h('div', { class: 'mtl-kop' },
      h('div', { class: 'mtl-titelblok' }, h('h1', { class: 'mtl-titel' }, 'Forecast'), h('p', { class: 'mtl-sub' }, 'Schets van de facturatie per maand. De bedragen tellen alleen hier op.')),
      h('div', { class: 'mtl-acties' },
        h('div', { class: 'mtl-seg', role: 'group', 'aria-label': 'Offertebedrag' }, ['incl', 'excl'].map(b => knop(b + '. btw', { class: 'ui-knop' + (st.btw === b ? ' ui-knop--primair' : ''), 'aria-pressed': String(st.btw === b), title: 'Alleen de kolom Bedrag (offertetotaal uit Moneybird)',
          onclick: () => { st.btw = b; ls.set('mtl:btw', b); teken(); } }))),
        knop('Vernieuwen', { disabled: st.bezig, onclick: () => L.laad({ vers: true }) }),
        st.opt.openUitgebreid ? knop('Uitgebreide forecast', { title: 'De uitgebreide Forecast (met de prognose van Financiën) staat bij Financiën', onclick: () => st.opt.openUitgebreid() }) : null));
    const delen = [kop];
    if (st.fout) delen.push(h('div', { class: 'mtl-fout', role: 'alert' }, 'Kon niet laden: ' + st.fout + ' ', knop('Opnieuw', { onclick: () => L.laad({ vers: true }) })));
    const kaart = h('div', { class: 'mtl-kaart' });
    delen.push(kaart);
    if (!st.schets || !st.schatten) {
      kaart.appendChild(h('div', { class: 'mtl-melding' }, st.bezig ? 'Offertes en schets laden\u2026' : 'Nog niets geladen.'));
    } else {
      const alle = L.rijen(st.schatten, st.schets, st.uitbeeld), tel = L.tel(alle), rijen = zichtbareRijen(), tot = L.totalen(rijen, ms);
      kaart.appendChild(h('div', { class: 'mtl-balk' },
        L.FILTERS.filter(f => f !== 'los' || tel.los).map(f => h('button', { type: 'button', class: 'mtl-chip', 'aria-pressed': String(st.filter.includes(f)),
          title: f === 'los' ? 'Offertes die niet meer open staan in Moneybird (bv. gefactureerd) maar waar nog bedragen in de schets staan' : f === 'uitbeeld' ? 'Offertes die bij de uitgebreide forecast uit beeld zijn gezet' : null,
          onclick: () => { st.filter = st.filter.includes(f) ? st.filter.filter(x => x !== f) : st.filter.concat(f); ls.set('mtl:filter', JSON.stringify(st.filter)); teken(); } }, STATUS_TEKST[f], h('span', { class: 'mtl-tel' }, String(tel[f])))),
        h('div', { class: 'mtl-nav' },
          knop('\u2039', { title: 'Eén maand terug', 'aria-label': 'Eén maand terug', onclick: () => { st.start = maandPlus(st.start, -1); teken(); } }),
          h('span', { class: 'mtl-periode' }, maandTekst(ms[0]) + ' \u2013 ' + maandTekst(ms[ms.length - 1])),
          knop('\u203a', { title: 'Eén maand verder', 'aria-label': 'Eén maand verder', onclick: () => { st.start = maandPlus(st.start, 1); teken(); } }),
          st.start !== dezeMaand ? knop('Vanaf nu', { onclick: () => { st.start = dezeMaand; teken(); } }) : null)));
      const thead = h('thead', null, h('tr', null,
        h('th', { class: 's', scope: 'col' }, h('div', { class: 'mtl-sortrij' }, sortKnop('offerte', 'Offerte'), sortKnop('datum', 'Datum'), sortKnop('status', 'Status'))),
        h('th', { class: 'zk', scope: 'col' }, sortKnop('zeker', 'Gaat zeker door')),
        h('th', { class: 'bd num', scope: 'col' }, sortKnop('bedrag', 'Bedrag ' + st.btw + '.')),
        ms.map(m => h('th', { class: 'num' + (m === dezeMaand ? ' nu' : ''), scope: 'col' }, sortKnop('m:' + m, maandTekst(m)))),
        h('th', { class: 'tot num', scope: 'col' }, sortKnop('totaal', 'Totaal'))));
      const tbody = h('tbody', null, rijen.length ? rijen.map(r => {
        const b = L.bedrag(r, st.btw), href = !r.los && st.opt.administratie ? root.MTForecast.mbUrl(st.opt.administratie(), 'estimates', r.id) : null;
        return h('tr', null,
          h('th', { class: 's', scope: 'row' }, h('div', { class: 'mtl-naam' }, h('b', { title: r.naam }, href ? h('a', { href, target: '_blank', rel: 'noopener', title: 'Open de offerte in Moneybird' }, r.naam) : r.naam),
            h('div', { class: 'mtl-meta' }, r.nummer ? h('span', null, 'offerte ' + r.nummer) : null, r.datum ? h('span', null, r.datum.split('-').reverse().join('-')) : null, h('span', { class: 'mtl-st ' + (r.uitbeeld ? 'uitbeeld' : r.status) }, r.uitbeeld ? 'Uit beeld' : STATUS_TEKST[r.status])))),
          h('td', { class: 'zk' }, h('label', { class: 'mtl-sw', title: 'Gaat zeker door (alleen voor deze schets)' }, h('input', { type: 'checkbox', class: 'mtl-zk', role: 'switch', data: { id: r.id }, 'aria-label': 'Gaat zeker door: ' + r.naam, disabled: !st.mag, checked: r.zeker, onchange: ev => zetZeker(r.id, ev.target.checked) }), h('span'))),
          h('td', { class: 'bd num', title: r.inclC != null ? 'incl. btw ' + L.fmt(r.inclC) + (r.exclC != null ? ' \u00b7 excl. btw ' + L.fmt(r.exclC) : '') : null }, b == null ? '\u2013' : L.fmt(b)),
          ms.map(m => { const v = r.cellen[m], sl = r.id + '|' + m;
            return h('td', { class: 'num' + (m === dezeMaand ? ' nu' : '') }, h('input', { class: 'mtl-in' + (st.mislukt.has(sl) ? ' fout' : '') + (st.bewaren.has(sl) ? ' bewaren' : ''), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: st.mag ? '\u2013' : '',
              'aria-label': r.naam + ', ' + maandTekst(m), disabled: !st.mag, data: { id: r.id, ym: m, oud: v == null ? '' : String(v) }, value: st.mislukt.has(sl) ? (st.mislukt.get(sl).tekst != null ? st.mislukt.get(sl).tekst : L.fmt(st.mislukt.get(sl).nieuw)) : v == null ? '' : L.fmt(v) })); }),
          h('td', { class: 'tot num', data: { id: r.id } }));
      }) : h('tr', null, h('td', { class: 's', colspan: String(ms.length + 4), style: 'text-align:left;color:var(--l-ink3)' }, 'Geen offertes met dit filter.')),
        // vulrij: neemt de rest van de hoogte, zodat de totalen ook bij weinig offertes tegen de onderrand staan
        h('tr', { class: 'vul', 'aria-hidden': 'true' }, h('th', { class: 's' }), h('td', { colspan: String(ms.length + 3) })));
      const tfoot = h('tfoot', null,
        h('tr', { class: 'som' }, h('th', { class: 's', scope: 'row' }, 'Totaal per maand'), h('td', { class: 'zk' }), h('td', { class: 'bd num' }), ms.map((m, i) => h('td', { class: 'num' + (m === dezeMaand ? ' nu' : ''), data: { i: String(i) } })), h('td', { class: 'tot num' })),
        h('tr', { class: 'zeker' }, h('th', { class: 's', scope: 'row' }, 'waarvan gaat zeker door'), h('td', { class: 'zk' }), h('td', { class: 'bd num' }), ms.map((m, i) => h('td', { class: 'num' + (m === dezeMaand ? ' nu' : ''), data: { i: String(i) } })), h('td', { class: 'tot num' })));
      const tabel = h('table', { class: 'mtl-tabel' }, thead, tbody, tfoot);
      tabel.addEventListener('focusin', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) ev.target.select(); });
      tabel.addEventListener('keydown', toets);
      tabel.addEventListener('change', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) verwerk(ev.target); });
      tabel.addEventListener('input', ev => { if (ev.target.classList && ev.target.classList.contains('mtl-in')) getypt(ev.target); });
      kaart.appendChild(h('div', { class: 'mtl-scroll' }, tabel));
      delen.push(h('div', { class: 'mtl-voet' }, voetTekst(tot)));
    }
    const w = h('div', { class: 'mtl' + (st.bezig ? ' bezig' : '') }, delen);
    st.el.replaceChildren(w);
    werkBij(); pasHoogte();
    const sl2 = st.el.querySelector('.mtl-scroll'); if (sl2) { sl2.scrollLeft = sx; sl2.scrollTop = sy; }
    if (typ) { const i = st.el.querySelector(`input.mtl-in[data-id="${typ.id}"][data-ym="${typ.ym}"]`); if (i && !i.disabled) { i.value = typ.v; i.focus({ preventScroll: true }); try { i.setSelectionRange(typ.s, typ.e); } catch (e) { } } }
  }
  function verwerk(inp) {
    const id = inp.dataset.id, ym = inp.dataset.ym, oud = inp.dataset.oud === '' ? null : Number(inp.dataset.oud), rij = rijVan(id);
    const x = L.leesInvoer(inp.value, rij ? L.bedrag(rij, st.btw) : null);
    const sl = id + '|' + ym;
    if (x.fout) {                                                  // onleesbaar: niets weggooien; de tekst blijft rood staan (en als concept) tot verbeterd of Esc
      st.mislukt.set(sl, { tekst: inp.value, oud }); zetConcept(sl, { tekst: inp.value, btw: st.btw, oud });
      inp.classList.add('fout'); toast(x.fout + ' Het vakje staat rood; verbeter het, of Esc om terug te gaan.'); return;
    }
    inp.value = x.c == null ? '' : L.fmt(x.c);
    const gezien = st.bewaren.has(sl) ? st.bewaren.get(sl) : oud;    // een lopende opslag telt als wat er staat
    if (x.c === gezien && !st.mislukt.has(sl)) { if (!st.bewaren.has(sl)) wisConcept(sl); return; }
    zetConcept(sl, { nieuw: x.c, oud: st.bewaren.has(sl) ? st.bewaren.get(sl) : oud });
    bewaar(id, ym, x.c, oud, inp);
  }
  // Elke toetsaanslag meteen als concept op deze computer (zie herstel), zodat herladen of sluiten vóór het opslaan niets kost.
  function getypt(inp) {
    const sl = inp.dataset.id + '|' + inp.dataset.ym;
    zetConcept(sl, { tekst: inp.value, btw: st.btw, oud: st.bewaren.has(sl) ? st.bewaren.get(sl) : inp.dataset.oud === '' ? null : Number(inp.dataset.oud) });
  }
  // Enter = opslaan en naar het vakje eronder (Shift+Enter: erboven); Escape = terug naar wat er stond.
  function toets(ev) {
    const inp = ev.target; if (!inp.classList || !inp.classList.contains('mtl-in')) return;
    if (ev.key === 'Escape') {                                   // terug naar wat er op de server staat; een rood (niet opgeslagen) bedrag gaat weg
      const o = inp.dataset.oud, sl = inp.dataset.id + '|' + inp.dataset.ym; inp.value = o === '' ? '' : L.fmt(Number(o));
      if (!st.bewaren.has(sl)) { wisConcept(sl); st.mislukt.delete(sl); } inp.blur(); werkBij(sl); return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const alle = [...st.el.querySelectorAll(`input.mtl-in[data-ym="${inp.dataset.ym}"]`)], i = alle.indexOf(inp), volgende = alle[i + (ev.shiftKey ? -1 : 1)];
    if (volgende) volgende.focus(); else inp.blur();
  }
})(typeof window !== 'undefined' ? window : globalThis);
