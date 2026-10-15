/* ============================================================================
 * mt-werktijden.js: Admin ▸ Team en werktijden (restyling fase 1, brok 9)
 * ----------------------------------------------------------------------------
 * Per medewerker: werkdagen (ma-vr), begin en eind per dag en de pauze. Die bepalen de capaciteit in Planning (beschikbaar per dag = eind - begin -
 * pauze; zonder invulling blijft het 8 uur per werkdag, ma-vr, zoals voorheen) en de tijd van de dagvraag "Klopt je dag?" (eindtijd min 15 minuten:
 * hier alleen getoond; de vraag zelf is een latere stap). Alles rekent via MTPlanning (werktijdDagMin, dagCapMin, dagvraagTijd): geen tweede waarheid.
 *
 * Opslag: één gedeeld bestand mt_werktijden.json met één record per medewerker ({slug, dagen, pauze, _gewijzigd, _door}); samenvoegen per medewerker
 * (MTPlanning.werktijdenSamen: nieuwste stempel wint), dus twee beheerders die verschillende mensen wijzigen verliezen niets. Schrijven mag alleen
 * eigenaar/beheer (D.magWijzigen(); rol nog niet geladen = niet) en alleen na een geslaagde verse lezing (anti-clobber). Lezen mag iedereen: de planning
 * van het hele team rekent ermee.
 * Tekent met DOM-calls, nooit met opgebouwde HTML. Alles komt van buiten via init(deps), zodat het zonder de hele cockpit te testen is.
 * ========================================================================== */
(function (root) {
  'use strict';
  const W = {};
  let D = null, P = null;
  const BESTAND = 'mt_werktijden.json', LS = 'mt_werktijden';
  const S = { lijst: null, geladen: false, gekozen: null, concept: null, bezig: false, melding: '', afwMaand: null };
  const DAGEN = ['ma', 'di', 'wo', 'do', 'vr'], LANG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag'];
  const tMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const tTekst = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const klok = min => Math.floor(min / 60) + ':' + String(Math.round(min % 60)).padStart(2, '0');
  const kopie = x => JSON.parse(JSON.stringify(x));

  // ── data ──
  function lokaal() { try { const o = JSON.parse((D.storage && D.storage.getItem(LS)) || 'null'); return Array.isArray(o) ? o : []; } catch (e) { return []; } }
  W.lijst = function () { return S.lijst || lokaal(); };
  W.map = function () { return P.werktijdenMap(W.lijst()); };
  W.geladen = () => S.geladen;
  // Verse lezing, samengevoegd met de lokale kopie (een lokale wijziging die nog niet gedeeld is blijft staan). Leesfout: de lokale kopie blijft, er wordt niets geschreven.
  W.laad = async function () {
    let remote;
    try { remote = await D.sp.read(BESTAND); } catch (e) { S.lijst = lokaal(); S.melding = 'Werktijden konden niet worden gelezen; je ziet de laatst bekende stand.'; return false; }
    if (remote !== null && remote !== undefined && !Array.isArray(remote)) { S.lijst = lokaal(); S.melding = 'Het bestand met werktijden heeft een onverwachte vorm; er wordt niets gewijzigd.'; return false; }
    S.lijst = P.werktijdenSamen(lokaal(), remote || []); S.geladen = true; S.melding = '';
    try { D.storage && D.storage.setItem(LS, JSON.stringify(S.lijst)); } catch (e) {}
    return true;
  };
  // Een record maken uit het concept van de editor (dagen en pauze) en opslaan. -> { ok, reden?, behouden?, opgeslagen? }
  W.bewaar = async function (slug, dagen, pauze, opt) {
    opt = opt || {};
    if (!D.magWijzigen()) return { ok: false, reden: 'Alleen eigenaar en beheer kunnen werktijden wijzigen.' };
    if (!(D.team() || []).some(m => String(m.slug).toLowerCase() === String(slug).toLowerCase())) return { ok: false, reden: 'Onbekende medewerker.' };
    const rec = opt.tombstone ? { slug, _vervallen: { tijd: new Date(D.nu()).toISOString(), door: D.wie() } } : { slug, dagen: kopie(dagen), pauze: Math.round(Number(pauze) || 0) };
    if (!opt.tombstone) { const fout = P.werktijdenVorm(rec); if (fout) return { ok: false, reden: fout }; }
    let remote;
    try { remote = await D.sp.read(BESTAND); } catch (e) { return { ok: false, reden: 'SharePoint is niet bereikbaar: er is niets opgeslagen (anti-clobber).' }; }   // leesfout: nooit schrijven
    if (remote !== null && remote !== undefined && !Array.isArray(remote)) return { ok: false, reden: 'Het bestand met werktijden heeft een onverwachte vorm; er is niets opgeslagen.' };
    const basis = P.werktijdenSamen(lokaal(), remote || []), oud = basis.find(x => String(x.slug).toLowerCase() === String(slug).toLowerCase()) || null;
    const nu = D.stempel(rec, oud);   // altijd later dan de stand waarop dit voortbouwt
    nu._door = D.wie();
    const nieuw = P.werktijdenSamen(basis.filter(x => x !== oud).concat([nu]), []);
    S.lijst = nieuw; try { D.storage && D.storage.setItem(LS, JSON.stringify(nieuw)); } catch (e) {}
    let opgeslagen = true;
    try { opgeslagen = !!(await D.sp.write(BESTAND, nieuw, (r, l) => { const s = P.werktijdenSamen(l, r); S.lijst = s; try { D.storage && D.storage.setItem(LS, JSON.stringify(s)); } catch (e) {} return s; })); } catch (e) { opgeslagen = false; }
    const nuRec = W.lijst().find(x => String(x.slug).toLowerCase() === String(slug).toLowerCase());
    const behouden = !!(nuRec && nuRec._gewijzigd === nu._gewijzigd);
    // Alleen in het auditlog als de wijziging echt gedeeld is en bewaard bleef: bij een mislukte write (alleen lokaal) of een verloren race staat er niets gewijzigd in SharePoint.
    if (opgeslagen && behouden) try { D.audit && D.audit(opt.tombstone ? 'config-werktijden-standaard' : 'config-werktijden', slug, oud && !oud._vervallen ? JSON.stringify({ dagen: oud.dagen, pauze: oud.pauze }) : '', opt.tombstone ? '(standaard)' : JSON.stringify({ dagen: rec.dagen, pauze: rec.pauze })); } catch (e) {}
    return { ok: true, opgeslagen, behouden };
  };

  // Een startconcept voor iemand zonder record: dezelfde capaciteit als nu (werkuren per week / 5 per dag, ma-vr), zodat opslaan zonder wijzigen niets verandert.
  W.beginConcept = function (slug) {
    const rec = W.map()[String(slug).toLowerCase()];
    if (rec) return { dagen: kopie(rec.dagen), pauze: Math.round(Number(rec.pauze) || 0), uitRecord: true };
    const wu = D.werkuren ? D.werkuren() : null, u = wu && Number(wu[slug]) > 0 ? Number(wu[slug]) : 40, dagMin = Math.round(u / 5 * 60), pauze = dagMin > 270 ? 30 : 0, dagen = {};
    DAGEN.forEach(k => { dagen[k] = { werk: true, start: '08:00', eind: tTekst(Math.min(23 * 60 + 59, 8 * 60 + dagMin + pauze)) }; });
    return { dagen, pauze, uitRecord: false };
  };
  // De melding na Opslaan of Terug naar standaard: eerlijk over wat er gelukt is (gedeeld, alleen lokaal of verloren van een andere beheerder).
  W.bewaarMelding = (r, gelukt) => !r.ok ? r.reden : (r.behouden ? (r.opgeslagen ? gelukt : 'Alleen lokaal bewaard: SharePoint is niet bereikbaar.') : 'Iemand anders was net sneller met deze medewerker: jouw wijziging is niet bewaard.');
  W.weekMin = c => P.werkweekMin({ dagen: c.dagen, pauze: c.pauze });
  W.dagMin = (c, i) => P.werktijdDagMin({ dagen: c.dagen, pauze: c.pauze }, i);

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
  const ini = n => String(n || '').slice(0, 2).toUpperCase();
  function kies(slug) { S.gekozen = slug; S.concept = W.beginConcept(slug); S.melding = ''; W.teken(); }

  // ── Afwijkingen (afgeleid uit mt_verlof, de vrije dagen, de planblokken en de geklokte uren; geen eigen opslag) ──
  const MND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'], DAGK = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
  const maandNu = () => { const t = new Date(D.nu()); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); };
  const dagTekst = d => { const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))); return DAGK[x.getUTCDay()] + ' ' + Number(d.slice(8)) + ' ' + MND[Number(d.slice(5, 7)) - 1].slice(0, 3); };
  const getalNl = n => String(Math.round(n * 100) / 100).replace('.', ',');
  W.afwData = function (slug) {
    if (!S.afwMaand) S.afwMaand = maandNu();
    try { return P.afwijkingen({ slug, maand: S.afwMaand, team: D.team(), werkuren: D.werkuren ? D.werkuren() : null, werktijden: W.lijst(), verlof: D.verlof ? D.verlof() : [], vrijedagen: D.vrijedagen ? D.vrijedagen() : [], blokken: D.blokken ? D.blokken() : [], entries: D.entries ? D.entries() : [] }); } catch (e) { return null; }
  };
  function afwCel(m) {
    const a = W.afwData(m.slug); if (!a) return el('span', { klass: 'wt-afw-cel rechts', role: 'cell', tekst: '–' });
    const plus = a.extra.aantal, min = a.vrij.verlofDagen + a.vrij.verplichtDagen;
    return el('span', { klass: 'wt-afw-cel rechts', role: 'cell', title: plus + ' extra gewerkte dag(en); ' + getalNl(a.vrij.verlofDagen) + ' dag(en) verlof en ' + a.vrij.verplichtDagen + ' verplichte vrije dag(en) in ' + MND[Number(a.maand.slice(5)) - 1] + ' ' + a.maand.slice(0, 4) },
      el('span', { klass: plus ? 'afw-plus' : 'afw-nul', tekst: '+' + plus }), ' / ', el('span', { klass: min ? 'afw-min' : 'afw-nul', tekst: '−' + getalNl(min) }));
  }
  function afwSectie(m) {
    const a = W.afwData(m.slug); if (!a) return null;
    const jaar = Number(S.afwMaand.slice(0, 4)), maand = Number(S.afwMaand.slice(5)), nuJaar = new Date(D.nu()).getFullYear();
    const kies = (j, mn) => { S.afwMaand = j + '-' + String(mn).padStart(2, '0'); W.teken(); };
    const selM = el('select', { id: 'wt-afw-maand', klass: 'wt-afw-sel', 'aria-label': 'Maand', wijzig: ev => kies(jaar, Number(ev.target.value)) }, MND.map((n, i) => el('option', { value: String(i + 1), tekst: n })));
    selM.value = String(maand);
    const jaren = []; for (let j = nuJaar - 3; j <= nuJaar + 1; j++) jaren.push(j); if (!jaren.includes(jaar)) jaren.push(jaar);
    const selJ = el('select', { id: 'wt-afw-jaar', klass: 'wt-afw-sel', 'aria-label': 'Jaar', wijzig: ev => kies(Number(ev.target.value), maand) }, jaren.sort().map(j => el('option', { value: String(j), tekst: String(j) })));
    selJ.value = String(jaar);
    const stap = n => { const x = new Date(Date.UTC(jaar, maand - 1 + n, 1)); kies(x.getUTCFullYear(), x.getUTCMonth() + 1); };
    const dagKnop = dg => el('button', { type: 'button', klass: 'wt-afw-dag', title: 'Open deze dag in de capaciteit', klik: () => { if (D.naarDag) D.naarDag(m.slug, dg.datum); } },
      el('span', { klass: 'wt-afw-datum', tekst: dagTekst(dg.datum) }), el('span', { klass: 'wt-afw-reden', tekst: dg.reden }),
      el('span', { klass: 'wt-mono', tekst: [dg.gepland_min ? klok(dg.gepland_min) + ' gepland' : '', dg.geklokt_min ? klok(dg.geklokt_min) + ' geklokt' : ''].filter(Boolean).join(' · ') }));
    const extra = el('div', { klass: 'wt-afw-kaart' },
      el('div', { klass: 'wt-afw-kop' }, el('b', { tekst: 'Extra gewerkt' }), el('span', { klass: 'wt-afw-groot', tekst: a.extra.aantal + (a.extra.aantal === 1 ? ' dag' : ' dagen') })),
      el('div', { klass: 'wt-sub', tekst: klok(a.extra.gepland_min) + ' gepland (planblokken) · ' + klok(a.extra.geklokt_min) + ' geklokt' }),
      a.extra.dagen.length ? el('div', { klass: 'wt-afw-lijst' }, a.extra.dagen.map(dagKnop)) : el('div', { klass: 'wt-sub', tekst: 'Geen extra gewerkte dagen in deze maand.' }),
      el('div', { klass: 'wt-sub wt-afw-let', tekst: 'Een dag telt als een weekend, een dag dat deze persoon volgens de werktijden niet werkt, een verlofdag of een verplichte vrije dag, met planblokken (geen open voorstellen) of geklokte uren. Geklokte uren zijn alleen wat op deze computer uit Toggl is binnengekomen: er kan dus meer geklokt zijn dan hier staat.' }));
    const vrij = el('div', { klass: 'wt-afw-kaart' },
      el('div', { klass: 'wt-afw-kop' }, el('b', { tekst: 'Vrij genomen' }), el('span', { klass: 'wt-afw-groot', tekst: getalNl(a.vrij.verlofDagen) + (a.vrij.verlofDagen === 1 ? ' dag' : ' dagen') })),
      el('div', { klass: 'wt-sub', tekst: 'verlof: ' + klok(a.vrij.verlofMin) + ' uur (uit Verlof & saldo)' }),
      a.vrij.perioden.length ? el('div', { klass: 'wt-afw-lijst' }, a.vrij.perioden.map(pr => el('div', { klass: 'wt-afw-periode' }, el('span', { klass: 'wt-afw-datum', tekst: dagTekst(pr.van) + (pr.tm !== pr.van ? ' – ' + dagTekst(pr.tm) : '') }), el('span', { klass: 'wt-afw-reden', tekst: pr.opm }), el('span', { klass: 'wt-mono', tekst: getalNl(pr.dagen) + ' d · ' + klok(pr.min) })))) : el('div', { klass: 'wt-sub', tekst: 'Geen verlof in deze maand.' }),
      el('div', { klass: 'wt-afw-kop wt-afw-tweede' }, el('b', { tekst: 'Verplichte vrije dagen' }), el('span', { klass: 'wt-afw-groot klein', tekst: a.vrij.verplichtDagen + ' · ' + klok(a.vrij.verplichtMin) })),
      a.vrij.verplichtLijst.length ? el('div', { klass: 'wt-afw-lijst' }, a.vrij.verplichtLijst.map(x => el('div', { klass: 'wt-afw-periode' }, el('span', { klass: 'wt-afw-datum', tekst: dagTekst(x.datum) }), el('span', { klass: 'wt-mono', tekst: klok(x.min) })))) : el('div', { klass: 'wt-sub', tekst: 'Geen verplichte vrije dagen op werkdagen van ' + m.naam + '.' }),
      el('div', { klass: 'wt-sub wt-afw-let', tekst: 'Een halve dag of een eigen aantal dagen in de verlofboeking telt naar verhouding mee; overlappende boekingen tellen een dag één keer.' }));
    return el('section', { klass: 'wt-afw', 'aria-labelledby': 'wt-h-afw' },
      el('div', { klass: 'wt-afw-balk' }, el('h4', { id: 'wt-h-afw', klass: 'wt-afw-titel', tekst: 'Afwijkingen · ' + m.naam }),
        el('button', { type: 'button', klass: 'wt-knop icoon', 'aria-label': 'Vorige maand', tekst: '‹', klik: () => stap(-1) }), selM, selJ, el('button', { type: 'button', klass: 'wt-knop icoon', 'aria-label': 'Volgende maand', tekst: '›', klik: () => stap(1) }),
        el('span', { klass: 'wt-sub', tekst: 'Basis: ' + (a.basis === 'werktijden' ? 'de werktijden van ' + m.naam : 'een gewone werkweek ma–vr (nog geen werktijden ingevuld)') })),
      el('div', { klass: 'wt-afw-kaarten' }, extra, vrij));
  }
  W.teken = function () {
    const w = D && D.doc.getElementById('werktijden-nieuw'); if (!w) return;
    if (D.doc.documentElement.getAttribute('data-stijl') !== 'nieuw') { w.textContent = ''; w.hidden = true; return; }
    w.hidden = false; w.textContent = '';
    const team = D.team() || [], mag = D.magWijzigen(), map = W.map();
    if (!S.gekozen && team.length) { S.gekozen = team[0].slug; S.concept = W.beginConcept(S.gekozen); }
    if (S.gekozen && !S.concept) S.concept = W.beginConcept(S.gekozen);
    w.appendChild(el('div', { klass: 'wt-kop' }, el('div', { klass: 'wt-kopblok' }, el('h3', { klass: 'wt-titel', tekst: 'Team en werktijden' }), el('span', { klass: 'wt-sub', tekst: 'Werktijden bepalen de capaciteit in Planning en wanneer de dagvraag komt.' }))));
    if (S.melding) w.appendChild(el('div', { klass: 'wt-melding', role: 'status', tekst: S.melding }));
    if (!mag) w.appendChild(el('div', { klass: 'wt-melding', role: 'status', tekst: 'Alleen eigenaar en beheer kunnen werktijden wijzigen. Je ziet de ingevulde werktijden.' }));
    // tabel
    const tabel = el('div', { klass: 'wt-tabel', role: 'table', 'aria-label': 'Werktijden per medewerker' });
    tabel.appendChild(el('div', { klass: 'wt-rij wt-hoofd', role: 'row' }, el('span', { role: 'columnheader', tekst: 'Medewerker' }), DAGEN.map(d => el('span', { role: 'columnheader', tekst: d })), el('span', { role: 'columnheader', klass: 'rechts', tekst: 'Week' }), el('span', { role: 'columnheader', klass: 'rechts', tekst: 'Vraag' }), el('span', { role: 'columnheader', klass: 'rechts', tekst: 'Afw.', title: 'Afwijkingen in de gekozen maand: extra gewerkte dagen (+) en vrij genomen dagen (−); de uitleg staat onder de tabel' })));
    team.forEach(m => {
      const rec = map[String(m.slug).toLowerCase()], c = rec ? { dagen: rec.dagen, pauze: rec.pauze } : W.beginConcept(m.slug), on = m.slug === S.gekozen;
      const vraag = rec ? P.dagvraagTijd(rec).laatste : '';
      tabel.appendChild(el('div', { klass: 'wt-rij' + (on ? ' aan' : ''), role: 'row' },
        el('button', { type: 'button', klass: 'wt-pers', 'aria-pressed': on ? 'true' : 'false', klik: () => kies(m.slug), role: 'rowheader' }, el('span', { klass: 'wt-avatar', tekst: ini(m.naam) }), el('span', { klass: 'wt-naam' }, el('b', { tekst: m.naam }), el('span', { klass: 'wt-sub', tekst: rec ? (m.admin ? 'Eigenaar/beheer' : 'Werktijden ingevuld') : 'Standaard: ' + klok((D.werkuren && Number((D.werkuren() || {})[m.slug]) > 0 ? Number(D.werkuren()[m.slug]) : 40) * 60) + ' per week' }))),
        DAGEN.map((k, i) => { const d = c.dagen[k]; return el('span', { klass: 'wt-dag' + (d && d.werk ? '' : ' vrij') + (rec ? '' : ' leeg'), role: 'cell', tekst: rec ? (d && d.werk ? d.start + '–' + d.eind : 'vrij') : (i < 5 ? '8u' : '') }); }),
        el('span', { klass: 'wt-week rechts', role: 'cell', tekst: klok(rec ? P.werkweekMin(rec) : W.weekMin(c)) }),
        el('span', { klass: 'wt-vraag rechts', role: 'cell', tekst: vraag || '–', title: vraag ? 'De dagvraag komt 15 minuten voor de eindtijd (laatste werkdag van de week)' : 'Pas zichtbaar zodra de werktijden zijn ingevuld' }), afwCel(m)));
    });
    // editor
    const m = team.find(x => x.slug === S.gekozen), c = S.concept;
    const editor = el('section', { klass: 'wt-editor', 'aria-labelledby': 'wt-h-edit' });
    if (m && c) {
      const rec = map[String(m.slug).toLowerCase()];
      editor.appendChild(el('div', { klass: 'wt-edkop' }, el('span', { klass: 'wt-avatar', tekst: ini(m.naam) }), el('span', { id: 'wt-h-edit', tekst: m.naam }), el('span', { klass: 'wt-weektot', tekst: klok(W.weekMin(c)) + ' per week' })));
      if (!rec) editor.appendChild(el('div', { klass: 'wt-uitleg', tekst: 'Nog niet ingevuld: de planning rekent nu met ' + klok((D.werkuren && Number((D.werkuren() || {})[m.slug]) > 0 ? Number(D.werkuren()[m.slug]) : 40) * 60) + ' per week (8 uur per werkdag, ma–vr). Dit is dezelfde capaciteit als startpunt; pas aan en sla op.' }));
      const lijst = el('div', { klass: 'wt-dagen' });
      DAGEN.forEach((k, i) => {
        const d = c.dagen[k];
        const rij = el('div', { klass: 'wt-dagrij' });
        const vink = el('input', { type: 'checkbox', id: 'wt-werk-' + k, wijzig: ev => { d.werk = ev.target.checked; W.teken(); } }); vink.checked = !!d.werk; if (!mag) vink.disabled = true;
        rij.appendChild(el('label', { klass: 'wt-dagnaam', for: 'wt-werk-' + k }, vink, LANG[i]));
        if (d.werk) {
          const a = el('input', { type: 'time', klass: 'wt-tijd', 'aria-label': LANG[i] + ' begintijd', value: d.start, wijzig: ev => { d.start = ev.target.value || d.start; W.teken(); } }), e2 = el('input', { type: 'time', klass: 'wt-tijd', 'aria-label': LANG[i] + ' eindtijd', value: d.eind, wijzig: ev => { d.eind = ev.target.value || d.eind; W.teken(); } });
          if (!mag) { a.disabled = true; e2.disabled = true; }
          rij.appendChild(el('span', { klass: 'wt-tijden' }, a, el('span', { tekst: '–' }), e2));
        } else rij.appendChild(el('span', { klass: 'wt-sub', tekst: 'werkt niet' }));
        const fout = d.werk && (tMin(d.start) === null || tMin(d.eind) === null || tMin(d.eind) <= tMin(d.start));
        rij.appendChild(el('span', { klass: 'wt-uren' + (fout ? ' fout' : ''), tekst: fout ? 'einde na begin' : (d.werk ? klok(W.dagMin(c, i)) : '') }));
        lijst.appendChild(rij);
      });
      editor.appendChild(lijst);
      const pauze = el('select', { id: 'wt-pauze', klass: 'wt-pauze', wijzig: ev => { c.pauze = Number(ev.target.value); W.teken(); } }, [0, 15, 30, 45, 60, 90].map(p => el('option', { value: String(p), tekst: p ? klok(p) : 'geen' })));
      pauze.value = String(c.pauze); if (!pauze.value) { pauze.appendChild(el('option', { value: String(c.pauze), tekst: klok(c.pauze) })); pauze.value = String(c.pauze); }
      if (!mag) pauze.disabled = true;
      editor.appendChild(el('div', { klass: 'wt-pauzerij' }, el('label', { for: 'wt-pauze', tekst: 'Pauze per dag (alleen op een dag langer dan 5 uur)' }), pauze));
      const vq = P.dagvraagTijd({ dagen: c.dagen });
      editor.appendChild(el('div', { klass: 'wt-vraagblok' }, el('b', { tekst: 'Dagvraag “Klopt je dag?”' }),
        el('span', null, 'Eind van de dag: ', el('span', { klass: 'wt-mono', tekst: vq.laatste || '–' }), ', 15 min voor de eindtijd' + (new Set(Object.values(vq.perDag).filter(Boolean)).size > 1 ? ' (op een korte dag eerder).' : '.')),
        el('span', { tekst: '’s Ochtends bij het starten: als de vorige werkdag nog niet rond is.' }),
        el('span', { klass: 'wt-sub', tekst: 'Alleen de tijd staat hier; de vraag zelf volgt in een latere stap. Op een dag dat iemand niet werkt komt er geen vraag.' })));
      const acties = el('div', { klass: 'wt-acties' });
      const opslaan = el('button', { type: 'button', klass: 'wt-knop primair', tekst: S.bezig ? 'Opslaan…' : 'Opslaan', klik: async () => {
        if (S.bezig) return; S.bezig = true; W.teken();
        const r = await W.bewaar(m.slug, c.dagen, c.pauze).catch(e => ({ ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }));
        S.bezig = false; S.melding = W.bewaarMelding(r, 'Opgeslagen.');
        if (r.ok) S.concept = null;   // bij een fout (ongeldige tijd, geen recht, SharePoint weg) blijven de ingevulde waarden staan
        W.teken(); try { if (r.ok && D.opgeslagen) D.opgeslagen(); } catch (e) {} } });
      const annuleer = el('button', { type: 'button', klass: 'wt-knop', tekst: 'Annuleren', klik: () => { S.concept = null; S.melding = ''; W.teken(); } });
      const standaard = el('button', { type: 'button', klass: 'wt-knop gevaar', tekst: 'Terug naar standaard', title: 'Werktijden van ' + m.naam + ' weghalen: de planning rekent weer met de werkuren per week (8 uur per dag)', klik: async () => {
        const r = await W.bewaar(m.slug, null, 0, { tombstone: true }).catch(e => ({ ok: false, reden: String((e && e.message) || e) })); S.melding = W.bewaarMelding(r, 'Teruggezet naar standaard.'); if (r.ok && r.opgeslagen && r.behouden) S.concept = null; W.teken();   // niet gedeeld: het concept blijft staan, zodat het herstelbaar is
        try { if (r.ok && D.opgeslagen) D.opgeslagen(); } catch (e) {} } });
      if (!mag) { opslaan.disabled = true; standaard.disabled = true; }
      acties.appendChild(opslaan); acties.appendChild(annuleer); if (rec) acties.appendChild(standaard);
      editor.appendChild(acties);
    }
    w.appendChild(el('div', { klass: 'wt-kader' }, el('div', { klass: 'wt-tabelvak' }, tabel), editor));
    if (m) { const afwS = afwSectie(m); if (afwS) w.appendChild(afwS); }
  };

  W.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return W; };
  W.S = S;
  root.MTWerktijden = W;
  if (typeof module !== 'undefined' && module.exports) module.exports = W;
})(typeof window !== 'undefined' ? window : globalThis);
