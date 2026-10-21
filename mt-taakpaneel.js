/* ============================================================================
 * mt-taakpaneel.js: één taakpaneel voor de hele cockpit (Bart 21-10: "taken uitvouwen als je erop klikt, alles inzien en bewerken, en overal zien waar de taak bij hoort")
 * ----------------------------------------------------------------------------
 * Een paneel rechts (telefoonbreedte: volledig scherm) met eigen link #taak/<projectcode>/<taak-id> (dezelfde vorm als de telefoon-deeplink, MTPlanning.deepLinkLees).
 * Het opent vanuit de Capaciteit, Mijn werk, Vandaag, de takenlijst van een project en de zoekbalk: overal hetzelfde paneel.
 * Bovenaan altijd de herkomst (klant › locatie › project), elk deel een gewone link naar de bestaande klant- en projectpagina.
 * Niet-modaal: de lijst of tijdlijn erachter blijft zichtbaar en bruikbaar; een andere taak aanklikken wisselt het paneel. Esc of × sluit, de terugknop van de browser ook.
 * Tekent met DOM-calls, nooit met opgebouwde HTML. Alles komt van buiten via init(deps), zodat het zonder de hele cockpit te testen is; model() is rekenwerk zonder DOM.
 * ========================================================================== */
(function (root) {
  'use strict';
  const T = {};
  let D = null, P = null;
  const S = { open: null, gepusht: false, terugFocus: null, wachtStart: null };
  const START = (typeof location !== 'undefined' && location.hash) || '';   // een deeplink bij het opstarten: de cockpit zet de URL daarna naar de starttab

  // ── kleine hulpjes ──
  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const ymdOk = s => !!(P && P.isYmd(s));
  const datum = s => ymdOk(s) ? P.datumKort(s) : '';
  const STATUS_KL = { todo: 'open', bezig: 'bezig', wacht: 'wacht', klaar: 'klaar' };
  const PRIO = { high: 'P1 hoog', medium: 'P2 normaal', low: 'P3 laag' };
  const persNaam = slug => { const m = ((D && D.team && D.team()) || []).find(x => x && zelfde(x.slug, slug)); return m ? m.naam : String(slug || ''); };

  T.href = (code, id) => P.deepLinkTaak('', code, id);

  // ── rekenwerk (geen DOM) ──
  // → { ok:false } | { ok:true, code, taak, project, voorgangers, opvolgers, wacht, bestel, rechten }
  T.model = function (code, id) {
    const alle = D.taken() || {}, k = sleutelVan(alle, code), lijst = k ? (alle[k] || []).filter(x => x && !x._vervallen) : [];
    const t = lijst.find(x => String(x.id) === String(id));
    if (!t) return { ok: false, code, id };
    const pr = (D.project && D.project(k || code)) || { code: k || code, naam: '', nummer: '' };
    const afh = D.afhank() || {}, ak = sleutelVan(afh, k || code), depsRuw = ak && Array.isArray(afh[ak]) ? afh[ak] : [];
    const vrij = D.vrij ? D.vrij() : null, vandaag = P.vandaagYmd();
    const perId = new Map(lijst.map(x => [String(x.id), x]));
    const kort = x => ({ id: x.id, naam: x.naam || '(zonder naam)', status: x.status || 'todo', start: ymdOk(x.start) ? x.start : '', eind: ymdOk(x.eind) ? x.eind : '', soort: x.soort || '' });
    // FS met wachttijd: de opvolger begint op zijn vroegst `lag` werkdagen + 1 na het eind van de voorganger (een mijlpaal: `lag` werkdagen erna, zoals P.rooster)
    const vroegst = (voor, lag, na) => ymdOk(voor.eind) ? P.addWerkdagen(voor.eind, (Number(lag) || 0) + (na && na.soort === 'mijlpaal' ? 0 : 1), vrij) : '';
    let edges = []; try { edges = P.depsEffectief(lijst, depsRuw); } catch (e) { edges = []; }
    const voorgangers = edges.filter(e => String(e.naar) === String(t.id)).map(e => {
      const v = perId.get(String(e.van)); if (!v) return null;
      const r = Object.assign(kort(v), { lag: e.lag || 0, inactief: !!e.inactief, vroegst: vroegst(v, e.lag, t) });
      r.botst = !r.inactief && r.status !== 'klaar' && ymdOk(t.start) && !!r.vroegst && t.start < r.vroegst;
      return r;
    }).filter(Boolean);
    const opvolgers = edges.filter(e => String(e.van) === String(t.id)).map(e => {
      const n = perId.get(String(e.naar)); if (!n) return null;
      const r = Object.assign(kort(n), { lag: e.lag || 0, inactief: !!e.inactief, vroegst: vroegst(t, e.lag, n) });
      r.botst = !r.inactief && (t.status || 'todo') !== 'klaar' && r.status !== 'klaar' && !!r.start && !!r.vroegst && r.start < r.vroegst;
      return r;
    }).filter(Boolean);
    let wacht = { wacht: false, op: [] }; try { wacht = P.taakWacht(t, lijst, depsRuw, { vrij, vandaag }); } catch (e) {}
    // Bestellingen: er is (nog) geen koppeling per taak; dit zijn de regels van het project (zelfde regel als MTPlanning.projectStroom).
    const VOLG = { nodig: 0, besteld: 1, geleverd: 2 };
    const regels = (D.bestel ? D.bestel() || [] : []).filter(b => b && typeof b === 'object' && !b._vervallen && b.id !== '__migratie' && ((b.project_id && pr.project_id && b.project_id === pr.project_id) || zelfde(b.project, pr.code)))
      .map(b => { const st = P.bestelStatus(b); return { id: b.id, oms: P.bestelOms(b) || 'regel', aantal: b.aantal || 1, eenheid: P.eenheidTekst(b.eenheid, b.aantal || 1), leverancier: b.leverancier || '', status: st, label: P.BESTEL_STATUS_LABEL[st] || st, voorstel: b.voorstel ? P.voorstelTekst(b.voorstel) : '' }; })
      .sort((a, b) => (VOLG[a.status] - VOLG[b.status]) || String(a.oms).localeCompare(String(b.oms), 'nl'));
    const tel = { nodig: 0, besteld: 0, geleverd: 0 }; regels.forEach(r => { tel[r.status] = (tel[r.status] || 0) + 1; });
    const materiaal = t.sleutel === 'bestellen' || t.sleutel === 'materiaal_geleverd' || (t.status === 'wacht' && /\b(materiaal|plaat|platen|beslag|bestel|besteld|bestelling|levering|leverancier|geleverd|order)/i.test(String(t.wacht_reden || '')));
    return { ok: true, code: k || code, taak: t, project: pr, voorgangers, opvolgers, wacht, bestel: { regels, tel, materiaal }, mensen: P.taakMensen(t), raming: P.taakRamingMin(t) };
  };

  // ── tekenen ──
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
  const IC = { terug: 'M15 6l-6 6l6 6', sluit: 'M6 6l12 12M18 6L6 18', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', pijl: 'M9 6l6 6l-6 6', let: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01' };
  // Een gewone link (Ctrl/Shift/middelklik = nieuw tabblad); een gewone klik gaat via de cockpit-route
  const link = (href, ga, kids, klass, extra) => el('a', Object.assign({ klass: klass || 'tp-link', href: href || '#', klik: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1) return; ev.preventDefault(); ga(); } }, extra || {}), kids);
  const chip = (tekst, kl, titel) => el('span', { klass: 'tp-chip' + (kl ? ' ' + kl : ''), title: titel || null, tekst });
  const rij = (label, ...waarde) => el('div', { klass: 'tp-rij' }, el('div', { klass: 'tp-label', tekst: label }), el('div', { klass: 'tp-waarde' }, waarde));
  const sectie = (id, titel, rechts, ...kids) => el('section', { klass: 'tp-sec', 'aria-labelledby': id }, el('div', { klass: 'tp-sec-kop' }, el('h3', { id, tekst: titel }), rechts || null), kids);

  function herkomst(m) {
    const pr = m.project, h = D.href || {}, g = D.ga || {}, delen = [];
    if (pr.klant) delen.push(link(h.klant ? h.klant(pr.klant) : '#', () => { T.sluit({ stil: true }); g.klant(pr.klant); }, pr.klantNaam || pr.klant, 'tp-link tp-kruim', { title: 'Naar de klant' }));
    if (pr.klant && pr.loc) delen.push(link(h.klant ? h.klant(pr.klant, pr.loc) : '#', () => { T.sluit({ stil: true }); g.klant(pr.klant, pr.loc); }, pr.locNaam || pr.loc, 'tp-link tp-kruim', { title: 'Naar de locatie' }));
    delen.push(link(h.project ? h.project(m.code) : '#', () => { T.sluit({ stil: true }); g.project(m.code, 'planning'); }, [pr.nummer ? el('span', { klass: 'tp-code', tekst: pr.nummer }) : null, pr.nummer ? ' ' : '', pr.naam || m.code], 'tp-link tp-kruim tp-kruim-project', { title: 'Naar het project (Planning & taken)' }));
    const nav = el('nav', { klass: 'tp-herkomst', 'aria-label': 'Hoort bij' });
    delen.forEach((d, i) => { if (i) nav.appendChild(el('span', { klass: 'tp-sep', 'aria-hidden': 'true', tekst: '›' })); nav.appendChild(d); });
    return nav;
  }

  function taakRegel(x, wat) {
    const sub = [P.TAAK_STATUS_LABEL[x.status] || x.status, x.start ? (x.eind && x.eind !== x.start ? datum(x.start) + ' – ' + datum(x.eind) : datum(x.start)) : 'zonder datum', x.lag ? 'wachttijd ' + x.lag + ' werkdag' + (x.lag === 1 ? '' : 'en') : '', x.inactief ? 'koppeling staat uit' : ''].filter(Boolean).join(' · ');
    return el('li', null, link(T.href(S.open.code, x.id), () => T.open(S.open.code, x.id), [
      el('span', { klass: 'tp-dot tp-st-' + (STATUS_KL[x.status] || 'open'), 'aria-hidden': 'true' }),
      el('span', { klass: 'tp-tekst' }, el('span', { klass: 'tp-naam', tekst: x.naam }), el('span', { klass: 'tp-sub', tekst: sub })),
      x.botst ? chip('let op', 'tp-chip-let', wat === 'voor' ? 'Eindigt te laat voor de start van deze taak' : 'Begint te vroeg na het eind van deze taak') : null,
      icoon(IC.pijl)], 'tp-link tp-taakrij', { title: 'Open ' + x.naam }));
  }

  function afhSectie(m) {
    const kids = [], t = m.taak;
    if (!m.voorgangers.length && !m.opvolgers.length) kids.push(el('p', { klass: 'tp-leeg', tekst: 'Geen voorgangers of opvolgers.' }));
    if (m.voorgangers.length) kids.push(el('div', { klass: 'tp-subkop', tekst: 'Eerst (voorgangers)' }), el('ul', { klass: 'tp-lijst' }, m.voorgangers.map(x => taakRegel(x, 'voor'))));
    if (m.opvolgers.length) kids.push(el('div', { klass: 'tp-subkop', tekst: 'Daarna (opvolgers)' }), el('ul', { klass: 'tp-lijst' }, m.opvolgers.map(x => taakRegel(x, 'na'))));
    const waarsch = m.voorgangers.filter(x => x.botst).map(x => x.naam + ' eindigt ' + datum(x.eind) + '; deze taak kan op zijn vroegst ' + datum(x.vroegst) + ' beginnen (nu ' + datum(t.start) + ').')
      .concat(m.opvolgers.filter(x => x.botst).map(x => x.naam + ' begint al ' + datum(x.start) + '; dat kan op zijn vroegst ' + datum(x.vroegst) + ' (na het eind van deze taak).'));
    if (waarsch.length) kids.push(el('div', { klass: 'tp-waarsch', role: 'note' }, icoon(IC.let), el('div', null, waarsch.map(w => el('div', { tekst: w })), el('div', { klass: 'tp-sub', tekst: 'Er wordt niets vanzelf verschoven.' }))));
    if ((t.status || 'todo') === 'todo' && m.wacht && m.wacht.wacht) kids.push(el('p', { klass: 'tp-sub', tekst: 'Wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) }));
    return sectie('tp-h-afh', 'Afhankelijkheden', el('span', { klass: 'tp-teller', tekst: String(m.voorgangers.length + m.opvolgers.length) }), kids);
  }

  function bestelSectie(m) {
    const b = m.bestel, g = D.ga || {}, h = D.href || {};
    const tel = ['nodig', 'besteld', 'geleverd'].filter(s => b.tel[s]).map(s => b.tel[s] + ' ' + P.BESTEL_STATUS_LABEL[s].toLowerCase()).join(' · ');
    // elke regel is een link naar de bestellijst van het project (daar zet je de status; hier alleen inzien)
    const lijst = b.regels.length ? el('ul', { klass: 'tp-lijst tp-bestel' }, b.regels.slice(0, 12).map(r => el('li', null, link(h.project ? h.project(m.code, 'productie') : '#', () => { T.sluit({ stil: true }); g.project(m.code, 'productie'); }, [
      el('span', { klass: 'tp-tekst' }, el('span', { klass: 'tp-naam', tekst: r.oms }), el('span', { klass: 'tp-sub', tekst: [String(r.aantal).replace('.', ',') + ' ' + r.eenheid, r.leverancier, r.voorstel].filter(Boolean).join(' · ') })),
      chip(r.label, 'tp-bst-' + r.status), icoon(IC.pijl)], 'tp-link tp-taakrij', { title: 'Naar de bestellijst van dit project' })))) : el('p', { klass: 'tp-leeg', tekst: 'Dit project heeft geen bestelregels.' });
    const meer = b.regels.length > 12 ? el('p', { klass: 'tp-sub', tekst: '… en nog ' + (b.regels.length - 12) + ' regels' }) : null;
    const naar = el('div', { klass: 'tp-acties' },
      link(h.project ? h.project(m.code, 'productie') : '#', () => { T.sluit({ stil: true }); g.project(m.code, 'productie'); }, 'Bestellijst van dit project', 'tp-link tp-knoplink'),
      link(h.bestellijst ? h.bestellijst() : '#', () => { T.sluit({ stil: true }); g.bestellijst(); }, 'Bestellijst (alle projecten)', 'tp-link tp-knoplink'));
    const uitleg = el('p', { klass: 'tp-sub', tekst: 'Bestelregels hangen aan het project, niet aan een losse taak.' });
    const d = el('details', { klass: 'tp-sec tp-details', open: b.materiaal || null },
      el('summary', null, el('h3', { id: 'tp-h-bestel', tekst: 'Bestellingen van dit project' }), el('span', { klass: 'tp-teller', tekst: tel || '0' })), lijst, meer, uitleg, naar);
    return d;
  }

  // ── bewerken (brok 2): alles via de bestaande taakroutes ──
  // Velden: D.wijzig (MTPlanVerplaats.taakWijzig: takenSchrijf met het slot, de tijdgrenzen, de controle achteraf en ongedaan maken met stempelbewaking).
  // Datums: D.datums (de sleep-spec taakdatums via MTCapaciteitNieuw.drop: dezelfde route, dezelfde vraag over opvolgers, dezelfde melding met ongedaan maken als slepen).
  const mag = wat => { try { return !!(D.mag && D.mag[wat] && D.mag[wat]()); } catch (e) { return false; } };
  const GEEN_RECHT = 'Dit mag je niet met jouw rol (kantoor beslist).';
  function opslagStatus(soort, tekst, opnieuw) {
    S.status = soort ? { soort, tekst, opnieuw, t: Date.now(), taak: S.open ? S.open.code + '/' + S.open.id : '' } : null;   // blijft staan als het paneel opnieuw tekent
    const z = D.doc.getElementById('tp-opslag'); if (!z) return;
    clearTimeout(opslagStatus._t); z.textContent = ''; z.className = 'tp-opslag' + (soort ? ' ' + soort : '');
    if (!soort) return;
    z.appendChild(el('span', { tekst }));
    if (opnieuw) z.appendChild(el('button', { type: 'button', klass: 'tp-knop tp-klein', klik: opnieuw, tekst: 'Opnieuw' }));
    if (soort === 'ok') opslagStatus._t = setTimeout(() => { if (z.isConnected && z.classList.contains('ok')) { z.textContent = ''; z.className = 'tp-opslag'; } }, 5000);
  }
  // Eén veldwijziging opslaan. spec = { velden, gezien, reden? }. Meldt eerlijk: Opslaan… · Opgeslagen (met ongedaan maken) · Niet opgeslagen + Opnieuw · tegelijk gewijzigd.
  async function bewaar(spec, wat) {
    if (!S.open || !D.wijzig) return false;
    const code = S.open.code, id = S.open.id, m = T.model(code, id); if (!m.ok) return false;
    const volledig = Object.assign({ code, id, naam: m.taak.naam }, spec);
    opslagStatus('bezig', 'Opslaan…');
    let r; try { r = await D.wijzig(volledig, { traag: () => opslagStatus('bezig', 'Opslaan duurt lang, even geduld…') }); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
    const zelfde = S.open && S.open.code === code && S.open.id === id;
    if (r && r.onzeker) {
      if (zelfde) opslagStatus('fout', r.reden);
      Promise.resolve(r.onzeker).then(u => { T.ververs(); naWijziging(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het opslaan gelukt is.', null, true); }, () => toast('Ik kon niet vaststellen of het opslaan gelukt is.', null, true));
      return false;
    }
    if (!r || !r.ok) {
      tekenVeilig();   // de velden tonen weer wat er echt staat (bij "tegelijk" de nieuwe stand)
      const invoer = ['naam', 'omschrijving'].map(k => spec.velden[k]).find(v => typeof v === 'string' && v.trim());   // getypte tekst gaat nooit stil verloren: hij staat in de melding (en Opnieuw stuurt hem nog eens)
      if (zelfde) opslagStatus(r && r.tegelijk ? 'let' : 'fout', ((r && r.reden) || 'Niet opgeslagen.') + (invoer ? ' Jouw invoer: "' + (invoer.length > 120 ? invoer.slice(0, 120) + '…' : invoer) + '"' : ''), r && r.tegelijk ? null : () => bewaar(spec, wat));
      return false;
    }
    if (r.noop) { tekenVeilig(); return true; }
    tekenVeilig(); naWijziging();
    if (r.tegelijk) { opslagStatus('let', r.tegelijk); toast(r.tegelijk, null, true); return false; }
    opslagStatus('ok', 'Opgeslagen');
    const w = r.wijziging;
    toast((w.naam || 'Taak') + ': ' + wat + ' opgeslagen.', async () => {
      let h; try { h = await D.wijzigHerstel(w, {}); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      T.ververs(); naWijziging();
      if (h && h.onzeker) { toast(h.reden, null, true); Promise.resolve(h.onzeker).then(u => { T.ververs(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het terugzetten gelukt is.', null, true); }); return; }
      toast(h && h.ok ? (h.tegelijk || 'Teruggezet.') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && (h.tegelijk || !h.ok)));
    });
    return true;
  }
  // Opnieuw tekenen, maar niet midden in het typen van een ander veld (dat gebeurt dan zodra de focus het veld verlaat)
  const tekenVeilig = () => { if (T.bezigMetBewerken()) S.achter = true; else T.teken(); };
  const naWijziging = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) {} } };
  // Een tekstveld dat bewerkt zoals Toggl: Enter (of Ctrl+Enter in de notities) of wegklikken = opslaan, Esc = terug naar wat er stond (een tweede Esc sluit het paneel)
  function tekstVeld(veld, waarde, o) {
    o = o || {};
    const kan = mag('alles'), opties = { id: 'tp-v-' + veld, klass: 'tp-invoer' + (o.klass ? ' ' + o.klass : ''), 'aria-label': o.label, disabled: kan ? null : true, title: kan ? (o.titel || null) : GEEN_RECHT, autocomplete: 'off', spellcheck: o.multi ? 'true' : 'false', placeholder: o.placeholder || null };
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
  // Een keuzelijst: kiezen = meteen opslaan
  function keuzeVeld(veld, waarde, opties, o) {
    o = o || {};
    const kan = o.mag !== undefined ? o.mag : mag('alles');
    const s = el('select', { id: 'tp-v-' + veld, klass: 'tp-invoer tp-keuze', 'aria-label': o.label, disabled: kan ? null : true, title: kan ? null : (o.waarom || GEEN_RECHT) },
      opties.map(([w, l]) => el('option', { value: w, tekst: l })));
    s.value = waarde;
    s.addEventListener('change', () => { const velden = {}; velden[veld] = s.value; const gezien = {}; gezien[veld] = waarde; bewaar({ velden, gezien }, o.wat || veld); });
    return s;
  }
  // "6", "6,5", "2u30", "1:30", "90m" → uren (2 decimalen); leeg = 0; anders null
  T.leesUren = function (x) {
    const s = String(x == null ? '' : x).trim().toLowerCase().replace(',', '.'); let m;
    if (s === '') return 0;
    if ((m = /^(\d+(?:\.\d+)?)\s*(?:u|uur|h)?$/.exec(s))) return Math.round(Number(m[1]) * 100) / 100;
    if ((m = /^(\d+)\s*(?:u|uur|h|:)\s*(\d{1,2})\s*(?:m|min)?$/.exec(s))) return Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100;
    if ((m = /^(\d+)\s*(?:m|min|minuten)$/.exec(s))) return Math.round(Number(m[1]) / 60 * 100) / 100;
    return null;
  };
  const urenTekst = u => { const n = Number(u) || 0; return n ? String(n).replace('.', ',') : ''; };
  function datumVelden(m) {
    const t = m.taak, mijlpaal = t.soort === 'mijlpaal', klaar = (t.status || 'todo') === 'klaar';
    const waarom = !mag('plannen') ? 'Datums plannen is voor kantoor.' : klaar ? 'Een klare taak plan je niet meer in.' : t.voorstel ? 'Neem het voorstel eerst over; daarna kun je het inplannen.' : '';
    const tekst = ymdOk(t.start) ? (t.eind && t.eind !== t.start ? datum(t.start) + ' t/m ' + datum(t.eind) : datum(t.start)) : 'Nog niet ingepland';
    if (waarom || !D.datums) return el('div', null, el('span', { klass: 'tp-tekstwaarde', tekst }), waarom ? el('span', { klass: 'tp-sub', tekst: waarom }) : null);
    const s0 = ymdOk(t.start) ? t.start : '', e0 = ymdOk(t.eind) ? t.eind : s0;
    const a = el('input', { type: 'date', id: 'tp-v-start', klass: 'tp-invoer tp-datum', 'aria-label': mijlpaal ? 'Datum' : 'Start', value: s0 });
    const b = mijlpaal ? null : el('input', { type: 'date', id: 'tp-v-eind', klass: 'tp-invoer tp-datum', 'aria-label': 'Eind', value: e0 });
    let bezig = false;
    const opslaan = async () => {
      if (bezig) return;
      const s = a.value, e = b ? b.value : s;
      if (s === s0 && e === e0) return;
      if (!ymdOk(s) || !ymdOk(e)) { opslagStatus('fout', 'Vul een geldige ' + (b ? 'start en eind' : 'datum') + ' in.'); return; }
      if (e < s) { opslagStatus('fout', 'Het eind ligt voor de start; er is niets gewijzigd.'); return; }
      bezig = true; opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await D.datums({ soort: 'taakdatums', taak: { code: m.code, id: t.id, naam: t.naam }, startDatum: s, eindDatum: e, gezien: { start: t.start || '', eind: t.eind || '' } }); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; } finally { bezig = false; }
      tekenVeilig(); naWijziging();
      if (r && r.onzeker) { opslagStatus('fout', r.reden); return; }
      if (r && r.geannuleerd) { opslagStatus('', ''); return; }
      if (!r || !r.ok) { opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.', r && r.tegelijk ? null : () => { a.value = s; if (b) b.value = e; opslaan(); }); return; }
      if (r.noop) return;
      opslagStatus(r.tegelijk ? 'let' : 'ok', r.tegelijk || 'Opgeslagen');
    };
    // Een datumveld wijzigt al tijdens het typen van het jaar: opslaan bij Enter of wegklikken, niet bij elke wijziging
    [a, b].filter(Boolean).forEach(i => {
      i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); opslaan(); } else if (ev.key === 'Escape' && (a.value !== s0 || (b && b.value !== e0))) { ev.preventDefault(); ev.stopPropagation(); a.value = s0; if (b) b.value = e0; } });
      i.addEventListener('blur', () => setTimeout(() => { const f = D.doc.activeElement; if (f !== a && f !== b) opslaan(); }, 0));
    });
    return el('div', { klass: 'tp-datums' }, a, b ? el('span', { klass: 'tp-sub', tekst: 't/m' }) : null, b, el('span', { klass: 'tp-sub tp-uitleg', tekst: 'Hangen er opvolgers aan, dan vraag ik eerst of die mee schuiven.' }));
  }
  function velden(m) {
    const t = m.taak, team = (D.team && D.team()) || [];
    const wieOpties = [['', 'Niemand']].concat(team.filter(x => x && x.slug).map(x => [x.slug, x.naam]));
    if (t.toegewezen && !team.some(x => zelfde(x.slug, t.toegewezen))) wieOpties.push([t.toegewezen, t.toegewezen + ' (niet in het team)']);
    const extra = m.mensen.slice(1).map(persNaam);
    const actOpties = [['', 'Niet ingedeeld']].concat(P.ACTIVITEITEN.map(a => [a.k, a.l]));
    const prioOpties = [['', 'Geen'], ['high', PRIO.high], ['medium', PRIO.medium], ['low', PRIO.low]];
    return el('div', { klass: 'tp-velden' },
      rij('Wie', keuzeVeld('toegewezen', t.toegewezen || '', wieOpties, { label: 'Wie', wat: 'persoon' }), extra.length ? el('span', { klass: 'tp-sub', tekst: 'ook: ' + extra.join(', ') }) : null),
      rij(t.soort === 'mijlpaal' ? 'Datum' : 'Datums', datumVelden(m)),
      rij('Raming', t.soort === 'mijlpaal' ? el('span', { klass: 'tp-tekstwaarde', tekst: 'mijlpaal (telt niet mee)' })
        : el('div', { klass: 'tp-inline' }, tekstVeld('duur_uur', urenTekst(t.duur_uur), { label: 'Raming in uren', klass: 'tp-kort', inputmode: 'decimal', placeholder: '0', lees: T.leesUren, fout: 'Geen geldige raming: typ bijvoorbeeld 6, 6,5 of 2u30. Er is niets gewijzigd.', gezien: String(t.duur_uur == null ? '' : t.duur_uur), wat: 'raming', titel: 'Uren: 6, 6,5, 2u30 of 90m' }), el('span', { klass: 'tp-sub', tekst: 'uur' + (m.raming ? ' · ' + P.fmtUurMin(m.raming) : '') }))),
      rij('Activiteit', keuzeVeld('activiteit', t.activiteit || '', actOpties, { label: 'Activiteit', wat: 'activiteit' })),
      rij('Prioriteit', keuzeVeld('prioriteit', t.prioriteit || '', prioOpties, { label: 'Prioriteit', wat: 'prioriteit' })),
      rij('Notities', tekstVeld('omschrijving', t.omschrijving || '', { label: 'Notities', multi: true, placeholder: 'Notitie toevoegen…', wat: 'notities', titel: 'Ctrl+Enter of wegklikken = opslaan, Esc = annuleren' })));
  }

  function meta(m) {
    const t = m.taak, delen = [];
    if (t.klaar_op) delen.push('Klaar gemeld ' + datum(t.klaar_op));
    if (t.bron) delen.push('Bron: ' + ({ ai: 'AI-voorstel', handmatig: 'met de hand', sjabloon: 'sjabloon', werkplaats: 'werkplaats' }[t.bron] || t.bron));
    // Toggl: eerlijk wat de stand is, met de bestaande knop (projTaakTogglSync: altijd met bevestiging; MT is de bron)
    let tg = null; try { tg = P.tgActie ? P.tgActie(t) : null; } catch (e) { tg = null; }
    const tgTekst = { actueel: 'Toggl: gelijk', koppelen: 'Niet in Toggl', bijwerken: 'Toggl loopt achter', herkoppelen: 'Toggl-koppeling niet bevestigd', 'extern-verwijderd': 'Weg in Toggl' }[tg] || (t.tg_task_id ? 'Gekoppeld aan Toggl' : 'Niet in Toggl');
    const tgKnop = D.togglSync && mag('alles') && tg && tg !== 'actueel' ? el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: tg === 'koppelen' ? 'Naar Toggl…' : 'Toggl bijwerken…', title: 'Zet naam en status in Toggl gelijk met MT (met bevestiging)', klik: async () => { await D.togglSync(m.code, t.id); T.ververs(); } }) : null;
    const weg = D.verwijder && mag('alles') ? el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Verwijderen…', title: 'Taak verwijderen (met bevestiging; een gekoppelde Toggl-taak gaat ook weg)', klik: async () => {
      const code = m.code, id = t.id; await D.verwijder(code, id);
      const nog = T.model(code, id); if (!nog.ok) { T.sluit(); naWijziging(); toast('Taak verwijderd. Hij staat in het takenjournaal.'); } else T.ververs();
    } }) : null;
    return el('div', { klass: 'tp-meta' }, el('div', { klass: 'tp-meta-regel' }, delen.map(x => el('span', { tekst: x })), el('span', { tekst: tgTekst }), tgKnop), weg ? el('div', { klass: 'tp-acties tp-onder' }, weg) : null);
  }

  function kop(m) {
    const knop = (label, ic, klik, kl) => el('button', { type: 'button', klass: 'tp-knop icoon' + (kl ? ' ' + kl : ''), 'aria-label': label, title: label, klik }, icoon(ic));
    return el('div', { klass: 'tp-kop' },
      el('button', { type: 'button', klass: 'tp-knop tp-terug', klik: () => T.sluit(), title: 'Terug naar waar je was' }, icoon(IC.terug), 'Terug'),
      el('span', { klass: 'tp-kop-titel', tekst: 'Taak' }),
      knop('Link naar deze taak kopiëren', IC.link, () => kopieerLink(m)),
      knop('Sluiten', IC.sluit, () => T.sluit(), 'tp-sluit'));
  }
  async function kopieerLink(m) {
    let url = ''; try { url = String(location.href).split('#')[0] + T.href(m.code, m.taak.id); } catch (e) { url = T.href(m.code, m.taak.id); }
    let ok = false; try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(url); ok = true; } } catch (e) { ok = false; }
    toast(ok ? 'Link gekopieerd.' : 'Kopiëren lukte niet. De link staat in de adresbalk.');
  }
  const toast = (tekst, ongedaan, lang, label) => { try { if (D.toast) D.toast(tekst, ongedaan, lang, label); } catch (e) {} };

  // De status als vier zichtbare knoppen (geen rondgaande knop): Open · Bezig · Wacht (met een reden) · Klaar
  async function zetStatus(m, nieuw) {
    const t = m.taak, huidig = t.status || 'todo';
    if (huidig === nieuw && nieuw !== 'wacht') return;
    let reden = '';
    if (nieuw === 'wacht') {
      const dlg = D.dialoog; if (!dlg || !dlg.prompt) return;
      for (let i = 0; i < 3; i++) {
        const r = await dlg.prompt({ title: 'Waarom wacht deze taak?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (t.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
        if (r === null || r === undefined) return;
        reden = String(r).replace(/\s+/g, ' ').trim(); if (reden.length >= 2) break;
        reden = ''; toast('Een reden is verplicht bij Wacht.');
      }
      if (!reden) return;
    } else if (huidig === 'todo' && m.wacht && m.wacht.wacht && D.dialoog && D.dialoog.confirm) {   // een taak die op een voorganger wacht start pas na een bevestiging (zoals in de projecttabel en op de telefoon)
      const ja = await D.dialoog.confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    await bewaar({ velden: { status: nieuw }, gezien: { status: huidig, wacht_reden: t.wacht_reden || '', klaar_op: t.klaar_op || '' }, reden }, 'status ' + (P.TAAK_STATUS_LABEL[nieuw] || nieuw).toLowerCase());
  }
  function statusRij(m) {
    const st = m.taak.status || 'todo', kan = mag('status') && !!D.wijzig;
    const groep = el('div', { klass: 'tp-statusknoppen', role: 'group', 'aria-label': 'Status' }, P.TAAK_STATUSSEN.map(s => el('button', { type: 'button', klass: 'tp-stknop tp-st-' + STATUS_KL[s] + (s === st ? ' aan' : ''), 'aria-pressed': s === st ? 'true' : 'false', disabled: kan ? null : true, title: kan ? (s === 'wacht' ? 'Op Wacht zetten (met een reden)' : 'Zet op ' + P.TAAK_STATUS_LABEL[s]) : GEEN_RECHT, klik: () => zetStatus(m, s), tekst: P.TAAK_STATUS_LABEL[s] })));
    return el('div', null, el('div', { klass: 'tp-statusrij' }, groep),
      st === 'wacht' && m.taak.wacht_reden ? el('div', { klass: 'tp-sub tp-wachtreden', tekst: 'Wacht: ' + m.taak.wacht_reden }) : null,
      el('div', { id: 'tp-opslag', klass: 'tp-opslag', role: 'status', 'aria-live': 'polite' }));
  }
  // Voorstel van de werkplaats en een veldconflict: de bestaande functies van de projecttabel (met hun eigen meldingen)
  function meldingen(m) {
    const t = m.taak, kids = [];
    if (t.voorstel) {
      const kan = mag('alles') && D.neemOver;
      kids.push(el('div', { klass: 'tp-melding tp-voorstel' }, el('span', { tekst: P.voorstelTekst(t.voorstel) }),
        kan ? el('span', { klass: 'tp-acties' }, el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Overnemen', title: 'De markering eraf: het is dan een gewone taak', klik: async () => { await D.neemOver(m.code, t.id); T.ververs(); naWijziging(); } }),
          el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Afwijzen…', title: 'Van de takenlijst halen (blijft in het journaal)', klik: async () => { await D.wijsAf(m.code, t.id); T.ververs(); naWijziging(); } }))
          : el('span', { klass: 'tp-sub', tekst: 'Kantoor beslist' })));
    }
    if (t._veldconflict && Object.keys(t._veldconflict).length && D.conflict) kids.push(el('div', { klass: 'tp-melding tp-conflict' }, el('span', { tekst: 'Twee mensen wijzigden tegelijk ' + Object.keys(t._veldconflict).length + ' veld(en) van deze taak.' }),
      mag('alles') ? el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Kiezen…', klik: async () => { await D.conflict(m.code, t.id); T.ververs(); naWijziging(); } }) : null));
    return kids.length ? el('div', { klass: 'tp-meldingen' }, kids) : null;
  }

  function paneelEl() {
    let p = D.doc.getElementById('tp-paneel');
    if (!p) {
      if (!D.doc.getElementById('tp-stijl')) { const s = el('style', { id: 'tp-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
      p = el('aside', { id: 'tp-paneel', klass: 'tp-paneel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tp-titel', tabindex: '-1', hidden: true });
      p.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); T.sluit(); } });
      p.addEventListener('focusout', () => setTimeout(() => { if (S.open && S.achter && !T.bezigMetBewerken()) T.teken(); }, 300));   // een uitgestelde hertekening (er werd getypt) nu alsnog
      D.doc.body.appendChild(p);
    }
    return p;
  }

  T.teken = function () {
    if (!S.open) return;
    const p = paneelEl(), m = T.model(S.open.code, S.open.id);
    const oudBody = p.querySelector('.tp-body'), zelfdeTaak = p.getAttribute('data-taak') === S.open.code + '/' + S.open.id, scroll = oudBody && zelfdeTaak ? oudBody.scrollTop : 0;
    const focusId = zelfdeTaak && D.doc.activeElement && p.contains(D.doc.activeElement) ? D.doc.activeElement.id : '';
    p.setAttribute('data-taak', S.open.code + '/' + S.open.id);
    S.achter = false;
    p.textContent = '';
    T._naTeken = () => { const b = p.querySelector('.tp-body'); if (b && scroll) b.scrollTop = scroll; if (focusId) { const f = D.doc.getElementById(focusId); if (f && f.focus) try { f.focus({ preventScroll: true }); } catch (e) {} } };
    if (!m.ok) {
      p.appendChild(kop({ code: S.open.code, taak: { id: S.open.id } }));
      const klaar = !D.takenKlaar || D.takenKlaar();
      p.appendChild(el('div', { klass: 'tp-body' }, el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: klaar ? 'Taak niet gevonden' : 'Taken laden…' }),
        el('p', { klass: 'tp-sub', tekst: klaar ? 'Deze taak bestaat niet (meer). Misschien is hij verwijderd of naar een ander project verplaatst.' : ((D.takenStatusTekst && D.takenStatusTekst()) || 'De takenlijst is nog niet geladen.') }),
        D.ga && D.ga.project ? link(D.href && D.href.project ? D.href.project(S.open.code) : '#', () => { T.sluit({ stil: true }); D.ga.project(S.open.code, 'planning'); }, 'Naar het project', 'tp-link tp-knoplink') : null));
      return;
    }
    S.open.code = m.code;
    p.setAttribute('aria-label', 'Taak: ' + (m.taak.naam || ''));
    // De naam ziet eruit als een kop, maar is een veld: klikken = bewerken (bewerkbaar oogt = bewerkbaar)
    const titel = D.wijzig ? el('h2', { id: 'tp-titel', klass: 'tp-titel' }, tekstVeld('naam', m.taak.naam || '', { label: 'Taaknaam', klass: 'tp-titelinvoer', wat: 'naam', fout: 'Een taak heeft een naam nodig; er is niets gewijzigd.', lees: v => v ? v : null, titel: 'Klik om de naam te wijzigen · Enter = opslaan, Esc = annuleren' }))
      : el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: m.taak.naam || '(zonder naam)' });
    const body = el('div', { klass: 'tp-body' },
      herkomst(m),
      titel,
      statusRij(m),
      meldingen(m),
      velden(m),
      afhSectie(m),
      bestelSectie(m),
      meta(m));
    p.appendChild(kop(m)); p.appendChild(body);
    T._naTeken();
    const s = S.status; if (s && s.taak === S.open.code + '/' + S.open.id && (s.soort !== 'ok' || Date.now() - s.t < 5000)) opslagStatus(s.soort, s.tekst, s.opnieuw);
  };

  // ── openen en sluiten ──
  // o = { push (standaard true): een eigen geschiedenisregel, zodat Terug het paneel sluit; vanRoute: de URL is al #taak/… (terug/vooruit, deeplink); terug: het element dat de focus terugkrijgt }
  T.open = function (code, id, o) {
    o = o || {};
    if (code == null || id == null || id === '') return false;
    const wasOpen = !!S.open;
    if (!wasOpen) S.terugFocus = o.terug || (D.doc.activeElement && D.doc.activeElement !== D.doc.body ? D.doc.activeElement : null);
    else if (o.terug) S.terugFocus = o.terug;
    S.open = { code: String(code), id: String(id) };
    const p = paneelEl(); p.hidden = false;
    try { D.doc.documentElement.classList.add('tp-open'); } catch (e) {}
    T.teken();
    // Zolang het paneel open is: kijken of de gegevens veranderden (een ander apparaat, de sync, een andere schermwijziging) en dan opnieuw tekenen
    if (D.ruw && !S.kijk) { S.ruw = D.ruw(); S.kijk = setInterval(() => { if (!S.open) return; const r = D.ruw(); if (r !== S.ruw) { S.ruw = r; if (!T.bezigMetBewerken()) T.teken(); else S.achter = true; } }, 2000); }
    if (!o.vanRoute) {
      const h = T.href(S.open.code, S.open.id);
      try { if (location.hash !== h) { if (wasOpen || o.push === false) history.replaceState(null, '', h); else { history.pushState(null, '', h); S.gepusht = true; } } } catch (e) {}
    }
    try { const t = p.querySelector('#tp-titel'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } } catch (e) {}
    if (D.geopend) { try { D.geopend(S.open.code, S.open.id); } catch (e) {} }
    return true;
  };
  // Verbergen zonder de geschiedenis aan te raken (terug/vooruit of een navigatie naar elders)
  // Iemand typt in een veld van het paneel: dan niet opnieuw tekenen (dat zou zijn invoer weggooien); dat gebeurt na het opslaan of annuleren
  T.bezigMetBewerken = () => { const a = D.doc.activeElement, p = D.doc.getElementById('tp-paneel'); return !!(p && a && p.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text'))); };   // een keuzelijst of datumveld heeft geen half getypte tekst: dat mag gewoon hertekend worden
  function verberg() {
    if (S.kijk) { clearInterval(S.kijk); S.kijk = null; }
    const p = D.doc.getElementById('tp-paneel'); if (p) { p.hidden = true; p.textContent = ''; }
    try { D.doc.documentElement.classList.remove('tp-open'); } catch (e) {}
    const f = S.terugFocus; S.open = null; S.terugFocus = null;
    if (f && f.isConnected && f.focus) { try { f.focus({ preventScroll: true }); } catch (e) {} }
  }
  // o.stil: we gaan meteen naar een andere plek (project, klant): de #taak-regel blijft in de geschiedenis staan, zodat Terug het paneel weer opent
  T.sluit = function (o) {
    o = o || {};
    if (!S.open) return;
    const eigen = (() => { try { const r = P.deepLinkLees(location.hash); return !!(r && r.soort === 'taak'); } catch (e) { return false; } })();
    const gepusht = S.gepusht; S.gepusht = false;
    verberg();
    if (o.stil || !eigen) return;
    try { if (gepusht) history.back(); else history.replaceState(null, '', S.vorig || (location.pathname + location.search)); } catch (e) {}
  };
  T.isOpen = () => !!S.open;
  T.huidig = () => S.open ? { code: S.open.code, id: S.open.id } : null;
  // Na een wijziging van taken, afhankelijkheden of bestellingen (ook door een ander apparaat): opnieuw tekenen als het paneel open staat
  T.ververs = function () { if (!S.open) return; clearTimeout(T.ververs._t); T.ververs._t = setTimeout(() => { if (S.open) T.teken(); }, 120); };

  function volgRoute() {
    let r = null; try { r = P.deepLinkLees(location.hash); } catch (e) { r = null; }
    if (r && r.soort === 'taak') { if (!S.open || !zelfde(S.open.code, r.code) || S.open.id !== String(r.id)) T.open(r.code, r.id, { vanRoute: true }); return; }
    if (S.open) { S.gepusht = false; verberg(); }
  }
  // Een deeplink bij het opstarten: wachten tot de takenlijst er is (maximaal twee minuten), dan het paneel openen boven de starttab
  function startLink() {
    let r = null; try { r = P.deepLinkLees(START); } catch (e) { r = null; }
    if (!r || r.soort !== 'taak') return;
    const t0 = Date.now();
    const poging = () => {
      if (S.open) return;
      if ((D.takenKlaar && !D.takenKlaar()) && Date.now() - t0 < 120000) { S.wachtStart = setTimeout(poging, 500); return; }
      T.open(r.code, r.id);
    };
    S.wachtStart = setTimeout(poging, 300);
  }

  T.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning;
    if (!T._luistert && typeof root.addEventListener === 'function') {
      T._luistert = true; root.addEventListener('popstate', volgRoute); root.addEventListener('hashchange', volgRoute);
      // Esc sluit het paneel ook als de focus net ernaast staat (geen globale sneltoets: alleen zolang het paneel open is, niet in een veld en niet als er een dialoog open staat)
      D.doc.addEventListener('keydown', ev => {
        if (!S.open || ev.key !== 'Escape' || ev.defaultPrevented) return;
        const p = D.doc.getElementById('tp-paneel'), doel = ev.target;
        if (!p || (doel && p.contains(doel)) || D.doc.querySelector('dialog[open]')) return;
        if (doel && (/^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName) || doel.isContentEditable)) return;
        T.sluit();
      });
    }
    if (deps.startLink !== false) startLink();
    return T;
  };
  T.S = S;

  const STIJL = [
    '.tp-paneel{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);z-index:150;display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--ink,#1b211e);border-left:1px solid var(--line,#dfd8cb);box-shadow:-12px 0 40px rgba(40,34,20,.14);font:400 14px/20px var(--sans,system-ui,sans-serif)}',
    '.tp-paneel[hidden]{display:none}',
    '@media (prefers-reduced-motion:no-preference){.tp-paneel:not([hidden]){animation:tp-in .16s ease-out}@keyframes tp-in{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}}',
    '@media (max-width:760px){.tp-paneel{width:100vw;border-left:0}}',
    '.tp-kop{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--line,#dfd8cb);flex:0 0 auto}',
    '.tp-kop-titel{flex:1;font:600 12px/16px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#646a64);text-align:center}',
    '.tp-knop{height:32px;min-width:32px;padding:0 10px;border:1px solid var(--line-strong,#9a917f);border-radius:4px;background:var(--surface,#fff);color:var(--ink,#1b211e);font:500 13px/18px var(--sans,system-ui);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}',
    '.tp-knop.icoon{padding:0;width:32px;border-color:transparent}.tp-knop:hover{background:var(--surface-sunken,#f1ede5)}',
    '.tp-knop:focus-visible,.tp-link:focus-visible,.tp-paneel [tabindex]:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:2px}',
    '.tp-ic{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}',
    '.tp-body{flex:1;overflow:auto;padding:14px 18px 28px}',
    '.tp-herkomst{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:13px;margin-bottom:8px}',
    '.tp-sep{color:var(--ink-3,#646a64)}',
    '.tp-link{color:var(--primary,#17643f);text-decoration:none;border-radius:3px}.tp-link:hover{text-decoration:underline}',
    '.tp-kruim{color:var(--ink-2,#596059)}.tp-kruim-project{color:var(--primary,#17643f);font-weight:600}',
    '.tp-code{font:500 12px var(--mono,monospace);color:var(--ink-3,#646a64)}',
    '.tp-titel{font:600 20px/26px var(--serif,var(--sans,system-ui));margin:4px 0 8px;outline:none}',
    '.tp-statusrij{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}',
    '.tp-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;background:var(--surface-sunken,#f1ede5);color:var(--ink-2,#596059);font:500 12px/22px var(--sans,system-ui);white-space:nowrap}',
    '.tp-st-open{background:var(--surface-sunken,#f1ede5);color:var(--ink-2,#596059)}.tp-st-bezig{background:var(--info-50,#e6edf3);color:var(--info,#3e5c76)}.tp-st-wacht{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}.tp-st-klaar{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}',
    '.tp-chip-voorstel{background:var(--brass-soft,#fbefd2);color:var(--brass-ink,#6b4c05)}.tp-chip-let{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}',
    '.tp-bst-nodig{background:var(--error-50,#fce6e4);color:var(--error,#c4322a)}.tp-bst-besteld{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}.tp-bst-geleverd{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}',
    '.tp-velden{border-top:1px solid var(--line,#dfd8cb);padding-top:6px}',
    '.tp-rij{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px;align-items:start;padding:6px 0;border-bottom:1px solid var(--border-hair,#ece7de)}',
    '.tp-label{font-size:12px;color:var(--ink-3,#646a64);padding-top:6px}',
    '.tp-waarde{min-width:0}.tp-tekstwaarde{display:block;padding:6px 0}.tp-notitie{white-space:pre-wrap}',
    '.tp-sec{margin-top:18px}.tp-sec-kop,.tp-details>summary{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '.tp-sec h3{font:600 12px/16px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3,#646a64);margin:0}',
    '.tp-details>summary{cursor:pointer;list-style:none}.tp-details>summary::-webkit-details-marker{display:none}.tp-details>summary::before{content:"▸";color:var(--ink-3,#646a64);font-size:12px}.tp-details[open]>summary::before{content:"▾"}',
    '.tp-teller{font:500 12px var(--mono,monospace);color:var(--ink-3,#646a64)}',
    '.tp-subkop{font-size:12px;color:var(--ink-3,#646a64);margin:8px 0 4px}',
    '.tp-lijst{list-style:none;margin:0;padding:0}.tp-lijst li{border-top:1px solid var(--border-hair,#ece7de)}.tp-lijst li:first-child{border-top:0}',
    '.tp-taakrij{display:flex;align-items:center;gap:10px;padding:7px 4px;color:inherit}.tp-taakrij:hover{background:var(--surface-sunken,#f1ede5);text-decoration:none}',
    '.tp-bestelrij{display:flex;align-items:center;gap:10px;padding:7px 4px}',
    '.tp-tekst{flex:1;min-width:0;display:flex;flex-direction:column}.tp-naam{font-weight:500;overflow-wrap:anywhere}.tp-sub{font-size:12px;color:var(--ink-3,#646a64)}',
    '.tp-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto;border:2px solid var(--line-strong,#9a917f)}.tp-dot.tp-st-bezig{border-color:var(--info,#3e5c76);background:var(--info-50,#e6edf3)}.tp-dot.tp-st-wacht{border-color:var(--warning,#8f5508)}.tp-dot.tp-st-klaar{border-color:var(--success,#1a6e3b);background:var(--success,#1a6e3b)}',
    '.tp-waarsch{display:flex;gap:8px;margin-top:8px;padding:8px 10px;border-radius:4px;background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508);font-size:13px}',
    '.tp-leeg{color:var(--ink-3,#646a64);font-size:13px;margin:4px 0}',
    '.tp-acties{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
    '.tp-knoplink{display:inline-flex;align-items:center;height:30px;padding:0 10px;border:1px solid var(--line,#dfd8cb);border-radius:4px;font-size:13px}',
    'html:not([data-stijl="nieuw"]) .cn-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:4px;background:#1b211e;color:#fff;font:500 13px/18px system-ui,sans-serif;z-index:200;max-width:min(720px,calc(100vw - 32px))}html:not([data-stijl="nieuw"]) .cn-toast button{background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px;cursor:pointer}',
    '.tp-meta{margin-top:18px;padding-top:10px;border-top:1px solid var(--line,#dfd8cb);font-size:12px;color:var(--ink-3,#646a64)}.tp-meta-regel{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px}.tp-onder{margin-top:14px}',
    '.tp-invoer{width:100%;box-sizing:border-box;min-height:34px;padding:6px 8px;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;font:inherit;transition:border-color .12s,background .12s}',
    '.tp-invoer:hover:not(:disabled){border-color:var(--line,#dfd8cb);background:var(--surface,#fff)}.tp-invoer:focus{outline:none;border-color:var(--primary,#17643f);background:var(--surface,#fff);box-shadow:var(--focus-ring,0 0 0 3px rgba(23,100,63,.2))}',
    '.tp-invoer:disabled{color:inherit;opacity:1;cursor:default}select.tp-invoer{border-color:var(--line,#dfd8cb);cursor:pointer;background:var(--surface,#fff)}select.tp-invoer:disabled{border-color:transparent;appearance:none;-webkit-appearance:none;background:transparent}',
    'textarea.tp-invoer{resize:vertical;min-height:64px;line-height:20px}textarea.tp-invoer:placeholder-shown,input.tp-invoer:placeholder-shown{border-color:var(--border-hair,#ece7de)}',
    '.tp-titel .tp-titelinvoer{font:600 20px/26px var(--serif,var(--sans,system-ui));padding:4px 6px;margin-left:-7px;width:calc(100% + 7px)}',
    '.tp-inline{display:flex;align-items:center;gap:8px}.tp-kort{width:90px;flex:0 0 auto;border-color:var(--line,#dfd8cb)}',
    '.tp-datums{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.tp-datum{width:auto;flex:0 1 150px;border-color:var(--line,#dfd8cb)}.tp-uitleg{flex-basis:100%}',
    '.tp-statusknoppen{display:inline-flex;border:1px solid var(--line-strong,#9a917f);border-radius:4px;overflow:hidden}',
    '.tp-stknop{height:32px;padding:0 12px;border:0;border-left:1px solid var(--line,#dfd8cb);background:var(--surface,#fff);color:var(--ink-2,#596059);font:500 13px/18px var(--sans,system-ui);cursor:pointer}.tp-stknop:first-child{border-left:0}',
    '.tp-stknop:hover:not(:disabled){background:var(--surface-sunken,#f1ede5)}.tp-stknop:focus-visible{outline:2px solid var(--primary,#17643f);outline-offset:-2px}.tp-stknop:disabled{cursor:default}',
    '.tp-stknop.aan.tp-st-open{background:var(--n-200,#ece7de);color:var(--ink,#1b211e)}.tp-stknop.aan.tp-st-bezig{background:var(--info-50,#e6edf3);color:var(--info,#3e5c76)}.tp-stknop.aan.tp-st-wacht{background:var(--warning-50,#fcefd9);color:var(--warning,#8f5508)}.tp-stknop.aan.tp-st-klaar{background:var(--success-50,#e3f3e8);color:var(--success,#1a6e3b)}.tp-stknop.aan{font-weight:600}',
    '.tp-wachtreden{margin:-6px 0 8px}',
    '.tp-opslag{min-height:20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;margin:-4px 0 6px;color:var(--ink-3,#646a64)}.tp-opslag.ok{color:var(--success,#1a6e3b)}.tp-opslag.ok span::before{content:"✓ "}.tp-opslag.fout{color:var(--error,#c4322a)}.tp-opslag.let{color:var(--warning,#8f5508)}',
    '.tp-klein{height:28px;padding:0 10px;font-size:12px}.tp-gevaar{color:var(--error,#c4322a);border-color:var(--error,#c4322a)}',
    '.tp-meldingen{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}.tp-melding{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border-radius:4px;font-size:13px}.tp-voorstel{background:var(--brass-soft,#fbefd2);color:var(--brass-ink,#6b4c05)}.tp-conflict{background:var(--error-50,#fce6e4);color:var(--error,#c4322a)}',
    '.tp-teller{white-space:nowrap}.tp-details>summary h3{flex:1}'
  ].join('\n');

  root.MTTaakPaneel = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
