/* ============================================================================
 * mt-projectpaneel.js: de projectgegevens in het objectpaneel (samenhang S2)
 * ----------------------------------------------------------------------------
 * Het knopje "Gegevens" in de projectkop opent rechts hetzelfde paneel als bij een taak (mt-objectpaneel.js). Eigen link #projectgegevens/<code>.
 * Inhoud: de projectgegevens (projectleider, onderdeel, leverdatum, aanhef, naam, adres) met de voorstellen uit Moneybird en de planning, en voor een lead de leadgegevens
 * (volgende actie, waarde, kans, beslisdatum, "Gewonnen → project"). Een veld bewerk je op de plek zelf: Enter of wegklikken = opslaan, Esc = terug.
 * Schrijven gaat ALLEEN via de bestaande functies van het projectscherm (D.gegevensZet = projGegevensZet, D.leadVeldZet = leadVeldZet: per veld een stempel, samenvoegen
 * per veld, zichtbaar conflict); dit bestand kent geen opslag. Ongedaan maken voor projectvelden bestaat nog niet (eigen ontwerp met een herstelkopie, geen belofte van S2).
 * Een tegelijk gewijzigd veld toont de bestaande conflictmelding met Houden en Andere waarde nemen. Rol zonder recht ziet de waarden, maar geen invoer.
 * model() komt van buiten (D.model), zodat dit bestand geen kennis van het projectscherm nodig heeft. Tekent met DOM-calls, nooit met opgebouwde HTML.
 * ========================================================================== */
(function (root) {
  'use strict';
  const PP = {};
  let D = null, O = null;
  const SOORT = 'projectgegevens';

  PP.href = code => '#projectgegevens/' + encodeURIComponent(String(code));
  PP.leesHash = hash => { const m = /^#?projectgegevens\/([^/#?]+)$/.exec(String(hash == null ? '' : hash).trim()); if (!m) return null; try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } };

  const GEEN = 'Dit mag je niet met jouw rol (kantoor beslist).';
  // Een veldwaarde in de spec: g.<veld> = projectgegevens, l.<veld> = leadgegevens
  PP.splits = sleutel => { const m = /^(g|l)\.(.+)$/.exec(String(sleutel || '')); return m ? { soort: m[1], veld: m[2] } : null; };

  // ── tekenen ──
  function herkomst(m, h) {
    const pr = m.project; if (!pr) return null;
    const hr = D.href || {}, g = D.ga || {};
    return h.kruimels([
      pr.klant ? { kids: pr.klantNaam || pr.klant, href: hr.klant ? hr.klant(pr.klant) : '#', ga: () => g.klant(pr.klant), titel: 'Naar de klant' } : null,
      pr.klant && pr.loc ? { kids: pr.locNaam || pr.loc, href: hr.klant ? hr.klant(pr.klant, pr.loc) : '#', ga: () => g.klant(pr.klant, pr.loc), titel: 'Naar de locatie' } : null,
      { kids: [pr.nummer ? h.el('span', { klass: 'tp-code', tekst: pr.nummer }) : null, pr.nummer ? ' ' : '', pr.naam || m.code], href: hr.project ? hr.project(m.code) : '#', ga: () => g.project(m.code, 'overzicht'), titel: 'Naar het project', klass: 'tp-kruim-project' }]);
  }
  // Een datumveld: Enter of wegklikken = opslaan, Esc = terug (zelfde gedrag als de datums in het taakpaneel)
  function datumVeld(h, sleutel, waarde, o) {
    const kan = o.kan !== false;
    const i = h.el('input', { type: 'date', id: 'tp-v-' + sleutel, klass: 'tp-invoer tp-datum', 'aria-label': o.label, value: waarde || '', disabled: kan ? null : true, title: kan ? (o.titel || null) : GEEN });
    let begin = waarde || '', klaar = false;
    i.addEventListener('focus', () => { begin = i.value; klaar = false; });
    i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); i.blur(); } else if (ev.key === 'Escape' && i.value !== begin) { ev.preventDefault(); ev.stopPropagation(); i.value = begin; klaar = true; i.blur(); klaar = false; } });
    i.addEventListener('blur', () => { if (klaar) return; if (i.value === begin) return; const velden = {}, gezien = {}; velden[sleutel] = i.value; gezien[sleutel] = begin; h.bewaar({ velden, gezien }, o.wat || o.label.toLowerCase()); });
    return i;
  }
  const conflictBlok = (h, m, c) => h.el('div', { klass: 'tp-melding tp-conflict', role: 'alert' },
    h.el('span', { tekst: c.label.charAt(0).toUpperCase() + c.label.slice(1) + ' is tegelijk gewijzigd' + (c.door ? ' door ' + c.door : '') + ': nu „' + c.nu + '”, de andere waarde was „' + c.andere + '”.' }),
    m.kan ? h.el('span', { klass: 'tp-acties' },
      h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Houden', klik: async () => { await D.conflictKies(m.code, c.veld, false); h.naWijziging(); } }),
      h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Andere waarde nemen', klik: async () => { await D.conflictKies(m.code, c.veld, true); h.naWijziging(); } })) : null);

  function gegevens(m, h) {
    const kan = m.kan, kids = [];
    m.conflicten.filter(c => c.gegevens).forEach(c => kids.push(conflictBlok(h, m, c)));
    const rijen = m.velden.map(f => {
      const sl = 'g.' + f.k;
      let veld;
      if (f.keuzes) veld = h.keuzeVeld(sl, f.waarde, [['', f.voorstel ? 'voorstel: ' + f.voorstel : '—']].concat(f.keuzes.map(x => [x, x])), { kan, label: f.l, wat: f.l.toLowerCase() });
      else if (f.type === 'datum') veld = datumVeld(h, sl, f.waarde, { kan, label: f.l, wat: 'leverdatum' });
      else veld = h.tekstVeld(sl, f.waarde, { kan, label: f.l, placeholder: f.voorstel ? 'voorstel: ' + f.voorstel : '', wat: f.l.toLowerCase(), titel: 'Enter of wegklikken = opslaan, Esc = terug' });
      return h.rij(f.l, veld);
    });
    kids.push(h.el('div', { klass: 'tp-velden' }, rijen));
    if (m.week) kids.push(h.el('div', { klass: 'tp-sub', tekst: 'Levering in week ' + m.week.week + ' van ' + m.week.jaar }));
    const acties = [];
    if (kan && m.voorstelN) acties.push(h.el('button', { type: 'button', klass: 'tp-knop tp-klein', id: 'pg-voorstel', title: m.voorstelTitel, tekst: 'Voorstellen invullen (' + m.voorstelN + ')', klik: async () => { await D.voorstelIn(m.code); h.naWijziging(); } }));
    if (m.adres && m.navUrl) acties.push(h.el('a', { klass: 'tp-link', href: m.navUrl, target: '_blank', rel: 'noopener', title: 'Navigeer naar ' + m.adres, tekst: 'Navigeer naar ' + m.adres }));
    if (acties.length) kids.push(h.el('div', { klass: 'tp-acties tp-onder' }, acties));
    return h.sectie('pg-h-gegevens', 'Projectgegevens', null, kids);
  }
  function lead(m, h) {
    const l = m.lead; if (!l || !l.isLead) return null;
    const kan = m.kan, kids = [];
    m.conflicten.filter(c => !c.gegevens).forEach(c => kids.push(conflictBlok(h, m, c)));
    const info = [l.faseLabel ? 'Fase: ' + l.faseLabel : '', l.verlies ? 'Reden: ' + l.verlies : '', l.geparkeerd ? 'Opnieuw bekijken: ' + l.geparkeerd : '', l.gewonnenOp ? 'Gewonnen op ' + l.gewonnenOp : '', l.bron ? 'Bron: ' + l.bron : ''].filter(Boolean);
    if (info.length) kids.push(h.el('div', { klass: 'tp-sub', tekst: info.join(' · ') }));
    if (l.ontbreekt) kids.push(h.el('div', { klass: 'tp-melding', role: 'status' }, h.el('span', { tekst: 'Deze lead heeft geen volgende actie met een datum.' })));
    const nr = (sl, w, label, extra) => h.tekstVeld(sl, w == null ? '' : String(w), Object.assign({ kan, label, klass: 'tp-kort', inputmode: 'decimal', wat: label.toLowerCase(), titel: 'Enter of wegklikken = opslaan, Esc = terug' }, extra || {}));
    kids.push(h.el('div', { klass: 'tp-velden' },
      h.rij('Volgende actie', h.tekstVeld('l.actie_tekst', l.actie.tekst || '', { kan, label: 'Volgende actie', placeholder: l.open ? 'verplicht bij een lead' : 'optioneel', wat: 'volgende actie', titel: 'Enter of wegklikken = opslaan, Esc = terug' })),
      h.rij('Datum volgende actie', datumVeld(h, 'l.actie_datum', l.actie.datum, { kan, label: 'Datum volgende actie', wat: 'datum van de volgende actie' })),
      h.rij('Waarde excl.', nr('l.waarde_excl', l.waarde, 'Waarde excl. btw')),
      h.rij('Kans %', nr('l.kans_pct', l.kans, 'Kans in procenten')),
      h.rij('Beslissing verwacht', datumVeld(h, 'l.verwachte_beslisdatum', l.beslis, { kan, label: 'Beslissing verwacht', wat: 'verwachte beslisdatum' }))));
    if (l.open && kan) kids.push(h.el('div', { klass: 'tp-acties tp-onder' }, h.el('button', { type: 'button', klass: 'tp-knop tp-primair', id: 'pg-gewonnen', title: 'De lead is gewonnen: hij gaat door als project in de fase Werkvoorbereiding', tekst: 'Gewonnen → project', klik: async () => { h.sluit({ stil: true }); await D.gewonnen(m.code); } })));
    return h.sectie('pg-h-lead', 'Lead', null, kids);
  }

  const DEF = {
    soort: SOORT, label: 'Gegevens',
    lees: hash => PP.leesHash(hash),
    href: code => PP.href(code),
    sleutelTekst: code => String(code),
    klaar: () => !D.klaar || D.klaar(),
    ruw: () => (D.ruw ? D.ruw() : ''),
    model: code => D.model(code),
    // spec = { velden: { 'g.leverdatum': '2026-11-02' }, gezien } → de bestaande functies van het projectscherm; één veld per aanroep
    schrijf: async (code, spec) => {
      const uit = Object.keys((spec && spec.velden) || {}).map(k => ({ k, s: PP.splits(k) })).filter(x => x.s);
      if (!uit.length) return { ok: false, reden: 'Onbekend veld; er is niets gewijzigd.' };
      if (!(D.mag && D.mag())) return { ok: false, reden: GEEN };
      for (const x of uit) { const w = spec.velden[x.k]; if (x.s.soort === 'g') await D.gegevensZet(code, x.s.veld, w); else await D.leadVeldZet(code, x.s.veld, w); }
      return { ok: true };
    },
    naWijziging: () => { if (D.naWijziging) D.naWijziging(); },
    teken: (m, h) => {
      if (!m.ok) return { aria: 'Gegevens', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: DEF.klaar() ? 'Project niet gevonden' : 'Projecten laden…' }), body: [h.el('p', { klass: 'tp-sub', tekst: DEF.klaar() ? 'Dit project bestaat niet (meer).' : 'De projecten zijn nog niet geladen.' })] };
      const body = [gegevens(m, h), lead(m, h), h.opslagZone(), h.el('div', { klass: 'tp-meta' }, h.el('p', { klass: 'tp-sub', tekst: m.metaTekst }))].filter(Boolean);
      return { aria: 'Gegevens van ' + (m.project.naam || m.code), boven: herkomst(m, h), titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: 'Gegevens' }), body };
    }
  };

  PP.open = (code, o) => (code == null || code === '') ? false : O.open(SOORT, String(code), o);
  PP.sluit = o => O.sluit(o);
  PP.isOpen = () => O.isOpen(SOORT);
  PP.init = function (deps) {
    D = deps; O = deps.objectpaneel || root.MTObjectPaneel;
    // de ene groene hoofdactie van het paneel (Gewonnen → project); hogere specificiteit dan de basisknop van het objectpaneel
    try { const d = D.doc; if (d && d.head && !d.getElementById('pg-stijl')) { const s = d.createElement('style'); s.id = 'pg-stijl'; s.textContent = 'html #tp-paneel button.tp-knop.tp-primair{background:var(--green,#2A4A38);color:var(--n-0,#fff);border-color:var(--green,#2A4A38);font-weight:600}html #tp-paneel button.tp-knop.tp-primair:hover{filter:brightness(1.1)}'; d.head.appendChild(s); } } catch (e) {}
    O.registreer(Object.assign({}, DEF, { startLink: deps.startLink }));
    return PP;
  };
  PP.DEF = DEF;
  root.MTProjectPaneel = PP;
  if (typeof module !== 'undefined' && module.exports) module.exports = PP;
})(typeof window !== 'undefined' ? window : globalThis);
