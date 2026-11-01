// mt-opname-kern.js — rekenkern en datamodel van de nieuwe opname-module (opname-JSON v0.4), zonder DOM en zonder netwerk.
// Een telefoon-opname van een bestaande ruimte: wand voor wand foto's plus gemeten maten, waaruit later in Vectorworks een maatvaste ruimte gescript wordt.
// Grootste pijn (Bart, 31-10): onvolledige opnames, net dat ene stopcontact of die deurmaat gemist en dan 3x terug. Gemeten maten zijn leidend; een
// schatting uit de foto is alleen een grijs voorstel (voorstel) en telt nooit als meting.
// Brok 1 (alleen de kern): vragenlijst uit ruimte + werkzone, de geordende route (punt voor punt), tellers, vorm en sluitcontrole (geen rechthoek veronderstellen), rondje controle, vrijgeef-check met scope en uitzonderingen,
// vrijgave gekoppeld aan een inhoudshash, takenlijst en veilig lezen/migreren. Review 1-11: Bart (volgorde fotoronde dan rondloop) en ChatGPT (GESPREK 035, punten A tot en met I).
// Spelregels: er wordt niets automatisch gecorrigeerd en niets geforceerd haaks; een wijziging wist nooit stil een eerdere maat (historie, append-only);
// onbekende velden blijven bij het lezen behouden. Alle functies geven nieuwe objecten terug en passen hun invoer niet aan.
// Het prototype (src-v3.html in OPNAME-APP) is de bron van de vragen en de sluitcontrole; de uitkomsten voor kamer Joe zijn in de tests vastgelegd.
// Brok 3 (v0.4, Bart 1-11): de vorm van de kamer ontstaat uit de foto's. Een ruimte heeft een geordende lijst wanden (zoveel als er foto's zijn, met de klok mee), met per wand de hoek naar de
// volgende wand (standaard 90 graden, een aanname), uitsprongen en nissen als onderdeel van een wand en de knikken die op de foto zijn aangetikt. De vier vaste wanden N/O/Z/W van v0.3 zijn
// het bijzondere geval van vier wanden en blijven werken (migratie zonder verlies). De plattegrond (K.plattegrond) tekent schattingen en metingen apart en schaalt mee met wat gemeten is.
(function (root) {
  'use strict';
  const K = root.MTOpnameKern = root.MTOpnameKern || {};

  // ── Vaste lijsten ──
  K.VERSIE = '0.4';
  K.MIN_LEESBAAR = '0.3';                                                // 0.3 wordt additief aangevuld; ouder blijft volledig bewaard onder _oud
  K.WANDEN = ['N', 'O', 'Z', 'W'];                                       // de vaste wanden van v0.3 (compat): N loopt van NW naar NO, O van NO naar ZO, Z van ZO naar ZW, W van ZW naar NW. Een ruimte uit de foto's heeft eigen wanden W1, W2, ...
  K.HOEK_BRONNEN = ['aanname', 'foto-voorstel', 'gemeten'];               // de hoek naar de volgende wand: standaard een aanname (90 graden), nooit stil "haaks"
  K.UITSPRONG_SOORTEN = { voor: 'Uitsprong', achter: 'Nis' };            // naar voren (schoorsteen, pilaster, koker) of naar achteren (nis, inham)
  K.TUSSENSTUK_VORMEN = ['recht', 'voor', 'achter'];
  K.UITSPRONG_DIEPTE_STANDAARD = 300;                                    // mm: grove standaardschatting zolang er niets gemeten is; altijd een foto-voorstel, nooit een meting
  K.STATEN = ['gemeten', 'nvt', 'later', 'open'];
  K.BRONNEN = ['disto', 'hand', 'foto-voorstel'];                        // een meting (staat gemeten) is disto of hand; foto-voorstel hoort alleen in het grijze voorstel
  K.MEUBELTYPES = ['kast', 'keuken', 'badmeubel'];
  K.DEFINITIES = { muursparing: 'muursparing', dagmaat: 'dagmaat', 'kozijn-buiten': 'kozijn buiten' };
  K.BIJZONDERHEDEN = { stootplint: 'Hogere stootplint', balk: 'Ingestucte balk of verlaging', koof: 'Koof', nis: 'Nis', 'uit-het-lood': 'Uit het lood', 'leiding-in-zicht': 'Leiding in zicht', kabelgoot: 'Kabelgoot', anders: 'Anders' };
  // Toleranties. diagonaal: de gemeten controlediagonaal tegen de diagonaal die uit 4 zijden + 1 diagonaal volgt (mm). tegenover en hoek_graden: pas boven deze waarden is de ruimte
  // 'afwijkend van vorm' (informatie, geen fout). Er wordt geen rechthoek verondersteld.
  K.TOLERANTIE = { diagonaal: 10, tegenover: 5, hoek_graden: 0.3, wand_scheef: 5, wand_scheef_onwaarschijnlijk: 100, sluit: 10, hoek_haaks: 0.5 };      // sluit: sluitfout van een veelhoek (mm); hoek_haaks: zo dicht bij 90 of 270 graden telt als haaks
  K.PLAFOND_UIT_HOEK = 300;                                              // mm: het plafond links en rechts langs een werkzone-wand wordt zo ver uit de hoek gemeten (regie, 1-11)
  K.RONDJE_LATER_BLOKKEERT = true;                                       // een categorie van het rondje op "later" is een open taak en blokkeert het vrijgeven (Bart, 1-11)
  K.WANDBEVESTIGING = ['bekeken', 'afgedekt', 'niet-beoordeeld'];          // buiten de werkzone: "gehele wand bekeken, geen relevante obstakels" of bewust afgedekt / niet beoordeeld
  K.ROUTE_VOLGORDES = ['fotos-dan-rondloop', 'rondloop', 'per-soort'];
  // Vragensets per meubeltype. Alleen 'kast' is een echte, gevalideerde set (ChatGPT-review 035, punt I). Voor keuken en badmeubel is er een hook (extraSlots) maar nog geen set:
  // zo'n ruimte kan niet vrijgegeven worden en de app claimt geen keuken- of badmeubelvragen.
  K.MEUBELSETS = { kast: { gereed: true }, keuken: { gereed: false, extraSlots: null }, badmeubel: { gereed: false, extraSlots: null } };
  const LEGACY = K.WANDEN.slice();
  const WAND_NAAM = { N: 'noord', O: 'oost', Z: 'zuid', W: 'west' };
  const WAND_VAN_NAAR = { N: ['NW', 'NO'], O: ['NO', 'ZO'], Z: ['ZO', 'ZW'], W: ['ZW', 'NW'] };
  const HOEK_NAAM = { NW: 'noordwesthoek', NO: 'noordoosthoek', ZO: 'zuidoosthoek', ZW: 'zuidwesthoek' };
  const hoofd = t => t.charAt(0).toUpperCase() + t.slice(1);
  const wandNummer = w => { const m = /^W(\d+)$/.exec(String(w)); return m ? parseInt(m[1], 10) : null; };
  const wandKort = w => WAND_NAAM[w] || (wandNummer(w) ? 'wand ' + wandNummer(w) : String(w));              // "noord" of "wand 2": in lopende tekst, bijvoorbeeld na "wandlengte"
  const wandMetWoord = w => WAND_NAAM[w] ? 'Wand ' + WAND_NAAM[w] : K.wandNaam(w);                                         // "Wand noord" of "Wand 2"
  const wandTekst = w => WAND_NAAM[w] ? WAND_NAAM[w] + 'wand' : wandNummer(w) ? 'wand ' + wandNummer(w) : String(w);      // "noordwand" of "wand 2"
  K.wandNaam = w => WAND_NAAM[w] ? hoofd(WAND_NAAM[w]) : wandNummer(w) ? 'Wand ' + wandNummer(w) : String(w);          // "Noord" of "Wand 2"
  K.wandLabel = w => WAND_NAAM[w] ? hoofd(WAND_NAAM[w]) + 'wand' : K.wandNaam(w);                                       // "Noordwand" of "Wand 2"
  const hoekTekst = h => HOEK_NAAM[h] ? HOEK_NAAM[h] : /^H(\d+)$/.test(String(h)) ? 'hoek ' + String(h).slice(1) : String(h);

  // Rondje controle: per werkzone-wand en categorie kiest de opnemer bewust. Niet gekozen = "nog niet bekeken", nooit "afwezig".
  K.RONDJE_CATEGORIEEN = [['kozijn', 'Deuren en ramen'], ['elektra', 'Elektra'], ['water', 'Water, afvoer en leidingen'], ['radiator', 'Verwarming'], ['plint', 'Plinten'], ['afw', 'Afwijkingen']];
  K.RONDJE_KEUZES = ['aanwezig', 'afwezig', 'later'];                    // aanwezig en vastgelegd / niet aanwezig of n.v.t. / later meten

  // Catalogus van objecten: per type de categorie voor het rondje en de maten die gevraagd worden (sleutel, kort, vraag, definitie).
  const DEF = {
    hart_h: 'Hart van het object tot de afgewerkte vloer.',
    hart_a: 'Hart tot de dichtstbijzijnde hoek, horizontaal gemeten langs de wand.',
    afdek: 'Buitenmaat van het afdekraam (het frame om het object), breedte.',
    rad_b: 'Buitencontour inclusief kraan en leiding: de breedte van het geheel.', rad_h: 'Buitencontour inclusief kraan en leiding: bovenkant tot onderkant.', rad_o: 'Onderkant van het geheel (paneel, kraan of leiding) tot afgewerkte vloer.',
    rad_u: 'Uitsteek: hoever het geheel, kraan en leiding meegerekend, uit de muur steekt.', rad_bereik: 'Is de radiator bereikbaar (kranen, ontluchten, onderhoud) als het meubel er komt: vrij, beperkt of geblokkeerd?',
    vb_h: 'Bovenkant vensterbank tot afgewerkte vloer.', vb_d: 'Diepte van de vensterbank, vanaf de muur tot de voorrand.', vb_t: 'Dikte van de vensterbank bij de voorrand.', vb_o: 'Overstek: hoever de vensterbank links en rechts buiten de opening uitsteekt.',
    plint_h: 'Bovenkant plint tot afgewerkte vloer.', plint_d: 'Dikte van de plint: hoever hij uit de muur steekt.', plint_k: 'Blijft de plint zitten bij het nieuwe meubel, of gaat hij weg? Dit bepaalt of de kast ervoor of erover valt.',
    leiding_a: 'Hart van de leiding tot de dichtstbijzijnde hoek, horizontaal gemeten.', leiding_d: 'Buitenmaat van de leiding, zonder isolatie of mantel.', kraan: 'Hart van de kraan of afsluiter tot de afgewerkte vloer. Zit er geen kraan op, kies niet van toepassing.',
    overig: 'Noteer wat het is en meet de maat die voor het meubel telt.'
  };
  const hartMaten = [['hoogte', 'hoogte', 'hoe hoog zit het hart?', DEF.hart_h], ['afstand', 'afstand tot hoek', 'hoe ver zit het hart van de hoek?', DEF.hart_a], ['afdek', 'afdekraam', 'hoe breed is het afdekraam?', DEF.afdek]];
  K.OBJECTTYPES = {
    stopcontact: { naam: 'Stopcontact', cat: 'elektra', maten: hartMaten },
    schakelaar: { naam: 'Schakelaar', cat: 'elektra', maten: hartMaten },
    leiding: { naam: 'Leiding', cat: 'water', maten: [['afstand', 'afstand tot hoek', 'hoe ver zit het hart van de hoek?', DEF.leiding_a], ['diameter', 'diameter', 'wat is de diameter?', DEF.leiding_d], ['kraan', 'kraanhoogte', 'hoe hoog zit de kraan of afsluiter boven de vloer?', DEF.kraan]] },
    radiator: { naam: 'Radiator', cat: 'radiator', maten: [['breedte', 'breedte', 'hoe breed is de radiator?', DEF.rad_b], ['hoogte', 'hoogte', 'hoe hoog is de radiator?', DEF.rad_h], ['onderkant', 'onderkant', 'hoe hoog zit de onderkant boven de vloer?', DEF.rad_o], ['uitsteek', 'uitsteek', 'hoever steekt de radiator met kraan en leiding uit de muur?', DEF.rad_u], ['bereikbaarheid', 'bereikbaarheid', 'is de radiator bereikbaar?', DEF.rad_bereik, ['vrij', 'beperkt', 'geblokkeerd']]] },
    vensterbank: { naam: 'Vensterbank', cat: 'kozijn', maten: [['diepte', 'diepte', 'hoe diep is de vensterbank?', DEF.vb_d], ['dikte', 'dikte', 'hoe dik is de vensterbank?', DEF.vb_t], ['overstek', 'overstek', 'hoever steekt de vensterbank uit?', DEF.vb_o]],
      zonderOpening: [['hoogte', 'hoogte', 'hoe hoog zit de bovenkant boven de vloer?', DEF.vb_h]] },          // zonder gekoppelde opening komt de hoogte erbij (anders is die de borstwering van het raam)
    plint: { naam: 'Plint', cat: 'plint', maten: [['hoogte', 'hoogte', 'hoe hoog is de plint?', DEF.plint_h], ['dikte', 'dikte', 'hoe dik is de plint?', DEF.plint_d], ['keuze', 'blijft of gaat weg', 'blijft de plint zitten of gaat hij weg?', DEF.plint_k, ['blijft', 'gaat-weg']]] },
    overig: { naam: 'Overig', cat: 'afw', maten: [['maat', 'maat', 'welke maat wil je hier vastleggen?', DEF.overig]] }
  };

  // ── Hulpfuncties ──
  const kloon = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const lijst = x => Array.isArray(x) ? x : [];
  const eigen = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const getal = x => typeof x === 'number' && isFinite(x);
  const nu = () => new Date().toISOString();
  const vind = (arr, id) => lijst(arr).find(e => e && e.id === id);

  // ── De wanden van een ruimte (v0.4: zoveel als er foto's zijn) ──
  // De lijst r.wanden is de geordende segmentenlijst: met de klok mee, de eerste wand is de wand van de toegangsdeur. De vaste wanden N/O/Z/W van v0.3 staan altijd in die vaste volgorde.
  // Een ruimte uit de foto's (nieuweRuimte met wanden: []) heeft rond: false tot de gebruiker "kamer rond" kiest; een ruimte zonder dat veld is een gesloten ring (v0.3).
  function wandIds(r) {
    const ids = lijst(r && r.wanden).filter(e => e && e.id).map(e => e.id);
    return ids.length && ids.every(i => LEGACY.includes(i)) ? LEGACY.filter(i => ids.includes(i)) : ids;
  }
  K.wandIds = wandIds;
  const isRond = r => !r || r.rond !== false;
  K.isRond = isRond;
  const wandHoeken = (r, w) => { const e = vind(r && r.wanden, w); return e && e.van && e.naar ? [e.van, e.naar] : (WAND_VAN_NAAR[w] || [null, null]); };
  // De hoek naar de volgende wand: de binnenhoek in graden (90 = gewone hoek, 270 = inspringende hoek). Zonder gegevens is het 90 en een aanname: er wordt nergens stil "haaks" van gemaakt.
  function hoekInfo(r, w) {
    const e = vind(r && r.wanden, w), h = e && isObj(e.hoek_naar_volgende) ? e.hoek_naar_volgende : null, graden = h && getal(h.graden) ? h.graden : 90, bron = h && K.HOEK_BRONNEN.includes(h.bron) ? h.bron : 'aanname';
    const t = K.TOLERANTIE.hoek_haaks, recht = Math.abs(graden - 90) <= t, inspringend = Math.abs(graden - 270) <= t;
    return { graden, bron, haaks: recht || inspringend, inspringend, schuin: !(recht || inspringend) };
  }
  K.hoekVan = (ruimte, wand) => hoekInfo(ruimte, wand);

  // ── Constructors ──
  // Een maat (punt): waarde in mm, staat, bron, tijdstip en eventueel een grijs foto-voorstel. Alleen de aanwezige velden worden gezet.
  K.nieuweMaat = function (over) { return Object.assign({ staat: 'open', waarde: null, bron: null, tijd: null }, over || {}); };
  const legeMaten = () => ({});
  // nieuweRuimte({ wanden: [] }) maakt een ruimte uit de foto's: nog geen wanden en rond: false. Zonder wanden-veld krijgt de ruimte de vier vaste wanden van v0.3.
  K.nieuweRuimte = function (o) {
    o = o || {};
    const uitFotos = Array.isArray(o.wanden) && !o.wanden.length;
    const r = { id: o.id || 'R1', naam: o.naam || 'Ruimte', meubeltype: o.meubeltype || 'kast', werkzone: lijst(o.werkzone),
      wanden: Array.isArray(o.wanden) ? o.wanden : [], plafondpunten: [], diagonalen: [], openingen: lijst(o.openingen), objecten: lijst(o.objecten), bijzonderheden: lijst(o.bijzonderheden), rondje: isObj(o.rondje) ? o.rondje : {} };
    if (uitFotos) r.rond = false;
    if (o.uitsprongen) r.uitsprongen = lijst(o.uitsprongen);
    if (o.toegangsdeur) r.toegangsdeur = o.toegangsdeur;                  // id van de opening waar je de ruimte binnenkomt: daar begint de fotoronde
    zorgEntiteiten(r);
    r.werkzone = r.werkzone.filter(w => wandIds(r).includes(w));
    return r;
  };
  K.nieuweOpname = function (o) {
    o = o || {};
    return { schema: 'mt-opname', versie: K.VERSIE, opname_id: o.opname_id || o.id || null, project: Object.assign({ code: null }, o.project || {}), status: o.status || 'concept',
      aangemaakt: o.aangemaakt || nu(), bijgewerkt: o.bijgewerkt || null, ruimtes: lijst(o.ruimtes).length ? o.ruimtes : [K.nieuweRuimte()], fotos: lijst(o.fotos) };
  };
  // Zorgt dat de vaste onderdelen bestaan (de vaste wanden van v0.3 als de ruimte niet uit de foto's komt, bij precies vier wanden de diagonalen A en B, plafondpunt P1).
  // Voegt alleen toe, verwijdert nooit iets. Bij vier wanden loopt A van de eerste naar de derde hoek en B van de tweede naar de vierde (N/O/Z/W: NW naar ZO en NO naar ZW).
  function zorgEntiteiten(r) {
    r.wanden = lijst(r.wanden); r.plafondpunten = lijst(r.plafondpunten); r.diagonalen = lijst(r.diagonalen);
    if (r.rond !== false && r.wanden.filter(e => e && e.id).every(e => LEGACY.includes(e.id))) for (const w of LEGACY) if (!vind(r.wanden, w)) r.wanden.push({ id: w, van: WAND_VAN_NAAR[w][0], naar: WAND_VAN_NAAR[w][1], maten: legeMaten() });
    const ids = wandIds(r);
    if (ids.length === 4) for (const [id, i, j] of [['A', 0, 2], ['B', 1, 3]]) if (!vind(r.diagonalen, id)) r.diagonalen.push({ id, van: wandHoeken(r, ids[i])[0], naar: wandHoeken(r, ids[j])[0], maten: legeMaten() });
    if (!r.plafondpunten.length) r.plafondpunten.push({ id: 'P1', plaats: 'midden', maten: legeMaten() });
    return r;
  }

  // ── Een maat lezen ──
  // Een geldige meting: staat gemeten, bron disto of hand, en een waarde > 0 (of een geldige keuze). Een foto-voorstel is nooit een meting.
  function geldigeMeting(m, keuzes) {
    if (!isObj(m) || m.staat !== 'gemeten' || (m.bron !== 'disto' && m.bron !== 'hand')) return false;
    return keuzes ? keuzes.includes(m.keuze) : getal(m.waarde) && m.waarde > 0;
  }
  K.waarde = m => geldigeMeting(m) ? m.waarde : null;
  const staatVan = (m, keuzes) => !isObj(m) ? 'open' : m.staat === 'gemeten' ? (geldigeMeting(m, keuzes) ? 'gemeten' : 'open') : (m.staat === 'nvt' || m.staat === 'later') ? m.staat : 'open';
  const maatOp = (ent, sleutel) => ent && isObj(ent.maten) && eigen(ent.maten, sleutel) ? ent.maten[sleutel] : null;

  // ── De vragenlijst ──
  // Elke plek waar een maat kan staan is een "slot" met een stabiel pad (bijvoorbeeld wanden.N.maten.lengte). bucket: basis | optie | werkzone | extra | null
  // (null = bestaat wel, maar wordt niet gevraagd, bijvoorbeeld een stopcontact buiten de werkzone dat de app alleen "gezien" heeft).
  // Waar de maat vandaan gemeten wordt (kort): hoek | vloerpeil | zijkanten | boven-onder | opening | object | wand
  function refVan(s) {
    if (s.soort === 'wandbevestiging') return 'wand';
    if (s.eenheid === 'keuze') return 'object';
    if (s.sleutel.indexOf('plafond_') === 0) return 'vloerpeil';
    if (s.pad.startsWith('wanden.') || s.pad.startsWith('diagonalen.')) return 'hoek';
    if (s.pad.startsWith('plafondpunten.')) return 'vloerpeil';
    if (s.pad.startsWith('uitsprongen.')) return s.sleutel === 'breedte' ? 'zijkanten' : s.sleutel === 'positie' ? 'hoek' : s.sleutel === 'hoogte' ? 'vloerpeil' : 'wand';
    if (s.pad.startsWith('openingen.')) return s.sleutel === 'breedte' ? 'zijkanten' : s.sleutel === 'hoogte' ? 'boven-onder' : s.sleutel === 'borstwering' ? 'vloerpeil' : (s.ent.positie_vanaf && s.ent.positie_vanaf !== 'hoek' ? 'opening' : 'hoek');
    if (s.sleutel === 'kraan' || s.sleutel === 'onderkant') return 'vloerpeil';
    if (s.sleutel === 'hoogte') return s.ent.type === 'radiator' ? 'object' : 'vloerpeil';
    return s.sleutel === 'afstand' ? 'hoek' : 'object';
  }
  function openingNaam(o) { return (o.soort === 'deur' ? 'deur ' : 'raam ') + (o.naam || o.id); }
  function uitsprongNaam(u) { return (K.UITSPRONG_SOORTEN[u.soort] || 'Uitsprong').toLowerCase() + ' ' + (u.naam || u.id); }
  // Wat de kern van een uitsprong of nis weet, per maat: gemeten, anders een voorstel uit de foto (de verhouding op de wand maal de GEMETEN wandlengte), anders voor de diepte een standaardschatting.
  // Is de wandlengte nog niet gemeten, dan is er geen voorstel in mm (wel een verhouding): met Lref (de lengte uit de plattegrond) rekent de plattegrond toch een schatting uit, als schatting herkenbaar.
  // Alles wat hier uit de foto komt heeft bron foto-voorstel en telt nooit als meting; het schaalt vanzelf mee zodra de wandlengte of de maat zelf gemeten is.
  function uitsprongWaarden(r, u, Lref) {
    const we = vind(r.wanden, u.wand), L = we ? K.waarde(maatOp(we, 'lengte')) : null, v = isObj(u.verhouding) && getal(u.verhouding.van) && getal(u.verhouding.tot) ? u.verhouding : null;
    const uit = { soort: u.soort === 'achter' ? 'achter' : 'voor' };
    const kies = (sleutel, uitFoto) => {
      const gem = K.waarde(maatOp(u, sleutel));
      if (gem != null) return { mm: gem, gemeten: true, bron: 'gemeten' };
      if (uitFoto != null && L != null) return { mm: Math.round(uitFoto(L)), gemeten: false, bron: 'voorstel', voorstel: { schatting_mm: Math.round(uitFoto(L)), bron: 'foto-voorstel', tijd: u.tijd || null, afgeleid: 'verhouding op de gemeten wandlengte' } };
      if (uitFoto != null && Lref != null) return { mm: Math.round(uitFoto(Lref)), gemeten: false, bron: 'schatting' };
      return null;
    };
    uit.positie = v ? kies('positie', l => v.van * l) : kies('positie', null);
    uit.breedte = v ? kies('breedte', l => (v.tot - v.van) * l) : kies('breedte', null);
    const dg = K.waarde(maatOp(u, 'diepte'));
    uit.diepte = dg != null ? { mm: dg, gemeten: true, bron: 'gemeten' } : { mm: K.UITSPRONG_DIEPTE_STANDAARD, gemeten: false, bron: 'standaard', voorstel: { schatting_mm: K.UITSPRONG_DIEPTE_STANDAARD, bron: 'foto-voorstel', tijd: u.tijd || null, afgeleid: 'standaardschatting' } };
    const hg = K.waarde(maatOp(u, 'hoogte'));
    uit.hoogte = hg != null ? { mm: hg, gemeten: true, bron: 'gemeten' } : null;
    return uit;
  }
  function slotsVan(ruimte) {
    const r = ruimte || {}, ids = wandIds(r), zone = lijst(r.werkzone).filter(w => ids.includes(w)), inZone = w => zone.includes(w), out = [];
    const tijdelijk = (arr, id, rest) => vind(arr, id) || Object.assign({ id, maten: {} }, rest);          // ontbreekt een vast onderdeel, dan telt het als open zonder iets te schrijven
    const slot = (pad, ent, sleutel, bucket, o) => { const s = Object.assign({ pad, ent, sleutel, bucket, soort: 'maat', groep: 'maat', wand: null, object: null, eenheid: 'mm', keuzes: null, nvtKeuzes: null, definitie: '', uitleg: '', referentie: '', kritiek: false }, o); s.referentie = refVan(s); out.push(s); };
    // basis: de wandlengtes; buiten de werkzone daarbij één bevestiging per wand ("gehele wand bekeken, geen relevante obstakels", of afgedekt / niet beoordeeld)
    for (const w of ids) {
      const we = tijdelijk(r.wanden, w, { van: wandHoeken(r, w)[0], naar: wandHoeken(r, w)[1] });
      slot('wanden.' + w + '.maten.lengte', we, 'lengte', 'basis', { soort: 'wandlengte', wand: w, kort: 'Wandlengte ' + wandKort(w),
        vraag: 'Hoe lang is de ' + wandTekst(w) + ', van hoek tot hoek?', uitleg: 'Hoek tot hoek, afgewerkt tot afgewerkt, op 1000 mm boven de vloer.' + (inZone(w) ? ' Bij een werkzone-wand is dit de middelste van drie hoogtes.' : ''), kritiek: true });
      if (inZone(w)) {
        // werkzone-wand: de wandlengte ook net boven de plint en net onder het plafond (samen met de lengte op 1000 mm drie hoogtes) en het plafond op drie punten langs de wand
        for (const [sl, k, waar] of [['lengte_onder', 'onder', 'net boven de plint'], ['lengte_boven', 'boven', 'net onder het plafond']]) slot('wanden.' + w + '.maten.' + sl, we, sl, 'werkzone', { soort: 'wandlengte', wand: w, kort: 'Wandlengte ' + wandKort(w) + ' ' + k,
          vraag: 'Hoe lang is de ' + wandTekst(w) + ' ' + waar + ', van hoek tot hoek?', uitleg: 'Dezelfde meting als de wandlengte op 1000 mm, nu ' + waar + '. Een kast raakt de wand over de hele hoogte.', kritiek: true });
        for (const pl of ['links', 'midden', 'rechts']) slot('wanden.' + w + '.maten.plafond_' + pl, we, 'plafond_' + pl, 'werkzone', { soort: 'wandplafond', wand: w, kort: 'Plafondhoogte ' + wandKort(w) + ' ' + pl,
          vraag: 'Hoe hoog is het plafond ' + (pl === 'midden' ? 'in het midden van' : K.PLAFOND_UIT_HOEK + ' mm uit de ' + (pl === 'links' ? 'linker' : 'rechter') + 'hoek op') + ' de ' + wandTekst(w) + ' (kijkend naar de wand)?', uitleg: 'Afgewerkte vloer tot afgewerkt plafond, ' + (pl === 'midden' ? 'in het midden van de wand.' : 'op ' + K.PLAFOND_UIT_HOEK + ' mm van de ' + (pl === 'links' ? 'linker' : 'rechter') + 'hoek, gemeten langs de wand.'), kritiek: true });
      }
      if (!inZone(w)) slot('wanden.' + w + '.maten.bevestiging', we, 'bevestiging', 'basis', { soort: 'wandbevestiging', wand: w, eenheid: 'keuze', keuzes: ['bekeken'], nvtKeuzes: ['afgedekt', 'niet-beoordeeld'], kort: wandMetWoord(w) + ' bekeken',
        vraag: 'Is de ' + wandTekst(w) + ' helemaal bekeken, zonder relevante obstakels?', uitleg: 'Kies "bekeken" als de hele wand in beeld was en er niets zit dat het meubel raakt. Is de wand afgedekt of niet beoordeeld, kies dat dan: het komt zo in het rapport.' });
    }
    // basis: plafondhoogte op één punt (het eerste punt); verdere punten zijn extra
    const pp = lijst(r.plafondpunten).length ? lijst(r.plafondpunten) : [tijdelijk([], 'P1', { plaats: 'midden' })];
    pp.forEach((p, i) => {
      const waar = p.wand ? 'bij de ' + wandTekst(p.wand) : p.plaats ? 'bij ' + p.plaats : 'op punt ' + p.id;
      slot('plafondpunten.' + p.id + '.maten.hoogte', p, 'hoogte', i === 0 ? 'basis' : 'extra', { soort: 'plafond', wand: p.wand || null, kort: 'Plafondhoogte ' + p.id, vraag: 'Hoe hoog is het plafond ' + waar + '?',
        uitleg: 'Afgewerkte vloer tot afgewerkt plafond.', kritiek: true });
    });
    // diagonalen. Bij precies vier wanden: A is basis en B optioneel (maar telt, als hij is ingevuld, mee in de controle en het vrijgeven). Bij een andere vorm zijn diagonalen altijd optioneel:
    // alleen de diagonalen die de opnemer zelf toevoegde (K.voegDiagonaalToe), als extra controle van de vorm.
    const hoeken = ids.map(w => wandHoeken(r, w)[0]), diagonalen = [];
    if (ids.length === 4) [['A', 0, 2, 'basis'], ['B', 1, 3, 'optie']].forEach(([id, i, j, bucket]) => diagonalen.push([id, tijdelijk(r.diagonalen, id, { van: hoeken[i], naar: hoeken[j] }), bucket]));
    // een A of B uit de tijd dat er vier wanden waren, zonder meting, is niets meer waard bij een andere vorm: die vraag komt niet terug
    for (const d of lijst(r.diagonalen)) if (d && d.id && !(ids.length === 4 && (d.id === 'A' || d.id === 'B')) && hoeken.includes(d.van) && hoeken.includes(d.naar) && !((d.id === 'A' || d.id === 'B') && !isObj(maatOp(d, 'lengte')))) diagonalen.push([d.id, d, 'optie']);
    for (const [id, d, bucket] of diagonalen) {
      slot('diagonalen.' + id + '.maten.lengte', d, 'lengte', bucket, { soort: 'diagonaal', groep: 'ruimte', kort: 'Diagonaal ' + id,
        vraag: 'Hoe lang is de diagonaal van de ' + hoekTekst(d.van) + ' naar de ' + hoekTekst(d.naar) + '?', uitleg: 'Hoek tot hoek op 1000 mm boven de vloer, afgewerkt.', kritiek: true });
    }
    // uitsprongen en nissen (v0.4): breedte, positie vanaf de linkerhoek en diepte zijn basis (ze bepalen de plattegrond); de hoogte hoort bij de werkzone-wanden.
    // Het grijze voorstel komt uit de foto: de verhouding op de wand maal de gemeten wandlengte, en voor de diepte een standaardschatting. Nooit een meting.
    for (const u of lijst(r.uitsprongen)) {
      if (!u || !u.id || !ids.includes(u.wand)) continue;
      const w = u.wand, nm = uitsprongNaam(u), wz = inZone(w), zijde = wandHoeken(r, w), vals = uitsprongWaarden(r, u, null), achter = u.soort === 'achter', woord = achter ? 'nis' : 'uitsprong';
      const up = (bucket, sleutel, kort, vraag, uitleg, voorstel) => slot('uitsprongen.' + u.id + '.maten.' + sleutel, u, sleutel, bucket, { soort: 'uitsprong', groep: 'uitsprong', wand: w, object: u.id, kort: u.id + ' ' + kort, vraag, uitleg, kritiek: true, afleiding: voorstel || null });
      up('basis', 'breedte', 'breedte', 'Hoe breed is de ' + nm + ' (langs de wand, aan de voorkant)?', 'De twee zijkanten van de ' + woord + ', gemeten langs de wand.', vals.breedte && vals.breedte.voorstel);
      up('basis', 'positie', 'positie', 'Hoe ver zit de ' + nm + ' van de ' + (zijde[0] ? hoekTekst(zijde[0]) : 'linkerhoek') + ', tot de zijkant?', 'Vaste hoek (' + (zijde[0] ? hoekTekst(zijde[0]) : 'linkerhoek') + ') tot de eerste zijkant, langs de wand.', vals.positie && vals.positie.voorstel);
      up('basis', 'diepte', 'diepte', achter ? 'Hoe diep is de ' + nm + ' (de inham in de wand)?' : 'Hoe ver steekt de ' + nm + ' uit de wand?', 'Haaks op de wand: van de wandlijn tot de ' + (achter ? 'achterkant van de nis' : 'voorkant van de uitsprong') + '.', vals.diepte && vals.diepte.voorstel);
      if (wz) up('werkzone', 'hoogte', 'hoogte', 'Hoe hoog is de ' + nm + ', van de vloer tot de bovenkant?', 'Afgewerkte vloer tot de bovenkant van de ' + woord + ' (een schoorsteen of koker loopt vaak door tot het plafond).', null);
    }
    // openingen: breedte en positie vanaf de linkerhoek (kijkend naar de wand) zijn basis. Hoogte en borstwering zijn verplicht in de werkzone, daarbuiten optioneel (grijs voorstel);
    // de positie tot de rechterhoek hoort bij de werkzone.
    for (const o of lijst(r.openingen)) {
      if (!o || !o.id) continue;
      const w = o.wand, nm = openingNaam(o), df = K.DEFINITIES[o.definitie] || 'opening', zijde = wandHoeken(r, w), wz = inZone(w), detail = wz ? 'werkzone' : 'optie';
      const van = o.positie_vanaf && o.positie_vanaf !== 'hoek' ? o.positie_vanaf : (zijde[0] ? hoekTekst(zijde[0]) : 'de linkerhoek');
      const op = (bucket, sleutel, kort, vraag, uitleg, extra) => slot('openingen.' + o.id + '.maten.' + sleutel, o, sleutel, bucket, Object.assign({ soort: 'opening', groep: 'kozijn', wand: w, object: o.id, kort: o.id + ' ' + kort, vraag, definitie: o.definitie || '', uitleg, kritiek: bucket !== 'optie' }, extra));
      op('basis', 'breedte', 'breedte', 'Hoe breed is de ' + df + ' van ' + nm + '?', 'De twee zijkanten van de opening.');
      op(detail, 'hoogte', 'hoogte', 'Hoe hoog is de ' + df + ' van ' + nm + '?', 'Onderkant en bovenkant van de opening.');
      op('basis', 'positie', 'positie', 'Hoe ver zit ' + nm + ' van de ' + van + ', tot de dagkant?', 'Vaste hoek (' + (zijde[0] ? hoekTekst(zijde[0]) : 'linkerhoek') + ') tot de dagkant, niet tot de afwerklijst.');
      if (o.soort !== 'deur') op(detail, 'borstwering', 'borstwering', 'Hoe hoog zit de onderkant van ' + nm + ' boven de vloer?', 'Afgewerkte vloer (vloerpeil) tot onderzijde van de raamopening.');
      if (wz) op('werkzone', 'positie_rechts', 'tot rechterhoek', 'Hoe ver zit ' + nm + ' van de ' + (zijde[1] ? hoekTekst(zijde[1]) : 'rechterhoek') + ', tot de dagkant?', 'Vaste hoek (' + (zijde[1] ? hoekTekst(zijde[1]) : 'rechterhoek') + ') tot de dagkant.');
    }
    // objecten: in de werkzone volledig; erbuiten alleen als de opnemer "toch meten" koos of het object zelf toevoegde
    for (const ob of lijst(r.objecten)) {
      const t = K.OBJECTTYPES[ob && ob.type]; if (!t || !ob.id) continue;
      const bucket = ob.wand && inZone(ob.wand) ? 'werkzone' : (ob.gezien === 'toch-meten' || ob.eigen) ? 'extra' : null;
      const nm = ob.naam || (t.naam + ' ' + ob.id), hoek = ob.hoek ? 'de ' + hoekTekst(ob.hoek) : 'de dichtstbijzijnde hoek';
      const maten = t.maten.concat(t.zonderOpening && !ob.opening ? t.zonderOpening : []);
      for (const [sleutel, kort, vraag, definitie, keuzes] of maten) {
        slot('objecten.' + ob.id + '.maten.' + sleutel, ob, sleutel, bucket, { soort: ob.type === 'plint' ? 'plint' : 'object', groep: t.cat, wand: ob.wand || null, object: ob.id, eenheid: keuzes ? 'keuze' : 'mm', keuzes: keuzes || null, kort: ob.id + ' ' + kort,
          vraag: nm + ': ' + vraag.replace('van de hoek', 'van ' + hoek), definitie: '', uitleg: definitie, kritiek: t.cat === 'elektra' || t.cat === 'plint' });
      }
    }
    // bijzonderheden mogen een maat krijgen; doet de opnemer dat, dan hoort die bij de extra punten
    for (const b of lijst(r.bijzonderheden)) {
      if (!b || !b.id || !isObj(b.maten) || !eigen(b.maten, 'maat')) continue;
      slot('bijzonderheden.' + b.id + '.maten.maat', b, 'maat', 'extra', { soort: 'bijzonderheid', groep: 'afw', wand: b.wand || null, object: b.id, kort: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + ' maat',
        vraag: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + ': welke maat hoort hierbij?', uitleg: 'Zoals genoteerd bij de bijzonderheid.' });
    }
    // hook voor een vragenset per meubeltype (keuken, badmeubel): nog niet ingevuld, zie K.MEUBELSETS
    const set = K.MEUBELSETS[r.meubeltype];
    if (set && typeof set.extraSlots === 'function') set.extraSlots(r, slot, { zone, inZone });
    return out;
  }
  function slotNaarVraag(s, conf) {
    const m = maatOp(s.ent, s.sleutel), st = staatVan(m, s.keuzes);
    return { pad: s.pad, bucket: s.bucket, optioneel: s.bucket === 'optie', soort: s.soort, groep: s.groep, wand: s.wand, object: s.object, kort: s.kort, vraag: s.vraag, definitie: s.definitie, referentie: s.referentie, uitleg: s.uitleg, eenheid: s.eenheid, keuzes: s.keuzes, nvt_keuzes: s.nvtKeuzes, kritiek: s.kritiek,
      staat: st, conflict: st === 'gemeten' && !!conf[s.pad], maat: m || null, voorstel: m && m.voorstel ? m.voorstel : (s.afleiding || null) };
  }
  // De vragenlijst van een ruimte: alle punten die gevraagd worden, met hun huidige staat. Volgorde: basis, optie, werkzone, extra.
  K.vragen = function (ruimte) {
    const conf = conflictPaden(ruimte), volgorde = { basis: 0, optie: 1, werkzone: 2, extra: 3 };
    return slotsVan(ruimte).filter(s => s.bucket).map(s => slotNaarVraag(s, conf)).sort((a, b) => volgorde[a.bucket] - volgorde[b.bucket]);
  };

  // ── Tellers ──
  // x van n per emmer. beantwoord = gemeten + nvt + later (zoals het prototype: de teller "x van n"); compleet = gemeten + nvt (later telt niet voor het vrijgeven).
  function telling(vragen) {
    const c = { n: 0, gemeten: 0, nvt: 0, later: 0, open: 0, conflict: 0 };
    for (const v of vragen) { c.n++; c[v.staat]++; if (v.conflict) c.conflict++; }
    c.beantwoord = c.gemeten + c.nvt + c.later; c.compleet = c.gemeten + c.nvt;
    return c;
  }
  K.tellers = function (ruimte) {
    const v = K.vragen(ruimte), per = b => v.filter(x => x.bucket === b);
    return { basis: telling(per('basis')), werkzone: telling(per('werkzone')), extra: telling(per('extra')), optie: telling(per('optie')), gezien: gezienTeller(ruimte) };
  };
  // Objecten buiten de werkzone die de app (of de opnemer) heeft gezien: één tik "klopt", "niet aanwezig" of "toch meten". Niet verplicht.
  function gezienTeller(ruimte) {
    const zone = lijst(ruimte && ruimte.werkzone), l = lijst(ruimte && ruimte.objecten).filter(o => o && o.id && K.OBJECTTYPES[o.type] && !zone.includes(o.wand) && !o.eigen);
    return { n: l.length, bevestigd: l.filter(o => o.gezien === 'klopt' || o.gezien === 'niet-aanwezig' || o.gezien === 'toch-meten').length };
  }

  // ── Vorm en sluitcontrole ──
  // Er wordt geen rechthoek verondersteld (ChatGPT-review 035, punt A). Vier zijden en één diagonaal leggen de vierhoek vast (twee driehoeken); de tweede diagonaal is de controle.
  // Twee aparte uitkomsten: "afwijkende vorm" (de metingen zijn consistent, de kamer is gewoon niet rechthoekig: informatie, geen fout) en "meetgegevens inconsistent"
  // (de vierhoek sluit niet: een conflict). Tegenoverliggende wanden die verschillen zijn dus geen conflict. Niets wordt gecorrigeerd. Alleen echt gemeten maten tellen mee.
  const lengte = (r, kind, id) => K.waarde(maatOp(vind(r[kind], id), 'lengte'));
  const wandPad = w => 'wanden.' + w + '.maten.lengte', diagPad = d => 'diagonalen.' + d + '.maten.lengte';
  const afr = x => Math.round(x * 100) / 100;
  // Vierhoek P0 P1 P2 P3 (met de klok mee) uit de zijden s1=P0P1, s2=P1P2, s3=P2P3, s4=P3P0 en de diagonaal d1=P0P2. Geeft de punten, of null als de driehoeken niet kunnen bestaan.
  function vierhoek(s, d1, tol) {
    const drie = (a, b, c) => Math.max(a, b, c) <= a + b + c - Math.max(a, b, c) + tol;
    if (!drie(s[0], s[1], d1) || !drie(s[2], s[3], d1)) return null;
    const x2 = (d1 * d1 + s[0] * s[0] - s[1] * s[1]) / (2 * s[0]), y2 = Math.sqrt(Math.max(0, d1 * d1 - x2 * x2));
    const P0 = [0, 0], P1 = [s[0], 0], P2 = [x2, y2], e = [P2[0] / d1, P2[1] / d1], n = [-e[1], e[0]];
    const u = (d1 * d1 + s[3] * s[3] - s[2] * s[2]) / (2 * d1), v = Math.sqrt(Math.max(0, s[3] * s[3] - u * u));
    return [P0, P1, P2, [u * e[0] + v * n[0], u * e[1] + v * n[1]]];               // P1 ligt aan de ene kant van de diagonaal, P3 aan de andere: een bolle vierhoek
  }
  const afstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function hoekIn(p, i) {
    const a = p[(i + 3) % 4], c = p[(i + 1) % 4], b = p[i], v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]))))) * 180 / Math.PI;
  }
  // Een rondgang langs de wanden: lengtes in mm en per wand de binnenhoek aan het eind (graden). De eerste wand loopt langs de x-as (naar rechts), de y-as wijst omlaag en de ruimte ligt
  // rechts van de looprichting (met de klok mee bekeken). Een binnenhoek van 90 graden draait de looprichting 90 graden met de klok mee, 270 graden tegen de klok in.
  // Geeft n + 1 punten: het eerste is de begin- en het laatste het eindpunt. Sluit de rondgang, dan vallen die twee samen.
  function rondgang(lengtes, graden) {
    const pts = [[0, 0]]; let x = 0, y = 0, phi = 0;
    for (let i = 0; i < lengtes.length; i++) { x += lengtes[i] * Math.cos(phi); y += lengtes[i] * Math.sin(phi); pts.push([x, y]); phi += (180 - graden[i]) * Math.PI / 180; }
    return pts;
  }
  const oppervlakte = p => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };      // positief = met de klok mee (y wijst omlaag)
  function kruisen(p) {                                                    // snijdt een zijde een niet-aangrenzende zijde? (de wanden kruisen elkaar: de hoeken kloppen niet)
    const n = p.length, ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
      if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return true;
    }
    return false;
  }
  const leegVorm = (n, reden) => ({ status: 'onvoldoende-bepaald', afwijkend: null, schematisch: true, reden, hoeken: null, hoekpunten_mm: null, controle: null, tegenover: [], diagonaal_gebruikt: null, betrokken: [], n });
  K.vorm = function (ruimte) {
    const r = ruimte || {}, ids = wandIds(r), z = {}, ontbreekt = [];
    if (ids.length < 3) return leegVorm(ids.length, ids.length ? 'De vorm is nog niet bepaald: er zijn minder dan drie wanden.' : 'De vorm is nog niet bepaald: er zijn nog geen wanden.');
    if (!isRond(r)) return leegVorm(ids.length, 'De fotoronde is nog niet rond: de vorm is een schatting tot je kiest dat de kamer rond is (terug bij de eerste wand).');
    for (const w of ids) { z[w] = lengte(r, 'wanden', w); if (z[w] == null) ontbreekt.push('wandlengte ' + wandKort(w)); }
    // vier wanden zonder inspringende hoek: de bekende vierhoek-logica (vier zijden en één diagonaal); alle andere vormen: een rondgang langs de wanden met de binnenhoeken
    return ids.length === 4 && ids.every(w => !hoekInfo(r, w).inspringend) ? vormVierhoek(r, ids, z, ontbreekt) : vormVeelhoek(r, ids, z, ontbreekt);
  };
  // Vierhoek: v0.3-logica. De hoeken volgen uit de metingen; hoeken die op 90 graden zijn gezet tellen hier niet mee (ze zijn een aanname die de diagonaal toetst).
  function vormVierhoek(r, ids, z, ontbreekt) {
    const T = K.TOLERANTIE, hoekIds = ids.map(w => wandHoeken(r, w)[0]);
    const dA = lengte(r, 'diagonalen', 'A'), dB = lengte(r, 'diagonalen', 'B');
    // tegenoverliggende wanden die meer dan 5 mm verschillen bewijzen al dat de kamer niet rechthoekig is
    const verschil = [[ids[0], ids[2]], [ids[3], ids[1]]].filter(([a, b]) => z[a] != null && z[b] != null && Math.abs(z[a] - z[b]) > T.tegenover).map(([a, b]) => ({ wanden: [a, b], verschil_mm: Math.abs(z[a] - z[b]) }));
    const basis = { status: 'onvoldoende-bepaald', afwijkend: verschil.length ? true : null, schematisch: true, reden: '', hoeken: null, hoekpunten_mm: null, controle: null, tegenover: verschil, diagonaal_gebruikt: null, betrokken: [], n: 4 };
    if (ontbreekt.length) { basis.reden = 'Meet eerst ' + ontbreekt.join(', ') + '.'; return basis; }
    if (dA == null && dB == null) {
      const schuin = ids.filter(w => hoekInfo(r, w).schuin && hoekInfo(r, w).bron !== 'gemeten');
      basis.reden = schuin.length ? 'De vorm is onvoldoende bepaald: de hoek na ' + schuin.map(wandTekst).join(' en na ') + ' staat schuin en is alleen geschat. Meet een diagonaal (of de hoek). Tot dan is de tekening schematisch.'
        : 'De vorm is nog niet bepaald: meet minstens één diagonaal. Tot dan is de tekening schematisch (hoeken aangenomen 90 graden).';
      return basis;
    }
    const metA = dA != null, volg = metA ? [0, 1, 2, 3] : [1, 2, 3, 0], ids2 = volg.map(i => hoekIds[i]), zijden = volg.map(i => z[ids[i]]);
    const d1 = metA ? dA : dB, d2 = metA ? dB : dA, p = vierhoek(zijden, d1, T.diagonaal);
    const betrokken = ids.map(wandPad).concat(dA != null ? [diagPad('A')] : [], dB != null ? [diagPad('B')] : []);
    basis.diagonaal_gebruikt = metA ? 'A' : 'B'; basis.betrokken = betrokken;
    if (!p) { basis.status = 'inconsistent'; basis.reden = 'Met deze vier wandlengtes en diagonaal ' + basis.diagonaal_gebruikt + ' (' + d1 + ' mm) kan de ruimte niet bestaan. Controleer de diagonaal en de wandlengtes.'; return basis; }
    // naar vaste assen: de eerste hoek in de oorsprong, de tweede op de x-as, de ruimte onder de x-as (y wijst omlaag)
    const i0 = ids2.indexOf(hoekIds[0]), i1 = ids2.indexOf(hoekIds[1]), o = p[i0], rx = p[i1][0] - o[0], ry = p[i1][1] - o[1], l = Math.hypot(rx, ry), c = rx / l, sn = -ry / l;
    const punten = {}, hoeken = {};
    ids2.forEach((id, i) => { const dx = p[i][0] - o[0], dy = p[i][1] - o[1]; punten[id] = [Math.round(dx * c - dy * sn) + 0, Math.round(dx * sn + dy * c) + 0]; hoeken[id] = afr(hoekIn(p, i)); });
    const afwijking = Math.max.apply(null, Object.keys(hoeken).map(k => Math.abs(hoeken[k] - 90)));
    basis.hoeken = hoeken; basis.hoekpunten_mm = punten; basis.afwijkend = verschil.length > 0 || afwijking > T.hoek_graden; basis.max_hoekafwijking_graden = afr(afwijking);
    if (d2 == null) { basis.status = 'onverifieerd'; basis.reden = 'Vorm berekend uit vier zijden en diagonaal ' + basis.diagonaal_gebruikt + '. Meet de andere diagonaal als controle (optioneel). Tot dan is de tekening schematisch.'; return basis; }
    const berekend = Math.round(afstand(p[1], p[3])), v = Math.round(d2 - berekend);
    basis.controle = { diagonaal: metA ? 'B' : 'A', gemeten_mm: d2, berekend_mm: berekend, verschil_mm: v, tolerantie_mm: T.diagonaal };
    if (Math.abs(v) > T.diagonaal) { basis.status = 'inconsistent'; basis.reden = 'Diagonaal ' + basis.controle.diagonaal + ' is ' + d2 + ' mm gemeten, maar uit de vier wanden en diagonaal ' + basis.diagonaal_gebruikt + ' volgt ' + berekend + ' mm (' + (v > 0 ? '+' : '') + v + ' mm). De metingen sluiten niet op elkaar: controleer de referentie en meet opnieuw. De app past niets aan.'; return basis; }
    basis.status = 'consistent'; basis.schematisch = false;
    basis.reden = 'De metingen sluiten op elkaar: diagonaal ' + basis.controle.diagonaal + ' ' + d2 + ' mm gemeten, ' + berekend + ' mm berekend (' + (v > 0 ? '+' : '') + v + ' mm).' + (basis.afwijkend ? ' De ruimte is niet rechthoekig (hoeken: ' + ids2.map(k => k + ' ' + hoeken[k] + ' graden').join(', ') + '). Dat is informatie, geen fout; houd er rekening mee bij het meubel.' : '');
    return basis;
  }
  // Veelhoek (meer of minder dan vier wanden, of een inspringende hoek): een rondgang langs de wanden met de binnenhoeken. Sluit de rondgang niet (sluitfout groter dan 10 mm), dan zijn de
  // metingen inconsistent. Zijn alle hoeken 90 of 270 graden (aangenomen), dan is de vorm schematisch tot een diagonaal als controle klopt; een schuine hoek die alleen geschat is, maakt de vorm onvoldoende bepaald.
  function vormVeelhoek(r, ids, z, ontbreekt) {
    const T = K.TOLERANTIE, n = ids.length, hoekIds = ids.map(w => wandHoeken(r, w)[0]), info = ids.map(w => hoekInfo(r, w));
    const basis = { status: 'onvoldoende-bepaald', afwijkend: null, schematisch: true, reden: '', hoeken: null, hoekpunten_mm: null, controle: null, tegenover: [], diagonaal_gebruikt: null, betrokken: [], n, veelhoek: true, sluitfout: null };
    if (ontbreekt.length) { basis.reden = 'Meet eerst ' + ontbreekt.join(', ') + '.'; return basis; }
    const schuin = ids.filter((w, i) => info[i].schuin && info[i].bron !== 'gemeten');
    if (schuin.length) { basis.reden = 'De vorm is onvoldoende bepaald: de hoek na ' + schuin.map(wandTekst).join(' en na ') + ' staat schuin en is alleen geschat. Meet de hoek (of een diagonaal). Tot dan is de tekening schematisch.'; return basis; }
    const p = rondgang(ids.map(w => z[w]), info.map(i => i.graden)), fx = p[n][0] - p[0][0], fy = p[n][1] - p[0][1], mm = Math.hypot(fx, fy);
    basis.betrokken = ids.map(wandPad); basis.sluitfout = { x: Math.round(fx), y: Math.round(fy), mm: Math.round(mm) };
    basis.hoeken = {}; ids.forEach((w, i) => { basis.hoeken[hoekIds[(i + 1) % n]] = info[i].graden; });
    if (mm > T.sluit) {
      basis.status = 'inconsistent';
      basis.reden = 'Meetgegevens inconsistent: de wanden sluiten niet op elkaar. Na een rondgang langs alle wanden zit er ' + Math.round(mm) + ' mm tussen begin en eind (' + Math.round(fx) + ' mm in x, ' + Math.round(fy) + ' mm in y). Controleer de wandlengtes en de hoeken. De app past niets aan.';
      return basis;
    }
    const pts = p.slice(0, n);
    if (oppervlakte(pts) <= 0 || kruisen(pts)) { basis.status = 'inconsistent'; basis.reden = 'Meetgegevens inconsistent: de wanden lopen niet netjes met de klok mee rond een ruimte (of kruisen elkaar). Controleer de hoeken (90 of 270 graden) en de volgorde van de wanden.'; return basis; }
    basis.hoekpunten_mm = {}; pts.forEach((q, i) => { basis.hoekpunten_mm[hoekIds[i]] = [Math.round(q[0]) + 0, Math.round(q[1]) + 0]; });
    // een diagonaal als controle (optioneel): de afstand tussen twee hoekpunten uit de rondgang tegen de gemeten diagonaal
    const checks = [];
    for (const d of lijst(r.diagonalen)) {
      const gem = d && d.id ? lengte(r, 'diagonalen', d.id) : null, i = hoekIds.indexOf(d && d.van), j = hoekIds.indexOf(d && d.naar);
      if (gem == null || i < 0 || j < 0) continue;
      const berekend = Math.round(afstand(pts[i], pts[j])), v = Math.round(gem - berekend);
      checks.push({ diagonaal: d.id, gemeten_mm: gem, berekend_mm: berekend, verschil_mm: v, tolerantie_mm: T.diagonaal });
      basis.betrokken.push(diagPad(d.id));
    }
    basis.controle = checks.length ? checks[0] : null; basis.controles = checks;
    const fout = checks.find(c => Math.abs(c.verschil_mm) > T.diagonaal);
    if (fout) { basis.status = 'inconsistent'; basis.reden = 'Diagonaal ' + fout.diagonaal + ' is ' + fout.gemeten_mm + ' mm gemeten, maar uit de wanden en hoeken volgt ' + fout.berekend_mm + ' mm (' + (fout.verschil_mm > 0 ? '+' : '') + fout.verschil_mm + ' mm). De metingen sluiten niet op elkaar: controleer de wandlengtes en de hoeken. De app past niets aan.'; return basis; }
    const aangenomen = ids.some((w, i) => info[i].bron !== 'gemeten');
    if (checks.length) { basis.status = 'consistent'; basis.schematisch = false; basis.reden = 'De wanden sluiten (sluitfout ' + basis.sluitfout.mm + ' mm) en diagonaal ' + checks.map(c => c.diagonaal).join(' en ') + ' klopt (' + checks.map(c => (c.verschil_mm > 0 ? '+' : '') + c.verschil_mm + ' mm').join(', ') + '). ' + (aangenomen ? 'De overige hoeken zijn aangenomen als 90 of 270 graden.' : ''); return basis; }
    basis.status = 'onverifieerd';
    basis.reden = (aangenomen ? 'Schematisch: de hoeken zijn aangenomen als 90 of 270 graden. ' : '') + 'De wanden sluiten op elkaar (sluitfout ' + basis.sluitfout.mm + ' mm). Meet een diagonaal als controle (optioneel).';
    return basis;
  }
  K.sluitcontrole = function (ruimte) {
    const v = K.vorm(ruimte), checks = [];
    const status = v.status === 'inconsistent' ? 'conflict' : v.status === 'consistent' ? (v.afwijkend ? 'afwijkend' : 'ok') : 'wacht';
    checks.push({ id: 'vorm', titel: 'Vorm van de ruimte', status, vorm_status: v.status, detail: v.reden || (v.afwijkend ? 'Tegenoverliggende wanden verschillen: de ruimte is niet rechthoekig.' : ''), maten: status === 'conflict' ? v.betrokken.slice() : [],
      verschil_mm: v.controle ? v.controle.verschil_mm : null, tolerantie_mm: K.TOLERANTIE.diagonaal });
    const conflicten = checks.filter(c => c.status === 'conflict').map(c => ({ id: c.id, titel: c.titel, uitleg: c.detail, maten: c.maten.slice() }));
    return { checks, conflicten, vorm: v };
  };
  // De paden van de maten die in een conflict zitten (voor de oranje markering en het blokkeren van het vrijgeven).
  function conflictPaden(ruimte) { const s = {}; for (const c of K.sluitcontrole(ruimte).conflicten) for (const p of c.maten) s[p] = true; return s; }
  K.conflictPaden = ruimte => Object.keys(conflictPaden(ruimte));

  // ── De plattegrond: de contour van de ruimte, uit wat er is (v0.4) ──
  // De vorm ontstaat uit de foto's en wordt steeds nauwkeuriger (Bart, 1-11): zonder maten is het een schatting (gestippeld), elke gemeten wandlengte maakt de bijbehorende wand vast, en de
  // geschatte delen schalen mee: een uitsprong die alleen als verhouding op de wand bekend is, volgt de gemeten wandlengte. Onbekende wandlengtes worden als schatting zo gekozen dat een
  // rechthoekige ruimte (alle hoeken 90 of 270 graden) sluit. De kern past nooit een maat aan: de schatting staat alleen in deze tekening.
  // Geeft { n, rond, punten (hoek-id naar [x, y] in mm), wanden (id naar { a, b, lengte, gemeten, geschat, hoek }), uitsprongen[], contour[] (segmenten langs de rand), schatting, sluitfout, vorm, bbox }.
  // Het coordinatenstelsel: de eerste wand loopt langs de x-as, y wijst omlaag, de ruimte ligt rechts van de looprichting (met de klok mee).
  const afstandPt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function schatLengtes(ids, info, gem, rond, vorm) {
    const n = ids.length, bekend = gem.filter(x => x != null), gemiddeld = bekend.length ? bekend.reduce((s, x) => s + x, 0) / bekend.length : null;
    const std = i => gem[i] != null ? gem[i] : (n % 2 === 0 && gem[(i + n / 2) % n] != null) ? gem[(i + n / 2) % n] : gemiddeld != null ? gemiddeld : (i % 2 === 0 ? 4000 : 3000);
    const L = ids.map((w, i) => std(i)), geschat = gem.map(x => x == null);
    if (!rond || !info.every(i => i.haaks) || (vorm && vorm.status === 'inconsistent')) return { L, geschat, gesloten: false };          // een inconsistente meting wordt niet mooi gemaakt: de sluitfout blijft zichtbaar
    // Alle wanden gemeten maar de rondgang sluit niet precies (en er is geen diagonaal die de vorm vastlegt): voor de tekening de fout gelijk verdelen over de wanden op dezelfde as, als de fout klein is.
    // Dat verandert geen maat; het is alleen de getekende schatting.
    const alles = !geschat.some(Boolean);
    if (alles) { const q = rondgang(L, info.map(i => i.graden)), fout = afstandPt(q[0], q[n]), omtrek = L.reduce((s, x) => s + x, 0); if (fout < 0.5 || fout > 0.015 * omtrek) return { L, geschat, gesloten: false }; }
    const pas = i => alles || geschat[i];
    // alle hoeken haaks: de looprichting van elke wand is een kwart slag; de aan te passen lengtes per as zo kiezen dat de rondgang sluit
    let phi = 0; const dir = ids.map((w, i) => { const d = [Math.round(Math.cos(phi)), Math.round(Math.sin(phi))]; phi += (180 - info[i].graden) * Math.PI / 180; return d; });
    const nieuw = L.slice();
    for (const as of [0, 1]) {
      const onbekend = ids.map((w, i) => i).filter(i => pas(i) && dir[i][as] !== 0);
      if (!onbekend.length) continue;
      const rest = -ids.reduce((s, w, i) => s + (pas(i) || dir[i][as] === 0 ? 0 : dir[i][as] * L[i]), 0) - onbekend.reduce((s, i) => s + dir[i][as] * L[i], 0), per = rest / onbekend.length;
      const kandidaat = onbekend.map(i => L[i] + dir[i][as] * per);
      if (kandidaat.some(x => !(x >= 300))) return { L, geschat, gesloten: false };          // de schatting past niet bij de hoeken: laat de standaardlengtes staan
      onbekend.forEach((i, k) => { nieuw[i] = kandidaat[k]; });
    }
    return { L: nieuw, geschat, gesloten: true };
  }
  K.plattegrond = function (ruimte) {
    const r = ruimte || {}, ids = wandIds(r), n = ids.length, T = K.TOLERANTIE, rond = n >= 3 && isRond(r), vorm = K.vorm(r);
    const uit = { n, rond, punten: {}, wanden: {}, uitsprongen: [], contour: [], vorm, schatting: true, sluitfout: null, bbox: null, volgorde: ids.slice() };
    if (!n) return uit;
    const hoekIds = ids.map(w => wandHoeken(r, w)[0]), eindId = wandHoeken(r, ids[n - 1])[1], info = ids.map(w => hoekInfo(r, w)), gem = ids.map(w => lengte(r, 'wanden', w));
    let pts, geschat = gem.map(x => x == null), vormGeschat = true;
    if (rond && vorm.hoekpunten_mm && vorm.status !== 'inconsistent' && hoekIds.every(h => vorm.hoekpunten_mm[h])) {
      pts = hoekIds.map(h => vorm.hoekpunten_mm[h]); pts.push(pts[0]); vormGeschat = vorm.status !== 'consistent';
    } else {
      const sl = schatLengtes(ids, info, gem, rond, vorm); geschat = sl.geschat;
      pts = rondgang(sl.L, info.map(i => i.graden));
    }
    const gesloten = rond && afstandPt(pts[0], pts[n]) <= T.sluit + 0.5;
    if (rond) uit.sluitfout = { x: Math.round(pts[n][0] - pts[0][0]), y: Math.round(pts[n][1] - pts[0][1]), mm: Math.round(afstandPt(pts[0], pts[n])) };
    hoekIds.forEach((h, i) => { uit.punten[h] = pts[i]; });
    if (!rond) uit.punten[eindId] = pts[n];
    ids.forEach((w, i) => {
      const a = pts[i], b = i === n - 1 && gesloten ? pts[0] : pts[i + 1];
      uit.wanden[w] = { id: w, nr: i + 1, van: hoekIds[i], naar: i === n - 1 ? eindId : hoekIds[i + 1], a, b, lengte: gem[i] != null ? gem[i] : afstandPt(a, b), gemeten: gem[i] != null, geschat: gem[i] == null, hoek: info[i], laatste: i === n - 1 };
    });
    // uitsprongen en nissen op de wanden: vier hoekpunten per uitsprong (begin op de wand, de voorkant en weer terug op de wand)
    ids.forEach((w, i) => {
      const we = uit.wanden[w], dx = we.b[0] - we.a[0], dy = we.b[1] - we.a[1], len = Math.hypot(dx, dy) || 1, d = [dx / len, dy / len], nrm = [-d[1], d[0]];      // nrm wijst de ruimte in (rechts van de looprichting)
      const lijstU = lijst(r.uitsprongen).filter(u => u && u.id && u.wand === w).map(u => ({ u, v: uitsprongWaarden(r, u, len) })).filter(x => x.v.positie && x.v.breedte).sort((a, b) => a.v.positie.mm - b.v.positie.mm);
      let cursor = 0;
      const seg = (soort, uid, van, naar, geschatFlag) => afstandPt(van, naar) >= 0.5 && uit.contour.push({ wand: w, soort, uitsprong: uid, van, naar, lengte: Math.round(afstandPt(van, naar)), geschat: geschatFlag });
      const op = t => [we.a[0] + d[0] * t, we.a[1] + d[1] * t];
      for (const { u, v } of lijstU) {
        const p0 = Math.max(cursor, Math.min(len, v.positie.mm)), p1 = Math.max(p0, Math.min(len, v.positie.mm + v.breedte.mm)), dd = (v.soort === 'achter' ? -1 : 1) * v.diepte.mm;
        const A = op(p0), B = op(p1), A2 = [A[0] + nrm[0] * dd, A[1] + nrm[1] * dd], B2 = [B[0] + nrm[0] * dd, B[1] + nrm[1] * dd];
        const geschatU = { positie: !v.positie.gemeten, breedte: !v.breedte.gemeten, diepte: !v.diepte.gemeten };
        seg('wand', null, op(cursor), A, we.geschat);
        seg('zij', u.id, A, A2, geschatU.diepte); seg('front', u.id, A2, B2, geschatU.positie || geschatU.breedte); seg('zij', u.id, B2, B, geschatU.diepte);
        uit.uitsprongen.push({ id: u.id, wand: w, soort: v.soort, positie: p0, breedte: p1 - p0, diepte: v.diepte.mm, hoogte: v.hoogte ? v.hoogte.mm : null, geschat: geschatU, punten: [A, A2, B2, B] });
        cursor = p1;
      }
      seg('wand', null, op(cursor), we.b, we.geschat);
    });
    uit.schatting = !rond || vormGeschat || geschat.some(Boolean) || uit.uitsprongen.some(u => u.geschat.positie || u.geschat.breedte || u.geschat.diepte);
    const alle = Object.keys(uit.punten).map(k => uit.punten[k]).concat(uit.contour.map(c => c.naar));
    uit.bbox = { x0: Math.min.apply(null, alle.map(p => p[0])), x1: Math.max.apply(null, alle.map(p => p[0])), y0: Math.min.apply(null, alle.map(p => p[1])), y1: Math.max.apply(null, alle.map(p => p[1])) };
    return uit;
  };

  // ── Rondje controle ──
  // Alleen voor de werkzone-wanden. Per wand en categorie: aanwezig / afwezig / later; geen keuze = "nog niet bekeken".
  const rondjeSleutel = (w, c) => w + '|' + c;
  const rondjeWaarde = v => { const x = isObj(v) ? v.waarde : v; return K.RONDJE_KEUZES.includes(x) ? x : null; };
  K.rondje = function (ruimte) {
    const r = ruimte || {}, wanden = wandIds(r).filter(w => lijst(r.werkzone).includes(w)), regels = [];
    for (const w of wanden) for (const [cat, naam] of K.RONDJE_CATEGORIEEN) {
      const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, cat)] : null);
      regels.push({ sleutel: rondjeSleutel(w, cat), wand: w, categorie: cat, naam, waarde, status: waarde || 'nog-niet-bekeken', nadruk: cat === 'water' && r.meubeltype && r.meubeltype !== 'kast' });
    }
    const bekeken = regels.filter(x => x.waarde).length;
    return { wanden, regels, tot: regels.length, bekeken, mis: regels.length - bekeken, later: regels.filter(x => x.waarde === 'later').length };
  };
  // Legt een keuze van het rondje vast; null haalt de keuze weg. Geeft een nieuwe ruimte terug.
  K.zetRondje = function (ruimte, wand, categorie, waarde, tijd) {
    if (!wandIds(ruimte).includes(wand) || !K.RONDJE_CATEGORIEEN.some(c => c[0] === categorie)) return { ruimte: null, fout: 'Onbekende wand of categorie.' };
    if (waarde !== null && !K.RONDJE_KEUZES.includes(waarde)) return { ruimte: null, fout: 'Onbekende keuze voor het rondje.' };
    const r = kloon(ruimte); r.rondje = isObj(r.rondje) ? r.rondje : {};
    const k = rondjeSleutel(wand, categorie), oud = r.rondje[k];
    if (waarde === null) { if (oud !== undefined) { r.rondje_historie = lijst(r.rondje_historie).concat([{ sleutel: k, oud, tijd: tijd || nu() }]); delete r.rondje[k]; } }
    else r.rondje[k] = { waarde, tijd: tijd || nu() };
    return { ruimte: r, fout: null };
  };

  // ── Waarschuwingen (niet blokkerend) ──
  // Onwaarschijnlijke maar mogelijke maten (geen vaste ondergrens meer) moeten voor het vrijgeven expliciet bevestigd zijn: r.bevestigingen[pad] = { waarde, tijd }. Verandert de waarde, dan vervalt de bevestiging.
  const isBevestigd = (r, pad, waarde) => isObj(r.bevestigingen) && isObj(r.bevestigingen[pad]) && r.bevestigingen[pad].waarde === waarde;
  K.waarschuwingen = function (ruimte) {
    const r = ruimte || {}, w = [], slots = slotsVan(r);
    for (const s of slots) {
      const m = maatOp(s.ent, s.sleutel);
      if (!isObj(m)) continue;
      if (m.staat === 'gemeten' && staatVan(m, s.keuzes) !== 'gemeten') w.push({ code: 'meting-ongeldig', pad: s.pad, tekst: s.kort + ': staat op gemeten, maar er is geen geldige waarde of de bron is geen DISTO of hand. Telt als nog meten.' });
      if (m.staat === 'gemeten' && s.pad.startsWith('openingen.') && (s.sleutel === 'breedte' || s.sleutel === 'hoogte') && !K.DEFINITIES[s.ent.definitie] && !lijst(r.werkzone).includes(s.ent.wand)) w.push({ code: 'definitie-ontbreekt', pad: s.pad, tekst: s.kort + ': kies de definitie (muursparing, dagmaat of kozijn buiten), anders is de maat dubbelzinnig.' });
      const v = K.waarde(m);
      if (v != null && s.sleutel.indexOf('lengte') === 0 && s.pad.startsWith('wanden.') && (v < 300 || v > 15000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, waarde: v, bevestigd: isBevestigd(r, s.pad, v), tekst: s.kort + ': ' + v + ' mm ligt buiten 300 tot 15000 mm. Tikfout?' });
      if (v != null && (s.pad.startsWith('plafondpunten.') || s.sleutel.indexOf('plafond_') === 0) && (v < 2000 || v > 5000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, waarde: v, bevestigd: isBevestigd(r, s.pad, v), tekst: s.kort + ': ' + v + ' mm ligt buiten 2000 tot 5000 mm. Tikfout?' });
    }
    // een werkzone-wand waarvan de lengte onderaan, op 1000 mm en bovenaan meer dan 5 mm verschilt, staat niet te lood of is scheef: informatie voor het meubel, geen blokkade
    for (const wd of wandIds(r)) if (lijst(r.werkzone).includes(wd)) {
      const hoogtes = [['onder', 'lengte_onder'], ['1000 mm', 'lengte'], ['boven', 'lengte_boven']].map(([n, k]) => [n, K.waarde(maatOp(vind(r.wanden, wd), k))]).filter(x => x[1] != null);
      if (hoogtes.length < 2) continue;
      const waarden = hoogtes.map(x => x[1]), verschil = Math.max.apply(null, waarden) - Math.min.apply(null, waarden);
      if (verschil > K.TOLERANTIE.wand_scheef_onwaarschijnlijk) w.push({ code: 'onwaarschijnlijk', pad: 'wanden.' + wd + '.scheef', wand: wd, waarde: verschil, bevestigd: isBevestigd(r, 'wanden.' + wd + '.scheef', verschil), tekst: wandMetWoord(wd) + ': de lengte verschilt ' + verschil + ' mm tussen onder, midden en boven. Dat is mogelijk, maar groot. Klopt dit?' });
      if (verschil > K.TOLERANTIE.wand_scheef) w.push({ code: 'wand-scheef', pad: 'wanden.' + wd, wand: wd, verschil_mm: verschil, tekst: wandMetWoord(wd) + ' niet te lood of scheef: de lengte verschilt ' + verschil + ' mm tussen ' + hoogtes.map(x => x[0] + ' ' + x[1] + ' mm').join(', ') + '. Informatie voor het meubel, geen blokkade.' });
    }
    // uitsprongen en nissen: binnen de wand en niet over elkaar (met de bekende waarden: gemeten, anders het voorstel uit de foto)
    for (const wd of wandIds(r)) {
      const L = K.waarde(maatOp(vind(r.wanden, wd), 'lengte')); if (L == null) continue;
      const l = lijst(r.uitsprongen).filter(u => u && u.id && u.wand === wd).map(u => ({ u, v: uitsprongWaarden(r, u, null) })).filter(x => x.v.positie && x.v.breedte).sort((a, b) => a.v.positie.mm - b.v.positie.mm);
      l.forEach((x, i) => {
        const p0 = x.v.positie.mm, p1 = p0 + x.v.breedte.mm;
        if (p0 < -5 || p1 > L + 5) w.push({ code: 'uitsprong-buiten-wand', pad: 'uitsprongen.' + x.u.id, wand: wd, tekst: K.UITSPRONG_SOORTEN[x.u.soort] + ' ' + x.u.id + ' (' + Math.round(p0) + ' tot ' + Math.round(p1) + ' mm) valt buiten de ' + wandTekst(wd) + ' van ' + L + ' mm. Controleer positie, breedte en wandlengte.' });
        if (i && p0 < l[i - 1].v.positie.mm + l[i - 1].v.breedte.mm - 5) w.push({ code: 'uitsprong-overlap', pad: 'uitsprongen.' + x.u.id, wand: wd, tekst: K.UITSPRONG_SOORTEN[x.u.soort] + ' ' + x.u.id + ' en ' + l[i - 1].u.id + ' liggen over elkaar op de ' + wandTekst(wd) + '. Controleer positie en breedte.' });
      });
    }
    // een opening die buiten de wand valt kan niet: geometrisch onmogelijk en dus een blokkade voor het vrijgeven
    for (const o of lijst(r.openingen)) {
      if (!o || !o.id) continue;
      const L = K.waarde(maatOp(vind(r.wanden, o.wand), 'lengte')), bw = K.waarde(maatOp(o, 'breedte')), po = K.waarde(maatOp(o, 'positie'));
      if (L != null && bw != null && po != null && (po + bw > L + 5)) w.push({ code: 'opening-buiten-wand', pad: 'openingen.' + o.id, wand: o.wand, tekst: openingNaam(o) + ' (' + po + ' tot ' + (po + bw) + ' mm) valt buiten de ' + wandTekst(o.wand) + ' van ' + L + ' mm. Dat kan niet: controleer positie, breedte en wandlengte.' });
    }
    // rondje zegt "afwezig" terwijl er in die wand en categorie wel iets is vastgelegd
    for (const x of K.rondje(r).regels) if (x.waarde === 'afwezig') {
      const iets = (cat => cat === 'kozijn' ? lijst(r.openingen).filter(o => o && o.wand === x.wand).length + lijst(r.objecten).filter(o => o && o.wand === x.wand && K.OBJECTTYPES[o.type] && K.OBJECTTYPES[o.type].cat === 'kozijn').length
        : cat === 'afw' ? lijst(r.bijzonderheden).filter(b => b && b.wand === x.wand).length + lijst(r.uitsprongen).filter(b => b && b.wand === x.wand).length + lijst(r.objecten).filter(o => o && o.wand === x.wand && o.type === 'overig').length
        : lijst(r.objecten).filter(o => o && o.wand === x.wand && K.OBJECTTYPES[o.type] && K.OBJECTTYPES[o.type].cat === cat).length)(x.categorie);
      if (iets) w.push({ code: 'rondje-tegenspraak', pad: x.sleutel, tekst: 'Rondje ' + K.wandNaam(x.wand) + ' - ' + x.naam + ' staat op niet aanwezig, maar er is wel iets vastgelegd.' });
    }
    return w;
  };

  // ── Vrijgeef-check ──
  // "Vrijgeven voor maatwerk" kan pas als: een meubeltype met een echte vragenset (nu alleen kast), werkzone gekozen, basis + werkzone + extra compleet (later telt niet, nvt wel),
  // geen conflicten, een eventueel ingevulde optionele maat niet op later, en het rondje gedaan (een categorie op later blokkeert ook). Opslaan kan altijd (K.samenvatting).
  // De uitkomst geeft ook de scope en alle uitzonderingen terug (n.v.t.-punten, benoemde bijzonderheden zonder maat, wanden niet beoordeeld, niet-aanwezig-keuzes van het rondje,
  // een vorm die niet gecontroleerd is), zodat de controleschets ze toont: niets staat stil als "volledig gemeten".
  function uitzonderingenVan(r) {
    const u = [], nm = r.id;
    for (const v of K.vragen(r)) {
      if (v.staat !== 'nvt' || v.bucket === 'optie') continue;
      const m = v.maat || {};
      if (v.soort === 'wandbevestiging') u.push({ ruimte: nm, soort: 'wand-niet-beoordeeld', wand: v.wand, pad: v.pad, tekst: wandMetWoord(v.wand) + ': ' + (m.keuze === 'afgedekt' ? 'afgedekt' : 'niet beoordeeld'), notitie: m.notitie || '' });
      else u.push({ ruimte: nm, soort: 'nvt', wand: v.wand, pad: v.pad, tekst: v.kort + ': niet van toepassing, bewust niet maatvast', notitie: m.notitie || '' });
    }
    for (const b of lijst(r.bijzonderheden)) {
      if (!b || !b.id) continue;
      const m = isObj(b.maten) ? b.maten.maat : null;
      if (!geldigeMeting(m)) u.push({ ruimte: nm, soort: 'bijzonderheid', wand: b.wand || null, pad: 'bijzonderheden.' + b.id, tekst: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + (b.wand ? ', ' + wandKort(b.wand) : '') + ': genoemd, niet bemeten', notitie: b.notitie || '' });
    }
    for (const x of K.rondje(r).regels) if (x.waarde === 'afwezig') u.push({ ruimte: nm, soort: 'rondje-niet-aanwezig', wand: x.wand, pad: 'rondje.' + x.sleutel, tekst: 'Rondje ' + wandKort(x.wand) + ': ' + x.naam.toLowerCase() + ' niet aanwezig of n.v.t.', notitie: '' });
    const vorm = K.vorm(r);
    if (vorm.status !== 'consistent') u.push({ ruimte: nm, soort: 'vorm', wand: null, pad: null, tekst: vorm.status === 'onverifieerd' ? (vorm.veelhoek ? 'Vorm van de ruimte schematisch: de hoeken zijn aangenomen als 90 of 270 graden, niet met een diagonaal gecontroleerd' : 'Vorm van de ruimte niet gecontroleerd met de tweede diagonaal') : 'Vorm van de ruimte niet bepaald, schematisch', notitie: '' });
    return u;
  }
  K.vrijgeefCheckRuimte = function (ruimte) {
    const r = ruimte || {}, redenen = [], t = K.tellers(r), nm = r.naam || r.id || 'Ruimte', rd = K.rondje(r), sc = K.sluitcontrole(r), set = K.MEUBELSETS[r.meubeltype];
    if (!set || !set.gereed) redenen.push({ code: 'meubelset', tekst: nm + ': voor ' + (r.meubeltype || 'dit meubeltype') + ' bestaat nog geen eigen vragenset (alleen kast is gevalideerd), dus vrijgeven kan nog niet.' });
    for (const o of lijst(r.openingen)) if (o && o.id && lijst(r.werkzone).includes(o.wand) && !K.DEFINITIES[o.definitie]) redenen.push({ code: 'definitie', pad: 'openingen.' + o.id, tekst: nm + ': kies de definitie van ' + openingNaam(o) + ' (muursparing, dagmaat of kozijn buiten). In de werkzone is een maat zonder definitie dubbelzinnig.' });
    for (const x of K.waarschuwingen(r)) {
      if (x.code === 'onwaarschijnlijk' && !x.bevestigd) redenen.push({ code: 'onwaarschijnlijk', pad: x.pad, tekst: nm + ': ' + x.tekst + ' Bevestig dat het klopt, of meet opnieuw.' });
      if (x.code === 'uitsprong-buiten-wand' || x.code === 'uitsprong-overlap' || x.code === 'opening-buiten-wand') redenen.push({ code: 'onmogelijk', pad: x.pad, tekst: nm + ': ' + x.tekst });
    }
    if (wandIds(r).length < 3) redenen.push({ code: 'wanden', tekst: nm + ': een ruimte heeft minstens drie wanden. Maak de fotoronde af.' });
    else if (!isRond(r)) redenen.push({ code: 'ronde', tekst: nm + ': de fotoronde is nog niet rond. Kies "kamer rond" als je terug bent bij de eerste wand.' });
    if (!lijst(r.werkzone).filter(w => wandIds(r).includes(w)).length) redenen.push({ code: 'werkzone', tekst: nm + ': kies waar het meubel komt (werkzone).' });
    [['basis', 'Basis'], ['werkzone', 'Werkzone'], ['extra', 'Extra']].forEach(([b, n]) => {
      const c = t[b]; if (!c.n) return;
      if (c.open) redenen.push({ code: 'open', bucket: b, aantal: c.open, tekst: nm + ' - ' + n + ': ' + c.open + (c.open === 1 ? ' punt moet' : ' punten moeten') + ' nog gemeten.' });
      if (c.later) redenen.push({ code: 'later', bucket: b, aantal: c.later, tekst: nm + ' - ' + n + ': ' + c.later + ' op later meten (telt niet als compleet).' });
    });
    if (t.optie.later) redenen.push({ code: 'later', bucket: 'optie', aantal: t.optie.later, tekst: nm + ' - Optioneel: ' + t.optie.later + ' op later meten. Meet ze nu, zet ze op n.v.t. of haal ze weg.' });
    for (const c of sc.conflicten) redenen.push({ code: 'conflict', id: c.id, tekst: nm + ': meetgegevens inconsistent, ' + c.titel + '. ' + c.uitleg });
    if (rd.wanden.length && rd.mis) redenen.push({ code: 'rondje', aantal: rd.mis, tekst: nm + ': rondje controle, ' + rd.mis + (rd.mis === 1 ? ' categorie' : ' categorieën') + ' nog niet bekeken.' });
    if (K.RONDJE_LATER_BLOKKEERT && rd.later) redenen.push({ code: 'rondje-later', aantal: rd.later, tekst: nm + ': rondje controle, ' + rd.later + (rd.later === 1 ? ' categorie staat' : ' categorieën staan') + ' op later meten (open taak).' });
    const uitzonderingen = uitzonderingenVan(r), kan = redenen.length === 0;
    const tel = c => ({ n: c.n, gemeten: c.gemeten, nvt: c.nvt });
    const scope = { ruimte: r.id, naam: nm, meubeltype: r.meubeltype || null, meubelset_gereed: !!(set && set.gereed), werkzone: lijst(r.werkzone).filter(w => wandIds(r).includes(w)), wanden_alleen_basis: wandIds(r).filter(w => !lijst(r.werkzone).includes(w)),
      vorm: { status: sc.vorm.status, afwijkend: sc.vorm.afwijkend, schematisch: sc.vorm.schematisch, veelhoek: !!sc.vorm.veelhoek, aantal_wanden: wandIds(r).length, uitsprongen: lijst(r.uitsprongen).filter(u => u && u.id).length }, telling: { basis: tel(t.basis), werkzone: tel(t.werkzone), extra: tel(t.extra) } };
    return { kan, redenen, waarschuwingen: K.waarschuwingen(r), scope, uitzonderingen, volledig_gemeten: kan && uitzonderingen.length === 0 };
  };
  K.vrijgeefCheck = function (opname) {
    const rs = lijst(opname && opname.ruimtes), redenen = [], waarschuwingen = [], scope = [], uitzonderingen = [];
    if (!rs.length) redenen.push({ code: 'geen-ruimte', tekst: 'Er is nog geen ruimte in deze opname.' });
    for (const r of rs) {
      const c = K.vrijgeefCheckRuimte(r);
      for (const x of c.redenen) redenen.push(Object.assign({ ruimte: r.id }, x));
      for (const x of c.waarschuwingen) waarschuwingen.push(Object.assign({ ruimte: r.id }, x));
      scope.push(c.scope); for (const x of c.uitzonderingen) uitzonderingen.push(x);
      // een foto van elke werkzone-wand is verplicht (maat + foto); van de andere wanden is een ontbrekende foto een waarschuwing
      for (const w of wandIds(r)) if (!K.fotosVan(opname, r.id, w).length) {
        if (lijst(r.werkzone).includes(w)) redenen.push({ ruimte: r.id, code: 'foto', wand: w, tekst: (r.naam || r.id) + ': maak eerst een foto van de ' + wandTekst(w) + ' (werkzone).' });
        else waarschuwingen.push({ ruimte: r.id, code: 'foto-ontbreekt', wand: w, tekst: (r.naam || r.id) + ': nog geen foto van de ' + wandTekst(w) + '.' });
      }
    }
    for (const f of lijst(opname && opname.fotos)) if (f && !f.ruimte) waarschuwingen.push({ code: 'foto-zonder-ruimte', tekst: 'Foto ' + (f.bestand || f.id) + ' heeft geen ruimte.' });
    const kan = redenen.length === 0;
    return { kan, redenen, waarschuwingen, scope, uitzonderingen, volledig_gemeten: kan && uitzonderingen.length === 0 };
  };
  // Wat opslaan betekent (opslaan kan altijd): hoeveel open, hoeveel later (taken), hoeveel n.v.t. en of er conflicten zijn.
  K.samenvatting = function (opname) {
    const s = { kan_opslaan: true, open: 0, later: 0, nvt: 0, gemeten: 0, conflicten: 0, taken: 0 };
    for (const r of lijst(opname && opname.ruimtes)) {
      const t = K.tellers(r); for (const b of ['basis', 'werkzone', 'extra']) { s.open += t[b].open; s.later += t[b].later; s.nvt += t[b].nvt; s.gemeten += t[b].gemeten; }
      s.conflicten += K.sluitcontrole(r).conflicten.length;
    }
    s.taken = K.takenlijst(opname).length;
    return s;
  };

  // ── Vrijgave gekoppeld aan de inhoud (ChatGPT-review 035, punt E) ──
  // Een vrijgave geldt voor precies één inhoud: de hash van wat inhoudelijk telt (maten, staten, bronnen, notities, meubeltype, werkzone, alle punten en bijzonderheden, rondje).
  // Tijdstippen, historie, grijze voorstellen, de beelden zelf, status en de vrijgave zelf tellen niet mee; de foto-verwijzingen van de werkzone-wanden wel (werkzoneFotos). Elke inhoudelijke wijziging maakt de vrijgave dus ongeldig, ook als een app vergeet de status terug te zetten.
  const VOLATIEL = { tijd: 1, historie: 1, voorstel: 1, bijgewerkt: 1, aangemaakt: 1, status: 1, vrijgave: 1, fotos: 1, rondje_historie: 1 };
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).filter(k => !VOLATIEL[k]).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
    return x === undefined ? 'null' : JSON.stringify(x);
  }
  function hash53(str) {                                                  // cyrb53: snel, zonder crypto, genoeg om een wijziging te zien (geen beveiliging)
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  }
  // Foto's tellen niet mee, behalve de verwijzingen van de werkzone-wanden: een foto daarvan is verplicht voor het vrijgeven, dus verwijderen of vervangen maakt de vrijgave ongeldig.
  // Alleen de verwijzing (ruimte, wand, bestandsnaam) gaat de hash in, nooit het beeld of een tijdstip.
  function werkzoneFotos(opname) {
    const l = [];
    for (const r of lijst(opname && opname.ruimtes)) for (const w of wandIds(r)) if (lijst(r && r.werkzone).includes(w)) for (const f of K.fotosVan(opname, r.id, w)) l.push([r.id, w, f.bestand || f.id || ''].join('|'));
    return l.sort();
  }
  // Een opname die van v0.3 gemigreerd is hasht als de oorspronkelijke versie (_versie_oud): zo blijft een bestaande vrijgave geldig na het lezen. Alleen de versie-velden worden zo gelezen, de inhoud niet.
  const hashVorm = o => { if (!isObj(o) || o._versie_oud === undefined) return o; const c = Object.assign({}, o, { versie: o._versie_oud }); delete c._versie_oud; return c; };
  K.inhoudsHash = opname => hash53(canon(hashVorm(opname)) + '#fotos:' + JSON.stringify(werkzoneFotos(opname)));
  K.isVrijgaveGeldig = opname => !!opname && opname.status === 'vrijgegeven' && isObj(opname.vrijgave) && opname.vrijgave.hash === K.inhoudsHash(opname);
  // De status zoals hij nu geldt: een vrijgave waarvan de inhoud veranderd is, heet "vrijgave-vervallen".
  K.effectieveStatus = opname => !opname ? null : opname.status === 'vrijgegeven' ? (K.isVrijgaveGeldig(opname) ? 'vrijgegeven' : 'vrijgave-vervallen') : (opname.status || 'concept');
  // Opslaan kan altijd. Een geldige vrijgave blijft staan, een vervallen vrijgave wordt "opgeslagen".
  K.slaOp = function (opname, tijd) {
    const o = kloon(opname); if (!o) return { opname: null, fout: 'Geen opname.' };
    o.status = K.isVrijgaveGeldig(opname) ? 'vrijgegeven' : 'opgeslagen'; o.bijgewerkt = tijd || nu();
    return { opname: o, fout: null, samenvatting: K.samenvatting(o) };
  };
  // Vrijgeven voor maatwerk: alleen als de check slaagt. Legt hash, tijd, scope en uitzonderingen vast.
  K.vrijgeven = function (opname, door, tijd) {
    const c = K.vrijgeefCheck(opname);
    if (!c.kan) return { opname: null, fout: 'Vrijgeven kan nog niet: ' + c.redenen.length + (c.redenen.length === 1 ? ' reden.' : ' redenen.'), check: c };
    const o = kloon(opname), t = tijd || nu();
    o.status = 'vrijgegeven'; o.bijgewerkt = t;
    o.vrijgave = { hash: K.inhoudsHash(o), tijd: t, door: door || null, scope: c.scope, uitzonderingen: c.uitzonderingen, volledig_gemeten: c.volledig_gemeten };
    return { opname: o, fout: null, check: c };
  };

  // ── Takenlijst ──
  // Alle "later"-punten (en categorieën van het rondje op later) worden een taak "Nameten: ...". De sleutel is stabiel, zodat opnieuw opslaan geen dubbele taken maakt.
  K.takenlijst = function (opname) {
    const taken = [], id = (opname && opname.opname_id) || '';
    for (const r of lijst(opname && opname.ruimtes)) {
      const rn = r.naam || r.id || 'Ruimte';
      for (const s of slotsVan(r)) {
        if (!s.bucket) continue;
        const m = maatOp(s.ent, s.sleutel);
        if (staatVan(m, s.keuzes) !== 'later') continue;
        taken.push({ sleutel: id + '|' + r.id + '|' + s.pad, tekst: 'Nameten: ' + rn + (s.wand ? ', ' + K.wandNaam(s.wand) : '') + ': ' + s.kort, ruimte: r.id, wand: s.wand, pad: s.pad, reden: (m && m.notitie) || '' });
      }
      for (const x of K.rondje(r).regels) if (x.waarde === 'later') {
        const n = isObj(r.rondje) && isObj(r.rondje[x.sleutel]) ? r.rondje[x.sleutel].notitie : '';
        taken.push({ sleutel: id + '|' + r.id + '|rondje.' + x.sleutel, tekst: 'Nameten: ' + rn + ', ' + K.wandNaam(x.wand) + ': ' + x.naam.toLowerCase() + ' beoordelen (rondje controle)', ruimte: r.id, wand: x.wand, pad: 'rondje.' + x.sleutel, reden: n || '' });
      }
    }
    return taken;
  };

  // ── Wijzigen (altijd een nieuwe opname; een eerdere stand verdwijnt nooit, maar komt in de historie van de maat) ──
  const zoekRuimte = (opname, id) => vind(opname && opname.ruimtes, id);
  // invoer: { staat, waarde, keuze, bron, notitie, tijd }. gemeten vraagt een waarde > 0 (of een geldige keuze) en bron disto of hand (standaard hand).
  K.zetMaat = function (opname, ruimteId, pad, invoer, tijd) {
    invoer = invoer || {};
    if (!K.STATEN.includes(invoer.staat)) return { opname: null, fout: 'Onbekende staat: gebruik gemeten, nvt, later of open.' };
    const o = kloon(opname), r = zoekRuimte(o, ruimteId); if (!r) return { opname: null, fout: 'Onbekende ruimte.' };
    zorgEntiteiten(r);
    const s = slotsVan(r).find(x => x.pad === pad); if (!s) return { opname: null, fout: 'Onbekend punt: ' + pad };
    const nieuw = { staat: invoer.staat, waarde: null, bron: null, tijd: invoer.tijd || tijd || nu() };
    if (invoer.staat === 'gemeten') {
      nieuw.bron = invoer.bron || 'hand';
      if (nieuw.bron !== 'disto' && nieuw.bron !== 'hand') return { opname: null, fout: 'Een meting komt van de DISTO of uit de hand. Een foto-voorstel is geen meting.' };
      if (s.keuzes) { if (!s.keuzes.includes(invoer.keuze)) return { opname: null, fout: 'Kies een van: ' + s.keuzes.join(', ') + '.' }; nieuw.keuze = invoer.keuze; }
      else { if (!getal(invoer.waarde) || invoer.waarde <= 0) return { opname: null, fout: 'Geef de maat in mm (groter dan 0).' }; nieuw.waarde = Math.round(invoer.waarde * 10) / 10; }
    }
    else if (invoer.staat === 'nvt' && s.nvtKeuzes) { if (!s.nvtKeuzes.includes(invoer.keuze)) return { opname: null, fout: 'Kies een van: ' + s.nvtKeuzes.join(', ') + '.' }; nieuw.keuze = invoer.keuze; }
    if (invoer.notitie) nieuw.notitie = String(invoer.notitie);
    const oud = maatOp(s.ent, s.sleutel);
    s.ent.maten = isObj(s.ent.maten) ? s.ent.maten : {};
    if (isObj(oud)) {
      const bewaar = Object.assign({}, oud); delete bewaar.historie; delete bewaar.voorstel;
      nieuw.historie = lijst(oud.historie).concat(oud.staat !== 'open' || oud.waarde != null ? [bewaar] : []);
      if (oud.voorstel) nieuw.voorstel = oud.voorstel;                    // het grijze voorstel blijft staan naast de meting
    }
    s.ent.maten[s.sleutel] = nieuw;
    o.bijgewerkt = invoer.tijd || tijd || nu();
    return { opname: o, fout: null };
  };
  // Het grijze voorstel uit de foto: raakt de staat of de waarde van de meting niet aan en telt nooit mee.
  K.zetVoorstel = function (opname, ruimteId, pad, voorstel, tijd) {
    if (!voorstel || !getal(voorstel.schatting_mm) || voorstel.schatting_mm <= 0) return { opname: null, fout: 'Een voorstel heeft een schatting_mm (mm, groter dan 0).' };
    if (voorstel.onzekerheid_mm != null && (!getal(voorstel.onzekerheid_mm) || voorstel.onzekerheid_mm < 0)) return { opname: null, fout: 'onzekerheid_mm is een getal van 0 of meer.' };
    const o = kloon(opname), r = zoekRuimte(o, ruimteId); if (!r) return { opname: null, fout: 'Onbekende ruimte.' };
    zorgEntiteiten(r);
    const s = slotsVan(r).find(x => x.pad === pad); if (!s) return { opname: null, fout: 'Onbekend punt: ' + pad };
    s.ent.maten = isObj(s.ent.maten) ? s.ent.maten : {};
    const m = isObj(s.ent.maten[s.sleutel]) ? s.ent.maten[s.sleutel] : K.nieuweMaat();
    m.voorstel = { schatting_mm: voorstel.schatting_mm, bron: 'foto-voorstel', tijd: voorstel.tijd || tijd || nu() };
    if (voorstel.onzekerheid_mm != null) m.voorstel.onzekerheid_mm = voorstel.onzekerheid_mm;      // alleen als onderbouwd; de schatting en de onzekerheid zijn twee aparte getallen
    s.ent.maten[s.sleutel] = m;
    return { opname: o, fout: null };
  };

  // ── Foto's: alleen een verwijzing (bestandsnaam, ruimte en wand). De ruimte staat bij de foto zelf, zodat die nooit meer verloren gaat. ──
  K.voegFotoToe = function (opname, foto) {
    foto = foto || {};
    if (!foto.bestand || typeof foto.bestand !== 'string') return { opname: null, fout: 'Een foto heeft een bestandsnaam.' };
    if (!zoekRuimte(opname, foto.ruimte)) return { opname: null, fout: 'Een foto hoort bij een ruimte van deze opname.' };
    if (foto.wand != null && !wandIds(zoekRuimte(opname, foto.ruimte)).includes(foto.wand)) return { opname: null, fout: 'Onbekende wand.' };
    const o = kloon(opname); o.fotos = lijst(o.fotos);
    if (o.fotos.some(f => f && f.bestand === foto.bestand && f.ruimte === foto.ruimte)) return { opname: null, fout: 'Dit bestand staat al bij deze ruimte.' };
    let n = o.fotos.length + 1; while (vind(o.fotos, 'F' + n)) n++;
    o.fotos.push(Object.assign({}, foto, { id: foto.id || 'F' + n, wand: foto.wand == null ? null : foto.wand, tijd: foto.tijd || nu() }));
    return { opname: o, fout: null };
  };
  K.fotosVan = (opname, ruimteId, wand) => lijst(opname && opname.fotos).filter(f => f && f.ruimte === ruimteId && (wand == null || f.wand === wand));
  // Een foto weghalen: de verwijzing verhuist naar opname.fotos_verwijderd (append-only), zodat er niets stil verdwijnt. Het beeld zelf beheert de opslag van de app.
  K.verwijderFoto = function (opname, fotoId, tijd) {
    if (!vind(opname && opname.fotos, fotoId)) return { opname: null, fout: 'Onbekende foto.' };
    const o = kloon(opname), f = vind(o.fotos, fotoId);
    o.fotos = o.fotos.filter(x => x !== f); o.fotos_verwijderd = lijst(o.fotos_verwijderd).concat([Object.assign({}, f, { verwijderd_op: tijd || nu() })]);
    o.bijgewerkt = tijd || nu();
    return { opname: o, fout: null };
  };

  // ── Wat er op een wand zit: openingen, objecten en bijzonderheden toevoegen, wijzigen en weghalen ──
  // De route vraagt alleen naar wat bestaat; de opnemer legt per wand vast wat er zit (deur, raam, stopcontact, radiator, plint, ...). Een id is voorvoegsel + volgnummer en is
  // uniek binnen de ruimte. Weghalen archiveert het hele item in ruimte.verwijderd (append-only): maten die al genomen zijn gaan nooit stil verloren.
  const ID_VOORVOEGSEL = { deur: 'D', raam: 'R', stopcontact: 'SC', schakelaar: 'SW', leiding: 'LT', radiator: 'RAD', vensterbank: 'VB', plint: 'PL', overig: 'OV', bijzonderheid: 'B' };
  const volgId = (r, voor) => { const gebruikt = {}; for (const l of [r.openingen, r.objecten, r.bijzonderheden, r.uitsprongen, r.verwijderd && lijst(r.verwijderd).map(x => x && x.item)]) for (const e of lijst(l)) if (e && e.id) gebruikt[e.id] = true; let n = 1; while (gebruikt[voor + n]) n++; return voor + n; };
  function wijzigRuimte(opname, ruimteId, fn) {
    const o = kloon(opname), r = zoekRuimte(o, ruimteId); if (!r) return { opname: null, fout: 'Onbekende ruimte.' };
    zorgEntiteiten(r); const res = fn(r, o); if (res && res.fout) return { opname: null, fout: res.fout };
    o.bijgewerkt = nu(); return Object.assign({ opname: o, fout: null }, res || {});
  }
  K.zetRuimte = (opname, ruimteId, wijz) => wijzigRuimte(opname, ruimteId, r => {
    wijz = wijz || {};
    if (wijz.naam != null) { if (!String(wijz.naam).trim()) return { fout: 'Geef de ruimte een naam.' }; r.naam = String(wijz.naam).trim(); }
    if (wijz.meubeltype != null) { if (!K.MEUBELTYPES.includes(wijz.meubeltype)) return { fout: 'Onbekend meubeltype.' }; r.meubeltype = wijz.meubeltype; }
    if (wijz.werkzone != null) { const ids = wandIds(r); if (!Array.isArray(wijz.werkzone) || wijz.werkzone.some(w => !ids.includes(w))) return { fout: 'Onbekende wand in de werkzone.' }; r.werkzone = ids.filter(w => wijz.werkzone.includes(w)); }
    if (wijz.toegangsdeur !== undefined) { if (wijz.toegangsdeur === null) delete r.toegangsdeur; else if (!vind(r.openingen, wijz.toegangsdeur)) return { fout: 'Onbekende deur.' }; else r.toegangsdeur = wijz.toegangsdeur; }
  });
  K.voegOpeningToe = (opname, ruimteId, nieuw) => wijzigRuimte(opname, ruimteId, r => {
    nieuw = nieuw || {};
    if (nieuw.soort !== 'deur' && nieuw.soort !== 'raam') return { fout: 'Een opening is een deur of een raam.' };
    if (!wandIds(r).includes(nieuw.wand)) return { fout: 'Kies de wand waar de opening zit.' };
    if (nieuw.definitie && !K.DEFINITIES[nieuw.definitie]) return { fout: 'Onbekende definitie.' };
    const id = volgId(r, ID_VOORVOEGSEL[nieuw.soort]), e = { id, soort: nieuw.soort, wand: nieuw.wand, maten: {} };
    if (nieuw.definitie) e.definitie = nieuw.definitie;
    if (nieuw.naam) e.naam = String(nieuw.naam);
    r.openingen = lijst(r.openingen).concat([e]); return { id };
  });
  K.voegObjectToe = (opname, ruimteId, nieuw) => wijzigRuimte(opname, ruimteId, r => {
    nieuw = nieuw || {};
    if (!K.OBJECTTYPES[nieuw.type]) return { fout: 'Onbekend soort object.' };
    if (!wandIds(r).includes(nieuw.wand)) return { fout: 'Kies de wand waar het object zit.' };
    if (nieuw.hoek && !lijst(r.wanden).some(e => e && (e.van === nieuw.hoek || e.naar === nieuw.hoek)) && !HOEK_NAAM[nieuw.hoek]) return { fout: 'Onbekende hoek.' };
    if (nieuw.opening && !vind(r.openingen, nieuw.opening)) return { fout: 'Onbekende opening.' };
    const id = volgId(r, ID_VOORVOEGSEL[nieuw.type]), e = { id, type: nieuw.type, wand: nieuw.wand, maten: {} };
    if (nieuw.hoek) e.hoek = nieuw.hoek;
    if (nieuw.opening) e.opening = nieuw.opening;
    if (nieuw.naam) e.naam = String(nieuw.naam);
    if (!lijst(r.werkzone).includes(nieuw.wand)) e.eigen = true;               // buiten de werkzone zelf toegevoegd: het wordt gevraagd (extra), het is geen "gezien"
    r.objecten = lijst(r.objecten).concat([e]); return { id };
  });
  K.voegBijzonderheidToe = (opname, ruimteId, nieuw) => wijzigRuimte(opname, ruimteId, r => {
    nieuw = nieuw || {};
    if (!K.BIJZONDERHEDEN[nieuw.soort]) return { fout: 'Onbekende bijzonderheid.' };
    if (!wandIds(r).includes(nieuw.wand)) return { fout: 'Kies de wand.' };
    const id = volgId(r, ID_VOORVOEGSEL.bijzonderheid), e = { id, soort: nieuw.soort, wand: nieuw.wand, maten: nieuw.bemeten ? { maat: K.nieuweMaat() } : {} };
    if (nieuw.notitie) e.notitie = String(nieuw.notitie);
    r.bijzonderheden = lijst(r.bijzonderheden).concat([e]); return { id };
  });
  K.zetDefinitie = (opname, ruimteId, openingId, definitie) => wijzigRuimte(opname, ruimteId, r => {
    const e = vind(r.openingen, openingId); if (!e) return { fout: 'Onbekende opening.' };
    if (!K.DEFINITIES[definitie]) return { fout: 'Kies muursparing, dagmaat of kozijn buiten.' };
    e.definitie = definitie;
  });
  // lijstNaam: openingen, objecten of bijzonderheden. Het item (met al zijn maten) gaat naar ruimte.verwijderd; was het de toegangsdeur, dan vervalt die keuze.
  K.verwijderItem = (opname, ruimteId, lijstNaam, id, tijd) => wijzigRuimte(opname, ruimteId, r => {
    if (!['openingen', 'objecten', 'bijzonderheden', 'uitsprongen'].includes(lijstNaam)) return { fout: 'Onbekende lijst.' };
    const e = vind(r[lijstNaam], id); if (!e) return { fout: 'Onbekend item.' };
    r[lijstNaam] = lijst(r[lijstNaam]).filter(x => x !== e);
    r.verwijderd = lijst(r.verwijderd).concat([{ lijst: lijstNaam, item: e, tijd: tijd || nu() }]);
    if (lijstNaam === 'openingen' && r.toegangsdeur === id) delete r.toegangsdeur;
    for (const ob of lijst(r.objecten)) if (ob && ob.opening === id) delete ob.opening;                   // een vensterbank die bij dit raam hoorde, vraagt dan zijn eigen hoogte
    if (lijstNaam === 'uitsprongen') { const we = vind(r.wanden, e.wand); if (we && we.foto_vorm && Array.isArray(we.foto_vorm.tussenstukken) && getal(e.stuk)) we.foto_vorm.tussenstukken[e.stuk] = 'recht'; }          // het stuk is weer recht
  });

  // ── De vorm van de kamer: wanden uit de fotoronde, hoeken, knikken en uitsprongen (v0.4) ──
  // De fotoronde begint bij de toegangsdeur en loopt met de klok mee: elke foto is een wand (W1, W2, ...). "Kamer rond" sluit de ring (de laatste wand loopt terug naar de eerste hoek).
  // Alles werkt op een kopie en laat niets verdwijnen: een weggehaalde wand of uitsprong gaat naar ruimte.verwijderd, de foto's naar opname.fotos_verwijderd.
  const wandNrMax = r => Math.max.apply(null, [0].concat(wandIds(r).map(w => wandNummer(w) || 0), lijst(r.verwijderd).filter(x => x && x.lijst === 'wanden' && x.item).map(x => wandNummer(x.item.id) || 0)));
  K.voegWandToe = (opname, ruimteId) => wijzigRuimte(opname, ruimteId, r => {
    if (r.rond !== false) return { fout: 'Deze ruimte heeft vaste wanden of is al rond.' };
    const ids = wandIds(r), nr = wandNrMax(r) + 1, laatste = ids.length ? vind(r.wanden, ids[ids.length - 1]) : null, id = 'W' + nr;
    r.wanden.push({ id, van: laatste ? laatste.naar : 'H1', naar: 'H' + (nr + 1), maten: {} });
    return { id };
  });
  // De laatste wand weer weghalen (een foto te veel): alleen als er nog niets op die wand staat of gemeten is. De wand en zijn foto's gaan naar het archief.
  K.verwijderLaatsteWand = (opname, ruimteId, tijd) => wijzigRuimte(opname, ruimteId, (r, o) => {
    if (r.rond !== false) return { fout: 'Open de ronde eerst weer.' };
    const ids = wandIds(r), laatste = ids.length ? vind(r.wanden, ids[ids.length - 1]) : null; if (!laatste) return { fout: 'Er is geen wand om weg te halen.' };
    if (['openingen', 'objecten', 'bijzonderheden', 'uitsprongen'].some(l => lijst(r[l]).some(e => e && e.wand === laatste.id))) return { fout: 'Op deze wand staan onderdelen: haal die eerst weg.' };
    if (Object.keys(isObj(laatste.maten) ? laatste.maten : {}).some(k => isObj(laatste.maten[k]) && laatste.maten[k].staat && laatste.maten[k].staat !== 'open')) return { fout: 'Van deze wand zijn al maten ingevuld.' };
    const t = tijd || nu();
    r.wanden = r.wanden.filter(x => x !== laatste); r.verwijderd = lijst(r.verwijderd).concat([{ lijst: 'wanden', item: laatste, tijd: t }]);
    r.werkzone = lijst(r.werkzone).filter(w => w !== laatste.id);
    const weg = lijst(o.fotos).filter(f => f && f.ruimte === r.id && f.wand === laatste.id);
    o.fotos = lijst(o.fotos).filter(f => !weg.includes(f)); o.fotos_verwijderd = lijst(o.fotos_verwijderd).concat(weg.map(f => Object.assign({}, f, { verwijderd_op: t })));
    return { id: laatste.id };
  });
  // Kamer rond: terug bij de eerste wand. Vraagt minstens drie wanden.
  K.maakRond = (opname, ruimteId) => wijzigRuimte(opname, ruimteId, r => {
    const ids = wandIds(r); if (r.rond !== false) return { fout: 'De ronde is al gesloten.' };
    if (ids.length < 3) return { fout: 'Een ruimte heeft minstens drie wanden.' };
    vind(r.wanden, ids[ids.length - 1]).naar = vind(r.wanden, ids[0]).van; r.rond = true;
  });
  K.openRond = (opname, ruimteId) => wijzigRuimte(opname, ruimteId, r => {
    const ids = wandIds(r); if (r.rond !== false && !ids.every(w => wandNummer(w))) return { fout: 'Een ruimte met vaste wanden (v0.3) heeft geen ronde om te openen.' };
    if (r.rond === false) return { fout: 'De ronde is al open.' };
    vind(r.wanden, ids[ids.length - 1]).naar = 'H' + (wandNrMax(r) + 1); r.rond = false;
  });
  // De hoek naar de volgende wand, in graden (binnenhoek): 90 is een gewone hoek, 270 een inspringende hoek, alles ertussen is schuin. Standaard een aanname; een eigen waarde is een foto-voorstel
  // (schatting) tot de hoek gemeten is. De vorige stand blijft in de historie.
  K.zetHoek = (opname, ruimteId, wandId, graden, bron, tijd) => wijzigRuimte(opname, ruimteId, r => {
    const e = vind(r.wanden, wandId); if (!e) return { fout: 'Onbekende wand.' };
    if (!getal(graden) || graden < 20 || graden > 340 || Math.abs(graden - 180) < 1) return { fout: 'Geef een hoek tussen 20 en 340 graden, niet 180 (dan is het geen hoek).' };
    const g = Math.round(graden * 10) / 10, haaks = Math.abs(g - 90) <= K.TOLERANTIE.hoek_haaks || Math.abs(g - 270) <= K.TOLERANTIE.hoek_haaks, b = bron || (haaks ? 'aanname' : 'foto-voorstel');
    if (!K.HOEK_BRONNEN.includes(b)) return { fout: 'Onbekende bron voor de hoek.' };
    const oud = isObj(e.hoek_naar_volgende) ? e.hoek_naar_volgende : null;
    e.hoek_naar_volgende = { graden: g, bron: b, tijd: tijd || nu() };
    if (oud) e.hoek_naar_volgende.historie = lijst(oud.historie).concat([{ graden: oud.graden, bron: oud.bron, tijd: oud.tijd || null }]);
  });
  // Een extra diagonaal als controle van de vorm (optioneel; bij precies vier wanden bestaan A en B al). van en naar zijn hoek-id's (H1, H2, ...).
  K.voegDiagonaalToe = (opname, ruimteId, van, naar) => wijzigRuimte(opname, ruimteId, r => {
    const hoeken = wandIds(r).map(w => wandHoeken(r, w)[0]); if (!hoeken.includes(van) || !hoeken.includes(naar) || van === naar) return { fout: 'Kies twee verschillende hoeken van deze ruimte.' };
    if (lijst(r.diagonalen).some(d => d && ((d.van === van && d.naar === naar) || (d.van === naar && d.naar === van)))) return { fout: 'Deze diagonaal bestaat al.' };
    let id = 'C'; while (vind(r.diagonalen, id)) id = String.fromCharCode(id.charCodeAt(0) + 1);
    r.diagonalen = lijst(r.diagonalen).concat([{ id, van, naar, maten: {} }]); return { id };
  });
  // De vorm van een wand uit de foto: knikken = de op de vloerlijn aangetikte punten (x, y als fractie van de foto, u = waar op de wand, 0 tot 1, volgens de homografie van de wandhoeken),
  // tussenstukken = per stuk tussen twee knikken 'recht' (standaard), 'voor' (uitsprong: schoorsteen, pilaster, koker) of 'achter' (nis, inham). Een voor- of achterstuk wordt een uitsprong met
  // breedte, positie en diepte; de verhouding op de wand is een foto-voorstel. Een uitsprong in de hoek is geen tussenstuk: maak er een eigen wand van met een hoek van 90 of 270 graden.
  K.zetWandVorm = (opname, ruimteId, wandId, vorm, tijd) => wijzigRuimte(opname, ruimteId, r => {
    const e = vind(r.wanden, wandId); if (!e) return { fout: 'Onbekende wand.' };
    vorm = vorm || {}; const kn = lijst(vorm.knikken).slice(), ts = lijst(vorm.tussenstukken).slice(), t = tijd || nu();
    if (kn.length === 1) return { fout: 'Tik minstens twee knikken: het begin en het eind van het stuk dat afwijkt.' };
    if (kn.length && ts.length !== kn.length - 1) return { fout: 'Elk stuk tussen twee knikken heeft een vorm nodig.' };
    for (const k of kn) if (!isObj(k) || !getal(k.x) || !getal(k.y) || !getal(k.u) || k.u <= 0 || k.u >= 1) return { fout: 'Een knik moet binnen de wand liggen (niet in de hoek).' };
    for (let i = 1; i < kn.length; i++) if (!(kn[i].u > kn[i - 1].u + 0.005)) return { fout: 'De knikken moeten van links naar rechts staan.' };
    if (ts.some(v => !K.TUSSENSTUK_VORMEN.includes(v))) return { fout: 'Een stuk is recht, naar voren of naar achteren.' };
    const bestaand = lijst(r.uitsprongen).filter(u => u && u.wand === wandId), blijft = {};
    ts.forEach((v, i) => {
      if (v === 'recht') return;
      let u = bestaand.find(x => x.stuk === i);
      const fotoVan = { x: kn[i].x, y: kn[i].y }, fotoTot = { x: kn[i + 1].x, y: kn[i + 1].y };
      if (!u) {
        const id = volgId(r, 'U'); u = { id, wand: wandId, soort: v, maten: {} }; r.uitsprongen = lijst(r.uitsprongen).concat([u]);
      }
      u.soort = v; u.stuk = i; u.verhouding = { van: Math.round(kn[i].u * 1000) / 1000, tot: Math.round(kn[i + 1].u * 1000) / 1000, bron: 'foto-voorstel' }; u.foto = { links: fotoVan, rechts: fotoTot };
      if (!u.tijd) u.tijd = t;
      blijft[u.id] = true;
    });
    for (const u of bestaand) if (!blijft[u.id]) {              // dit stuk is nu recht (of weg): de uitsprong gaat met zijn maten naar het archief
      r.uitsprongen = lijst(r.uitsprongen).filter(x => x !== u); r.verwijderd = lijst(r.verwijderd).concat([{ lijst: 'uitsprongen', item: u, tijd: t }]);
    }
    if (kn.length) e.foto_vorm = { foto: vorm.foto || null, knikken: kn.map(k => ({ x: k.x, y: k.y, u: Math.round(k.u * 1000) / 1000 })), tussenstukken: ts, tijd: t }; else delete e.foto_vorm;
    return { uitsprongen: lijst(r.uitsprongen).filter(u => u.wand === wandId).map(u => u.id) };
  });

  // ── De route: de vragen punt voor punt in een logische volgorde ──
  // Geen totaaloverzicht, maar een geordende lijst stappen (met nr en "stap x van y"). Standaardvolgorde 'fotos-dan-rondloop' (Bart, 1-11):
  //   fase 1  fotoronde: een foto per wand, met de klok mee vanaf de toegangsdeur;
  //   fase 2  maten-rondloop: start bij de eerste werkzone-wand en gaat met de klok mee. Per wand: wandlengte, openingen van links naar rechts (breedte, hoogte, positie vanaf de
  //           linkerhoek, borstwering), in de werkzone daarna de objecten van links naar rechts, de plint en "bijzonderheden op deze wand?"; buiten de werkzone daarna de
  //           bevestiging "gehele wand bekeken";
  //   fase 3  ruimtebreed: plafondhoogte, diagonaal A (en B, optioneel);
  //   fase 4  rondje controle per werkzone-wand en categorie (afwijkingen komen al bij "bijzonderheden op deze wand?" aan bod).
  // Alternatieven: 'rondloop' (start bij de toegangsdeur, de foto is de eerste stap van elke wand) en 'per-soort' (eerst alle wandlengtes, dan alle openingen, enzovoort).
  // Later en n.v.t. houden de route niet op: alleen stappen die nog echt open staan zijn "open". Optionele stappen (grijze voorstellen) worden niet als open aangeboden.
  const klok = (ids, start) => { const i = Math.max(0, ids.indexOf(start)); return ids.slice(i).concat(ids.slice(0, i)); };             // de wanden met de klok mee, beginnend bij start
  const ZONDER_FOTO_UITLEG = 'Gebruik de camera van de telefoon in volle resolutie. De wand recht van voren, met beide hoeken, de plafondrand en de vloerlijn in beeld.';
  const rondjeStaat = w => w === 'aanwezig' ? 'gemeten' : w === 'afwezig' ? 'nvt' : w === 'later' ? 'later' : 'open';
  // Links naar rechts: alleen als alle elementen een bekende x hebben (gemeten positie of positie_x), anders blijft de volgorde van de invoer staan.
  function linksRechts(ents, sleutel) {
    const x = e => { const v = e.positie_x != null ? e.positie_x : (sleutel && (!e.positie_vanaf || e.positie_vanaf === 'hoek')) ? K.waarde(maatOp(e, sleutel)) : null; return getal(v) ? v : null; };
    const l = ents.slice(); if (!l.length || !l.every(e => x(e) != null)) return l;
    return l.map((e, i) => ({ e, i, v: x(e) })).sort((a, b) => a.v - b.v || a.i - b.i).map(o => o.e);
  }
  K.route = function (ruimte, opties) {
    opties = opties || {};
    const r = ruimte || {}, volgorde = K.ROUTE_VOLGORDES.includes(opties.volgorde) ? opties.volgorde : 'fotos-dan-rondloop', fotos = lijst(opties.fotos).filter(f => f && f.ruimte === r.id);
    const alle = wandIds(r), N = alle.length, zone = alle.filter(w => lijst(r.werkzone).includes(w)), inZone = w => zone.includes(w), conf = conflictPaden(r), slots = slotsVan(r).filter(s => s.bucket);
    const deur = vind(r.openingen, r.toegangsdeur) || lijst(r.openingen).find(o => o && o.soort === 'deur'), toegang = deur && alle.includes(deur.wand) ? deur.wand : (alle[0] || null);
    const fotoWanden = klok(alle, toegang), startMaten = fotoWanden.find(inZone) || toegang, matenWanden = klok(alle, volgorde === 'rondloop' ? toegang : startMaten);
    const wandNr = (lijstW, w) => lijstW.indexOf(w) + 1;
    const stappen = [], geplaatst = {};
    const maatStap = (s, fase) => {
      geplaatst[s.pad] = true;
      const m = maatOp(s.ent, s.sleutel), st = staatVan(m, s.keuzes), nr = s.wand ? wandNr(matenWanden, s.wand) : null;
      stappen.push({ id: 'maat:' + s.pad, type: s.soort === 'wandbevestiging' ? 'wandbevestiging' : 'maat', fase, wand: s.wand, wand_nr: nr, wanden_totaal: s.wand ? N : null, groep: s.bucket, soort: s.soort, label: s.kort, vraag: s.vraag, definitie: s.definitie, referentie: s.referentie,
        uitleg: s.uitleg, pad: s.pad, eenheid: s.eenheid, keuzes: s.keuzes, nvt_keuzes: s.nvtKeuzes, staat: st, afgehandeld: st !== 'open', optioneel: s.bucket === 'optie', conflict: st === 'gemeten' && !!conf[s.pad], object: s.object });
    };
    const fotoStap = (w, fase, lijstW) => stappen.push({ id: 'foto:' + w, type: 'foto', fase, wand: w, wand_nr: wandNr(lijstW, w), wanden_totaal: N, groep: 'foto', soort: 'foto', label: 'Foto ' + wandTekst(w), vraag: 'Maak een foto van de ' + wandTekst(w) + '.',
      definitie: '', referentie: 'wand', uitleg: ZONDER_FOTO_UITLEG, pad: null, eenheid: 'foto', keuzes: null, nvt_keuzes: null, staat: fotos.some(f => f.wand === w) ? 'gemeten' : 'open', afgehandeld: fotos.some(f => f.wand === w), optioneel: false, conflict: false, object: null });
    const bijzStap = (w, fase) => {
      const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, 'afw')] : null), st = rondjeStaat(waarde);
      stappen.push({ id: 'bijz:' + w, type: 'bijzonderheden', fase, wand: w, wand_nr: wandNr(matenWanden, w), wanden_totaal: N, groep: 'werkzone', soort: 'bijzonderheden', label: 'Bijzonderheden ' + wandKort(w),
        vraag: 'Zijn er bijzonderheden op de ' + wandTekst(w) + '?', definitie: '', referentie: 'wand', uitleg: 'Bijvoorbeeld een hogere stootplint, een ingestucte balk of verlaging, een koof, nis, een wand die uit het lood staat, een leiding in zicht of een kabelgoot. Noem ze, meten mag.',
        pad: 'rondje.' + rondjeSleutel(w, 'afw'), eenheid: 'rondje', keuzes: K.RONDJE_KEUZES, nvt_keuzes: null, staat: st, afgehandeld: st !== 'open', optioneel: false, conflict: false, object: null });
    };
    // de slots van één wand, in de volgorde van de rondloop (openingen en objecten van links naar rechts)
    const wandSlots = w => {
      const s = slots.filter(x => x.wand === w), soort = k => s.filter(x => x.soort === k);
      const geordend = (k, bron, sleutel) => {
        const ids = []; soort(k).forEach(x => { if (!ids.includes(x.object)) ids.push(x.object); });
        return linksRechts(lijst(bron).filter(e => e && ids.includes(e.id)), sleutel).reduce((l, e) => l.concat(soort(k).filter(x => x.object === e.id)), []);
      };
      const uitspr = (() => { const ids2 = []; soort('uitsprong').forEach(x => { if (!ids2.includes(x.object)) ids2.push(x.object); }); const L = K.waarde(maatOp(vind(r.wanden, w), 'lengte')) || 10000, pos = e => { const v = uitsprongWaarden(r, e, L); return v.positie ? v.positie.mm : 0; };
        return lijst(r.uitsprongen).filter(e => e && ids2.includes(e.id)).sort((a, b) => pos(a) - pos(b)).reduce((l, e) => l.concat(soort('uitsprong').filter(x => x.object === e.id)), []); })();
      return { lengte: soort('wandlengte'), plafond: soort('wandplafond'), uitspr, openingen: geordend('opening', r.openingen, 'positie'), objecten: geordend('object', r.objecten, null), plint: geordend('plint', r.objecten, null), bijz: soort('bijzonderheid'), bevestiging: soort('wandbevestiging') };
    };
    const blokken = {}; matenWanden.forEach(w => { blokken[w] = wandSlots(w); });
    const ruimteSlots = slots.filter(x => x.soort === 'plafond' || x.soort === 'diagonaal');
    const rondjeStappen = () => {
      for (const w of matenWanden.filter(inZone)) for (const [cat, naam] of K.RONDJE_CATEGORIEEN) {
        if (cat === 'afw') continue;                                       // staat al bij "bijzonderheden op deze wand?"
        const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, cat)] : null), st = rondjeStaat(waarde);
        stappen.push({ id: 'rondje:' + rondjeSleutel(w, cat), type: 'rondje', fase: 'rondje', wand: w, wand_nr: wandNr(matenWanden, w), wanden_totaal: N, groep: 'rondje', soort: 'rondje', categorie: cat, label: naam + ' ' + wandKort(w),
          vraag: 'Rondje ' + wandTekst(w) + ': ' + naam.toLowerCase() + '. Is alles wat er is vastgelegd?', definitie: '', referentie: 'wand', uitleg: 'Kies aanwezig en vastgelegd, niet aanwezig of n.v.t., of later meten. Niet gekozen blijft "nog niet bekeken", nooit "afwezig".',
          pad: 'rondje.' + rondjeSleutel(w, cat), eenheid: 'rondje', keuzes: K.RONDJE_KEUZES, nvt_keuzes: null, staat: st, afgehandeld: st !== 'open', optioneel: false, conflict: false, object: null });
      }
    };
    if (volgorde === 'per-soort') {
      fotoWanden.forEach(w => fotoStap(w, 'fotoronde', fotoWanden));
      const fase = 'soort';
      for (const k of ['lengte', 'plafond', 'uitspr', 'bevestiging', 'openingen', 'objecten', 'plint']) matenWanden.forEach(w => blokken[w][k].forEach(x => maatStap(x, fase)));
      matenWanden.filter(inZone).forEach(w => { bijzStap(w, fase); blokken[w].bijz.forEach(x => maatStap(x, fase)); });
    } else {
      if (volgorde === 'fotos-dan-rondloop') fotoWanden.forEach(w => fotoStap(w, 'fotoronde', fotoWanden));
      matenWanden.forEach(w => {
        const b = blokken[w];
        if (volgorde === 'rondloop') fotoStap(w, 'wand', matenWanden);
        b.lengte.forEach(x => maatStap(x, 'wand')); b.plafond.forEach(x => maatStap(x, 'wand')); b.uitspr.forEach(x => maatStap(x, 'wand')); b.openingen.forEach(x => maatStap(x, 'wand')); b.objecten.forEach(x => maatStap(x, 'wand')); b.plint.forEach(x => maatStap(x, 'wand'));
        if (inZone(w)) bijzStap(w, 'wand');
        b.bijz.forEach(x => maatStap(x, 'wand')); b.bevestiging.forEach(x => maatStap(x, 'wand'));
      });
    }
    ruimteSlots.forEach(x => maatStap(x, 'ruimte'));
    slots.filter(x => !geplaatst[x.pad]).forEach(x => maatStap(x, 'ruimte'));      // vangnet: een punt zonder (bekende) wand valt nooit uit de route
    rondjeStappen();
    stappen.forEach((s, i) => { s.nr = i + 1; s.totaal = stappen.length; s.stap = 'stap ' + (i + 1) + ' van ' + stappen.length; s.wand_tekst = s.wand_nr ? 'wand ' + s.wand_nr + ' van ' + s.wanden_totaal : ''; });
    const vereist = stappen.filter(s => !s.optioneel), open = vereist.filter(s => !s.afgehandeld);
    return { volgorde, toegangswand: toegang, foto_wanden: fotoWanden, maten_wanden: matenWanden, start_wand: volgorde === 'rondloop' ? toegang : startMaten, stappen,
      samenvatting: { totaal: stappen.length, vereist: vereist.length, optioneel: stappen.length - vereist.length, afgehandeld: vereist.length - open.length, nog_relevant: open.length } };
  };
  K.routeVanOpname = (opname, ruimteId, opties) => K.route(zoekRuimte(opname, ruimteId), Object.assign({}, opties, { fotos: lijst(opname && opname.fotos) }));
  // De eerstvolgende stap na stap `na` (nr of id; weglaten = vanaf het begin) die nog echt open staat. Later en n.v.t. tellen als afgehandeld, optionele stappen worden overgeslagen.
  // Met { wrap: true } begint de zoektocht na het einde weer vooraan (handig voor "ga naar het volgende open punt"). Geen open stap meer: null.
  K.volgendeOpen = function (route, na, opties) {
    const l = lijst(route && route.stappen), i0 = typeof na === 'string' ? (l.findIndex(s => s.id === na) + 1) : (getal(na) ? na : 0);
    const open = s => !s.afgehandeld && !s.optioneel;
    return l.slice(i0).find(open) || ((opties && opties.wrap) ? l.slice(0, i0).find(open) || null : null);
  };
  K.vorige = function (route, na) {
    const l = lijst(route && route.stappen), i = typeof na === 'string' ? l.findIndex(s => s.id === na) + 1 : getal(na) ? na : 0;
    return i > 1 ? l[i - 2] || null : null;
  };
  K.stap = (route, na) => lijst(route && route.stappen).find(s => typeof na === 'string' ? s.id === na : s.nr === na) || null;

  // ── Veilig lezen en migreren ──
  // Leest elk object zonder iets weg te gooien. Gelijk of ouder: additief aanvullen (ontbrekende onderdelen toevoegen). v0.2 en onbekend: het origineel blijft
  // volledig bewaard onder _oud. Nieuwer dan deze kern: ongewijzigd teruggeven met alleenLezen, zodat een oudere app het niet met verlies terugschrijft.
  const geldigeVersie = v => v != null && /^\d+(\.\d+)*$/.test(String(v));
  const versieDelen = v => String(v).split('.').slice(0, 2).map(x => parseInt(x, 10));                // alleen hoofd.deel: een patchversie (0.3.1) blijft leesbaar
  const nieuwerDan = (a, b) => { const x = versieDelen(a), y = versieDelen(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const p = x[i] || 0, q = y[i] || 0; if (p !== q) return p > q; } return false; };
  function normMaat(m, meld, waar) {
    if (m == null) return m;
    if (getal(m)) { meld.push(waar + ': kaal getal gelezen als gemeten (hand).'); return { staat: 'gemeten', waarde: m, bron: 'hand', tijd: null }; }
    if (!isObj(m)) { meld.push(waar + ': onbekende waarde bewaard in _oud.'); return { staat: 'open', waarde: null, bron: null, tijd: null, _oud: m }; }
    const x = Object.assign({}, m);
    if (!K.STATEN.includes(x.staat)) { if (x.staat !== undefined) { x._staat_oud = x.staat; meld.push(waar + ': onbekende staat "' + x.staat + '" gelezen als open (origineel bewaard).'); } x.staat = 'open'; }
    if (typeof x.waarde === 'string' && x.waarde.trim() !== '' && isFinite(Number(x.waarde.replace(',', '.')))) { x._waarde_oud = x.waarde; x.waarde = Number(x.waarde.replace(',', '.')); }
    if (x.waarde === undefined) x.waarde = null;
    if (x.waarde !== null && !getal(x.waarde)) { x._waarde_oud = x.waarde; x.waarde = null; meld.push(waar + ': waarde is geen getal, origineel bewaard.'); }
    if (x.bron === undefined) x.bron = null;
    if (x.bron !== null && !K.BRONNEN.includes(x.bron)) { x._bron_oud = x.bron; x.bron = null; meld.push(waar + ': onbekende bron, origineel bewaard.'); }
    if (x.tijd === undefined) x.tijd = null;
    if (isObj(x.voorstel) && x.voorstel.schatting_mm === undefined && getal(x.voorstel.waarde)) { x.voorstel = Object.assign({}, x.voorstel, { schatting_mm: x.voorstel.waarde }); if (getal(x.voorstel.pm)) x.voorstel.onzekerheid_mm = x.voorstel.pm; }   // oudere naamgeving: oude velden blijven staan
    return x;
  }
  function normRuimte(r, i, meld) {
    const x = isObj(r) ? r : { _oud: r };
    if (!x.id) { x.id = 'R' + (i + 1); meld.push('Ruimte ' + (i + 1) + ' had geen id: ' + x.id + ' gezet.'); }
    if (!x.naam) x.naam = x.id;
    if (!x.meubeltype) x.meubeltype = 'kast';
    zorgEntiteiten(x);
    const wzIn = x.werkzone, okW = w => wandIds(x).includes(w); let goed = [], rest = null;
    if (Array.isArray(wzIn)) { goed = wzIn.filter(okW); const f = wzIn.filter(w => !okW(w)); if (f.length) rest = f; }
    else if (typeof wzIn === 'string' && okW(wzIn)) goed = [wzIn];
    else if (wzIn != null) rest = wzIn;
    x.werkzone = goed;
    if (rest !== null) { x._onbekend = Object.assign({}, x._onbekend, { werkzone: rest }); meld.push(x.naam + ': onbekende werkzone-waarden bewaard in _onbekend.'); }
    x.openingen = lijst(x.openingen); x.objecten = lijst(x.objecten); x.bijzonderheden = lijst(x.bijzonderheden);
    if (!isObj(x.rondje)) x.rondje = {};
    for (const k of Object.keys(x.rondje)) if (!isObj(x.rondje[k]) && K.RONDJE_KEUZES.includes(x.rondje[k])) x.rondje[k] = { waarde: x.rondje[k], tijd: null };
    const maten = (ent, waar) => { if (!isObj(ent)) return; if (!isObj(ent.maten)) ent.maten = {}; for (const k of Object.keys(ent.maten)) ent.maten[k] = normMaat(ent.maten[k], meld, x.naam + ' ' + waar + '.' + k); };
    for (const l of [x.wanden, x.plafondpunten, x.diagonalen, x.openingen, x.objecten, x.bijzonderheden, lijst(x.uitsprongen)]) for (const e of l) maten(e, e && e.id);
    return x;
  }
  K.lees = function (invoer) {
    const meld = [];
    if (!isObj(invoer)) return { opname: null, alleenLezen: true, origineel: invoer === undefined ? null : kloon(invoer), meldingen: ['Geen opname-object: niets omgezet, origineel bewaard.'] };
    const o = kloon(invoer), v = o.versie != null ? o.versie : o.schema_versie;
    if (geldigeVersie(v) && nieuwerDan(v, K.VERSIE)) return { opname: o, alleenLezen: true, origineel: null, meldingen: ['Opname-versie ' + v + ' is nieuwer dan deze app (' + K.VERSIE + '): alleen lezen, niets wordt omgezet of teruggeschreven.'] };
    if ((geldigeVersie(v) && nieuwerDan(K.MIN_LEESBAAR, v)) || (v != null && !geldigeVersie(v)) || (v == null && !Array.isArray(o.ruimtes))) {
      // ouder (v0.2 of eerder) of onbekend: de kern wordt nieuw, het hele origineel blijft in _oud
      const n = K.nieuweOpname({ opname_id: o.opname_id || o.id || null, project: o.project_nr ? { code: o.project_nr } : isObj(o.project) ? o.project : {}, ruimtes: [K.nieuweRuimte({ id: 'R1', naam: typeof o.ruimte === 'string' ? o.ruimte : 'Ruimte' })] });
      n._oud = Object.assign({ versie: v == null ? 'onbekend' : String(v) }, o);
      meld.push('Opname van versie ' + (v == null ? 'onbekend' : v) + ' gelezen: de maten zijn niet automatisch omgezet. Het volledige origineel staat ongewijzigd in _oud.');
      return { opname: n, alleenLezen: false, origineel: null, meldingen: meld };
    }
    if (v == null) meld.push('Versie ontbrak: gelezen als ' + K.VERSIE + '.');
    o.schema = o.schema || 'mt-opname'; if (o.versie !== undefined && o.versie !== K.VERSIE) o._versie_oud = o.versie; o.versie = K.VERSIE; o.status = o.status || 'concept';
    if (!isObj(o.project)) { if (o.project != null) o._project_oud = o.project; o.project = { code: null }; }
    o.fotos = lijst(o.fotos);
    o.ruimtes = lijst(o.ruimtes).map((r, i) => normRuimte(r, i, meld));
    if (!o.ruimtes.length) { o.ruimtes.push(K.nieuweRuimte()); meld.push('Opname had geen ruimte: een lege ruimte toegevoegd.'); }
    return { opname: o, alleenLezen: false, origineel: null, meldingen: meld };
  };

  // Bevestigt een onwaarschijnlijke maar mogelijke maat (bijvoorbeeld een plafond van 1000 mm): pas dan kan de opname vrij. De bevestiging geldt voor precies deze waarde.
  K.bevestigOnwaarschijnlijk = (opname, ruimteId, pad, tijd) => wijzigRuimte(opname, ruimteId, r => {
    const x = K.waarschuwingen(r).find(w => w.code === 'onwaarschijnlijk' && w.pad === pad); if (!x) return { fout: 'Deze maat is niet onwaarschijnlijk (meer): niets te bevestigen.' };
    r.bevestigingen = isObj(r.bevestigingen) ? r.bevestigingen : {}; r.bevestigingen[pad] = { waarde: x.waarde, tijd: tijd || nu() };
  });
  K.uitsprongWaarden = (ruimte, u, lref) => uitsprongWaarden(ruimte || {}, u || {}, lref == null ? null : lref);
  K.wandHoeken = wandHoeken;
  K.hoekTekst = hoekTekst;
  K._intern = { slotsVan, staatVan, geldigeMeting, rondgang };
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof window !== 'undefined' ? window : globalThis);
