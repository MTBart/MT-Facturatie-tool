// mt-projfilter.js — de projectlijst filteren, sorteren en groeperen (PL1). Alleen lezen en weergave: er wordt niets naar
// SharePoint geschreven; de stand staat in de link (#tab=projecten&pf=...) en per gebruiker in localStorage (try/catch).
// Rekenwerk (pas, tel, sorteer, groepeer, codeer/decodeer) is puur en los te testen; het paneel tekent HTML-tekst met esc().
// De cockpit levert per project een record: { code, naam, klant, klantNaam, fase (zie FASEN), pers: [slug], lever, act, created, idx }.
(function (root) {
  'use strict';
  const F = root.MTProjFilter = root.MTProjFilter || {};

  // ── Fases en groepen. 'gearchiveerd' = het oude veld status "archief" (of gearchiveerd) bij een project dat niet afgerond of verloren is;
  // een project zonder fase (van vóór L1) valt onder "Zonder fase" met zijn afgeleide status. ─────────────────────────────────────────
  const GROEPEN = [
    { t: 'Aanvraag', k: [['nieuw', 'Nieuw'], ['opname', 'Opname'], ['offerte_maken', 'Offerte maken'], ['verstuurd', 'Offerte verstuurd'], ['geparkeerd', 'Geparkeerd']] },
    { t: 'Project', k: [['werkvoorbereiding', 'Werkvoorbereiding'], ['inkoop', 'Inkoop'], ['productie', 'Productie'], ['klaar_levering', 'Klaar voor levering'], ['factureren', 'Factureren'], ['nacalculatie', 'Nacalculatie']] },
    { t: 'Afgesloten', k: [['afgerond', 'Afgerond'], ['verloren', 'Verloren'], ['gearchiveerd', 'Gearchiveerd']] },
    { t: 'Zonder fase (oud)', k: [['zf_offerte', 'Offerte'], ['zf_lopend', 'Lopend'], ['zf_opgeleverd', 'Opgeleverd']], optioneel: true }];
  const FASEN = [].concat(...GROEPEN.map(g => g.k.map(x => x[0])));
  const LABEL = new Map([].concat(...GROEPEN.map(g => g.k.map(x => [x[0], x[1]]))));
  const UIT_STANDAARD = ['afgerond', 'verloren', 'gearchiveerd'];
  const SORTEER = [['nieuwste', 'Nieuwste eerst'], ['naam', 'Naam'], ['klant', 'Klant'], ['leverdatum', 'Leverdatum'], ['fase', 'Fase'], ['activiteit', 'Laatste activiteit']];
  const GROEPEER = [['', 'Niet groeperen'], ['fase', 'Per fase'], ['klant', 'Per klant']];
  const GEEN = '_geen';   // persoon: projecten zonder open taken
  F.FASEN = FASEN; F.UIT_STANDAARD = UIT_STANDAARD; F.SORTEER = SORTEER; F.GEEN = GEEN;
  F.faseLabel = k => LABEL.get(k) || '';

  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleutel = v => { const s = String(v == null ? '' : v).trim(); return /^[\w.\- ]{1,60}$/.test(s) ? s : ''; };
  const uniek = a => [...new Set(a)];

  // ── Stand ────────────────────────────────────────────────────────────────────
  // fase: null = standaard (alle lopende fasen) of een lijst; klant, pers: null = iedereen of een lijst.
  const nieuweStand = () => ({ fase: null, klant: null, pers: null, sort: 'nieuwste', groep: '' });
  F.nieuweStand = nieuweStand;
  // Maakt van willekeurige invoer (link, opslag) een geldige stand; niets onbekends komt erdoor.
  F.schoon = function (o) {
    const s = nieuweStand(); if (!o || typeof o !== 'object') return s;
    if (Array.isArray(o.fase)) s.fase = uniek(o.fase.filter(k => FASEN.includes(k)));
    if (Array.isArray(o.klant)) s.klant = uniek(o.klant.map(sleutel).filter(Boolean)).slice(0, 300);
    if (Array.isArray(o.pers)) s.pers = uniek(o.pers.map(sleutel).filter(Boolean)).slice(0, 60);
    if (SORTEER.some(x => x[0] === o.sort)) s.sort = o.sort;
    if (o.groep === 'fase' || o.groep === 'klant') s.groep = o.groep;
    return s;
  };
  const zelfde = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const standaardFase = () => FASEN.filter(k => !UIT_STANDAARD.includes(k));
  F.faseAan = (s, k) => s.fase ? s.fase.includes(k) : !UIT_STANDAARD.includes(k);
  F.afwijkend = s => (s.fase && !zelfde(s.fase, standaardFase()) ? 1 : 0) + (s.klant ? 1 : 0) + (s.pers ? 1 : 0);
  F.isStandaard = s => !F.afwijkend(s) && s.sort === 'nieuwste' && !s.groep;
  // Link: fase:a,b;klant:X,Y;pers:p;sort:naam;groep:fase (alleen wat afwijkt van de standaard); '' = standaard.
  F.codeer = function (s) {
    const d = [];
    if (s.fase && !zelfde(s.fase, standaardFase())) d.push('fase:' + (s.fase.length ? s.fase.join(',') : '-'));
    if (s.klant) d.push('klant:' + (s.klant.length ? s.klant.join(',') : '-'));
    if (s.pers) d.push('pers:' + (s.pers.length ? s.pers.join(',') : '-'));
    if (s.sort !== 'nieuwste') d.push('sort:' + s.sort);
    if (s.groep) d.push('groep:' + s.groep);
    return d.join(';');
  };
  F.decodeer = function (t) {
    const o = {}; if (typeof t !== 'string' || t.length > 4000) return null;
    t.split(';').forEach(x => { const i = x.indexOf(':'); if (i < 1) return; const k = x.slice(0, i), v = x.slice(i + 1), lijst = v === '-' ? [] : v.split(',').filter(Boolean);
      if (k === 'fase' || k === 'klant' || k === 'pers') o[k] = lijst; else if (k === 'sort' || k === 'groep') o[k] = v; });
    return F.schoon(o);
  };

  // ── Filteren, tellen, sorteren, groeperen (puur) ─────────────────────────────
  const klantSleutel = r => String(r.klant || '').toUpperCase() || '_zonder';
  const slaagt = (r, s, skip) => {
    if (skip !== 'fase' && !F.faseAan(s, r.fase)) return false;
    if (skip !== 'klant' && s.klant && !s.klant.includes(klantSleutel(r))) return false;
    if (skip !== 'pers' && s.pers) { const p = (r.pers || []); if (!(p.length ? p.some(x => s.pers.includes(x)) : s.pers.includes(GEEN))) return false; }
    return true;
  };
  F.pas = (items, s, houd) => items.filter(r => (houd && r.code === houd) || slaagt(r, s));
  // Aantal per optie, gerekend over de andere groepen (zo klopt "Productie (4)" met wat je na het aanvinken ziet).
  F.tel = function (items, s) {
    const fase = {}, klant = {}, pers = {};
    for (const r of items) {
      if (slaagt(r, s, 'fase')) fase[r.fase] = (fase[r.fase] || 0) + 1;
      if (slaagt(r, s, 'klant')) klant[klantSleutel(r)] = (klant[klantSleutel(r)] || 0) + 1;
      if (slaagt(r, s, 'pers')) { const p = r.pers || []; if (p.length) p.forEach(x => { pers[x] = (pers[x] || 0) + 1; }); else pers[GEEN] = (pers[GEEN] || 0) + 1; }
    }
    return { fase, klant, pers };
  };
  const NL = (a, b) => String(a || '').localeCompare(String(b || ''), 'nl', { sensitivity: 'base' });
  F.sorteer = function (lijst, sort) {
    const ord = r => { const i = FASEN.indexOf(r.fase); return i < 0 ? 99 : i; };
    const stabiel = (cmp) => lijst.slice().sort((a, b) => cmp(a, b) || (a.idx - b.idx));
    if (sort === 'naam') return stabiel((a, b) => NL(a.naam, b.naam));
    if (sort === 'klant') return stabiel((a, b) => NL(a.klantNaam, b.klantNaam) || NL(a.naam, b.naam));
    if (sort === 'leverdatum') return stabiel((a, b) => (a.lever && b.lever ? (a.lever < b.lever ? -1 : a.lever > b.lever ? 1 : 0) : a.lever ? -1 : b.lever ? 1 : 0) || NL(a.naam, b.naam));
    if (sort === 'fase') return stabiel((a, b) => ord(a) - ord(b) || NL(a.naam, b.naam));
    if (sort === 'activiteit') return stabiel((a, b) => (Number(b.act) || 0) - (Number(a.act) || 0));
    // nieuwste: created (YYYY-MM-DD) aflopend, zelfde dag → later toegevoegd eerst, zonder created achteraan in de bestaande volgorde
    return lijst.slice().sort((a, b) => { const ca = a.created || '', cb = b.created || ''; if (!ca || !cb) return ca ? -1 : cb ? 1 : a.idx - b.idx; return ca < cb ? 1 : ca > cb ? -1 : b.idx - a.idx; });
  };
  F.groepeer = function (lijst, per, faseLabel) {
    if (per !== 'fase' && per !== 'klant') return null;
    const m = new Map();
    for (const r of lijst) { const k = per === 'fase' ? r.fase : klantSleutel(r); if (!m.has(k)) m.set(k, { key: k, label: per === 'fase' ? ((faseLabel && faseLabel(k)) || F.faseLabel(k)) : (r.klantNaam || (k === '_zonder' ? '' : k)) || 'Zonder klant', items: [] }); m.get(k).items.push(r); }
    const uit = [...m.values()]; uit.forEach(g => { g.aantal = g.items.length; });
    return per === 'fase' ? uit.sort((a, b) => FASEN.indexOf(a.key) - FASEN.indexOf(b.key)) : uit.sort((a, b) => (a.key === '_zonder') - (b.key === '_zonder') || NL(a.label, b.label));
  };
  // Alles in één keer: { lijst, groepen, getoond, totaal } voor de huidige stand.
  F.bereken = function (items, s, houd, faseLabel) {
    const lijst = F.sorteer(F.pas(items, s, houd), s.sort);
    return { lijst, groepen: F.groepeer(lijst, s.groep, faseLabel), getoond: lijst.length, totaal: items.length };
  };

  // ── Selectie (voor een latere bulkactie: aanvinken in de lijst). Nu alleen de stand; de lijst toont de vinkjes zodra modus aan staat. ──
  F.selectie = new Set(); F.selectieModus = false;
  F.selecteer = (code, aan) => { if (aan) F.selectie.add(code); else F.selectie.delete(code); if (typeof F.teken === 'function') F.teken(); };
  F.zetSelectieModus = v => { F.selectieModus = !!v; if (!v) F.selectie.clear(); };

  // ── Paneel ───────────────────────────────────────────────────────────────────
  const D = { doc: null, storage: null, wie: () => '', label: null, opStand: null, haalItems: null, el: null };
  const S = { stand: nieuweStand(), open: false, dicht: new Set(), details: { fase: true, klant: false, pers: false }, items: [], res: null };
  F.stand = () => S.stand; F.dicht = k => S.dicht.has(k);
  const opslagSleutel = () => 'mtpf:' + (D.wie() || '');
  function bewaar() { try { D.storage && D.storage.setItem(opslagSleutel(), JSON.stringify(S.stand)); } catch (e) { } }
  function css() {
    const doc = D.doc; if (!doc || doc.getElementById('mt-pf-css')) return;
    const s = doc.createElement('style'); s.id = 'mt-pf-css';
    s.textContent = `
.pf{margin-bottom:8px;font-size:13px}
.pf label.pf-optie,.pf .pf-optie .t,.pf .pf-optie .c{text-transform:none;letter-spacing:0;font-size:13px;font-weight:400;color:inherit}
.pf .pf-optie .c{color:var(--text-faint,#8a8a80);font-size:12px}
.pf input[type=checkbox]{accent-color:var(--green,#2A4A38)}
.pf .pf-sel{width:auto;flex:1 1 110px;min-width:0}
.pf-balk{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.pf-knop{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:16px;padding:5px 11px;font-size:13px;cursor:pointer;min-height:32px;color:inherit}
.pf-knop svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pf-knop.aan{background:var(--green,#2A4A38);border-color:var(--green,#2A4A38);color:#fff}
.pf-sel{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:16px;padding:4px 8px;font-size:13px;min-height:32px;max-width:100%;color:inherit}
.pf-selbalk{width:100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--border,#e4e2da);border-radius:10px;background:var(--bg,#f6f5f0)}
.pf-selbalk .t{font-size:12px;flex:1 1 100%}
.pf-knop[disabled]{opacity:.45;cursor:default}
.pf-teller{width:100%;font-size:12px;color:var(--text-faint,#8a8a80);margin:2px 0 0}
.pf-paneel{margin-top:8px;border:1px solid var(--border,#e4e2da);border-radius:10px;background:var(--card,#fff);padding:6px 10px;max-height:60vh;overflow:auto}
.pf-paneel[hidden],.pf-sluier[hidden]{display:none}
.pf-groep{border-top:1px solid var(--border,#eee);padding:4px 0}
.pf-groep:first-of-type{border-top:0}
.pf-groep>summary{cursor:pointer;font-weight:600;padding:6px 0;list-style:none;display:flex;gap:6px;align-items:center}
.pf-groep>summary::-webkit-details-marker{display:none}
.pf-groep>summary::before{content:'';width:6px;height:6px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(-45deg);transition:transform .12s;flex:none}
.pf-groep[open]>summary::before{transform:rotate(45deg)}
.pf-groep>summary .n{margin-left:auto;font-weight:400;font-size:12px;color:var(--text-faint,#8a8a80)}
.pf-acties{display:flex;gap:10px;margin:0 0 4px}
.pf-link{border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--green,#2A4A38);text-decoration:underline;cursor:pointer}
.pf-sub{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-faint,#8a8a80);margin:6px 0 2px}
.pf-optie{display:flex;align-items:center;gap:8px;padding:4px 2px;min-height:30px;cursor:pointer}
.pf-optie input{width:auto;margin:0;flex:none}
.pf-optie .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.pf-optie .c{font-size:12px;color:var(--text-faint,#8a8a80);font-variant-numeric:tabular-nums}
.pf-optie.nul{opacity:.55}
.pf-voet{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid var(--border,#eee)}
.pf-klaar{display:none}
.pf-kop{display:flex;align-items:center;gap:6px;margin:8px 0 2px;font-size:12px;font-weight:600;color:var(--text-dim,#555)}
.pf-kop button{border:0;background:none;padding:2px 0;font:inherit;color:inherit;cursor:pointer;display:flex;align-items:center;gap:6px;width:100%;text-align:left}
.pf-kop button::before{content:'';width:6px;height:6px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg);transition:transform .12s;flex:none}
.pf-kop.dicht button::before{transform:rotate(-45deg)}
.pf-kop .n{font-weight:400;color:var(--text-faint,#8a8a80)}
.pf-leeg{padding:10px;font-size:12px;color:var(--text-faint,#8a8a80);font-style:italic}
.pf-rij-vink{width:auto;margin:0 8px 0 0;flex:none}
@media(max-width:820px){
 .pf-paneel{position:fixed;left:0;right:0;bottom:0;margin:0;max-height:82vh;border-radius:14px 14px 0 0;z-index:9001;box-shadow:0 -6px 24px rgba(0,0,0,.18);padding:10px 16px 16px}
 .pf-sluier{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9000}
 .pf-knop,.pf-sel{min-height:44px;font-size:16px}
 .pf-optie{min-height:44px}.pf-optie input{width:22px;height:22px}
 .pf-link{min-height:44px;font-size:14px}
 .pf-klaar{display:inline-block}
}`;
    doc.head.appendChild(s);
  }
  const ICOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4z"/></svg>';
  const optie = (groep, v, label, aan, n) => `<label class="pf-optie${n === 0 ? ' nul' : ''}"><input type="checkbox" data-pf-keuze="${esc(groep)}" data-v="${esc(v)}"${aan ? ' checked' : ''}><span class="t">${esc(label)}</span><span class="c">${esc(n)}</span></label>`;
  const acties = g => `<div class="pf-acties"><button type="button" class="pf-link" data-pf-alles="${esc(g)}">Alles</button><button type="button" class="pf-link" data-pf-niets="${esc(g)}">Niets</button></div>`;
  F.paneelHtml = function () {
    const s = S.stand, items = S.items, tel = F.tel(items, s), res = S.res || { getoond: 0, totaal: items.length }, n = F.afwijkend(s);
    const fl = k => (D.label && D.label(k)) || F.faseLabel(k);
    // Fase
    let faseTot = 0, faseAan = 0, fase = acties('fase');
    for (const g of GROEPEN) {
      const rij = g.k.filter(x => !g.optioneel || (tel.fase[x[0]] || 0) > 0 || F.faseAan(s, x[0]) && s.fase);
      if (!rij.length) continue;
      faseTot += rij.length; faseAan += rij.filter(x => F.faseAan(s, x[0])).length;
      fase += `<div class="pf-sub">${esc(g.t)}</div>` + rij.map(x => optie('fase', x[0], fl(x[0]), F.faseAan(s, x[0]), tel.fase[x[0]] || 0)).join('');
    }
    // Klant en persoon (uit wat er is, plus wat gekozen is)
    const kl = new Map(); items.forEach(r => { if (!kl.has(klantSleutel(r))) kl.set(klantSleutel(r), r.klantNaam || (klantSleutel(r) === '_zonder' ? 'Zonder klant' : klantSleutel(r))); });
    (s.klant || []).forEach(k => { if (!kl.has(k)) kl.set(k, k === '_zonder' ? 'Zonder klant' : k); });
    const klanten = [...kl.entries()].sort((a, b) => (a[0] === '_zonder') - (b[0] === '_zonder') || NL(a[1], b[1]));
    const ps = new Map(); items.forEach(r => (r.pers || []).forEach(p => { if (!ps.has(p)) ps.set(p, (D.persNaam && D.persNaam(p)) || p); }));
    (s.pers || []).forEach(p => { if (p !== GEEN && !ps.has(p)) ps.set(p, (D.persNaam && D.persNaam(p)) || p); });
    const personen = [...ps.entries()].sort((a, b) => NL(a[1], b[1]));
    const open = g => (S.details[g] ? ' open' : '');
    return `<div class="pf-balk"><button type="button" class="pf-knop${S.open || n ? ' aan' : ''}" data-pf="open" aria-expanded="${S.open ? 'true' : 'false'}" aria-controls="pf-paneel">${ICOON}Filter${n ? ' (' + esc(n) + ')' : ''}</button>
      <select class="pf-sel" data-pf-sort aria-label="Sorteren">${SORTEER.map(x => `<option value="${esc(x[0])}"${s.sort === x[0] ? ' selected' : ''}>${esc(x[1])}</option>`).join('')}</select>
      <select class="pf-sel" data-pf-groep aria-label="Groeperen">${GROEPEER.map(x => `<option value="${esc(x[0])}"${s.groep === x[0] ? ' selected' : ''}>${esc(x[1])}</option>`).join('')}</select>
      ${D.magSelecteren && D.magSelecteren() ? `<button type="button" class="pf-knop${F.selectieModus ? ' aan' : ''}" data-pf="sel" aria-pressed="${F.selectieModus ? 'true' : 'false'}">Selecteren</button>` : ''}
      ${F.selectieModus ? `<div class="pf-selbalk"><span class="t">${esc(F.selectie.size)} geselecteerd</span>
        <button type="button" class="pf-knop" data-pf-selalles="1">Alles in dit filter (${esc(res.getoond)})</button><button type="button" class="pf-knop" data-pf-selniets="1">Niets</button>
        <button type="button" class="pf-knop" data-pf-actie="afronden"${F.selectie.size ? '' : ' disabled'}>Afronden</button><button type="button" class="pf-knop" data-pf-actie="verloren"${F.selectie.size ? '' : ' disabled'}>Verloren</button>
        <button type="button" class="pf-knop" data-pf-actie="voorstel">Voorstel archiveren</button></div>` : ''}
      <div class="pf-teller" role="status">${esc(res.getoond)} van ${esc(res.totaal)} project${res.totaal === 1 ? '' : 'en'}</div></div>
    <div class="pf-sluier" data-pf="sluit"${S.open ? '' : ' hidden'}></div>
    <div class="pf-paneel" id="pf-paneel" role="group" aria-label="Projecten filteren"${S.open ? '' : ' hidden'}>
      <details class="pf-groep" data-pf-det="fase"${open('fase')}><summary>Fase <span class="n">${esc(faseAan)} van ${esc(faseTot)}</span></summary>${fase}</details>
      <details class="pf-groep" data-pf-det="klant"${open('klant')}><summary>Klant <span class="n">${esc(s.klant ? s.klant.length + ' van ' + klanten.length : 'alle')}</span></summary>${acties('klant')}${klanten.map(([k, nm]) => optie('klant', k, nm, !s.klant || s.klant.includes(k), tel.klant[k] || 0)).join('') || '<div class="pf-leeg">Geen klanten.</div>'}</details>
      <details class="pf-groep" data-pf-det="pers"${open('pers')}><summary>Persoon (open taken) <span class="n">${esc(s.pers ? s.pers.length + ' gekozen' : 'iedereen')}</span></summary>${acties('pers')}${personen.map(([k, nm]) => optie('pers', k, nm, !s.pers || s.pers.includes(k), tel.pers[k] || 0)).join('')}${optie('pers', GEEN, 'Geen open taken', !s.pers || s.pers.includes(GEEN), tel.pers[GEEN] || 0)}</details>
      <div class="pf-voet"><button type="button" class="pf-link" data-pf-reset="1"${F.isStandaard(s) ? ' disabled' : ''}>Standaard weergave</button><button type="button" class="pf-knop pf-klaar aan" data-pf="sluit">Klaar</button></div>
    </div>`;
  }
  F.teken = function () { if (D.el) D.el.innerHTML = F.paneelHtml(); };
  // De cockpit geeft de records (na zoeken en klantfilter); terug komt wat er getoond wordt. Tekent ook het paneel (teller en aantallen).
  F.verwerk = function (items, houd) {
    S.items = items; S.res = F.bereken(items, S.stand, houd, D.label);
    if (F.selectieModus && F.selectie.size) { const zichtbaar = new Set(S.res.lijst.map(r => r.code)); [...F.selectie].forEach(c => { if (!zichtbaar.has(c)) F.selectie.delete(c); }); }   // alleen wat je ziet kan geselecteerd zijn
    if (!S.el_bezig) F.teken();
    return S.res;
  };
  function wijzig(fn) { fn(S.stand); bewaar(); if (D.opStand) D.opStand(S.stand); else F.teken(); }
  F.zetStand = (s, stil) => { S.stand = F.schoon(s); if (!stil) wijzig(() => { }); };
  function klik(e) {
    const t = e.target.closest ? e.target.closest('[data-pf],[data-pf-alles],[data-pf-niets],[data-pf-reset],[data-pf-selalles],[data-pf-selniets],[data-pf-actie]') : null; if (!t) return;
    const d = t.dataset;
    if (d.pf === 'sel') { F.zetSelectieModus(!F.selectieModus); return D.opStand ? D.opStand(S.stand, true) : F.teken(); }
    if (d.pfSelalles) { ((S.res && S.res.lijst) || []).forEach(r => F.selectie.add(r.code)); return D.opStand ? D.opStand(S.stand, true) : F.teken(); }
    if (d.pfSelniets) { F.selectie.clear(); return D.opStand ? D.opStand(S.stand, true) : F.teken(); }
    if (d.pfActie) { if (t.disabled) return; if (d.pfActie === 'voorstel') { if (D.opVoorstel) D.opVoorstel(); return; } if (D.opActie && F.selectie.size) D.opActie(d.pfActie, [...F.selectie]); return; }
    if (d.pf === 'open') { S.open = !S.open; return F.teken(); }
    if (d.pf === 'sluit') { S.open = false; return F.teken(); }
    if (d.pfReset) return wijzig(s => Object.assign(s, nieuweStand()));
    if (d.pfAlles) return wijzig(s => { if (d.pfAlles === 'fase') s.fase = FASEN.slice(); else s[d.pfAlles] = null; });
    if (d.pfNiets) return wijzig(s => { s[d.pfNiets] = []; });
  }
  // Een groepskop in de lijst in- of uitklappen (alleen in het geheugen; de lijst wordt opnieuw getekend).
  F.kopWissel = function (k) { if (S.dicht.has(k)) S.dicht.delete(k); else S.dicht.add(k); if (D.opStand) D.opStand(S.stand, true); };
  function wissel(e) {
    const t = e.target; if (!t || !t.closest) return;
    const k = t.closest('[data-pf-keuze]');
    if (k) {
      const g = k.dataset.pfKeuze, v = k.dataset.v, aan = k.checked;
      return wijzig(s => {
        let huidig;
        if (g === 'fase') huidig = s.fase ? s.fase.slice() : standaardFase();
        else if (s[g]) huidig = s[g].slice();
        else huidig = alleOpties(g);
        huidig = aan ? uniek(huidig.concat(v)) : huidig.filter(x => x !== v);
        if (g !== 'fase' && zelfde(huidig, alleOpties(g))) s[g] = null; else s[g] = huidig;
      });
    }
    if (t.matches && t.matches('[data-pf-sort]')) return wijzig(s => { s.sort = F.schoon({ sort: t.value }).sort; });
    if (t.matches && t.matches('[data-pf-groep]')) return wijzig(s => { s.groep = F.schoon({ groep: t.value }).groep; });
  }
  // Alle opties van klant/persoon voor wat er nu in de lijst zit (om "alles aangevinkt" terug te brengen naar "geen filter").
  function alleOpties(g) {
    if (g === 'klant') return uniek(S.items.map(klantSleutel));
    return uniek([].concat(...S.items.map(r => (r.pers || []))).concat(GEEN));
  }
  F.alleOpties = alleOpties;
  function det(e) { const d = e.target && e.target.closest ? e.target.closest('[data-pf-det]') : null; if (d) S.details[d.dataset.pfDet] = d.open; }
  // deps: { doc, storage, wie(), label(k), persNaam(slug), el (container), opStand(stand, alleenLijst) }
  F.init = function (deps) {
    Object.assign(D, deps || {}); css();
    S.stand = nieuweStand();
    try { const o = D.storage && D.storage.getItem(opslagSleutel()); if (o) S.stand = F.schoon(JSON.parse(o)); } catch (e) { }
    if (D.el && !D.el._pfGebonden) { D.el._pfGebonden = true; D.el.addEventListener('click', klik); D.el.addEventListener('change', wissel); D.el.addEventListener('toggle', det, true); }
    return S.stand;
  };
})(typeof window !== 'undefined' ? window : globalThis);
