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
    const lijst = b.regels.length ? el('ul', { klass: 'tp-lijst tp-bestel' }, b.regels.slice(0, 12).map(r => el('li', { klass: 'tp-bestelrij' },
      el('span', { klass: 'tp-tekst' }, el('span', { klass: 'tp-naam', tekst: r.oms }), el('span', { klass: 'tp-sub', tekst: [String(r.aantal).replace('.', ',') + ' ' + r.eenheid, r.leverancier, r.voorstel].filter(Boolean).join(' · ') })),
      chip(r.label, 'tp-bst-' + r.status)))) : el('p', { klass: 'tp-leeg', tekst: 'Dit project heeft geen bestelregels.' });
    const meer = b.regels.length > 12 ? el('p', { klass: 'tp-sub', tekst: '… en nog ' + (b.regels.length - 12) + ' regels' }) : null;
    const naar = el('div', { klass: 'tp-acties' },
      link(h.project ? h.project(m.code, 'productie') : '#', () => { T.sluit({ stil: true }); g.project(m.code, 'productie'); }, 'Bestellijst van dit project', 'tp-link tp-knoplink'),
      link(h.bestellijst ? h.bestellijst() : '#', () => { T.sluit({ stil: true }); g.bestellijst(); }, 'Bestellijst (alle projecten)', 'tp-link tp-knoplink'));
    const uitleg = el('p', { klass: 'tp-sub', tekst: 'Bestelregels hangen aan het project, niet aan een losse taak.' });
    const d = el('details', { klass: 'tp-sec tp-details', open: b.materiaal || null },
      el('summary', null, el('h3', { id: 'tp-h-bestel', tekst: 'Bestellingen van dit project' }), el('span', { klass: 'tp-teller', tekst: tel || '0' })), lijst, meer, uitleg, naar);
    return d;
  }

  function velden(m) {
    const t = m.taak, act = t.activiteit ? P.activiteit(t.activiteit) : null;
    const wie = m.mensen.length ? m.mensen.map(persNaam).join(', ') : 'Niemand';
    const dat = ymdOk(t.start) ? (t.eind && t.eind !== t.start ? datum(t.start) + ' t/m ' + datum(t.eind) : datum(t.start)) : (ymdOk(t.eind) ? 'tot ' + datum(t.eind) : 'Nog niet ingepland');
    return el('div', { klass: 'tp-velden' },
      rij('Wie', el('span', { klass: 'tp-tekstwaarde', tekst: wie })),
      rij(t.soort === 'mijlpaal' ? 'Datum' : 'Datums', el('span', { klass: 'tp-tekstwaarde', tekst: dat })),
      rij('Raming', el('span', { klass: 'tp-tekstwaarde', tekst: t.soort === 'mijlpaal' ? 'mijlpaal (telt niet mee)' : (m.raming ? P.fmtUurMin(m.raming) : 'geen raming') })),
      rij('Activiteit', el('span', { klass: 'tp-tekstwaarde', tekst: act ? act.l : 'Niet ingedeeld' })),
      rij('Prioriteit', el('span', { klass: 'tp-tekstwaarde', tekst: PRIO[t.prioriteit] || 'Geen' })),
      rij('Notities', el('span', { klass: 'tp-tekstwaarde tp-notitie', tekst: t.omschrijving || '—' })));
  }

  function meta(m) {
    const t = m.taak, delen = [];
    if (t.klaar_op) delen.push('Klaar gemeld ' + datum(t.klaar_op));
    if (t.bron) delen.push('Bron: ' + ({ ai: 'AI-voorstel', handmatig: 'met de hand', sjabloon: 'sjabloon', werkplaats: 'werkplaats' }[t.bron] || t.bron));
    if (t.tg_task_id) delen.push('Gekoppeld aan Toggl'); else delen.push('Niet in Toggl');
    return el('div', { klass: 'tp-meta' }, delen.map(x => el('span', { tekst: x })));
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

  function statusRij(m) {
    const st = m.taak.status || 'todo';
    return el('div', { klass: 'tp-statusrij' }, chip(P.TAAK_STATUS_LABEL[st] || st, 'tp-st tp-st-' + (STATUS_KL[st] || 'open')),
      st === 'wacht' && m.taak.wacht_reden ? el('span', { klass: 'tp-sub', tekst: 'Wacht: ' + m.taak.wacht_reden }) : null,
      m.taak.voorstel ? chip(P.voorstelTekst(m.taak.voorstel), 'tp-chip-voorstel') : null);
  }

  function paneelEl() {
    let p = D.doc.getElementById('tp-paneel');
    if (!p) {
      if (!D.doc.getElementById('tp-stijl')) { const s = el('style', { id: 'tp-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
      p = el('aside', { id: 'tp-paneel', klass: 'tp-paneel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tp-titel', tabindex: '-1', hidden: true });
      p.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); T.sluit(); } });
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
    const body = el('div', { klass: 'tp-body' },
      herkomst(m),
      el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: m.taak.naam || '(zonder naam)' }),
      statusRij(m),
      velden(m),
      afhSectie(m),
      bestelSectie(m),
      meta(m));
    p.appendChild(kop(m)); p.appendChild(body);
    T._naTeken();
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
  T.bezigMetBewerken = () => { const a = D.doc.activeElement, p = D.doc.getElementById('tp-paneel'); return !!(p && a && p.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
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
    '.tp-meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:18px;padding-top:10px;border-top:1px solid var(--line,#dfd8cb);font-size:12px;color:var(--ink-3,#646a64)}'
  ].join('\n');

  root.MTTaakPaneel = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
