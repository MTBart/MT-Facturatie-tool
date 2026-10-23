/* ============================================================================
 * mt-tijdlijn.js: de team-tijdlijn (Gantt) over alle projecten, alleen lezen (planning brok P4a)
 * ----------------------------------------------------------------------------
 * Een rij per project (balk = van de eerste start tot het laatste eind van zijn taken, met voortgang), uitklapbaar naar fasen (ook berekend uit de taken: roll-up, met
 * voortgang "3/5 klaar", verbeterpunt 67) en taken (balk, of een ruit voor een mijlpaal). Afhankelijkheidslijnen tussen de taken, het kritieke pad als laag
 * (MTPlanning.rooster: dezelfde rekenregels als de rest van de tool), de leverdatum als vlag en Vandaag als lijn. De P0-filterbalk geldt (project, wie, status).
 * Wat er niet is, staat er eerlijk bij: alleen einde-naar-begin in werkdagen (met wachttijd); begin-naar-begin, einde-naar-einde en wachttijd in kalenderdagen komen later (F2).
 * Alleen lezen: een klik op een taakbalk opent het taakpaneel, op een projectbalk het project; er wordt niets geschreven.
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
  const S = { open: new Set(), alles: false, kritiek: true, verbergKlaar: false, vensterVan: -1, vensterTot: -1, laatste: null };
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
        klik: () => { if (r.soort === 'project') { const k = String(r.code).toLowerCase(); if (S.open.has(k)) S.open.delete(k); else S.open.add(k); Tl.teken(); } else if (r.soort === 'taak' && D.openTaak) D.openTaak(r.code, r.id, lab); } },
        r.soort === 'project' ? el('span', { 'aria-hidden': 'true', tekst: r.open ? '▾' : '▸' }) : null, el('span', { tekst: r.label, stijl: 'overflow:hidden;text-overflow:ellipsis' }), r.mat ? matIcoon(r.mat) : null, el('span', { klass: 'tl-sub', tekst: sub }));
      rij.appendChild(lab);
      if (r.soort === 'taak') {
        rij.setAttribute('data-pf-code', r.code); rij.setAttribute('data-pf-taak', r.id);
        if (!r.start) rij.appendChild(el('span', { klass: 'tl-geen', stijl: 'left:' + (w.lw) + 'px', tekst: 'geen datums' }));
        else {
          const x = as.x(r.start), b = (dnr(r.eind) - dnr(r.start) + 1) * as.px, beschr = r.label + ' · ' + statusLabel(r.status) + ' · ' + (r.start === r.eind ? kort(r.start) : kort(r.start) + ' – ' + kort(r.eind)) + (r.persoon ? ' · ' + r.persoon : '') + (r.kritiek ? ' · kritiek pad' : '') + (r.wacht ? ' · wacht: ' + r.wacht : '') + (r.beperking ? ' · ' + ({ niet_voor: 'niet v\u00f3\u00f3r ', uiterlijk: 'uiterlijk ', vast_op: 'vast op ' }[r.beperking]) + kort(r.beperkingDatum) + (r.beperkingConflict ? ' (klopt niet met de planning)' : '') : '');
          const klik = () => { if (D.openTaak) D.openTaak(r.code, r.id, bal); };
          const bal = r.mijlpaal ? el('button', { type: 'button', klass: 'tl-ruit ' + (r.status === 'klaar' ? 'klaar ' : '') + (r.kritiek ? 'kritiek' : ''), stijl: 'left:' + (x + as.px / 2) + 'px', title: beschr, 'aria-label': beschr, klik })
            : el('button', { type: 'button', klass: 'tl-balk ' + (r.status === 'todo' ? 'open' : r.status) + (r.kritiek ? ' kritiek' : ''), stijl: 'left:' + x + 'px;width:' + Math.max(4, b) + 'px', title: beschr, 'aria-label': beschr, klik });
          rij.appendChild(bal);
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
      el('button', { type: 'button', klass: 'tl-knop', tekst: 'Vandaag', klik: () => { const sc = D.doc.querySelector('#agenda-tijdlijn .tl-scroll'), v = D.doc.querySelector('#agenda-tijdlijn .tl-vandaag'); if (sc && v) sc.scrollLeft = Math.max(0, v.offsetLeft - sc.clientWidth / 2 + (klein() ? LABEL_W_KLEIN : LABEL_W) / 2); } }));
    w0.appendChild(kop);
    if (D.takenKlaar && !D.takenKlaar()) w0.appendChild(el('div', { klass: 'mw-melding', role: 'status', tekst: D.takenStatusTekst() + ' Je ziet alleen wat er al staat.' }));
    const filter = { project: g.project || '', persoon: pf ? pf.persoonSlug('iedereen') : '', status: pf && g.status ? pf.statusTaak(g.status) : '' };
    let m;
    try { m = Tl.model({ taken: D.taken(), afhank: D.afhank(), bestel: D.bestel ? D.bestel() : [], projecten: D.projecten(), team: D.team(), vrij: D.vrij ? D.vrij() : null, vandaag: P.vandaagYmd(), filter, open: S.open, alles: S.alles, kritiek: S.kritiek, verbergKlaar: S.verbergKlaar }); }
    catch (e) { console.warn('Tijdlijn:', e); w0.appendChild(el('div', { klass: 'tl-leeg', tekst: 'De tijdlijn kon niet worden berekend.' })); return; }
    S.laatste = m;
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
    w0.appendChild(el('div', { klass: 'tl-noot', role: 'note', tekst: 'Alleen einde-naar-begin, in werkdagen (met wachttijd). Begin-naar-begin, einde-naar-einde en wachttijd in kalenderdagen bestaan nog niet. Deze tijdlijn is alleen-lezen: wijzig datums in het taakpaneel of in de Capaciteit.' }));
  };

  Tl.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return Tl; };
  Tl.S = S;
  root.MTTijdlijn = Tl;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tl;
})(typeof window !== 'undefined' ? window : globalThis);
