/* ============================================================================
 * mt-mijnwerk.js — "Mijn werk" op de desktop (planning stap 2c): de eerste weergave van Agenda ▸ Planning
 * ----------------------------------------------------------------------------
 * Dezelfde groepen en rekenregels als Vandaag op de telefoon (MTPlanning.mijnWerk, gedeeld in mt-planning.js), met filters voor kantoor:
 * persoon (ik · iedereen · een medewerker) en project. Tekent met DOM-calls (nooit met opgebouwde HTML) en schrijft zelf niets:
 * een klik opent het project (taken). Alles komt van buiten via init(deps), zodat het zonder de hele cockpit te testen is.
 * ========================================================================== */
(function (root) {
  'use strict';
  const M = {};
  let D = null, P = null;
  const F = { persoon: 'ik', project: '' };
  const LS_GEZIEN = 'mt_vandaag_gezien';   // dezelfde "gezien"-lijst als op de telefoon (per apparaat)

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
  const uren = min => P.fmtUurMin(min);
  const leesGezien = () => { try { const o = JSON.parse(D.storage.getItem(LS_GEZIEN) || 'null'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } };
  function markeerGezien(item) {
    if (!item || !item.nieuw) return;
    const g = leesGezien(); g[item.id] = item.stempelToegewezen;
    try { D.storage.setItem(LS_GEZIEN, JSON.stringify(g)); } catch (e) {}
  }
  const teamLid = () => { const ik = String(D.ik() || '').toLowerCase(); return (D.team() || []).find(m => String(m.email || '').toLowerCase() === ik) || null; };
  const mijnSlug = () => { const l = teamLid(); return l ? l.slug : String(D.ik() || '').toLowerCase().split('@')[0]; };
  const projLabel = code => { const p = D.project(code); return p ? (p.label || p.naam || code) : String(code || ''); };

  const GROEPEN = [['voorstel', 'Voorstellen van de werkplaats'], ['nieuw', 'Nieuw voor mij'], ['teLaat', 'Te laat'], ['vandaag', 'Vandaag'], ['week', 'Deze week'], ['later', 'Later'], ['zonderDatum', 'Zonder datum']];
  M.bereken = function () {
    const opt = { team: D.team(), vandaag: P.vandaagYmd(), nu: D.nu(), project: F.project || '', gezien: leesGezien(), vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null };
    if (F.persoon === 'iedereen') Object.assign(opt, { iedereen: true });
    else if (F.persoon === 'ik') Object.assign(opt, { mijn: mijnSlug() });
    else Object.assign(opt, { mijn: F.persoon, nieuw: false });
    if (D.voorstellen) opt.voorstellen = true;
    if (D.werktijden && F.persoon !== 'iedereen') opt.capPerDag = P.capPerDagVoor(F.persoon === 'ik' ? mijnSlug() : F.persoon, D.werktijden());   // de beschikbare uren per dag volgen de werktijden (zonder ingevulde werktijden: 8 uur per dag)
    return P.mijnWerk(D.taken(), D.afhank(), D.blokken(), opt);
  };

  // Voor het startvenster (mt-startvenster.js): mijn eigen werk, los van de filters en zonder "nieuw voor mij" (alles staat dan in zijn datumgroep).
  M.mijnOpen = function () {
    return P.mijnWerk(D.taken(), D.afhank(), D.blokken(), { team: D.team(), vandaag: P.vandaagYmd(), nu: D.nu(), mijn: mijnSlug(), nieuw: false, vrij: D.vrij ? D.vrij() : null, verlof: D.verlof ? D.verlof() : null });
  };
  M.takenKlaar = () => !!(D && D.takenKlaar());

  function filterBalk() {
    const lijst = D.team() || [];
    const persoon = el('select', { id: 'mw-persoon', 'aria-label': 'Persoon', wijzig: ev => { F.persoon = ev.target.value; M.teken(); } },
      el('option', { value: 'ik', tekst: 'Ik' }), el('option', { value: 'iedereen', tekst: 'Iedereen' }), lijst.map(m => el('option', { value: m.slug, tekst: m.naam })));
    persoon.value = F.persoon;
    const projecten = (D.projecten() || []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const project = el('select', { id: 'mw-project', 'aria-label': 'Project', wijzig: ev => { F.project = ev.target.value; M.teken(); } },
      el('option', { value: '', tekst: 'Alle projecten' }), projecten.map(p => el('option', { value: p.code, tekst: p.label || p.code })));
    project.value = F.project;
    return el('div', { klass: 'mw-filters' }, el('label', { for: 'mw-persoon', tekst: 'Wie' }), persoon, el('label', { for: 'mw-project', tekst: 'Project' }), project);
  }
  function weekBalk(w) {
    if (!w) return null;
    return el('div', { klass: 'mw-week' },
      el('b', { tekst: 'Deze week ' + uren(w.gepland_min) + ' gepland / ' + uren(w.vrij_min) + ' vrij' + (w.over_min > 0 ? ' · ' + uren(w.over_min) + ' te veel' : '') }),
      el('span', { klass: 'mw-sub', tekst: ' — ' + w.dagdelen + ' van ' + w.dagdelenTotaal + ' dagdelen (8 uur per werkdag, in dagdelen)' }),
      el('span', { klass: 'mw-dagen' }, w.dagen.map(d => el('span', { klass: 'mw-dag' + (d.werkdag ? '' : ' vrij'), title: P.datumKort(d.datum) + ': ' + uren(d.gepland_min) + ' gepland' }, P.datumKort(d.datum).slice(0, 2), ' ', [0, 1].map(n => el('i', { klass: n < d.dagdelen ? 'vol' : '' }))))));
  }
  const wachtTekst = item => P.wachtOpTekst(item.wacht, P.datumKort);
  function wanneer(item, vandaag) {
    if (item.soort === 'blok') return P.datumKort(item.datum) + (item.start ? ' ' + item.start : '');
    if (item.blokken && item.blokken.length) { const b = item.blokken.filter(x => x.datum >= vandaag)[0] || item.blokken[0]; return P.datumKort(b.datum) + (b.start ? ' ' + b.start : ''); }
    if (item.start && item.eind && item.start !== item.eind) return P.datumKort(item.start) + ' – ' + P.datumKort(item.eind);
    return P.datumKort(item.start || item.eind);
  }
  M.rijen = function (item, mw, acties) {
    const taak = item.soort === 'taak', t = item.taak;
    const naam = el('div', { klass: 'mw-naam', tekst: taak ? t.naam : item.naam });
    const extra = [];
    if (taak && item.status === 'wacht') extra.push(el('div', { klass: 'mw-wacht', tekst: 'Wacht: ' + (t.wacht_reden || 'geen reden opgegeven') }));
    else if (taak && item.wacht && item.wacht.wacht) extra.push(el('div', { klass: 'mw-wacht', tekst: 'Wacht op: ' + wachtTekst(item) }));
    if (M.extraRegels) M.extraRegels(item, extra);
    const chips = [];
    if (taak && item.status !== 'todo') chips.push(el('span', { klass: 'mw-chip mw-st-' + item.status, tekst: P.TAAK_STATUS_LABEL[item.status] || item.status }));
    if (!taak) chips.push(el('span', { klass: 'mw-chip', tekst: item.voorstel ? 'Planblok (voorstel)' : 'Planblok' }));
    const rij = el('div', { klass: 'mw-rij', role: 'button', tabindex: '0', title: 'Open het project (taken)' },
      el('span', { klass: 'mw-strook', style: 'background:' + P.projectKleur(item.code) }),
      el('div', { klass: 'mw-tekst' }, naam, el('div', { klass: 'mw-sub', tekst: [projLabel(item.code), wanneer(item, mw.vandaag), taak && item.gepland_min ? uren(item.gepland_min) + ' gepland' : '', (F.persoon === 'iedereen' && item.persoon) ? 'bij ' + persoonNaam(item.persoon) : (F.persoon === 'iedereen' && taak ? 'van niemand' : '')].filter(Boolean).join(' · ') }), extra),
      el('div', { klass: 'mw-chips' }, chips), acties || null);
    const open = () => { markeerGezien(item); D.openProject(item.code); };
    rij.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('button')) return; open(); });
    rij.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === rij) { ev.preventDefault(); open(); } });
    return rij;
  };
  const persoonNaam = slug => { const m = (D.team() || []).find(x => x.slug === slug); return m ? m.naam : slug; };

  M.teken = function () {
    const w = D && D.doc.getElementById('agenda-mijnwerk'); if (!w) return;
    w.textContent = '';
    const stijl = D.doc.getElementById('mw-stijl'); if (!stijl) { const s = el('style', { id: 'mw-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    w.appendChild(filterBalk());
    if (!D.takenKlaar()) w.appendChild(el('div', { klass: 'mw-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const mw = M.bereken(); M.laatste = mw;
    const balk = weekBalk(mw.week); if (balk) w.appendChild(balk);
    let leeg = true;
    GROEPEN.forEach(([k, titel]) => {
      const items = (mw.groepen[k] || []); if (!items.length) return; leeg = false;
      w.appendChild(el('div', { klass: 'mw-kop' + (k === 'teLaat' ? ' alarm' : ''), tekst: titel + ' (' + items.length + ')' }));
      items.forEach(i => w.appendChild(M.rijen(i, mw, M.actieKnoppen ? M.actieKnoppen(i, k) : null)));
    });
    if (mw.groepen.nietVrij.length) {
      leeg = false;
      w.appendChild(el('details', { klass: 'mw-niet-vrij' }, el('summary', { tekst: 'Nog niet vrijgegeven (' + mw.groepen.nietVrij.length + ')' }), mw.groepen.nietVrij.map(i => M.rijen(i, mw))));
    }
    if (leeg) w.appendChild(el('div', { klass: 'mw-leeg', tekst: F.persoon === 'ik' ? 'Niets voor jou op dit moment.' : 'Niets gevonden voor deze keuze.' }));
  };
  const STIJL = '#agenda-mijnwerk{padding:4px 2px}.mw-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.mw-filters select{width:auto;min-width:160px}'
    + '.mw-week{background:var(--surface,#fff);border:1px solid var(--border,#ddd);border-radius:8px;padding:10px 12px;margin-bottom:10px}.mw-dagen{display:inline-flex;gap:6px;margin-left:12px}.mw-dag{display:inline-flex;flex-direction:column;align-items:center;font-size:10px;text-transform:uppercase;color:var(--text-faint,#888);opacity:1}.mw-dag.vrij{opacity:.4}'
    + '.mw-dag i{display:block;width:22px;height:6px;border-radius:3px;background:#d6dedb;margin-top:2px}.mw-dag i.vol{background:#4A7A5C}'
    + '.mw-kop{font:500 11px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--text-faint,#888);margin:14px 0 6px}.mw-kop.alarm{color:#8B1A1A}'
    + '.mw-rij{display:flex;align-items:stretch;gap:10px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--surface,#fff);margin-bottom:6px;cursor:pointer;overflow:hidden}.mw-rij:hover,.mw-rij:focus{background:#f1f6f3;outline:none}'
    + '.mw-strook{flex:0 0 6px}.mw-tekst{flex:1;min-width:0;padding:7px 0}.mw-naam{font-weight:600}.mw-sub{font-size:12px;color:var(--text-dim,#666)}.mw-wacht{font-size:12px;color:#7A6010}.mw-voorstel{font-size:12px;color:#7A6010}'
    + '.mw-chips{display:flex;flex-direction:column;gap:4px;justify-content:center;align-items:flex-end;padding-right:6px}.mw-chip{font:10px var(--mono,monospace);padding:2px 9px;border-radius:20px;background:#eef1f0;color:#555;white-space:nowrap}'
    + '.mw-st-bezig{background:#E8EDFB;color:#1A3A8B}.mw-st-wacht{background:#FBF5E0;color:#7A6010}.mw-acties{display:flex;gap:6px;align-items:center;padding-right:8px}'
    + '.mw-melding{background:#FBF0E0;border:1px solid #E8D48A;color:#7A6010;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:13px}.mw-leeg{color:var(--text-faint,#888);padding:16px 4px}.mw-niet-vrij{margin-top:14px}.mw-niet-vrij summary{cursor:pointer;font:500 11px var(--mono,monospace);text-transform:uppercase;letter-spacing:.08em;color:var(--text-faint,#888);margin-bottom:6px}';

  // Voorstellen van de werkplaats (stap 2c): de markering staat bij de taak; kantoor neemt over (de markering eraf) of wijst af (tombstone + journaalregel).
  // De schrijfacties zelf (rechten taken:alles, hercontrole na de dialoog, journaal) doet de cockpit via D.neemOver en D.wijsAf; hier alleen de knoppen.
  M.extraRegels = function (item, extra) {
    if (item.soort === 'taak' && item.taak.voorstel) extra.push(el('div', { klass: 'mw-voorstel', tekst: P.voorstelTekst(item.taak.voorstel) }));
  };
  M.actieKnoppen = function (item) {
    if (!D.voorstellen || item.soort !== 'taak' || !item.taak.voorstel) return null;
    if (!(D.magBeslissen && D.magBeslissen())) return el('div', { klass: 'mw-acties' }, el('span', { klass: 'mw-sub', tekst: 'Kantoor beslist' }));
    const doe = async fn => { try { await fn(item.code, item.id); } finally { M.teken(); } };
    return el('div', { klass: 'mw-acties' },
      el('button', { type: 'button', klass: 'btn btn-xs btn-secondary', title: 'De markering eraf: het is dan een gewone taak', tekst: 'Overnemen', klik: () => doe(D.neemOver) }),
      el('button', { type: 'button', klass: 'btn btn-xs btn-danger', title: 'Van de takenlijst halen (blijft in het journaal)', tekst: 'Afwijzen', klik: () => doe(D.wijsAf) }));
  };

  M.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return M; };
  M.F = F;
  root.MTMijnWerk = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : globalThis);
