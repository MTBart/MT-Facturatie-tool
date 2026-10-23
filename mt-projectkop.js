/* ============================================================================
 * mt-projectkop.js — de vaste projectkop (samenhang S1): bovenaan elk project, altijd zichtbaar, onder de klant › locatie › project-balk.
 * ----------------------------------------------------------------------------
 *   [● fase ▾]  Lever do 30-10 · wk 44   Uren 19,5 / 35 u ▓▓▓░░   Volgende: Zagen en CNC (Arjan, do 23-10)        [⋯]
 * - Fase: klik = fase wijzigen, via dezelfde route als Voortgang en de leads (D.faseKies: projFaseZet = projVeldZet + slaProjectenOp), met Ongedaan maken waar dat kan.
 * - Leverdatum en week uit de projectgegevens (alleen lezen; bewerken doe je in Gegevens).
 * - Urenmeter: een compacte versie die ALLEEN LEEST. Hij berekent met de bestaande meter (D.meter) en laadt de uren uit Toggl zelf (D.meterLaad), met een eigen laad- en foutstatus,
 *   zodat hij niet pas klopt nadat Planning is geopend. De waarschuwing bij 90% en 100% van het budget staat hier ook.
 * - Volgende actie: de taak die nu bezig is, anders de eerstvolgende open taak (klik = taakpaneel).
 * - ⋯-menu: Kopieer link, Projectgegevens voor Vectorworks, Verwijderen (rood, alleen hier). Een rol zonder recht ziet de acties niet.
 * Tekent met DOM-calls, nooit met opgebouwde HTML. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const K = {};
  let D = {};
  const S = { bezig: false, sluitKoppeld: false };
  const P = () => root.MTPlanning;
  const dom = () => D.doc || root.document;

  // ── rekenwerk (geen DOM) ──
  // De eerstvolgende actie: de taak die bezig is (de vroegste start), anders de eerste open taak op startdatum (zonder datum achteraan, daarna de volgorde van de lijst).
  // → null (geen taken) | { klaar: true } (alles klaar) | { id, naam, wie (slug), eind, status }
  K.volgende = function (taken) {
    const lijst = (Array.isArray(taken) ? taken : []).filter(t => t && !t._vervallen && t.soort !== 'mijlpaal');
    if (!lijst.length) return null;
    const open = lijst.filter(t => (t.status || 'todo') !== 'klaar');
    if (!open.length) return { klaar: true };
    const ymd = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : '9999-99-99');
    const idx = new Map(lijst.map((t, i) => [t, i]));
    const sorteer = a => a.slice().sort((x, y) => (ymd(x.start) < ymd(y.start) ? -1 : ymd(x.start) > ymd(y.start) ? 1 : idx.get(x) - idx.get(y)));
    const t = sorteer(open.filter(x => x.status === 'bezig'))[0] || sorteer(open)[0];
    const wie = (P() && P().taakMensen ? P().taakMensen(t)[0] : t.toegewezen) || '';
    return { id: t.id, naam: t.naam || '(zonder naam)', wie, eind: /^\d{4}-\d{2}-\d{2}$/.test(String(t.eind || '')) ? t.eind : '', status: t.status || 'todo' };
  };
  // "do 30-10" uit een datum; leeg als de datum niet geldig is
  K.dagKort = ymd => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return ''; const d = new Date(ymd + 'T12:00:00Z'); return ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'][d.getUTCDay()] + ' ' + ymd.slice(8, 10) + '-' + ymd.slice(5, 7); };
  // Uren: "19,5 / 35 u" (budget) of "19,5 u" (geen budget); minuten in, tekst uit
  K.urenTekst = (geklokt, budget) => {
    const u = m => String(Math.round((Number(m) || 0) / 6) / 10).replace('.', ',');
    return budget > 0 ? u(geklokt) + ' / ' + u(budget) + ' u' : u(geklokt) + ' u';
  };
  K.urenPct = (geklokt, budget) => (budget > 0 ? Math.max(0, Math.min(100, Math.round((Number(geklokt) || 0) / budget * 100))) : 0);
  // Is de leverdatum verstreken terwijl het project nog loopt?
  K.leverLaat = (ymd, fase, vandaag) => !!ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd < vandaag && !['afgerond', 'nacalculatie', 'factureren', 'verloren'].includes(fase || '');

  const mag = w => { try { return !!(D.mag && D.mag[w] && D.mag[w]()); } catch (e) { return false; } };
  const toast = (t, o, l, lb) => { try { if (D.toast) D.toast(t, o, l, lb); } catch (e) {} };
  const GEEN_RECHT = 'Dit mag je niet met jouw rol.';

  // ── tekenen ──
  function el(tag, o, ...kids) {
    const e = dom().createElement(tag);
    Object.keys(o || {}).forEach(k => {
      const w = o[k]; if (w === null || w === undefined || w === false) return;
      if (k === 'klass') e.className = w; else if (k === 'tekst') e.textContent = w; else if (k === 'klik') e.addEventListener('click', w);
      else if (k === 'selected' || k === 'disabled' || k === 'hidden') e[k] = !!w; else e.setAttribute(k, w === true ? '' : w);
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' ? dom().createTextNode(c) : c); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function ico(pad) {
    const s = dom().createElementNS(NS, 'svg'); [['viewBox', '0 0 24 24'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']].forEach(([k, v]) => s.setAttribute(k, v));
    const p = dom().createElementNS(NS, 'path'); p.setAttribute('d', pad); s.appendChild(p); return s;
  }
  const IC_MEER = 'M5 12h.01M12 12h.01M19 12h.01';

  function faseDeel(code) {
    const o = D.faseOpties ? D.faseOpties(code) : null; if (!o) return null;
    const kl = o.huidig.soort === 'lead' ? 'lead' : (o.huidig.soort === 'lead-eind' || o.huidig.soort === 'project-eind' ? 'eind' : 'project');
    const wrap = el('span', { klass: 'pk-fase pk-fase-' + kl }, el('span', { klass: 'pk-punt', 'aria-hidden': 'true' }));
    if (!o.kan || !o.opties.length) { wrap.appendChild(el('span', { klass: 'pk-faselabel', tekst: o.huidig.l || 'Geen fase', title: 'Projectfase' })); return wrap; }
    const sel = el('select', { klass: 'pk-sel', 'aria-label': 'Projectfase wijzigen', title: 'Projectfase: klik om te wijzigen' },
      el('option', { value: '', tekst: o.huidig.l || 'Geen fase' }), o.opties.map(x => el('option', { value: x.k, tekst: x.l })));
    sel.addEventListener('change', async () => {
      const naar = sel.value; if (!naar) return;
      if (!mag('fase')) { toast(GEEN_RECHT, null, true); sel.value = ''; return; }
      if (S.bezig) { toast('Even wachten: de vorige wijziging wordt nog opgeslagen.', null, true); sel.value = ''; return; }
      S.bezig = true; sel.disabled = true;   // één wijziging tegelijk, ook over de dialogen heen (reden bij Verloren, bevestiging bij Gewonnen)
      let r; try { r = await D.faseKies(code, naar, sel); } catch (e) { r = { ok: false, reden: 'Mislukt: ' + ((e && e.message) || e) }; } finally { S.bezig = false; sel.disabled = false; }
      if (r && r.ok === false && r.reden) toast(r.reden, null, true);
      if (r && r.ok && r.terug) toast('Projectfase: ' + r.label + '.', async () => { const h = await r.terug(); toast(h && h.ok ? 'Teruggezet.' : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !(h && h.ok)); if (D.naWijziging) D.naWijziging(); });
      if (D.naWijziging) D.naWijziging(); else K.ververs(code);
    });
    wrap.appendChild(sel); return wrap;
  }
  function leverDeel(code) {
    const l = (D.lever ? D.lever(code) : null) || {}, ymd = l.ymd || '', w = ymd && D.week ? D.week(ymd) : null;
    if (!K.dagKort(ymd)) return el('span', { klass: 'pk-lever pk-zacht', tekst: 'Lever: niet ingesteld', title: 'De leverdatum vul je in bij Gegevens' });
    const laat = K.leverLaat(ymd, l.fase, D.vandaag ? D.vandaag() : '');
    return el('span', { klass: 'pk-lever' + (laat ? ' pk-laat' : ''), title: laat ? 'De leverdatum is verstreken' : 'Leverdatum' }, 'Lever ' + K.dagKort(ymd) + (w ? ' · wk ' + w.week : ''));
  }
  function urenDeel(code) {
    const m = D.meter ? D.meter(code) : null; if (!m) return null;
    const pct = K.urenPct(m.geklokt, m.budget), sig = m.sig;
    const tekst = 'Uren ' + K.urenTekst(m.geklokt, m.budget);
    const knop = el('button', { type: 'button', klass: 'pk-uren' + (sig ? ' pk-let' : ''), title: (sig ? sig.tekst + ' ' : '') + (m.laden ? 'De uren worden opgehaald…' : (m.fout ? 'Uren uit Toggl niet beschikbaar (' + m.fout + '): lokaal gesyncte uren.' : 'Geklokt tegenover budget')) + ' Klik voor de meter.', klik: () => { if (D.naarMeter) D.naarMeter(code); } },
      (sig ? '⚠ ' : '') + tekst, m.budget > 0 ? el('span', { klass: 'pk-balk', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': pct + '% van het budget' }, el('i', { style: 'width:' + pct + '%' })) : null,
      m.laden ? el('span', { klass: 'pk-sub', tekst: 'laden…' }) : (m.fout ? el('span', { klass: 'pk-sub', tekst: 'lokaal' }) : null));
    return knop;
  }
  function volgendeDeel(code) {
    const v = D.volgende ? D.volgende(code) : null; if (!v) return null;
    if (v.klaar) return el('span', { klass: 'pk-volgende pk-zacht', tekst: 'Alle taken klaar' });
    const naam = v.wie && D.naamVan ? (D.naamVan(v.wie) || v.wie) : v.wie, dag = K.dagKort(v.eind);
    const meta = [naam, dag].filter(Boolean).join(', ');
    return el('button', { type: 'button', klass: 'pk-volgende', title: 'Open de taak', klik: ev => { if (D.openTaak) D.openTaak(code, v.id, ev.currentTarget); } }, 'Volgende: ' + v.naam + (meta ? ' (' + meta + ')' : ''));
  }
  // ⋯-menu: zeldzame en gevaarlijke acties
  function menuDeel(code) {
    const items = [{ k: 'link', l: 'Kopieer link', aan: true }, { k: 'vw', l: 'Projectgegevens voor Vectorworks', aan: mag('wijzig') }, { k: 'weg', l: 'Verwijderen…', aan: mag('wijzig'), gevaar: true }].filter(x => x.aan);
    const knop = el('button', { type: 'button', klass: 'pk-meer', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Meer acties voor dit project', title: 'Meer acties' }, ico(IC_MEER));
    const lijst = el('div', { klass: 'pk-menu', role: 'menu', hidden: true }, items.map(x => el('button', { type: 'button', role: 'menuitem', klass: 'pk-item' + (x.gevaar ? ' pk-gevaar' : ''), tekst: x.l, 'data-actie': x.k })));
    const sluit = (focus) => { lijst.hidden = true; knop.setAttribute('aria-expanded', 'false'); if (focus) knop.focus(); };
    const open = () => { lijst.hidden = false; knop.setAttribute('aria-expanded', 'true'); const e = lijst.querySelector('.pk-item'); if (e) e.focus(); };
    knop.addEventListener('click', ev => { ev.stopPropagation(); if (lijst.hidden) open(); else sluit(false); });
    lijst.addEventListener('keydown', ev => {
      const es = [...lijst.querySelectorAll('.pk-item')], i = es.indexOf(dom().activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); sluit(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); es[(i + 1) % es.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); es[(i - 1 + es.length) % es.length].focus(); }
      else if (ev.key === 'Tab') sluit(false);
    });
    lijst.addEventListener('click', async ev => {
      const b = ev.target.closest('.pk-item'); if (!b) return; ev.stopPropagation(); sluit(false);
      const a = b.getAttribute('data-actie');
      if ((a === 'vw' || a === 'weg') && !mag('wijzig')) { toast(GEEN_RECHT, null, true); return; }
      if (a === 'link' && D.kopieerLink) await D.kopieerLink(code); else if (a === 'vw' && D.vwExport) await D.vwExport(code); else if (a === 'weg' && D.verwijder) await D.verwijder(code);
    });
    if (!S.sluitKoppeld && dom().addEventListener) { S.sluitKoppeld = true; dom().addEventListener('click', () => { dom().querySelectorAll('.pk-menu').forEach(m => { if (!m.hidden) { m.hidden = true; const k = m.parentNode && m.parentNode.querySelector('.pk-meer'); if (k) k.setAttribute('aria-expanded', 'false'); } }); }); }
    return el('span', { klass: 'pk-menuwrap' }, knop, lijst);
  }

  function bouw(code) {
    const kop = el('div', { klass: 'proj-kop', 'data-code': code, role: 'group', 'aria-label': 'Projectstand' });
    [faseDeel(code), leverDeel(code), urenDeel(code), volgendeDeel(code)].forEach(x => { if (x) kop.appendChild(x); });
    kop.appendChild(menuDeel(code));
    return kop;
  }
  // In de contextbalk van het project zetten (tweede regel) en de uren laden
  K.monteer = function (code, host) {
    if (!code || !host || !host.querySelector) return false;
    const ctx = host.querySelector('.proj-ctx'); if (!ctx) return false;
    const oud = ctx.querySelector('.proj-kop'); if (oud) oud.remove();
    ctx.appendChild(bouw(code)); stijl();
    if (D.meterLaad) { try { Promise.resolve(D.meterLaad(code)).then(() => K.ververs(code), () => K.ververs(code)); } catch (e) {} }
    return true;
  };
  // Alleen het urenstuk opnieuw tekenen (na het laden); de rest blijft staan en houdt zijn focus
  K.ververs = function (code) {
    const kop = dom().querySelector('.proj-kop[data-code="' + String(code).replace(/"/g, '') + '"]'); if (!kop) return false;
    const nieuw = urenDeel(code), oud = kop.querySelector('.pk-uren');
    if (oud && nieuw) kop.replaceChild(nieuw, oud); else if (nieuw && !oud) kop.insertBefore(nieuw, kop.querySelector('.pk-volgende') || kop.querySelector('.pk-menuwrap'));
    return true;
  };

  const CSS = [
    '.proj-kop{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;min-width:0;padding-top:6px;margin-top:4px;border-top:1px solid var(--border-hair,#ece6d9);font-size:13px}.proj-kop *{min-width:0;box-sizing:border-box}',
    '.pk-fase{display:inline-flex;align-items:center;gap:6px}.pk-punt{width:9px;height:9px;border-radius:50%;background:var(--green,#2A4A38);flex:none}.pk-fase-lead .pk-punt{background:var(--gold,#B8962E)}.pk-fase-eind .pk-punt{background:var(--text-faint,#8a8f8a)}',
    '.pk-sel{font:inherit;font-size:13px;font-weight:600;color:var(--green,#2A4A38);min-height:32px;padding:2px 22px 2px 8px;border:1px solid var(--border,#dfd8cb);border-radius:6px;background:var(--surface,#fff);cursor:pointer;max-width:100%}',
    '.pk-faselabel{font-weight:600;color:var(--green,#2A4A38)}.pk-lever{white-space:nowrap}.pk-zacht{color:var(--text-faint,#8a8f8a)}.pk-laat{color:var(--gold-text,#7A6010);font-weight:600}',
    '.pk-uren,.pk-volgende{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:0;margin:0;font:inherit;font-size:13px;color:inherit;cursor:pointer;min-height:32px;text-align:left}.pk-volgende{overflow-wrap:break-word;word-break:normal;flex:1 1 200px}.pk-volgende:hover,.pk-uren:hover{text-decoration:underline}.pk-let{color:var(--gold-text,#7A6010);font-weight:600}',
    '.pk-balk{display:inline-block;width:64px;height:6px;border-radius:3px;background:var(--surface-sunken,#efe9dd);overflow:hidden;flex:none}.pk-balk i{display:block;height:100%;background:var(--green,#2A4A38)}.pk-let .pk-balk i{background:var(--gold,#B8962E)}.pk-sub{font-size:11px;color:var(--text-faint,#8a8f8a);font-weight:400}',
    '.pk-menuwrap{position:relative;margin-left:auto}.pk-meer{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;border:1px solid var(--border,#dfd8cb);border-radius:6px;background:var(--surface,#fff);color:var(--ink-3,#646a64);cursor:pointer}.pk-meer:hover{background:var(--surface-sunken,#efe9dd)}',
    '.pk-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:70;min-width:240px;max-width:calc(100vw - 24px);padding:4px;background:var(--surface-overlay,#fff);border:1px solid var(--border,#dfd8cb);border-radius:8px;box-shadow:var(--shadow-pop,0 6px 24px rgba(0,0,0,.18))}.pk-menu[hidden]{display:none}',
    '.pk-item{display:block;width:100%;text-align:left;background:none;border:0;border-radius:6px;padding:8px 10px;font:inherit;font-size:13px;color:inherit;cursor:pointer;min-height:36px}.pk-item:hover,.pk-item:focus-visible{background:var(--surface-sunken,#efe9dd);outline:none}.pk-gevaar{color:#8B1A1A;border-top:1px solid var(--border-hair,#ece6d9);border-radius:0 0 6px 6px;margin-top:2px}',
    '.pk-sel:focus-visible,.pk-uren:focus-visible,.pk-volgende:focus-visible,.pk-meer:focus-visible{outline:2px solid var(--green,#2A4A38);outline-offset:1px}',
    '@media (max-width:760px){.proj-kop{gap:4px 10px}.pk-sel,.pk-uren,.pk-volgende,.pk-meer,.pk-item{min-height:44px}.pk-meer{min-width:44px}.pk-lever{white-space:normal}.pk-volgende{flex:1 1 100%}.pk-menuwrap{margin-left:0}.pk-menu{right:auto;left:0}.pk-sel{flex:1 1 auto}}'
  ].join('\n');
  function stijl() { const d = dom(); if (!d || !d.head || d.getElementById('pk-stijl')) return; const s = d.createElement('style'); s.id = 'pk-stijl'; s.textContent = CSS; d.head.appendChild(s); }

  K.init = cfg => { D = cfg || {}; S.bezig = false; return K; };
  K._stijl = CSS;
  root.MTProjectKop = K;
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
