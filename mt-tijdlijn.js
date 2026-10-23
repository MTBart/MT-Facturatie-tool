/* ============================================================================
 * mt-tijdlijn.js: de team-tijdlijn (Gantt) over alle projecten (planning brok P4a, bewerken P4b)
 * ----------------------------------------------------------------------------
 * Een rij per project (balk = van de eerste start tot het laatste eind van zijn taken, met voortgang), uitklapbaar naar fasen (ook berekend uit de taken: roll-up, met
 * voortgang "3/5 klaar", verbeterpunt 67) en taken (balk, of een ruit voor een mijlpaal). Afhankelijkheidslijnen tussen de taken, het kritieke pad als laag
 * (MTPlanning.rooster: dezelfde rekenregels als de rest van de tool), de leverdatum als vlag en Vandaag als lijn. De P0-filterbalk geldt (project, wie, status).
 * Wat er niet is, staat er eerlijk bij: alleen einde-naar-begin in werkdagen (met wachttijd); begin-naar-begin, einde-naar-einde en wachttijd in kalenderdagen komen later (F2).
 * Standaard alleen lezen: een klik op een taakbalk opent het taakpaneel, op een projectbalk het project. In de stand Bewerken (knop, alleen met het recht om te plannen of af te hangen) kies je een balk en sleep je hem
 * (verplaatsen, rekken met de randen, een afhankelijkheid trekken van het bolletje naar een andere balk) met een voorbeeld van de ketting, of gebruik je de knoppen Verplaatsen… en Koppelen… (op de telefoon alleen die).
 * Alles wat wordt opgeslagen gaat via de bestaande veilige routes (datums: de planroute met de vraag over de opvolgers; koppelingen: de afhankelijkhedenroute) met Ongedaan maken.
 * Kleur: de status is nooit alleen kleur (Open = omlijnd, Bezig = gevuld, Wacht = gearceerd, Klaar = lichter met haak, Kritiek = rode rand); project en fase staan in de rijen, niet in kleur.
 * Snel bij veel taken: alleen de rijen in beeld worden getekend (vaste rijhoogte, tekenvenster) en alleen de lijnen van die rijen.
 * model() is rekenwerk zonder DOM (los te testen); tekent met DOM-calls, nooit met opgebouwde HTML. Alles van buiten via init(deps).
 * ========================================================================== */
(function (root) {
  'use strict';
  const Tl = {};
  let D = null, P = null;
  const RH = 30, HEAD_H = 44, LABEL_W = 260, LABEL_W_KLEIN = 150;
  const ZOOMS = { week: 22, maand: 8, kwartaal: 3 };   // beeldpunten per dag
  const ZOOM_LABELS = [['week', 'Week'], ['maand', 'Maand'], ['kwartaal', 'Kwartaal']];
  const S = { open: new Set(), alles: false, kritiek: true, verbergKlaar: false, vensterVan: -1, vensterTot: -1, laatste: null, bewerk: false, gekozen: null, paneel: '' };
  Tl.RH = RH; Tl.ZOOMS = ZOOMS;

  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  const sleutelVan = (obj, code) => Object.keys(obj && typeof obj === 'object' ? obj : {}).find(k => !k.startsWith('__') && zelfde(k, code));
  const dnr = s => Math.round(Date.parse(s + 'T00:00:00Z') / 864e5);
  const dymd = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const ok = s => !!(P && P.isYmd(s));
  const maandag = n => n - ((((n + 4) % 7) + 6) % 7);   // dagnummer van de maandag van die week (1970-01-01 was een donderdag)
  const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  // ── rekenwerk (geen DOM) ──
  // o = { taken, afhank, projecten: [{ code, label, fase?, gegevens? }], team, vandaag, vrij, filter: { project, persoon (slug), status (taakstatus) }, open: Set codes, alles, kritiek, verbergKlaar, fasen: [namen] }
  // → { rijen: [{ soort: 'project'|'fase'|'taak', i, code, ... }], lijnen: [{ van: rij-index, naar: rij-index, kritiek }], eerste, laatste (ymd), vandaag, aantalTaken, aantalProjecten }
  Tl.model = function (o) {
    const vandaag = o.vandaag || P.vandaagYmd(), f = o.filter || {}, team = o.team || [], taken = o.taken || {}, rijen = [], lijnen = [];
    const fasenVolgorde = (o.fasen && o.fasen.length ? o.fasen : (() => { try { return (P.sjabloonStd().fases || []).map(x => x.naam); } catch (e) { return []; } })());
    let eerste = Infinity, laatste = -Infinity, aantalTaken = 0, aantalProjecten = 0;
    const matIdx = P.bestelIndexTaak(o.bestel);   // P5: de bestelregels die aan een taak hangen, één keer geïndexeerd
    const kruisLijnen = [], rijSleutel = new Map();   // F2b: koppelingen tussen projecten worden na alle projecten getekend, als beide rijen in beeld staan
    const projecten = (o.projecten || []).filter(p => p && p.code && !p._vervallen).slice().sort((a, b) => String(a.label || a.code).localeCompare(String(b.label || b.code), 'nl', { numeric: true }));
    projecten.forEach(p => {
      if (f.project && !zelfde(f.project, p.code)) return;
      const k = sleutelVan(taken, p.code); if (!k) return;
      const lijst = P.takenActief(Array.isArray(taken[k]) ? taken[k] : []);
      const sel = lijst.filter(t => {
        const st = t.status || 'todo';
        if (f.status && st !== f.status) return false;
        if (o.verbergKlaar && st === 'klaar') return false;
        if (f.persoon && !P.taakMensen(t).some(m => P.zelfdePersoon(m, f.persoon, team))) return false;
        return true;
      });
      if (!sel.length) return;
      aantalProjecten++; aantalTaken += sel.length;
      const bereik = ts => { let a = Infinity, b = -Infinity; ts.forEach(t => { const s = ok(t.start) ? dnr(t.start) : (ok(t.eind) ? dnr(t.eind) : null), e = ok(t.eind) ? dnr(t.eind) : s; if (s === null) return; if (s < a) a = s; if (e > b) b = e; }); return a === Infinity ? null : { s: a, e: b }; };
      const klaarN = ts => ts.filter(t => (t.status || 'todo') === 'klaar').length;
      const pb = bereik(sel), lever = ok(p.gegevens && p.gegevens.leverdatum) ? p.gegevens.leverdatum : '';
      const open = !!(o.alles || (o.open && o.open.has(String(p.code).toLowerCase())) || f.project);
      const pr = { soort: 'project', code: k, label: p.label || p.code, start: pb ? dymd(pb.s) : '', eind: pb ? dymd(pb.e) : '', n: sel.length, klaar: klaarN(sel), lever, open, i: rijen.length };
      rijen.push(pr);
      if (pb) { eerste = Math.min(eerste, pb.s); laatste = Math.max(laatste, pb.e); }
      if (lever) { eerste = Math.min(eerste, dnr(lever)); laatste = Math.max(laatste, dnr(lever)); }
      if (!open) return;
      // kritiek pad (alleen voor uitgeklapte projecten): de ketting die de leverdatum bepaalt, zoals MTPlanning.rooster hem berekent
      const dk = sleutelVan(o.afhank, k), deps = dk ? o.afhank[dk] : [];
      let kritiek = new Set(), rr = null;
      if (o.kritiek !== false && lijst.length) { try { const r = rr = P.rooster(lijst, deps, { start: vandaag, leverdatum: lever, vrij: o.vrij, alle: taken, code: k }); r.pad.forEach(id => { const t = lijst.find(x => x.id === id); if (t && (t.status || 'todo') !== 'klaar') kritiek.add(String(id)); }); pr.tekort = r.tekort; pr.eindVroegst = r.eindVroegst; } catch (e) { kritiek = new Set(); } }
      // fasen in de volgorde van het sjabloon, daarna eigen fasen, daarna Geen fase
      const namen = []; const voeg = n => { const s = String(n || '').trim(); if (s && !namen.some(x => zelfde(x, s))) namen.push(s); };
      fasenVolgorde.forEach(voeg); sel.forEach(t => voeg(t.fase));
      const groepen = namen.map(n => ({ naam: n, ts: sel.filter(t => zelfde(t.fase || '', n)) })); const geen = sel.filter(t => !String(t.fase || '').trim()); if (geen.length) groepen.push({ naam: '', ts: geen });
      const rijVan = new Map();
      groepen.forEach(g => {
        if (!g.ts.length) return;
        const fb = bereik(g.ts);
        rijen.push({ soort: 'fase', code: k, fase: g.naam, label: g.naam || 'Geen fase', start: fb ? dymd(fb.s) : '', eind: fb ? dymd(fb.e) : '', n: g.ts.length, klaar: klaarN(g.ts), i: rijen.length });
        g.ts.slice().sort((a, b) => ((ok(a.start) ? a.start : '9999') < (ok(b.start) ? b.start : '9999') ? -1 : 1)).forEach(t => {
          const s = ok(t.start) ? t.start : (ok(t.eind) ? t.eind : ''), e = ok(t.eind) ? t.eind : s, eerstePers = P.taakMensen(t)[0], lid = eerstePers ? team.find(m => m && P.zelfdePersoon(m.slug, eerstePers, team)) : null;
          const r = { soort: 'taak', code: k, id: t.id, label: t.naam || '(zonder naam)', start: s, eind: e, status: t.status || 'todo', mijlpaal: t.soort === 'mijlpaal', kritiek: kritiek.has(String(t.id)), persoon: lid ? lid.naam : (eerstePers || ''), wacht: (t.status || 'todo') === 'wacht' ? String(t.wacht_reden || '') : '', mat: (() => { const m = P.taakMateriaal(t, P.bestelVanTaakIdx(matIdx, t.id, { code: k, project_id: p.project_id }), { vandaag }); return m.wacht ? { open: m.open, laat: m.laat, tekst: m.tekst, laatste: m.laatste } : null; })(), i: rijen.length };
          const bp = P.beperkingVan(t);   // F2b: niet vóór, uiterlijk op of vast op; de rij krijgt de sleutels alleen als de taak een beperking heeft
          if (bp) { const bc = (() => { try { return P.beperkingConflicten([t], { vrij: o.vrij })[0] || null; } catch (e) { return null; } })(), rb = rr && rr.taken && rr.taken[t.id] && rr.taken[t.id].beperking; r.beperking = bp.soort; r.beperkingDatum = bp.datum; if (bc || (rb && rb.conflict)) r.beperkingConflict = bc ? bc.dagen : 1; if (ok(bp.datum)) { eerste = Math.min(eerste, dnr(bp.datum)); laatste = Math.max(laatste, dnr(bp.datum)); } }
          rijVan.set(String(t.id), r.i); rijen.push(r); rijSleutel.set(String(k).toLowerCase() + '|' + t.id, r.i);
          if (s) { eerste = Math.min(eerste, dnr(s)); laatste = Math.max(laatste, dnr(e)); }
        });
      });
      // afhankelijkheidslijnen tussen taken die in beeld staan en de datums hebben die het type nodig heeft (EB: eind en start, BB: start en start, EE: eind en eind, BE: start en eind)
      try {
        P.depsEffectief(sel, deps).forEach(e => {
          if (e.inactief) return;
          const a = rijVan.get(String(e.van)), b = rijVan.get(String(e.naar)); if (a === undefined || b === undefined) return;
          const ty = e.type === 'SS' || e.type === 'FF' || e.type === 'SF' ? e.type : 'FS';
          if (!(ty === 'SS' || ty === 'SF' ? rijen[a].start : rijen[a].eind) || !(ty === 'FF' || ty === 'SF' ? rijen[b].eind : rijen[b].start)) return;
          lijnen.push(Object.assign({ van: a, naar: b, lag: e.lag || 0, kritiek: rijen[a].kritiek && rijen[b].kritiek }, ty === 'FS' ? {} : { type: ty }));
        });
      } catch (e) {}
      deps.forEach(d => { if (d && typeof d === 'object' && d.van_project && !d._vervallen && d.status !== 'uit' && !zelfde(d.van_project, k) && rijVan.has(String(d.naar_taak))) kruisLijnen.push({ van: String(d.van_project).toLowerCase() + '|' + d.van_taak, naar: rijVan.get(String(d.naar_taak)), type: d.type, lag: Number(d.lag_dagen) || 0 }); });
    });
    kruisLijnen.forEach(q => {
      const a = rijSleutel.get(q.van), b = q.naar; if (a === undefined) return;
      const ty = q.type === 'SS' || q.type === 'FF' || q.type === 'SF' ? q.type : 'FS';
      if (!(ty === 'SS' || ty === 'SF' ? rijen[a].start : rijen[a].eind) || !(ty === 'FF' || ty === 'SF' ? rijen[b].eind : rijen[b].start)) return;
      lijnen.push(Object.assign({ van: a, naar: b, lag: q.lag, kritiek: false, ander: true }, ty === 'FS' ? {} : { type: ty }));
    });
    return { rijen, lijnen, eerste: eerste === Infinity ? '' : dymd(eerste), laatste: laatste === -Infinity ? '' : dymd(laatste), vandaag, aantalTaken, aantalProjecten };
  };
  // De tijdas: begin (maandag), aantal dagen en beeldpunten per dag
  Tl.as = function (m, zoom, off) {
    const px = ZOOMS[zoom] || ZOOMS.maand, nu = dnr(m.vandaag);
    const a = maandag(Math.min(m.eerste ? dnr(m.eerste) : nu, nu - 14)), b = Math.max(m.laatste ? dnr(m.laatste) : nu, nu + 28) + 7;
    return { van: a, dagen: b - a + 1, px, breedte: (b - a + 1) * px, off: off || 0, x: ymd => (off || 0) + (dnr(ymd) - a) * px };
  };
  // Elke lijn: de coördinaten (in de tijdlijnruimte) van het uiteinde van de voorganger naar het uiteinde van de opvolger dat het type bedoelt: EB (standaard) einde naar begin, BB begin naar begin,
  // EE einde naar einde, BE begin naar einde. `pijl`: de punt van de pijl bij de opvolger; `links`: waar de pijlpunt naartoe wijst (naar links als de lijn van rechts komt).
  Tl.lijnPad = function (as, a, b, hoogteRij, type) {
    const px = as.px, ty = type === 'SS' || type === 'FF' || type === 'SF' ? type : 'FS';
    const x1 = ty === 'SS' || ty === 'SF' ? as.x(a.start) : as.x(a.eind) + px, y1 = a.i * hoogteRij + hoogteRij / 2, x2 = ty === 'FF' || ty === 'SF' ? as.x(b.eind) + px : as.x(b.start), y2 = b.i * hoogteRij + hoogteRij / 2;
    if (ty === 'FS') { const xm = Math.max(x1 + 4, Math.min(x2 - 6, x1 + 8)); return { x1, y1, x2, y2, d: 'M' + x1 + ',' + y1 + ' H' + xm + ' V' + y2 + ' H' + x2, pijl: [x2, y2], links: false }; }
    const xm = ty === 'SS' ? Math.min(x1, x2) - 8 : ty === 'FF' ? Math.max(x1, x2) + 8 : x1 - 8;
    return { x1, y1, x2, y2, d: 'M' + x1 + ',' + y1 + ' H' + xm + ' V' + y2 + ' H' + x2, pijl: [x2, y2], links: x2 < xm };
  };

  // ── P4b: bewerken ──
  const kanSleep = () => !!(D && D.datums && D.mag && D.mag.plannen && D.mag.plannen());
  const kanKoppel = () => !!(D && D.wijzig && D.mag && D.mag.alles && D.mag.alles());
  const lijstVan = code => { const t = D.taken() || {}, k = sleutelVan(t, code); return k && Array.isArray(t[k]) ? P.takenActief(t[k]) : []; };
  const depsVan = code => { const a = D.afhank() || {}, k = sleutelVan(a, code); return k && Array.isArray(a[k]) ? a[k] : []; };
  const nieuwId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const taakVan = (code, id) => lijstVan(code).find(t => String(t.id) === String(id)) || null;
  const vrijDagen = () => (D && D.vrij ? D.vrij() : null);
  const werkOp = (ymd, richting, vrij) => { let n = dnr(ymd), g = 0; while (g++ < 14 && !P.isWerkdag(dymd(n), vrij)) n += richting; return dymd(n); };
  const TYPEN = [['FS', 'EB', 'einde naar begin'], ['SS', 'BB', 'begin naar begin'], ['FF', 'EE', 'einde naar einde'], ['SF', 'BE', 'begin naar einde']];
  // De nieuwe datums bij slepen: kind 'verplaats' (beide randen, dezelfde werkdagen lang), 'start' of 'eind' (één rand); delta in kalenderdagen; altijd op een werkdag (de planroute weigert een weekend).
  Tl.nieuweDatums = function (kind, start, eind, delta, vrij) {
    if (!ok(start) || !ok(eind) || !delta) return null;
    const richting = delta < 0 ? -1 : 1;
    if (kind === 'verplaats') { const s = werkOp(dymd(dnr(start) + delta), richting, vrij), wd = P.werkdagenTussen(start, eind, vrij); return { start: s, eind: P.addWerkdagen(s, wd, vrij) }; }
    if (kind === 'start') { let s = werkOp(dymd(dnr(start) + delta), richting, vrij); if (s > eind) s = eind; return s === start ? null : { start: s, eind }; }
    if (kind === 'eind') { let e = werkOp(dymd(dnr(eind) + delta), richting, vrij); if (e < start) e = start; return e === eind ? null : { start, eind: e }; }
    return null;
  };
  const meld = (t, lang) => { try { if (D.toast) D.toast(t, null, !!lang); } catch (e) {} };
  const na = () => { try { if (D.naWijziging) D.naWijziging(); } catch (e) {} };
  // Datums opslaan via de planroute (dezelfde als in het taakpaneel en de Capaciteit: vraagt of de opvolgers mee schuiven, meldt en geeft Ongedaan maken).
  Tl.slaDatumsOp = async function (r, s, e) {
    let res; try { res = await D.datums({ soort: 'taakdatums', taak: { code: r.code, id: r.id, naam: r.label }, startDatum: s, eindDatum: e, gezien: { start: r.start || '', eind: r.eind || '' } }); } catch (x) { res = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; }
    Tl.teken(); na(); return res;
  };
  // Mag deze koppeling? { ok, fout }: binnen één project de gewone controle, tussen projecten ook de kring over de projecten heen.
  Tl.koppelToets = function (van, naar) {
    if (zelfde(van.code, naar.code) && String(van.id) === String(naar.id)) return { ok: false, fout: 'Een taak kan niet van zichzelf afhangen.' };
    if (zelfde(van.code, naar.code)) return P.depControle(lijstVan(naar.code), depsVan(naar.code), { van: van.id, naar: naar.id });
    return P.depControleKruis(D.taken() || {}, D.afhank() || {}, { code: naar.code, naar: naar.id, vanProject: van.code, van: van.id });
  };
  // Een koppeling leggen: van (voorganger) en naar (opvolger) zijn { code, id }; het record staat bij het project van de opvolger.
  Tl.legKoppeling = async function (van, naar, type, lag) {
    const toets = Tl.koppelToets(van, naar); if (!toets.ok) { meld(toets.fout, true); return { ok: false, reden: toets.fout }; }
    const op = Object.assign({ op: 'nieuw', id: nieuwId(), van: van.id, naar: naar.id, type: type || 'FS' }, zelfde(van.code, naar.code) ? {} : { van_project: van.code }, Number(lag) ? { lag_dagen: Number(lag) } : {});
    let r; try { r = await D.wijzig({ code: naar.code, id: naar.id, naam: (taakVan(naar.code, naar.id) || {}).naam || 'de koppeling', afhOps: [op] }); } catch (x) { r = { ok: false, reden: 'Opslaan mislukt: ' + ((x && x.message) || x) }; }
    Tl.teken(); na();
    if (!r || !r.ok) { meld((r && r.reden) || 'Niet opgeslagen.', true); return r || { ok: false }; }
    if (r.noop) return r;
    if (r.tegelijk) { meld(r.tegelijk, true); return r; }
    const tekst = 'Koppeling gelegd: ' + ((taakVan(van.code, van.id) || {}).naam || '?') + ' \u2192 ' + ((taakVan(naar.code, naar.id) || {}).naam || '?') + ' (' + (TYPEN.find(x => x[0] === (type || 'FS')) || TYPEN[0])[1] + ')';
    try { if (D.toast && r.wijziging && D.wijzigHerstel) D.toast(tekst, async () => { let h; try { h = await D.wijzigHerstel(r.wijziging); } catch (x) { h = { ok: false, reden: String((x && x.message) || x) }; } Tl.teken(); na(); meld(h && h.ok ? (h.tegelijk || 'Teruggezet.') : ((h && h.reden) || 'Terugzetten lukt niet.'), !!(h && (h.tegelijk || !h.ok))); }, false, 'Ongedaan maken'); else meld(tekst); } catch (e) {}
    return r;
  };
  Tl.kies = function (code, id) { S.gekozen = S.gekozen && zelfde(S.gekozen.code, code) && String(S.gekozen.id) === String(id) ? null : { code, id }; S.paneel = ''; Tl.teken(); };
  Tl.zetBewerk = function (aan) { S.bewerk = !!aan; if (!aan) { S.gekozen = null; S.paneel = ''; } Tl.teken(); };

  // ── tekenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v);
      else if (k === 'stijl') e.style.cssText = v; else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs) => { const e = D.doc.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const STIJL = '#agenda-tijdlijn{padding:4px 2px;--tl-balk:#3e5c76;--tl-kritiek:#b3261e;--tl-wacht:#8a6414;--tl-lijn:#646a64}'
    + '#agenda-tijdlijn .tl-kop{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}'
    + '#agenda-tijdlijn .tl-seg{display:inline-flex;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;overflow:hidden}#agenda-tijdlijn .tl-seg button{height:34px;padding:0 12px;border:0;background:var(--surface,#fff);color:var(--ink-2,#555);font:500 13px/18px var(--sans,inherit);cursor:pointer}'
    + '#agenda-tijdlijn .tl-seg button+button{border-left:1px solid var(--line-strong,#c9d1cd)}#agenda-tijdlijn .tl-seg button[aria-pressed="true"]{background:var(--primary,#2A4A38);color:#fff}'
    + '#agenda-tijdlijn .tl-knop{height:34px;padding:0 12px;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;background:var(--surface,#fff);color:var(--ink-2,#555);font:500 13px/18px var(--sans,inherit);cursor:pointer}#agenda-tijdlijn .tl-knop[aria-pressed="true"]{border-color:var(--tl-kritiek);color:var(--tl-kritiek);font-weight:600}'
    + '#agenda-tijdlijn .tl-scroll{position:relative;overflow:auto;height:68vh;min-height:320px;border:1px solid var(--line,#dfd8cb);border-radius:6px;background:var(--surface,#fff)}'
    + '#agenda-tijdlijn .tl-inner{position:relative;min-width:100%}#agenda-tijdlijn .tl-kopband{position:sticky;top:0;z-index:5;height:' + HEAD_H + 'px;background:var(--surface-sunken,#f1ede5);border-bottom:1px solid var(--line,#dfd8cb)}'
    + '#agenda-tijdlijn .tl-maand{position:absolute;top:0;height:22px;padding:3px 6px;border-left:1px solid var(--line-strong,#c9d1cd);font:600 12px/16px var(--sans,inherit);color:var(--ink,#1f2a24);white-space:nowrap}'
    + '#agenda-tijdlijn .tl-week{position:absolute;top:24px;height:18px;padding:1px 4px;border-left:1px solid var(--line,#dfd8cb);font:500 11px/16px var(--mono,monospace);color:var(--ink-2,#596059);white-space:nowrap}'
    + '#agenda-tijdlijn .tl-labelkop{position:sticky;left:0;z-index:6;width:var(--tl-lw);height:' + HEAD_H + 'px;background:var(--surface-sunken,#f1ede5);border-right:1px solid var(--line-strong,#c9d1cd);padding:14px 10px;font:600 12px/16px var(--sans,inherit);color:var(--ink-2,#596059);box-sizing:border-box}'
    + '#agenda-tijdlijn .tl-vlak{position:absolute;left:0;right:0;top:' + HEAD_H + 'px}#agenda-tijdlijn .tl-rij{position:absolute;left:0;right:0;height:' + RH + 'px;border-bottom:1px solid var(--line,#eee)}#agenda-tijdlijn .tl-rij.project{background:var(--surface-sunken,#f6f3ed)}'
    + '#agenda-tijdlijn .tl-label{position:sticky;left:0;z-index:3;width:var(--tl-lw);height:' + RH + 'px;box-sizing:border-box;background:inherit;background-color:var(--surface,#fff);border:0;border-right:1px solid var(--line-strong,#c9d1cd);display:flex;align-items:center;gap:6px;padding:0 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:400 13px/18px var(--sans,inherit);color:var(--ink,#1f2a24);text-align:left;cursor:pointer}'
    + '#agenda-tijdlijn .tl-rij.project .tl-label{background-color:var(--surface-sunken,#f6f3ed);font-weight:600}#agenda-tijdlijn .tl-rij.fase .tl-label{padding-left:22px;font-weight:600;color:var(--ink-2,#596059)}#agenda-tijdlijn .tl-rij.taak .tl-label{padding-left:38px}'
    + '#agenda-tijdlijn .tl-label .tl-sub{margin-left:auto;font:500 11px/14px var(--mono,monospace);color:var(--ink-2,#596059)}'
    + '#agenda-tijdlijn .tl-label:focus-visible,#agenda-tijdlijn .tl-balk:focus-visible{outline:2px solid var(--focus,var(--primary,#2A4A38));outline-offset:-2px}'
    + '#agenda-tijdlijn .tl-balk{position:absolute;top:7px;height:16px;border:0;padding:0;border-radius:3px;box-sizing:border-box;cursor:pointer;background:var(--tl-balk);min-width:4px}'
    + '#agenda-tijdlijn .tl-balk.open{background:var(--surface,#fff);border:2px solid var(--tl-balk)}#agenda-tijdlijn .tl-balk.bezig{background:var(--tl-balk)}'
    + '#agenda-tijdlijn .tl-balk.wacht{background:repeating-linear-gradient(45deg,#d19a1f 0 4px,#fbefd2 4px 8px);border:2px solid var(--tl-wacht)}'
    + '#agenda-tijdlijn .tl-balk.klaar{background:#c9d3dc;border:1px solid #8b9aa8}'
    + '#agenda-tijdlijn .tl-balk.kritiek{box-shadow:0 0 0 2px var(--tl-kritiek)}'
    + '#agenda-tijdlijn .tl-balk.rollup{top:9px;height:12px;border-radius:2px;background:#c9d3dc;border:1px solid #8b9aa8;overflow:hidden}#agenda-tijdlijn .tl-balk.rollup i{display:block;height:100%;background:var(--tl-balk)}'
    + '#agenda-tijdlijn .tl-ruit{position:absolute;top:8px;width:14px;height:14px;margin-left:-7px;transform:rotate(45deg);background:var(--tl-balk);border:0;padding:0;cursor:pointer}#agenda-tijdlijn .tl-ruit.klaar{background:#c9d3dc;border:1px solid #8b9aa8}#agenda-tijdlijn .tl-ruit.kritiek{box-shadow:0 0 0 2px var(--tl-kritiek)}'
    + '#agenda-tijdlijn .tl-mat{display:inline-flex;align-items:center;gap:2px;color:var(--ink-2,#596059);font:500 11px/14px var(--mono,monospace)}#agenda-tijdlijn .tl-mat.laat{color:#b3261e;font-weight:600}'
    + '#agenda-tijdlijn .tl-vandaag{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--brass,#d19a1f);z-index:2;pointer-events:none}#agenda-tijdlijn .tl-vlag{position:absolute;top:6px;width:2px;height:18px;margin-left:-1px;background:var(--ink,#1f2a24)}'
    + '#agenda-tijdlijn .tl-bep{position:absolute;top:4px;height:22px;width:0;border-left:2px solid #5a6b78;margin-left:-1px;pointer-events:none}#agenda-tijdlijn .tl-bep.tl-bep-uiterlijk{border-left:3px double var(--tl-kritiek)}#agenda-tijdlijn .tl-bep.tl-bep-vast_op{border-left:3px dotted var(--ink,#1f2a24)}#agenda-tijdlijn .tl-bep.laat{border-left-color:var(--tl-kritiek);box-shadow:0 0 0 1px #fbe3e0}'
    + '#agenda-tijdlijn .tl-bewerk{margin:0 0 10px;padding:8px 10px;border:1px solid var(--line-strong,#c9d1cd);border-radius:6px;background:var(--surface-sunken,#f6f3ed);display:flex;flex-direction:column;gap:8px}#agenda-tijdlijn .tl-bewerk-rij{display:flex;flex-wrap:wrap;align-items:center;gap:8px}#agenda-tijdlijn .tl-bewerk-sub,#agenda-tijdlijn .tl-bewerk-tekst{font:400 12px/16px var(--sans,inherit);color:var(--ink-2,#596059)}#agenda-tijdlijn .tl-bewerk-fout{flex-basis:100%;color:var(--tl-kritiek);font:500 12px/16px var(--sans,inherit)}#agenda-tijdlijn .tl-bewerk-fout:empty{display:none}'
    + '#agenda-tijdlijn .tl-invoer{height:34px;padding:0 8px;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;background:var(--surface,#fff);font:400 13px/18px var(--sans,inherit);max-width:100%}#agenda-tijdlijn .tl-kort{width:70px}#agenda-tijdlijn .tl-knop.tl-primair{background:var(--primary,#2A4A38);color:#fff;border-color:var(--primary,#2A4A38)}'
    + '#agenda-tijdlijn.bewerk .tl-balk:not(.rollup):not(.klaar),#agenda-tijdlijn.bewerk .tl-ruit:not(.klaar){cursor:grab;touch-action:none}#agenda-tijdlijn .tl-balk.gekozen,#agenda-tijdlijn .tl-ruit.gekozen{outline:3px solid var(--focus,#2A4A38);outline-offset:1px}'
    + '#agenda-tijdlijn .tl-greep{position:absolute;top:0;bottom:0;width:min(7px,28%);cursor:ew-resize;background:rgba(255,255,255,.55);border:1px solid var(--tl-balk)}#agenda-tijdlijn .tl-greep.l{left:0;border-radius:3px 0 0 3px}#agenda-tijdlijn .tl-greep.r{right:0;border-radius:0 3px 3px 0}'
    + '#agenda-tijdlijn .tl-koppel{position:absolute;top:10px;width:10px;height:10px;margin-left:-2px;border-radius:50%;background:var(--surface,#fff);border:2px solid var(--primary,#2A4A38);cursor:crosshair;touch-action:none;z-index:4}'
    + '#agenda-tijdlijn .tl-spook{position:absolute;height:16px;border:2px dashed var(--primary,#2A4A38);border-radius:3px;box-sizing:border-box;background:rgba(42,74,56,.12);pointer-events:none;z-index:3}'
    + '.tl-tip{position:fixed;z-index:9000;max-width:320px;padding:6px 10px;border-radius:4px;background:#1f2a24;color:#fff;font:500 12px/16px var(--sans,system-ui);pointer-events:none}'
    + '.tl-typemenu{position:fixed;z-index:9001;width:260px;padding:8px;border:1px solid var(--line-strong,#c9d1cd);border-radius:6px;background:var(--surface,#fff);box-shadow:0 8px 24px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:4px;font:400 13px/18px var(--sans,system-ui)}.tl-typekop{font-weight:600;padding:2px 4px 6px}.tl-typefout{color:#b3261e;padding:2px 4px}'
    + '.tl-typeknop{height:36px;text-align:left;padding:0 10px;border:1px solid var(--line-strong,#c9d1cd);border-radius:4px;background:var(--surface,#fff);cursor:pointer;font:400 13px/18px var(--sans,system-ui)}.tl-typeknop:hover,.tl-typeknop:focus-visible{background:var(--surface-sunken,#f1ede5)}.tl-typeknop.annuleer{color:var(--ink-2,#596059)}'
    + '#agenda-tijdlijn .tl-lijnen{position:absolute;left:0;top:' + HEAD_H + 'px;pointer-events:none;z-index:1;overflow:visible}'
    + '#agenda-tijdlijn .tl-geen{position:absolute;font:400 12px/16px var(--sans,inherit);color:var(--ink-3,#8a8f89);top:7px;padding-left:8px}'
    + '#agenda-tijdlijn .tl-legenda{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin-top:10px;font:400 12px/16px var(--sans,inherit);color:var(--ink-2,#596059)}#agenda-tijdlijn .tl-legenda .tl-balk{position:static;display:inline-block;width:26px;height:12px;vertical-align:middle;margin-right:6px}'
    + '#agenda-tijdlijn .tl-noot{margin-top:8px;font:400 12px/16px var(--sans,inherit);color:var(--ink-2,#596059);border-left:2px solid var(--brass,#d19a1f);padding-left:8px}'
    + '#agenda-tijdlijn .tl-leeg{padding:24px;text-align:center;color:var(--ink-3,#8a8f89)}'
    + '@media (max-width:640px){#agenda-tijdlijn{--tl-lw:150px !important}#agenda-tijdlijn .tl-seg button,#agenda-tijdlijn .tl-knop{height:44px}#agenda-tijdlijn .tl-scroll{height:60vh}}';
  const statusLabel = s => (P.TAAK_STATUS_LABEL && P.TAAK_STATUS_LABEL[s]) || s;
  const kort = ymd => P.datumKort(ymd);
  const klein = () => { try { return !!(D.doc.defaultView && D.doc.defaultView.matchMedia && D.doc.defaultView.matchMedia('(max-width:640px)').matches); } catch (e) { return false; } };

  // Het icoontje 'wacht op materiaal' (een doos) met het aantal open regels; rood als de verwachte levering na de geplande start valt. Nooit alleen kleur: het aantal en de tekst staan erbij.
  function matIcoon(m) {
    const s = svg('svg', { viewBox: '0 0 24 24', width: '14', height: '14', 'aria-hidden': 'true' });
    s.appendChild(svg('path', { d: 'M3 8l9-5l9 5v8l-9 5l-9-5zM3 8l9 5l9-5M12 13v8', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linejoin': 'round' }));
    const tekst = m.tekst + (m.laatste ? ' (verwacht ' + P.datumKort(m.laatste) + (m.laat ? ', na de geplande start' : '') + ')' : '');
    return el('span', { klass: 'tl-mat' + (m.laat ? ' laat' : ''), title: tekst, 'aria-label': 'Wacht op materiaal: ' + tekst, role: 'img' }, s, el('span', { tekst: String(m.open) }));
  }
  // P4b: slepen op de balk (alleen in de stand Bewerken, niet op de telefoon). Het midden verplaatst, de randen rekken, het bolletje rechts trekt een afhankelijkheid naar een andere balk.
  // Tijdens het slepen staat er een voorbeeld: de nieuwe datums en welke opvolgers meeschuiven (MTPlanning.verschuifVoorstel, alleen kijken); pas bij loslaten gaat het via de planroute,
  // die zelf nog vraagt of de opvolgers mee moeten. Esc breekt af.
  function sleepbaar(bal, r, m, as, w, naKlik) {
    const mijlpaal = r.mijlpaal, klaar = r.status === 'klaar', toon = kanSleep() && !klaar, rij = bal.parentNode;
    if (toon && !mijlpaal) ['start', 'eind'].forEach(kant => { const g = el('span', { klass: 'tl-greep ' + (kant === 'start' ? 'l' : 'r'), 'aria-hidden': 'true', title: 'Sleep om de ' + kant + ' te verplaatsen' }); g.addEventListener('pointerdown', ev => begin(ev, kant)); bal.appendChild(g); });
    if (toon) bal.addEventListener('pointerdown', ev => { if (ev.target === bal || ev.target.nodeType === 1 && !ev.target.classList.contains('tl-greep')) begin(ev, 'verplaats'); });
    if (kanKoppel()) { const k = el('span', { klass: 'tl-koppel', 'aria-hidden': 'true', title: 'Sleep naar een andere balk om een afhankelijkheid te leggen' }); k.addEventListener('pointerdown', ev => begin(ev, 'koppel')); (rij || bal).appendChild(k); k.style.left = (as.x(r.eind || r.start) + as.px + 3) + 'px'; }
    const tip = tekst => { let t = D.doc.getElementById('tl-tip'); if (!t) { t = el('div', { id: 'tl-tip', klass: 'tl-tip', role: 'status' }); D.doc.body.appendChild(t); } t.textContent = tekst; return t; };
    const weg = () => { const t = D.doc.getElementById('tl-tip'); if (t && t.parentNode) t.parentNode.removeChild(t); w.vlak.querySelectorAll('.tl-spook,.tl-trek').forEach(x => x.parentNode && x.parentNode.removeChild(x)); w.lijnen.querySelectorAll('.tl-trekpad').forEach(x => x.parentNode && x.parentNode.removeChild(x)); };
    function begin(ev, kind) {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      const x0 = ev.clientX, vrij = vrijDagen(), links0 = bal.style.left, breed0 = bal.style.width, lijst = lijstVan(r.code), deps = depsVan(r.code);
      let nieuw = null, bewogen = false, pad = null, doel = null;
      const rijTop = m.rijen.findIndex(x => x.soort === 'taak' && zelfde(x.code, r.code) && String(x.id) === String(r.id)) * RH + RH / 2;
      try { bal.setPointerCapture(ev.pointerId); } catch (e) {}
      const klaarMet = () => { bal.removeEventListener('pointermove', beweeg); bal.removeEventListener('pointerup', los); bal.removeEventListener('pointercancel', stop); D.doc.removeEventListener('keydown', toets, true); try { bal.releasePointerCapture(ev.pointerId); } catch (e) {} };
      const stop = () => { klaarMet(); weg(); bal.style.left = links0; bal.style.width = breed0; };
      const toets = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); } };
      D.doc.addEventListener('keydown', toets, true);
      const rijOnder = e => { const x = D.doc.elementFromPoint(e.clientX, e.clientY), rr = x && x.closest ? x.closest('.tl-rij.taak') : null; return rr ? { code: rr.getAttribute('data-pf-code'), id: rr.getAttribute('data-pf-taak') } : null; };
      function beweeg(e) {
        if (!bewogen && Math.abs(e.clientX - x0) < 4 && (kind !== 'koppel' || Math.abs(e.clientY - ev.clientY) < 4)) return;
        bewogen = true;
        if (kind === 'koppel') {
          const box = w.vlak.getBoundingClientRect(), px = e.clientX - box.left, py = e.clientY - box.top, sx = as.x(r.eind || r.start) + as.px;
          if (!pad) { pad = svg('path', { class: 'tl-trekpad', fill: 'none', stroke: '#2A4A38', 'stroke-width': '2', 'stroke-dasharray': '4 3' }); w.lijnen.appendChild(pad); }
          pad.setAttribute('d', 'M' + sx + ',' + rijTop + ' L' + px + ',' + py);
          doel = rijOnder(e); const dt = doel && !(zelfde(doel.code, r.code) && String(doel.id) === String(r.id)) ? taakVan(doel.code, doel.id) : null;
          const toets2 = dt ? Tl.koppelToets({ code: r.code, id: r.id }, doel) : null;
          const tt = tip(dt ? (toets2.ok ? 'Loslaan om ' + r.label + ' vóór ' + (dt.naam || '?') + ' te zetten (type kies je daarna)' : toets2.fout) : 'Sleep naar de balk van de opvolger');
          tt.style.left = (e.clientX + 14) + 'px'; tt.style.top = (e.clientY + 14) + 'px'; return;
        }
        const delta = Math.round((e.clientX - x0) / as.px);
        nieuw = Tl.nieuweDatums(kind, r.start, r.eind, delta, vrij);
        w.vlak.querySelectorAll('.tl-spook').forEach(x => x.parentNode && x.parentNode.removeChild(x));
        const st = nieuw ? nieuw.start : r.start, ei = nieuw ? nieuw.eind : r.eind;
        bal.style.left = as.x(st) + 'px'; bal.style.width = Math.max(4, (dnr(ei) - dnr(st) + 1) * as.px) + 'px';
        let tekst = nieuw ? (nieuw.start === nieuw.eind ? kort(nieuw.start) : kort(nieuw.start) + ' \u2013 ' + kort(nieuw.eind)) : 'geen wijziging', n = 0;
        if (nieuw) {
          let vs = null; try { vs = P.verschuifVoorstel(lijst, deps, { id: r.id, start: nieuw.start, eind: nieuw.eind }, { modus: 'flexible', vrij, alle: D.taken(), code: r.code }); } catch (x) { vs = null; }
          ((vs && vs.ok && vs.wijzigingen) || []).forEach(wj => {
            const i = m.rijen.findIndex(x => x.soort === 'taak' && zelfde(x.code, r.code) && String(x.id) === String(wj.id)); if (i < 0) return; n++;
            w.vlak.appendChild(el('span', { klass: 'tl-spook', stijl: 'top:' + (i * RH + 7) + 'px;left:' + as.x(wj.naar.start) + 'px;width:' + Math.max(4, (dnr(wj.naar.eind) - dnr(wj.naar.start) + 1) * as.px) + 'px', 'aria-hidden': 'true' }));
          });
          if (vs && vs.vastgezet && vs.vastgezet.length) tekst += ' \u00b7 ' + vs.vastgezet.length + ' blijft vast';
          tekst += n ? ' \u00b7 ' + n + ' opvolger' + (n === 1 ? '' : 's') + ' schuift' + (n === 1 ? '' : 'en') + ' mee (je krijgt nog de vraag)' : (vs && vs.ok ? ' \u00b7 geen opvolgers' : '');
        }
        const tt = tip(tekst); tt.style.left = (e.clientX + 14) + 'px'; tt.style.top = (e.clientY + 14) + 'px';
      }
      async function los(e) {
        klaarMet(); const wasKoppel = kind === 'koppel', d = doel; weg();
        if (!bewogen) { return; }
        if (naKlik) naKlik();
        if (wasKoppel) { const dt = d && !(zelfde(d.code, r.code) && String(d.id) === String(r.id)) ? taakVan(d.code, d.id) : null; if (!dt) return; typeMenu(e.clientX, e.clientY, { code: r.code, id: r.id }, d); return; }
        if (!nieuw) { bal.style.left = links0; bal.style.width = breed0; return; }
        await Tl.slaDatumsOp(r, nieuw.start, nieuw.eind);
      }
      bal.addEventListener('pointermove', beweeg); bal.addEventListener('pointerup', los); bal.addEventListener('pointercancel', stop);
    }
  }
  // Na het trekken van een afhankelijkheid: het type kiezen in een klein menu (EB, BB, EE, BE), met Annuleren.
  function typeMenu(x, y, van, naar) {
    const oud = D.doc.getElementById('tl-typemenu'); if (oud && oud.parentNode) oud.parentNode.removeChild(oud);
    const toets = Tl.koppelToets(van, naar);
    const vn = (taakVan(van.code, van.id) || {}).naam || '?', nn = (taakVan(naar.code, naar.id) || {}).naam || '?';
    const menu = el('div', { id: 'tl-typemenu', klass: 'tl-typemenu', role: 'dialog', 'aria-label': 'Kies het type koppeling', stijl: 'left:' + Math.max(8, Math.min(x, (D.doc.defaultView ? D.doc.defaultView.innerWidth : 800) - 270)) + 'px;top:' + Math.max(8, y) + 'px' },
      el('div', { klass: 'tl-typekop', tekst: vn + ' \u2192 ' + nn }));
    if (!toets.ok) menu.appendChild(el('div', { klass: 'tl-typefout', role: 'alert', tekst: toets.fout }));
    else TYPEN.forEach(([w, af, uitleg]) => menu.appendChild(el('button', { type: 'button', klass: 'tl-typeknop', title: uitleg, klik: () => { sluit(); Tl.legKoppeling(van, naar, w, 0); } }, el('b', { tekst: af }), ' ' + uitleg)));
    menu.appendChild(el('button', { type: 'button', klass: 'tl-typeknop annuleer', tekst: 'Annuleren', klik: () => sluit() }));
    const sluit = () => { if (menu.parentNode) menu.parentNode.removeChild(menu); D.doc.removeEventListener('keydown', esc, true); };
    const esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sluit(); } };
    D.doc.addEventListener('keydown', esc, true); D.doc.body.appendChild(menu);
    const eerste = menu.querySelector('button'); if (eerste) eerste.focus();
  }
  // De bewerkbalk (stand Bewerken): wat er gekozen is, de knoppen Verplaatsen… en Koppelen… (de weg zonder slepen, ook op de telefoon) en de formulieren daarvoor.
  function bewerkBalk(m) {
    const r = S.gekozen ? m.rijen.find(x => x.soort === 'taak' && zelfde(x.code, S.gekozen.code) && String(x.id) === String(S.gekozen.id)) : null;
    const balk = el('div', { klass: 'tl-bewerk', role: 'region', 'aria-label': 'Tijdlijn bewerken' });
    if (!r) { balk.appendChild(el('div', { klass: 'tl-bewerk-tekst', tekst: 'Kies een taak (klik op de balk of de naam).' + (klein() ? ' Daarna kun je hem met de knoppen verplaatsen of koppelen.' : ' Sleep een balk om hem te verplaatsen, de randen om hem te rekken en het bolletje rechts naar een andere balk om te koppelen; of gebruik daarna de knoppen.') })); return balk; }
    const tekst = r.start ? (r.start === r.eind ? kort(r.start) : kort(r.start) + ' \u2013 ' + kort(r.eind)) : 'nog niet ingepland';
    const rij1 = el('div', { klass: 'tl-bewerk-rij' }, el('b', { tekst: r.label }), el('span', { klass: 'tl-bewerk-sub', tekst: ' ' + tekst }),
      D.openTaak ? el('button', { type: 'button', klass: 'tl-knop', tekst: 'Open taak', klik: () => D.openTaak(r.code, r.id, null) }) : null,
      kanSleep() && r.status !== 'klaar' ? el('button', { type: 'button', klass: 'tl-knop', 'aria-pressed': S.paneel === 'verplaats' ? 'true' : 'false', tekst: 'Verplaatsen\u2026', klik: () => { S.paneel = S.paneel === 'verplaats' ? '' : 'verplaats'; Tl.teken(); } }) : null,
      kanKoppel() ? el('button', { type: 'button', klass: 'tl-knop', 'aria-pressed': S.paneel === 'koppel' ? 'true' : 'false', tekst: 'Koppelen\u2026', klik: () => { S.paneel = S.paneel === 'koppel' ? '' : 'koppel'; Tl.teken(); } }) : null,
      el('button', { type: 'button', klass: 'tl-knop', tekst: 'Kies niets', klik: () => { S.gekozen = null; S.paneel = ''; Tl.teken(); } }));
    balk.appendChild(rij1);
    if (S.paneel === 'verplaats') {
      const a = el('input', { type: 'date', klass: 'tl-invoer', id: 'tl-v-start', 'aria-label': r.mijlpaal ? 'Datum' : 'Nieuwe start', value: ok(r.start) ? r.start : '' });
      const b = r.mijlpaal ? null : el('input', { type: 'date', klass: 'tl-invoer', id: 'tl-v-eind', 'aria-label': 'Nieuw eind', value: ok(r.eind) ? r.eind : '' });
      const melding = el('div', { klass: 'tl-bewerk-fout', role: 'alert' });
      const opslaan = el('button', { type: 'button', klass: 'tl-knop tl-primair', tekst: 'Opslaan', klik: async () => {
        const s = a.value, e = b ? b.value : s;
        if (!ok(s) || !ok(e)) { melding.textContent = 'Vul een geldige ' + (b ? 'start en eind' : 'datum') + ' in.'; return; }
        if (e < s) { melding.textContent = 'Het eind ligt voor de start.'; return; }
        if (s === r.start && e === r.eind) { melding.textContent = 'Er is niets veranderd.'; return; }
        S.paneel = ''; await Tl.slaDatumsOp(r, s, e);
      } });
      balk.appendChild(el('div', { klass: 'tl-bewerk-rij' }, el('span', { klass: 'tl-bewerk-sub', tekst: r.mijlpaal ? 'Nieuwe datum' : 'Nieuwe start en eind' }), a, b ? el('span', { tekst: 't/m' }) : null, b, opslaan, el('span', { klass: 'tl-bewerk-sub', tekst: 'Hangen er opvolgers aan, dan vraag ik eerst of die mee schuiven.' }), melding));
    }
    if (S.paneel === 'koppel') {
      const richting = el('select', { klass: 'tl-invoer', id: 'tl-k-richting', 'aria-label': 'Richting van de koppeling' }, el('option', { value: 'voor', tekst: 'Deze taak komt na\u2026 (voorganger)' }), el('option', { value: 'na', tekst: 'Deze taak komt v\u00f3\u00f3r\u2026 (opvolger)' }));
      const projecten = m.rijen.filter(x => x.soort === 'project');
      const proj = el('select', { klass: 'tl-invoer', id: 'tl-k-project', 'aria-label': 'Project van de andere taak' }, projecten.map(p => el('option', { value: p.code, tekst: p.label })));
      proj.value = r.code;
      const taak = el('select', { klass: 'tl-invoer', id: 'tl-k-taak', 'aria-label': 'De andere taak' });
      const type = el('select', { klass: 'tl-invoer', id: 'tl-k-type', 'aria-label': 'Type koppeling' }, TYPEN.map(([w, af, u]) => el('option', { value: w, tekst: af + ': ' + u })));
      const lag = el('input', { type: 'number', klass: 'tl-invoer tl-kort', id: 'tl-k-lag', min: '-365', max: '365', step: '1', value: '0', 'aria-label': 'Wachttijd in dagen (negatief is een voorsprong)' });
      const vul = () => {
        while (taak.firstChild) taak.removeChild(taak.firstChild);
        taak.appendChild(el('option', { value: '', tekst: 'Kies de taak\u2026' }));
        lijstVan(proj.value).filter(x => !(zelfde(proj.value, r.code) && String(x.id) === String(r.id))).forEach(x => {
          const c = richting.value === 'voor' ? Tl.koppelToets({ code: proj.value, id: x.id }, { code: r.code, id: r.id }) : Tl.koppelToets({ code: r.code, id: r.id }, { code: proj.value, id: x.id });
          taak.appendChild(el('option', { value: x.id, tekst: (x.naam || '(zonder naam)') + (c.ok ? '' : /bestaat al/.test(c.fout || '') ? ' (al gekoppeld)' : ' (maakt een kring)'), disabled: c.ok ? null : true }));
        });
      };
      proj.addEventListener('change', vul); richting.addEventListener('change', vul); vul();
      const melding = el('div', { klass: 'tl-bewerk-fout', role: 'alert' });
      const voeg = el('button', { type: 'button', klass: 'tl-knop tl-primair', tekst: 'Toevoegen', klik: async () => {
        if (!taak.value) { melding.textContent = 'Kies eerst de andere taak.'; return; }
        const ander = { code: proj.value, id: taak.value }, me = { code: r.code, id: r.id };
        S.paneel = ''; await Tl.legKoppeling(richting.value === 'voor' ? ander : me, richting.value === 'voor' ? me : ander, type.value, lag.value);
      } });
      balk.appendChild(el('div', { klass: 'tl-bewerk-rij' }, richting, proj, taak, type, lag, voeg, melding));
    }
    return balk;
  }

  // De rijen in beeld tekenen (vensterTekenen), met hun lijnen
  function tekenVenster(w, m, as) {
    const sc = w.scroll, vlak = w.vlak, lijnenEl = w.lijnen, hoogte = sc.clientHeight || 500, top = Math.max(0, sc.scrollTop - HEAD_H);
    const eerste = Math.max(0, Math.floor(top / RH) - 8), laatst = Math.min(m.rijen.length - 1, Math.ceil((top + hoogte) / RH) + 8);
    if (S.vensterVan === eerste && S.vensterTot === laatst && !w.opnieuw) return;
    S.vensterVan = eerste; S.vensterTot = laatst; w.opnieuw = false;
    vlak.textContent = ''; lijnenEl.textContent = '';
    for (let i = eerste; i <= laatst; i++) {
      const r = m.rijen[i], rij = el('div', { klass: 'tl-rij ' + r.soort, stijl: 'top:' + (i * RH) + 'px' });
      const open = r.soort === 'project' ? r.open : null;
      const sub = r.soort === 'taak' ? (r.persoon || '') : r.klaar + '/' + r.n;
      const lab = el('button', { type: 'button', klass: 'tl-label', 'aria-expanded': open === null ? null : String(open), title: r.label + (r.soort === 'taak' ? '' : ' · ' + r.klaar + ' van ' + r.n + ' taken klaar'),
        klik: () => { if (r.soort === 'project') { const k = String(r.code).toLowerCase(); if (S.open.has(k)) S.open.delete(k); else S.open.add(k); Tl.teken(); } else if (r.soort === 'taak' && S.bewerk) Tl.kies(r.code, r.id); else if (r.soort === 'taak' && D.openTaak) D.openTaak(r.code, r.id, lab); } },
        r.soort === 'project' ? el('span', { 'aria-hidden': 'true', tekst: r.open ? '▾' : '▸' }) : null, el('span', { tekst: r.label, stijl: 'overflow:hidden;text-overflow:ellipsis' }), r.mat ? matIcoon(r.mat) : null, el('span', { klass: 'tl-sub', tekst: sub }));
      rij.appendChild(lab);
      if (r.soort === 'taak') {
        rij.setAttribute('data-pf-code', r.code); rij.setAttribute('data-pf-taak', r.id);
        if (!r.start) rij.appendChild(el('span', { klass: 'tl-geen', stijl: 'left:' + (w.lw) + 'px', tekst: 'geen datums' }));
        else {
          const x = as.x(r.start), b = (dnr(r.eind) - dnr(r.start) + 1) * as.px, beschr = r.label + ' · ' + statusLabel(r.status) + ' · ' + (r.start === r.eind ? kort(r.start) : kort(r.start) + ' – ' + kort(r.eind)) + (r.persoon ? ' · ' + r.persoon : '') + (r.kritiek ? ' · kritiek pad' : '') + (r.wacht ? ' · wacht: ' + r.wacht : '') + (r.beperking ? ' · ' + ({ niet_voor: 'niet v\u00f3\u00f3r ', uiterlijk: 'uiterlijk ', vast_op: 'vast op ' }[r.beperking]) + kort(r.beperkingDatum) + (r.beperkingConflict ? ' (klopt niet met de planning)' : '') : '');
          const klik = () => { if (S.bewerk) { if (!sleepte) Tl.kies(r.code, r.id); return; } if (D.openTaak) D.openTaak(r.code, r.id, bal); };
          let sleepte = false; const gek = S.bewerk && S.gekozen && zelfde(S.gekozen.code, r.code) && String(S.gekozen.id) === String(r.id);
          const bal = r.mijlpaal ? el('button', { type: 'button', klass: 'tl-ruit ' + (r.status === 'klaar' ? 'klaar ' : '') + (r.kritiek ? 'kritiek' : '') + (gek ? ' gekozen' : ''), stijl: 'left:' + (x + as.px / 2) + 'px', title: beschr, 'aria-label': beschr, klik })
            : el('button', { type: 'button', klass: 'tl-balk ' + (r.status === 'todo' ? 'open' : r.status) + (r.kritiek ? ' kritiek' : '') + (gek ? ' gekozen' : ''), stijl: 'left:' + x + 'px;width:' + Math.max(4, b) + 'px', title: beschr, 'aria-label': beschr, klik });
          rij.appendChild(bal);
          if (S.bewerk && !klein()) sleepbaar(bal, r, m, as, w, () => { sleepte = true; setTimeout(() => { sleepte = false; }, 0); });
        }
        if (r.beperking) {   // F2b: een streepje op de datum (deadline, vaste afspraak of eerste mogelijke dag); rood als het niet klopt met de planning, de tekst staat in de titel en bij de taak
          const naam = { niet_voor: 'Niet v\u00f3\u00f3r ', uiterlijk: 'Uiterlijk ', vast_op: 'Vast op ' }[r.beperking] + kort(r.beperkingDatum) + (r.beperkingConflict ? ' \u00b7 klopt niet met de planning' : '');
          rij.appendChild(el('span', { klass: 'tl-bep tl-bep-' + r.beperking + (r.beperkingConflict ? ' laat' : ''), stijl: 'left:' + (as.x(r.beperkingDatum) + (r.beperking === 'uiterlijk' ? as.px : 0)) + 'px', title: naam, role: 'img', 'aria-label': naam }));
        }
      } else if (r.start) {
        const x = as.x(r.start), b = (dnr(r.eind) - dnr(r.start) + 1) * as.px, pct = r.n ? Math.round(r.klaar / r.n * 100) : 0;
        const beschr = r.label + ' · ' + kort(r.start) + ' – ' + kort(r.eind) + ' · ' + r.klaar + ' van ' + r.n + ' taken klaar';
        rij.appendChild(el('button', { type: 'button', klass: 'tl-balk rollup', stijl: 'left:' + x + 'px;width:' + Math.max(4, b) + 'px', title: beschr, 'aria-label': beschr,
          klik: () => { if (r.soort === 'project' && D.openProject) D.openProject(r.code); else { const k = String(r.code).toLowerCase(); S.open.add(k); } } }, el('i', { stijl: 'width:' + pct + '%' })));
        if (r.soort === 'project' && r.lever) rij.appendChild(el('span', { klass: 'tl-vlag', stijl: 'left:' + (as.x(r.lever) + as.px / 2) + 'px', title: 'Leverdatum ' + kort(r.lever), 'aria-hidden': 'true' }));
      } else rij.appendChild(el('span', { klass: 'tl-geen', stijl: 'left:' + w.lw + 'px', tekst: 'geen datums' }));
      vlak.appendChild(rij);
    }
    // de lijnen van de rijen in beeld (beide uiteinden tellen mee, zodat een lijn naar buiten het beeld doorloopt)
    m.lijnen.forEach(l => {
      if (Math.max(l.van, l.naar) < eerste || Math.min(l.van, l.naar) > laatst) return;
      const a = m.rijen[l.van], b = m.rijen[l.naar], p = Tl.lijnPad(as, a, b, RH, l.type), kl = l.kritiek ? '#b3261e' : '#646a64';
      const pad = svg('path', { d: p.d, fill: 'none', stroke: kl, 'stroke-width': l.kritiek ? '2' : '1.2', 'stroke-linejoin': 'round' });
      if (l.ander) { pad.setAttribute('stroke-dasharray', '5 3'); const ti = svg('title'); ti.textContent = 'Koppeling met een ander project' + (l.type ? ' (' + P.DEP_TYPE_NAMEN[l.type] + ')' : ''); pad.appendChild(ti); }
      if (l.type && !l.ander) { const ti = svg('title'); ti.textContent = P.DEP_TYPE_NAMEN[l.type] + (l.lag ? ', ' + (l.lag > 0 ? '+' : '') + l.lag + ' d' : ''); pad.appendChild(ti); }
      lijnenEl.appendChild(pad);
      const [X, py] = p.pijl; lijnenEl.appendChild(svg('path', { d: p.links ? 'M' + X + ',' + py + ' l6,-3.5 v7 z' : 'M' + X + ',' + py + ' l-6,-3.5 v7 z', fill: kl }));
      if (l.type) { const tk = svg('text', { x: String(p.links ? X + 9 : X - 9 - 12), y: String(py - 5), 'font-size': '9', 'font-family': 'monospace', fill: kl, class: 'tl-lijntype' }); tk.textContent = P.DEP_TYPEN[l.type]; lijnenEl.appendChild(tk); }   // het type bij de pijl (alleen als het niet EB is)
    });
  }

  Tl.teken = function () {
    const w0 = D && D.doc.getElementById('agenda-tijdlijn'); if (!w0) return;
    const oud = w0.querySelector('.tl-scroll'), sl = oud ? oud.scrollLeft : null, st = oud ? oud.scrollTop : 0;
    w0.textContent = '';
    if (!D.doc.getElementById('tl-stijl')) { const s = el('style', { id: 'tl-stijl' }); s.textContent = STIJL; D.doc.head.appendChild(s); }
    const pf = root.MTPlanFilter, g = pf ? pf.get() : { project: '', status: '', zoom: '' }, zoom = ZOOMS[g.zoom] ? g.zoom : 'maand';
    const kop = el('div', { klass: 'tl-kop' },
      pf ? pf.balk({ pre: 'tl', std: 'iedereen', klaar: () => Tl.teken() }) : null,
      el('div', { klass: 'tl-seg', role: 'group', 'aria-label': 'Zoom' }, ZOOM_LABELS.map(([k, l]) => el('button', { type: 'button', 'aria-pressed': k === zoom ? 'true' : 'false', tekst: l, klik: () => { if (pf) pf.zet({ zoom: k }); S.vensterVan = -1; Tl.teken(); } }))),
      el('button', { type: 'button', klass: 'tl-knop', 'aria-pressed': S.kritiek ? 'true' : 'false', title: 'De ketting taken die de leverdatum bepaalt (in uitgeklapte projecten)', tekst: 'Kritiek pad', klik: () => { S.kritiek = !S.kritiek; Tl.teken(); } }),
      el('button', { type: 'button', klass: 'tl-knop', 'aria-pressed': S.verbergKlaar ? 'true' : 'false', tekst: 'Verberg afgerond', klik: () => { S.verbergKlaar = !S.verbergKlaar; Tl.teken(); } }),
      el('button', { type: 'button', klass: 'tl-knop', tekst: S.alles ? 'Alles dicht' : 'Alles open', klik: () => { S.alles = !S.alles; if (!S.alles) S.open.clear(); Tl.teken(); } }),
      kanSleep() || kanKoppel() ? el('button', { type: 'button', klass: 'tl-knop', id: 'tl-bewerk-knop', 'aria-pressed': S.bewerk ? 'true' : 'false', title: 'Balken verplaatsen, rekken en koppelen; alles met Ongedaan maken', tekst: 'Bewerken', klik: () => Tl.zetBewerk(!S.bewerk) }) : null,
      el('button', { type: 'button', klass: 'tl-knop', tekst: 'Vandaag', klik: () => { const sc = D.doc.querySelector('#agenda-tijdlijn .tl-scroll'), v = D.doc.querySelector('#agenda-tijdlijn .tl-vandaag'); if (sc && v) sc.scrollLeft = Math.max(0, v.offsetLeft - sc.clientWidth / 2 + (klein() ? LABEL_W_KLEIN : LABEL_W) / 2); } }));
    w0.appendChild(kop);
    if (D.takenKlaar && !D.takenKlaar()) w0.appendChild(el('div', { klass: 'mw-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const filter = { project: g.project || '', persoon: pf ? pf.persoonSlug('iedereen') : '', status: pf && g.status ? pf.statusTaak(g.status) : '' };
    let m;
    try { m = Tl.model({ taken: D.taken(), afhank: D.afhank(), bestel: D.bestel ? D.bestel() : [], projecten: D.projecten(), team: D.team(), vrij: D.vrij ? D.vrij() : null, vandaag: P.vandaagYmd(), filter, open: S.open, alles: S.alles, kritiek: S.kritiek, verbergKlaar: S.verbergKlaar }); }
    catch (e) { console.warn('Tijdlijn:', e); w0.appendChild(el('div', { klass: 'tl-leeg', tekst: 'De tijdlijn kon niet worden berekend.' })); return; }
    S.laatste = m;
    w0.classList.toggle('bewerk', !!S.bewerk);
    if (S.bewerk) w0.appendChild(bewerkBalk(m));
    if (!m.rijen.length) { w0.appendChild(el('div', { klass: 'tl-leeg', tekst: 'Geen taken bij deze keuze.' })); }
    else {
      const lw = klein() ? LABEL_W_KLEIN : LABEL_W, as = Tl.as(m, zoom, lw);
      const inner = el('div', { klass: 'tl-inner', stijl: '--tl-lw:' + lw + 'px;width:' + (lw + as.breedte) + 'px;height:' + (HEAD_H + m.rijen.length * RH) + 'px' });
      // kopband: maanden en weken
      const band = el('div', { klass: 'tl-kopband' }, el('div', { klass: 'tl-labelkop', tekst: m.aantalProjecten + ' projecten · ' + m.aantalTaken + ' taken' }));
      for (let d = as.van; d < as.van + as.dagen; d++) {
        const dt = new Date(d * 864e5), dag = dt.getUTCDate(), x = lw + (d - as.van) * as.px;
        if (dag === 1 || d === as.van) band.appendChild(el('div', { klass: 'tl-maand', stijl: 'left:' + x + 'px', tekst: MND[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear() }));
        if (((d + 4) % 7 + 7) % 7 === 1 && as.px >= 8) band.appendChild(el('div', { klass: 'tl-week', stijl: 'left:' + x + 'px', tekst: String(dag) }));
      }
      inner.appendChild(band);
      const vlak = el('div', { klass: 'tl-vlak', stijl: 'height:' + (m.rijen.length * RH) + 'px' });
      const ls = svg('svg', { class: 'tl-lijnen', width: String(lw + as.breedte), height: String(m.rijen.length * RH), 'aria-hidden': 'true' });
      inner.appendChild(vlak); inner.appendChild(ls);
      inner.appendChild(el('div', { klass: 'tl-vandaag', stijl: 'left:' + (as.x(m.vandaag) + as.px / 2) + 'px', title: 'Vandaag', 'aria-hidden': 'true' }));
      const sc = el('div', { klass: 'tl-scroll', tabindex: '0', role: 'region', 'aria-label': 'Team-tijdlijn' }, inner);
      w0.appendChild(sc);
      const w = { scroll: sc, vlak, lijnen: ls, lw, opnieuw: true }; S.vensterVan = S.vensterTot = -1;
      sc.addEventListener('scroll', () => { if (w.raf) return; w.raf = true; (D.doc.defaultView && D.doc.defaultView.requestAnimationFrame ? D.doc.defaultView.requestAnimationFrame.bind(D.doc.defaultView) : (f => setTimeout(f, 16)))(() => { w.raf = false; tekenVenster(w, m, as); if (root.MTPlanFilter) root.MTPlanFilter.markeer(vlak); }); });
      Tl.laatsteTijd = (() => { const t0 = (root.performance || Date).now(); tekenVenster(w, m, as); return (root.performance || Date).now() - t0; })();
      sc.scrollTop = st;
      if (sl !== null) sc.scrollLeft = sl; else { sc.scrollLeft = Math.max(0, as.x(m.vandaag) - sc.clientWidth / 3); }
      tekenVenster(w, m, as);
      if (root.MTPlanFilter) root.MTPlanFilter.markeer(vlak);
      Tl.w = w;
    }
    const leg = el('div', { klass: 'tl-legenda', role: 'list' },
      [['open', 'Open'], ['bezig', 'Bezig'], ['wacht', 'Wacht'], ['klaar', 'Klaar']].map(([k, l]) => el('span', { role: 'listitem' }, el('span', { klass: 'tl-balk ' + k }), l)),
      el('span', { role: 'listitem' }, el('span', { klass: 'tl-balk rollup' }, el('i', { stijl: 'width:60%' })), 'Project of fase (voortgang)'),
      el('span', { role: 'listitem' }, el('span', { klass: 'tl-balk bezig kritiek' }), 'Kritiek pad'),
      el('span', { role: 'listitem', tekst: '◆ Mijlpaal' }), el('span', { role: 'listitem', tekst: '│ Leverdatum' }), el('span', { role: 'listitem', tekst: '↳ Afhankelijkheid' }));
    w0.appendChild(leg);
    w0.appendChild(el('div', { klass: 'tl-noot', role: 'note', tekst: (S.bewerk ? 'Bewerken staat aan: een klik kiest een taak. ' : 'Een klik opent de taak. ') + 'Alle vier de typen koppeling staan erop (EB zonder label, de rest met de afkorting), een gestippelde lijn loopt naar een ander project. ' + (kanSleep() || kanKoppel() ? (S.bewerk ? 'Zet Bewerken uit om taken weer te openen.' : 'Met Bewerken verplaats of koppel je balken.') : 'Je kunt de tijdlijn alleen bekijken; wijzigen kan in het taakpaneel.') }));
  };

  Tl.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return Tl; };
  Tl.S = S;
  root.MTTijdlijn = Tl;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tl;
})(typeof window !== 'undefined' ? window : globalThis);
