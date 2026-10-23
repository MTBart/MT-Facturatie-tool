/* ============================================================================
 * mt-bord.js: het Bord in Agenda (planning brok P3): Status · Stroom · Fase
 * ----------------------------------------------------------------------------
 * Rustig zoals ClickUp en monday: kolommen, kaarten met alleen de kern (naam, project, wie, einddatum, bij Wacht de reden), "+ taak" onder aan een kolom, weinig kleur.
 *  - Status: de vier MT-statussen als kolommen (Open · Bezig · Wacht · Klaar); Wacht is de "Blocked"-kolom. Afgerond toont de laatste 14 dagen; "Toon alle" haalt de rest erbij.
 *  - Fase: de fasen (buckets) van het standaardsjabloon als kolommen, plus "Geen fase". Afgeronde taken zijn standaard verborgen.
 *  - Stroom: een rij per actief project door de stations (Voorbereiding tot Montage), dezelfde berekening als op de werkplaats-tv (MTPlanning.projectStroom). Alleen lezen.
 * Slepen verandert de status of de fase via dezelfde schrijfroute als het taakpaneel (D.wijzig = MTPlanVerplaats.taakWijzig: vers lezen, ETag, slot per taak, stempels, controle achteraf)
 * en met dezelfde spec (specStatus, specFase), met Ongedaan maken in een melding. Naar Wacht vraagt een verplichte reden. Een taak die op een voorganger wacht start na een bevestiging.
 * Voor touch en toetsenbord heeft elke kaart een knop "Verplaats naar…". Een klik op de kaart opent het taakpaneel. De filterbalk is die van P0 (mt-planfilter.js).
 * Toggl wordt hier nooit aangeraakt: de bestaande Toggl-knoppen (taakpaneel, takenlijst van het project) blijven de enige route.
 * Model en specs zijn rekenwerk zonder DOM (los te testen); tekent met DOM-calls, nooit met opgebouwde HTML. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const Bd = {};
  let D = null, P = null;
  const INDELINGEN = [['status', 'Status'], ['stroom', 'Stroom'], ['fase', 'Fase']];
  const KLAAR_DAGEN = 14;
  const S = { toonKlaar: false, bezig: false, sleep: null };

  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const PF = () => root.MTPlanFilter || null;
  const statusLabel = s => (P.TAAK_STATUS_LABEL && P.TAAK_STATUS_LABEL[s]) || s;
  Bd.INDELINGEN = INDELINGEN;

  // ── specs: dezelfde vorm als in het taakpaneel (mt-taakpaneel.js, zetStatus en het faseveld), zodat de stempels identiek zijn ──
  Bd.specStatus = (code, t, nieuw, reden) => ({ code, id: t.id, naam: t.naam || '', velden: { status: nieuw }, gezien: { status: t.status || 'todo', wacht_reden: t.wacht_reden || '', klaar_op: t.klaar_op || '' }, reden: reden || '' });
  Bd.specFase = (code, t, fase) => ({ code, id: t.id, naam: t.naam || '', velden: { fase: fase || '' }, gezien: { fase: t.fase || '' } });

  // ── rekenwerk (geen DOM) ──
  const dagenTussen = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
  const PRIO_VOLGORDE = { high: 0, medium: 1, low: 2 };
  // o = { taken, afhank, projecten (lijst {code,label}), project (label-functie), team, vandaag, vrij, filter: { project, persoon (slug of ''), status (taakstatus of '') }, indeling, toonKlaar }
  // → status/fase: { indeling, kolommen: [{ k, label, kaarten, verborgen }], filtert } ; stroom: zie MTPlanning.projectStroom
  Bd.kaarten = function (o) {
    const taken = o.taken || {}, vandaag = o.vandaag || P.vandaagYmd(), f = o.filter || {}, team = o.team || [];
    const matKaart = (t, code, pr) => { const m = P.taakMateriaal(t, P.bestelVanTaakIdx(matIdx, t.id, { code, project_id: pr.project_id }), { vandaag }); return m.wacht ? m : null; };
    const bekend = new Map(); (o.projecten || []).forEach(p => { if (p && p.code) bekend.set(String(p.code).toLowerCase(), p); });
    const uit = [], matIdx = P.bestelIndexTaak(o.bestel);   // P5: de bestelregels die aan een taak hangen, één keer geïndexeerd
    Object.keys(taken).forEach(code => {
      if (code.startsWith('__')) return;
      const pr = bekend.get(String(code).toLowerCase()); if (!pr) return;   // alleen taken van projecten die in de lijst staan (niet van verwijderde of onbekende)
      if (f.project && !zelfde(f.project, code)) return;
      const lijst = P.takenActief(Array.isArray(taken[code]) ? taken[code] : []);
      const dk = sleutelVan(o.afhank, code), deps = dk ? o.afhank[dk] : [], wacht = P.wachtOverzicht(lijst, deps, { vrij: o.vrij, vandaag });
      lijst.forEach(t => {
        const st = t.status || 'todo';
        if (f.persoon && !P.taakMensen(t).some(m => P.zelfdePersoon(m, f.persoon, team))) return;
        if (f.status && st !== f.status) return;
        const w = wacht[t.id] || { wacht: false, op: [] }, eerste = P.taakMensen(t)[0], lid = eerste ? team.find(m => m && P.zelfdePersoon(m.slug, eerste, team)) : null;
        uit.push({ code, id: t.id, naam: t.naam || '(zonder naam)', projectLabel: pr.label || pr.code, status: st, fase: t.fase || '', persoon: lid ? lid.slug : (eerste || ''), persoonNaam: lid ? lid.naam : (eerste || ''),
          eind: P.isYmd(t.eind) ? t.eind : '', teLaat: st !== 'klaar' && P.isYmd(t.eind) && t.eind < vandaag, wachtReden: st === 'wacht' ? String(t.wacht_reden || '') : '',
          wachtOp: st === 'todo' && w.wacht ? P.wachtOpTekst(w, P.datumKort) : '', project_id: pr.project_id || '', mat: matKaart(t, code, pr), klaarOp: P.isYmd(t.klaar_op) ? t.klaar_op : '', prio: t.prioriteit || '', taak: t });
      });
    });
    const volg = (a, b) => ((PRIO_VOLGORDE[a.prio] === undefined ? 3 : PRIO_VOLGORDE[a.prio]) - (PRIO_VOLGORDE[b.prio] === undefined ? 3 : PRIO_VOLGORDE[b.prio])) || (a.eind && b.eind ? (a.eind < b.eind ? -1 : a.eind > b.eind ? 1 : 0) : (a.eind ? -1 : b.eind ? 1 : 0)) || (a.naam.toLowerCase() < b.naam.toLowerCase() ? -1 : 1);
    return uit.sort(volg);
  };
  // Fasen (buckets): die van het standaardsjabloon in zijn volgorde, daarna wat er verder in de taken staat
  Bd.fasen = function (kaarten) {
    const namen = []; const voeg = n => { const s = String(n || '').trim(); if (s && !namen.some(x => zelfde(x, s))) namen.push(s); };
    try { (P.sjabloonStd().fases || []).forEach(x => voeg(x.naam)); } catch (e) {}
    kaarten.forEach(k => voeg(k.fase));
    return namen;
  };
  Bd.model = function (o) {
    const indeling = o.indeling === 'fase' ? 'fase' : 'status', vandaag = o.vandaag || P.vandaagYmd(), toonKlaar = !!o.toonKlaar;
    let kaarten = Bd.kaarten(o), verborgenKlaar = 0;
    const recent = k => !k.klaarOp || dagenTussen(k.klaarOp, vandaag) <= KLAAR_DAGEN;   // zonder klaardatum: tonen
    if (indeling === 'status') {
      const kolommen = P.TAAK_STATUSSEN.map(s => ({ k: s, label: statusLabel(s), kaarten: kaarten.filter(c => c.status === s), verborgen: 0 }));
      const klaar = kolommen.find(c => c.k === 'klaar');
      if (!toonKlaar) { const alle = klaar.kaarten; klaar.kaarten = alle.filter(recent); klaar.verborgen = alle.length - klaar.kaarten.length; klaar.kaarten.sort((a, b) => (b.klaarOp || '') < (a.klaarOp || '') ? -1 : 1); }
      const filtert = !!(o.filter && (o.filter.project || o.filter.persoon || o.filter.status));
      return { indeling, kolommen: o.filter && o.filter.status ? kolommen.filter(c => c.k === o.filter.status) : kolommen, filtert, verborgenKlaar: klaar.verborgen };
    }
    if (!toonKlaar) { const alle = kaarten.length; kaarten = kaarten.filter(c => c.status !== 'klaar'); verborgenKlaar = alle - kaarten.length; }
    const kolommen = Bd.fasen(kaarten).map(n => ({ k: n, label: n, kaarten: kaarten.filter(c => zelfde(c.fase, n)), verborgen: 0 }));
    const geen = kaarten.filter(c => !c.fase); if (geen.length) kolommen.push({ k: '', label: 'Geen fase', kaarten: geen, verborgen: 0 });
    return { indeling, kolommen, filtert: !!(o.filter && (o.filter.project || o.filter.persoon || o.filter.status)), verborgenKlaar };
  };
  Bd.stroom = function (o) {
    const rijen = P.projectStroom(o.taken || {}, o.afhank || {}, o.projectenVol || [], { vandaag: o.vandaag, vrij: o.vrij, bestel: o.bestel });
    const f = o.filter || {};
    return { indeling: 'stroom', rijen: f.project ? rijen.filter(r => zelfde(r.code, f.project)) : rijen, stations: P.STROOM_STATIONS };
  };

  // ── tekenen ──
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
  const STIJL = '#agenda-bord{padding:4px 2px}#agenda-bord .bd-kop{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px}'
    + '#agenda-bord .bd-seg{display:inline-flex;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;overflow:hidden}'
    + '#agenda-bord .bd-seg button{height:34px;padding:0 14px;border:0;background:var(--surface,#fff);color:var(--ink-2,#555);font:500 13px/18px var(--sans,inherit);cursor:pointer}'
    + '#agenda-bord .bd-seg button+button{border-left:1px solid var(--line-strong,#c9d1cd)}#agenda-bord .bd-seg button[aria-pressed="true"]{background:var(--primary,#2A4A38);color:#fff}'
    + '#agenda-bord .bd-bord{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:12px}'
    + '#agenda-bord .bd-kol{flex:1 1 0;min-width:240px;background:var(--surface-sunken,#f1ede5);border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:8px}'
    + '#agenda-bord .bd-kol.doel{outline:2px dashed var(--primary,#2A4A38);outline-offset:-2px}'
    + '#agenda-bord .bd-kolkop{display:flex;align-items:center;justify-content:space-between;padding:2px 4px;font:600 13px/18px var(--sans,inherit);color:var(--ink,#1f2a24)}'
    + '#agenda-bord .bd-tel{font:500 12px/16px var(--sans,inherit);color:var(--ink-2,#666)}'
    + '#agenda-bord .bd-kaart{position:relative;background:var(--surface,#fff);border:1px solid var(--line,#dfd8cb);border-radius:6px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:4px}'
    + '#agenda-bord .bd-kaart:hover{border-color:var(--line-strong,#c9d1cd)}#agenda-bord .bd-kaart.sleept{opacity:.45}#agenda-bord .bd-kaart.bezig{opacity:.6}'
    + '#agenda-bord .bd-naam{font:600 13px/18px var(--sans,inherit);color:var(--ink,#1f2a24);padding-right:34px}'
    + '#agenda-bord .bd-sub{font:400 12px/16px var(--sans,inherit);color:var(--ink-2,#666)}'
    + '#agenda-bord .bd-voet{display:flex;align-items:center;gap:8px;font:400 12px/16px var(--sans,inherit);color:var(--ink-2,#666)}'
    + '#agenda-bord .bd-mat{display:inline-flex;align-items:center;gap:3px;color:var(--ink-2,#666)}#agenda-bord .bd-mat.laat{color:#b3261e;font-weight:600}'
    + '#agenda-bord .bd-laat{color:#8B1A1A;font-weight:600}#agenda-bord .bd-wacht{font:400 12px/16px var(--sans,inherit);color:var(--ink,#1f2a24);border-left:2px solid var(--brass,#d19a1f);padding-left:6px}'
    + '#agenda-bord .bd-dot{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--ink-3,#8a8f89);margin-right:6px;vertical-align:middle}'
    + '#agenda-bord .bd-dot.bezig{background:var(--primary,#2A4A38);border-color:var(--primary,#2A4A38)}#agenda-bord .bd-dot.wacht{background:var(--brass,#d19a1f);border-color:var(--brass,#d19a1f)}#agenda-bord .bd-dot.klaar{background:var(--ink-3,#8a8f89)}'
    + '#agenda-bord .bd-meer{position:absolute;top:4px;right:4px;width:32px;height:32px;border:0;border-radius:4px;background:transparent;color:var(--ink-2,#666);font:600 16px/16px var(--sans,inherit);cursor:pointer}#agenda-bord .bd-meer:hover{background:var(--surface-sunken,#f1ede5)}'
    + '#agenda-bord .bd-nieuw{border:0;background:transparent;color:var(--ink-2,#666);font:500 13px/18px var(--sans,inherit);text-align:left;padding:8px 4px;cursor:pointer;border-radius:4px}#agenda-bord .bd-nieuw:hover{background:rgba(0,0,0,.04)}'
    + '#agenda-bord .bd-meer-klaar{border:0;background:transparent;color:var(--ink-2,#666);font:500 12px/16px var(--sans,inherit);text-decoration:underline;cursor:pointer;padding:4px}'
    + '#agenda-bord .bd-leeg{font:400 12px/16px var(--sans,inherit);color:var(--ink-3,#8a8f89);padding:6px 4px}'
    + '#agenda-bord .bd-stroom{width:100%;border-collapse:separate;border-spacing:0 6px}#agenda-bord .bd-stroom th{font:500 12px/16px var(--sans,inherit);color:var(--ink-2,#666);text-align:left;padding:2px 8px}'
    + '#agenda-bord .bd-stroom td{background:var(--surface,#fff);padding:10px 8px;border-top:1px solid var(--line,#dfd8cb);border-bottom:1px solid var(--line,#dfd8cb)}#agenda-bord .bd-stroom td:first-child{border-left:1px solid var(--line,#dfd8cb);border-radius:6px 0 0 6px}#agenda-bord .bd-stroom td:last-child{border-right:1px solid var(--line,#dfd8cb);border-radius:0 6px 6px 0}'
    + '#agenda-bord .bd-st{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;font:500 12px/16px var(--sans,inherit);color:var(--ink,#1f2a24);cursor:pointer;min-height:32px}'
    + '#agenda-bord .bd-pr{font:600 13px/18px var(--sans,inherit);color:var(--ink,#1f2a24);cursor:pointer;border:0;background:transparent;text-align:left;padding:0}'
    + '@media (max-width:640px){#agenda-bord .bd-kol{flex:0 0 84vw;min-width:0}#agenda-bord .bd-bord{scroll-snap-type:x mandatory}#agenda-bord .bd-kol{scroll-snap-align:start}#agenda-bord .bd-seg button,#agenda-bord .bd-nieuw{min-height:44px}#agenda-bord .bd-meer{width:44px;height:44px;top:0;right:0}}';
  const mag = wat => { try { return !!(D.mag && D.mag[wat] && D.mag[wat]()); } catch (e) { return false; } };
  const toast = (t, o, l, lb) => { try { if (D.toast) D.toast(t, o, l, lb); } catch (e) {} };
  const vindTaak = (code, id) => { const alle = D.taken() || {}, k = sleutelVan(alle, code); return k ? (alle[k] || []).find(x => x && !x._vervallen && String(x.id) === String(id)) || null : null; };
  const klaarMelden = () => { if (D.naWijziging) { try { D.naWijziging(); } catch (e) {} } Bd.teken(); };

  // Een wijziging doorvoeren (zelfde afhandeling van de uitkomst als het taakpaneel: onzeker, niet gelukt, tegelijk, gelukt met Ongedaan maken)
  async function schrijf(spec, wat) {
    let r; try { r = await D.wijzig(spec, { traag: () => toast('Opslaan duurt lang, even geduld…', null, true) }); } catch (e) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((e && e.message) || e) }; }
    if (r && r.onzeker) { toast(r.reden, null, true); Promise.resolve(r.onzeker).then(u => { klaarMelden(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het opslaan gelukt is.', null, true); }, () => toast('Ik kon niet vaststellen of het opslaan gelukt is.', null, true)); return false; }
    if (!r || !r.ok) { klaarMelden(); toast((r && r.reden) || 'Niet opgeslagen.', null, true); return false; }
    if (r.noop) { klaarMelden(); return true; }
    klaarMelden();
    if (r.tegelijk) { toast(r.tegelijk, null, true); return false; }
    const w = r.wijziging;
    toast((r.naam || (w && w.naam) || spec.naam || 'Taak') + ': ' + wat + ' opgeslagen.', w && D.wijzigHerstel ? async () => {
      let h; try { h = await D.wijzigHerstel(w, {}); } catch (e) { h = { ok: false, reden: 'Terugzetten mislukt: ' + ((e && e.message) || e) }; }
      klaarMelden();
      if (h && h.onzeker) { toast(h.reden, null, true); Promise.resolve(h.onzeker).then(u => { klaarMelden(); toast((u && u.tekst) || 'Open de taak opnieuw om te zien of het terugzetten gelukt is.', null, true); }); return; }
      toast(h && h.ok ? (h.tegelijk || 'Teruggezet.') : ((h && h.reden) || 'Terugzetten lukt niet.'), null, !!(h && (h.tegelijk || !h.ok)));
    } : null);
    return true;
  }
  const GEEN_RECHT = 'Dit mag je niet met jouw rol (kantoor beslist).';
  // Naar een andere status: Wacht vraagt een verplichte reden; een taak die op een voorganger wacht start na een bevestiging (zoals het taakpaneel)
  Bd.naarStatus = async function (kaart, nieuw) {
    const t = vindTaak(kaart.code, kaart.id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    const huidig = t.status || 'todo', dlg = D.dialoog;
    if (huidig === nieuw && nieuw !== 'wacht') return false;
    if (!mag('status')) { toast(GEEN_RECHT, null, true); return false; }
    let reden = '';
    if (nieuw === 'wacht') {
      if (!dlg || !dlg.prompt) return false;
      for (let i = 0; i < 3; i++) {
        const r = await dlg.prompt({ title: 'Waarom wacht deze taak?', message: '"' + t.naam + '"', placeholder: 'Bijvoorbeeld: wacht op plaatmateriaal', defaultValue: i === 0 ? (t.wacht_reden || '') : '', okLabel: 'Zet op Wacht' });
        if (r === null || r === undefined) return false;
        reden = String(r).replace(/\s+/g, ' ').trim(); if (reden.length >= 2) break;
        reden = ''; toast('Een reden is verplicht bij Wacht.');
      }
      if (!reden) return false;
    } else if (huidig === 'todo' && kaart.wachtOp && dlg && dlg.confirm) {
      const ja = await dlg.confirm({ title: 'Deze taak wacht', message: '"' + t.naam + '" wacht op: ' + kaart.wachtOp + '.\nToch ' + (nieuw === 'klaar' ? 'op klaar zetten' : 'starten') + '?', okLabel: 'Toch doorgaan' });
      if (!ja) return false;
    }
    if (nieuw !== 'wacht' && D.bestel && dlg && dlg.confirm) {   // een taak met open materiaal gaat niet stil naar Bezig of Klaar (P5): vers uit de bestellijst, niet uit de getekende kaart
      let bl = D.bestel() || []; if (D.bestelVers) { try { bl = await D.bestelVers() || bl; } catch (e) { } }   // eerst de gezamenlijke bestellijst lezen
      const mat = P.taakMateriaal(t, P.bestelVanTaak(bl, t.id, { code: kaart.code, project_id: kaart.project_id }), { vandaag: P.vandaagYmd() });
      if (P.materiaalVraagBevestiging(t, mat, nieuw)) { const ja = await dlg.confirm({ title: 'Het materiaal is nog niet binnen', message: P.materiaalBevestigTekst(t.naam, mat, nieuw, P.datumKort), okLabel: 'Toch doorgaan' }); if (!ja) return false; }
    }
    return schrijf(Bd.specStatus(kaart.code, vindTaak(kaart.code, kaart.id) || t, nieuw, reden), 'status ' + statusLabel(nieuw).toLowerCase());
  };
  Bd.naarFase = async function (kaart, fase) {
    const t = vindTaak(kaart.code, kaart.id); if (!t) { toast('Deze taak bestaat niet meer.', null, true); klaarMelden(); return false; }
    if (zelfde(t.fase || '', fase || '')) return false;
    if (!mag('alles')) { toast(GEEN_RECHT, null, true); return false; }
    return schrijf(Bd.specFase(kaart.code, t, fase), 'fase ' + (fase ? '"' + fase + '"' : 'gewist'));
  };
  async function verplaats(kaart, kolom, indeling) {
    if (S.bezig) { toast('Even wachten: de vorige wijziging wordt nog opgeslagen.', null, true); return; }
    S.bezig = true;
    try { if (indeling === 'fase') await Bd.naarFase(kaart, kolom.k); else await Bd.naarStatus(kaart, kolom.k); } finally { S.bezig = false; }
  }
  async function kiesKolom(kaart, model) {
    const dlg = D.dialoog; if (!dlg || !dlg.choose) return;
    const kan = model.indeling === 'fase' ? mag('alles') : mag('status');
    if (!kan) { toast(GEEN_RECHT, null, true); return; }
    const opties = model.kolommen.filter(c => model.indeling === 'fase' ? !zelfde(c.k, kaart.fase) : c.k !== kaart.status);
    const i = await dlg.choose({ title: 'Verplaats naar…', message: kaart.naam, choices: opties.map(c => ({ label: c.label })) });
    if (i === null || i === undefined || !opties[i]) return;
    await verplaats(kaart, opties[i], model.indeling);
  }
  // "+ taak" onder aan een kolom: naam vragen, project kiezen (bij een projectfilter dat project), aanmaken als Open (in een fasekolom met die fase), daarna zo nodig naar de kolom
  async function nieuweTaak(kolom, model, filter) {
    const dlg = D.dialoog; if (!dlg || !dlg.prompt || !D.nieuweTaak) return;
    if (!mag('status')) { toast(GEEN_RECHT, null, true); return; }
    let code = filter.project;
    if (!code) {
      const pr = (D.projecten ? D.projecten() : []).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
      if (!pr.length || !dlg.choose) return;
      const i = await dlg.choose({ title: 'In welk project?', message: 'Nieuwe taak in "' + kolom.label + '"', choices: pr.map(p => ({ label: p.label || p.code })) });
      if (i === null || i === undefined || !pr[i]) return; code = pr[i].code;
    }
    const naam = await dlg.prompt({ title: 'Nieuwe taak', message: 'In "' + kolom.label + '"', placeholder: 'Taaknaam', okLabel: 'Toevoegen' });
    const n = String(naam == null ? '' : naam).replace(/\s+/g, ' ').trim(); if (!n) return;
    const nieuw = await D.nieuweTaak({ code, naam: n, fase: model.indeling === 'fase' ? kolom.k : '' });
    if (!nieuw) return;
    klaarMelden(); toast('Taak "' + n + '" toegevoegd.');
    if (model.indeling === 'status' && kolom.k !== 'todo') { const k = Bd.kaarten({ taken: D.taken(), afhank: D.afhank(), projecten: D.projecten(), team: D.team(), filter: { project: code } }).find(x => String(x.id) === String(nieuw.id)); if (k) await verplaats(k, kolom, 'status'); }
  }

  // Het icoontje 'wacht op materiaal' (een doos) met het aantal open regels; rood als de verwachte levering na de geplande start valt. Nooit alleen kleur: het aantal en de tekst staan erbij.
  function matIcoon(m) {
    const NS = 'http://www.w3.org/2000/svg', s = D.doc.createElementNS(NS, 'svg'), p = D.doc.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '14'); s.setAttribute('height', '14'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', 'M3 8l9-5l9 5v8l-9 5l-9-5zM3 8l9 5l9-5M12 13v8'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round'); s.appendChild(p);
    const tekst = m.tekst + (m.laatste ? ' (verwacht ' + P.datumKort(m.laatste) + (m.laat ? ', na de geplande start' : '') + ')' : '');
    return el('span', { klass: 'bd-mat' + (m.laat ? ' laat' : ''), title: tekst, 'aria-label': 'Wacht op materiaal: ' + tekst, role: 'img' }, s, el('span', { tekst: String(m.open) }));
  }
  function kaartEl(k, model) {
    const kan = model.indeling === 'fase' ? mag('alles') : mag('status');
    const meta = [];
    if (k.persoonNaam) meta.push(el('span', { tekst: k.persoonNaam }));
    if (k.eind) meta.push(el('span', { klass: k.teLaat ? 'bd-laat' : '', tekst: (k.teLaat ? 'te laat · ' : 'tot ') + P.datumKort(k.eind) }));
    if (k.mat && k.status !== 'klaar') meta.push(matIcoon(k.mat));
    const n = el('div', { klass: 'bd-kaart', role: 'button', tabindex: '0', title: 'Open de taak', 'data-pf-code': k.code, 'data-pf-taak': k.id, draggable: kan ? 'true' : null },
      el('div', { klass: 'bd-naam' }, model.indeling === 'fase' ? el('span', { klass: 'bd-dot ' + (k.status === 'todo' ? '' : k.status), title: statusLabel(k.status) }) : null, k.naam),
      el('div', { klass: 'bd-sub', tekst: k.projectLabel }),
      meta.length ? el('div', { klass: 'bd-voet' }, meta) : null,
      k.wachtReden ? el('div', { klass: 'bd-wacht', tekst: k.wachtReden }) : (k.wachtOp ? el('div', { klass: 'bd-wacht', tekst: 'Wacht op: ' + k.wachtOp }) : null),
      el('button', { type: 'button', klass: 'bd-meer', 'aria-label': 'Verplaats ' + k.naam + ' naar…', title: 'Verplaats naar…', tekst: '⋯', klik: ev => { ev.stopPropagation(); kiesKolom(k, model); } }));
    let p0 = null;
    n.addEventListener('pointerdown', ev => { p0 = [ev.clientX, ev.clientY]; });
    n.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('button')) return; if (p0 && ev.detail && Math.hypot(ev.clientX - p0[0], ev.clientY - p0[1]) >= 4) return; if (D.openTaak) D.openTaak(k.code, k.id, n); });
    n.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === n) { ev.preventDefault(); if (D.openTaak) D.openTaak(k.code, k.id, n); } });
    if (kan) {
      n.addEventListener('dragstart', ev => { S.sleep = k; n.classList.add('sleept'); try { ev.dataTransfer.setData('text/plain', k.naam); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} });
      n.addEventListener('dragend', () => { S.sleep = null; n.classList.remove('sleept'); D.doc.querySelectorAll('#agenda-bord .bd-kol.doel').forEach(z => z.classList.remove('doel')); });
    }
    return n;
  }
  function kolomEl(c, model, filter) {
    const kan = model.indeling === 'fase' ? mag('alles') : mag('status');
    const kol = el('div', { klass: 'bd-kol', 'data-kolom': c.k, role: 'group', 'aria-label': c.label });
    kol.appendChild(el('div', { klass: 'bd-kolkop' }, el('span', { tekst: c.label }), el('span', { klass: 'bd-tel', tekst: String(c.kaarten.length) })));
    if (!c.kaarten.length) kol.appendChild(el('div', { klass: 'bd-leeg', tekst: 'Geen taken' }));
    c.kaarten.forEach(k => kol.appendChild(kaartEl(k, model)));
    if (c.verborgen && model.indeling === 'status') kol.appendChild(el('button', { type: 'button', klass: 'bd-meer-klaar', tekst: 'Toon alle afgeronde (' + (c.kaarten.length + c.verborgen) + ')', klik: () => { S.toonKlaar = true; Bd.teken(); } }));
    if (D.nieuweTaak && mag('status')) kol.appendChild(el('button', { type: 'button', klass: 'bd-nieuw', tekst: '+ taak', klik: () => nieuweTaak(c, model, filter) }));
    if (kan) {
      kol.addEventListener('dragover', ev => { if (!S.sleep) return; const al = model.indeling === 'fase' ? zelfde(S.sleep.fase, c.k) : S.sleep.status === c.k; if (al) return; ev.preventDefault(); kol.classList.add('doel'); try { ev.dataTransfer.dropEffect = 'move'; } catch (e) {} });
      kol.addEventListener('dragleave', ev => { if (!kol.contains(ev.relatedTarget)) kol.classList.remove('doel'); });
      kol.addEventListener('drop', ev => { ev.preventDefault(); kol.classList.remove('doel'); const k = S.sleep; S.sleep = null; if (k) verplaats(k, c, model.indeling); });
    }
    return kol;
  }
  function stroomEl(m) {
    if (!m.rijen.length) return el('div', { klass: 'bd-leeg', tekst: 'Geen actieve projecten.' });
    const kop = el('tr', null, el('th', { tekst: 'Project' }), m.stations.map(([, l]) => el('th', { tekst: l })), el('th', { tekst: 'Klaar' }));
    const rijen = m.rijen.map(r => el('tr', null,
      el('td', null, el('button', { type: 'button', klass: 'bd-pr', tekst: r.naam, title: 'Naar het project', klik: () => D.openProject && D.openProject(r.code) }), r.vlag ? el('div', { klass: 'bd-wacht', tekst: r.reden }) : (r.lever ? el('div', { klass: 'bd-sub', tekst: 'levering ' + P.datumKort(r.lever) }) : null)),
      r.stations.map(s => el('td', null, el('button', { type: 'button', klass: 'bd-st', title: s.l + ': ' + (s.staat === 'leeg' ? 'geen taken' : s.staat) + ' · naar het project', klik: () => D.openProject && D.openProject(r.code) },
        el('span', { klass: 'bd-dot ' + (s.staat === 'bezig' ? 'bezig' : s.staat === 'wacht' ? 'wacht' : s.staat === 'klaar' ? 'klaar' : '') }), s.n ? s.klaar + '/' + s.n : '—'))),
      el('td', null, el('span', { klass: 'bd-sub', tekst: r.klaar + '/' + r.totaal }))));
    return el('table', { klass: 'bd-stroom' }, el('thead', null, kop), el('tbody', null, rijen));
  }

  Bd.teken = function () {
    const w = D && D.doc.getElementById('agenda-bord'); if (!w) return;
    w.textContent = '';
    if (!D.doc.getElementById('bd-stijl')) { const s = el('style', { id: 'bd-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    const pf = PF(), g = pf ? pf.get() : { project: '', status: '', bord: '' }, indeling = INDELINGEN.some(x => x[0] === g.bord) ? g.bord : 'status';
    const kop = el('div', { klass: 'bd-kop' },
      el('div', { klass: 'bd-seg', role: 'group', 'aria-label': 'Indeling van het bord' }, INDELINGEN.map(([k, l]) => el('button', { type: 'button', 'aria-pressed': k === indeling ? 'true' : 'false', tekst: l, klik: () => { if (pf) pf.zet({ bord: k }); Bd.teken(); } }))),
      pf ? pf.balk({ pre: 'bd', std: 'iedereen', persoon: indeling !== 'stroom', status: indeling !== 'stroom', klaar: () => Bd.teken() }) : null,
      indeling === 'fase' ? el('button', { type: 'button', klass: 'pf-knop', tekst: S.toonKlaar ? 'Verberg afgeronde' : 'Toon afgeronde', klik: () => { S.toonKlaar = !S.toonKlaar; Bd.teken(); } }) : (indeling === 'status' && S.toonKlaar ? el('button', { type: 'button', klass: 'pf-knop', tekst: 'Alleen recente afgeronde', klik: () => { S.toonKlaar = false; Bd.teken(); } }) : null));
    w.appendChild(kop);
    if (D.takenKlaar && !D.takenKlaar()) w.appendChild(el('div', { klass: 'mw-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const filter = { project: g.project || '', persoon: pf ? pf.persoonSlug('iedereen') : '', status: pf && g.status ? pf.statusTaak(g.status) : '' };
    const basis = { taken: D.taken(), afhank: D.afhank(), bestel: D.bestel ? D.bestel() : [], projecten: D.projecten(), team: D.team(), vrij: D.vrij ? D.vrij() : null, vandaag: P.vandaagYmd() };
    let m;
    try {
      if (indeling === 'stroom') { m = Bd.stroom(Object.assign({}, basis, { projectenVol: D.projectenVol ? D.projectenVol() : [], bestel: D.bestel ? D.bestel() : [], filter })); w.appendChild(stroomEl(m)); }
      else { m = Bd.model(Object.assign({}, basis, { filter, indeling, toonKlaar: S.toonKlaar })); Bd.laatste = m; w.appendChild(el('div', { klass: 'bd-bord' }, m.kolommen.map(c => kolomEl(c, m, filter)))); }
    } catch (e) { console.warn('Bord:', e); w.appendChild(el('div', { klass: 'mw-melding', tekst: 'Het bord kon niet worden berekend.' })); }
    if (pf) pf.markeer(w);
  };

  Bd.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return Bd; };
  Bd.S = S;
  root.MTBord = Bd;
  if (typeof module !== 'undefined' && module.exports) module.exports = Bd;
})(typeof window !== 'undefined' ? window : globalThis);
