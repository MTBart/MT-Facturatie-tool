// Test van mt-ruimte-dossier.js: het dossier van de ruimtelijke opname (hoeken, wanden, details, maten, beelden, pakket).
// Draaien: node test/ruimte-dossier.test.js — alleen verzonnen kamers en de proefkamer van 17-11 (geen klant- of persoonsgegevens).
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../mt-ruimte-dossier.js');
const X = require('../mt-opname-export.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'opname-ar-proef.html'), 'utf8');
const mod = { exports: {} };
new Function('module', html.split('/*KERN-BEGIN*/')[1].split('/*KERN-EINDE*/')[0])(mod);
const AR = mod.exports;

let goed = 0, fout = 0;
function check(naam, ok, extra) { if (ok) goed++; else fout++; console.log((ok ? 'ok  - ' : 'FOUT - ') + naam + (extra ? '  ' + extra : '')); }
let teller = 0; D.zetIdMaker(p => p + '_' + (++teller));
const NU = Date.UTC(2026, 10, 18, 10, 0, 0);
const jpg = n => Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, n & 255, (n >> 8) & 255, 0xFF, 0xD9]);

(async function () {
  // ── invoer ──
  check('leesMaat: 2,345 is meters', D.leesMaat('2,345').mm === 2345);
  check('leesMaat: 2345 is mm', D.leesMaat('2345').mm === 2345 && D.leesMaat('2345').eenheid === 'mm');
  check('leesMaat: 2.345 m', D.leesMaat('2.345 m').mm === 2345);
  check('leesMaat: 12 mm (klein mag)', D.leesMaat('12').mm === 12);
  check('leesMaat: 15cm', D.leesMaat('15cm').mm === 150);
  check('leesMaat: onzin geeft null', D.leesMaat('abc') === null && D.leesMaat('') === null);
  check('X4-reeks herkend', D.isDistoReeks([0, 40, 80, 120], 160, 4));
  check('mens op schermtoetsenbord geen X4', !D.isDistoReeks([0, 300, 700, 1000], 1300, 4));

  // ── nieuw dossier, hoeken met stabiele ID's ──
  const d = D.nieuw({ project: { code: 'TEST-001', naam: 'Proefkamer' }, ruimte: { naam: 'Woonkamer' } }, NU);
  check('schema en versie', d.schema === 'mt-ruimte-dossier' && d.versie === '0.1.0' && d.ruimte.eenheid === 'mm');
  const s1 = D.startSessie(d, { toestel: 'test' }, NU);
  check('eerste sessie is de basis', s1.uitlijning.status === 'basis');
  const P = '0.141;-1.344 0.163;-0.736 0.778;-0.391 0.912;-0.413 1.129;2.933 -1.533;3.330 -1.725;-1.217'.split(' ').map(t => { const [a, b] = t.split(';').map(Number); return { x: a, z: b }; });
  const L = [600, 655, 155, 3427, 2454, 4371, 1792];
  D.zetHoeken(d, s1.id, P, NU); s1.xr.vloerY = -1.4; s1.xr.plafondY = 1.2;
  const ids = d.hoeken.map(h => h.id), wids = d.wanden.map(w => w.id);
  check('7 hoeken en 7 wanden met eigen id', ids.length === 7 && new Set(ids).size === 7 && wids.length === 7 && d.wanden[6].naar === ids[0]);
  D.zetHoeken(d, s1.id, P.map(p => ({ x: p.x + 0.01, z: p.z })), NU);
  check('opnieuw zetten houdt de ids; de ruwe stand staat in het archief', d.hoeken.every((h, i) => h.id === ids[i]) && d.archief.length === 1 && d.archief[0].hoeken[0].xr.x === P[0].x);
  D.zetHoeken(d, s1.id, P, NU);

  // ── lijnmodel zonder maten: geschat ──
  let lm = D.lijnmodel(d, AR);
  check('lijnmodel zonder maten is geschat', lm.status === 'geschat' && lm.segmenten.every(s => s.lengte.status === 'geschat'));
  check('oorsprong in een hoek op 0,0,0', lm.punten.some(p => p.x === 0 && p.y === 0 && p.z === 0));
  const oppR = lm.punten.reduce((s, p, i) => { const q = lm.punten[(i + 1) % lm.punten.length]; return s + p.x * q.y - q.x * p.y; }, 0);
  const o = lm.punten.find(p => p.label === lm.x_as.van), xn = lm.punten.find(p => p.label === lm.x_as.naar);
  check('de kamer ligt aan de +Y-kant van de X-as (rechtsdraaiend, ook bij een holle vorm)', o.x === 0 && o.y === 0 && Math.abs(xn.y) < 0.5 && xn.x > 0 && (lm.x_as.van === 'H1' ? oppR > 0 : oppR < 0), lm.x_as.van + '→' + lm.x_as.naar);
  check('korte wand van 155 mm apart gehouden', lm.segmenten[2].kort === true && lm.segmenten.filter(s => s.kort).length <= 2);
  check('schuine wand W2 benoemd', lm.schuin.length === 1 && lm.schuin[0] === wids[1]);
  check('plafond uit de camera geschat', lm.hoogte.status === 'geschat' && lm.hoogte.waarde === 2600);

  // ── wandmaten: X4 en hand; een correctie vervangt, de vorige blijft ──
  d.wanden.forEach((w, i) => D.voegMetingToe(d, { doel: { soort: 'wand', id: w.id }, veld: 'lengte', waarde_mm: L[i] + (i === 3 ? 100 : 0), invoer: String(L[i]), bron: i % 2 ? 'disto' : 'hand' }, NU));
  const fout3 = D.huidigeMeting(d, wids[3], 'lengte');
  const corr = D.voegMetingToe(d, { doel: { soort: 'wand', id: wids[3] }, veld: 'lengte', waarde_mm: L[3], invoer: '3,427', eenheid_invoer: 'm', bron: 'disto' }, NU);
  check('correctie verwijst naar de vorige meting', corr.vervangt === fout3.id && D.huidigeMeting(d, wids[3], 'lengte').id === corr.id && D.historie(d, wids[3], 'lengte').length === 2);
  check('oorspronkelijke invoer bewaard', corr.invoer === '3,427' && corr.eenheid_invoer === 'm');
  lm = D.lijnmodel(d, AR);
  check('met alle maten: afgeleid, sluitfout ~42,3 mm zichtbaar', lm.status === 'afgeleid' && Math.abs(lm.sluitfout_mm - 42.3) < 1, String(lm.sluitfout_mm));
  check('gemeten lengte met bron en meting-id in het segment', lm.segmenten[3].lengte.status === 'gemeten' && lm.segmenten[3].lengte.meting_id === corr.id && lm.segmenten[3].lengte.bron === 'disto');

  // ── zevenhoek bij alle starthoeken en beide richtingen, via het dossier ──
  let allesGelijk = true;
  for (const stap of [1, -1]) for (let start = 0; start < 7; start++) {
    const volg = P.map((_, i) => (start + stap * i + 7) % 7), wandVan = volg.map((h, i) => stap === 1 ? h : volg[(i + 1) % 7]);
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, volg.map(h => P[h]), NU);
    e.wanden.forEach((w, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: w.id }, veld: 'lengte', waarde_mm: L[wandVan[i]], bron: 'hand' }, NU));
    const m = D.lijnmodel(e, AR), schuinIdx = e.wanden.findIndex(w => w.id === m.schuin[0]);
    if (!(m.schuin.length === 1 && wandVan[schuinIdx] === 1 && Math.abs(m.sluitfout_mm - 42.3) < 1)) allesGelijk = false;
  }
  check('alle 14 starts: dezelfde wand schuin en ~42,3 mm sluitfout', allesGelijk);

  // ── controlemaat H4–H6 naast de verwachte waarde ──
  D.voegMetingToe(d, { doel: { soort: 'diagonaal', id: d.ruimte.id, extra: { van: ids[3], naar: ids[5] } }, veld: 'diagonaal', waarde_mm: 5000, invoer: '5000', bron: 'disto' }, NU);
  const cm = D.controleMaten(d, lm);
  check('controlemaat H4-H6 met verwachte waarde en verschil', cm.length === 1 && cm[0].van === 'H4' && cm[0].naar === 'H6' && cm[0].verwacht > 0 && cm[0].verschil === Math.round((5000 - cm[0].verwacht) * 10) / 10, JSON.stringify(cm[0]));

  // ── detail: cv-leiding onder een raam, één X4-maat, één handmaat, één open maat ──
  const foto = D.voegBeeldToe(d, { soort: 'detail', sessie: s1.id, pose: { pos: [0, 0, 0], dir: [0, 0, -1], pv: new Array(16).fill(0) }, breedte: 1280, hoogte: 960, bewaard: true }, NU);
  const leiding = D.voegDetailToe(d, { soort: 'leiding', label: 'CV-leiding onder raam', wand_id: wids[4], anker: { xr: { x: 0.5, y: -1.1, z: 3.0 }, wand_id: wids[4], u_m: 0.8, v_m: 0.3 }, foto_ids: [foto.id], referentie_hoek: ids[4], sessie: s1.id }, NU);
  foto.detail_id = leiding.id;
  D.voegMetingToe(d, { doel: { soort: 'detail', id: leiding.id }, veld: 'hoogte_hart', waarde_mm: 312, invoer: '312', bron: 'disto', sessie: s1.id }, NU);
  D.voegMetingToe(d, { doel: { soort: 'detail', id: leiding.id }, veld: 'afstand_hart_tot_hoek', waarde_mm: 845, invoer: '84,5 cm', bron: 'hand', referentie: { soort: 'hoek', id: ids[4], label: 'H5' } }, NU);
  D.voegMetingToe(d, { doel: { soort: 'detail', id: leiding.id }, veld: 'uitsteek_max', waarde_mm: null, bron: null }, NU);
  const mv = D.metingenVan(d, leiding.id);
  check('detail heeft drie metingen: X4, hand en open', mv.length === 3 && mv.some(m => m.bron === 'disto' && m.status === 'gemeten') && mv.some(m => m.bron === 'hand') && mv.some(m => m.status === 'open'));
  const plek = D.detailPlek(d, leiding, lm);
  check('plek van de leiding volgt de gemeten maten', plek && plek.z === 312 && plek.status.langs_wand === 'gemeten' && plek.status.hoogte === 'gemeten');
  const ov = D.openVragen(d, AR);
  {
    const pw = D.openPerWand(d, ov), totaal = Object.keys(pw.wanden).reduce((t, k) => t + pw.wanden[k].length, 0) + pw.kamer.length;
    check('open vragen per wand: elke vraag staat precies één keer, bij een wand of bij de kamer', totaal === ov.length && Object.keys(pw.wanden).length === d.wanden.length &&
      ov.filter(v => d.wanden.some(w => w.id === v.doel)).every(v => pw.wanden[v.doel].indexOf(v) >= 0) && pw.kamer.every(v => !d.wanden.some(w => w.id === v.doel)));
  }
  check('open vragen noemen de open uitsteekmaat en de diameter van de leiding', ov.some(v => v.doel === leiding.id && v.veld === 'uitsteek_max') && ov.some(v => v.doel === leiding.id && v.veld === 'buitendiameter'));
  check('open vragen noemen de korte wand', ov.some(v => v.doel === wids[2] && /kort/.test(v.tekst)));
  D.voegOpmerkingToe(d, { tekst: 'Nieuwe vloer komt 12 mm hoger', locatie: { soort: 'ruimte', id: d.ruimte.id }, bron: 'opnemer', sessie: s1.id }, NU);
  check('opmerking met datum, bron en locatie; de bestaande toestand blijft', d.opmerkingen[0].tijd && d.opmerkingen[0].bron === 'opnemer' && d.opmerkingen[0].toestand === 'toekomstig' && d.opmerkingen[0].locatie.id === d.ruimte.id);

  // ── correctie aan de wand houdt detail en maten aan elkaar ──
  D.zetHoeken(d, s1.id, P.map(p => ({ x: p.x, z: p.z + 0.02 })), NU);
  check('na correctie van de omtrek: zelfde wand-id en het detail wijst er nog naar', d.wanden[4].id === wids[4] && leiding.wand_id === wids[4] && D.metingenVan(d, leiding.id).length === 3);

  // ── hoekfoto's koppelen en een hoek corrigeren vanuit de foto ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU);
    const f1 = D.voegBeeldToe(e, { soort: 'hoek', sessie: s.id, hoek_index: 1, punt_xr: { x: 4, y: 0, z: 0 }, punt_in_beeld: { x: 0.5, y: 0.6 }, bewaard: true }, NU);
    const f2 = D.voegBeeldToe(e, { soort: 'plafondhoek', sessie: s.id, hoek_index: 1, bewaard: true }, NU);
    const f3 = D.voegBeeldToe(e, { soort: 'hoek', sessie: s.id, hoek_index: 3, vervallen: true, bewaard: true }, NU); f3.vervallen = true;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 4.03, z: 0.02 }, { x: 4, z: 3 }, { x: 0, z: 3 }], NU); D.koppelHoekfotos(e);
    const h2 = e.hoeken[1];
    check('hoekfoto en plafondfoto aan H2 gekoppeld; een vervallen tik niet', h2.foto_ids.length === 2 && f1.hoek_id === h2.id && f2.hoek_id === h2.id && !f3.hoek_id && f1.punt_in_beeld.y === 0.6);
    D.corrigeerHoek(e, h2.id, { x: 4, z: 0 }, { bron: 'foto', beeld_id: f1.id, punt: { x: 0.48, y: 0.61 } }, NU);
    check('correctie: nieuwe plek, ruwe tik bewaard, verschuiving in mm', h2.status === 'gecorrigeerd' && h2.xr.x === 4 && h2.xr_ruw.x === 4.03 && h2.correctie.verschuiving_mm === 36 && e.archief.some(a => a.soort === 'hoek-correctie'));
    D.herstelHoek(e, h2.id, NU);
    check('correctie terugzetten geeft de getikte plek terug', h2.xr.x === 4.03 && !h2.correctie && h2.status === 'geschat');
  }

  // ── proef 18-11 21:14: een sluittik die 0,9 m naast H1 landde gaf een vijfde hoek (spie van ~2°); waarschuwen en weghalen ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    const P5 = '-1.214;-2.928 1.380;-3.107 1.844;2.254 -1.758;1.379 -1.329;-3.847'.split(' ').map(t => { const [a, b] = t.split(';').map(Number); return { x: a, z: b }; });
    D.zetHoeken(e, s.id, P5, NU);
    const det = D.voegDetailToe(e, { soort: 'stopcontact', wand_id: e.wanden[4].id, anker: { xr: { x: -1.3, y: 0.3, z: -3.5 }, wand_id: e.wanden[4].id, u_m: 0.4, v_m: 0.3 } }, NU);
    const ov = D.openVragen(e, AR), h5 = e.hoeken[4].id;
    check('21:14: spie-hoek H5 gemeld', ov.some(v => v.doel === h5 && /scherp/.test(v.tekst)), ov.filter(v => v.soort === 'vorm').map(v => v.tekst).join(' | '));
    const w4 = e.wanden[3].id, w5 = e.wanden[4].id;
    D.verwijderHoek(e, h5, 'dubbele sluittik', NU);
    check('hoek weghalen: 4 hoeken, W4 loopt nu van H4 naar H1, labels opnieuw', e.hoeken.length === 4 && e.wanden.length === 4 && e.wanden[3].id === w4 && e.wanden[3].naar === e.hoeken[0].id && e.hoeken[3].label === 'H4' && e.archief.some(a => a.soort === 'hoek-weggehaald'));
    check('hoek weghalen: lengte van de samengevoegde wand weer open, detail verhuisd zonder plek langs de wand', D.huidigeMeting(e, w4, 'lengte').status === 'open' && det.wand_id === w4 && det.anker.u_m === null && !e.wanden.some(w => w.id === w5));
    check('hoek weghalen: geen spie meer', !D.openVragen(e, AR).some(v => /scherp/.test(v.tekst)));
  }

  // ── review 18-11 (GPT): een opgeslagen maat houdt haar eigen referentie ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 2 }, { x: 0, z: 2 }], NU);
    [3000, 2000, 3000, 2000].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    const A = e.hoeken[0].id, B = e.hoeken[1].id, wand = e.wanden[0];
    const sc = D.voegDetailToe(e, { soort: 'stopcontact', wand_id: wand.id, referentie_hoek: A, anker: { xr: { x: 0.9, y: 0.3, z: 0 }, wand_id: wand.id, u_m: 0.9, v_m: 0.3 } }, NU);
    D.voegMetingToe(e, { doel: { soort: 'detail', id: sc.id }, veld: 'afstand_hart_tot_hoek', waarde_mm: 800, invoer: '800', bron: 'disto', wand_id: wand.id, referentie: { soort: 'hoek', id: A, label: 'H1' } }, NU);
    const lm = D.lijnmodel(e, AR), afst = p => Math.round(Math.hypot(p.x - lm.punten[0].x, p.y - lm.punten[0].y));
    check('review: 800 mm vanaf A ligt op 800 van A', afst(D.detailPlek(e, sc, lm)) === 800);
    sc.referentie_hoek = B;   // alleen de keuzelijst
    check('review: alleen de keuzelijst wisselen laat de plek op 800 van A', afst(D.detailPlek(e, sc, lm)) === 800 && D.historie(e, sc.id, 'afstand_hart_tot_hoek').length === 1);
    D.voegMetingToe(e, { doel: { soort: 'detail', id: sc.id }, veld: 'afstand_hart_tot_hoek', waarde_mm: 800, invoer: '800', bron: 'disto', wand_id: wand.id, referentie: { soort: 'hoek', id: B, label: 'H2' } }, NU);
    const pl = D.detailPlek(e, sc, lm), hist = D.historie(e, sc.id, 'afstand_hart_tot_hoek');
    check('review: bewust 800 vanaf B meten geeft een nieuwe meting en 2200 van A; de vorige referentie blijft in de historie', afst(pl) === 2200 && pl.vanaf_hoek === B && hist.length === 2 && hist[0].referentie.id === A && hist[1].vervangt === hist[0].id);
    const zonder = D.voegDetailToe(e, { soort: 'stopcontact', wand_id: wand.id, anker: { xr: { x: 1, y: 0.3, z: 0 }, wand_id: wand.id, u_m: 1, v_m: 0.3 } }, NU);
    D.voegMetingToe(e, { doel: { soort: 'detail', id: zonder.id }, veld: 'afstand_hart_tot_hoek', waarde_mm: 1000, bron: 'hand' }, NU);
    check('review: maat zonder referentie geeft een onzekere plek', D.detailPlek(e, zonder, lm).status.langs_wand === 'onzeker');
    sc.wand_id = e.wanden[1].id;
    check('review: na een wandwissel is de plek onzeker (maat hoort bij een hoek van een andere wand)', D.detailPlek(e, sc, lm).status.langs_wand === 'onzeker');
    const sk = D.nieuw({}, NU), ss = D.startSessie(sk, {}, NU); ss.xr.vloerY = 0;
    D.zetHoeken(sk, ss.id, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 2 }, { x: 0, z: 2 }], NU);
    [3000, 2000, 3000, 2100].forEach((v, i) => D.voegMetingToe(sk, { doel: { soort: 'wand', id: sk.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    const lk = D.lijnmodel(sk, AR);
    check('lijnmodel: modellengte en verschil met het gemeten label staan per wand', lk.segmenten.every(x => typeof x.lengte_model_mm === 'number') && lk.segmenten.some(x => x.verschil_model_mm !== 0), lk.segmenten.map(x => x.lengte.waarde + '/' + x.lengte_model_mm).join(' '));
  }

  // ── haaksheid met een driehoeksmeting i.p.v. een diagonaal (feedback 18-11: laser komt niet strak in de hoek) ──
  {
    check('driehoek 1000/1000/1414,2 = 90°', Math.abs(D.hoekUitDriehoek(1000, 1000, 1414.2) - 90) < 0.01);
    check('driehoek 1000/1000/1400 ≈ 88,85°', Math.abs(D.hoekUitDriehoek(1000, 1000, 1400) - 88.85) < 0.02);
    check('onmogelijke driehoek wordt geweigerd', D.hoekUitDriehoek(1000, 1000, 2100) === null && D.hoekUitDriehoek(0, 1000, 1000) === null);
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 2 }, { x: 0, z: 2 }], NU);
    const m = D.voegDriehoekToe(e, e.hoeken[1].id, 1000, 1000, 1400, { bron: 'disto' }, NU);
    const ch = D.controleHoeken(e, D.lijnmodel(e, AR));
    check('driehoeksmeting naast de hoek in het model, met gevoeligheid per mm', m.waarde_graden === 88.85 && ch.length === 1 && ch[0].model_graden === 90 && Math.abs(ch[0].verschil_graden + 1.15) < 0.01 && m.graden_per_mm > 0.05 && m.graden_per_mm < 0.1, JSON.stringify(ch[0]));
    check('niet-haakse hoek staat bij de open vragen, zonder het woord diagonaal', D.openVragen(e, AR).some(v => v.doel === e.hoeken[1].id && /driehoeksmeting/.test(v.tekst)) && !D.openVragen(e, AR).some(v => /diagonaal/.test(v.tekst)));
  }

  // ── controlemaat tussen twee merktekens op de wanden (optie 2, Bart 18-11) ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 2 }, { x: 0, z: 2 }], NU);
    [3000, 2000, 3000, 2000].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    const H = e.hoeken.map(h => h.id), W = e.wanden.map(w => w.id);
    D.voegControleToe(e, { wand_id: W[0], vanaf: H[0], afstand_mm: 1000 }, { wand_id: W[2], vanaf: H[3], afstand_mm: 1000 }, 2004, { bron: 'disto' }, NU);
    D.voegControleToe(e, { wand_id: W[0], vanaf: H[0], afstand_mm: 500 }, { wand_id: W[1], vanaf: H[1], afstand_mm: 500 }, 2549, { bron: 'disto' }, NU);
    const cm = D.controleMaten(e, D.lijnmodel(e, AR)).filter(c => c.soort === 'wandpunten');
    check('controlemaat tape-tot-tape tegenover elkaar: verwacht 2000, gemeten 2004', cm[0].verwacht === 2000 && cm[0].verschil === 4 && /W1 \(1000 van H1\)/.test(cm[0].van) && /W3 \(1000 van H4\)/.test(cm[0].naar), JSON.stringify(cm[0]));
    check('controlemaat tape-tot-tape om de hoek: verwacht 2550', cm[1].verwacht === 2550 && cm[1].verschil === -1, JSON.stringify(cm[1]));
    D.voegControleToe(e, { wand_id: W[0], vanaf: H[0], afstand_mm: 1000 }, { wand_id: W[2], vanaf: H[3], afstand_mm: 1000 }, 2050, { bron: 'hand' }, NU);
    check('controlemaat die 50 mm afwijkt staat bij de open vragen', D.openVragen(e, AR).some(v => /Controlemaat W1/.test(v.tekst) && /50 mm/.test(v.tekst)));
  }

  // ── wandaanzicht: kozijn bematen in een lijntekening ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0; s.xr.plafondY = 2.6;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], NU);
    [4000, 3000, 4000, 3000].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    D.voegMetingToe(e, { doel: { soort: 'ruimte', id: e.ruimte.id }, veld: 'plafondhoogte', waarde_mm: 2600, bron: 'disto' }, NU);
    const w = e.wanden[2], leeg = D.wandAanzicht(e, w.id, AR);
    check('wandaanzicht: lengte, hoogte en de hoeken links en rechts', leeg.L === 4000 && leeg.H === 2600 && leeg.status.L === 'gemeten' && leeg.links.label && leeg.rechts.label && leeg.links.id !== leeg.rechts.id && leeg.items.length === 0);
    const k = D.voegDetailToe(e, { soort: 'kozijn', wand_id: w.id, referentie_hoek: leeg.links.id }, NU);
    let a = D.wandAanzicht(e, w.id, AR).items[0];
    check('nieuw kozijn zonder maten: in het midden met standaardmaat, maten open (te tikken)', a.rect.w === 1000 && a.rect.x === 1500 && a.status.x === 'open' && a.status.w === 'open' && a.velden.x === 'afstand_tot_hoek' && a.velden.w === 'kozijn_breedte');
    const zet = (f, v) => D.voegMetingToe(e, { doel: { soort: 'detail', id: k.id }, veld: f, waarde_mm: v, bron: 'disto', wand_id: w.id, referentie: f === 'afstand_tot_hoek' ? { soort: 'hoek', id: leeg.links.id } : null }, NU);
    zet('afstand_tot_hoek', 700); zet('kozijn_breedte', 1500); zet('kozijn_hoogte', 1400); zet('kozijn_onderkant', 900);
    a = D.wandAanzicht(e, w.id, AR).items[0];
    check('kozijn bemeten vanaf links: x 700, 1500 × 1400 op 900', a.rect.x === 700 && a.rect.w === 1500 && a.rect.h === 1400 && a.rect.y === 900 && a.status.x === 'gemeten');
    const kh = D.maatketen(4000, 'gemeten', [{ waarde: 700, status: 'gemeten' }, { waarde: 1500, status: 'gemeten' }]), kv = D.maatketen(2600, 'gemeten', [{ waarde: 900, status: 'gemeten' }, { waarde: 1400, status: 'gemeten' }]);
    check('maatketen: restmaat rechts 1800 en bovenkant tot plafond 300, beide afgeleid', kh[2].waarde === 1800 && kh[2].status === 'afgeleid' && kv[2].waarde === 300 && kv[2].status === 'afgeleid');
    check('maatketen met een afgeleid deel (bijv. buitenmaat uit binnenwerks + paneeldikte): rest is afgeleid', D.maatketen(4000, 'gemeten', [{ waarde: 1200, status: 'gemeten' }, { waarde: 2464, status: 'afgeleid' }])[2].status === 'afgeleid');
    check('maatketen met een geschat deel: rest is geschat', D.maatketen(4000, 'gemeten', [{ waarde: 700, status: 'geschat' }])[1].status === 'geschat');
    const v2 = D.wandAanzicht(e, w.id, AR, { [k.id]: { kozijn_breedte: 1600 } }).items[0];
    check('voorlopige invoer (live-voorbeeld) zonder op te slaan', v2.rect.w === 1600 && v2.status.w === 'invoer' && D.huidigeMeting(e, k.id, 'kozijn_breedte').waarde_mm === 1500);
    check('kozijn: optionele dagmaat en bovenkant-plafond geven geen open vraag', !D.openVragen(e, AR).some(q => q.doel === k.id));
    D.voegMetingToe(e, { doel: { soort: 'detail', id: k.id }, veld: 'afstand_tot_hoek', waarde_mm: 700, bron: 'hand', wand_id: w.id, referentie: { soort: 'hoek', id: leeg.rechts.id } }, NU);
    a = D.wandAanzicht(e, w.id, AR).items[0];
    check('700 vanaf de rechterhoek: kozijn eindigt 700 van rechts', a.rect.x === 4000 - 700 - 1500 && !a.vanLinks);
  }

  // ── kozijn als opening met opbouw (Bart 18-11: R1 aftimmering op de wand, R2 nis, R3 nis met aftimmering erin) ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 3 }, { x: 0, z: 3 }], NU);
    [5000, 3000, 5000, 3000].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    D.voegMetingToe(e, { doel: { soort: 'ruimte', id: e.ruimte.id }, veld: 'plafondhoogte', waarde_mm: 2600, bron: 'disto' }, NU);
    const w = e.wanden[0], az0 = D.wandAanzicht(e, w.id, AR), links = az0.links.id;
    const r1 = D.voegDetailToe(e, { soort: 'kozijn', label: 'R1', wand_id: w.id, referentie_hoek: links }, NU);
    r1.opening = { type: 'aftimmering-op-wand', zijden: ['links', 'rechts', 'boven', 'onder'] };
    r1.raam = { vakken: [{ functie: 'draai naar buiten' }, { functie: 'vast' }, { functie: 'draai naar buiten' }] };
    const zet = (det, f, v) => D.voegMetingToe(e, { doel: { soort: 'detail', id: det.id }, veld: f, waarde_mm: v, bron: 'hand', wand_id: w.id, referentie: f === 'afstand_tot_hoek' ? { soort: 'hoek', id: links } : null }, NU);
    zet(r1, 'afstand_tot_hoek', 1200); zet(r1, 'opening_breedte', 2440); zet(r1, 'opening_hoogte', 1084); zet(r1, 'kozijn_onderkant', 1000);
    check('R1: nog open zijn dikte, uitsteek en diepte tot kozijn', ['aftimmer_dikte', 'aftimmer_uitsteek', 'diepte_tot_kozijn'].every(f => D.openVragen(e, AR).some(q => q.doel === r1.id && q.veld === f)) && !D.openVragen(e, AR).some(q => q.doel === r1.id && q.veld === 'boven_tot_plafond'));
    zet(r1, 'aftimmer_dikte', 12); zet(r1, 'aftimmer_uitsteek', 5); zet(r1, 'diepte_tot_kozijn', 310);
    const a = D.wandAanzicht(e, w.id, AR).items.find(x => x.det.id === r1.id);
    check('R1: buitenmaat 2464 × 1108 (binnenwerks + 2 × 12 mm), binnen 2440 × 1084 op 12 mm', a.rect.w === 2464 && a.rect.h === 1108 && a.status.w === 'afgeleid' && a.opening.binnen.w === 2440 && a.opening.binnen.x === 1212 && a.opening.binnen.y === 1012, JSON.stringify(a.rect));
    check('R1: opbouw en vakken mee in het aanzicht', a.opening.uitsteek.waarde === 5 && a.opening.kozijn_diepte.waarde === 310 && a.raam.vakken.length === 3 && !D.openVragen(e, AR).some(q => q.doel === r1.id));
    check('R1: labels volgen de soort opening', D.kozijnLabel(r1, 'opening_breedte') === 'Binnenwerks aftimmering, breedte' && /voorkant aftimmering tot kozijn/.test(D.kozijnLabel(r1, 'diepte_tot_kozijn')));
    const r2 = D.voegDetailToe(e, { soort: 'kozijn', label: 'R2', wand_id: w.id, referentie_hoek: links }, NU); r2.opening = { type: 'nis', zijden: [] }; r2.raam = { vakken: [{ functie: 'vast' }] };
    zet(r2, 'opening_breedte', 535); zet(r2, 'opening_hoogte', 1352);
    const a2 = D.wandAanzicht(e, w.id, AR).items.find(x => x.det.id === r2.id);
    check('R2: nis 535 × 1352 is ook de buitenmaat op de wand (geen aftimmering)', a2.rect.w === 535 && a2.rect.h === 1352 && a2.status.w === 'gemeten' && D.kozijnLabel(r2, 'diepte_tot_kozijn') === 'Diepte: wand tot kozijn');
    const r3 = D.voegDetailToe(e, { soort: 'kozijn', label: 'R3', wand_id: w.id, referentie_hoek: links }, NU); r3.opening = { type: 'nis-met-aftimmering', zijden: ['links', 'rechts', 'boven'] }; r3.raam = { vakken: [{ functie: 'draai-kiep naar binnen' }] };
    zet(r3, 'opening_breedte', 1218); zet(r3, 'opening_hoogte', 1200); zet(r3, 'nis_diepte_tot_aftimmering', 120); zet(r3, 'diepte_tot_kozijn', 80);
    const a3 = D.wandAanzicht(e, w.id, AR).items.find(x => x.det.id === r3.id);
    check('R3: nismaat 1218 × 1200 op de wand, aftimmering in de nis (120 + 80 tot kozijn)', a3.rect.w === 1218 && a3.opening.nis_diepte.waarde === 120 && a3.opening.kozijn_diepte.waarde === 80 && a3.raam.vakken[0].functie === 'draai-kiep naar binnen');
  }

  // ── wandaanzicht: elk onderdeel (vensterbank, plint, stopcontact, balk, knik), maatketen langs de wand en zonder AR-kern (kantoor) ──
  {
    const e = D.nieuw({}, NU), s = D.startSessie(e, {}, NU); s.xr.vloerY = 0;
    D.zetHoeken(e, s.id, [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 3 }, { x: 0, z: 3 }], NU);
    [5000, 3000, 5000, 3000].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'hand' }, NU));
    D.voegMetingToe(e, { doel: { soort: 'ruimte', id: e.ruimte.id }, veld: 'plafondhoogte', waarde_mm: 2600, bron: 'disto' }, NU);
    const w = e.wanden[0], az0 = D.wandAanzicht(e, w.id, AR), links = az0.links.id, rechts = az0.rechts.id;
    const zet = (det, f, v, ref) => D.voegMetingToe(e, { doel: { soort: 'detail', id: det.id }, veld: f, waarde_mm: v, bron: 'hand', wand_id: w.id, referentie: D.VELDEN[f].referentie === 'gekozen binnenhoek' ? { soort: 'hoek', id: ref || links } : null }, NU);
    const k = D.voegDetailToe(e, { soort: 'kozijn', label: 'R1', wand_id: w.id }, NU);
    zet(k, 'afstand_tot_hoek', 1000); zet(k, 'kozijn_breedte', 1500); zet(k, 'kozijn_hoogte', 1200); zet(k, 'kozijn_onderkant', 900);
    const vb = D.voegDetailToe(e, { soort: 'vensterbank', wand_id: w.id }, NU);
    zet(vb, 'begin_vanaf_hoek', 950); zet(vb, 'eind_vanaf_hoek', 2550); zet(vb, 'hoogte_bovenkant', 920); zet(vb, 'dikte', 20);
    const pl = D.voegDetailToe(e, { soort: 'plint', wand_id: w.id }, NU);
    zet(pl, 'begin_vanaf_hoek', 0, rechts); zet(pl, 'eind_vanaf_hoek', 1500, rechts);
    const sc = D.voegDetailToe(e, { soort: 'stopcontact', wand_id: w.id, opmerking: 'dubbel, randaarde' }, NU);
    zet(sc, 'afstand_hart_tot_hoek', 400, rechts); zet(sc, 'hoogte_hart', 300);
    const bk = D.voegDetailToe(e, { soort: 'balk', wand_id: w.id }, NU); zet(bk, 'afstand_tot_hoek', 200); zet(bk, 'breedte', 150); zet(bk, 'onderkant', 2400);
    const kn = D.voegDetailToe(e, { soort: 'knik', wand_id: w.id }, NU); zet(kn, 'afstand_tot_hoek', 3000);
    const az = D.wandAanzicht(e, w.id, AR), it = id => az.items.find(x => x.det.id === id);
    const v = it(vb.id), p = it(pl.id), c = it(sc.id), b = it(bk.id), n = it(kn.id);
    check('vensterbank: van 950 tot 2550, bovenkant 920, 20 dik (onderkant 900 afgeleid)', v.vorm === 'traject' && v.rect.x === 950 && v.rect.w === 1600 && v.rect.y === 900 && v.rect.h === 20 && v.status.w === 'afgeleid' && v.status.y === 'afgeleid' && v.extraV[0].waarde === 920, JSON.stringify(v.rect));
    check('plint vanaf de rechterhoek: x 3500 tot 5000, standaard 70 hoog (hoogte nog open)', p.rect.x === 3500 && p.rect.w === 1500 && p.rect.h === 70 && p.status.h === 'open' && !p.vanLinks);
    check('stopcontact 400 van rechts op 300, met opmerking', c.vorm === 'punt' && c.punt.x === 4600 && c.punt.y === 300 && c.opmerking === 'dubbel, randaarde');
    check('balk: van de onderkant 2400 tot het plafond (200 hoog, afgeleid)', b.rect.y === 2400 && b.rect.h === 200 && b.status.h === 'afgeleid');
    check('knik: verticale lijn op 3000', n.vorm === 'lijn' && n.lijn.x === 3000 && n.lijn.status === 'gemeten');
    const keten = D.wandKeten(az), som = keten.reduce((t, x) => t + x.waarde, 0);
    check('maatketen langs de wand telt op tot 5000', Math.abs(som - 5000) < 0.01 && keten[0].van === 0 && keten[keten.length - 1].tot === 5000, keten.map(x => x.waarde).join(' + '));
    check('maatketen: 200 tot de balk, de 1500 van R1 en 400 rechts van het stopcontact zijn gemeten', keten.some(x => x.van === 0 && x.tot === 200 && x.status === 'gemeten') && keten.some(x => x.van === 1000 && x.tot === 2500 && x.status === 'gemeten') && keten.some(x => x.van === 4600 && x.tot === 5000 && x.status === 'gemeten'));
    check('maatketen: tussenstukken tussen harde punten zijn afgeleid', keten.some(x => x.van === 2550 && x.tot === 3000 && x.status === 'afgeleid'));
    // kantoor: zelfde aanzicht uit het lijnmodel in het pakket, zonder AR-kern
    const lmJ = JSON.parse(JSON.stringify(D.lijnmodel(e, AR))), azK = D.wandAanzicht(e, w.id, lmJ);
    check('wandaanzicht zonder AR-kern (uit het lijnmodel) geeft hetzelfde', azK.links.id === az.links.id && azK.items.length === az.items.length && JSON.stringify(azK.items.map(x => x.rect || x.punt || x.lijn)) === JSON.stringify(az.items.map(x => x.rect || x.punt || x.lijn)));
    // links/rechts uit het lijnmodel == links/rechts uit de AR-kern, voor beide looprichtingen en alle wanden
    const gelijk = [[{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 3 }, { x: 0, z: 3 }], [{ x: 0, z: 0 }, { x: 0, z: 3 }, { x: 5, z: 3 }, { x: 5, z: 0 }], [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 4 }, { x: 0, z: 4 }]].every(pt => {
      const e2 = D.nieuw({}, NU), s2 = D.startSessie(e2, {}, NU); s2.xr.vloerY = 0; D.zetHoeken(e2, s2.id, pt, NU);
      const lm2 = D.lijnmodel(e2, AR), W3 = AR.wanden3d(e2.hoeken.map(h => ({ x: h.xr.x, z: h.xr.z })), true, 0, 2.6);
      return e2.wanden.every((w2, i) => AR.aLinks(W3.find(x => x.nr === i)) === D.vanLinks(lm2));
    });
    check('links/rechts uit het lijnmodel klopt met de AR-kern (beide looprichtingen, L-vormige kamer)', gelijk);
    check('wandsoorten: geen meubel of losse opmerking op de wand', D.WANDSOORTEN.indexOf('meubel') < 0 && D.WANDSOORTEN.every(x => D.SOORTEN[x]));
    check('sierlijst: hoogte bovenkant is optioneel', (() => { const sl = D.voegDetailToe(e, { soort: 'sierlijst', wand_id: w.id }, NU); zet(sl, 'begin_vanaf_hoek', 0); zet(sl, 'eind_vanaf_hoek', 5000); zet(sl, 'hoogte', 80); zet(sl, 'uitsteek_max', 40); const r = !D.openVragen(e, AR).some(q => q.doel === sl.id); const a = D.wandAanzicht(e, w.id, AR).items.find(x => x.det.id === sl.id); return r && a.rect.y === 2520 && a.rect.h === 80; })());
  }

  // ── pakket heen en terug ──
  const bestanden = {}; bestanden[foto.pad] = jpg(1);
  const ov1 = D.voegBeeldToe(d, { soort: 'overzicht', sessie: s1.id, pose: { pos: [0, 0, 0], dir: [0, 0, -1], pv: new Array(16).fill(0) }, bewaard: true }, NU);
  bestanden[ov1.pad] = jpg(2); bestanden['panorama/W1.jpg'] = jpg(3);
  const pk = await D.maakPakket(d, bestanden, { AR, nu: NU });
  const terug = await D.leesPakket(pk.bytes);
  check('pakket opent weer zonder meldingen', !terug.fout && terug.meldingen.length === 0, terug.fout || terug.meldingen.join('; '));
  const t = terug.dossier;
  check('ID\'s en waarden gelijk na de zip', t.ruimte.id === d.ruimte.id && t.details[0].id === leiding.id && t.metingen.length === d.metingen.length && D.huidigeMeting(t, leiding.id, 'hoogte_hart').waarde_mm === 312);
  check('relatieve paden en sha256 in het dossier', t.beelden.every(b => !/^\//.test(b.pad) && b.sha256 && b.sha256.length === 64) && terug.bestanden[foto.pad].length === 8);
  check('lijnmodel staat leesbaar in het pakket', t.afgeleid.lijnmodel && t.afgeleid.lijnmodel.punten.length === 7 && !t.afgeleid.lijnmodel._t && t.afgeleid.detail_plekken[0].plek.z === 312);
  check('open vragen in het pakket', t.afgeleid.open_vragen.some(v => v.veld === 'uitsteek_max'));
  check('panorama mee in het pakket', t.afgeleid.panorama[0] === 'panorama/W1.jpg' && terug.bestanden['panorama/W1.jpg']);
  // beschadigd beeld en ontbrekend beeld
  const items = await X.leesZip(pk.bytes), kapot = items.map(x => x.naam === foto.pad ? { naam: x.naam, data: jpg(99) } : x);
  const r2 = await D.leesPakket(X.zipBytes(kapot));
  check('beschadigd beeld wordt gemeld', r2.meldingen.some(m => /beschadigd/.test(m)));
  const r3 = await D.leesPakket(X.zipBytes(items.filter(x => x.naam !== ov1.pad)));
  check('ontbrekend beeld wordt gemeld', r3.meldingen.some(m => /ontbreekt/.test(m)));
  const r4 = await D.leesPakket(X.zipBytes([{ naam: 'opname.json', data: new TextEncoder().encode('{}') }]));
  check('ander zip-bestand wordt geweigerd', !!r4.fout);
  const half = await D.maakPakket(d, {}, { nu: NU });
  check('beeld zonder bestand staat als ontbrekend in het pakket', half.ontbreekt.length === 2 && half.dossier.afgeleid.ontbrekende_beelden.length === 2);

  // ── oud panoramabestand van de AR-proef blijft openen ──
  const png = 'data:image/jpeg;base64,' + Buffer.from(jpg(5)).toString('base64');
  const oud = { soort: 'mt-ar-panorama', versie: 1, tijd: 'test', vloerY: 0, hoogte: 2.5, plafondBekend: true, punten: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 2 }, { x: 0, z: 2 }],
    wanden: [{ nr: 0, L: 3, beeld: png }], beelden: [{ pos: [1, 1.5, 1], dir: [0, 0, -1], pv: new Array(16).fill(0), beeld: png }] };
  const mig = D.uitPanorama(oud, NU);
  check('oud panorama wordt een dossier met hoeken, beeld en wandtextuur', mig.dossier.hoeken.length === 4 && mig.dossier.beelden.length === 1 && mig.bestanden['panorama/W1.jpg'].length === 8 && mig.bestanden[mig.dossier.beelden[0].pad].length === 8);

  // ── een tweede sessie uitlijnen op twee bekende hoeken ──
  const A = { x: 1, z: 2 }, B = { x: 4, z: 2 }, hoek = 0.7, c = Math.cos(hoek), sn = Math.sin(hoek);
  const naarNieuw = p => ({ x: c * p.x - sn * p.z + 0.3, z: sn * p.x + c * p.z - 1.1 });
  const ul = D.lijnUit(A, B, naarNieuw(A), naarNieuw(B), 0, 0.05);
  const q = D.pasToe(ul.transform, Object.assign(naarNieuw({ x: 2.5, z: 3.3 }), { y: 1.0 }));
  check('uitlijnen: een punt uit de nieuwe sessie valt op zijn plek in de basis', ul.goed && Math.abs(q.x - 2.5) < 1e-9 && Math.abs(q.z - 3.3) < 1e-9 && Math.abs(q.y + 0.05 - 1.0) < 1e-9 + 0.1);
  const slecht = D.lijnUit(A, B, naarNieuw(A), naarNieuw({ x: 4.2, z: 2 }), 0, 0);
  check('uitlijnen met een verkeerde hoek wordt geweigerd', !slecht.goed && slecht.rest_m > 0.15);
  // de camerastand gaat mee: hetzelfde punt projecteert gelijk
  const pvNieuw = [1.2, 0.1, 0, 0.05, 0, 1.5, 0.02, 0.1, 0.3, 0.2, -1, -1, 0.5, -0.4, -0.2, 2];
  const pNieuw = { x: 0.7, y: 0.4, z: -2.1 }, pBasis = D.pasToe(ul.transform, pNieuw), pvB = D.pvNaarBasis(ul.transform, pvNieuw);
  const a1 = AR.projecteer(pvNieuw, pNieuw.x, pNieuw.y, pNieuw.z), a2 = AR.projecteer(pvB, pBasis.x, pBasis.y, pBasis.z);
  check('camerastand mee omgerekend: projectie blijft gelijk', a1 && a2 && Math.abs(a1.x - a2.x) < 1e-9 && Math.abs(a1.y - a2.y) < 1e-9);
  const s2 = D.startSessie(d, {}, NU);
  check('tweede sessie blijft apart tot ze is uitgelijnd', s2.uitlijning.status === 'niet-uitgelijnd');

  // ── proef 5: fictieve kamer met raam, cv-leiding met bocht, onderbroken plint, losse stoel en houtafwerking ──
  const k = D.nieuw({ project: { code: 'TEST-002', naam: 'Fictief' }, ruimte: { naam: 'Studeerkamer' } }, NU), ks = D.startSessie(k, {}, NU); ks.xr.vloerY = 0;
  D.zetHoeken(k, ks.id, [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], NU);
  [4000, 3000, 4000, 3000].forEach((v, i) => D.voegMetingToe(k, { doel: { soort: 'wand', id: k.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'disto' }, NU));
  const raam = D.voegDetailToe(k, { soort: 'raam', wand_id: k.wanden[2].id, referentie_hoek: k.hoeken[2].id, anker: { xr: { x: 2, y: 1.4, z: 3 }, wand_id: k.wanden[2].id, u_m: 1.4, v_m: 0.9 } }, NU);
  [['afstand_tot_hoek', 700], ['breedte', 1500], ['hoogte', 1400], ['borstwering', 900]].forEach(([f, v]) => D.voegMetingToe(k, { doel: { soort: 'detail', id: raam.id }, veld: f, waarde_mm: v, bron: 'disto', referentie: f === 'afstand_tot_hoek' ? { soort: 'hoek', id: k.hoeken[2].id, label: 'H3' } : null }, NU));
  const cv = D.voegDetailToe(k, { soort: 'leiding', label: 'CV-leiding met bocht', wand_id: k.wanden[2].id, anker: { xr: { x: 2.5, y: 0.25, z: 2.95 }, wand_id: k.wanden[2].id, u_m: 1.5, v_m: 0.25 },
    traject: { punten_mm: [{ x: 1200, y: 2950, z: 250 }, { x: 2800, y: 2950, z: 250 }, { x: 2800, y: 2950, z: 0 }], zichtbaar_tot: 'vloer bij het eindpunt', status: 'geschat' } }, NU);
  D.voegMetingToe(k, { doel: { soort: 'detail', id: cv.id }, veld: 'hoogte_hart', waarde_mm: 250, bron: 'hand' }, NU);
  D.voegMetingToe(k, { doel: { soort: 'detail', id: cv.id }, veld: 'buitendiameter', waarde_mm: 22, bron: 'hand' }, NU);
  const plint1 = D.voegDetailToe(k, { soort: 'plint', wand_id: k.wanden[0].id, profiel_id: 'prof_plint_A', traject: { begin_mm: 0, eind_mm: 900 } }, NU);
  const plint2 = D.voegDetailToe(k, { soort: 'plint', wand_id: k.wanden[0].id, profiel_id: 'prof_plint_A', traject: { begin_mm: 1800, eind_mm: 4000 } }, NU);
  const stoel = D.voegDetailToe(k, { soort: 'meubel', label: 'Stoel', anker: { xr: { x: 1.5, y: 0, z: 1.5 } }, meubel: { categorie: 'stoel', draairichting_graden: 30 } }, NU);
  ['breedte', 'diepte', 'hoogte'].forEach((f, i) => D.voegMetingToe(k, { doel: { soort: 'detail', id: stoel.id }, veld: f, waarde_mm: [450, 500, 850][i], bron: 'ar', status: 'geschat' }, NU));
  const schaal = D.voegBeeldToe(k, { soort: 'detail', sessie: ks.id, bewaard: true }, NU);
  const hout = D.voegDetailToe(k, { soort: 'afwerking', label: 'Eiken vloer', foto_ids: [schaal.id],
    materiaal: { vlak: 'vloer', type: 'hout', kleur: 'licht eiken', glans: 'mat', nerfrichting: 'evenwijdig aan W1', schaal: { methode: 'plankbreedte', waarde_mm: 180, foto_id: schaal.id }, code: null, status: 'visuele benadering' } }, NU);
  const kb = {}; kb[schaal.pad] = jpg(7);
  const kp = await D.maakPakket(k, kb, { AR, nu: NU }), kt = (await D.leesPakket(kp.bytes)).dossier;
  const g = D.perGroep(kt), lmK = kt.afgeleid.lijnmodel, raamPlek = kt.afgeleid.detail_plekken.find(x => x.detail_id === raam.id).plek;
  check('proef 5: groepen afzonderlijk op te vragen', g.bouwdeel.length === 1 && g.installatie.length === 1 && g.afwerking.length === 2 && g.meubilair.length === 1 && g.materiaal.length === 1);
  check('proef 5: raam zonder foto uit te lezen (wand, hoek, maten, bron)', raamPlek.status.langs_wand === 'gemeten' && raamPlek.z === 900 && D.metingenVan(kt, raam.id).every(m => m.bron === 'disto' && m.status === 'gemeten'));
  check('proef 5: raam staat 700 mm uit de gekozen hoek', (() => { const w = lmK.punten[2], p = raamPlek; return Math.abs(Math.hypot(p.x - w.x, p.y - w.y) - 700) < 1; })());
  check('proef 5: leiding met bocht als 3D-traject met hart en diameter', kt.details.find(x => x.id === cv.id).traject.punten_mm.length === 3 && D.huidigeMeting(kt, cv.id, 'buitendiameter').waarde_mm === 22);
  check('proef 5: onderbroken plint = twee stukken met hetzelfde profiel-ID', g.afwerking.every(x => x.profiel_id === 'prof_plint_A') && g.afwerking[0].traject.eind_mm < g.afwerking[1].traject.begin_mm);
  check('proef 5: stoel is geschat', D.metingenVan(kt, stoel.id).every(m => m.status === 'geschat') && kt.details.find(x => x.id === stoel.id).meubel.draairichting_graden === 30);
  check('proef 5: houtvlak met nerf, schaalfoto en onbekende code', (() => { const m = kt.details.find(x => x.id === hout.id).materiaal; return m.nerfrichting && m.schaal.foto_id === schaal.id && m.code === null && m.status === 'visuele benadering'; })());
  check('proef 5: onbekende materiaalcode staat bij de open vragen', kt.afgeleid.open_vragen.some(v => v.doel === hout.id && v.soort === 'materiaal'));
  check('proef 5: kamer 4 x 3 sluit precies', lmK.sluitfout_mm === 0 && lmK.status === 'afgeleid');

  // ── het vaste proefpakket (gemaakt met test/ruimte-e2e.js uit de echte invoerroute; nagebootste kamer, geen echte beelden) blijft openen ──
  const vast = await D.leesPakket(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'ruimte-proefpakket.zip'))));
  check('proefpakket opent zonder meldingen', !vast.fout && vast.meldingen.length === 0, vast.fout || vast.meldingen.join('; '));
  const vd = vast.dossier, vl = vd && vd.details.find(x => x.soort === 'leiding' && x.foto_ids.length);
  check('proefpakket: leiding met X4-hoogte, handmaat en open uitsteek', vl && D.huidigeMeting(vd, vl.id, 'hoogte_hart').bron === 'disto' && D.huidigeMeting(vd, vl.id, 'afstand_hart_tot_hoek').bron === 'hand' && !D.huidigeMeting(vd, vl.id, 'uitsteek_max'));
  check('proefpakket: detailfoto aanwezig en lijnmodel gemeten', vl && vast.bestanden[vd.beelden.find(b => b.id === vl.foto_ids[0]).pad] && vd.afgeleid.lijnmodel.status === 'afgeleid');

  console.log('\n' + goed + ' tests geslaagd' + (fout ? ', ' + fout + ' MISLUKT' : ''));
  if (fout) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
