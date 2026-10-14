/* ============================================================================
 * mt-tv.js — werkplaats-tv (planning stap 2d): een groot, donker scherm dat alleen TOONT
 * ----------------------------------------------------------------------------
 * Drie grote tabs (Kalender · Projecten · Let op), elke 60 seconden ververst, na 2 minuten zonder aanraking terug naar de Kalender.
 * Tikken opent een grote kaart met de details en (zodra de QR er is) een code die het op de telefoon opent. Wijzigen doe je op de eigen telefoon.
 *
 * Alleen lezen, per constructie: de pagina geeft dit bestand een lezer ({ read(bestand) }) en niets anders. Er is geen schrijfroute, geen naam-tikken en geen slepen,
 * en er worden geen geldgegevens gelezen (alleen takenlijst, afhankelijkheden, planblokken, projecten en bestellijst). De rekenregels staan in mt-planning.js.
 * Alles komt van buiten via init(deps), zodat het zonder de pagina te testen is. Tekent met DOM-calls, nooit met opgebouwde HTML.
 * ========================================================================== */
(function (root) {
  'use strict';
  const T = {};
  let D = null, P = null;
  const S = { data: null, staat: 'laden', fout: '', tab: 'kalender', kaart: null, bezig: false, laatsteOk: 0, idle: null, ververs: null, laadFout: '' };
  const IDLE_MS = 120000, VERVERS_MS = 60000;

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
  const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // ── de gegevens (alleen lezen) ──
  const lijstVan = r => (Array.isArray(r) ? r : []).filter(x => x && typeof x === 'object');
  async function leesOpt(naam) { try { return { ok: true, data: await D.sp.read(naam) }; } catch (e) { return { ok: false, fout: String((e && e.message) || e) }; } }
  T.laad = async function () {
    if (S.bezig) return;
    S.bezig = true;
    try {
      const [tk, af, bl, pr, be] = await Promise.all(['mt_project_taken_v2.json', 'mt_project_afhank.json', 'mt_planblokken.json', 'mt_projecten.json', 'mt_bestellijst_v2.json'].map(leesOpt));
      let nrs = {}; try { nrs = (D.nummers ? await D.nummers() : null) || {}; } catch (e) { nrs = {}; }
      if (!tk.ok) { S.laadFout = 'Verversen mislukt (' + tk.fout + ')'; if (!S.data) S.staat = 'fout'; return; }
      if (tk.data === null || tk.data === undefined) { S.staat = 'overzetten'; S.data = null; return; }
      const vorm = P.takenBestandVorm(tk.data); if (vorm) { S.staat = 'fout'; S.fout = 'De takenlijst heeft een verkeerde vorm: ' + vorm; return; }
      let taken; try { taken = P.takenSamen(null, tk.data); } catch (e) { S.staat = 'fout'; S.fout = 'De takenlijst is niet te lezen.'; return; }
      const projecten = lijstVan(pr.ok ? pr.data : null).filter(p => p.code && !p._vervallen);
      const bestel = be.ok && Array.isArray(be.data) && !P.bestelBestandVorm(be.data) ? lijstVan(be.data).filter(b => b.id !== '__migratie' && !b._vervallen) : [];
      S.data = { taken, afh: af.ok && af.data && typeof af.data === 'object' && !Array.isArray(af.data) ? af.data : {}, blokken: lijstVan(bl.ok ? bl.data : null), projecten, bestel, nrs: nrs && typeof nrs === 'object' ? nrs : {} };
      S.staat = 'klaar'; S.fout = ''; S.laadFout = ''; S.laatsteOk = D.nu();
    } finally { S.bezig = false; }
  };

  // ── projecten: naam en kleur ──
  const projVan = code => { const c = String(code || '').toLowerCase(); return S.data ? S.data.projecten.find(p => String(p.code).toLowerCase() === c) || null : null; };
  function projNaam(p, code) {
    if (!p) return String(code || '');
    const c = String(p.code || '').trim(); let n = String(p.naam || '').trim();
    if (c && n.toUpperCase().startsWith(c.toUpperCase())) n = n.slice(c.length).replace(/^[\s\-–—·:|]+/, '').trim();
    return n || c;
  }
  const projNr = p => { if (!p) return ''; const k = S.data && S.data.nrs; return String((k && p.project_id && k[p.project_id]) || p.projectnummer || p.werkcode || '').trim(); };
  const projLabel = code => { const p = projVan(code); return [projNr(p), projNaam(p, code)].filter(Boolean).join(' ') || String(code || ''); };
  const projKort = code => { const p = projVan(code); return projNr(p) || projNaam(p, code); };
  const persoonNaam = slug => { const m = (D.team() || []).find(x => String(x.slug).toLowerCase() === String(slug || '').toLowerCase()); return m ? (m.naam || m.slug) : (slug || 'niemand'); };

  // ── de grote kaart ──
  function rijKaart(label, waarde) { return waarde ? el('div', { klass: 'tv-kaartrij' }, el('span', { klass: 'tv-kaartlabel', tekst: label }), el('span', { klass: 'tv-kaartwaarde', tekst: waarde })) : null; }
  T.kaartTekst = function (item) {
    const t = item.taak, rijen = [];
    rijen.push(['Project', projLabel(item.code)]);
    if (item.soort === 'taak' || item.soort === 'blok') {
      rijen.push(['Status', item.soort === 'blok' ? (item.planvoorstel ? 'Planblok (voorstel)' : 'Planblok') : (P.TAAK_STATUS_LABEL[item.status] || item.status)]);
      if (item.persoon || item.soort === 'taak') rijen.push(['Wie', item.persoon ? persoonNaam(item.persoon) : 'nog van niemand']);
      if (t && (t.start || t.eind)) rijen.push(['Wanneer', t.start && t.eind && t.start !== t.eind ? P.datumKort(t.start) + ' – ' + P.datumKort(t.eind) : P.datumKort(t.start || t.eind)]);
      if (item.start) rijen.push(['Planblok', P.datumKort(item.datum || '') + ' ' + item.start + (item.min ? ' (' + uren(item.min) + ')' : '')]);
      if (t && P.taakBudgetMin(t) > 0) rijen.push(['Uren gepland', uren(P.taakBudgetMin(t))]);
      if (t && item.status === 'wacht') rijen.push(['Wacht', t.wacht_reden || 'geen reden opgegeven']);
      else if (item.wacht && item.wachtTekst) rijen.push(['Wacht op', item.wachtTekst]);
      if (t && t.voorstel) rijen.push(['Gemeld', P.voorstelTekst(t.voorstel)]);
      if (t && t.omschrijving) rijen.push(['Omschrijving', t.omschrijving]);
    } else {
      (item.regels || []).forEach(r => rijen.push(r));
    }
    return rijen;
  };
  T.toonKaart = function (item, titel) {
    aanraking();   // een kaart openen telt als aanraking: de twee minuten lopen vanaf nu
    S.kaart = { item, titel: titel || (item.naam || 'Details') };
    tekenKaart();
  };
  T.sluitKaart = function () { S.kaart = null; tekenKaart(); };
  // De link naar de telefoon: een taak opent de taakkaart op mobiel.html (#taak/<code>/<id>), al het andere het project (#project/<code>). De pagina geeft de basis-URL van
  // mobiel.html mee (linkBasis); een QR-tekenaar (D.qr(element, tekst)) is optioneel: zonder staat de link als tekst op de kaart.
  T.linkVoor = function (item) {
    if (!D.linkBasis || !item || !item.code) return '';
    return item.soort === 'taak' && item.id ? P.deepLinkTaak(D.linkBasis, item.code, item.id) : P.deepLinkProject(D.linkBasis, item.code);
  };
  function kaartLink(item) {
    const link = T.linkVoor(item); if (!link) return null;
    const qr = el('div', { klass: 'tv-qr', 'aria-label': 'QR-code voor de telefoon' });
    if (typeof D.qr === 'function') { try { D.qr(qr, link); } catch (e) { qr.textContent = ''; } }
    return el('div', { klass: 'tv-kaartrij tv-telefoon' }, el('span', { klass: 'tv-kaartlabel', tekst: 'Op je telefoon' }), el('span', { klass: 'tv-kaartwaarde' }, qr.childNodes.length ? qr : null, el('span', { klass: 'tv-link', tekst: link })));
  }
  function tekenKaart() {
    const host = D.doc.getElementById('tv-kaart'); if (!host) return;
    host.textContent = '';
    if (!S.kaart) { host.className = 'tv-kaart-uit'; return; }
    host.className = 'tv-kaart-aan';
    const it = S.kaart.item, rijen = T.kaartTekst(it);
    const extra = kaartLink(it);
    host.appendChild(el('div', { klass: 'tv-kaartdoos', role: 'dialog', 'aria-modal': 'true' },
      el('div', { klass: 'tv-kaartkop' }, el('span', { klass: 'tv-punt', style: 'background:' + P.projectKleur(it.code) }), el('h2', { tekst: S.kaart.titel }),
        el('button', { klass: 'tv-sluit', type: 'button', klik: () => T.sluitKaart(), tekst: 'Sluiten' })),
      el('div', { klass: 'tv-kaartinhoud' }, rijen.map(([l, w]) => rijKaart(l, w)), extra)));
    host.onclick = ev => { if (ev.target === host) T.sluitKaart(); };
  }

  // ── tab 1: Kalender (twee weken, een rij per persoon, per dagdeel) ──
  function blokKnop(item) {
    const kleur = P.projectKleur(item.code), vlag = [];
    if (item.wacht) vlag.push('⏳');
    if (item.voorstel) vlag.push('★');
    if (item.planvoorstel) vlag.push('?');
    return el('button', { klass: 'tv-blok' + (item.wacht ? ' wacht' : '') + (item.status === 'bezig' ? ' bezig' : ''), type: 'button', style: 'background:' + kleur, title: item.naam,
      klik: () => T.toonKaart(item) },
      el('span', { klass: 'tv-blok-proj', tekst: projKort(item.code) }), el('span', { klass: 'tv-blok-naam', tekst: (vlag.length ? vlag.join('') + ' ' : '') + item.naam }));
  }
  function tekenKalender(w) {
    const r = P.weekRooster(S.data.taken, S.data.afh, S.data.blokken, { team: D.team(), vandaag: P.vandaagYmd(), weken: 2, vrij: D.vrij ? D.vrij() : null });
    // kolommen: persoon | dagdeel | een kolom per werkdag; per persoon twee rijen (ochtend en middag), zodat een blok breed genoeg blijft om te lezen
    const raster = el('div', { klass: 'tv-raster', style: 'grid-template-columns:140px 74px repeat(' + r.dagen.length + ',minmax(0,1fr))' });
    const hoek = el('div', { klass: 'tv-hoek' }); hoek.style.gridColumn = 'span 2'; raster.appendChild(hoek);
    r.dagen.forEach(d => raster.appendChild(el('div', { klass: 'tv-dagkop' + (d.nu ? ' nu' : '') + (d.werkdag ? '' : ' vrij') + (d.week ? ' w2' : ''), tekst: P.datumKort(d.datum) })));
    r.rijen.forEach(rij => {
      const p = el('div', { klass: 'tv-persoon', tekst: rij.naam }); p.style.gridRow = 'span 2'; raster.appendChild(p);
      [0, 1].forEach(dl => {
        raster.appendChild(el('div', { klass: 'tv-deellabel', tekst: dl ? 'middag' : 'ochtend' }));
        r.dagen.forEach((d, i) => raster.appendChild(el('div', { klass: 'tv-cel' + (d.nu ? ' nu' : '') + (d.werkdag ? '' : ' vrij') + (d.week ? ' w2' : '') }, rij.cellen[i][dl].map(blokKnop))));
      });
    });
    w.appendChild(raster);
    if (!r.rijen.length) w.appendChild(el('div', { klass: 'tv-leeg', tekst: 'Geen teamleden of niets gepland.' }));
  }

  // ── tab 2: Projecten (de stroom: een rij per actief project door de keten) ──
  const FASE = { werkvoorbereiding: 'Werkvoorbereiding', inkoop: 'Inkoop', productie: 'Productie', klaar_levering: 'Klaar voor levering' };
  const vrijDagen = () => (D.vrij ? D.vrij() : null);
  T.projectRijen = () => P.projectStroom(S.data.taken, S.data.afh, S.data.projecten, { vandaag: P.vandaagYmd(), bestel: S.data.bestel, vrij: vrijDagen() });
  function projectKaartItem(r) {
    return { soort: 'project', id: 'project:' + r.code, code: r.code, naam: projLabel(r.code), vlag: r.vlag, regels: [['Project', projLabel(r.code)], ['Fase', FASE[r.fase] || r.fase || ''], ['Leverdatum', r.lever ? P.datumKort(r.lever) : 'niet ingevuld'],
      ['Voortgang', r.klaar + ' van ' + r.totaal + ' taken klaar'], ['Te laat', r.teLaat ? r.teLaat + (r.teLaat === 1 ? ' taak' : ' taken') : ''], ['Let op', r.reden]].concat(r.stations.filter(s => s.n || s.staat !== 'leeg').map(s => [s.l, s.staat + (s.n ? ' (' + s.klaar + ' van ' + s.n + ' klaar)' : '')])) };
  }
  function tekenProjecten(w) {
    const rijen = T.projectRijen();
    if (!rijen.length) { w.appendChild(el('div', { klass: 'tv-leeg', tekst: 'Geen actieve projecten.' })); return; }
    const lijst = el('div', { klass: 'tv-stroom' });
    rijen.forEach(r => {
      const open = () => T.toonKaart(projectKaartItem(r));
      const rij = el('div', { klass: 'tv-sr' + (r.vlag ? ' vlag' : ''), role: 'button', tabindex: '0' },
        el('div', { klass: 'tv-sr-kop' }, el('span', { klass: 'tv-punt', style: 'background:' + P.projectKleur(r.code) }),
          el('div', { klass: 'tv-sr-naam' }, el('b', { tekst: projLabel(r.code) }), el('div', { klass: 'tv-sr-sub', tekst: [FASE[r.fase] || r.fase, r.totaal ? r.klaar + ' van ' + r.totaal + ' taken klaar' : 'nog geen taken', r.teLaat ? r.teLaat + ' te laat' : ''].filter(Boolean).join(' · ') })),
          el('div', { klass: 'tv-sr-lever' + (r.vlag ? ' vlag' : '') }, r.vlag ? el('span', { klass: 'tv-vlag', title: r.reden, tekst: '⚑ ' }) : null, el('span', { tekst: r.lever ? 'lever ' + P.datumKort(r.lever) : 'geen leverdatum' }))),
        el('div', { klass: 'tv-stations' }, r.stations.map((s, i) => [i ? el('span', { klass: 'tv-pijl', tekst: '›' }) : null, el('div', { klass: 'tv-station ' + s.staat, title: s.l + ': ' + s.staat }, el('span', { klass: 'tv-st-naam', tekst: s.l }), el('span', { klass: 'tv-st-tel', tekst: s.n ? s.klaar + '/' + s.n : (s.staat === 'leeg' ? '—' : s.staat) }))])),
        r.vlag ? el('div', { klass: 'tv-reden', tekst: r.reden }) : null);
      rij.addEventListener('click', open); rij.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
      lijst.appendChild(rij);
    });
    w.appendChild(lijst);
  }

  // ── tab 3: Let op ──
  const LETOP = [['wachtMateriaal', 'Wacht op materiaal'], ['wachtVoorganger', 'Wacht op een voorganger'], ['wachtAnders', 'Wacht (andere reden)'], ['teLaat', 'Te laat'], ['nieuwGemeld', 'Nieuw gemeld'], ['teLeveren', 'Deze week te leveren']];
  T.letOpData = () => P.letOp(S.data.taken, S.data.afh, S.data.projecten, S.data.bestel, { vandaag: P.vandaagYmd(), team: D.team(), vrij: vrijDagen() });
  const letOpAantal = () => { if (!S.data) return 0; const l = T.letOpData(); return l.wachtMateriaal.length + l.wachtVoorganger.length + l.wachtAnders.length + l.teLaat.length + l.nieuwGemeld.length; };
  function letOpTekst(k, i) {
    if (k === 'wachtMateriaal') return i.soort === 'bestel' ? '' : (i.reden || '');
    if (k === 'wachtVoorganger') return 'Wacht op: ' + i.wachtTekst;
    if (k === 'wachtAnders') return i.reden || 'geen reden opgegeven';
    if (k === 'teLaat') return 'had klaar moeten zijn op ' + P.datumKort(i.eind) + (i.dagen > 0 ? ' (' + i.dagen + ' werkdag' + (i.dagen === 1 ? '' : 'en') + ' geleden)' : '') + (i.persoon ? ' · ' + persoonNaam(i.persoon) : '');
    if (k === 'nieuwGemeld') return i.voorstel ? P.voorstelTekst(i.voorstel) : '';
    if (k === 'teLeveren') return 'lever ' + P.datumKort(i.lever) + ' · ' + i.open + (i.open === 1 ? ' taak' : ' taken') + ' open';
    return '';
  }
  function tekenLetOp(w) {
    const l = T.letOpData(), raster = el('div', { klass: 'tv-letop' });
    LETOP.forEach(([k, titel]) => {
      const items = l[k];
      raster.appendChild(el('section', { klass: 'tv-lo' + (k === 'teLaat' && items.length ? ' alarm' : '') + (items.length ? '' : ' leeg') },
        el('h3', { tekst: titel + (items.length ? ' (' + items.length + ')' : '') }),
        items.length ? items.map(i => el('button', { klass: 'tv-lo-item', type: 'button', klik: () => T.toonKaart(i, i.naam) },
          el('span', { klass: 'tv-strook', style: 'background:' + P.projectKleur(i.code) }),
          el('span', { klass: 'tv-lo-tekst' }, el('span', { klass: 'tv-lo-naam', tekst: projKort(i.code) + (i.code ? ' · ' : '') + i.naam }), el('span', { klass: 'tv-lo-sub', tekst: letOpTekst(k, i) })))) : el('div', { klass: 'tv-lo-niets', tekst: 'Niets' })));
    });
    w.appendChild(raster);
  }

  // ── het scherm: tabs, melding, inhoud ──
  const TABS = [['kalender', 'Kalender', tekenKalender], ['projecten', 'Projecten', tekenProjecten], ['letop', 'Let op', tekenLetOp, letOpAantal]];
  T.tabs = TABS;
  T.zetTab = function (k) { if (TABS.some(t => t[0] === k)) { S.tab = k; T.teken(); } };
  T.teken = function () {
    const wortel = D && D.doc.getElementById('tv-inhoud'); if (!wortel) return;
    const balk = D.doc.getElementById('tv-tabs');
    if (balk) {
      balk.textContent = '';
      TABS.forEach(([k, l, , badge]) => { let n = 0; try { n = badge && S.data ? badge() : 0; } catch (e) { n = 0; }
        balk.appendChild(el('button', { klass: 'tv-tab' + (S.tab === k ? ' actief' : ''), type: 'button', 'aria-pressed': S.tab === k ? 'true' : 'false', klik: () => T.zetTab(k), tekst: l + (n ? ' (' + n + ')' : '') })); });
    }
    const st = D.doc.getElementById('tv-status');
    if (st) st.textContent = [S.laatsteOk ? 'bijgewerkt ' + hhmm(S.laatsteOk) : '', S.laadFout].filter(Boolean).join(' · ');
    wortel.textContent = '';
    if (S.staat === 'laden') wortel.appendChild(el('div', { klass: 'tv-leeg', tekst: 'Laden…' }));
    else if (S.staat === 'overzetten') wortel.appendChild(el('div', { klass: 'tv-leeg', tekst: 'De takenlijst wordt overgezet door beheer. Tot die tijd is er hier niets te zien.' }));
    else if (S.staat === 'fout' && !S.data) wortel.appendChild(el('div', { klass: 'tv-leeg', tekst: S.fout || ('Laden is niet gelukt. ' + S.laadFout) }));
    else if (S.data) { const t = TABS.find(x => x[0] === S.tab) || TABS[0]; t[2](wortel); }
    tekenKaart();
  };

  // ── ververs elke minuut, terug naar de Kalender na 2 minuten zonder aanraking ──
  function aanraking() {
    if (S.idle !== null) D.timer.clearTimeout(S.idle);
    S.idle = D.timer.setTimeout(() => { S.idle = null; if (S.kaart) T.sluitKaart(); if (S.tab !== 'kalender') T.zetTab('kalender'); }, IDLE_MS);
  }
  T.start = async function () {
    ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'wheel'].forEach(ev => D.doc.addEventListener(ev, aanraking, { passive: true }));
    aanraking();
    S.ververs = D.timer.setInterval(() => { T.laad().then(() => T.teken()).catch(() => T.teken()); }, VERVERS_MS);
    T.teken();
    await T.laad(); T.teken();
  };
  T.stop = function () { if (S.ververs !== null) D.timer.clearInterval(S.ververs); if (S.idle !== null) D.timer.clearTimeout(S.idle); S.ververs = S.idle = null; };

  T.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    if (!D.timer) D.timer = { setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root), setInterval: root.setInterval.bind(root), clearInterval: root.clearInterval.bind(root) };
    return T;
  };
  T.S = S; T.IDLE_MS = IDLE_MS; T.VERVERS_MS = VERVERS_MS;
  root.MTTv = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
