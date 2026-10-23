/* ============================================================================
 * mt-objectpaneel.js: één paneel voor elk soort object in de cockpit (Bart 21-10: "zo goed als alle functies op verschillende manieren kunnen bedienen")
 * ----------------------------------------------------------------------------
 * De kleine, herbruikbare basis onder het taakpaneel (mt-taakpaneel.js is de eerste objectdefinitie; later project, klant, offerte, bestelling, planblok).
 * De basis doet: de schil (rechts, telefoonbreedte vol scherm, niet-modaal), de kop (Terug, link kopiëren, sluiten), een eigen link per object (#<soort>/…) met
 * terug/vooruit en Esc, het kruimelpad van de herkomst, secties, relatie-lijsten die een ander paneel openen, en inline-bewerkbare veldtypen (tekst, notitie,
 * getal/duur via een lees-functie, keuzelijst, tags) met een eerlijke opslagstatus (Opslaan… · Opgeslagen · Niet opgeslagen + Opnieuw) en ongedaan maken in een toast.
 * Wat er opgeslagen wordt en hoe, bepaalt de objectdefinitie: de basis schrijft zelf nooit iets en kent geen opslag. Tekent met DOM-calls, nooit met opgebouwde HTML.
 *
 * Een objectdefinitie: O.registreer({ soort, label, lees(hash) → sleutel | null, href(sleutel), sleutelTekst(sleutel), model(sleutel) → { ok, … },
 *   teken(m, h) → { aria, boven: node (kruimelpad), titel: node, body: [nodes] }, schrijf(sleutel, spec, opt) → Promise<uitkomst>, herstel(wijziging, opt) → Promise<uitkomst>, naWijziging?() })
 * Uitkomst van schrijven (zelfde vorm als de taakroutes): { ok, reden?, tegelijk?, bezet?, onzeker?: Promise, noop?, wijziging?, naam? }.
 * ========================================================================== */
(function (root) {
  'use strict';
  const O = {};
  let D = null;
  const DEF = {};
  const S = { open: null, gepusht: false, terugFocus: null, status: null, achter: false, kijk: null, ruw: null };
  const START = (typeof location !== 'undefined' && location.hash) || '';   // een deeplink bij het opstarten (de cockpit zet de URL daarna naar de starttab)

  // ── bouwstenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else if (k === 'wijzig') e.addEventListener('change', v); else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function icoon(d) { const s = D.doc.createElementNS(NS, 'svg'), p = D.doc.createElementNS(NS, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'tp-ic'); p.setAttribute('d', d); s.appendChild(p); return s; }
  const IC = { terug: 'M15 6l-6 6l6 6', sluit: 'M6 6l12 12M18 6L6 18', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', pijl: 'M9 6l6 6l-6 6', let: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01', tijd: 'M3 12h18M7 8v8M17 8v8' };
  // Een gewone link: Ctrl/Shift/middelklik = nieuw tabblad (de href), een gewone klik gaat via de cockpit-route (ga)
  const link = (href, ga, kids, klass, extra) => el('a', Object.assign({ klass: klass || 'tp-link', href: href || '#', klik: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1) return; ev.preventDefault(); ga(); } }, extra || {}), kids);
  const chip = (tekst, kl, titel) => el('span', { klass: 'tp-chip' + (kl ? ' ' + kl : ''), title: titel || null, tekst });
  const rij = (label, ...waarde) => el('div', { klass: 'tp-rij' }, el('div', { klass: 'tp-label', tekst: label }), el('div', { klass: 'tp-waarde' }, waarde));
  const sectie = (id, titel, rechts, ...kids) => el('section', { klass: 'tp-sec', 'aria-labelledby': id }, el('div', { klass: 'tp-sec-kop' }, el('h3', { id, tekst: titel }), rechts || null), kids);
  // Het kruimelpad: delen = [{ kids, href, ga, titel, klass }]; elk deel is een link die het paneel laat staan in de geschiedenis (Terug opent het weer)
  function kruimels(delen) {
    const nav = el('nav', { klass: 'tp-herkomst', 'aria-label': 'Hoort bij' });
    delen.filter(Boolean).forEach((d, i) => { if (i) nav.appendChild(el('span', { klass: 'tp-sep', 'aria-hidden': 'true', tekst: '›' })); nav.appendChild(link(d.href, () => { O.sluit({ stil: true }); d.ga(); }, d.kids, 'tp-link tp-kruim' + (d.klass ? ' ' + d.klass : ''), { title: d.titel || null })); });
    return nav;
  }
  // Een relatie-lijst: items = [{ href, ga, naam, sub, dot (statusklasse), chips: [node], titel }]; klik = een ander paneel of een andere plek
  const relatieLijst = items => el('ul', { klass: 'tp-lijst' }, items.map(x => el('li', null, link(x.href, x.ga, [
    x.dot ? el('span', { klass: 'tp-dot ' + x.dot, 'aria-hidden': 'true' }) : null,
    el('span', { klass: 'tp-tekst' }, el('span', { klass: 'tp-naam', tekst: x.naam }), x.sub ? el('span', { klass: 'tp-sub', tekst: x.sub }) : null),
    x.chips || null, icoon(IC.pijl)], 'tp-link tp-taakrij', { title: x.titel || null }), x.na || null)));   // x.na: een node onder de rij (F2a: type en wachttijd van de koppeling)

  // ── opslaan: eerlijke status, ongedaan maken, geen stil verlies ──
  const toast = (tekst, ongedaan, lang, label) => { try { if (D.toast) D.toast(tekst, ongedaan, lang, label); } catch (e) {} };
  const huidigeTekst = () => S.open ? S.open.soort + ':' + DEF[S.open.soort].sleutelTekst(S.open.sleutel) : '';
  function opslagStatus(soort, tekst, opnieuw) {
    S.status = soort ? { soort, tekst, opnieuw, t: Date.now(), van: huidigeTekst() } : null;   // blijft staan als het paneel opnieuw tekent
    const z = D.doc.getElementById('tp-opslag'); if (!z) return;
    clearTimeout(opslagStatus._t); z.textContent = ''; z.className = 'tp-opslag' + (soort ? ' ' + soort : '');
    if (!soort) return;
    z.appendChild(el('span', { tekst }));
    if (opnieuw) z.appendChild(el('button', { type: 'button', klass: 'tp-knop tp-klein', klik: opnieuw, tekst: 'Opnieuw' }));
    if (soort === 'ok') opslagStatus._t = setTimeout(() => { if (z.isConnected && z.classList.contains('ok')) { z.textContent = ''; z.className = 'tp-opslag'; } }, 5000);
  }
  const opslagZone = () => el('div', { id: 'tp-opslag', klass: 'tp-opslag', role: 'status', 'aria-live': 'polite' });
  const naWijziging = () => { const d = S.open && DEF[S.open.soort]; if (d && d.naWijziging) { try { d.naWijziging(); } catch (e) {} } };
  // Opnieuw tekenen, maar niet midden in het typen van een tekstveld (dat gebeurt dan zodra de focus het veld verlaat)
  // Elk invoerveld telt (ook een datumveld: een half getypte datum mag niet onder je vingers verdwijnen); knoppen, vinkjes en keuzelijsten niet (die slaan meteen op)
  O.bezigMetBewerken = () => { const a = D.doc.activeElement, p = D.doc.getElementById('tp-paneel'); return !!(p && a && p.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(a.type || '')))); };
  const tekenVeilig = () => { if (O.bezigMetBewerken()) S.achter = true; else O.teken(); };
  // Eén wijziging opslaan via de objectdefinitie. spec = { velden, gezien, … }; wat = korte omschrijving voor de melding ("naam", "status klaar").
  async function bewaar(spec, wat) {
    if (!S.open) return false;
    const soort = S.open.soort, sleutel = S.open.sleutel, def = DEF[soort], van = huidigeTekst();
    if (!def.schrijf) return false;
    opslagStatus('bezig', 'Opslaan…');
    let r; try { r = await def.schrijf(sleutel, spec, { traag: () => opslagStatus('bezig', 'Opslaan duurt lang, even geduld…') }); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
    const zelfde = huidigeTekst() === van;
    if (r && r.onzeker) {
      if (zelfde) opslagStatus('fout', r.reden);
      Promise.resolve(r.onzeker).then(u => { O.ververs(); naWijziging(); toast((u && u.tekst) || 'Open het opnieuw om te zien of het opslaan gelukt is.', null, true); }, () => toast('Ik kon niet vaststellen of het opslaan gelukt is.', null, true));
      return false;
    }
    if (!r || !r.ok) {
      tekenVeilig();   // de velden tonen weer wat er echt staat (bij "tegelijk" de nieuwe stand)
      const invoer = Object.values(spec.velden || {}).find(v => typeof v === 'string' && v.trim().length > 2);   // getypte tekst gaat nooit stil verloren: hij staat in de melding, en Opnieuw stuurt hem nog eens
      if (zelfde) opslagStatus(r && r.tegelijk ? 'let' : 'fout', ((r && r.reden) || 'Niet opgeslagen.') + (invoer ? ' Jouw invoer: "' + (invoer.length > 120 ? invoer.slice(0, 120) + '…' : invoer) + '"' : ''), r && r.tegelijk ? null : () => bewaar(spec, wat));
      return false;
    }
    if (r.noop) { tekenVeilig(); return true; }
    tekenVeilig(); naWijziging();
    if (r.tegelijk) { opslagStatus('let', r.tegelijk); toast(r.tegelijk, null, true); return false; }
    opslagStatus('ok', 'Opgeslagen');
    const w = r.wijziging;
    if (w && def.herstel) toast((r.naam || w.naam || def.label) + ': ' + wat + ' opgeslagen.', async () => {
      let h; try { h = await def.herstel(w, {}); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      O.ververs(); naWijziging();
      if (h && h.onzeker) { toast(h.reden, null, true); Promise.resolve(h.onzeker).then(u => { O.ververs(); toast((u && u.tekst) || 'Open het opnieuw om te zien of het terugzetten gelukt is.', null, true); }); return; }
      toast(h && h.ok ? (h.tegelijk || 'Teruggezet.') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && (h.tegelijk || !h.ok)));
    });
    return true;
  }

  // ── veldtypen (alle: Enter of wegklikken = opslaan, Esc = terug naar wat er stond; een tweede Esc sluit het paneel) ──
  const GEEN_RECHT = 'Dit mag je niet met jouw rol (kantoor beslist).';
  // Tekst, notitie (multi) of getal/duur (lees: tekst → waarde of null = ongeldig). o = { kan, label, klass, multi, placeholder, inputmode, lees, fout, gezien, wat, titel, waarom }
  function tekstVeld(veld, waarde, o) {
    o = o || {};
    const kan = o.kan !== false, opties = { id: 'tp-v-' + veld, klass: 'tp-invoer' + (o.klass ? ' ' + o.klass : ''), 'aria-label': o.label, disabled: kan ? null : true, title: kan ? (o.titel || null) : (o.waarom || GEEN_RECHT), autocomplete: 'off', spellcheck: o.multi ? 'true' : 'false', placeholder: o.placeholder || null };
    const e = o.multi ? el('textarea', Object.assign({ rows: '3' }, opties)) : el('input', Object.assign({ type: 'text', inputmode: o.inputmode || null }, opties));
    e.value = waarde; let begin = waarde, klaar = false;
    e.addEventListener('focus', () => { begin = e.value; klaar = false; });
    const opslaan = () => {
      if (klaar) return; klaar = true;
      const nieuw = o.multi ? e.value : e.value.trim();
      if (nieuw === begin) return;
      const w = o.lees ? o.lees(nieuw) : nieuw;
      if (w === null) { opslagStatus('fout', o.fout || 'Ongeldige invoer; er is niets gewijzigd.'); e.value = begin; return; }
      const velden = {}; velden[veld] = w; const gezien = {}; gezien[veld] = o.gezien !== undefined ? o.gezien : begin;
      bewaar({ velden, gezien }, o.wat || veld);
    };
    e.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { if (e.value !== begin) { ev.preventDefault(); ev.stopPropagation(); e.value = begin; klaar = true; e.blur(); klaar = false; } return; }
      if (ev.key === 'Enter' && (!o.multi || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); opslaan(); e.blur(); }
    });
    e.addEventListener('blur', () => { opslaan(); klaar = false; });
    return e;
  }
  // Een keuzelijst (persoon, status, bucket/fase, activiteit …): kiezen = meteen opslaan. opties = [[waarde, label]]
  function keuzeVeld(veld, waarde, opties, o) {
    o = o || {};
    const kan = o.kan !== false;
    const s = el('select', { id: 'tp-v-' + veld, klass: 'tp-invoer tp-keuze', 'aria-label': o.label, disabled: kan ? null : true, title: kan ? (o.titel || null) : (o.waarom || GEEN_RECHT) },
      opties.map(([w, l]) => el('option', { value: w, tekst: l })));
    s.value = waarde;
    s.addEventListener('change', () => { const velden = {}; velden[veld] = s.value; const gezien = {}; gezien[veld] = o.gezien !== undefined ? o.gezien : waarde; bewaar({ velden, gezien }, o.wat || veld); });   // o.gezien: de ruwe opgeslagen waarde als die anders is dan de getoonde (fase: de naam op de taak, het label kan intussen anders heten)
    return s;
  }
  // Tags (meer waarden): een × per tag haalt hem weg, typen + Enter voegt toe (met suggesties). Slaat de hele lijst op, met de oude lijst als "gezien".
  function tagsVeld(veld, lijst, o) {
    o = o || {};
    const kan = o.kan !== false, oud = (lijst || []).slice(), lid = 'tp-v-' + veld + '-lijst';
    const zet = nieuw => { const velden = {}; velden[veld] = nieuw; const gezien = {}; gezien[veld] = oud; return bewaar({ velden, gezien }, o.wat || veld); };
    const tags = oud.map(t => el('span', { klass: 'tp-tag' }, t, kan ? el('button', { type: 'button', klass: 'tp-tag-weg', 'aria-label': 'Tag ' + t + ' weghalen', title: 'Weghalen', klik: () => zet(oud.filter(x => x !== t)), tekst: '×' }) : null));
    const invoer = kan ? el('input', { type: 'text', id: 'tp-v-' + veld, klass: 'tp-invoer tp-tag-invoer', 'aria-label': (o.label || 'Tags') + ': toevoegen', placeholder: o.placeholder || 'Tag toevoegen…', list: o.suggesties ? lid : null, autocomplete: 'off' }) : null;
    if (invoer) invoer.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); const t = invoer.value.replace(/\s+/g, ' ').trim(); if (t && !oud.some(x => x.toLowerCase() === t.toLowerCase())) { invoer.value = ''; try { invoer.blur(); } catch (e) { } zet(oud.concat([t])).then(() => { const n = D.doc.getElementById('tp-v-' + veld); if (n) n.focus(); }); } invoer.value = ''; }   // blur: anders tekent het paneel pas opnieuw als je het veld verlaat; daarna staat de cursor weer in het veld
      else if (ev.key === 'Escape' && invoer.value) { ev.preventDefault(); ev.stopPropagation(); invoer.value = ''; }
    });
    return el('div', { klass: 'tp-tags', title: kan ? null : (o.waarom || GEEN_RECHT) }, tags, tags.length || kan ? null : el('span', { klass: 'tp-sub', tekst: 'Geen tags' }), invoer,
      o.suggesties && invoer ? el('datalist', { id: lid }, o.suggesties.map(s => el('option', { value: s }))) : null);
  }

  // ── de schil ──
  function paneelEl() {
    let p = D.doc.getElementById('tp-paneel');
    if (!p) {
      if (!D.doc.getElementById('tp-stijl')) { const s = el('style', { id: 'tp-stijl' }); s.textContent = O.STIJL.join('\n'); D.doc.head.appendChild(s); }
      p = el('aside', { id: 'tp-paneel', klass: 'tp-paneel', role: 'dialog', 'aria-modal': 'false', tabindex: '-1', hidden: true });
      p.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); O.sluit(); } });
      p.addEventListener('focusout', () => setTimeout(() => { if (S.open && S.achter && !O.bezigMetBewerken()) O.teken(); }, 300));   // een uitgestelde hertekening (er werd getypt) nu alsnog
      D.doc.body.appendChild(p);
    }
    return p;
  }
  O.paneelEl = paneelEl;
  function kop(def, sleutel) {
    const knop = (label, ic, klik, kl) => el('button', { type: 'button', klass: 'tp-knop icoon' + (kl ? ' ' + kl : ''), 'aria-label': label, title: label, klik }, icoon(ic));
    return el('div', { klass: 'tp-kop' },
      el('button', { type: 'button', klass: 'tp-knop tp-terug', klik: () => O.sluit(), title: 'Terug naar waar je was' }, icoon(IC.terug), 'Terug'),
      el('span', { klass: 'tp-kop-titel', tekst: def.label }),
      knop('Link kopiëren', IC.link, () => kopieerLink(def.href(sleutel))),
      knop('Sluiten', IC.sluit, () => O.sluit(), 'tp-sluit'));
  }
  async function kopieerLink(h) {
    let url = ''; try { url = String(location.href).split('#')[0] + h; } catch (e) { url = h; }
    let ok = false; try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch (e) { ok = false; }
    toast(ok ? 'Link gekopieerd.' : 'Kopiëren lukte niet. De link staat in de adresbalk.');
  }
  // De hulpjes die een objectdefinitie in teken() krijgt
  const H = { el, icoon, IC, link, chip, rij, sectie, kruimels, relatieLijst, tekstVeld, keuzeVeld, tagsVeld, opslagZone, opslagStatus, bewaar, tekenVeilig, toast, GEEN_RECHT,
    open: (soort, sleutel, o) => O.open(soort, sleutel, o), sluit: o => O.sluit(o), naWijziging, get dialoog() { return D && D.dialoog; } };
  O.H = H;

  O.teken = function () {
    if (!S.open) return;
    const def = DEF[S.open.soort], p = paneelEl(), m = def.model(S.open.sleutel), id = huidigeTekst();
    const oudBody = p.querySelector('.tp-body'), zelfde = p.getAttribute('data-object') === id, scroll = oudBody && zelfde ? oudBody.scrollTop : 0;
    const focusId = zelfde && D.doc.activeElement && p.contains(D.doc.activeElement) ? D.doc.activeElement.id : '';
    p.setAttribute('data-object', id); p.setAttribute('data-soort', S.open.soort);
    S.achter = false; p.textContent = '';
    const uit = def.teken(m, H) || {};
    if (m && m.sleutel) S.open.sleutel = m.sleutel;   // de definitie kan de sleutel netjes maken (bv. de juiste hoofdletters van de projectcode)
    p.setAttribute('aria-label', uit.aria || def.label);
    p.appendChild(kop(def, S.open.sleutel)); p.appendChild(el('div', { klass: 'tp-body' }, uit.boven || null, uit.titel || null, uit.body || []));   // boven: het kruimelpad van de herkomst
    const b = p.querySelector('.tp-body'); if (b && scroll) b.scrollTop = scroll;
    if (focusId) { const f = D.doc.getElementById(focusId); if (f && f.focus) try { f.focus({ preventScroll: true }); } catch (e) {} }
    const s = S.status; if (s && s.van === huidigeTekst() && (s.soort !== 'ok' || Date.now() - s.t < 5000)) opslagStatus(s.soort, s.tekst, s.opnieuw);
  };

  // ── openen en sluiten ──
  // o = { push (standaard true): een eigen geschiedenisregel, zodat Terug het paneel sluit; vanRoute: de URL is al goed (terug/vooruit, deeplink); terug: het element dat de focus terugkrijgt }
  O.open = function (soort, sleutel, o) {
    o = o || {}; const def = DEF[soort]; if (!def || !sleutel) return false;
    const wasOpen = !!S.open;
    if (!wasOpen) S.terugFocus = o.terug || (D.doc.activeElement && D.doc.activeElement !== D.doc.body ? D.doc.activeElement : null);
    else if (o.terug) S.terugFocus = o.terug;
    S.open = { soort, sleutel };
    const p = paneelEl(); p.hidden = false;
    try { D.doc.documentElement.classList.add('tp-open'); } catch (e) {}
    O.teken();
    // Zolang het paneel open is: kijken of de gegevens veranderden (een ander apparaat, de sync, een ander scherm) en dan opnieuw tekenen
    if (!S.kijk) { S.ruw = ruwNu(); S.kijk = setInterval(() => { if (!S.open) return; const r = ruwNu(); if (r !== S.ruw) { S.ruw = r; if (!O.bezigMetBewerken()) O.teken(); else S.achter = true; } }, 2000); }
    if (!o.vanRoute) {
      const h = def.href(S.open.sleutel);
      try { if (location.hash !== h) { if (wasOpen || o.push === false) history.replaceState(null, '', h); else { history.pushState(null, '', h); S.gepusht = true; } } } catch (e) {}
    }
    try { const t = p.querySelector('#tp-titel'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } } catch (e) {}
    // Een melding voor wie meekijkt (de planningsfilterbalk markeert de geopende taak in elke weergave); zonder luisteraar gebeurt er niets
    try { if (typeof root.CustomEvent === 'function' && D.doc.dispatchEvent) D.doc.dispatchEvent(new root.CustomEvent('mt-paneel-open', { detail: { soort, sleutel } })); } catch (e) {}
    return true;
  };
  const ruwNu = () => { const d = S.open && DEF[S.open.soort]; try { return d && d.ruw ? d.ruw() : ''; } catch (e) { return ''; } };
  // Verbergen zonder de geschiedenis aan te raken (terug/vooruit of een navigatie naar elders)
  function verberg() {
    if (S.kijk) { clearInterval(S.kijk); S.kijk = null; }
    const p = D.doc.getElementById('tp-paneel'); if (p) { p.hidden = true; p.textContent = ''; p.removeAttribute('data-object'); }
    try { D.doc.documentElement.classList.remove('tp-open'); } catch (e) {}
    const f = S.terugFocus; S.open = null; S.terugFocus = null;
    if (f && f.isConnected && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) {} }
  }
  const routeVan = hash => { for (const soort of Object.keys(DEF)) { let k = null; try { k = DEF[soort].lees(hash); } catch (e) { k = null; } if (k) return { soort, sleutel: k }; } return null; };
  // o.stil: we gaan meteen naar een andere plek (project, klant): de paneel-regel blijft in de geschiedenis staan, zodat Terug het paneel weer opent
  O.sluit = function (o) {
    o = o || {};
    if (!S.open) return;
    const eigen = !!routeVan(location.hash), gepusht = S.gepusht; S.gepusht = false;
    verberg();
    if (o.stil || !eigen) return;
    try { if (gepusht) history.back(); else history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  };
  O.isOpen = soort => !!S.open && (!soort || S.open.soort === soort);
  O.huidig = () => S.open ? { soort: S.open.soort, sleutel: S.open.sleutel } : null;
  // Na een wijziging (ook door een ander apparaat): opnieuw tekenen als het paneel open staat
  O.ververs = function () { if (!S.open) return; clearTimeout(O.ververs._t); O.ververs._t = setTimeout(() => { if (S.open) tekenVeilig(); }, 120); };

  function volgRoute() {
    const r = routeVan(location.hash);
    if (r) { const def = DEF[r.soort]; if (!S.open || S.open.soort !== r.soort || def.sleutelTekst(S.open.sleutel).toLowerCase() !== def.sleutelTekst(r.sleutel).toLowerCase()) O.open(r.soort, r.sleutel, { vanRoute: true }); return; }
    if (S.open) { S.gepusht = false; verberg(); }
  }
  // Een deeplink bij het opstarten: wachten tot de definitie zegt dat de gegevens er zijn (maximaal twee minuten), dan openen boven de starttab
  function startLink(def) {
    let k = null; try { k = def.lees(START); } catch (e) { k = null; }
    if (!k) return;
    const t0 = Date.now();
    const poging = () => { if (S.open) return; if (def.klaar && !def.klaar() && Date.now() - t0 < 120000) { setTimeout(poging, 500); return; } O.open(def.soort, k); };
    setTimeout(poging, 300);
  }
  O.registreer = function (def) { DEF[def.soort] = def; if (D && def.startLink !== false) startLink(def); return O; };
  O.init = function (deps) {
    D = deps;
    if (!O._luistert && typeof root.addEventListener === 'function' && D.doc) {
      O._luistert = true; root.addEventListener('popstate', volgRoute); root.addEventListener('hashchange', volgRoute);
      // Esc sluit het paneel ook als de focus net ernaast staat (geen globale sneltoets: alleen zolang het paneel open is, niet in een veld en niet als er een dialoog open staat)
      D.doc.addEventListener('keydown', ev => {
        if (!S.open || ev.key !== 'Escape' || ev.defaultPrevented) return;
        const p = D.doc.getElementById('tp-paneel'), doel = ev.target;
        if (!p || (doel && p.contains(doel)) || D.doc.querySelector('dialog[open]')) return;
        if (doel && (/^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName) || doel.isContentEditable)) return;
        O.sluit();
      });
    }
    return O;
  };
  O.S = S;

  // De stijl staat onder #tp-paneel, zodat de algemene veldstijl van de cockpit de paneelvelden niet overschrijft
  O.STIJL = [
    '.tp-paneel{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);z-index:150;display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#1b211e);border-left:1px solid var(--line,#dfd8cb);box-shadow:-12px 0 40px rgba(40,34,20,.14);font:400 14px/20px var(--sans,system-ui,sans-serif)}',
    '.tp-paneel[hidden]{display:none}',
    '@media (prefers-reduced-motion:no-preference){.tp-paneel:not([hidden]){animation:tp-in .16s ease-out}@keyframes tp-in{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}}',
    '@media (max-width:760px){.tp-paneel{width:100vw;border-left:0}}',
    '#tp-paneel .tp-kop{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line,#dfd8cb);flex:0 0 auto}',
    '#tp-paneel .tp-kop-titel{flex:1;font:600 12px/16px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#646a64);text-align:center}',
    '#tp-paneel .tp-knop{height:32px;min-width:32px;padding:0 10px;border:1px solid var(--line-strong,#9a917f);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1b211e);font:500 13px/18px var(--sans,system-ui);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
    '#tp-paneel .tp-knop.icoon{padding:0;width:32px;border-color:transparent}#tp-paneel .tp-knop:hover{background:var(--surface-sunken,#f1ede5)}',
    '#tp-paneel .tp-knop:focus-visible,#tp-paneel .tp-link:focus-visible,.tp-paneel [tabindex]:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:2px}',
    '#tp-paneel .tp-ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}',
    '#tp-paneel .tp-body{flex:1;overflow:auto;padding:14px 18px 28px}',
    '#tp-paneel .tp-herkomst{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:13px;margin-bottom:8px}',
    '#tp-paneel .tp-sep{color:var(--ink-3,#646a64)}',
    '#tp-paneel .tp-link{color:var(--primary,#17643f);text-decoration:none;border-radius:3px}#tp-paneel .tp-link:hover{text-decoration:underline}',
    '#tp-paneel .tp-kruim{color:var(--ink-2,#596059)}#tp-paneel .tp-kruim-project{color:var(--primary,#17643f);font-weight:600}',
    '#tp-paneel .tp-code{font:500 12px var(--mono,monospace);color:var(--ink-3,#646a64)}',
    '#tp-paneel .tp-titel{font:600 20px/26px var(--serif,var(--sans,system-ui));margin:4px 0 8px;outline:none}',
    '#tp-paneel .tp-statusrij{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}',
    '#tp-paneel .tp-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;background:var(--surface-sunken,#f1ede5);color:var(--ink-2,#596059);font:500 12px/22px var(--sans,system-ui);white-space:nowrap}',
    '#tp-paneel .tp-st-open{background:var(--surface-sunken,#f1ede5);color:var(--ink-2,#596059)}#tp-paneel .tp-st-bezig{background:var(--info-50,#e6edf3);color:var(--info,#3e5c76)}#tp-paneel .tp-st-wacht{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}#tp-paneel .tp-st-klaar{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}',
    '#tp-paneel .tp-chip-voorstel{background:var(--brass-soft,#fbefd2);color:var(--brass-ink,#6b4c05)}#tp-paneel .tp-chip-let{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}',
    '#tp-paneel .tp-bst-nodig{background:var(--error-50,#fce6e4);color:var(--error,#c4322a)}#tp-paneel .tp-bst-besteld{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}#tp-paneel .tp-bst-geleverd{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}',
    '#tp-paneel .tp-velden{border-top:1px solid var(--line,#dfd8cb);padding-top:6px}',
    '#tp-paneel .tp-rij{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px;align-items:start;padding:6px 0;border-bottom:1px solid var(--border-hair,#ece7de)}',
    '#tp-paneel .tp-label{font-size:12px;color:var(--ink-3,#646a64);padding-top:6px}',
    '#tp-paneel .tp-waarde{min-width:0}#tp-paneel .tp-tekstwaarde{display:block;padding:6px 0}',
    '#tp-paneel .tp-sec{margin-top:18px}#tp-paneel .tp-sec-kop,#tp-paneel .tp-details>summary{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '#tp-paneel .tp-sec h3{font:600 12px/16px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#646a64);margin:0}',
    '#tp-paneel .tp-details>summary{cursor:pointer;list-style:none}#tp-paneel .tp-details>summary::-webkit-details-marker{display:none}#tp-paneel .tp-details>summary::before{content:"▸";color:var(--ink-3,#646a64);font-size:12px}#tp-paneel .tp-details[open]>summary::before{content:"▾"}#tp-paneel .tp-details>summary h3{flex:1}',
    '#tp-paneel .tp-teller{font:500 12px var(--mono,monospace);color:var(--ink-3,#646a64);white-space:nowrap}',
    '#tp-paneel .tp-subkop{font-size:12px;color:var(--ink-3,#646a64);margin:8px 0 4px}',
    '#tp-paneel .tp-lijst{list-style:none;margin:0;padding:0}#tp-paneel .tp-lijst li{border-top:1px solid var(--border-hair,#ece7de)}#tp-paneel .tp-lijst li:first-child{border-top:0}',
    '#tp-paneel .tp-taakrij{display:flex;align-items:center;gap:10px;padding:7px 4px;color:inherit}#tp-paneel .tp-taakrij:hover{background:var(--surface-sunken,#f1ede5);text-decoration:none}',
    '#tp-paneel .tp-tekst{flex:1;min-width:0;display:flex;flex-direction:column}#tp-paneel .tp-naam{font-weight:500;overflow-wrap:anywhere}#tp-paneel .tp-sub{font-size:12px;color:var(--ink-3,#646a64)}',
    '#tp-paneel .tp-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;border:2px solid var(--line-strong,#9a917f)}#tp-paneel .tp-dot.tp-st-bezig{border-color:var(--info,#3e5c76);background:var(--info-50,#e6edf3)}#tp-paneel .tp-dot.tp-st-wacht{border-color:var(--warning,#8f5508)}#tp-paneel .tp-dot.tp-st-klaar{border-color:var(--success,#1a6e3b);background:var(--success,#1a6e3b)}',
    '#tp-paneel .tp-waarsch{display:flex;gap:8px;margin-top:8px;padding:8px 10px;border-radius:4px;background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508);font-size:13px}',
    '#tp-paneel .tp-leeg{color:var(--ink-3,#646a64);font-size:13px;margin:4px 0}',
    '#tp-paneel .tp-acties{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
    '#tp-paneel .tp-knoplink{display:inline-flex;align-items:center;height:30px;padding:0 10px;border:1px solid var(--line,#dfd8cb);border-radius:4px;font-size:13px}',
    'html:not([data-stijl="nieuw"]) .cn-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:4px;background:#1b211e;color:#fff;font:500 13px/18px system-ui,sans-serif;z-index:200;max-width:min(720px,calc(100vw - 32px))}html:not([data-stijl="nieuw"]) .cn-toast button{background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px;cursor:pointer}',
    '#tp-paneel .tp-meta{margin-top:18px;padding-top:10px;border-top:1px solid var(--line,#dfd8cb);font-size:12px;color:var(--ink-3,#646a64)}#tp-paneel .tp-meta-regel{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px}#tp-paneel .tp-onder{margin-top:14px}',
    '#tp-paneel .tp-invoer{width:100%;box-sizing:border-box;min-height:34px;padding:6px 8px;border:1px solid transparent;border-radius:4px;background-color:transparent;color:inherit;font:inherit;transition:border-color .12s,background .12s}',
    '#tp-paneel .tp-invoer:hover:not(:disabled){border-color:var(--line,#dfd8cb);background-color:var(--surface,#fff)}#tp-paneel .tp-invoer:focus{outline:none;border-color:var(--primary,#17643f);background-color:var(--surface,#fff);box-shadow:var(--focus-ring,0 0 0 3px rgba(23,100,63,.2))}',
    '#tp-paneel .tp-invoer:disabled{color:inherit;opacity:1;cursor:default}#tp-paneel select.tp-invoer{border-color:var(--line,#dfd8cb);cursor:pointer;background-color:var(--surface,#fff)}#tp-paneel select.tp-invoer:disabled{border-color:transparent;appearance:none;-webkit-appearance:none;background:transparent}',
    '#tp-paneel textarea.tp-invoer{resize:vertical;min-height:64px;line-height:20px}#tp-paneel textarea.tp-invoer:placeholder-shown,#tp-paneel input.tp-invoer:placeholder-shown{border-color:var(--border-hair,#ece7de)}',
    '#tp-paneel .tp-titel .tp-titelinvoer{font:600 20px/26px var(--serif,var(--sans,system-ui));padding:4px 6px;margin-left:-7px;width:calc(100% + 7px)}',
    '#tp-paneel .tp-inline{display:flex;align-items:center;gap:8px}#tp-paneel .tp-kort{width:90px;flex:0 0 auto;border-color:var(--line,#dfd8cb)}',
    '#tp-paneel .tp-datums{display:flex;flex-wrap:wrap;align-items:center;gap:6px}#tp-paneel .tp-datum{width:auto;flex:0 1 150px;border-color:var(--line,#dfd8cb)}#tp-paneel .tp-uitleg{flex-basis:100%}',
    '#tp-paneel .tp-statusknoppen{display:inline-flex;border:1px solid var(--line-strong,#9a917f);border-radius:4px;overflow:hidden}',
    '#tp-paneel .tp-stknop{height:32px;padding:0 12px;border:0;border-left:1px solid var(--line,#dfd8cb);background:var(--surface,#fff);color:var(--ink-2,#596059);font:500 13px/18px var(--sans,system-ui);cursor:pointer}#tp-paneel .tp-stknop:first-child{border-left:0}',
    '#tp-paneel .tp-stknop:hover:not(:disabled){background:var(--surface-sunken,#f1ede5)}#tp-paneel .tp-stknop:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:-2px}#tp-paneel .tp-stknop:disabled{cursor:default}',
    '#tp-paneel .tp-stknop.aan.tp-st-open{background:var(--n-200,#ece7de);color:var(--ink,#1b211e)}#tp-paneel .tp-stknop.aan.tp-st-bezig{background:var(--info-50,#e6edf3);color:var(--info,#3e5c76)}#tp-paneel .tp-stknop.aan.tp-st-wacht{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}#tp-paneel .tp-stknop.aan.tp-st-klaar{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}#tp-paneel .tp-stknop.aan{font-weight:600}',
    '#tp-paneel .tp-wachtreden{margin:-6px 0 8px}',
    '#tp-paneel .tp-opslag{min-height:20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;margin:-4px 0 6px;color:var(--ink-3,#646a64)}#tp-paneel .tp-opslag.ok{color:var(--success,#1a6e3b)}#tp-paneel .tp-opslag.ok span::before{content:"✓ "}#tp-paneel .tp-opslag.fout{color:var(--error,#c4322a)}#tp-paneel .tp-opslag.let{color:var(--warning,#8f5508)}',
    '#tp-paneel .tp-klein{height:28px;padding:0 10px;font-size:12px}#tp-paneel .tp-gevaar{color:var(--error,#c4322a);border-color:var(--error,#c4322a)}',
    '#tp-paneel .tp-meldingen{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}#tp-paneel .tp-melding{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-radius:4px;font-size:13px}#tp-paneel .tp-voorstel{background:var(--brass-soft,#fbefd2);color:var(--brass-ink,#6b4c05)}#tp-paneel .tp-conflict{background:var(--error-50,#fce6e4);color:var(--error,#c4322a)}',
    '#tp-paneel .tp-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px}#tp-paneel .tp-tag{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 4px 0 8px;border-radius:4px;background:var(--surface-sunken,#f1ede5);font-size:12px}#tp-paneel .tp-tag-weg{border:0;background:transparent;cursor:pointer;color:var(--ink-3,#646a64);font-size:15px;line-height:1;padding:0 4px}#tp-paneel .tp-tag-invoer{flex:1 1 120px;min-width:120px}',
    '.tp-naamlink{color:inherit;text-decoration:underline;text-decoration-color:var(--line,#dfd8cb);text-underline-offset:3px}.tp-naamlink:hover{color:var(--primary,#17643f);text-decoration-color:currentColor}'
  ];

  root.MTObjectPaneel = O;
  if (typeof module !== 'undefined' && module.exports) module.exports = O;
})(typeof window !== 'undefined' ? window : globalThis);
