/* ============================================================================
 * mt-capaciteit.js — de capaciteitsplanning voor het team (Agenda, standaardweergave; planning stap 2)
 * ----------------------------------------------------------------------------
 * Rijen = het team, kolommen = de werkdagen van deze en volgende week; per cel gepland tegenover beschikbaar ("4u gepland, 4u vrij" of "+2u over"),
 * met de vrije dagen en het verlof uit Beheer. Een klik op een cel toont de taken en planblokken van die persoon op die dag; een klik daarop opent het project.
 * Alleen lezen. De rekenregels staan in mt-planning.js (MTPlanning.teamCapaciteit, gedeeld met Vandaag en de tv); dit bestand tekent met DOM-calls, nooit met
 * opgebouwde HTML. Alles komt van buiten via init(deps), zodat het zonder de hele cockpit te testen is.
 * ========================================================================== */
(function (root) {
  'use strict';
  const C = {};
  let D = null, P = null;
  const S = { gekozen: null };

  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const uren = min => P.fmtUurMin(min);
  const projLabel = code => { const p = D.project ? D.project(code) : null; return p ? (p.label || p.naam || code) : String(code || ''); };

  C.bereken = function () {
    return P.teamCapaciteit(D.taken(), D.afhank(), D.blokken(), { team: D.team(), vandaag: P.vandaagYmd(), weken: 2, vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null, werkuren: D.werkuren ? D.werkuren() : null });
  };
  // Tekst en toestand van een cel: gewoon, bijna vol (90% of meer), vol of over (rood).
  C.celTekst = function (c) {
    if (c.verlof) return ['verlof', ''];
    if (!c.werkdag) return ['vrije dag', c.gepland_min ? uren(c.gepland_min) + ' gepland' : ''];
    if (c.cap_min <= 0) return [c.gepland_min ? uren(c.gepland_min) + ' gepland' : '—', c.gepland_min ? 'geen capaciteit' : ''];
    const gedeeld = c.dagdelen * (c.cap_min / 2);
    return [gedeeld ? uren(gedeeld) + ' gepland' : '—', c.over_min > 0 ? '+' + uren(c.over_min) + ' over' : uren(c.vrij_min) + ' vrij'];
  };
  const celStaat = c => (c.verlof || !c.werkdag) ? 'vrij' : c.cap_min <= 0 ? '' : c.over_min > 0 ? 'over' : (c.gepland_min / c.cap_min >= 0.9 ? 'vol' : '');

  function detail(rij, cel) {
    const kop = rij.naam + ' — ' + P.datumKort(cel.datum) + (cel.verlof ? ' (verlof)' : !cel.werkdag ? ' (vrije dag)' : ': ' + uren(cel.gepland_min) + ' gepland van ' + uren(cel.cap_min));
    const lijst = cel.items.length ? cel.items.map(it => el('button', { klass: 'cp-item', type: 'button', title: 'Open het project', klik: () => D.openProject(it.code) },
      el('span', { klass: 'cp-strook', style: 'background:' + P.projectKleur(it.code) }),
      el('span', { klass: 'cp-itemtekst' }, el('b', { tekst: it.naam }), el('span', { klass: 'cp-sub', tekst: [projLabel(it.code), it.start ? it.start : '', it.min ? uren(it.min) : '', it.soort === 'blok' ? (it.planvoorstel ? 'planblok (voorstel)' : 'planblok') : (P.TAAK_STATUS_LABEL[it.status] || ''), it.wacht && it.status !== 'wacht' ? 'wacht op een voorganger' : '', it.taak && it.taak.wacht_reden && it.status === 'wacht' ? 'wacht: ' + it.taak.wacht_reden : ''].filter(Boolean).join(' · ') })))) : el('div', { klass: 'cp-sub', tekst: 'Niets gepland.' });
    return el('div', { klass: 'cp-detail', role: 'region', 'aria-label': 'Details' }, el('div', { klass: 'cp-detailkop' }, el('b', { tekst: kop }), el('button', { klass: 'btn btn-xs btn-secondary', type: 'button', klik: () => { S.gekozen = null; C.teken(); }, tekst: 'Sluiten' })), lijst);
  }

  C.teken = function () {
    // Nieuwe stijl (restyling brok 6/7): de weergave staat in mt-capaciteit-nieuw.js; de oude tekening hieronder blijft ongewijzigd.
    if (D && D.doc.documentElement.getAttribute('data-stijl') === 'nieuw' && root.MTCapaciteitNieuw) { try { root.MTCapaciteitNieuw.teken(); return; } catch (e) { console.warn('Capaciteit (nieuw):', e); } }
    const w = D && D.doc.getElementById('agenda-capaciteit'); if (!w) return;
    w.textContent = '';
    if (!D.doc.getElementById('cp-stijl')) { const s = el('style', { id: 'cp-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    const k = C.bereken(); C.laatste = k;
    w.appendChild(el('div', { klass: 'cp-uitleg', tekst: 'Gepland tegenover beschikbaar per persoon (8 uur per werkdag, in dagdelen), met de vrije dagen en het verlof uit Beheer. Klik op een dag voor de taken en planblokken.' }));
    if (D.takenKlaar && !D.takenKlaar()) w.appendChild(el('div', { klass: 'cp-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const raster = el('div', { klass: 'cp-raster', style: 'grid-template-columns:170px repeat(' + k.dagen.length + ',minmax(86px,1fr))' });
    raster.appendChild(el('div', { klass: 'cp-hoek' }));
    k.dagen.forEach(d => raster.appendChild(el('div', { klass: 'cp-dagkop' + (d.nu ? ' nu' : '') + (d.werkdag ? '' : ' vrij') + (d.week ? ' w2' : ''), tekst: P.datumKort(d.datum) })));
    k.rijen.forEach(rij => {
      raster.appendChild(el('div', { klass: 'cp-persoon' }, el('b', { tekst: rij.naam }),
        rij.heeftCap ? rij.weken.map((wk, i) => el('div', { klass: 'cp-week', tekst: 'Week ' + (i + 1) + ': ' + uren(wk.gepland_min) + ' gepland · ' + (wk.over_min > 0 ? '+' + uren(wk.over_min) + ' over' : uren(wk.vrij_min) + ' vrij') })) : el('div', { klass: 'cp-week', tekst: 'zonder eigenaar of niet in het team' })));
      rij.dagen.forEach(c => {
        const [r1, r2] = C.celTekst(c), actief = S.gekozen && S.gekozen.slug === rij.slug && S.gekozen.datum === c.datum;
        raster.appendChild(el('button', { klass: 'cp-cel ' + celStaat(c) + (actief ? ' gekozen' : ''), type: 'button', 'aria-pressed': actief ? 'true' : 'false', title: rij.naam + ' ' + P.datumKort(c.datum),
          klik: () => { S.gekozen = actief ? null : { slug: rij.slug, datum: c.datum }; C.teken(); } }, el('span', { klass: 'cp-r1', tekst: r1 }), el('span', { klass: 'cp-r2', tekst: r2 }), c.items.length ? el('span', { klass: 'cp-n', tekst: c.items.length + (c.items.length === 1 ? ' item' : ' items') }) : null));
      });
    });
    w.appendChild(raster);
    if (!k.rijen.length) w.appendChild(el('div', { klass: 'cp-sub', tekst: 'Geen teamleden.' }));
    if (S.gekozen) { const rij = k.rijen.find(r => r.slug === S.gekozen.slug), cel = rij && rij.dagen.find(c => c.datum === S.gekozen.datum); if (rij && cel) w.appendChild(detail(rij, cel)); }
  };
  const STIJL = '#agenda-capaciteit{padding:4px 2px}.cp-uitleg{font-size:12px;color:var(--text-dim,#666);margin-bottom:8px}.cp-melding{background:#FBF0E0;border:1px solid #E8D48A;color:#7A6010;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px}'
    + '.cp-raster{display:grid;gap:3px;overflow-x:auto;align-items:stretch}.cp-dagkop{background:var(--surface-sunken,#eef1f0);text-align:center;font-weight:600;font-size:12px;padding:6px 2px;border-radius:6px}.cp-dagkop.nu{background:#2A4A38;color:#fff}.cp-dagkop.vrij{opacity:.5}.cp-dagkop.w2{background:#e3e9e7}'
    + '.cp-persoon{background:var(--surface-sunken,#eef1f0);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}.cp-week{font-size:11px;color:var(--text-dim,#666)}'
    + '.cp-cel{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:58px;border:1px solid var(--border,#ddd);border-radius:6px;background:var(--surface,#fff);font:inherit;cursor:pointer;padding:4px 2px}.cp-cel:hover{background:#f1f6f3}'
    + '.cp-cel.vol{background:#FBF5E0;border-color:#E8D48A}.cp-cel.over{background:#FDE8E8;border-color:#f5c5c5}.cp-cel.vrij{background:#f2f2f2;color:#888}.cp-cel.gekozen{outline:2px solid #2A4A38}'
    + '.cp-r1{font-weight:600;font-size:13px}.cp-r2{font-size:12px;color:var(--text-dim,#666)}.cp-cel.over .cp-r2{color:#8B1A1A;font-weight:600}.cp-n{font-size:10px;color:var(--text-faint,#888)}'
    + '.cp-detail{margin-top:12px;border:1px solid var(--border,#ddd);border-radius:8px;padding:10px 12px;background:var(--surface,#fff)}.cp-detailkop{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px}'
    + '.cp-item{display:flex;align-items:stretch;gap:10px;width:100%;text-align:left;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--surface,#fff);margin-bottom:6px;padding:0 10px 0 0;overflow:hidden;font:inherit;cursor:pointer}.cp-item:hover{background:#f1f6f3}'
    + '.cp-strook{flex:0 0 6px}.cp-itemtekst{display:flex;flex-direction:column;padding:6px 0}.cp-sub{font-size:12px;color:var(--text-dim,#666)}';

  C.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return C; };
  C.S = S;
  root.MTCapaciteit = C;
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
})(typeof window !== 'undefined' ? window : globalThis);
