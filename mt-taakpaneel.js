/* ============================================================================
 * mt-taakpaneel.js: het taakpaneel, de eerste objectdefinitie op het objectpaneel (mt-objectpaneel.js)
 * ----------------------------------------------------------------------------
 * Bart 21-10: "taken uitvouwen als je erop klikt, alles inzien en bewerken, overal zien waar de taak bij hoort en daarheen klikken; afhankelijkheden en bestellingen
 * zien; vanuit de tijdlijn de taak in de juiste bucket zetten en vanuit de buckets zien wanneer hij gepland is. Altijd overal volle controle."
 * Eigen link #taak/<projectcode>/<taak-id> (dezelfde vorm als de telefoon-deeplink, MTPlanning.deepLinkLees). Opent vanuit de Capaciteit, Mijn werk, Vandaag, de takenlijst
 * van een project en de zoekbalk: overal hetzelfde paneel. Inhoud: herkomst (klant › locatie › project, klikbaar), naam, status, persoon, fase (de bucket), datums met een
 * mini-tijdlijn ("Toon in tijdlijn"), raming, activiteit, prioriteit, notities, voorgangers/opvolgers (klikbaar), de bestellingen van het project, Toggl en verwijderen.
 * Schrijven alleen via de bestaande taakroutes (de cockpit geeft ze mee): velden via D.wijzig (MTPlanVerplaats.taakWijzig: takenSchrijf met het slot per taak, de tijdgrenzen,
 * de controle achteraf en ongedaan maken met stempelbewaking), datums via D.datums (de sleep-spec taakdatums, met de vraag over opvolgers), de rest via de functies van de projecttabel.
 * model() is rekenwerk zonder DOM, zodat het zonder de hele cockpit te testen is.
 * ========================================================================== */
(function (root) {
  'use strict';
  const T = {};
  let D = null, P = null, O = null;

  // ── kleine hulpjes ──
  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const ymdOk = s => !!(P && P.isYmd(s));
  const datum = s => ymdOk(s) ? P.datumKort(s) : '';
  const STATUS_KL = { todo: 'open', bezig: 'bezig', wacht: 'wacht', klaar: 'klaar' };
  const PRIO = { high: 'P1 hoog', medium: 'P2 normaal', low: 'P3 laag' };
  const persNaam = slug => { const m = ((D && D.team && D.team()) || []).find(x => x && zelfde(x.slug, slug)); return m ? m.naam : String(slug || ''); };
  const mag = wat => { try { return !!(D.mag && D.mag[wat] && D.mag[wat]()); } catch (e) { return false; } };
  const naWijziging = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) {} } };
  const toast = (t, o, l, lb) => O.H.toast(t, o, l, lb);

  T.href = (code, id) => P.deepLinkTaak('', code, id);
  // De fasen (buckets) waarin taken van dit project staan, plus die van het standaardsjabloon; de taak bewaart de naam van de fase (zoals het sjabloon hem zet)
  const faseOpties = (lijst, huidig) => {
    const namen = []; const voeg = n => { const s = String(n || '').trim(); if (s && !namen.some(x => zelfde(x, s))) namen.push(s); };
    try { P.fasenLijst().forEach(f => voeg(f.label)); } catch (e) {}   // P3b: de fases uit Planning inrichten (met hun huidige namen), daarna eigen fases van het project
    (lijst || []).forEach(t => voeg(P.faseLabel(t))); voeg(P.faseLabel({ fase: huidig }));
    return namen;
  };

  // ── rekenwerk (geen DOM) ──
  // → { ok:false } | { ok:true, sleutel, code, taak, project, voorgangers, opvolgers, wacht, bestel, mensen, raming, fasen, blokken }
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
    // F2a: het type (EB/BB/EE/BE), de wachttijd (of voorsprong) en de soort (werkdagen of levertijd) per koppeling; `botst` volgt het type (P.depToets)
    const depKoppel = e => ({ lag: e.lag || 0, type: e.type || 'FS', lagSoort: e.lagSoort || 'proces', depId: e.id, bron: e.bron, inactief: !!e.inactief });
    const voorgangers = edges.filter(e => String(e.naar) === String(t.id)).map(e => {
      const v = perId.get(String(e.van)); if (!v) return null;
      const dt = P.depToets(e, v, t, { vrij }), r = Object.assign(kort(v), depKoppel(e), { vroegst: dt.vroegst, vroegstEind: dt.vroegstEind });
      r.botst = !r.inactief && r.status !== 'klaar' && dt.botst;
      return r;
    }).filter(Boolean);
    const opvolgers = edges.filter(e => String(e.van) === String(t.id)).map(e => {
      const n = perId.get(String(e.naar)); if (!n) return null;
      const dt = P.depToets(e, t, n, { vrij }), r = Object.assign(kort(n), depKoppel(e), { vroegst: dt.vroegst, vroegstEind: dt.vroegstEind });
      r.botst = !r.inactief && (t.status || 'todo') !== 'klaar' && r.status !== 'klaar' && dt.botst;
      return r;
    }).filter(Boolean);
    let wacht = { wacht: false, op: [] }; try { wacht = P.taakWacht(t, lijst, depsRuw, { vrij, vandaag, alle, code: k || code }); } catch (e) {}
    // F2b: koppelingen met taken uit andere projecten. Een voorganger-koppeling staat in dit project (te bewerken); een opvolger in een ander project bewerk je daar.
    const kruisRij = (x, project, d, wie) => {
      const pk = sleutelVan(alle, project) || project, pp = (D.project && D.project(pk)) || { code: pk, naam: '', nummer: '' };
      return Object.assign(kort(x), { naam: pk + ': ' + (x.naam || '(zonder naam)'), taakNaam: x.naam || '(zonder naam)', project: pk, projectNaam: pp.naam || '', kruis: wie, lag: Number(d.lag_dagen) || 0, type: d.type || 'FS', lagSoort: d.lag_soort === 'levertijd' ? 'levertijd' : 'proces', depId: d.id, bron: 'dep', inactief: d.status === 'uit' });
    };
    let kruisVoor = [], kruisNa = [];
    try {
      const kr = P.depsKruis(afh, ak || k || code, t.id), vind = (p, i) => { const pk = sleutelVan(alle, p); return pk ? (alle[pk] || []).find(y => y && !y._vervallen && String(y.id) === String(i)) : null; };
      kruisVoor = kr.voor.map(q => { const x = vind(q.project, q.taak); if (!x) return null; const r = kruisRij(x, q.project, q.dep, 'voor'), dt = P.depToets({ van: x.id, naar: t.id, lag: r.lag, type: r.type, lagSoort: r.lagSoort }, x, t, { vrij }); r.vroegst = dt.vroegst; r.vroegstEind = dt.vroegstEind; r.botst = !r.inactief && r.status !== 'klaar' && dt.botst; return r; }).filter(Boolean);
      kruisNa = kr.na.map(q => { const x = vind(q.project, q.taak); if (!x) return null; const r = kruisRij(x, q.project, q.dep, 'na'), dt = P.depToets({ van: t.id, naar: x.id, lag: r.lag, type: r.type, lagSoort: r.lagSoort }, t, x, { vrij }); r.vroegst = dt.vroegst; r.vroegstEind = dt.vroegstEind; r.botst = !r.inactief && (t.status || 'todo') !== 'klaar' && r.status !== 'klaar' && dt.botst; return r; }).filter(Boolean);
    } catch (e) { kruisVoor = []; kruisNa = []; }
    const andereProjecten = Object.keys(alle).filter(p => !p.startsWith('__') && Array.isArray(alle[p]) && !zelfde(p, k || code) && alle[p].some(y => y && !y._vervallen)).map(p => { const pp = (D.project && D.project(p)) || { code: p, naam: '', nummer: '' }; return { code: p, label: (pp.nummer ? pp.nummer + ' ' : '') + (pp.naam || p), taken: alle[p].filter(y => y && !y._vervallen).map(kort) }; }).sort((a, b) => String(a.label).localeCompare(String(b.label), 'nl'));
    let beperkingConflict = null; try { beperkingConflict = P.beperkingConflicten([t], { vrij })[0] || null; } catch (e) { beperkingConflict = null; }
    // Materiaal (P5): de regels die aan DEZE taak hangen (taak_id) met hun verwachte leverdatum, en de andere regels van het project (zelfde regel als MTPlanning.projectStroom).
    const VOLG = { nodig: 0, besteld: 1, geleverd: 2 };
    const regels = (D.bestel ? D.bestel() || [] : []).filter(b => b && typeof b === 'object' && !b._vervallen && b.id !== '__migratie' && ((b.project_id && pr.project_id && b.project_id === pr.project_id) || zelfde(b.project, pr.code)))
      .map(b => { const st = P.bestelStatus(b); return { id: b.id, taak_id: b.taak_id === undefined || b.taak_id === null ? '' : String(b.taak_id), oms: P.bestelOms(b) || 'regel', aantal: b.aantal || 1, eenheid: P.eenheidTekst(b.eenheid, b.aantal || 1), leverancier: b.leverancier || '', status: st, label: P.BESTEL_STATUS_LABEL[st] || st, voorstel: b.voorstel ? P.voorstelTekst(b.voorstel) : '' }; })
      .sort((a, b) => (VOLG[a.status] - VOLG[b.status]) || String(a.oms).localeCompare(String(b.oms), 'nl'));
    const tel = { nodig: 0, besteld: 0, geleverd: 0 }; regels.forEach(r => { tel[r.status] = (tel[r.status] || 0) + 1; });
    const koppel = P.bestelVanTaak(D.bestel ? D.bestel() || [] : [], t.id, { code: k || code, project_id: pr.project_id }), materiaalTaak = P.taakMateriaal(t, koppel, { vandaag });
    const taakNaam = id => { const x = lijst.find(y => String(y.id) === String(id)); return x ? x.naam : ''; };
    const anderen = regels.filter(r => !koppel.some(x => String(x.id) === String(r.id))).map(r => Object.assign({}, r, { bijTaak: r.taak_id ? taakNaam(r.taak_id) : '' }));
    const materiaal = t.sleutel === 'bestellen' || t.sleutel === 'materiaal_geleverd' || (t.status === 'wacht' && /\b(materiaal|plaat|platen|beslag|bestel|besteld|bestelling|levering|leverancier|geleverd|order)/i.test(String(t.wacht_reden || '')));
    // Planblokken die (nog) aan deze taak hangen (oude tb:-blokken), voor de mini-tijdlijn
    let blokken = []; try { if (D.blokken && P.taakBlokkenVan) blokken = P.taakBlokkenVan(t, lijst, k, D.blokken() || [], alle).filter(b => b && ymdOk(b.datum)).map(b => ({ datum: b.datum, persoon: b.persoon || '', min: Number(b.duurMin) || 0, voorstel: b.status === 'voorstel' })); } catch (e) { blokken = []; }
    return { ok: true, sleutel: { code: k || code, id: t.id }, depsRuw, takenLijst: lijst.map(kort), alleTaken: alle, afhStore: afh, kruisVoor, kruisNa, andereProjecten, beperkingConflict, code: k || code, taak: t, project: pr, voorgangers, opvolgers, wacht, bestel: { regels, tel, materiaal, anderen }, materiaalTaak, checklist: P.checklistActief(t), poortVoorstel: P.poortVoorstel(t, regels), mensen: P.taakMensen(t), raming: P.taakRamingMin(t), fasen: faseOpties(lijst, t.fase), blokken };
  };

  // De mini-tijdlijn (rekenwerk): een venster van hele weken rond de taak (minstens 4, hoogstens 12), met de balk en de planblokken als percentages
  const dnr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymdVan = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const maandag = n => n - (((n + 4) % 7 + 7) % 7 + 6) % 7;
  T.tijdlijnModel = function (m, vandaag) {
    const t = m.taak, nu = dnr(vandaag || P.vandaagYmd());
    const punten = [t.start, t.eind].filter(ymdOk).map(dnr).concat(m.blokken.map(b => dnr(b.datum)));
    if (!punten.length) return null;
    let van = maandag(Math.min(...punten)) - 7, tot = maandag(Math.max(...punten)) + 14;   // een week ervoor, een week erna
    if (tot - van < 28) tot = van + 28; if (tot - van > 84) tot = van + 84;
    const pct = n => Math.max(0, Math.min(100, (n - van) / (tot - van) * 100));
    const weken = []; for (let n = van; n < tot; n += 7) weken.push({ links: pct(n), label: 'wk ' + isoWeek(ymdVan(n)) });
    const balk = ymdOk(t.start) ? { links: pct(dnr(t.start)), breed: Math.max(1.2, pct(dnr(ymdOk(t.eind) ? t.eind : t.start) + 1) - pct(dnr(t.start))) } : null;
    return { van: ymdVan(van), tot: ymdVan(tot - 1), weken, balk, blokken: m.blokken.map(b => ({ links: pct(dnr(b.datum)), breed: Math.max(1, pct(dnr(b.datum) + 1) - pct(dnr(b.datum))), datum: b.datum, voorstel: b.voorstel })), nu: nu >= van && nu < tot ? pct(nu) : null };
  };
  function isoWeek(s) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), dag = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dag); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }

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

  // ── tekenen (met de bouwstenen van het objectpaneel) ──
  function herkomst(m, h) {
    const pr = m.project, hr = D.href || {}, g = D.ga || {};
    return h.kruimels([
      pr.klant ? { kids: pr.klantNaam || pr.klant, href: hr.klant ? hr.klant(pr.klant) : '#', ga: () => g.klant(pr.klant), titel: 'Naar de klant' } : null,
      pr.klant && pr.loc ? { kids: pr.locNaam || pr.loc, href: hr.klant ? hr.klant(pr.klant, pr.loc) : '#', ga: () => g.klant(pr.klant, pr.loc), titel: 'Naar de locatie' } : null,
      { kids: [pr.nummer ? h.el('span', { klass: 'tp-code', tekst: pr.nummer }) : null, pr.nummer ? ' ' : '', pr.naam || m.code], href: hr.project ? hr.project(m.code) : '#', ga: () => g.project(m.code, 'planning'), titel: 'Naar het project (Planning & taken)', klass: 'tp-kruim-project' }]);
  }
  // Afhankelijkheden (F2a): per koppeling het type (EB, BB, EE, BE) en de wachttijd of voorsprong, te bewerken door kantoor (taken:alles) via de veilige route voor afhankelijkheden: vers lezen, kringcontrole,
  // "gezien" (niet stil overschrijven), stempel per veld, Ongedaan maken. Voor wie niet mag bewerken staat de koppeling als tekst.
  const TYPE_OPTIES = [['FS', 'EB: einde-naar-begin'], ['SS', 'BB: begin-naar-begin'], ['FF', 'EE: einde-naar-einde'], ['SF', 'BE: begin-naar-einde']];
  const SOORT_OPTIES = [['proces', 'werkdagen'], ['levertijd', 'kalenderdagen (levertijd)']];
  const nieuwDepId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const kanAfh = () => mag('alles') && !!D.wijzig;
  const afhBedien = (m, x, h) => {
    if (!kanAfh()) return null;
    if (x.kruis === 'na') return h.el('div', { klass: 'tp-sub tp-afh-bed', tekst: 'Deze koppeling staat bij de taak in ' + x.project + '. Open die taak om hem te wijzigen of weg te halen.' });
    if (x.bron !== 'dep') return h.el('div', { klass: 'tp-sub tp-afh-bed', tekst: 'Uit de oude taaklijst: zet de oude koppelingen in het project om, dan kun je hier type en wachttijd kiezen.' });
    const gezien = { type: x.type, lag_dagen: x.lag, lag_soort: x.lagSoort, status: x.inactief ? 'uit' : 'actief' };
    const wijzig = (velden, wat) => h.bewaar({ afhOps: [{ op: 'wijzig', id: x.depId, velden, gezien }] }, wat || 'afhankelijkheid');
    const type = h.el('select', { klass: 'tp-invoer tp-keuze tp-afh-type', 'aria-label': 'Type van de koppeling met ' + x.naam, title: 'Het type koppeling: ' + P.DEP_TYPE_UITLEG[x.type] }, TYPE_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l, title: P.DEP_TYPE_UITLEG[w] })));
    type.value = x.type; type.addEventListener('change', () => wijzig({ type: type.value }, 'type van de afhankelijkheid'));
    const lag = h.el('input', { type: 'number', klass: 'tp-invoer tp-kort tp-afh-lag', min: String(-P.DEP_LAG_MAX), max: String(P.DEP_LAG_MAX), step: '1', value: String(x.lag), 'aria-label': 'Wachttijd met ' + x.naam + ' in dagen (negatief is een voorsprong)', title: 'Wachttijd in dagen; negatief is een voorsprong (de opvolger mag al beginnen voordat de voorganger klaar is)' });
    lag.addEventListener('change', () => { try { lag.blur(); } catch (e) { } wijzig({ lag_dagen: lag.value }, 'wachttijd'); });
    lag.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); lag.value = String(x.lag); lag.blur(); } });
    const soort = h.el('select', { klass: 'tp-invoer tp-keuze tp-afh-soort', 'aria-label': 'Soort wachttijd met ' + x.naam, title: 'Werkdagen (procestijd) of kalenderdagen (levertijd van materiaal)' }, SOORT_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    soort.value = x.lagSoort; soort.addEventListener('change', () => wijzig({ lag_soort: soort.value }, 'soort wachttijd'));
    return h.el('div', { klass: 'tp-afh-bed' }, type, lag, soort, h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', 'aria-label': 'Haal de koppeling met ' + x.naam + ' weg', title: 'De koppeling weghalen (met Ongedaan maken)', tekst: '\u00d7', klik: () => h.bewaar({ afhOps: [{ op: 'weg', id: x.depId, gezien }] }, 'afhankelijkheid weggehaald') }));
  };
  const afhToevoegen = (m, richting, h) => {
    if (!kanAfh()) return null;
    const t = m.taak, bezet = new Set(m.voorgangers.concat(m.opvolgers).map(r => String(r.id)));
    const kans = (m.takenLijst || []).filter(x => String(x.id) !== String(t.id) && !bezet.has(String(x.id)));
    if (!kans.length) return null;
    const sel = h.el('select', { klass: 'tp-invoer tp-keuze', 'aria-label': richting === 'voor' ? 'Voorganger kiezen' : 'Opvolger kiezen' }, [h.el('option', { value: '', tekst: richting === 'voor' ? 'Kies de voorganger...' : 'Kies de opvolger...' })].concat(kans.map(x => {
      const c = P.depControle(m.takenLijst, m.depsRuw || [], richting === 'voor' ? { van: x.id, naar: t.id } : { van: t.id, naar: x.id });
      return h.el('option', { value: x.id, tekst: x.naam + (c.ok ? '' : ' (maakt een kring)'), disabled: c.ok ? null : true });
    })));
    const type = h.el('select', { klass: 'tp-invoer tp-keuze', 'aria-label': 'Type van de nieuwe koppeling' }, TYPE_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    const lag = h.el('input', { type: 'number', klass: 'tp-invoer tp-kort', min: String(-P.DEP_LAG_MAX), max: String(P.DEP_LAG_MAX), step: '1', value: '0', 'aria-label': 'Wachttijd van de nieuwe koppeling in dagen (negatief is een voorsprong)' });
    const soort = h.el('select', { klass: 'tp-invoer tp-keuze', 'aria-label': 'Soort wachttijd van de nieuwe koppeling' }, SOORT_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    const voeg = h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Toevoegen', klik: () => {
      if (!sel.value) { sel.focus(); return; }
      try { lag.blur(); } catch (e) { }
      h.bewaar({ afhOps: [Object.assign({ op: 'nieuw', id: nieuwDepId(), type: type.value, lag_dagen: lag.value, lag_soort: soort.value }, richting === 'voor' ? { van: sel.value, naar: t.id } : { van: t.id, naar: sel.value })] }, 'afhankelijkheid toegevoegd');
    } });
    return h.el('details', { klass: 'tp-afh-nieuw' }, h.el('summary', { tekst: richting === 'voor' ? '+ Voorganger toevoegen' : '+ Opvolger toevoegen' }), h.el('div', { klass: 'tp-afh-bed' }, sel, type, lag, soort, voeg));
  };
  // F2b: een voorganger uit een ander project (bijvoorbeeld dezelfde montageploeg of CNC-order): eerst het project kiezen, dan de taak. De koppeling staat in dit project; de kringcontrole loopt over alle projecten.
  const afhToevoegenKruis = (m, h) => {
    if (!kanAfh() || !(m.andereProjecten || []).length) return null;
    const t = m.taak, bezet = (m.kruisVoor || []).map(x => x.project.toLowerCase() + '|' + x.id);
    const proj = h.el('select', { klass: 'tp-invoer tp-keuze', id: 'tp-kruis-project', 'aria-label': 'Project van de voorganger' }, [h.el('option', { value: '', tekst: 'Kies het project...' })].concat(m.andereProjecten.map(p => h.el('option', { value: p.code, tekst: p.label }))));
    const sel = h.el('select', { klass: 'tp-invoer tp-keuze', id: 'tp-kruis-taak', 'aria-label': 'Taak van de voorganger', disabled: true }, h.el('option', { value: '', tekst: 'Kies eerst een project' }));
    proj.addEventListener('change', () => {
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      const p = m.andereProjecten.find(x => x.code === proj.value);
      sel.disabled = !p; if (!p) { sel.appendChild(h.el('option', { value: '', tekst: 'Kies eerst een project' })); return; }
      sel.appendChild(h.el('option', { value: '', tekst: 'Kies de voorganger...' }));
      p.taken.forEach(x => { const c = P.depControleKruis(m.alleTaken, m.afhStore || {}, { code: m.code, naar: t.id, vanProject: p.code, van: x.id }), dubbel = bezet.includes(p.code.toLowerCase() + '|' + x.id); sel.appendChild(h.el('option', { value: x.id, tekst: x.naam + (dubbel ? ' (al gekoppeld)' : c.ok ? '' : ' (maakt een kring)'), disabled: c.ok && !dubbel ? null : true })); });
    });
    const type = h.el('select', { klass: 'tp-invoer tp-keuze', 'aria-label': 'Type van de nieuwe koppeling' }, TYPE_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    const lag = h.el('input', { type: 'number', klass: 'tp-invoer tp-kort', min: String(-P.DEP_LAG_MAX), max: String(P.DEP_LAG_MAX), step: '1', value: '0', 'aria-label': 'Wachttijd van de nieuwe koppeling in dagen (negatief is een voorsprong)' });
    const soort = h.el('select', { klass: 'tp-invoer tp-keuze', 'aria-label': 'Soort wachttijd van de nieuwe koppeling' }, SOORT_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    const voeg = h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Toevoegen', klik: () => {
      if (!proj.value) { proj.focus(); return; } if (!sel.value) { sel.focus(); return; }
      try { lag.blur(); } catch (e) { }
      h.bewaar({ afhOps: [{ op: 'nieuw', id: nieuwDepId(), van_project: proj.value, van: sel.value, naar: t.id, type: type.value, lag_dagen: lag.value, lag_soort: soort.value }] }, 'afhankelijkheid met een ander project toegevoegd');
    } });
    return h.el('details', { klass: 'tp-afh-nieuw' }, h.el('summary', { tekst: '+ Voorganger uit een ander project' }), h.el('div', { klass: 'tp-afh-bed' }, proj, sel, type, lag, soort, voeg));
  };
  function taakItems(m, lijst, wat, h) {
    return lijst.map(x => ({ href: T.href(x.project || m.code, x.id), ga: () => T.open(x.project || m.code, x.id), naam: x.naam, dot: 'tp-st-' + (STATUS_KL[x.status] || 'open'), titel: 'Open ' + x.naam,
      sub: [P.TAAK_STATUS_LABEL[x.status] || x.status, x.start ? (x.eind && x.eind !== x.start ? datum(x.start) + ' \u2013 ' + datum(x.eind) : datum(x.start)) : 'zonder datum', (x.type !== 'FS' || x.lag || x.lagSoort === 'levertijd') ? P.depTekst(x) : '', x.inactief ? 'koppeling staat uit' : '', x.kruis ? 'ander project' : ''].filter(Boolean).join(' \u00b7 '),
      chips: x.botst ? [h.chip('let op', 'tp-chip-let', wat === 'voor' ? 'Eindigt te laat voor de start van deze taak' : 'Begint te vroeg na het eind van deze taak')] : null, na: afhBedien(m, x, h) }));
  }
  function afhSectie(m, h) {
    const kids = [], t = m.taak;
    const voorAl = m.voorgangers.concat(m.kruisVoor || []), naAl = m.opvolgers.concat(m.kruisNa || []);
    if (!voorAl.length && !naAl.length) kids.push(h.el('p', { klass: 'tp-leeg', tekst: 'Geen voorgangers of opvolgers.' }));
    if (voorAl.length) kids.push(h.el('div', { klass: 'tp-subkop', tekst: 'Eerst (voorgangers)' }), h.relatieLijst(taakItems(m, voorAl, 'voor', h)));
    kids.push(afhToevoegen(m, 'voor', h), afhToevoegenKruis(m, h));
    if (naAl.length) kids.push(h.el('div', { klass: 'tp-subkop', tekst: 'Daarna (opvolgers)' }), h.relatieLijst(taakItems(m, naAl, 'na', h)));
    kids.push(afhToevoegen(m, 'na', h));
    const waarsch = voorAl.filter(x => x.botst).map(x => x.naam + (x.type === 'FF' || x.type === 'SF' ? ' ' + P.DEP_TYPEN[x.type] + ': deze taak kan op zijn vroegst ' + datum(x.vroegst) + ' beginnen en moet op zijn vroegst ' + datum(x.vroegstEind) + ' eindigen (nu ' + datum(t.start) + ' t/m ' + datum(t.eind) + ').' : (x.type === 'SS' ? ' begint ' + datum(x.start) + '; ' : ' eindigt ' + datum(x.eind) + '; ') + (x.type === 'SS' ? 'deze taak kan op zijn vroegst ' : 'deze taak kan op zijn vroegst ') + datum(x.vroegst) + ' beginnen (nu ' + datum(t.start) + ').'))
      .concat(naAl.filter(x => x.botst).map(x => x.naam + (x.type === 'FF' || x.type === 'SF' ? ' ' + P.DEP_TYPEN[x.type] + ': eindigt ' + datum(x.eind) + '; dat kan op zijn vroegst ' + datum(x.vroegstEind) + '.' : ' begint al ' + datum(x.start) + '; dat kan op zijn vroegst ' + datum(x.vroegst) + (x.type === 'SS' ? ' (na het begin van deze taak).' : ' (na het eind van deze taak).'))));
    if (waarsch.length) kids.push(h.el('div', { klass: 'tp-waarsch', role: 'note' }, h.icoon(h.IC.let), h.el('div', null, waarsch.map(w => h.el('div', { tekst: w })), h.el('div', { klass: 'tp-sub', tekst: 'Er wordt niets vanzelf verschoven.' }))));
    if ((t.status || 'todo') === 'todo' && m.wacht && m.wacht.wacht) kids.push(h.el('p', { klass: 'tp-sub', tekst: 'Wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) }));
    if ((t.status || 'todo') !== 'klaar' && m.wacht && m.wacht.eindOp && m.wacht.eindOp.length) kids.push(h.el('p', { klass: 'tp-sub', tekst: 'Deze taak ' + P.eindOpTekst(m.wacht, P.datumKort) + '.' }));
    return h.sectie('tp-h-afh', 'Afhankelijkheden', h.el('span', { klass: 'tp-teller', tekst: String(voorAl.length + naAl.length) }), kids);
  }  // Checklist (P6a): afvinkpunten in de taak, met per punt wie het afvinkte en wanneer ("✓ door Mathijs · 22-10", dezelfde opmaak als bij een afgevinkte taak).
  // Afvinken mag wie een status mag zetten; punten toevoegen, hernoemen en verwijderen is voor kantoor. Elke bewerking gaat als bewerking op de verse stand (D.wijzig met ops): twee mensen die tegelijk afvinken, bewaren allebei het hunne.
  const nieuwClId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const wieNaam = x => { const n = D.naamVan ? D.naamVan(x) : ''; return n || persNaam(x); };
  function checklistSectie(m, h) {
    const t = m.taak, items = m.checklist || [], tel = P.checklistTel(t), kanVink = mag('status') && !!D.wijzig, kanBeheer = mag('alles') && !!D.wijzig;
    const doe = (ops, wat) => h.bewaar({ ops }, wat);
    const kids = [];
    if (!items.length) kids.push(h.el('p', { klass: 'tp-leeg', tekst: 'Nog geen afvinkpunten.' }));
    else kids.push(h.el('ul', { klass: 'tp-lijst tp-checklist', 'aria-label': 'Checklist' }, items.map(x => {
      const vink = h.el('input', { type: 'checkbox', klass: 'tp-clvink', 'aria-label': (x.klaar ? 'Afgevinkt: ' : 'Afvinken: ') + x.tekst, checked: x.klaar ? true : null, disabled: kanVink ? null : true, title: kanVink ? null : h.GEEN_RECHT });
      vink.addEventListener('change', () => doe([{ op: 'vink', id: x.id, klaar: vink.checked }], 'punt ' + (vink.checked ? 'afgevinkt' : 'teruggezet')));
      const tekst = kanBeheer ? h.el('input', { type: 'text', klass: 'tp-invoer tp-cltekst', value: x.tekst, 'aria-label': 'Tekst van het punt: ' + x.tekst, maxlength: '200', autocomplete: 'off' }) : h.el('span', { klass: 'tp-cltekst' + (x.klaar ? ' klaar' : ''), tekst: x.tekst });
      if (kanBeheer) { tekst.addEventListener('change', () => { const w = tekst.value.replace(/\s+/g, ' ').trim(); if (!w || w === x.tekst) { tekst.value = x.tekst; return; } try { tekst.blur(); } catch (e) { } doe([{ op: 'hernoem', id: x.id, tekst: w }], 'punt hernoemd'); }); tekst.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); tekst.value = x.tekst; tekst.blur(); } }); }
      return h.el('li', { klass: 'tp-clrij' }, vink, tekst,
        x.klaar ? h.el('span', { klass: 'tp-sub tp-clwie', tekst: P.checklistKlaarTekst(x, wieNaam) }) : null,
        kanBeheer ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', 'aria-label': 'Verwijder punt: ' + x.tekst, title: 'Verwijderen (met Ongedaan maken)', tekst: '\u00d7', klik: () => doe([{ op: 'weg', id: x.id }], 'punt verwijderd') }) : null);
    })));
    if (kanBeheer) {
      const inv = h.el('input', { type: 'text', klass: 'tp-invoer', placeholder: 'Nieuw punt', 'aria-label': 'Nieuw punt voor de checklist', maxlength: '200', autocomplete: 'off' });
      const naarNieuw = () => { const n = D.doc.querySelector('#tp-paneel input[aria-label="Nieuw punt voor de checklist"]'); if (n) n.focus(); };   // na het hertekenen staat de cursor weer in het veld voor het volgende punt
      const voeg = async () => { const w = inv.value.replace(/\s+/g, ' ').trim(); if (!w) { inv.focus(); return; } inv.value = ''; try { inv.blur(); } catch (e) { } await doe([{ op: 'nieuw', id: nieuwClId(), tekst: w }], 'punt toegevoegd'); naarNieuw(); };   // blur: een paneel dat nog een invoerveld in bewerking heeft tekent niet opnieuw
      inv.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); voeg(); } });
      const wvb = P.checklistUitTeksten(P.CHECKLIST_WVB, { bestaand: t.checklist || [] });
      kids.push(h.el('div', { klass: 'tp-clnieuw' }, inv, h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Toevoegen', klik: voeg })),
        wvb.length ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Werkvoorbereiding-checklist toevoegen', title: 'Voegt ' + wvb.length + ' standaardpunten toe die er nog niet in staan; daarna kun je ze aanpassen', klik: () => doe(wvb.map(x => ({ op: 'nieuw', id: nieuwClId() + x.vol, tekst: x.tekst })), wvb.length + ' punten toegevoegd') }) : null);
    }
    return h.sectie('tp-h-cl', 'Checklist', h.el('span', { klass: 'tp-teller', tekst: tel.n ? tel.klaar + '/' + tel.n : 'leeg' }), kids);
  }
  // Poort (P6b): voor een mijlpaal: welke poort het is, wie de eigenaar is, een bewijs-link en de bron. Groen = klaar. De taken erna wachten met "wacht op poort X". Materiaal binnen kan als voorstel op groen (één klik).
  function poortSectie(m, h) {
    const t = m.taak; if (t.soort !== 'mijlpaal') return null;
    const kan = mag('alles') && !!D.wijzig, team = (D.team && D.team()) || [], p = t.poort ? P.poort(t.poort) : null, groen = (t.status || 'todo') === 'klaar';
    const kids = [h.rij('Poort', h.keuzeVeld('poort', t.poort || '', [['', 'Geen poort']].concat(P.POORTEN.map(x => [x.k, x.l])), { kan, label: 'Soort poort', wat: 'poort', titel: 'Een poort is een mijlpaal die groen moet zijn voordat de taken erna kunnen starten' }))];
    if (p) {
      kids.push(h.rij('Status', h.el('span', { klass: 'tp-poortstatus ' + (groen ? 'groen' : 'rood') }, groen ? 'Groen: ' + p.l.toLowerCase() : 'Nog niet: ' + p.l.toLowerCase()), h.el('span', { klass: 'tp-sub', tekst: p.uitleg })));
      kids.push(h.rij('Eigenaar', h.keuzeVeld('poort_eigenaar', t.poort_eigenaar || '', [['', 'Niemand']].concat(team.map(x => [String(x.slug), x.naam])), { kan, label: 'Eigenaar van de poort', wat: 'eigenaar', titel: 'Wie zorgt dat deze poort groen wordt?' })));
      kids.push(h.rij('Bewijs', h.tekstVeld('poort_bewijs', t.poort_bewijs || '', { kan, label: 'Bewijs-link', wat: 'bewijs', placeholder: 'https://...', lees: v => v === '' ? '' : (P.poortBewijsOk(v) ? v : null), fout: 'Geen geldige link: begin met http:// of https://. Er is niets gewijzigd.', titel: 'Link naar het bewijs: de getekende tekening, de betaling, het opleverformulier' }),
        P.poortBewijsOk(t.poort_bewijs) ? h.el('a', { klass: 'tp-link', href: t.poort_bewijs, target: '_blank', rel: 'noopener noreferrer', tekst: 'Open het bewijs' }) : null));
      kids.push(h.rij('Bron', h.el('span', { klass: 'tp-tekstwaarde', tekst: P.POORT_BRONNEN[t.poort_bron || 'hand'] || 'Handmatig' })));
      if (m.opvolgers.length) kids.push(h.el('p', { klass: 'tp-sub', tekst: (groen ? 'Dit gaf ' : 'Hierop wachten ') + m.opvolgers.length + (m.opvolgers.length === 1 ? ' taak' : ' taken') + ': ' + m.opvolgers.map(x => x.naam).join(', ') + '.' }));
      else kids.push(h.el('p', { klass: 'tp-sub', tekst: 'Er wacht nog geen taak op deze poort; koppel hem onder Afhankelijkheden aan de taak erna.' }));
      if (m.poortVoorstel && !groen && mag('status')) kids.push(h.el('div', { klass: 'tp-melding tp-voorstel' }, h.el('span', { tekst: 'Voorstel: ' + m.poortVoorstel + '. Poort op groen zetten?' }),
        h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Op groen zetten', klik: () => zetStatus(m, 'klaar', h) })));
    }
    return h.sectie('tp-h-poort', 'Poort', h.el('span', { klass: 'tp-teller' + (p && !groen ? ' tp-rood-tekst' : ''), tekst: p ? (groen ? 'groen' : 'open') : 'geen' }), kids);
  }  // Materiaal (P5): de bestelregels van deze taak met hun verwachte leverdatum (rood als die na de geplande start valt), koppelen en loskoppelen, en de andere regels van het project.
  // Schrijven via de bestaande bestelroute van de cockpit (gestempelde velden taak_id, verwacht_op; recht bestellijst:alles), nooit rechtstreeks.
  function materiaalSectie(m, h) {
    const b = m.bestel, mt = m.materiaalTaak, g = D.ga || {}, hr = D.href || {}, naarProject = () => { h.sluit({ stil: true }); g.project(m.code, 'productie'); }, t = m.taak;
    const kan = !!D.bestelKoppel && mag('bestel'), geen = h.GEEN_RECHT;
    const doe = async (belofte, wat) => { let ok = false; try { ok = await belofte; } catch (e) { ok = false; } if (!ok) toast('Niet opgeslagen: ' + wat + '.'); T.ververs(); naWijziging(); };
    const kop = mt.n ? (mt.open ? 'wacht op ' + mt.open + ' regel' + (mt.open === 1 ? '' : 's') : 'alles geleverd') : 'geen regels gekoppeld';
    const kids = [];
    if (mt.open && mt.laat) kids.push(h.el('div', { klass: 'tp-waarsch', role: 'note' }, h.icoon(h.IC.let), h.el('div', null, h.el('div', { tekst: 'Het materiaal komt na de geplande start: ' + mt.items.filter(x => x.laat).map(x => x.oms + ' (' + datum(x.verwacht) + ')').join(', ') + '; de taak start ' + datum(t.start) + '.' }))));
    if (mt.n) {
      kids.push(h.el('ul', { klass: 'tp-lijst tp-mat' }, mt.items.map(x => h.el('li', { klass: 'tp-matrij' },
        h.el('span', { klass: 'tp-tekst' }, h.el('span', { klass: 'tp-naam', tekst: x.oms }), h.el('span', { klass: 'tp-sub', tekst: [String(x.aantal || 1).replace('.', ',') + ' ' + P.eenheidTekst(x.eenheid, x.aantal || 1), x.verlopen ? 'verwacht op ' + datum(x.verwacht) + ' is voorbij' : ''].filter(Boolean).join(' · ') })),
        h.chip(P.BESTEL_STATUS_LABEL[x.status] || x.status, 'tp-bst-' + x.status),
        x.open ? h.el('label', { klass: 'tp-matdatum' }, h.el('span', { klass: 'tp-sub', tekst: 'verwacht' }),
          h.el('input', { type: 'date', klass: 'tp-invoer tp-kort' + (x.laat ? ' tp-rood' : ''), value: x.verwacht, 'aria-label': 'Verwachte leverdatum van ' + x.oms, title: x.laat ? 'Na de geplande start van de taak' : (kan ? 'Verwachte leverdatum' : geen), disabled: kan ? null : true,
            wijzig: ev => { const v = ev.target.value; try { ev.target.blur(); } catch (e) { } doe(D.bestelVerwacht(x.id, v), 'de leverdatum'); } })) : null,
        h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Los', title: kan ? 'Haal deze regel van de taak (hij blijft op de bestellijst)' : geen, disabled: kan ? null : true, klik: () => doe(D.bestelKoppel(x.id, ''), 'het loskoppelen') })))));
    } else kids.push(h.el('p', { klass: 'tp-leeg', tekst: 'Aan deze taak hangt nog geen bestelregel.' }));
    const vrij = b.anderen.filter(r => !r.taak_id), elders = b.anderen.filter(r => r.taak_id);
    if (vrij.length) kids.push(h.el('div', { klass: 'tp-subkop', tekst: 'Koppel een regel van dit project' }), h.el('ul', { klass: 'tp-lijst tp-mat' }, vrij.slice(0, 12).map(r => h.el('li', { klass: 'tp-matrij' },
      h.el('span', { klass: 'tp-tekst' }, h.el('span', { klass: 'tp-naam', tekst: r.oms }), h.el('span', { klass: 'tp-sub', tekst: [String(r.aantal).replace('.', ',') + ' ' + r.eenheid, r.leverancier, r.label].filter(Boolean).join(' · ') })),
      h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Koppel', title: kan ? 'Hang deze regel aan deze taak' : geen, disabled: kan ? null : true, klik: () => doe(D.bestelKoppel(r.id, String(t.id)), 'het koppelen') })))));
    if (vrij.length > 12) kids.push(h.el('p', { klass: 'tp-sub', tekst: '… en nog ' + (vrij.length - 12) + ' regels zonder taak' }));
    if (elders.length) kids.push(h.el('p', { klass: 'tp-sub', tekst: elders.length + ' andere regel' + (elders.length === 1 ? '' : 's') + ' van dit project hangt' + (elders.length === 1 ? '' : 'en') + ' aan een andere taak.' }));
    if (b.regels.length) kids.push(h.el('p', { klass: 'tp-sub tp-projtel', tekst: 'Hele project: ' + b.tel.nodig + ' nodig ' + String.fromCharCode(183) + ' ' + b.tel.besteld + ' besteld ' + String.fromCharCode(183) + ' ' + b.tel.geleverd + ' geleverd' }));
    kids.push(h.el('div', { klass: 'tp-acties' },
      h.link(hr.project ? hr.project(m.code, 'productie') : '#', naarProject, 'Bestellijst van dit project', 'tp-link tp-knoplink'),
      h.link(hr.bestellijst ? hr.bestellijst() : '#', () => { h.sluit({ stil: true }); g.bestellijst(); }, 'Bestellijst (alle projecten)', 'tp-link tp-knoplink')));
    // open als er materiaal aan de taak hangt; een keuze van de gebruiker (open- of dichtklikken) blijft staan bij het hertekenen
    const open = T._matOpen !== undefined ? T._matOpen : !!(mt.n || b.materiaal);
    const det = h.el('details', { klass: 'tp-sec tp-details', open: open ? true : null },
      h.el('summary', null, h.el('h3', { id: 'tp-h-bestel', tekst: 'Materiaal' }), h.el('span', { klass: 'tp-teller' + (mt.laat ? ' tp-rood-tekst' : ''), tekst: kop })), kids);
    det.addEventListener('toggle', () => { T._matOpen = det.open; });
    return det;
  }
  // Datums: de bestaande sleeproute (taakdatums), met de getoonde datums mee zodat er niets stil overschreven wordt
  function datumVelden(m, h) {
    const t = m.taak, mijlpaal = t.soort === 'mijlpaal', klaar = (t.status || 'todo') === 'klaar';
    const waarom = !mag('plannen') ? 'Datums plannen is voor kantoor.' : klaar ? 'Een klare taak plan je niet meer in.' : t.voorstel ? 'Neem het voorstel eerst over; daarna kun je het inplannen.' : '';
    const tekst = ymdOk(t.start) ? (t.eind && t.eind !== t.start ? datum(t.start) + ' t/m ' + datum(t.eind) : datum(t.start)) : 'Nog niet ingepland';
    if (waarom || !D.datums) return h.el('div', null, h.el('span', { klass: 'tp-tekstwaarde', tekst }), waarom ? h.el('span', { klass: 'tp-sub', tekst: waarom }) : null);
    const s0 = ymdOk(t.start) ? t.start : '', e0 = ymdOk(t.eind) ? t.eind : s0;
    const a = h.el('input', { type: 'date', id: 'tp-v-start', klass: 'tp-invoer tp-datum', 'aria-label': mijlpaal ? 'Datum' : 'Start', value: s0 });
    const b = mijlpaal ? null : h.el('input', { type: 'date', id: 'tp-v-eind', klass: 'tp-invoer tp-datum', 'aria-label': 'Eind', value: e0 });
    let bezig = false;
    const opslaan = async () => {
      if (bezig) return;
      const s = a.value, e = b ? b.value : s;
      if (s === s0 && e === e0) return;
      if (!ymdOk(s) || !ymdOk(e)) { h.opslagStatus('fout', 'Vul een geldige ' + (b ? 'start en eind' : 'datum') + ' in.'); return; }
      if (e < s) { h.opslagStatus('fout', 'Het eind ligt voor de start; er is niets gewijzigd.'); return; }
      bezig = true; h.opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await D.datums({ soort: 'taakdatums', taak: { code: m.code, id: t.id, naam: t.naam }, startDatum: s, eindDatum: e, gezien: { start: t.start || '', eind: t.eind || '' } }); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; } finally { bezig = false; }
      h.tekenVeilig(); naWijziging();
      if (r && r.onzeker) { h.opslagStatus('fout', r.reden); return; }
      if (r && r.geannuleerd) { h.opslagStatus('', ''); return; }
      if (!r || !r.ok) { h.opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.', r && r.tegelijk ? null : () => { a.value = s; if (b) b.value = e; opslaan(); }); return; }
      if (r.noop) return;
      h.opslagStatus(r.tegelijk ? 'let' : 'ok', r.tegelijk || 'Opgeslagen');
    };
    // Een datumveld wijzigt al tijdens het typen van het jaar: opslaan bij Enter of wegklikken, niet bij elke wijziging
    [a, b].filter(Boolean).forEach(i => {
      i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); opslaan(); i.blur(); } else if (ev.key === 'Escape' && (a.value !== s0 || (b && b.value !== e0))) { ev.preventDefault(); ev.stopPropagation(); a.value = s0; if (b) b.value = e0; } });
      i.addEventListener('blur', () => setTimeout(() => { const f = D.doc.activeElement; if (f !== a && f !== b) opslaan(); }, 0));
    });
    // Datums wissen (terug naar Ongepland): dezelfde sleeproute (taakwis), met de getoonde datums mee en ongedaan maken in de melding
    const wis = (ymdOk(t.start) || ymdOk(t.eind)) ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', id: 'tp-wis-datums', title: 'De taak gaat terug naar Ongepland (de persoon blijft); ongedaan maken kan in de melding', klik: async () => {
      if (bezig) return; bezig = true; h.opslagStatus('bezig', 'Opslaan…');
      let r; try { r = await D.datums({ soort: 'taakwis', taak: { code: m.code, id: t.id, naam: t.naam }, gezien: { start: t.start || '', eind: t.eind || '' } }); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; } finally { bezig = false; }
      h.tekenVeilig(); naWijziging();
      if (r && r.onzeker) { h.opslagStatus('fout', r.reden); return; }
      if (!r || !r.ok) { h.opslagStatus(r && r.tegelijk ? 'let' : 'fout', (r && r.reden) || 'Niet opgeslagen.'); return; }
      if (!r.noop) h.opslagStatus(r.tegelijk ? 'let' : 'ok', r.tegelijk || 'Datums gewist: de taak staat weer in Ongepland');
    } }, 'Datums wissen') : null;
    return h.el('div', { klass: 'tp-datums' }, a, b ? h.el('span', { klass: 'tp-sub', tekst: 't/m' }) : null, b, wis, h.el('span', { klass: 'tp-sub tp-uitleg', tekst: 'Hangen er opvolgers aan, dan vraag ik eerst of die mee schuiven.' }));
  }
  // De mini-tijdlijn: wanneer staat de taak gepland (balk op een weken-as, met de persoon, de planblokken en vandaag) en "Toon in tijdlijn"
  function tijdlijn(m, h) {
    const tl = T.tijdlijnModel(m), t = m.taak, wie = m.mensen.length ? m.mensen.map(persNaam).join(', ') : 'niemand';
    const toon = D.toonInTijdlijn ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', id: 'tp-toon-tijdlijn', title: 'Naar de capaciteitstijdlijn, met deze taak gemarkeerd', klik: () => D.toonInTijdlijn(m.code, t.id, ymdOk(t.start) ? t.start : (tl ? tl.van : '')) }, h.icoon(h.IC.tijd), 'Toon in tijdlijn') : null;
    if (!tl) {
      const inpl = D.inplannen && mag('plannen') && (t.status || 'todo') !== 'klaar' && !t.voorstel ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', klik: () => D.inplannen({ code: m.code, id: t.id, naam: t.naam, min: m.raming }), tekst: 'Inplannen…', title: 'Kies persoon en dag (zoals Inplannen in Vandaag)' }) : null;
      return h.el('div', { klass: 'tp-tl tp-tl-leeg' }, h.el('span', { klass: 'tp-sub', tekst: 'Nog niet ingepland: de taak staat in Ongepland.' }), h.el('span', { klass: 'tp-acties' }, inpl, toon));
    }
    const as = h.el('div', { klass: 'tp-tl-as', role: 'img', 'aria-label': 'Gepland ' + (ymdOk(t.start) ? datum(t.start) + (t.eind && t.eind !== t.start ? ' t/m ' + datum(t.eind) : '') : 'met planblokken') + ', ' + wie },
      tl.weken.map(w => h.el('span', { klass: 'tp-tl-wk', style: 'left:' + w.links.toFixed(2) + '%', tekst: w.label })),
      tl.balk ? h.el('span', { klass: 'tp-tl-balk tp-st-' + (STATUS_KL[t.status || 'todo'] || 'open'), style: 'left:' + tl.balk.links.toFixed(2) + '%;width:' + tl.balk.breed.toFixed(2) + '%;--block-color:' + P.projectKleur(m.code), title: datum(t.start) + (t.eind && t.eind !== t.start ? ' t/m ' + datum(t.eind) : '') + ' · ' + wie }) : null,
      tl.blokken.map(b => h.el('span', { klass: 'tp-tl-blok' + (b.voorstel ? ' voorstel' : ''), style: 'left:' + b.links.toFixed(2) + '%;width:' + b.breed.toFixed(2) + '%', title: 'Planblok ' + datum(b.datum) + (b.voorstel ? ' (voorstel)' : '') })),
      tl.nu !== null ? h.el('span', { klass: 'tp-tl-nu', style: 'left:' + tl.nu.toFixed(2) + '%', title: 'Vandaag' }) : null);
    return h.el('div', { klass: 'tp-tl' }, as, h.el('div', { klass: 'tp-tl-onder' }, h.el('span', { klass: 'tp-sub', tekst: wie + (m.blokken.length ? ' · ' + m.blokken.length + ' planblok' + (m.blokken.length === 1 ? '' : 'ken') : '') }), toon));
  }
  // F2b: beperking van de taak. Zo snel mogelijk (standaard), niet vóór een datum, uiterlijk op een datum (deadline) of vast op een datum (afspraak met de klant). Beide velden samen, met "gezien".
  const BEP_OPTIES = [['', 'Zo snel mogelijk'], ['niet_voor', 'Niet v\u00f3\u00f3r'], ['uiterlijk', 'Uiterlijk op'], ['vast_op', 'Vast op']];
  const BEP_UITLEG = { '': 'De planning zet de taak zo vroeg als de keten toelaat.', niet_voor: 'De taak start niet voor deze datum (bijvoorbeeld wachten op de klant of een vrije ruimte).', uiterlijk: 'Een deadline: de taak moet op deze datum klaar zijn. De planning verschuift niet, maar meldt het als de keten te laat is.', vast_op: 'Een vaste afspraak met de klant: de taak begint op deze datum. De planning houdt hem vast en meldt een conflict als de voorgangers niet op tijd klaar zijn.' };
  function beperkingVeld(m, h) {
    const t = m.taak, kan = mag('alles') && !!D.wijzig, b = P.beperkingVan(t) || { soort: '', datum: '' }, nu = { beperking: b.soort, beperking_datum: b.datum };
    const sel = h.el('select', { id: 'tp-v-beperking', klass: 'tp-invoer tp-keuze', 'aria-label': 'Beperking van de taak', disabled: kan ? null : true, title: kan ? BEP_UITLEG[b.soort] : 'Dit mag je niet met jouw rol (kantoor beslist).' }, BEP_OPTIES.map(([w, l]) => h.el('option', { value: w, tekst: l })));
    sel.value = b.soort;
    const dat = h.el('input', { type: 'date', id: 'tp-v-beperking_datum', klass: 'tp-invoer tp-datum', 'aria-label': 'Datum van de beperking', value: b.datum, disabled: kan ? null : true });
    dat.hidden = !b.soort;
    const gezien = { beperking: t.beperking || '', beperking_datum: t.beperking_datum || '' };
    const bewaar = (soort, d) => h.bewaar({ velden: { beperking: soort, beperking_datum: soort ? d : '' }, gezien }, 'beperking');
    sel.addEventListener('change', () => {
      if (!sel.value) { bewaar('', ''); return; }
      dat.hidden = false;
      if (ymdOk(dat.value)) bewaar(sel.value, dat.value); else { try { dat.focus(); } catch (e) { } }   // zonder datum eerst vragen; opgeslagen wordt bij het kiezen van de datum
    });
    let klaar = false;
    const opslaan = () => { if (klaar) return; if (!sel.value || !ymdOk(dat.value)) return; if (sel.value === nu.beperking && dat.value === nu.beperking_datum) return; klaar = true; bewaar(sel.value, dat.value); };
    dat.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); opslaan(); dat.blur(); } else if (ev.key === 'Escape' && dat.value !== nu.beperking_datum) { ev.preventDefault(); ev.stopPropagation(); dat.value = nu.beperking_datum; } });
    dat.addEventListener('blur', () => setTimeout(() => { if (D.doc.activeElement !== dat) opslaan(); }, 0));
    const c = m.beperkingConflict;
    const conflict = c ? h.el('div', { klass: 'tp-waarsch', role: 'note' }, h.icoon(h.IC.let), h.el('div', null, h.el('div', { tekst: c.soort === 'niet_voor' ? 'De taak begint al ' + datum(c.start) + ', v\u00f3\u00f3r de datum ' + datum(c.datum) + '.' : c.soort === 'uiterlijk' ? 'De taak eindigt ' + datum(c.eind) + ', ' + c.dagen + ' werkdag' + (c.dagen === 1 ? '' : 'en') + ' na de uiterste datum ' + datum(c.datum) + '.' : 'De taak begint ' + datum(c.start) + ' in plaats van op de vaste datum ' + datum(c.datum) + '.' }), h.el('div', { klass: 'tp-sub', tekst: 'Er wordt niets vanzelf verschoven.' }))) : null;
    return h.el('div', { klass: 'tp-beperking' }, h.el('div', { klass: 'tp-datums' }, sel, dat), h.el('span', { klass: 'tp-sub tp-uitleg', tekst: BEP_UITLEG[b.soort] }), conflict);
  }
  function velden(m, h) {
    const t = m.taak, team = (D.team && D.team()) || [], kan = mag('alles');
    const wieOpties = [['', 'Niemand']].concat(team.filter(x => x && x.slug).map(x => [x.slug, x.naam]));
    if (t.toegewezen && !team.some(x => zelfde(x.slug, t.toegewezen))) wieOpties.push([t.toegewezen, t.toegewezen + ' (niet in het team)']);
    const extra = m.mensen.slice(1).map(persNaam);
    const actOpties = [['', 'Niet ingedeeld']].concat(P.ACTIVITEITEN.map(a => [a.k, a.l]));
    const prioOpties = [['', 'Geen'], ['high', PRIO.high], ['medium', PRIO.medium], ['low', PRIO.low]];
    const faseKeuze = [['', 'Geen fase']].concat(m.fasen.map(f => [f, f]));
    return h.el('div', { klass: 'tp-velden' },
      h.rij('Wie', h.keuzeVeld('toegewezen', t.toegewezen || '', wieOpties, { kan, label: 'Wie', wat: 'persoon' }), extra.length ? h.el('span', { klass: 'tp-sub', tekst: 'ook: ' + extra.join(', ') }) : null),
      h.rij('Fase', h.keuzeVeld('fase', P.faseLabel(t), faseKeuze, { kan, label: 'Fase (bucket)', wat: 'fase', gezien: t.fase || '', titel: 'De fase waarin de taak staat (zoals in de fasenplanning en het sjabloon)' })),
      h.rij(t.soort === 'mijlpaal' ? 'Datum' : 'Datums', datumVelden(m, h), tijdlijn(m, h)),
      h.rij('Beperking', beperkingVeld(m, h)),
      h.rij('Raming', t.soort === 'mijlpaal' ? h.el('span', { klass: 'tp-tekstwaarde', tekst: 'mijlpaal (telt niet mee)' })
        : h.el('div', { klass: 'tp-inline' }, h.tekstVeld('duur_uur', urenTekst(t.duur_uur), { kan, label: 'Raming in uren', klass: 'tp-kort', inputmode: 'decimal', placeholder: '0', lees: T.leesUren, fout: 'Geen geldige raming: typ bijvoorbeeld 6, 6,5 of 2u30. Er is niets gewijzigd.', gezien: String(t.duur_uur == null ? '' : t.duur_uur), wat: 'raming', titel: 'Uren: 6, 6,5, 2u30 of 90m' }), h.el('span', { klass: 'tp-sub', tekst: 'uur' + (m.raming ? ' · ' + P.fmtUurMin(m.raming) : '') }))),
      h.rij('Activiteit', h.keuzeVeld('activiteit', t.activiteit || '', actOpties, { kan, label: 'Activiteit', wat: 'activiteit' })),
      h.rij('Prioriteit', h.keuzeVeld('prioriteit', t.prioriteit || '', prioOpties, { kan, label: 'Prioriteit', wat: 'prioriteit' })),
      h.rij('Notities', h.tekstVeld('omschrijving', t.omschrijving || '', { kan, label: 'Notities', multi: true, placeholder: 'Notitie toevoegen…', wat: 'notities', titel: 'Ctrl+Enter of wegklikken = opslaan, Esc = annuleren' })));
  }
  function meta(m, h) {
    const t = m.taak, delen = [];
    if (t.klaar_op) delen.push('Klaar gemeld ' + datum(t.klaar_op));
    if (t.bron) delen.push('Bron: ' + ({ ai: 'AI-voorstel', handmatig: 'met de hand', sjabloon: 'sjabloon', werkplaats: 'werkplaats' }[t.bron] || t.bron));
    // Toggl: eerlijk wat de stand is, met de bestaande knop (projTaakTogglSync: altijd met bevestiging; MT is de bron)
    let tg = null; try { tg = P.tgActie ? P.tgActie(t) : null; } catch (e) { tg = null; }
    const tgTekst = { actueel: 'Toggl: gelijk', koppelen: 'Niet in Toggl', bijwerken: 'Toggl loopt achter', herkoppelen: 'Toggl-koppeling niet bevestigd', 'extern-verwijderd': 'Weg in Toggl' }[tg] || (t.tg_task_id ? 'Gekoppeld aan Toggl' : 'Niet in Toggl');
    const tgKnop = D.togglSync && mag('alles') && tg && tg !== 'actueel' ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: tg === 'koppelen' ? 'Naar Toggl…' : 'Toggl bijwerken…', title: 'Zet naam en status in Toggl gelijk met MT (met bevestiging)', klik: async () => { await D.togglSync(m.code, t.id); T.ververs(); } }) : null;
    const weg = D.verwijder && mag('alles') ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Verwijderen…', title: 'Taak verwijderen (met bevestiging; een gekoppelde Toggl-taak gaat ook weg)', klik: async () => {
      const code = m.code, id = t.id; await D.verwijder(code, id);
      const nog = T.model(code, id); if (!nog.ok) { T.sluit(); naWijziging(); toast('Taak verwijderd. Hij staat in het takenjournaal.'); } else T.ververs();
    } }) : null;
    return h.el('div', { klass: 'tp-meta' }, h.el('div', { klass: 'tp-meta-regel' }, delen.map(x => h.el('span', { tekst: x })), h.el('span', { tekst: tgTekst }), tgKnop), weg ? h.el('div', { klass: 'tp-acties tp-onder' }, weg) : null);
  }
  // De status als vier zichtbare knoppen (geen rondgaande knop): Open · Bezig · Wacht (met een reden) · Klaar
  async function zetStatus(m, nieuw, h) {
    const t = m.taak, huidig = t.status || 'todo', dlg = h.dialoog;
    if (huidig === nieuw && nieuw !== 'wacht') return;
    let reden = '';
    if (nieuw === 'wacht') {
      if (!dlg || !dlg.prompt) return;
      for (let i = 0; i < 3; i++) {
        const r = await dlg.prompt({ title: 'Waarom wacht deze taak?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (t.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
        if (r === null || r === undefined) return;
        reden = String(r).replace(/\s+/g, ' ').trim(); if (reden.length >= 2) break;
        reden = ''; toast('Een reden is verplicht bij Wacht.');
      }
      if (!reden) return;
    } else if (huidig === 'todo' && m.wacht && m.wacht.wacht && dlg && dlg.confirm) {   // een taak die op een voorganger wacht start pas na een bevestiging (zoals in de projecttabel en op de telefoon)
      const ja = await dlg.confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + P.wachtOpTekst(m.wacht, P.datumKort) + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    let matVers = m.materiaalTaak;   // vers: eerst de gezamenlijke bestellijst lezen, een collega kan intussen een regel aan de taak gekoppeld hebben
    if (nieuw !== 'wacht' && D.bestelVers && matVers) { try { const vers = await D.bestelVers(); matVers = P.taakMateriaal(t, P.bestelVanTaak(vers || [], t.id, { code: m.code, project_id: m.project && m.project.project_id }), { vandaag: P.vandaagYmd() }); } catch (e) { } }
    if (nieuw !== 'wacht' && matVers && P.materiaalVraagBevestiging(t, matVers, nieuw) && dlg && dlg.confirm) {   // een taak met open materiaal gaat niet stil naar Bezig of Klaar (P5)
      const ja = await dlg.confirm({ title: 'Het materiaal is nog niet binnen', message: P.materiaalBevestigTekst(t.naam, matVers, nieuw, P.datumKort), okLabel: 'Toch doorgaan' });
      if (!ja) return;
    }
    await h.bewaar({ velden: { status: nieuw }, gezien: { status: huidig, wacht_reden: t.wacht_reden || '', klaar_op: t.klaar_op || '' }, reden }, 'status ' + (P.TAAK_STATUS_LABEL[nieuw] || nieuw).toLowerCase());
  }
  function statusRij(m, h) {
    const st = m.taak.status || 'todo', kan = mag('status') && !!D.wijzig;
    const groep = h.el('div', { klass: 'tp-statusknoppen', role: 'group', 'aria-label': 'Status' }, P.TAAK_STATUSSEN.map(s => h.el('button', { type: 'button', klass: 'tp-stknop tp-st-' + STATUS_KL[s] + (s === st ? ' aan' : ''), 'aria-pressed': s === st ? 'true' : 'false', disabled: kan ? null : true, title: kan ? (s === 'wacht' ? 'Op Wacht zetten (met een reden)' : 'Zet op ' + P.TAAK_STATUS_LABEL[s]) : h.GEEN_RECHT, klik: () => zetStatus(m, s, h), tekst: P.TAAK_STATUS_LABEL[s] })));
    return h.el('div', null, h.el('div', { klass: 'tp-statusrij' }, groep),
      st === 'wacht' && m.taak.wacht_reden ? h.el('div', { klass: 'tp-sub tp-wachtreden', tekst: 'Wacht: ' + m.taak.wacht_reden }) : null, h.opslagZone());
  }
  // Voorstel van de werkplaats en een veldconflict: de bestaande functies van de projecttabel (met hun eigen meldingen)
  function meldingen(m, h) {
    const t = m.taak, kids = [];
    if (t.voorstel) {
      const kan = mag('alles') && D.neemOver;
      kids.push(h.el('div', { klass: 'tp-melding tp-voorstel' }, h.el('span', { tekst: P.voorstelTekst(t.voorstel) }),
        kan ? h.el('span', { klass: 'tp-acties' }, h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Overnemen', title: 'De markering eraf: het is dan een gewone taak', klik: async () => { await D.neemOver(m.code, t.id); T.ververs(); naWijziging(); } }),
          h.el('button', { type: 'button', klass: 'tp-knop tp-klein tp-gevaar', tekst: 'Afwijzen…', title: 'Van de takenlijst halen (blijft in het journaal)', klik: async () => { await D.wijsAf(m.code, t.id); T.ververs(); naWijziging(); } }))
          : h.el('span', { klass: 'tp-sub', tekst: 'Kantoor beslist' })));
    }
    if (t._veldconflict && Object.keys(t._veldconflict).length && D.conflict) kids.push(h.el('div', { klass: 'tp-melding tp-conflict' }, h.el('span', { tekst: 'Twee mensen wijzigden tegelijk ' + Object.keys(t._veldconflict).length + ' veld(en) van deze taak.' }),
      mag('alles') ? h.el('button', { type: 'button', klass: 'tp-knop tp-klein', tekst: 'Kiezen…', klik: async () => { await D.conflict(m.code, t.id); T.ververs(); naWijziging(); } }) : null));
    return kids.length ? h.el('div', { klass: 'tp-meldingen' }, kids) : null;
  }

  // De objectdefinitie voor het objectpaneel
  const DEF = {
    soort: 'taak', label: 'Taak',
    lees: hash => { const r = P.deepLinkLees(hash); return r && r.soort === 'taak' ? { code: r.code, id: String(r.id) } : null; },
    href: s => T.href(s.code, s.id),
    sleutelTekst: s => String(s.code) + '/' + String(s.id),
    klaar: () => !D.takenKlaar || D.takenKlaar(),
    ruw: () => (D.ruw ? D.ruw() : ''),
    model: s => T.model(s.code, s.id),
    schrijf: (s, spec, opt) => { const m = T.model(s.code, s.id); return D.wijzig(Object.assign({ code: m.ok ? m.code : s.code, id: s.id, naam: m.ok ? m.taak.naam : '' }, spec), opt); },
    herstel: (w, opt) => D.wijzigHerstel(w, opt),
    naWijziging,
    teken: (m, h) => {
      if (!m.ok) {
        const klaar = DEF.klaar(), code = m.code;
        return { aria: 'Taak', titel: h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: klaar ? 'Taak niet gevonden' : 'Taken laden…' }), body: [
          h.el('p', { klass: 'tp-sub', tekst: klaar ? 'Deze taak bestaat niet (meer). Misschien is hij verwijderd of naar een ander project verplaatst.' : ((D.takenStatusTekst && D.takenStatusTekst()) || 'De takenlijst is nog niet geladen.') }),
          D.ga && D.ga.project ? h.link(D.href && D.href.project ? D.href.project(code) : '#', () => { h.sluit({ stil: true }); D.ga.project(code, 'planning'); }, 'Naar het project', 'tp-link tp-knoplink') : null] };
      }
      // De naam ziet eruit als een kop, maar is een veld: klikken = bewerken (bewerkbaar oogt = bewerkbaar)
      const titel = D.wijzig ? h.el('h2', { id: 'tp-titel', klass: 'tp-titel' }, h.tekstVeld('naam', m.taak.naam || '', { kan: mag('alles'), label: 'Taaknaam', klass: 'tp-titelinvoer', wat: 'naam', fout: 'Een taak heeft een naam nodig; er is niets gewijzigd.', lees: v => v ? v : null, titel: 'Klik om de naam te wijzigen · Enter = opslaan, Esc = annuleren' }))
        : h.el('h2', { id: 'tp-titel', klass: 'tp-titel', tekst: m.taak.naam || '(zonder naam)' });
      return { aria: 'Taak: ' + (m.taak.naam || ''), boven: herkomst(m, h), titel, body: [statusRij(m, h), meldingen(m, h), velden(m, h), poortSectie(m, h), checklistSectie(m, h), afhSectie(m, h), materiaalSectie(m, h), meta(m, h)] };
    }
  };
  // De stijl van wat alleen de taak heeft (de mini-tijdlijn)
  const STIJL_TAAK = [
    '#tp-paneel .tp-clrij{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line,#dfd8cb)}#tp-paneel .tp-clvink{width:22px;height:22px;flex:0 0 auto;accent-color:var(--green,#2A4A38)}#tp-paneel .tp-cltekst{flex:1 1 200px;min-width:0}#tp-paneel .tp-cltekst.klaar{text-decoration:line-through;color:var(--ink-2,#666)}#tp-paneel .tp-clwie{white-space:nowrap}#tp-paneel .tp-clnieuw{display:flex;gap:8px;margin:8px 0}#tp-paneel .tp-clnieuw .tp-invoer{flex:1 1 auto}',
  '#tp-paneel .tp-poortstatus{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:12.5px}#tp-paneel .tp-poortstatus.groen{background:#e3f1e6;color:#1d5b2f}#tp-paneel .tp-poortstatus.rood{background:#fbe9e7;color:#b3261e}',
  '#tp-paneel .tp-afh-bed{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:4px 0 8px 22px}#tp-paneel .tp-afh-bed .tp-invoer{width:auto;min-width:0;flex:0 1 auto}#tp-paneel .tp-afh-bed .tp-afh-lag{width:70px;flex:0 0 70px}#tp-paneel .tp-afh-nieuw{margin:6px 0}#tp-paneel .tp-afh-nieuw summary{cursor:pointer;font-size:13px;color:var(--green,#2A4A38)}',
  '#tp-paneel .tp-matrij{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line,#dfd8cb)}#tp-paneel .tp-matrij .tp-tekst{flex:1 1 160px}#tp-paneel .tp-matdatum{display:inline-flex;align-items:center;gap:6px}#tp-paneel .tp-rood{border-color:#b3261e !important;color:#b3261e}#tp-paneel .tp-rood-tekst{color:#b3261e;font-weight:600}#tp-paneel .tp-tl{margin-top:8px}#tp-paneel .tp-tl-leeg{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '#tp-paneel .tp-tl-as{position:relative;height:46px;border:1px solid var(--line,#dfd8cb);border-radius:4px;background:var(--surface-sunken,#f1ede5);overflow:hidden}',
    '#tp-paneel .tp-tl-wk{position:absolute;top:0;bottom:0;padding:2px 0 0 3px;border-left:1px solid var(--line,#dfd8cb);font:500 10px/12px var(--mono,monospace);color:var(--ink-3,#646a64);white-space:nowrap}',
    '#tp-paneel .tp-tl-balk{position:absolute;top:18px;height:14px;border-radius:3px;background:var(--block-color,#3e5c76);opacity:.85}#tp-paneel .tp-tl-balk.tp-st-klaar{opacity:.45}',
    '#tp-paneel .tp-tl-blok{position:absolute;top:35px;height:6px;border-radius:2px;background:var(--brass,#d19a1f)}#tp-paneel .tp-tl-blok.voorstel{background:transparent;border:1px dashed var(--brass,#d19a1f)}',
    '#tp-paneel .tp-tl-nu{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--brass,#d19a1f)}',
    '#tp-paneel .tp-tl-onder{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}',
    '.cn-blok.tp-gemarkeerd{outline:3px solid var(--brass,#d19a1f);outline-offset:1px;animation:tp-puls 1.2s ease-out 2}@keyframes tp-puls{50%{outline-color:transparent}}'
  ];

  // De takentabel van een project (v2.html, projectTakenHtml): de taaknaam wordt achteraf een link naar het paneel (DOM achteraf, zodat het sjabloon van de tabel ongewijzigd blijft)
  T.verrijkTaken = function (code, wortel) {
    if (!wortel || !code) return 0;
    const alle = D.taken() || {}, k = sleutelVan(alle, code); if (!k) return 0;
    const sid = String(k).replace(/-/g, ''), h = O.H; let n = 0;
    (alle[k] || []).forEach(t => {
      if (!t || t._vervallen || t.id == null) return;
      const tr = wortel.querySelector('#' + (root.CSS && root.CSS.escape ? root.CSS.escape('pt-row-' + sid + '-' + t.id) : ('pt-row-' + sid + '-' + t.id))), td = tr && tr.children[2];
      if (!td || td.querySelector('.tp-naamlink')) return;
      const tekst = [...td.childNodes].find(x => x.nodeType === 3 && x.textContent.trim());
      if (!tekst) return;
      const a = h.link(T.href(k, t.id), () => T.open(k, t.id, { terug: a }), tekst.textContent, 'tp-link tp-naamlink', { title: 'Open de taak (alle details)' });
      td.replaceChild(a, tekst); n++;
    });
    if (n) O.paneelEl();   // de stijl staat er dan (de link heeft een eigen klasse)
    return n;
  };

  // Het Toggl-bord (Uren ▸ Board) toont Toggl-taken: een tegel opent het paneel van de MT-taak die eraan gekoppeld is (tg_task_id). → true als er een MT-taak was
  T.openViaToggl = function (tgId, terug) {
    const alle = D.taken() || {};
    for (const code of Object.keys(alle)) { if (code.startsWith('__')) continue; const t = (alle[code] || []).find(x => x && !x._vervallen && x.tg_task_id != null && String(x.tg_task_id) === String(tgId)); if (t) return T.open(code, t.id, { terug }); }
    return false;
  };  // ── de bekende ingangen (dezelfde namen als vóór het objectpaneel) ──
  T.open = (code, id, o) => (code == null || id == null || id === '') ? false : O.open('taak', { code: String(code), id: String(id) }, o);
  T.sluit = o => O.sluit(o);
  T.isOpen = () => O.isOpen('taak');
  T.huidig = () => { const h = O.huidig(); return h && h.soort === 'taak' ? { code: h.sleutel.code, id: h.sleutel.id } : null; };
  T.ververs = () => O.ververs();
  T.teken = () => O.teken();
  T.bezigMetBewerken = () => O.bezigMetBewerken();

  T.init = function (deps) {
    D = deps; P = deps.planning || root.MTPlanning; O = deps.objectpaneel || root.MTObjectPaneel;
    O.init({ doc: deps.doc, toast: deps.toast, get dialoog() { return deps.dialoog; } });
    if (!O.STIJL.includes(STIJL_TAAK[0])) STIJL_TAAK.forEach(r => O.STIJL.push(r));
    O.registreer(Object.assign({}, DEF, { startLink: deps.startLink }));
    // Het Toggl-bord: een klik op een tegel (geen sleep: de browser stuurt dan geen klik) opent het paneel van de gekoppelde MT-taak
    if (deps.bordKlik && deps.doc && !T._bord) { T._bord = true; deps.doc.addEventListener('click', ev => {
      const tegel = ev.target && ev.target.closest && ev.target.closest('#tg-board .tg-tile[data-id]'); if (!tegel) return;
      if (!T.openViaToggl(tegel.getAttribute('data-id'), tegel)) toast('Deze Toggl-taak hoort niet bij een taak in de MT tool (nog niet gekoppeld).');
    }); }
    return T;
  };
  root.MTTaakPaneel = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})(typeof window !== 'undefined' ? window : globalThis);
