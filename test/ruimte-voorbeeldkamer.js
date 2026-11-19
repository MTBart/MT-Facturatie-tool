// Nagebootste voorbeeldkamer voor tests en de voorbeeld-PDF: de proefkamer van 18-11 (2,90 × 5,77 m, plafond 2445; geen klant- of persoonsgegevens) met de
// drie kozijntypes uit die proef (R1 aftimmering op de wand, R2 nis, R3 nis met aftimmering), een radiator, een vensterbank, een plint, stopcontacten,
// een schakelaar en een leiding. De maten en de plek van R1, R2 en R3 komen uit de proef; radiator, vensterbanken, plint, stopcontacten, schakelaar,
// leiding en de plek van de deur zijn verzonnen.
'use strict';
module.exports = function voorbeeldkamer(D, AR, NU) {
  const e = D.nieuw({ project: { naam: 'Voorbeeld' }, ruimte: { naam: 'Woonkamer (voorbeeld)' } }, NU), s = D.startSessie(e, { toestel: 'test' }, NU);
  s.xr.vloerY = 0; s.xr.plafondY = 2.6;
  D.zetHoeken(e, s.id, [{ x: -2.132, z: -4.454 }, { x: 0.639, z: -5.248 }, { x: 2.247, z: 0.318 }, { x: -0.547, z: 1.104 }]   /* de getikte hoeken van de proef van 18-11, 21:52 */, NU);
  [2902, 5771, 2902, 5774].forEach((v, i) => D.voegMetingToe(e, { doel: { soort: 'wand', id: e.wanden[i].id }, veld: 'lengte', waarde_mm: v, bron: 'disto', sessie: s.id }, NU));
  D.voegMetingToe(e, { doel: { soort: 'ruimte', id: e.ruimte.id }, veld: 'plafondhoogte', waarde_mm: 2445, bron: 'disto', sessie: s.id }, NU);
  const kant = w => { const az = D.wandAanzicht(e, w.id, AR); return { links: az.links.id, rechts: az.rechts.id }; };
  const zet = (det, f, v, ref) => D.voegMetingToe(e, { doel: { soort: 'detail', id: det.id }, veld: f, waarde_mm: v, bron: 'disto', wand_id: det.wand_id, sessie: s.id,
    referentie: D.VELDEN[f].referentie === 'gekozen binnenhoek' ? { soort: 'hoek', id: ref } : null, betekenis: det.soort === 'kozijn' ? D.kozijnLabel(det, f) : D.VELDEN[f].label }, NU);
  const voeg = (soort, w, x) => D.voegDetailToe(e, Object.assign({ soort, wand_id: w.id, sessie: s.id }, x || {}), NU);
  // lange wand W2 (H2–H3): R1 met kader op de wand, 334 vanaf links (12 mm panelen, 5 mm voor de muur, 310 mm tot het kozijn); R2 als kale nis 40 mm vanaf
  // rechts met de onderkant op 750 (bovenkant vensterbank); radiator onder R1, dubbel stopcontact, plint over de hele wand
  const W2 = e.wanden[1], k2 = kant(W2);
  const r1 = voeg('kozijn', W2, { label: 'R1' }); r1.opening = { type: 'aftimmering-op-wand', zijden: ['links', 'rechts', 'boven', 'onder'] };
  r1.raam = { vakken: [{ functie: 'draai naar buiten', scharnier: 'links' }, { functie: 'vast' }, { functie: 'draai naar buiten', scharnier: 'rechts' }] };
  [['afstand_tot_hoek', 334], ['opening_breedte', 2440], ['opening_hoogte', 1082], ['kozijn_onderkant', 945], ['aftimmer_dikte', 12], ['aftimmer_uitsteek', 5], ['diepte_tot_kozijn', 310], ['boven_tot_plafond', 395]]
    .forEach(([f, v]) => zet(r1, f, v, k2.links));
  const r2 = voeg('kozijn', W2, { label: 'R2' }); r2.opening = { type: 'nis', zijden: [] }; r2.raam = { vakken: [{ functie: 'vast' }] }; r2.referentie_hoek = k2.rechts;
  [['afstand_tot_hoek', 40], ['opening_breedte', 535], ['opening_hoogte', 1352], ['kozijn_onderkant', 750], ['diepte_tot_kozijn', 115]].forEach(([f, v]) => zet(r2, f, v, k2.rechts));
  const vb2 = voeg('vensterbank', W2, { label: 'Vensterbank R2' }); [['begin_vanaf_hoek', 20], ['eind_vanaf_hoek', 595], ['hoogte_bovenkant', 750], ['dikte', 20], ['uitsteek_max', 40]].forEach(([f, v]) => zet(vb2, f, v, k2.rechts));
  const rad = voeg('radiator', W2, { variant: 'paneel', opmerking: 'Thermostaatkraan rechts, leiding uit de vloer' });
  [['afstand_tot_hoek', 950], ['breedte', 1200], ['hoogte', 500], ['onderkant', 150], ['uitsteek_max', 110]].forEach(([f, v]) => zet(rad, f, v, k2.links));
  const sc1 = voeg('stopcontact', W2, { variant: 'dubbel' }); [['afstand_hart_tot_hoek', 1400], ['hoogte_hart', 300]].forEach(([f, v]) => zet(sc1, f, v, k2.rechts));
  const pl = voeg('plint', W2); [['begin_vanaf_hoek', 0], ['eind_vanaf_hoek', 5771], ['hoogte', 70], ['uitsteek_max', 12]].forEach(([f, v]) => zet(pl, f, v, k2.links));
  // korte wand W3 (H3–H4): R3 als nis met aftimmering erin (links, rechts, boven), 780 vanaf rechts, onderkant op 930 (bovenkant vensterbank), draai-kiep
  const W3 = e.wanden[2], k3 = kant(W3);
  const r3 = voeg('kozijn', W3, { label: 'R3', opmerking: 'Gordijnrails op de aftimmering, niet in het plafond' }); r3.opening = { type: 'nis-met-aftimmering', zijden: ['links', 'rechts', 'boven'] };
  r3.raam = { vakken: [{ functie: 'draai-kiep naar binnen', scharnier: 'rechts' }] }; r3.referentie_hoek = k3.rechts;
  [['afstand_tot_hoek', 780], ['opening_breedte', 1218], ['opening_hoogte', 1200], ['kozijn_onderkant', 930], ['nis_diepte_tot_aftimmering', 120], ['diepte_tot_kozijn', 80], ['aftimmer_dikte', 18]].forEach(([f, v]) => zet(r3, f, v, k3.rechts));
  const vb = voeg('vensterbank', W3, { label: 'Vensterbank R3' }); [['begin_vanaf_hoek', 760], ['eind_vanaf_hoek', 2018], ['hoogte_bovenkant', 930], ['dikte', 22], ['uitsteek_max', 60]].forEach(([f, v]) => zet(vb, f, v, k3.rechts));
  const sch = voeg('schakelaar', W3, { variant: 'enkel' }); [['afstand_hart_tot_hoek', 250], ['hoogte_hart', 1050]].forEach(([f, v]) => zet(sch, f, v, k3.rechts));
  // lange wand W4 (H4–H1): de deur en een cv-leiding
  const W4 = e.wanden[3], k4 = kant(W4);
  const deur = voeg('deur', W4, { variant: 'binnen-links' }); [['afstand_tot_hoek', 1850], ['breedte', 880], ['hoogte', 2115]].forEach(([f, v]) => zet(deur, f, v, k4.links));
  const lei = voeg('leiding', W4, { label: 'CV-leiding', variant: 'cv' }); [['afstand_hart_tot_hoek', 180], ['hoogte_hart', 60], ['uitsteek_max', 45], ['buitendiameter', 22]].forEach(([f, v]) => zet(lei, f, v, k4.rechts));
  // korte wand W1 (H1–H2): alleen een stopcontact
  const W1 = e.wanden[0], k1 = kant(W1);
  const sc2 = voeg('stopcontact', W1, { variant: 'enkel' }); [['afstand_hart_tot_hoek', 300], ['hoogte_hart', 300]].forEach(([f, v]) => zet(sc2, f, v, k1.links));
  return { dossier: e, sessie: s, details: { r1, r2, r3, rad, vb, vb2, sc1, pl, sch, lei, deur, sc2 } };
};
