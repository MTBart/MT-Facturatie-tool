// mt-ruimte-dossier.js — het dossier van een ruimtelijke opname (rondgang met de camera, detailfoto's en maten op hun plek).
// Eén leesbaar, versieerbaar JSON-bestand (dossier.json) plus de beelden als losse bestanden in één zip, met relatieve verwijzingen: het pakket opent ook offline op een
// andere pc. Pure functies zonder DOM of netwerk; node kan ze testen. De zip zelf komt uit mt-opname-export.js (zelfde schrijver en lezer als de bestaande opname-export).
//
// Uitgangspunten (werkpakket 18-11-2026, START-HIER.md):
// - Stabiele ID's voor project, ruimte, sessie, hoek, wand, beeld, detail, meting en opmerking. Relaties lopen via die ID's, nooit via een volgorde.
// - Een maat wordt nooit overschreven: een nieuwe meting komt erbij en verwijst met `vervangt` naar de vorige. De oorspronkelijke invoer (tekst) blijft bewaard.
// - Per waarde is zichtbaar of hij gemeten, geschat (camera), afgeleid (uit andere maten berekend) of onbekend is. Een camera-schatting is nooit een maat.
// - Het beeld en het maatmodel zijn onafhankelijk: beelden hebben een camerastand in de AR-ruimte van hun sessie; het lijnmodel komt uit hoeken plus maten.
// - Ruimte-assen: oorsprong in een binnenhoek op de afgewerkte vloer (Z = 0), X langs de eerste wand, Y de kamer in, Z omhoog, alles in mm (rechtsdraaiend).
(function (root) {
  'use strict';
  const D = root.MTRuimteDossier = root.MTRuimteDossier || {};
  const req = typeof require !== 'undefined' ? require : null;
  const E = () => root.MTOpnameExport || (req ? req('./mt-opname-export.js') : null);
  D.SCHEMA = 'mt-ruimte-dossier';
  D.VERSIE = '0.1.0';
  const lijst = x => Array.isArray(x) ? x : [];
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
  const isoNu = nu => new Date(nu == null ? Date.now() : nu).toISOString();
  const rond = (v, d) => { const f = Math.pow(10, d || 0); return Math.round(v * f) / f; };

  // ── ID's ── prefix + tijd + toeval; in tests vast te zetten met D.zetIdMaker.
  let idMaker = prefix => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  D.nieuwId = prefix => idMaker(prefix);
  D.zetIdMaker = f => { idMaker = f; };

  // ── woorden: groepen, soorten en meetvelden ──
  D.GROEPEN = {
    bouwdeel: 'Ruimte en bouwdelen', installatie: 'Vaste installaties', afwerking: 'Afwerking en profielen',
    meubilair: 'Los meubilair en styling', materiaal: 'Kleur en textuur', notitie: 'Opmerking'
  };
  // Elk veld: wat gemeten wordt, vanaf welke referentie en wat de maat betekent. `vorm`: afstand (twee punten), punt-vlak (hart of hoogte tot een vlak), traject (begin en eind).
  D.VELDEN = {
    lengte: { label: 'Wandlengte', grootheid: 'lengte', vorm: 'afstand', referentie: 'hoek tot hoek, afgewerkte binnenzijde', betekenis: 'binnenwerks' },
    plafondhoogte: { label: 'Plafondhoogte', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'onderkant plafond' },
    diagonaal: { label: 'Diagonaal', grootheid: 'lengte', vorm: 'afstand', referentie: 'hoek tot hoek', betekenis: 'controlemaat' },
    afstand_tot_hoek: { label: 'Afstand vanaf de hoek', grootheid: 'afstand', vorm: 'afstand', referentie: 'gekozen binnenhoek', betekenis: 'tot eerste dagkant of zijkant' },
    afstand_hart_tot_hoek: { label: 'Hart vanaf de hoek', grootheid: 'afstand', vorm: 'punt-vlak', referentie: 'gekozen binnenhoek', betekenis: 'hart' },
    hoogte_hart: { label: 'Hoogte hart', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'hart' },
    breedte: { label: 'Breedte', grootheid: 'breedte', vorm: 'afstand', referentie: 'zijkant tot zijkant', betekenis: 'dagmaat' },
    breedte_onder: { label: 'Vrije breedte onder', grootheid: 'breedte', vorm: 'afstand', referentie: 'zijkant tot zijkant', betekenis: 'vrije maat', meethoogte: true },
    breedte_midden: { label: 'Vrije breedte midden', grootheid: 'breedte', vorm: 'afstand', referentie: 'zijkant tot zijkant', betekenis: 'vrije maat', meethoogte: true },
    breedte_boven: { label: 'Vrije breedte boven', grootheid: 'breedte', vorm: 'afstand', referentie: 'zijkant tot zijkant', betekenis: 'vrije maat', meethoogte: true },
    hoogte: { label: 'Hoogte', grootheid: 'hoogte', vorm: 'afstand', referentie: 'onderkant tot bovenkant', betekenis: 'dagmaat' },
    onderkant: { label: 'Onderkant boven vloer', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'onderkant' },
    borstwering: { label: 'Borstwering', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'onderkant dagmaat' },
    diepte: { label: 'Diepte', grootheid: 'diepte', vorm: 'punt-vlak', referentie: 'afgewerkt wandvlak', betekenis: 'diepte' },
    uitsteek_max: { label: 'Uitsteek (max.)', grootheid: 'uitsteek', vorm: 'punt-vlak', referentie: 'afgewerkt wandvlak', betekenis: 'buitenkant' },
    buitendiameter: { label: 'Buitendiameter', grootheid: 'diameter', vorm: 'afstand', referentie: 'buitenkant tot buitenkant', betekenis: 'inclusief isolatie' },
    begin_vanaf_hoek: { label: 'Begin vanaf de hoek', grootheid: 'afstand', vorm: 'traject', referentie: 'gekozen binnenhoek', betekenis: 'begin' },
    eind_vanaf_hoek: { label: 'Eind vanaf de hoek', grootheid: 'afstand', vorm: 'traject', referentie: 'gekozen binnenhoek', betekenis: 'eind' },
    hoogte_bovenkant: { label: 'Hoogte bovenkant', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'bovenkant' },
    dikte: { label: 'Dikte', grootheid: 'dikte', vorm: 'afstand', referentie: 'voorkant tot achterkant', betekenis: 'dikte' },
    peilverschil: { label: 'Peilverschil', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'huidige afgewerkte vloer', betekenis: 'toekomstig peil' },
    kozijn_breedte: { label: 'Kozijn breedte (buitenmaat)', grootheid: 'breedte', vorm: 'afstand', referentie: 'buitenkant kozijn tot buitenkant', betekenis: 'kozijnmaat' },
    kozijn_hoogte: { label: 'Kozijn hoogte (buitenmaat)', grootheid: 'hoogte', vorm: 'afstand', referentie: 'onderkant kozijn tot bovenkant', betekenis: 'kozijnmaat' },
    kozijn_onderkant: { label: 'Onderkant kozijn boven vloer', grootheid: 'hoogte', vorm: 'punt-vlak', referentie: 'afgewerkte vloer', betekenis: 'onderkant kozijn' },
    dag_breedte: { label: 'Dagmaat breedte', grootheid: 'breedte', vorm: 'afstand', referentie: 'binnenkant tot binnenkant', betekenis: 'dagmaat' },
    dag_hoogte: { label: 'Dagmaat hoogte', grootheid: 'hoogte', vorm: 'afstand', referentie: 'binnenkant tot binnenkant', betekenis: 'dagmaat' },
    boven_tot_plafond: { label: 'Bovenkant opening tot plafond', grootheid: 'hoogte', vorm: 'afstand', referentie: 'bovenkant opening (buitenkant aftimmering of nis) tot plafond', betekenis: 'vrije hoogte' },
    opening_breedte: { label: 'Opening breedte (binnenwerks)', grootheid: 'breedte', vorm: 'afstand', referentie: 'binnenkant tot binnenkant', betekenis: 'binnenwerks aftimmering of nismaat' },
    opening_hoogte: { label: 'Opening hoogte (binnenwerks)', grootheid: 'hoogte', vorm: 'afstand', referentie: 'binnenkant tot binnenkant', betekenis: 'binnenwerks aftimmering of nismaat' },
    aftimmer_dikte: { label: 'Dikte aftimmering (paneel)', grootheid: 'dikte', vorm: 'afstand', referentie: 'voorkant tot achterkant paneel', betekenis: 'plaatdikte' },
    aftimmer_uitsteek: { label: 'Aftimmering steekt uit de muur', grootheid: 'uitsteek', vorm: 'punt-vlak', referentie: 'afgewerkt wandvlak', betekenis: 'voorkant aftimmering' },
    nis_diepte_tot_aftimmering: { label: 'Diepte: wand tot aftimmering', grootheid: 'diepte', vorm: 'punt-vlak', referentie: 'afgewerkt wandvlak', betekenis: 'voorkant aftimmering in de nis' },
    diepte_tot_kozijn: { label: 'Diepte tot het kozijn', grootheid: 'diepte', vorm: 'punt-vlak', referentie: 'zie betekenis (wandvlak, voorkant aftimmering of aftimmering)', betekenis: 'tot kozijn' }
  };
  // ── kozijn: soort opening, opbouw de wand in en de vakken van het raam ── (Bart 18-11: R1 aftimmering op de wand, R2 nis, R3 nis met aftimmering erin)
  D.OPENING_TYPES = {
    'aftimmering-op-wand': { label: 'Aftimmering op de wand (kader rondom)', zijden: ['links', 'rechts', 'boven', 'onder'] },
    'nis': { label: 'Nis zonder aftimmering', zijden: [] },
    'nis-met-aftimmering': { label: 'Nis met aftimmering erin', zijden: ['links', 'rechts', 'boven'] }
  };
  D.RAAM_FUNCTIES = ['vast', 'draai naar binnen', 'draai naar buiten', 'draai-kiep naar binnen', 'klep naar binnen', 'klep naar buiten', 'schuif'];
  // Welke maten een kozijn vraagt, afhankelijk van de soort opening; en hoe ze heten (zodat de betekenis bij de meting klopt).
  D.kozijnVelden = function (det) {
    const t = det.opening && det.opening.type;
    if (!t) return { verplicht: ['afstand_tot_hoek', 'kozijn_breedte', 'kozijn_hoogte', 'kozijn_onderkant'], optioneel: ['dag_breedte', 'dag_hoogte', 'boven_tot_plafond'] };   // oud kozijn (B32)
    const basis = ['afstand_tot_hoek', 'opening_breedte', 'opening_hoogte', 'kozijn_onderkant'];
    // B36 (proef 18-11): de buitenmaat van het kozijn zelf wordt niet meer gevraagd; die volgt uit binnenwerks + paneeldikte. Minder velden, minder dubbel werk.
    if (t === 'aftimmering-op-wand') return { verplicht: basis.concat(['aftimmer_dikte', 'aftimmer_uitsteek', 'diepte_tot_kozijn']), optioneel: ['boven_tot_plafond'] };
    if (t === 'nis-met-aftimmering') return { verplicht: basis.concat(['nis_diepte_tot_aftimmering', 'diepte_tot_kozijn']), optioneel: ['aftimmer_dikte', 'boven_tot_plafond'] };
    return { verplicht: basis.concat(['diepte_tot_kozijn']), optioneel: ['boven_tot_plafond'] };
  };
  D.kozijnLabel = function (det, f) {
    const t = det.opening && det.opening.type, aft = t === 'aftimmering-op-wand', wat = aft ? 'de aftimmering' : 'de nis';
    const L = {
      afstand_tot_hoek: 'Vanaf de hoek tot ' + wat + ' (buitenkant)',
      opening_breedte: aft ? 'Binnenwerks aftimmering, breedte' : 'Nismaat breedte', opening_hoogte: aft ? 'Binnenwerks aftimmering, hoogte' : 'Nismaat hoogte',
      kozijn_onderkant: 'Onderkant ' + (aft ? 'aftimmering' : 'nis') + ' boven de vloer',
      boven_tot_plafond: 'Bovenkant ' + (aft ? 'aftimmering' : 'nis') + ' tot plafond',
      diepte_tot_kozijn: aft ? 'Diepte: voorkant aftimmering tot kozijn' : t === 'nis-met-aftimmering' ? 'Diepte: aftimmering tot kozijn' : 'Diepte: wand tot kozijn',
      kozijn_breedte: 'Kozijn zelf, breedte (buitenmaat)', kozijn_hoogte: 'Kozijn zelf, hoogte (buitenmaat)'
    };
    return t ? (L[f] || (D.VELDEN[f] || {}).label) : (D.VELDEN[f] || {}).label;
  };
  // Varianten per soort (B37, 18-11): na het invoegen kies je in de werktekening wat het precies is. `plaat` = afdekplaat in mm (b × h) zodat een
  // stopcontact of schakelaar op schaal in het aanzicht staat (inbouw, raster 71 mm: enkel 81 × 81, elk extra vak + 71 mm). De variant is een eigenschap
  // van het onderdeel (det.variant), geen maat: wisselen verandert geen meting.
  D.VARIANTEN = {
    stopcontact: [{ id: 'enkel', label: 'Enkel', kort: '1×', plaat: [81, 81] }, { id: 'dubbel', label: 'Dubbel', kort: '2×', plaat: [152, 81] }, { id: 'drievoudig', label: 'Drievoudig', kort: '3×', plaat: [223, 81] },
      { id: 'viervoudig', label: 'Viervoudig', kort: '4×', plaat: [294, 81] }, { id: 'dubbel-staand', label: 'Dubbel staand', kort: '2× staand', plaat: [81, 152] }, { id: 'kracht', label: 'Krachtstroom / perilex', kort: 'kracht', plaat: [100, 100] },
      { id: 'data', label: 'Data / tv', kort: 'data', plaat: [81, 81] }],
    schakelaar: [{ id: 'enkel', label: 'Enkel', kort: '1×', plaat: [81, 81] }, { id: 'dubbel', label: 'Dubbel (serie)', kort: '2×', plaat: [81, 81] }, { id: 'dimmer', label: 'Dimmer', kort: 'dimmer', plaat: [81, 81] },
      { id: 'thermostaat', label: 'Thermostaat', kort: 'thermostaat', plaat: [85, 120] }, { id: 'combinatie', label: 'Combinatie met stopcontact', kort: 'combi', plaat: [152, 81] }],
    radiator: [{ id: 'paneel', label: 'Paneelradiator', kort: 'paneel' }, { id: 'leden', label: 'Ledenradiator', kort: 'leden' }, { id: 'convector', label: 'Convector', kort: 'convector' }, { id: 'design', label: 'Designradiator', kort: 'design' }],
    deur: [{ id: 'binnen-links', label: 'Draait de kamer in, scharnier links', kort: '↙ L' }, { id: 'binnen-rechts', label: 'Draait de kamer in, scharnier rechts', kort: '↘ R' },
      { id: 'buiten-links', label: 'Draait de kamer uit, scharnier links', kort: '↖ L' }, { id: 'buiten-rechts', label: 'Draait de kamer uit, scharnier rechts', kort: '↗ R' }, { id: 'schuif', label: 'Schuifdeur', kort: 'schuif' }, { id: 'open', label: 'Open doorgang', kort: 'open' }],
    leiding: [{ id: 'cv', label: 'CV', kort: 'cv' }, { id: 'water', label: 'Water', kort: 'water' }, { id: 'gas', label: 'Gas', kort: 'gas' }, { id: 'afvoer', label: 'Afvoer', kort: 'afvoer' }, { id: 'elektra', label: 'Elektra (buis of goot)', kort: 'elektra' }]
  };
  D.variantVan = det => (D.VARIANTEN[det.soort] || []).find(v => v.id === det.variant) || null;
  // Scharnierkant van een draaiend vak van een raam (vanuit de kamer gezien). Niet ingevuld: het linker vak scharniert links, het rechter rechts.
  D.scharnierVan = (vak, i, n) => vak.scharnier || (n > 1 && i === n - 1 ? 'rechts' : 'links');
  // Korte naam van een veld voor de knoppen onder de tekening (de volledige naam staat in de invoerbalk).
  D.VELD_KORT = { afstand_tot_hoek: 'Vanaf hoek', afstand_hart_tot_hoek: 'Hart vanaf hoek', begin_vanaf_hoek: 'Begin', eind_vanaf_hoek: 'Eind', hoogte_hart: 'Hoogte hart', breedte: 'Breedte', hoogte: 'Hoogte',
    onderkant: 'Onderkant', borstwering: 'Borstwering', diepte: 'Diepte', uitsteek_max: 'Uitsteek', buitendiameter: 'Diameter', hoogte_bovenkant: 'Bovenkant', dikte: 'Dikte', breedte_onder: 'Breedte onder',
    breedte_midden: 'Breedte midden', breedte_boven: 'Breedte boven', kozijn_breedte: 'Kozijn breed', kozijn_hoogte: 'Kozijn hoog', kozijn_onderkant: 'Onderkant', dag_breedte: 'Dag breed', dag_hoogte: 'Dag hoog',
    boven_tot_plafond: 'Tot plafond', opening_breedte: 'Breedte', opening_hoogte: 'Hoogte', aftimmer_dikte: 'Paneeldikte', aftimmer_uitsteek: 'Voor de muur', nis_diepte_tot_aftimmering: 'Tot aftimmering',
    diepte_tot_kozijn: 'Tot kozijn', peilverschil: 'Peilverschil' };
  D.SOORTEN = {
    raam: { groep: 'bouwdeel', label: 'Raam', velden: ['afstand_tot_hoek', 'breedte', 'hoogte', 'borstwering'] },
    kozijn: { groep: 'bouwdeel', label: 'Kozijn', velden: ['afstand_tot_hoek', 'kozijn_breedte', 'kozijn_hoogte', 'kozijn_onderkant', 'dag_breedte', 'dag_hoogte', 'boven_tot_plafond'],
      optioneel: ['dag_breedte', 'dag_hoogte', 'boven_tot_plafond'] },
    deur: { groep: 'bouwdeel', label: 'Deur', velden: ['afstand_tot_hoek', 'breedte', 'hoogte'] },
    nis: { groep: 'bouwdeel', label: 'Nis', velden: ['afstand_tot_hoek', 'breedte_onder', 'breedte_midden', 'breedte_boven', 'diepte', 'hoogte'] },
    kolom: { groep: 'bouwdeel', label: 'Kolom', velden: ['afstand_tot_hoek', 'breedte', 'diepte'] },
    balk: { groep: 'bouwdeel', label: 'Balk', velden: ['afstand_tot_hoek', 'breedte', 'onderkant'] },
    knik: { groep: 'bouwdeel', label: 'Knik of afwijking in de wand', velden: ['afstand_tot_hoek', 'diepte'] },
    leiding: { groep: 'installatie', label: 'Leiding', velden: ['afstand_hart_tot_hoek', 'hoogte_hart', 'uitsteek_max', 'buitendiameter'] },
    radiator: { groep: 'installatie', label: 'Radiator', velden: ['afstand_tot_hoek', 'breedte', 'hoogte', 'onderkant', 'uitsteek_max'] },
    stopcontact: { groep: 'installatie', label: 'Stopcontact', velden: ['afstand_hart_tot_hoek', 'hoogte_hart'] },
    schakelaar: { groep: 'installatie', label: 'Schakelaar', velden: ['afstand_hart_tot_hoek', 'hoogte_hart'] },
    plint: { groep: 'afwerking', label: 'Plint', velden: ['begin_vanaf_hoek', 'eind_vanaf_hoek', 'hoogte', 'uitsteek_max'] },
    vensterbank: { groep: 'afwerking', label: 'Vensterbank', velden: ['begin_vanaf_hoek', 'eind_vanaf_hoek', 'hoogte_bovenkant', 'uitsteek_max', 'dikte'] },
    sierlijst: { groep: 'afwerking', label: 'Sierlijst', velden: ['begin_vanaf_hoek', 'eind_vanaf_hoek', 'hoogte', 'uitsteek_max', 'hoogte_bovenkant'], optioneel: ['hoogte_bovenkant'] },
    meubel: { groep: 'meubilair', label: 'Los meubel', velden: ['breedte', 'diepte', 'hoogte'] },
    afwerking: { groep: 'materiaal', label: 'Afwerking van een vlak', velden: [] },
    opmerking: { groep: 'notitie', label: 'Opmerking', velden: ['peilverschil'] },
    overig: { groep: 'bouwdeel', label: 'Anders', velden: ['afstand_tot_hoek', 'hoogte_hart'] }
  };
  D.BRONNEN = { disto: 'DISTO X4', hand: 'Handmaat', ar: 'Camera (schatting)', afgeleid: 'Afgeleid' };
  D.STATUS = { gemeten: 'Gemeten', geschat: 'Geschat', afgeleid: 'Afgeleid', open: 'Open', onbekend: 'Onbekend' };

  // ── invoer van een maat ── "2,345" en "2.345 m" zijn meters, "2345" en "2345 mm" millimeters, "12" is 12 mm (een plint- of peilmaat mag klein zijn).
  D.leesMaat = function (tekst) {
    let s = String(tekst == null ? '' : tekst).trim().toLowerCase().replace(/\s+/g, ''), eenheid = null;
    if (/mm$/.test(s)) { eenheid = 'mm'; s = s.slice(0, -2); } else if (/cm$/.test(s)) { eenheid = 'cm'; s = s.slice(0, -2); } else if (/m$/.test(s)) { eenheid = 'm'; s = s.slice(0, -1); }
    s = s.replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    let v = parseFloat(s);
    if (eenheid === 'm' || (eenheid === null && s.indexOf('.') >= 0 && Math.abs(v) < 100)) { v *= 1000; eenheid = eenheid || 'm'; }
    else if (eenheid === 'cm') v *= 10;
    else eenheid = eenheid || 'mm';
    v = rond(v, 1);
    if (!(Math.abs(v) <= 100000)) return null;
    return { mm: v, eenheid };
  };
  // DISTO X4 als toetsenbord: zelfde regel als mt-opname-model.js (X.isDistoReeks). Minstens drie tekens, het hele veld uit deze reeks, geen pauze boven 180 ms en gemiddeld
  // hooguit 110 ms per toets: dat haalt een mens niet op een schermtoetsenbord.
  D.isDistoReeks = function (tijden, enter, lengte) {
    const t = lijst(tijden); if (t.length < 3 || t.length !== lengte || !(enter >= t[t.length - 1])) return false;
    const alle = t.concat([enter]); let max = 0;
    for (let i = 1; i < alle.length; i++) { const d = alle[i] - alle[i - 1]; if (!(d >= 0)) return false; if (d > max) max = d; }
    return max <= 180 && (enter - t[0]) / t.length <= 110;
  };

  // ── een nieuw dossier ──
  D.nieuw = function (gegevens, nu) {
    gegevens = gegevens || {};
    const p = gegevens.project || {}, r = gegevens.ruimte || {};
    return {
      schema: D.SCHEMA, versie: D.VERSIE, gemaakt: isoNu(nu), bijgewerkt: isoNu(nu),
      project: { id: p.id || D.nieuwId('prj'), code: p.code || '', naam: p.naam || '' },
      ruimte: {
        id: r.id || D.nieuwId('rmt'), naam: r.naam || 'Ruimte', eenheid: 'mm',
        assen: { oorsprong: 'binnenhoek op de afgewerkte vloer (zie lijnmodel.oorsprong)', x: 'langs de eerste wand', y: 'loodrecht daarop, de kamer in', z: 'omhoog', rechtsdraaiend: true },
        peil: { z0: 'afgewerkte vloer zoals de camera hem vond; een gemeten peilverschil staat bij de metingen' },
        afgesloten: false, meubelkeuze: null
      },
      sessies: [], hoeken: [], wanden: [], details: [], metingen: [], opmerkingen: [], beelden: [], archief: []
    };
  };
  const sessie = (d, id) => lijst(d.sessies).find(s => s.id === id) || null;
  D.basisSessie = d => lijst(d.sessies).find(s => s.uitlijning && s.uitlijning.status === 'basis') || null;
  D.zoek = (d, id) => {
    for (const k of ['hoeken', 'wanden', 'details', 'metingen', 'opmerkingen', 'beelden', 'sessies']) { const x = lijst(d[k]).find(y => y && y.id === id); if (x) return { soort: k, item: x }; }
    return null;
  };
  // Een rondgang in een AR-sessie. De eerste sessie is de basis: haar AR-ruimte is de ruimte van het dossier. Een latere sessie (aanvullen) heeft een eigen AR-ruimte en blijft
  // apart ('niet-uitgelijnd') tot de opnemer twee bekende hoeken opnieuw heeft aangewezen; dan komt de omrekening erbij (D.lijnUit).
  D.startSessie = function (d, info, nu) {
    info = info || {};
    const basis = !D.basisSessie(d), s = {
      id: D.nieuwId('ses'), start: isoNu(nu), eind: null, toestel: info.toestel || '', browser: info.browser || '', bron: info.bron || 'webxr-arcore',
      xr: { vloerY: null, plafondY: null, eenheid: 'm', y_omhoog: true },
      uitlijning: basis ? { status: 'basis' } : { status: 'niet-uitgelijnd', reden: 'nieuwe AR-sessie: wijs eerst twee bekende hoeken aan' },
      waarnemingen: { automatisch: 0, getikt: 0, beeld_vastgelegd: 0, tracking_kwijt: 0, beeld_mislukt: 0 }
    };
    d.sessies.push(s); d.bijgewerkt = isoNu(nu);
    return s;
  };
  D.sluitSessie = function (d, sessieId, xr, nu) {
    const s = sessie(d, sessieId); if (!s) return null;
    s.eind = isoNu(nu); if (xr) Object.assign(s.xr, xr); d.bijgewerkt = isoNu(nu); return s;
  };

  // ── hoeken en wanden ── punten: [{ x, z, bron:'vloer'|'plafond' }] in meters in de AR-ruimte van de sessie. Bestaande hoeken houden hun id (op volgorde); de vorige stand
  // gaat in het archief, zodat een ruwe waarneming na een correctie terug te vinden is.
  D.zetHoeken = function (d, sessieId, punten, nu) {
    const oud = lijst(d.hoeken), oudW = lijst(d.wanden);
    if (oud.length) d.archief.push({ soort: 'hoeken', tijd: isoNu(nu), hoeken: JSON.parse(JSON.stringify(oud)), wanden: JSON.parse(JSON.stringify(oudW)) });
    d.hoeken = punten.map((p, i) => ({
      id: (oud[i] && oud[i].id) || D.nieuwId('hk'), label: 'H' + (i + 1), sessie: sessieId,
      xr: { x: Number(p.x), z: Number(p.z) }, via: p.bron === 'plafond' ? 'plafond' : 'vloer', status: 'geschat', bron: 'ar', tijd: p.tijd || isoNu(nu),
      // waar het ARCore-anker de hoek op het laatst zag (alleen ter vergelijking; de tik is leidend)
      xr_anker: p.anker && isFinite(p.anker.x) ? { x: Number(p.anker.x), z: Number(p.anker.z), afstand_mm: Math.round((p.anker.afstand_m || 0) * 1000) } : undefined
    }));
    const n = d.hoeken.length;
    d.wanden = d.hoeken.map((h, i) => {
      const volgende = d.hoeken[(i + 1) % n], bestaand = oudW[i];
      return { id: (bestaand && bestaand.id) || D.nieuwId('wd'), label: 'W' + (i + 1), van: h.id, naar: volgende.id, binnenzijde: 'afgewerkt', dikte: { waarde: null, status: 'onbekend' } };
    });
    d.bijgewerkt = isoNu(nu);
    return d.hoeken;
  };

  // ── hoek corrigeren vanuit een foto ── De getikte plek (uit de hand, met de camera) blijft bewaard in xr_ruw en in het archief; de hoek krijgt de plek die de
  // opnemer (of later een herkenning) op de foto aanwees. info: { bron: 'foto' | 'ai', beeld_id, punt: {x, y} (fractie van de foto), door }.
  D.corrigeerHoek = function (d, hoekId, xz, info, nu) {
    const h = lijst(d.hoeken).find(x => x.id === hoekId); if (!h || !xz) return null;
    d.archief.push({ soort: 'hoek-correctie', tijd: isoNu(nu), hoek: JSON.parse(JSON.stringify(h)) });
    if (!h.xr_ruw) h.xr_ruw = { x: h.xr.x, z: h.xr.z };
    h.xr = { x: Number(xz.x), z: Number(xz.z) };
    h.status = 'gecorrigeerd'; h.bron = (info && info.bron) || 'foto';
    h.correctie = { bron: h.bron, beeld_id: info && info.beeld_id || null, punt: info && info.punt || null, door: info && info.door || 'opnemer', tijd: isoNu(nu),
      verschuiving_mm: Math.round(Math.hypot(h.xr.x - h.xr_ruw.x, h.xr.z - h.xr_ruw.z) * 1000) };
    d.bijgewerkt = isoNu(nu); return h;
  };
  // Een hoek weghalen (dubbel of verkeerd getikt). De wand ervoor en de wand erna worden één wand (id van de wand ervoor); de lengte daarvan staat
  // weer open. Details op de weggevallen wand verhuizen naar de samengevoegde wand, met hun plek langs de wand als onbekend (de camera-plek blijft).
  D.verwijderHoek = function (d, hoekId, reden, nu) {
    const H = lijst(d.hoeken), k = H.findIndex(h => h.id === hoekId); if (k < 0 || H.length <= 3) return null;
    d.archief.push({ soort: 'hoek-weggehaald', tijd: isoNu(nu), reden: reden || '', hoeken: JSON.parse(JSON.stringify(H)), wanden: JSON.parse(JSON.stringify(d.wanden)) });
    const n = H.length, voor = d.wanden[(k - 1 + n) % n], na = d.wanden[k];
    H.splice(k, 1);
    voor.naar = na.naar;
    d.wanden = d.wanden.filter(x => x !== na);
    lijst(d.details).forEach(det => { if (det.wand_id === na.id || det.wand_id === voor.id) { if (det.wand_id === na.id) det.wand_id = voor.id; if (det.anker) { det.anker.wand_id = voor.id; det.anker.u_m = null; } if (det.referentie_hoek === hoekId) det.referentie_hoek = voor.van; } });
    lijst(d.beelden).forEach(b => { if (b.hoek_id === hoekId) b.vervallen = true; if (b.wand_id === na.id) b.wand_id = voor.id; });
    D.voegMetingToe(d, { doel: { soort: 'wand', id: voor.id }, veld: 'lengte', waarde_mm: null, status: 'open', opmerking: 'wand samengevoegd na weghalen van een hoek' }, nu);
    d.hoeken.forEach((h, i) => { h.label = 'H' + (i + 1); });
    d.wanden.forEach((x, i) => { x.label = 'W' + (i + 1); });
    d.bijgewerkt = isoNu(nu); return d.hoeken;
  };
  D.herstelHoek = function (d, hoekId, nu) {
    const h = lijst(d.hoeken).find(x => x.id === hoekId); if (!h || !h.xr_ruw) return null;
    d.archief.push({ soort: 'hoek-correctie-teruggezet', tijd: isoNu(nu), hoek: JSON.parse(JSON.stringify(h)) });
    h.xr = { x: h.xr_ruw.x, z: h.xr_ruw.z }; h.status = 'geschat'; h.bron = 'ar'; delete h.correctie; delete h.xr_ruw;
    d.bijgewerkt = isoNu(nu); return h;
  };
  // Foto's die tijdens het tikken bij een hoek zijn gemaakt (hoekfoto en plafondfoto) koppelen aan de hoek-id's zodra de hoeken bestaan.
  D.koppelHoekfotos = function (d) {
    lijst(d.beelden).forEach(b => {
      if ((b.soort !== 'hoek' && b.soort !== 'plafondhoek') || b.hoek_id || b.vervallen || b.hoek_index == null) return;
      const h = lijst(d.hoeken)[b.hoek_index]; if (!h || (b.sessie && h.sessie && b.sessie !== h.sessie)) return;
      b.hoek_id = h.id; h.foto_ids = h.foto_ids || []; if (h.foto_ids.indexOf(b.id) < 0) h.foto_ids.push(b.id);
    });
  };

  // ── metingen ── doel: { soort: 'wand'|'detail'|'ruimte'|'diagonaal', id }. Een nieuwe waarde voor hetzelfde doel en veld vervangt de vorige (die blijft bestaan).
  D.voegMetingToe = function (d, m, nu) {
    const veld = D.VELDEN[m.veld] || {}, vorige = D.huidigeMeting(d, m.doel && m.doel.id, m.veld, m.doel && m.doel.extra);
    const status = m.status || (m.waarde_mm == null ? 'open' : (m.bron === 'ar' ? 'geschat' : 'gemeten'));
    const rec = {
      id: D.nieuwId('mt'), doel: { soort: m.doel.soort, id: m.doel.id }, veld: m.veld, grootheid: veld.grootheid || m.grootheid || null,
      betekenis: m.betekenis || veld.betekenis || null, referentie: m.referentie || (veld.referentie ? { soort: 'tekst', naam: veld.referentie } : null),
      waarde_mm: m.waarde_mm == null ? null : rond(Number(m.waarde_mm), 1), invoer: m.invoer == null ? null : String(m.invoer), eenheid_invoer: m.eenheid_invoer || null,
      bron: m.bron || null, status, meethoogte_mm: m.meethoogte_mm == null ? null : Number(m.meethoogte_mm), richting: m.richting || null,
      punten: m.punten || null, tijd: isoNu(nu), sessie: m.sessie || null, vervangt: vorige ? vorige.id : null, opmerking: m.opmerking || null,
      wand_id: m.wand_id || null   // bij een detailmaat: de wand waarlangs gemeten is (een latere wandwissel maakt de plek onzeker)
    };
    if (m.doel.extra) rec.doel.extra = m.doel.extra;
    d.metingen.push(rec); d.bijgewerkt = isoNu(nu);
    return rec;
  };
  const zelfdeExtra = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  D.huidigeMeting = function (d, doelId, veld, extra) {
    const alle = lijst(d.metingen).filter(m => m.doel && m.doel.id === doelId && m.veld === veld && zelfdeExtra(m.doel.extra, extra));
    const vervangen = new Set(alle.map(m => m.vervangt).filter(Boolean));
    const top = alle.filter(m => !vervangen.has(m.id));
    return top.length ? top[top.length - 1] : null;
  };
  D.historie = (d, doelId, veld) => lijst(d.metingen).filter(m => m.doel && m.doel.id === doelId && m.veld === veld);
  D.metingenVan = (d, doelId) => {
    const velden = {}; lijst(d.metingen).forEach(m => { if (m.doel && m.doel.id === doelId) velden[m.veld + JSON.stringify(m.doel.extra || null)] = [m.veld, m.doel.extra]; });
    return Object.keys(velden).map(k => D.huidigeMeting(d, doelId, velden[k][0], velden[k][1])).filter(Boolean);
  };

  // ── details, opmerkingen, beelden ──
  // anker: { xr: {x,y,z} (AR-ruimte van de sessie), wand_id, u_m (langs de wand vanaf de beginhoek), v_m (boven de vloer), diepte_m } of null (alleen op de foto aangewezen).
  D.voegDetailToe = function (d, x, nu) {
    const s = D.SOORTEN[x.soort] || D.SOORTEN.overig;
    const det = {
      id: D.nieuwId('dt'), groep: x.groep || s.groep, soort: x.soort || 'overig', label: x.label || s.label, ruimte_id: d.ruimte.id,
      wand_id: x.wand_id || (x.anker && x.anker.wand_id) || null, anker: x.anker || null,
      anker_status: x.anker && x.anker.xr ? 'ar-geschat' : 'alleen-foto', foto_ids: lijst(x.foto_ids).slice(), foto_punt: x.foto_punt || null,
      referentie_hoek: x.referentie_hoek || null, traject: x.traject || null, profiel_id: x.profiel_id || null, materiaal: x.materiaal || null,
      meubel: x.meubel || null, variant: x.variant || null, opmerking: x.opmerking || '', tijd: isoNu(nu), sessie: x.sessie || null, toestand: x.toestand || 'bestaand', status: 'actief'
    };
    d.details.push(det); d.bijgewerkt = isoNu(nu);
    return det;
  };
  D.wijzigDetail = function (d, id, velden, nu) {
    const det = lijst(d.details).find(x => x.id === id); if (!det) return null;
    d.archief.push({ soort: 'detail', tijd: isoNu(nu), detail: JSON.parse(JSON.stringify(det)) });
    Object.keys(velden).forEach(k => { if (k !== 'id') det[k] = velden[k]; });
    d.bijgewerkt = isoNu(nu); return det;
  };
  // Verwijderen = in het archief, met reden. Niets verdwijnt stil.
  D.verwijderDetail = function (d, id, reden, nu) {
    const det = lijst(d.details).find(x => x.id === id); if (!det) return null;
    det.status = 'verwijderd'; det.verwijderd = { tijd: isoNu(nu), reden: reden || '' }; d.bijgewerkt = isoNu(nu); return det;
  };
  D.actieveDetails = d => lijst(d.details).filter(x => x.status !== 'verwijderd');
  D.voegOpmerkingToe = function (d, o, nu) {
    const rec = { id: D.nieuwId('op'), tekst: String(o.tekst || ''), locatie: o.locatie || null, bron: o.bron || 'opnemer', toestand: o.toestand || 'toekomstig', tijd: isoNu(nu), sessie: o.sessie || null };
    d.opmerkingen.push(rec); d.bijgewerkt = isoNu(nu); return rec;
  };
  // pose: { pos:[x,y,z], dir:[x,y,z], pv:[16] } in de AR-ruimte van de sessie (pv = projectie x inverse camerastand, zoals WebXR ze geeft).
  D.voegBeeldToe = function (d, b, nu) {
    const id = b.id || D.nieuwId('bd'), soort = b.soort || 'overzicht', ext = b.type === 'image/png' ? 'png' : 'jpg';
    const rec = {
      id, soort, pad: b.pad || ('beelden/' + soort + '/' + id + '.' + ext), type: b.type || 'image/jpeg', sessie: b.sessie || null, tijd: b.tijd || isoNu(nu),
      pose: b.pose || null, breedte: b.breedte || null, hoogte: b.hoogte || null, bytes: b.bytes || null, sha256: b.sha256 || null,
      detail_id: b.detail_id || null, wand_id: b.wand_id || null, bewaard: !!b.bewaard
    };
    ['hoek_index', 'hoek_id', 'punt_xr', 'punt_in_beeld', 'wand_nr', 'heel_in_beeld', 'hoogte_schatting_m'].forEach(k => { if (b[k] != null) rec[k] = b[k]; });
    d.beelden.push(rec); d.bijgewerkt = isoNu(nu); return rec;
  };

  // ── assen en omrekening ── oorsprong in een binnenhoek op de vloer, X langs de eerste wand, Z omhoog, mm, rechtsdraaiend. Ligt de kamer met X langs H1→H2 aan de
  // negatieve Y-kant (rondgang tegen de klok in, van boven gezien), dan wordt H2 de oorsprong en loopt X van H2 naar H1: zo ligt de kamer altijd bij positieve Y.
  // punten: [{x, z}] in meters (AR-ruimte, Y omhoog). Geeft { oorsprong_index, x_naar_index, ox, oz, ux, uz, vloerY } en naar(p) -> {x, y, z} in mm.
  D.assen = function (punten, vloerY) {
    const n = punten.length; if (n < 2) return null;
    const maak = (o, t) => {
      const a = punten[o], b = punten[t], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      return { oorsprong_index: o, x_naar_index: t, ox: a.x, oz: a.z, ux, uz, vloerY: Number(vloerY) || 0 };
    };
    // Draairichting in het ruimtevlak (ook goed voor een holle vorm): positief = de kamer ligt links van H1→H2, dus bij +Y.
    let t = maak(0, 1), opp = 0;
    const R = punten.map(p => D.naarRuimte(t, { x: p.x, y: t.vloerY, z: p.z }));
    for (let i = 0; i < n; i++) { const a = R[i], b = R[(i + 1) % n]; opp += a.x * b.y - b.x * a.y; }
    if (opp < 0) t = maak(1, 0);
    return t;
  };
  // Y_ruimte = Z_ruimte x X_ruimte: met Z = (0,1,0) en X = (ux,0,uz) in de AR-ruimte is Y = (uz, 0, -ux).
  D.naarRuimte = function (t, p) {
    const dx = p.x - t.ox, dz = p.z - t.oz;
    return { x: rond((dx * t.ux + dz * t.uz) * 1000, 1), y: rond((dx * t.uz - dz * t.ux) * 1000, 1), z: rond(((p.y == null ? t.vloerY : p.y) - t.vloerY) * 1000, 1) };
  };

  // Uitlijnen van een nieuwe sessie op de basis: twee bekende hoeken in beide AR-ruimtes (van boven gezien). Geeft een draaiing plus verschuiving (en het vloerverschil) en
  // de rest: hoeveel de afstand tussen de twee hoeken verschilt. Een rest boven 'grens' meter betekent: de verkeerde hoek aangewezen of tracking kwijt, niet samenvoegen.
  D.lijnUit = function (basisA, basisB, nieuwA, nieuwB, vloerBasis, vloerNieuw, grens) {
    const rb = Math.atan2(basisB.z - basisA.z, basisB.x - basisA.x), rn = Math.atan2(nieuwB.z - nieuwA.z, nieuwB.x - nieuwA.x), hoek = rb - rn;
    const c = Math.cos(hoek), s = Math.sin(hoek);
    const t = { hoek, c, s, tx: basisA.x - (c * nieuwA.x - s * nieuwA.z), tz: basisA.z - (s * nieuwA.x + c * nieuwA.z), dy: (Number(vloerBasis) || 0) - (Number(vloerNieuw) || 0) };
    const rest = Math.abs(Math.hypot(basisB.x - basisA.x, basisB.z - basisA.z) - Math.hypot(nieuwB.x - nieuwA.x, nieuwB.z - nieuwA.z));
    return { transform: t, rest_m: rest, goed: rest <= (grens == null ? 0.05 : grens) };
  };
  D.pasToe = function (t, p) {
    if (!t) return p;
    const u = { x: t.c * p.x - t.s * p.z + t.tx, z: t.s * p.x + t.c * p.z + t.tz };
    if (p.y != null) u.y = p.y + t.dy;
    return u;
  };
  // Draai de matrix pv (kolom-volgorde) mee: een beeld uit een uitgelijnde sessie projecteert dan in de basisruimte. pv' = pv x inverse(T).
  D.pvNaarBasis = function (t, pv) {
    if (!t) return pv;
    // inverse(T): p_nieuw = R^-1 (p_basis - t)
    const c = t.c, s = t.s, inv = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    const tx = -(c * t.tx + s * t.tz), tz = -(-s * t.tx + c * t.tz);
    inv[12] = tx; inv[13] = -t.dy; inv[14] = tz;
    const o = new Array(16);
    for (let col = 0; col < 4; col++) for (let r = 0; r < 4; r++) { let som = 0; for (let k = 0; k < 4; k++) som += pv[k * 4 + r] * inv[col * 4 + k]; o[col * 4 + r] = som; }
    return o;
  };
  D.poseNaarBasis = function (t, pose) {
    if (!t || !pose) return pose;
    const p = D.pasToe(t, { x: pose.pos[0], y: pose.pos[1], z: pose.pos[2] }), r = D.pasToe(Object.assign({}, t, { tx: 0, tz: 0, dy: 0 }), { x: pose.dir[0], y: pose.dir[1], z: pose.dir[2] });
    return { pos: [p.x, p.y, p.z], dir: [r.x, r.y, r.z], pv: D.pvNaarBasis(t, pose.pv) };
  };

  // ── het lijnmodel ── zelfstandig leesbaar, zonder beelden: punten, wandsegmenten, peil, hoogte, met per waarde de status en de bron.
  // AR = de rekenkern uit docs/opname-ar-proef.html (rechtzetten, pasSchuin, loop, kamer); in de browser window.AR, in node uit de pagina gelezen.
  D.TOL_HAAKS = 10; D.KORTE_WAND_MM = 300;
  D.lijnmodel = function (d, AR) {
    const H = lijst(d.hoeken), n = H.length;
    if (n < 3 || !AR) return null;
    const basis = D.basisSessie(d) || {}, vloerY = basis.xr && basis.xr.vloerY != null ? basis.xr.vloerY : 0;
    const pts = H.map(h => ({ x: h.xr.x, z: h.xr.z }));
    const ruw = AR.kamer(pts), rz = AR.rechtzetten(pts, D.TOL_HAAKS), kc = AR.kamer(rz.punten);
    const lengteMeting = lijst(d.wanden).map(w => { const m = D.huidigeMeting(d, w.id, 'lengte'); return m && m.status === 'gemeten' && m.waarde_mm != null ? m : null; });
    const compleet = lengteMeting.every(Boolean);
    let model = rz.punten, gat = null, hoeken = kc.hoeken, status = 'geschat';
    if (compleet) {
      const maten = lengteMeting.map(m => m.waarde_mm), fit = AR.pasSchuin(kc.wanden.map(w => w.richting), rz.schuin, maten);
      const loop = AR.loop(fit.richtingen, maten), o = rz.punten[0];
      model = loop.map(p => ({ x: p.x + o.x, z: p.z + o.z }));
      gat = rond(fit.gat, 1); status = 'afgeleid';
      let opp = 0; for (let i = 0; i < n; i++) { const a = kc.punten[i], b = kc.punten[(i + 1) % n]; opp += a.x * b.y - b.x * a.y; }
      hoeken = AR.hoekenUitRichtingen(fit.richtingen, opp >= 0 ? 1 : -1);
    }
    const t = D.assen(model, vloerY);
    const punten = H.map((h, i) => {
      const r = D.naarRuimte(t, { x: model[i].x, y: vloerY, z: model[i].z });
      return { id: h.id, label: h.label, x: r.x, y: r.y, z: 0, status, bron: status === 'afgeleid' ? 'wandmaten met camerarichtingen' : 'camera, bijna-haakse hoeken haaks gezet', via: h.via, binnenhoek_graden: rond(hoeken[i], 1) };
    });
    // Ter vergelijking: de wandlengtes zoals de ARCore-ankers de hoeken aan het eind van de rondgang zagen (alle hoeken in dezelfde, laatste versie
    // van de kaart). Alleen als elke hoek een ankerpositie heeft.
    const ankerLengte = H.every(h => h.xr_anker) ? H.map((h, i) => { const q = H[(i + 1) % n].xr_anker; return rond(Math.hypot(q.x - h.xr_anker.x, q.z - h.xr_anker.z) * 1000, 0); }) : null;
    const segmenten = lijst(d.wanden).map((w, i) => {
      const m = lengteMeting[i], open = D.huidigeMeting(d, w.id, 'lengte'), camera = rond(kc.wanden[i].lengte, 0);
      return {
        id: w.id, label: w.label, soort: 'wand-binnenzijde', van: w.van, naar: w.naar,
        lengte: m ? { waarde: m.waarde_mm, status: 'gemeten', bron: m.bron, meting_id: m.id } : { waarde: camera, status: 'geschat', bron: 'ar', meting_id: null, open: !!(open && open.status === 'open') },
        camera_mm: camera, ruw_camera_mm: rond(ruw.wanden[i].lengte, 0), anker_camera_mm: ankerLengte ? ankerLengte[i] : null,
        richting: { status: rz.haaks[i] ? 'haaks-aangenomen' : 'camera', bron: 'ar' },
        kort: (m ? m.waarde_mm : camera) < D.KORTE_WAND_MM, dikte: w.dikte
      };
    });
    // Voor de tekenaar: de lengte tussen de eindpunten in het model naast het gemeten label. Sluit de kamer niet precies, dan verschillen die.
    segmenten.forEach((sg, i) => { const a = punten[i], b = punten[(i + 1) % n], ml = rond(Math.hypot(b.x - a.x, b.y - a.y), 0); sg.lengte_model_mm = ml; sg.verschil_model_mm = sg.lengte.status === 'gemeten' ? rond(ml - sg.lengte.waarde, 0) : null; });
    const hm = D.huidigeMeting(d, d.ruimte.id, 'plafondhoogte');
    const hoogte = hm && hm.status === 'gemeten' ? { waarde: hm.waarde_mm, status: 'gemeten', bron: hm.bron, meting_id: hm.id }
      : (basis.xr && basis.xr.plafondY != null ? { waarde: rond((basis.xr.plafondY - vloerY) * 1000, 0), status: 'geschat', bron: 'ar' } : { waarde: null, status: 'onbekend', bron: null });
    return {
      eenheid: 'mm', status,
      oorsprong: { hoek_id: H[t.oorsprong_index].id, label: H[t.oorsprong_index].label, beschrijving: 'binnenhoek ' + H[t.oorsprong_index].label + ' op de afgewerkte vloer' },
      x_as: { van: H[t.oorsprong_index].label, naar: H[t.x_naar_index].label }, peil: { z0: 'afgewerkte vloer', bron: 'ar-vloervlak' },
      xr_naar_ruimte: { ox: t.ox, oz: t.oz, ux: t.ux, uz: t.uz, vloerY: t.vloerY, formule: 'x=(dx*ux+dz*uz)*1000, y=(dx*uz-dz*ux)*1000, z=(y_xr-vloerY)*1000, dx=x_xr-ox, dz=z_xr-oz' },
      punten, segmenten, hoogte, sluitfout_mm: gat, schuin: rz.schuin.map(i => lijst(d.wanden)[i] && lijst(d.wanden)[i].id),
      _t: t, _model: model
    };
  };
  // Plek van een detail in het lijnmodel: langs zijn wand (gemeten afstand gaat voor de camera), anders de camera-plek omgerekend.
  // Welke maat bepaalt de plek langs de wand, en vanaf welke hoek? Review 18-11 (GPT): een opgeslagen maat houdt haar eigen referentie. Het wisselen van
  // det.referentie_hoek (de keuzelijst) geldt alleen voor de vólgende invoer en verschuift een bestaande maat nooit. Ontbreekt de referentie (oude
  // invoer) of hoort hij niet bij de huidige wand (wand gewisseld), dan is de plek 'onzeker'. Geeft { u_mm, vanaf (hoek-id), bron, meting_id, onzeker, reden } of null.
  D.LANGS_VELDEN = ['afstand_tot_hoek', 'afstand_hart_tot_hoek', 'begin_vanaf_hoek'];
  D.HOOGTE_VELDEN = ['hoogte_hart', 'onderkant', 'borstwering', 'hoogte_bovenkant'];
  D.maatLangsWand = function (d, det) {
    const wand = lijst(d.wanden).find(w => w.id === det.wand_id);
    for (const f of D.LANGS_VELDEN) {
      const m = D.huidigeMeting(d, det.id, f); if (!m || m.status !== 'gemeten' || m.waarde_mm == null) continue;
      const ref = m.referentie && m.referentie.soort === 'hoek' ? m.referentie.id : null;
      if (!wand) return { u_mm: m.waarde_mm, vanaf: ref, bron: m.bron, meting_id: m.id, veld: f, onzeker: true, reden: 'geen wand gekoppeld' };
      if (m.wand_id && m.wand_id !== wand.id) return { u_mm: m.waarde_mm, vanaf: ref, bron: m.bron, meting_id: m.id, veld: f, onzeker: true, reden: 'gemeten vanaf een hoek van een andere wand' };
      if (!ref) return { u_mm: m.waarde_mm, vanaf: wand.van, bron: m.bron, meting_id: m.id, veld: f, onzeker: true, reden: 'onbekend vanaf welke hoek gemeten' };
      if (ref !== wand.van && ref !== wand.naar) return { u_mm: m.waarde_mm, vanaf: ref, bron: m.bron, meting_id: m.id, veld: f, onzeker: true, reden: 'gemeten vanaf een hoek van een andere wand' };
      return { u_mm: m.waarde_mm, vanaf: ref, bron: m.bron, meting_id: m.id, veld: f, onzeker: false, reden: null };
    }
    return null;
  };
  D.maatHoogte = function (d, det) {
    for (const f of D.HOOGTE_VELDEN) { const m = D.huidigeMeting(d, det.id, f); if (m && m.status === 'gemeten' && m.waarde_mm != null) return { v_mm: m.waarde_mm, bron: m.bron, meting_id: m.id, veld: f }; }
    return null;
  };
  // Plek van een detail in het lijnmodel: langs zijn wand vanaf de hoek van de meting (een gemeten maat gaat voor de camera), anders de camera-plek omgerekend.
  D.detailPlek = function (d, det, lm) {
    if (!lm || (!det.anker && !det.wand_id)) return null;
    const wi = lijst(d.wanden).findIndex(w => w.id === det.wand_id), wand = lijst(d.wanden)[wi], ml = D.maatLangsWand(d, det), mh = D.maatHoogte(d, det);
    let v = det.anker && det.anker.v_m != null ? det.anker.v_m * 1000 : null, vbron = v == null ? 'onbekend' : 'geschat';
    if (mh) { v = mh.v_mm; vbron = 'gemeten'; }
    let u = null, vanaf = wand ? wand.van : null, ubron = 'geschat', reden = null, metingId = null;
    if (det.anker && det.anker.u_m != null) u = det.anker.u_m * 1000;   // de camera meet langs de wand vanaf de beginhoek
    if (ml && wand && !(ml.onzeker && ml.reden === 'gemeten vanaf een hoek van een andere wand')) { u = ml.u_mm; vanaf = ml.vanaf; ubron = ml.onzeker ? 'onzeker' : 'gemeten'; reden = ml.reden; metingId = ml.meting_id; }
    else if (ml) { ubron = 'onzeker'; reden = ml.reden; }
    if (wi >= 0 && u != null) {
      const n = lm.punten.length, a = lm.punten[wi], b = lm.punten[(wi + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, uu = vanaf === wand.naar ? L - u : u;
      return { x: rond(a.x + (b.x - a.x) / L * uu, 1), y: rond(a.y + (b.y - a.y) / L * uu, 1), z: v == null ? null : rond(v, 1),
        status: { langs_wand: ubron, hoogte: vbron }, wand_id: det.wand_id, vanaf_hoek: vanaf, meting_id: metingId, hoogte_meting_id: mh ? mh.meting_id : null, reden: reden };
    }
    if (det.anker && det.anker.xr) { const r = D.naarRuimte(lm._t, det.anker.xr); return { x: r.x, y: r.y, z: r.z, status: { langs_wand: ml ? 'onzeker' : 'geschat', hoogte: vbron }, wand_id: null, reden: reden }; }
    return null;
  };
  // ── haaksheid van een hoek: driehoeksmeting ── Vanuit de hoek a mm langs de wand ervoor en b mm langs de wand erna een merkteken (bijv. 1000/1000 op
  // ±1 m hoogte, boven plint en meubels), dan de schuine maat c tussen de twee tekens. Hoek = cosinusregel. Praktischer en betrouwbaarder dan een
  // diagonaal van hoek tot hoek (feedback 18-11: met een laser kom je niet strak in de hoek). Op 1000/1000 is 3 mm in c ongeveer 0,2°.
  D.hoekUitDriehoek = function (a, b, c) {
    a = Number(a); b = Number(b); c = Number(c);
    if (!(a > 0 && b > 0 && c > 0) || a + b <= c || a + c <= b || b + c <= a) return null;
    return Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b)))) * 180 / Math.PI;
  };
  D.voegDriehoekToe = function (d, hoekId, a, b, c, info, nu) {
    const g = D.hoekUitDriehoek(a, b, c); if (g == null) return null;
    info = info || {};
    const m = D.voegMetingToe(d, { doel: { soort: 'hoek', id: hoekId }, veld: 'hoek_driehoek', waarde_mm: null, bron: info.bron || 'hand', status: 'gemeten',
      invoer: info.invoer || (a + ' / ' + b + ' / ' + c), opmerking: info.opmerking || null, sessie: info.sessie || null }, nu);
    m.grootheid = 'hoek'; m.waarde_graden = rond(g, 2); m.driehoek = { a_mm: Number(a), b_mm: Number(b), c_mm: Number(c), a_langs: 'wand ervoor', b_langs: 'wand erna', hoogte: info.hoogte_mm || null };
    // gevoeligheid: hoeveel graden scheelt 1 mm in c
    const g1 = D.hoekUitDriehoek(a, b, Number(c) + 1); m.graden_per_mm = g1 == null ? null : rond(Math.abs(g1 - g), 3);
    return m;
  };
  // Gemeten hoeken naast de hoek in het model (binnenhoek). De driehoek meet de kleinste hoek tussen de wanden: bij een binnenhoek > 180° is het 360 − hoek.
  D.controleHoeken = function (d, lm) {
    if (!lm) return [];
    return lijst(d.hoeken).map(h => {
      const m = D.huidigeMeting(d, h.id, 'hoek_driehoek'); if (!m || m.waarde_graden == null) return null;
      const p = lm.punten.find(x => x.id === h.id), model = p ? p.binnenhoek_graden : null, modelKlein = model == null ? null : (model > 180 ? 360 - model : model);
      return { hoek_id: h.id, label: h.label, gemeten_graden: m.waarde_graden, model_graden: modelKlein, verschil_graden: modelKlein == null ? null : rond(m.waarde_graden - modelKlein, 2),
        driehoek: m.driehoek, graden_per_mm: m.graden_per_mm, meting_id: m.id, model_status: lm.status };
    }).filter(Boolean);
  };
  // ── wandaanzicht ── De wand zoals je hem vanuit de kamer ziet (links/rechts), met de details erop als rechthoek of punt, in mm vanaf de linkerhoek en de vloer.
  // Per maat de status: gemeten, geschat (camera/aangenomen), afgeleid (uit andere maten) of open. voorlopig: { detailId: { veld: mm } } (invoer die nog niet
  // bewaard is: status 'invoer'), voor een live-voorbeeld tijdens het typen. Leest geen beelden; het lijnmodel levert de wandlengte en de hoogte.
  D.STANDAARD_MAAT = { kozijn: { b: 1000, h: 1200, o: 900 }, raam: { b: 1000, h: 1200, o: 900 }, deur: { b: 900, h: 2100, o: 0 }, radiator: { b: 1000, h: 600, o: 150 }, nis: { b: 800, h: 1000, o: 0 },
    kolom: { b: 300, h: null, o: 0 }, balk: { b: 200, h: null, o: 2300 } };
  // Onderdelen met een begin en eind langs de wand (traject): plaats in hoogte en standaard dikte als er nog niets gemeten is.
  D.TRAJECT_MAAT = { plint: { h: 70 }, vensterbank: { boven: 900, dikte: 30 }, sierlijst: { h: 60 } };
  // Welke soorten je op een wand kunt zetten (in het wandaanzicht); meubels, vlakafwerking en losse opmerkingen horen niet op een wand.
  D.WANDSOORTEN = ['kozijn', 'raam', 'deur', 'nis', 'radiator', 'stopcontact', 'schakelaar', 'leiding', 'vensterbank', 'plint', 'sierlijst', 'kolom', 'balk', 'knik', 'overig'];
  // Links of rechts vanuit de kamer, zonder AR-kern: de hoeken van het lijnmodel liggen in volgorde H1, H2, …; met de klok mee (oppervlakte < 0, van boven
  // gezien in X/Y) ligt de kamer rechts van elke wand als je van 'van' naar 'naar' loopt, en sta je in de kamer met je gezicht naar de wand dan is 'van' links.
  D.vanLinks = function (lm) {
    const p = lijst(lm && lm.punten), n = p.length; let opp = 0;
    for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; opp += a.x * b.y - b.x * a.y; }
    return opp < 0;
  };
  // derde argument: de AR-kern (dan wordt het lijnmodel berekend) of een kant-en-klaar lijnmodel (kijker op kantoor: d.afgeleid.lijnmodel).
  D.wandAanzicht = function (d, wandId, AR, voorlopig) {
    const lm = AR && AR.segmenten ? AR : D.lijnmodel(d, AR); if (!lm) return null;
    const wi = lijst(d.wanden).findIndex(w => w.id === wandId), w = lijst(d.wanden)[wi], seg = lijst(lm.segmenten).find(s => s.id === wandId) || lijst(lm.segmenten)[wi]; if (!w || !seg) return null;
    const L = seg.lengte.waarde, H = lm.hoogte && lm.hoogte.waarde || 2600;
    const vanLinks = D.vanLinks(lm), linksId = vanLinks ? w.van : w.naar, rechtsId = vanLinks ? w.naar : w.van, hl = id => (lijst(d.hoeken).find(h => h.id === id) || {}).label;
    const vl = voorlopig || {}, hardSt = st2 => st2 === 'gemeten' || st2 === 'invoer', hardOf = st2 => hardSt(st2) || st2 === 'afgeleid';
    const maat = (det, velden) => {
      for (const f of velden) {
        if (vl[det.id] && vl[det.id][f] != null) return { waarde: vl[det.id][f], status: 'invoer', veld: f };
        const m = D.huidigeMeting(d, det.id, f); if (m && m.waarde_mm != null && m.status !== 'open') return { waarde: m.waarde_mm, status: m.status, bron: m.bron, veld: f, meting: m };
      }
      return null;
    };
    // vanaf welke hoek een maat langs de wand telt: de opgeslagen referentie van die meting, anders (live-invoer) de gekozen hoek
    const refVan = (det, m) => m && m.meting && m.meting.referentie && m.meting.referentie.id ? m.meting.referentie.id : (det.referentie_hoek || linksId);
    const xLinks = (det, m) => refVan(det, m) === linksId ? m.waarde : L - m.waarde;
    const samen = (a, b) => hardOf(a) && hardOf(b) ? 'afgeleid' : 'geschat';
    const items = D.actieveDetails(d).filter(det => det.wand_id === w.id).map(det => {
      const st = D.STANDAARD_MAAT[det.soort], tr = D.TRAJECT_MAAT[det.soort];
      const afst = maat(det, D.LANGS_VELDEN), refId = refVan(det, afst);
      const camU = det.anker && det.anker.u_m != null ? det.anker.u_m * 1000 : null, camV = det.anker && det.anker.v_m != null ? det.anker.v_m * 1000 : null;
      // welk veld hoort bij welke maat in de tekening (voor 'tik de maat aan'): het eerste veld van de kandidaten dat deze soort kent
      const kv0 = det.soort === 'kozijn' ? D.kozijnVelden(det) : null, eigen = kv0 ? kv0.verplicht.concat(kv0.optioneel) : (D.SOORTEN[det.soort] || D.SOORTEN.overig).velden;
      const rol = kand => kand.find(f => eigen.indexOf(f) >= 0) || null;
      const vr = D.variantVan(det);
      const basis = { det, soort: det.soort, label: det.label, opmerking: det.opmerking || '', afstand: afst, vanaf: refId, vanLinks: refId === linksId, variant: vr ? { id: vr.id, label: vr.label, kort: vr.kort } : null };
      if (tr) {   // traject: plint, vensterbank, sierlijst (begin en eind vanaf een hoek)
        const bg = maat(det, ['begin_vanaf_hoek']), ei = maat(det, ['eind_vanaf_hoek']);
        let x1 = bg ? xLinks(det, bg) : (camU != null ? (vanLinks ? camU : L - camU) - 500 : 0), x2 = ei ? xLinks(det, ei) : (camU != null ? x1 + 1000 : L);
        const x = Math.min(x1, x2), bw = Math.abs(x2 - x1), vanL = bg ? refVan(det, bg) === linksId : true;
        let y, hh, sy, sh, extra = [];
        if (det.soort === 'plint') { const hm = maat(det, ['hoogte']); y = 0; hh = hm ? hm.waarde : tr.h; sy = 'gemeten'; sh = hm ? hm.status : 'open'; }
        else if (det.soort === 'vensterbank') {
          const bk = maat(det, ['hoogte_bovenkant']), dk = maat(det, ['dikte']), top = bk ? bk.waarde : tr.boven; hh = dk ? dk.waarde : tr.dikte; y = top - hh;
          sh = dk ? dk.status : 'open'; sy = bk && dk ? samen(bk.status, dk.status) : 'geschat';
          extra.push({ van: 0, tot: top, waarde: bk ? top : null, status: bk ? bk.status : 'open', label: 'bovenkant', veld: 'hoogte_bovenkant' });
        } else {   // sierlijst: standaard tegen het plafond
          const hm = maat(det, ['hoogte']), bk = maat(det, ['hoogte_bovenkant']), top = bk ? bk.waarde : H; hh = hm ? hm.waarde : tr.h; y = top - hh;
          sh = hm ? hm.status : 'open'; sy = hm ? samen(bk ? bk.status : (lm.hoogte && lm.hoogte.status), hm.status) : 'geschat';
          if (bk) extra.push({ van: 0, tot: top, waarde: top, status: bk.status, label: 'bovenkant', veld: 'hoogte_bovenkant' });
        }
        return Object.assign(basis, { vorm: 'traject', vanLinks: vanL, rect: { x, y, w: bw, h: hh },
          status: { x: bg ? bg.status : 'open', w: bg && ei ? (refVan(det, bg) === refVan(det, ei) ? samen(bg.status, ei.status) : samen(samen(bg.status, ei.status), seg.lengte.status)) : 'open', y: sy, h: sh, boven: null },
          velden: { x: 'begin_vanaf_hoek', w: 'eind_vanaf_hoek', h: det.soort === 'vensterbank' ? 'dikte' : 'hoogte' },
          traject: { begin: bg, eind: ei }, extraV: extra, boven_tot_plafond: null });
      }
      if (det.soort === 'knik') {   // knik of afwijking: een verticale lijn over de hele hoogte
        let x = null, xs = 'open';
        if (afst) { x = xLinks(det, afst); xs = afst.status; } else if (camU != null) { x = vanLinks ? camU : L - camU; xs = 'geschat'; }
        return Object.assign(basis, { vorm: 'lijn', lijn: { x, status: xs }, velden: { x: rol(D.LANGS_VELDEN) }, diepte: maat(det, ['diepte']) });
      }
      if (!st) {   // punt: stopcontact, schakelaar, leiding, …
        const hv = maat(det, D.HOOGTE_VELDEN);
        let x = null, xs = 'open';
        if (afst) { x = xLinks(det, afst); xs = afst.status; } else if (camU != null) { x = vanLinks ? camU : L - camU; xs = 'geschat'; }
        const pl = vr && vr.plaat ? vr.plaat : (det.soort === 'stopcontact' || det.soort === 'schakelaar' ? [81, 81] : null);   // afdekplaat op schaal (zonder variant: enkel)
        return Object.assign(basis, { vorm: 'punt', plaat: pl ? { w: pl[0], h: pl[1] } : null, velden: { x: rol(D.LANGS_VELDEN), y: rol(D.HOOGTE_VELDEN) }, punt: { x, y: hv ? hv.waarde : camV, status: { x: xs, y: hv ? hv.status : (camV != null ? 'geschat' : 'open') } } });
      }
      const op = det.opening || null, zij = op && op.type === 'aftimmering-op-wand' ? lijst(op.zijden) : [], dk = op ? maat(det, ['aftimmer_dikte']) : null, dik = dk ? dk.waarde : (zij.length ? 12 : 0);
      const ob = op ? maat(det, ['opening_breedte']) : null, oh = op ? maat(det, ['opening_hoogte']) : null;
      // buitenmaat op het wandvlak = binnenwerks + paneeldikte aan de zijden met aftimmering (alleen bij een kader op de wand)
      const metDikte = (m, a, z) => m ? { waarde: m.waarde + dik * ((zij.indexOf(a) >= 0) + (zij.indexOf(z) >= 0)),
        status: !zij.length ? m.status : (hardSt(m.status) && dk && hardSt(dk.status) ? 'afgeleid' : 'geschat') } : null;   // dikte niet gemeten: 12 mm aangenomen = geschat
      const b = metDikte(ob, 'links', 'rechts') || maat(det, ['kozijn_breedte', 'breedte', 'breedte_midden', 'breedte_onder', 'breedte_boven']);
      let h = metDikte(oh, 'boven', 'onder') || maat(det, ['kozijn_hoogte', 'hoogte']);
      const o = maat(det, ['kozijn_onderkant', 'borstwering', 'onderkant']);
      const bw = b ? b.waarde : st.b, vast0 = det.soort === 'deur' || det.soort === 'nis' || det.soort === 'kolom';
      let hh = h ? h.waarde : (st.h == null ? H : st.h), oo = o ? o.waarde : (vast0 ? 0 : (camV != null ? Math.max(0, camV - hh / 2) : st.o));
      if (det.soort === 'balk') { hh = H - oo; h = { waarde: hh, status: o ? samen(o.status, lm.hoogte && lm.hoogte.status) : 'geschat' }; }   // balk: van de onderkant tot het plafond
      let x, xs;
      if (afst && afst.bron === 'ar') { x = xLinks(det, afst) - bw / 2; xs = afst.status; }   // camera: het kruisje stond midden op het onderdeel, niet op de zijkant
      else if (afst) { x = refId === linksId ? afst.waarde : L - afst.waarde - bw; xs = afst.status; }
      else if (camU != null) { x = (vanLinks ? camU : L - camU) - bw / 2; xs = 'geschat'; }
      else { x = (L - bw) / 2; xs = 'open'; }
      const btp = maat(det, ['boven_tot_plafond']);
      return Object.assign(basis, { vorm: 'vlak', rect: { x, y: oo, w: bw, h: hh },
        status: { x: xs, w: b ? b.status : 'open', h: h ? h.status : (st.h == null ? (lm.hoogte && lm.hoogte.status) || 'geschat' : 'open'), y: o ? o.status : (vast0 ? 'gemeten' : (camV != null ? 'geschat' : 'open')), boven: btp ? btp.status : null },
        velden: { x: rol(D.LANGS_VELDEN), w: rol(['opening_breedte', 'kozijn_breedte', 'breedte', 'breedte_midden']), h: det.soort === 'balk' ? null : rol(['opening_hoogte', 'kozijn_hoogte', 'hoogte']),
          y: rol(['kozijn_onderkant', 'borstwering', 'onderkant']), boven: rol(['boven_tot_plafond']) },
        boven_tot_plafond: btp ? btp.waarde : null, dag: { b: maat(det, ['dag_breedte']), h: maat(det, ['dag_hoogte']) }, extraV: [],
        opening: op ? { type: op.type, zijden: zij.length ? zij : lijst(op.zijden), dikte: dik, dikte_status: dk ? dk.status : (zij.length ? 'aangenomen' : null),
          binnen: ob && oh ? { x: x + (zij.indexOf('links') >= 0 ? dik : 0), y: oo + (zij.indexOf('onder') >= 0 ? dik : 0), w: ob.waarde, h: oh.waarde, status: { w: ob.status, h: oh.status } } : null,
          uitsteek: maat(det, ['aftimmer_uitsteek']), nis_diepte: maat(det, ['nis_diepte_tot_aftimmering']), kozijn_diepte: maat(det, ['diepte_tot_kozijn']) } : null,
        raam: det.raam || null });
    });
    return { wand_id: w.id, wand: w.label, L, H, status: { L: seg.lengte.status, H: lm.hoogte && lm.hoogte.waarde ? lm.hoogte.status : 'aangenomen' }, links: { id: linksId, label: hl(linksId) }, rechts: { id: rechtsId, label: hl(rechtsId) }, items };
  };
  // Eén doorlopende maatketen langs de hele wand (voor de uitslag en de wandpagina): alle zijkanten van onderdelen en de punten (hart stopcontact, knik).
  // Een deel dat precies een gemeten maat is (afstand vanaf de hoek, breedte) heet 'gemeten'; een deel tussen twee harde punten 'afgeleid'; anders 'geschat'.
  // kies(it): welke onderdelen meedoen. Op een tekening staan openingen (kozijn, deur, nis) in hun eigen keten en de overige onderdelen in een tweede:
  // anders hakt een radiator onder het raam de raammaat in stukken.
  D.isOpening = it => it.soort === 'kozijn' || it.soort === 'raam' || it.soort === 'deur' || it.soort === 'nis';
  D.wandKeten = function (az, kies) {
    if (!az) return [];
    const L = az.L, hard = s => s === 'gemeten' || s === 'invoer' || s === 'afgeleid', Lh = hard(az.status.L), pts = [{ x: 0, hard: true }, { x: L, hard: Lh }], direct = [];
    const zet = (x, h) => { if (x != null && x > -0.5 && x < L + 0.5) pts.push({ x: Math.max(0, Math.min(L, x)), hard: h }); };
    az.items.forEach(it => {
      if (kies && !kies(it)) return;
      const vl = it.vanLinks !== false;
      if (it.rect) {
        if (it.status.x === 'open' || it.status.w === 'open') return;   // plek of breedte nog niet bekend: niet in de keten
        const sx = hard(it.status.x) && (vl || Lh), sw = hard(it.status.w);
        zet(it.rect.x, sx && (vl || sw)); zet(it.rect.x + it.rect.w, sx && (!vl || sw));
        if (it.status.w === 'gemeten' || it.status.w === 'invoer') direct.push([it.rect.x, it.rect.x + it.rect.w]);
        const bin = it.opening && it.opening.binnen;   // kader op de wand: de gemeten binnenmaat hoort in de keten, de panelen als eigen stukje
        if (bin && bin.w < it.rect.w - 0.5) { zet(bin.x, sx && (vl || sw)); zet(bin.x + bin.w, sx && (!vl || sw)); if (bin.status.w === 'gemeten' || bin.status.w === 'invoer') direct.push([bin.x, bin.x + bin.w]); }
        if (it.status.x === 'gemeten' || it.status.x === 'invoer') direct.push(vl ? [0, it.rect.x] : [it.rect.x + it.rect.w, L]);
      } else {
        const p = it.punt || it.lijn; if (!p || p.x == null) return;
        const sx = typeof p.status === 'string' ? p.status : p.status.x;
        zet(p.x, hard(sx) && (vl || Lh));
        if (sx === 'gemeten' || sx === 'invoer') direct.push(vl ? [0, p.x] : [p.x, L]);
      }
    });
    pts.sort((a, b) => a.x - b.x);
    const sam = [];
    pts.forEach(p => { const v = sam[sam.length - 1]; if (v && p.x - v.x < 2) v.hard = v.hard || p.hard; else sam.push({ x: p.x, hard: p.hard }); });
    const uit = [];
    for (let i = 1; i < sam.length; i++) {
      const a = sam[i - 1], b = sam[i], isDirect = direct.some(s => Math.abs(s[0] - a.x) < 2 && Math.abs(s[1] - b.x) < 2);
      uit.push({ van: a.x, tot: b.x, waarde: rond(b.x - a.x, 1), status: isDirect ? 'gemeten' : (a.hard && b.hard ? 'afgeleid' : 'geschat') });
    }
    return uit;
  };
  // Maatketen langs een as: delen [a, b] met status; een restdeel is 'afgeleid' als alle andere delen en het totaal gemeten (of ingevoerd) zijn, anders 'geschat'.
  D.maatketen = function (totaal, totaalStatus, delen) {
    const hard = st => st === 'gemeten' || st === 'invoer' || st === 'afgeleid';   // afgeleid = uit gemeten maten berekend, dus ook hard
    const uit = [], som = delen.reduce((s, x) => s + x.waarde, 0), rest = totaal - som, allesHard = hard(totaalStatus) && delen.every(x => hard(x.status));
    let pos = 0;
    delen.forEach(x => { uit.push({ van: pos, tot: pos + x.waarde, waarde: x.waarde, status: x.status }); pos += x.waarde; });
    uit.push({ van: pos, tot: totaal, waarde: rond(rest, 1), status: allesHard ? 'afgeleid' : 'geschat', rest: true });
    return uit;
  };
  // Controlematen (bijv. diagonaal H4-H6) naast de waarde die het model verwacht.
  D.controleMaten = function (d, lm) {
    if (!lm) return [];
    const actueel = m => !lijst(d.metingen).some(x => x.vervangt === m.id);
    const diag = lijst(d.metingen).filter(m => m.veld === 'diagonaal' && m.doel && m.doel.extra && actueel(m)).map(m => {
      const a = lm.punten.find(p => p.id === m.doel.extra.van), b = lm.punten.find(p => p.id === m.doel.extra.naar);
      const verwacht = a && b ? rond(Math.hypot(b.x - a.x, b.y - a.y), 0) : null;
      return { soort: 'diagonaal', meting_id: m.id, van: a && a.label, naar: b && b.label, gemeten: m.waarde_mm, verwacht, verschil: verwacht == null || m.waarde_mm == null ? null : rond(m.waarde_mm - verwacht, 1), status: m.status, model_status: lm.status };
    });
    const wandpunten = lijst(d.metingen).filter(m => m.veld === 'controlemaat' && m.doel && m.doel.extra && actueel(m)).map(m => {
      const e = m.doel.extra, pa = D.puntOpWand(d, lm, e.a.wand_id, e.a.vanaf, e.a.afstand_mm), pb = D.puntOpWand(d, lm, e.b.wand_id, e.b.vanaf, e.b.afstand_mm);
      const verwacht = pa && pb ? rond(Math.hypot(pb.x - pa.x, pb.y - pa.y), 0) : null, naam = q => { const w = lijst(d.wanden).find(x => x.id === q.wand_id), h = lijst(d.hoeken).find(x => x.id === q.vanaf); return (w ? w.label : '?') + ' (' + q.afstand_mm + ' van ' + (h ? h.label : '?') + ')'; };
      return { soort: 'wandpunten', meting_id: m.id, van: naam(e.a), naar: naam(e.b), gemeten: m.waarde_mm, verwacht, verschil: verwacht == null || m.waarde_mm == null ? null : rond(m.waarde_mm - verwacht, 1), status: m.status, model_status: lm.status };
    });
    return diag.concat(wandpunten);
  };
  // Een punt op een wand in het lijnmodel: afstand_mm vanaf een van de twee hoeken van die wand. null als wand of hoek niet klopt.
  D.puntOpWand = function (d, lm, wandId, vanafHoek, afstand_mm) {
    const wi = lijst(d.wanden).findIndex(w => w.id === wandId), w = lijst(d.wanden)[wi]; if (!w || !lm || (vanafHoek !== w.van && vanafHoek !== w.naar)) return null;
    const n = lm.punten.length, a = lm.punten[wi], b = lm.punten[(wi + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, u = vanafHoek === w.naar ? L - afstand_mm : afstand_mm;
    return { x: a.x + (b.x - a.x) / L * u, y: a.y + (b.y - a.y) / L * u };
  };
  // Controlemaat tussen twee merktekens op de wanden (niet in de hoeken, zodat de laser er vrij bij kan). a en b: { wand_id, vanaf (hoek-id), afstand_mm }.
  D.voegControleToe = function (d, a, b, waarde_mm, info, nu) {
    info = info || {};
    return D.voegMetingToe(d, { doel: { soort: 'controle', id: d.ruimte.id, extra: { a: { wand_id: a.wand_id, vanaf: a.vanaf, afstand_mm: Number(a.afstand_mm) }, b: { wand_id: b.wand_id, vanaf: b.vanaf, afstand_mm: Number(b.afstand_mm) }, hoogte_mm: info.hoogte_mm || null } },
      veld: 'controlemaat', waarde_mm: waarde_mm, invoer: info.invoer || String(waarde_mm), eenheid_invoer: info.eenheid || null, bron: info.bron || 'hand', sessie: info.sessie || null,
      betekenis: 'merkteken tot merkteken, op gelijke hoogte' }, nu);
  };

  // ── wat staat er nog open? ── vóór vertrek per wand, opening en vast onderdeel; ook wat de vorm dubbelzinnig maakt en waar beeld ontbreekt.
  D.openVragen = function (d, AR, opties) {
    opties = opties || {};
    const uit = [], lm = D.lijnmodel(d, AR);
    if (lijst(d.hoeken).length < 3) uit.push({ soort: 'vorm', ernst: 'blokkeert', tekst: 'Nog geen omtrek: tik minstens drie hoeken aan.' });
    if (lm) {
      lm.segmenten.forEach(s => {
        if (s.lengte.status !== 'gemeten') uit.push({ soort: 'maat', ernst: 'open', doel: s.id, tekst: s.label + ': wandlengte nog niet gemeten (camera ~' + s.camera_mm + ' mm).' });
        if (s.kort) uit.push({ soort: 'vorm', ernst: 'let-op', doel: s.id, tekst: s.label + ' is kort (' + (s.lengte.waarde) + ' mm): de richting uit de camera is onzeker. Meet een controlemaat.' });
      });
      if (lm.schuin.length && !lijst(d.metingen).some(m => m.veld === 'diagonaal' && m.status === 'gemeten'))
        uit.push({ soort: 'vorm', ernst: 'let-op', tekst: 'Schuine wand(en) ' + lm.schuin.map(id => (lijst(d.wanden).find(w => w.id === id) || {}).label).join(', ') + ' zonder controlemaat: controleer de hoeken ervan met een driehoeksmeting (1000 mm langs elke wand en de schuine maat ertussen).' });
      if (lm.sluitfout_mm != null && lm.sluitfout_mm > 20) uit.push({ soort: 'vorm', ernst: 'let-op', tekst: 'De kamer sluit met de wandmaten op ' + Math.round(lm.sluitfout_mm) + ' mm: een maat of een haaks gezette hoek klopt niet. Meet een controlemaat tussen twee wanden (tape tot tape) of controleer een hoek met een driehoeksmeting.' });
      D.controleMaten(d, lm).forEach(c => { if (c.verschil != null && Math.abs(c.verschil) > 15) uit.push({ soort: 'vorm', ernst: 'let-op', tekst: 'Controlemaat ' + c.van + ' – ' + c.naar + ' wijkt ' + Math.round(c.verschil) + ' mm af van het model: een wandmaat of een haaks gezette hoek klopt niet.' }); });
      D.controleHoeken(d, lm).forEach(c => { if (c.verschil_graden != null && Math.abs(c.verschil_graden) > 0.5) uit.push({ soort: 'vorm', ernst: 'let-op', doel: c.hoek_id, tekst: 'Hoek ' + c.label + ' is volgens de driehoeksmeting ' + String(c.gemeten_graden).replace('.', ',') + '°, het model rekent met ' + String(c.model_graden).replace('.', ',') + '°: de kamer is daar niet haaks.' }); });
      lm.punten.forEach((p, i) => {
        const q = lm.punten[(i + 1) % lm.punten.length], h = p.binnenhoek_graden;
        if (h < 30 || h > 330) uit.push({ soort: 'vorm', ernst: 'let-op', doel: p.id, tekst: 'Hoek ' + p.label + ' is erg scherp (' + Math.round(h) + '°): waarschijnlijk dubbel of verkeerd getikt. Kijk de hoekfoto na of haal de hoek weg.' });
        if (Math.hypot(q.x - p.x, q.y - p.y) < 200) uit.push({ soort: 'vorm', ernst: 'let-op', doel: p.id, tekst: p.label + ' en ' + q.label + ' liggen minder dan 20 cm uit elkaar: mogelijk dezelfde hoek twee keer getikt.' });
      });
      if (lm.hoogte.status !== 'gemeten') uit.push({ soort: 'maat', ernst: 'open', doel: d.ruimte.id, tekst: 'Plafondhoogte nog niet gemeten' + (lm.hoogte.waarde ? ' (camera ~' + lm.hoogte.waarde + ' mm).' : '.') });
      lijst(d.wanden).forEach(w => { if (!w.dikte || w.dikte.status === 'onbekend') { /* een onbekende dikte blijft onbekend: dat is geen open vraag voor de opname zelf */ } });
    }
    D.actieveDetails(d).forEach(det => {
      const s = D.SOORTEN[det.soort] || D.SOORTEN.overig;
      const vel = det.soort === 'kozijn' ? D.kozijnVelden(det) : { verplicht: s.velden, optioneel: lijst(s.optioneel) };
      vel.verplicht.forEach(f => {
        if (lijst(vel.optioneel).indexOf(f) >= 0) return;   // optionele maat: geen open vraag
        const m = D.huidigeMeting(d, det.id, f), geschatMag = det.groep === 'meubilair';
        if (!m || m.status === 'open' || (m.status === 'geschat' && !geschatMag)) uit.push({ soort: 'maat', ernst: 'open', doel: det.id, veld: f, tekst: det.label + ': ' + D.VELDEN[f].label.toLowerCase() + ' nog niet gemeten.' });
      });
      const plekUitMaten = det.wand_id && (() => { const ml = D.maatLangsWand(d, det); return ml && !ml.onzeker; })();
      if (det.anker_status === 'alleen-foto' && !plekUitMaten) uit.push({ soort: 'plek', ernst: 'let-op', doel: det.id, tekst: det.label + ' is alleen op een foto aangewezen; de plek in de ruimte is nog niet bepaald.' });
      if (det.groep === 'materiaal' && !(det.materiaal && det.materiaal.code)) uit.push({ soort: 'materiaal', ernst: 'let-op', doel: det.id, tekst: det.label + ': materiaalcode onbekend (visuele benadering).' });
    });
    lijst(opties.dekking).forEach(x => { if (x.pct < 70) uit.push({ soort: 'beeld', ernst: 'let-op', doel: x.wand_id, tekst: x.label + ': maar ' + x.pct + '% in beeld. Draai daar nog even rond.' }); });
    lijst(d.beelden).filter(b => !b.bewaard).forEach(b => uit.push({ soort: 'opslag', ernst: 'blokkeert', doel: b.id, tekst: 'Beeld ' + b.id + ' is nog niet veilig opgeslagen.' }));
    return uit;
  };

  // ── het pakket ── dossier.json, LEESMIJ.txt en de beelden onder hun pad. bestanden: { pad: Uint8Array }. Het dossier krijgt een momentopname van het lijnmodel en de
  // open vragen mee, zodat een lezer zonder de rekenkern alles kan uitlezen. sha256 per beeld.
  D.maakPakket = async function (d, bestanden, opties) {
    opties = opties || {};
    const X = E(), kopie = JSON.parse(JSON.stringify(d)), entries = [], ontbreekt = [];
    for (const b of lijst(kopie.beelden)) {
      const data = bestanden && bestanden[b.pad];
      if (!data) { ontbreekt.push(b.pad); b.in_pakket = false; continue; }
      b.in_pakket = true; b.bytes = data.length; b.sha256 = X ? await X.sha256(data) : null;
      entries.push({ naam: b.pad, data });
    }
    for (const pad of Object.keys(bestanden || {})) if (pad.indexOf('panorama/') === 0) entries.push({ naam: pad, data: bestanden[pad] });
    const lmVol = opties.AR ? D.lijnmodel(d, opties.AR) : null, lm = lmVol ? Object.assign({}, lmVol) : null;
    if (lm) { delete lm._t; delete lm._model; }
    kopie.afgeleid = {
      gemaakt: isoNu(opties.nu), lijnmodel: lm,
      detail_plekken: lmVol ? D.actieveDetails(d).map(det => ({ detail_id: det.id, groep: det.groep, plek: D.detailPlek(d, det, lmVol) })) : [],
      controlematen: lm ? D.controleMaten(d, lm) : [], controlehoeken: lmVol ? D.controleHoeken(d, lmVol) : [], open_vragen: opties.AR ? D.openVragen(d, opties.AR, opties).filter(v => v.soort !== 'opslag') : [],
      panorama: Object.keys(bestanden || {}).filter(p => p.indexOf('panorama/') === 0),
      ontbrekende_beelden: ontbreekt
    };
    kopie.pakket = { schema: D.SCHEMA, versie: D.VERSIE, gemaakt: isoNu(opties.nu), app: opties.app || 'mt-ruimte-opname (proef)', bestanden: entries.length + 2 };
    entries.unshift({ naam: 'dossier.json', data: enc.encode(JSON.stringify(kopie, null, 1)) },
      { naam: 'LEESMIJ.txt', data: enc.encode(D.leesmij(kopie)) });
    return { entries, bytes: X ? X.zipBytes(entries, opties.nu ? new Date(opties.nu) : undefined) : null, dossier: kopie, ontbreekt };
  };
  D.leesmij = function (d) {
    return ['Ruimtelijke opname uit de MT tool (proef).', '', 'Project: ' + (d.project.code || '') + ' ' + (d.project.naam || ''), 'Ruimte: ' + d.ruimte.naam, '',
      'dossier.json        alles: hoeken, wanden, details, maten (met bron, status en tijd), opmerkingen, beelden met camerastand',
      '                    en onder "afgeleid" het lijnmodel in mm (oorsprong, assen, punten, wandsegmenten) en de open vragen',
      'beelden/overzicht/  beelden van de rondgang (voor het rondkijken)', 'beelden/detail/     detailfoto\'s op leesbare resolutie', 'panorama/           de wanden uit de beelden geplakt',
      '', 'Openen: docs/opname-ar-kijk.html (Rondkijken) > Bestand kiezen > deze zip.', 'Maten: mm. Assen: X langs de eerste wand, Y de kamer in, Z omhoog vanaf de afgewerkte vloer.', ''].join('\r\n');
  };
  // -> { fout, dossier, bestanden: { pad: Uint8Array }, meldingen }
  D.leesPakket = async function (bytes) {
    const X = E(); if (!X) return { fout: 'De zip-lezer ontbreekt.', dossier: null, bestanden: {}, meldingen: [] };
    let items; try { items = await X.leesZip(bytes); } catch (e) { return { fout: e.message || String(e), dossier: null, bestanden: {}, meldingen: [] }; }
    const j = items.find(x => x.naam === 'dossier.json');
    if (!j) return { fout: 'Dit is geen opnamepakket: dossier.json ontbreekt.', dossier: null, bestanden: {}, meldingen: [] };
    let d; try { d = JSON.parse(dec.decode(j.data)); } catch (e) { return { fout: 'dossier.json is geen geldige JSON.', dossier: null, bestanden: {}, meldingen: [] }; }
    if (!d || d.schema !== D.SCHEMA) return { fout: 'Dit is geen ruimtelijk opnamedossier.', dossier: null, bestanden: {}, meldingen: [] };
    if (Number(String(d.versie || '0').split('.')[0]) > Number(D.VERSIE.split('.')[0])) return { fout: 'Dit pakket komt uit een nieuwere versie (' + d.versie + ').', dossier: null, bestanden: {}, meldingen: [] };
    const bestanden = {}, meldingen = [];
    items.forEach(x => { bestanden[x.naam] = x.data; });
    for (const b of lijst(d.beelden)) {
      const data = bestanden[b.pad];
      if (!data) { if (b.in_pakket !== false) meldingen.push('Beeld ' + b.pad + ' ontbreekt in het pakket.'); continue; }
      if (b.sha256) { const h = await X.sha256(data); if (h && h !== b.sha256) meldingen.push('Beeld ' + b.pad + ' is beschadigd (controlesom klopt niet).'); }
    }
    lijst(d.afgeleid && d.afgeleid.ontbrekende_beelden).forEach(p => meldingen.push('Beeld ' + p + ' ontbrak al bij het maken van het pakket.'));
    return { fout: null, dossier: d, bestanden, meldingen };
  };

  // ── oude bestanden ── een panorama-JSON van de AR-proef (soort mt-ar-panorama, versie 1) als dossier, met de beelden uit hun data-URL's. Geeft { dossier, bestanden }.
  D.uitPanorama = function (obj, nu) {
    if (!obj || obj.soort !== 'mt-ar-panorama' || !Array.isArray(obj.punten)) throw new Error('dit is geen opname van de AR-proef');
    const d = D.nieuw({ ruimte: { naam: 'Ruimte uit AR-proef ' + (obj.tijd || '') } }, nu), s = D.startSessie(d, { bron: 'webxr-arcore (oud panoramabestand)' }, nu);
    s.xr.vloerY = Number(obj.vloerY) || 0; s.xr.plafondY = obj.plafondBekend ? s.xr.vloerY + Number(obj.hoogte) : null; s.xr.hoogte_aanname = obj.plafondBekend ? null : Number(obj.hoogte) || 2.6;
    D.zetHoeken(d, s.id, obj.punten, nu);
    const bestanden = {};
    lijst(obj.beelden).forEach((b, i) => {
      const bytes = D.dataUrlBytes(b.beeld), rec = D.voegBeeldToe(d, { soort: 'overzicht', sessie: s.id, pose: { pos: b.pos, dir: b.dir, pv: b.pv }, bewaard: !!bytes }, nu);
      if (bytes) bestanden[rec.pad] = bytes;
    });
    lijst(obj.wanden).forEach(w => { const bytes = D.dataUrlBytes(w.beeld), wand = d.wanden[w.nr]; if (bytes && wand) bestanden['panorama/' + wand.label + '.jpg'] = bytes; });
    if (obj.hand) Object.keys(obj.hand).forEach(k => { const w = d.wanden[Number(k)]; if (w) D.voegMetingToe(d, { doel: { soort: 'wand', id: w.id }, veld: 'lengte', waarde_mm: obj.hand[k], invoer: String(obj.hand[k]), bron: 'hand' }, nu); });
    return { dossier: d, bestanden };
  };
  D.dataUrlBytes = function (url) {
    const m = /^data:[^;,]*(;base64)?,(.*)$/.exec(String(url || '')); if (!m) return null;
    if (!m[1]) return enc.encode(decodeURIComponent(m[2]));
    const bin = typeof atob === 'function' ? atob(m[2]) : Buffer.from(m[2], 'base64').toString('binary'), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  // Groepen afzonderlijk opvragen (bijv. alle installaties, of alle materiaalvlakken).
  D.perGroep = function (d) {
    const uit = {}; Object.keys(D.GROEPEN).forEach(g => { uit[g] = []; });
    D.actieveDetails(d).forEach(det => { (uit[det.groep] = uit[det.groep] || []).push(det); });
    return uit;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
