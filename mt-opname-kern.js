// mt-opname-kern.js — rekenkern en datamodel van de nieuwe opname-module (opname-JSON v0.3), zonder DOM en zonder netwerk.
// Een telefoon-opname van een bestaande ruimte: wand voor wand foto's plus gemeten maten, waaruit later in Vectorworks een maatvaste ruimte gescript wordt.
// Grootste pijn (Bart, 31-10): onvolledige opnames, net dat ene stopcontact of die deurmaat gemist en dan 3x terug. Gemeten maten zijn leidend; een
// schatting uit de foto is alleen een grijs voorstel (voorstel) en telt nooit als meting.
// Brok 1 (alleen de kern): vragenlijst uit ruimte + werkzone, de geordende route (punt voor punt), tellers, vorm en sluitcontrole (geen rechthoek veronderstellen), rondje controle, vrijgeef-check met scope en uitzonderingen,
// vrijgave gekoppeld aan een inhoudshash, takenlijst en veilig lezen/migreren. Review 1-11: Bart (volgorde fotoronde dan rondloop) en ChatGPT (GESPREK 035, punten A tot en met I).
// Spelregels: er wordt niets automatisch gecorrigeerd en niets geforceerd haaks; een wijziging wist nooit stil een eerdere maat (historie, append-only);
// onbekende velden blijven bij het lezen behouden. Alle functies geven nieuwe objecten terug en passen hun invoer niet aan.
// Het prototype (src-v3.html in OPNAME-APP) is de bron van de vragen en de sluitcontrole; de uitkomsten voor kamer Joe zijn in de tests vastgelegd.
(function (root) {
  'use strict';
  const K = root.MTOpnameKern = root.MTOpnameKern || {};

  // ── Vaste lijsten ──
  K.VERSIE = '0.3';
  K.WANDEN = ['N', 'O', 'Z', 'W'];                                       // rond de klok: N loopt van NW naar NO, O van NO naar ZO, Z van ZO naar ZW, W van ZW naar NW
  K.STATEN = ['gemeten', 'nvt', 'later', 'open'];
  K.BRONNEN = ['disto', 'hand', 'foto-voorstel'];                        // een meting (staat gemeten) is disto of hand; foto-voorstel hoort alleen in het grijze voorstel
  K.MEUBELTYPES = ['kast', 'keuken', 'badmeubel'];
  K.DEFINITIES = { muursparing: 'muursparing', dagmaat: 'dagmaat', 'kozijn-buiten': 'kozijn buiten' };
  K.BIJZONDERHEDEN = { stootplint: 'Hogere stootplint', balk: 'Ingestucte balk of verlaging', koof: 'Koof', nis: 'Nis', 'uit-het-lood': 'Uit het lood', 'leiding-in-zicht': 'Leiding in zicht', kabelgoot: 'Kabelgoot', anders: 'Anders' };
  // Toleranties. diagonaal: de gemeten controlediagonaal tegen de diagonaal die uit 4 zijden + 1 diagonaal volgt (mm). tegenover en hoek_graden: pas boven deze waarden is de ruimte
  // 'afwijkend van vorm' (informatie, geen fout). Er wordt geen rechthoek verondersteld.
  K.TOLERANTIE = { diagonaal: 10, tegenover: 5, hoek_graden: 0.3 };
  K.RONDJE_LATER_BLOKKEERT = true;                                       // een categorie van het rondje op "later" is een open taak en blokkeert het vrijgeven (Bart, 1-11)
  K.WANDBEVESTIGING = ['bekeken', 'afgedekt', 'niet-beoordeeld'];          // buiten de werkzone: "gehele wand bekeken, geen relevante obstakels" of bewust afgedekt / niet beoordeeld
  K.ROUTE_VOLGORDES = ['fotos-dan-rondloop', 'rondloop', 'per-soort'];
  // Vragensets per meubeltype. Alleen 'kast' is een echte, gevalideerde set (ChatGPT-review 035, punt I). Voor keuken en badmeubel is er een hook (extraSlots) maar nog geen set:
  // zo'n ruimte kan niet vrijgegeven worden en de app claimt geen keuken- of badmeubelvragen.
  K.MEUBELSETS = { kast: { gereed: true }, keuken: { gereed: false, extraSlots: null }, badmeubel: { gereed: false, extraSlots: null } };
  const WAND_NAAM = { N: 'noord', O: 'oost', Z: 'zuid', W: 'west' };
  const WAND_VAN_NAAR = { N: ['NW', 'NO'], O: ['NO', 'ZO'], Z: ['ZO', 'ZW'], W: ['ZW', 'NW'] };
  const WAND_VOLGENDE = { N: 'O', O: 'Z', Z: 'W', W: 'N' };                // met de klok mee
  const HOEK_NAAM = { NW: 'noordwesthoek', NO: 'noordoosthoek', ZO: 'zuidoosthoek', ZW: 'zuidwesthoek' };
  const DIAGONALEN = [['A', 'NW', 'ZO'], ['B', 'NO', 'ZW']];
  const wandTekst = w => WAND_NAAM[w] ? WAND_NAAM[w] + 'wand' : String(w);
  const hoofd = t => t.charAt(0).toUpperCase() + t.slice(1);
  K.wandNaam = w => WAND_NAAM[w] ? hoofd(WAND_NAAM[w]) : String(w);

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

  // ── Constructors ──
  // Een maat (punt): waarde in mm, staat, bron, tijdstip en eventueel een grijs foto-voorstel. Alleen de aanwezige velden worden gezet.
  K.nieuweMaat = function (over) { return Object.assign({ staat: 'open', waarde: null, bron: null, tijd: null }, over || {}); };
  const legeMaten = () => ({});
  K.nieuweRuimte = function (o) {
    o = o || {};
    const r = { id: o.id || 'R1', naam: o.naam || 'Ruimte', meubeltype: o.meubeltype || 'kast', werkzone: lijst(o.werkzone).filter(w => K.WANDEN.includes(w)),
      wanden: [], plafondpunten: [], diagonalen: [], openingen: lijst(o.openingen), objecten: lijst(o.objecten), bijzonderheden: lijst(o.bijzonderheden), rondje: isObj(o.rondje) ? o.rondje : {} };
    if (o.toegangsdeur) r.toegangsdeur = o.toegangsdeur;                  // id van de opening waar je de ruimte binnenkomt: daar begint de fotoronde
    return zorgEntiteiten(r);
  };
  K.nieuweOpname = function (o) {
    o = o || {};
    return { schema: 'mt-opname', versie: K.VERSIE, opname_id: o.opname_id || o.id || null, project: Object.assign({ code: null }, o.project || {}), status: o.status || 'concept',
      aangemaakt: o.aangemaakt || nu(), bijgewerkt: o.bijgewerkt || null, ruimtes: lijst(o.ruimtes).length ? o.ruimtes : [K.nieuweRuimte()], fotos: lijst(o.fotos) };
  };
  // Zorgt dat de vaste onderdelen bestaan (vier wanden, twee diagonalen, plafondpunt P1). Voegt alleen toe, verwijdert nooit iets.
  function zorgEntiteiten(r) {
    r.wanden = lijst(r.wanden); r.plafondpunten = lijst(r.plafondpunten); r.diagonalen = lijst(r.diagonalen);
    for (const w of K.WANDEN) if (!vind(r.wanden, w)) r.wanden.push({ id: w, van: WAND_VAN_NAAR[w][0], naar: WAND_VAN_NAAR[w][1], maten: legeMaten() });
    for (const [id, van, naar] of DIAGONALEN) if (!vind(r.diagonalen, id)) r.diagonalen.push({ id, van, naar, maten: legeMaten() });
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
    if (s.pad.startsWith('openingen.')) return s.sleutel === 'breedte' ? 'zijkanten' : s.sleutel === 'hoogte' ? 'boven-onder' : s.sleutel === 'borstwering' ? 'vloerpeil' : (s.ent.positie_vanaf && s.ent.positie_vanaf !== 'hoek' ? 'opening' : 'hoek');
    if (s.sleutel === 'kraan' || s.sleutel === 'onderkant') return 'vloerpeil';
    if (s.sleutel === 'hoogte') return s.ent.type === 'radiator' ? 'object' : 'vloerpeil';
    return s.sleutel === 'afstand' ? 'hoek' : 'object';
  }
  function openingNaam(o) { return (o.soort === 'deur' ? 'deur ' : 'raam ') + (o.naam || o.id); }
  function slotsVan(ruimte) {
    const r = ruimte || {}, zone = lijst(r.werkzone).filter(w => K.WANDEN.includes(w)), inZone = w => zone.includes(w), out = [];
    const tijdelijk = (arr, id, rest) => vind(arr, id) || Object.assign({ id, maten: {} }, rest);          // ontbreekt een vast onderdeel, dan telt het als open zonder iets te schrijven
    const slot = (pad, ent, sleutel, bucket, o) => { const s = Object.assign({ pad, ent, sleutel, bucket, soort: 'maat', groep: 'maat', wand: null, object: null, eenheid: 'mm', keuzes: null, nvtKeuzes: null, definitie: '', uitleg: '', referentie: '', kritiek: false }, o); s.referentie = refVan(s); out.push(s); };
    // basis: vier wandlengtes; buiten de werkzone daarbij één bevestiging per wand ("gehele wand bekeken, geen relevante obstakels", of afgedekt / niet beoordeeld)
    for (const w of K.WANDEN) {
      const we = tijdelijk(r.wanden, w, { van: WAND_VAN_NAAR[w][0], naar: WAND_VAN_NAAR[w][1] });
      slot('wanden.' + w + '.maten.lengte', we, 'lengte', 'basis', { soort: 'wandlengte', wand: w, kort: 'Wandlengte ' + WAND_NAAM[w],
        vraag: 'Hoe lang is de ' + wandTekst(w) + ', van hoek tot hoek?', uitleg: 'Hoek tot hoek, afgewerkt tot afgewerkt, op 1000 mm boven de vloer.' + (inZone(w) ? ' Bij een werkzone-wand is dit de middelste van drie hoogtes.' : ''), kritiek: true });
      if (inZone(w)) {
        // werkzone-wand: de wandlengte ook net boven de plint en net onder het plafond (samen met de lengte op 1000 mm drie hoogtes) en het plafond op drie punten langs de wand
        for (const [sl, k, waar] of [['lengte_onder', 'onder', 'net boven de plint'], ['lengte_boven', 'boven', 'net onder het plafond']]) slot('wanden.' + w + '.maten.' + sl, we, sl, 'werkzone', { soort: 'wandlengte', wand: w, kort: 'Wandlengte ' + WAND_NAAM[w] + ' ' + k,
          vraag: 'Hoe lang is de ' + wandTekst(w) + ' ' + waar + ', van hoek tot hoek?', uitleg: 'Dezelfde meting als de wandlengte op 1000 mm, nu ' + waar + '. Een kast raakt de wand over de hele hoogte.', kritiek: true });
        for (const pl of ['links', 'midden', 'rechts']) slot('wanden.' + w + '.maten.plafond_' + pl, we, 'plafond_' + pl, 'werkzone', { soort: 'wandplafond', wand: w, kort: 'Plafondhoogte ' + WAND_NAAM[w] + ' ' + pl,
          vraag: 'Hoe hoog is het plafond ' + pl + ' op de ' + wandTekst(w) + ' (kijkend naar de wand)?', uitleg: 'Afgewerkte vloer tot afgewerkt plafond, ' + (pl === 'midden' ? 'in het midden van de wand.' : 'een stukje uit de ' + (pl === 'links' ? 'linker' : 'rechter') + 'hoek.'), kritiek: true });
      }
      if (!inZone(w)) slot('wanden.' + w + '.maten.bevestiging', we, 'bevestiging', 'basis', { soort: 'wandbevestiging', wand: w, eenheid: 'keuze', keuzes: ['bekeken'], nvtKeuzes: ['afgedekt', 'niet-beoordeeld'], kort: 'Wand ' + WAND_NAAM[w] + ' bekeken',
        vraag: 'Is de ' + wandTekst(w) + ' helemaal bekeken, zonder relevante obstakels?', uitleg: 'Kies "bekeken" als de hele wand in beeld was en er niets zit dat het meubel raakt. Is de wand afgedekt of niet beoordeeld, kies dat dan: het komt zo in het rapport.' });
    }
    // basis: plafondhoogte op één punt (het eerste punt); verdere punten zijn extra
    const pp = lijst(r.plafondpunten).length ? lijst(r.plafondpunten) : [tijdelijk([], 'P1', { plaats: 'midden' })];
    pp.forEach((p, i) => {
      const waar = p.wand ? 'bij de ' + wandTekst(p.wand) : p.plaats ? 'bij ' + p.plaats : 'op punt ' + p.id;
      slot('plafondpunten.' + p.id + '.maten.hoogte', p, 'hoogte', i === 0 ? 'basis' : 'extra', { soort: 'plafond', wand: p.wand || null, kort: 'Plafondhoogte ' + p.id, vraag: 'Hoe hoog is het plafond ' + waar + '?',
        uitleg: 'Afgewerkte vloer tot afgewerkt plafond.', kritiek: true });
    });
    // basis: één diagonaal; de tweede is optioneel (maar telt, als hij is ingevuld, mee in de controle en het vrijgeven)
    DIAGONALEN.forEach(([id, van, naar], i) => {
      const d = tijdelijk(r.diagonalen, id, { van, naar });
      slot('diagonalen.' + id + '.maten.lengte', d, 'lengte', i === 0 ? 'basis' : 'optie', { soort: 'diagonaal', groep: 'ruimte', kort: 'Diagonaal ' + id,
        vraag: 'Hoe lang is de diagonaal van de ' + HOEK_NAAM[d.van || van] + ' naar de ' + HOEK_NAAM[d.naar || naar] + '?', uitleg: 'Hoek tot hoek op 1000 mm boven de vloer, afgewerkt.', kritiek: true });
    });
    // openingen: breedte en positie vanaf de linkerhoek (kijkend naar de wand) zijn basis. Hoogte en borstwering zijn verplicht in de werkzone, daarbuiten optioneel (grijs voorstel);
    // de positie tot de rechterhoek hoort bij de werkzone.
    for (const o of lijst(r.openingen)) {
      if (!o || !o.id) continue;
      const w = o.wand, nm = openingNaam(o), df = K.DEFINITIES[o.definitie] || 'opening', zijde = WAND_VAN_NAAR[w] || [], wz = inZone(w), detail = wz ? 'werkzone' : 'optie';
      const van = o.positie_vanaf && o.positie_vanaf !== 'hoek' ? o.positie_vanaf : (HOEK_NAAM[zijde[0]] || 'de linkerhoek');
      const op = (bucket, sleutel, kort, vraag, uitleg, extra) => slot('openingen.' + o.id + '.maten.' + sleutel, o, sleutel, bucket, Object.assign({ soort: 'opening', groep: 'kozijn', wand: w, object: o.id, kort: o.id + ' ' + kort, vraag, definitie: o.definitie || '', uitleg, kritiek: bucket !== 'optie' }, extra));
      op('basis', 'breedte', 'breedte', 'Hoe breed is de ' + df + ' van ' + nm + '?', 'De twee zijkanten van de opening.');
      op(detail, 'hoogte', 'hoogte', 'Hoe hoog is de ' + df + ' van ' + nm + '?', 'Onderkant en bovenkant van de opening.');
      op('basis', 'positie', 'positie', 'Hoe ver zit ' + nm + ' van de ' + van + ', tot de dagkant?', 'Vaste hoek (' + (HOEK_NAAM[zijde[0]] || 'linkerhoek') + ') tot de dagkant, niet tot de afwerklijst.');
      if (o.soort !== 'deur') op(detail, 'borstwering', 'borstwering', 'Hoe hoog zit de onderkant van ' + nm + ' boven de vloer?', 'Afgewerkte vloer (vloerpeil) tot onderzijde van de raamopening.');
      if (wz) op('werkzone', 'positie_rechts', 'tot rechterhoek', 'Hoe ver zit ' + nm + ' van de ' + (HOEK_NAAM[zijde[1]] || 'rechterhoek') + ', tot de dagkant?', 'Vaste hoek (' + (HOEK_NAAM[zijde[1]] || 'rechterhoek') + ') tot de dagkant.');
    }
    // objecten: in de werkzone volledig; erbuiten alleen als de opnemer "toch meten" koos of het object zelf toevoegde
    for (const ob of lijst(r.objecten)) {
      const t = K.OBJECTTYPES[ob && ob.type]; if (!t || !ob.id) continue;
      const bucket = ob.wand && inZone(ob.wand) ? 'werkzone' : (ob.gezien === 'toch-meten' || ob.eigen) ? 'extra' : null;
      const nm = ob.naam || (t.naam + ' ' + ob.id), hoek = HOEK_NAAM[ob.hoek] ? 'de ' + HOEK_NAAM[ob.hoek] : 'de dichtstbijzijnde hoek';
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
      staat: st, conflict: st === 'gemeten' && !!conf[s.pad], maat: m || null, voorstel: m && m.voorstel ? m.voorstel : null };
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
  K.vorm = function (ruimte) {
    const r = ruimte || {}, T = K.TOLERANTIE, z = {}, ontbreekt = [];
    for (const w of K.WANDEN) { z[w] = lengte(r, 'wanden', w); if (z[w] == null) ontbreekt.push('wandlengte ' + WAND_NAAM[w]); }
    const dA = lengte(r, 'diagonalen', 'A'), dB = lengte(r, 'diagonalen', 'B');
    // tegenoverliggende wanden die meer dan 5 mm verschillen bewijzen al dat de kamer niet rechthoekig is
    const verschil = [['N', 'Z'], ['W', 'O']].filter(([a, b]) => z[a] != null && z[b] != null && Math.abs(z[a] - z[b]) > T.tegenover).map(([a, b]) => ({ wanden: [a, b], verschil_mm: Math.abs(z[a] - z[b]) }));
    const basis = { status: 'onvoldoende-bepaald', afwijkend: verschil.length ? true : null, schematisch: true, reden: '', hoeken: null, hoekpunten_mm: null, controle: null, tegenover: verschil, diagonaal_gebruikt: null };
    if (ontbreekt.length) { basis.reden = 'Meet eerst ' + ontbreekt.join(', ') + '.'; return basis; }
    if (dA == null && dB == null) { basis.reden = 'De vorm is nog niet bepaald: meet minstens één diagonaal. Tot dan is de tekening schematisch.'; return basis; }
    const metA = dA != null, ids = metA ? ['NW', 'NO', 'ZO', 'ZW'] : ['NO', 'ZO', 'ZW', 'NW'], zijden = metA ? [z.N, z.O, z.Z, z.W] : [z.O, z.Z, z.W, z.N];
    const d1 = metA ? dA : dB, d2 = metA ? dB : dA, p = vierhoek(zijden, d1, T.diagonaal);
    const betrokken = K.WANDEN.map(wandPad).concat(dA != null ? [diagPad('A')] : [], dB != null ? [diagPad('B')] : []);
    basis.diagonaal_gebruikt = metA ? 'A' : 'B'; basis.betrokken = betrokken;
    if (!p) { basis.status = 'inconsistent'; basis.reden = 'Met deze vier wandlengtes en diagonaal ' + basis.diagonaal_gebruikt + ' (' + d1 + ' mm) kan de ruimte niet bestaan. Controleer de diagonaal en de wandlengtes.'; return basis; }
    // naar vaste assen: noordwesthoek in de oorsprong, noordoosthoek op de x-as, zuid is positief y
    const i0 = ids.indexOf('NW'), i1 = ids.indexOf('NO'), o = p[i0], rx = p[i1][0] - o[0], ry = p[i1][1] - o[1], l = Math.hypot(rx, ry), c = rx / l, sn = -ry / l;
    const punten = {}, hoeken = {};
    ids.forEach((id, i) => { const dx = p[i][0] - o[0], dy = p[i][1] - o[1]; punten[id] = [Math.round(dx * c - dy * sn) + 0, Math.round(dx * sn + dy * c) + 0]; hoeken[id] = afr(hoekIn(p, i)); });
    const afwijking = Math.max.apply(null, Object.keys(hoeken).map(k => Math.abs(hoeken[k] - 90)));
    basis.hoeken = hoeken; basis.hoekpunten_mm = punten; basis.afwijkend = verschil.length > 0 || afwijking > T.hoek_graden; basis.max_hoekafwijking_graden = afr(afwijking);
    if (d2 == null) { basis.status = 'onverifieerd'; basis.reden = 'Vorm berekend uit vier zijden en diagonaal ' + basis.diagonaal_gebruikt + '. Meet de andere diagonaal als controle (optioneel). Tot dan is de tekening schematisch.'; return basis; }
    const berekend = Math.round(afstand(p[1], p[3])), v = Math.round(d2 - berekend);
    basis.controle = { diagonaal: metA ? 'B' : 'A', gemeten_mm: d2, berekend_mm: berekend, verschil_mm: v, tolerantie_mm: T.diagonaal };
    if (Math.abs(v) > T.diagonaal) { basis.status = 'inconsistent'; basis.reden = 'Diagonaal ' + basis.controle.diagonaal + ' is ' + d2 + ' mm gemeten, maar uit de vier wanden en diagonaal ' + basis.diagonaal_gebruikt + ' volgt ' + berekend + ' mm (' + (v > 0 ? '+' : '') + v + ' mm). De metingen sluiten niet op elkaar: controleer de referentie en meet opnieuw. De app past niets aan.'; return basis; }
    basis.status = 'consistent'; basis.schematisch = false;
    basis.reden = 'De metingen sluiten op elkaar: diagonaal ' + basis.controle.diagonaal + ' ' + d2 + ' mm gemeten, ' + berekend + ' mm berekend (' + (v > 0 ? '+' : '') + v + ' mm).' + (basis.afwijkend ? ' De ruimte is niet rechthoekig (hoeken: ' + ids.map(k => k + ' ' + hoeken[k] + ' graden').join(', ') + '). Dat is informatie, geen fout; houd er rekening mee bij het meubel.' : '');
    return basis;
  };
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

  // ── Rondje controle ──
  // Alleen voor de werkzone-wanden. Per wand en categorie: aanwezig / afwezig / later; geen keuze = "nog niet bekeken".
  const rondjeSleutel = (w, c) => w + '|' + c;
  const rondjeWaarde = v => { const x = isObj(v) ? v.waarde : v; return K.RONDJE_KEUZES.includes(x) ? x : null; };
  K.rondje = function (ruimte) {
    const r = ruimte || {}, wanden = K.WANDEN.filter(w => lijst(r.werkzone).includes(w)), regels = [];
    for (const w of wanden) for (const [cat, naam] of K.RONDJE_CATEGORIEEN) {
      const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, cat)] : null);
      regels.push({ sleutel: rondjeSleutel(w, cat), wand: w, categorie: cat, naam, waarde, status: waarde || 'nog-niet-bekeken', nadruk: cat === 'water' && r.meubeltype && r.meubeltype !== 'kast' });
    }
    const bekeken = regels.filter(x => x.waarde).length;
    return { wanden, regels, tot: regels.length, bekeken, mis: regels.length - bekeken, later: regels.filter(x => x.waarde === 'later').length };
  };
  // Legt een keuze van het rondje vast; null haalt de keuze weg. Geeft een nieuwe ruimte terug.
  K.zetRondje = function (ruimte, wand, categorie, waarde, tijd) {
    if (!K.WANDEN.includes(wand) || !K.RONDJE_CATEGORIEEN.some(c => c[0] === categorie)) return { ruimte: null, fout: 'Onbekende wand of categorie.' };
    if (waarde !== null && !K.RONDJE_KEUZES.includes(waarde)) return { ruimte: null, fout: 'Onbekende keuze voor het rondje.' };
    const r = kloon(ruimte); r.rondje = isObj(r.rondje) ? r.rondje : {};
    const k = rondjeSleutel(wand, categorie), oud = r.rondje[k];
    if (waarde === null) { if (oud !== undefined) { r.rondje_historie = lijst(r.rondje_historie).concat([{ sleutel: k, oud, tijd: tijd || nu() }]); delete r.rondje[k]; } }
    else r.rondje[k] = { waarde, tijd: tijd || nu() };
    return { ruimte: r, fout: null };
  };

  // ── Waarschuwingen (niet blokkerend) ──
  K.waarschuwingen = function (ruimte) {
    const r = ruimte || {}, w = [], slots = slotsVan(r);
    for (const s of slots) {
      const m = maatOp(s.ent, s.sleutel);
      if (!isObj(m)) continue;
      if (m.staat === 'gemeten' && staatVan(m, s.keuzes) !== 'gemeten') w.push({ code: 'meting-ongeldig', pad: s.pad, tekst: s.kort + ': staat op gemeten, maar er is geen geldige waarde of de bron is geen DISTO of hand. Telt als nog meten.' });
      if (m.staat === 'gemeten' && s.pad.startsWith('openingen.') && (s.sleutel === 'breedte' || s.sleutel === 'hoogte') && !K.DEFINITIES[s.ent.definitie] && !lijst(r.werkzone).includes(s.ent.wand)) w.push({ code: 'definitie-ontbreekt', pad: s.pad, tekst: s.kort + ': kies de definitie (muursparing, dagmaat of kozijn buiten), anders is de maat dubbelzinnig.' });
      const v = K.waarde(m);
      if (v != null && s.sleutel.indexOf('lengte') === 0 && s.pad.startsWith('wanden.') && (v < 300 || v > 15000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, tekst: s.kort + ': ' + v + ' mm ligt buiten 300 tot 15000 mm. Tikfout?' });
      if (v != null && (s.pad.startsWith('plafondpunten.') || s.sleutel.indexOf('plafond_') === 0) && (v < 2000 || v > 5000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, tekst: s.kort + ': ' + v + ' mm ligt buiten 2000 tot 5000 mm. Tikfout?' });
    }
    // rondje zegt "afwezig" terwijl er in die wand en categorie wel iets is vastgelegd
    for (const x of K.rondje(r).regels) if (x.waarde === 'afwezig') {
      const iets = (cat => cat === 'kozijn' ? lijst(r.openingen).filter(o => o && o.wand === x.wand).length + lijst(r.objecten).filter(o => o && o.wand === x.wand && K.OBJECTTYPES[o.type] && K.OBJECTTYPES[o.type].cat === 'kozijn').length
        : cat === 'afw' ? lijst(r.bijzonderheden).filter(b => b && b.wand === x.wand).length + lijst(r.objecten).filter(o => o && o.wand === x.wand && o.type === 'overig').length
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
      if (v.soort === 'wandbevestiging') u.push({ ruimte: nm, soort: 'wand-niet-beoordeeld', wand: v.wand, pad: v.pad, tekst: 'Wand ' + WAND_NAAM[v.wand] + ': ' + (m.keuze === 'afgedekt' ? 'afgedekt' : 'niet beoordeeld'), notitie: m.notitie || '' });
      else u.push({ ruimte: nm, soort: 'nvt', wand: v.wand, pad: v.pad, tekst: v.kort + ': niet van toepassing, bewust niet maatvast', notitie: m.notitie || '' });
    }
    for (const b of lijst(r.bijzonderheden)) {
      if (!b || !b.id) continue;
      const m = isObj(b.maten) ? b.maten.maat : null;
      if (!geldigeMeting(m)) u.push({ ruimte: nm, soort: 'bijzonderheid', wand: b.wand || null, pad: 'bijzonderheden.' + b.id, tekst: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + (b.wand ? ', ' + WAND_NAAM[b.wand] : '') + ': genoemd, niet bemeten', notitie: b.notitie || '' });
    }
    for (const x of K.rondje(r).regels) if (x.waarde === 'afwezig') u.push({ ruimte: nm, soort: 'rondje-niet-aanwezig', wand: x.wand, pad: 'rondje.' + x.sleutel, tekst: 'Rondje ' + WAND_NAAM[x.wand] + ': ' + x.naam.toLowerCase() + ' niet aanwezig of n.v.t.', notitie: '' });
    const vorm = K.vorm(r);
    if (vorm.status !== 'consistent') u.push({ ruimte: nm, soort: 'vorm', wand: null, pad: null, tekst: vorm.status === 'onverifieerd' ? 'Vorm van de ruimte niet gecontroleerd met de tweede diagonaal' : 'Vorm van de ruimte niet bepaald, schematisch', notitie: '' });
    return u;
  }
  K.vrijgeefCheckRuimte = function (ruimte) {
    const r = ruimte || {}, redenen = [], t = K.tellers(r), nm = r.naam || r.id || 'Ruimte', rd = K.rondje(r), sc = K.sluitcontrole(r), set = K.MEUBELSETS[r.meubeltype];
    if (!set || !set.gereed) redenen.push({ code: 'meubelset', tekst: nm + ': voor ' + (r.meubeltype || 'dit meubeltype') + ' bestaat nog geen eigen vragenset (alleen kast is gevalideerd), dus vrijgeven kan nog niet.' });
    for (const o of lijst(r.openingen)) if (o && o.id && lijst(r.werkzone).includes(o.wand) && !K.DEFINITIES[o.definitie]) redenen.push({ code: 'definitie', pad: 'openingen.' + o.id, tekst: nm + ': kies de definitie van ' + openingNaam(o) + ' (muursparing, dagmaat of kozijn buiten). In de werkzone is een maat zonder definitie dubbelzinnig.' });
    if (!lijst(r.werkzone).filter(w => K.WANDEN.includes(w)).length) redenen.push({ code: 'werkzone', tekst: nm + ': kies waar het meubel komt (werkzone).' });
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
    const scope = { ruimte: r.id, naam: nm, meubeltype: r.meubeltype || null, meubelset_gereed: !!(set && set.gereed), werkzone: lijst(r.werkzone).filter(w => K.WANDEN.includes(w)), wanden_alleen_basis: K.WANDEN.filter(w => !lijst(r.werkzone).includes(w)),
      vorm: { status: sc.vorm.status, afwijkend: sc.vorm.afwijkend, schematisch: sc.vorm.schematisch }, telling: { basis: tel(t.basis), werkzone: tel(t.werkzone), extra: tel(t.extra) } };
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
      for (const w of K.WANDEN) if (!K.fotosVan(opname, r.id, w).length) waarschuwingen.push({ ruimte: r.id, code: 'foto-ontbreekt', wand: w, tekst: (r.naam || r.id) + ': nog geen foto van de ' + wandTekst(w) + '.' });
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
  // Tijdstippen, historie, grijze voorstellen, foto's, status en de vrijgave zelf tellen niet mee. Elke inhoudelijke wijziging maakt de vrijgave dus ongeldig, ook als een app vergeet de status terug te zetten.
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
  K.inhoudsHash = opname => hash53(canon(opname));
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
    if (foto.wand != null && !K.WANDEN.includes(foto.wand)) return { opname: null, fout: 'Onbekende wand.' };
    const o = kloon(opname); o.fotos = lijst(o.fotos);
    if (o.fotos.some(f => f && f.bestand === foto.bestand && f.ruimte === foto.ruimte)) return { opname: null, fout: 'Dit bestand staat al bij deze ruimte.' };
    let n = o.fotos.length + 1; while (vind(o.fotos, 'F' + n)) n++;
    o.fotos.push(Object.assign({}, foto, { id: foto.id || 'F' + n, wand: foto.wand == null ? null : foto.wand, tijd: foto.tijd || nu() }));
    return { opname: o, fout: null };
  };
  K.fotosVan = (opname, ruimteId, wand) => lijst(opname && opname.fotos).filter(f => f && f.ruimte === ruimteId && (wand == null || f.wand === wand));

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
  const nextWand = w => WAND_VOLGENDE[w];
  const klok = start => { const l = [start]; while (l.length < 4) l.push(nextWand(l[l.length - 1])); return l; };
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
    const zone = K.WANDEN.filter(w => lijst(r.werkzone).includes(w)), inZone = w => zone.includes(w), conf = conflictPaden(r), slots = slotsVan(r).filter(s => s.bucket);
    const deur = vind(r.openingen, r.toegangsdeur) || lijst(r.openingen).find(o => o && o.soort === 'deur'), toegang = deur && K.WANDEN.includes(deur.wand) ? deur.wand : 'N';
    const fotoWanden = klok(toegang), startMaten = fotoWanden.find(inZone) || toegang, matenWanden = klok(volgorde === 'rondloop' ? toegang : startMaten);
    const wandNr = (lijstW, w) => lijstW.indexOf(w) + 1;
    const stappen = [], geplaatst = {};
    const maatStap = (s, fase) => {
      geplaatst[s.pad] = true;
      const m = maatOp(s.ent, s.sleutel), st = staatVan(m, s.keuzes), nr = s.wand ? wandNr(matenWanden, s.wand) : null;
      stappen.push({ id: 'maat:' + s.pad, type: s.soort === 'wandbevestiging' ? 'wandbevestiging' : 'maat', fase, wand: s.wand, wand_nr: nr, wanden_totaal: s.wand ? 4 : null, groep: s.bucket, soort: s.soort, label: s.kort, vraag: s.vraag, definitie: s.definitie, referentie: s.referentie,
        uitleg: s.uitleg, pad: s.pad, eenheid: s.eenheid, keuzes: s.keuzes, nvt_keuzes: s.nvtKeuzes, staat: st, afgehandeld: st !== 'open', optioneel: s.bucket === 'optie', conflict: st === 'gemeten' && !!conf[s.pad], object: s.object });
    };
    const fotoStap = (w, fase, lijstW) => stappen.push({ id: 'foto:' + w, type: 'foto', fase, wand: w, wand_nr: wandNr(lijstW, w), wanden_totaal: 4, groep: 'foto', soort: 'foto', label: 'Foto ' + wandTekst(w), vraag: 'Maak een foto van de ' + wandTekst(w) + '.',
      definitie: '', referentie: 'wand', uitleg: ZONDER_FOTO_UITLEG, pad: null, eenheid: 'foto', keuzes: null, nvt_keuzes: null, staat: fotos.some(f => f.wand === w) ? 'gemeten' : 'open', afgehandeld: fotos.some(f => f.wand === w), optioneel: false, conflict: false, object: null });
    const bijzStap = (w, fase) => {
      const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, 'afw')] : null), st = rondjeStaat(waarde);
      stappen.push({ id: 'bijz:' + w, type: 'bijzonderheden', fase, wand: w, wand_nr: wandNr(matenWanden, w), wanden_totaal: 4, groep: 'werkzone', soort: 'bijzonderheden', label: 'Bijzonderheden ' + WAND_NAAM[w],
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
      return { lengte: soort('wandlengte'), plafond: soort('wandplafond'), openingen: geordend('opening', r.openingen, 'positie'), objecten: geordend('object', r.objecten, null), plint: geordend('plint', r.objecten, null), bijz: soort('bijzonderheid'), bevestiging: soort('wandbevestiging') };
    };
    const blokken = {}; matenWanden.forEach(w => { blokken[w] = wandSlots(w); });
    const ruimteSlots = slots.filter(x => x.soort === 'plafond' || x.soort === 'diagonaal');
    const rondjeStappen = () => {
      for (const w of matenWanden.filter(inZone)) for (const [cat, naam] of K.RONDJE_CATEGORIEEN) {
        if (cat === 'afw') continue;                                       // staat al bij "bijzonderheden op deze wand?"
        const waarde = rondjeWaarde(isObj(r.rondje) ? r.rondje[rondjeSleutel(w, cat)] : null), st = rondjeStaat(waarde);
        stappen.push({ id: 'rondje:' + rondjeSleutel(w, cat), type: 'rondje', fase: 'rondje', wand: w, wand_nr: wandNr(matenWanden, w), wanden_totaal: 4, groep: 'rondje', soort: 'rondje', categorie: cat, label: naam + ' ' + WAND_NAAM[w],
          vraag: 'Rondje ' + wandTekst(w) + ': ' + naam.toLowerCase() + '. Is alles wat er is vastgelegd?', definitie: '', referentie: 'wand', uitleg: 'Kies aanwezig en vastgelegd, niet aanwezig of n.v.t., of later meten. Niet gekozen blijft "nog niet bekeken", nooit "afwezig".',
          pad: 'rondje.' + rondjeSleutel(w, cat), eenheid: 'rondje', keuzes: K.RONDJE_KEUZES, nvt_keuzes: null, staat: st, afgehandeld: st !== 'open', optioneel: false, conflict: false, object: null });
      }
    };
    if (volgorde === 'per-soort') {
      fotoWanden.forEach(w => fotoStap(w, 'fotoronde', fotoWanden));
      const fase = 'soort';
      for (const k of ['lengte', 'plafond', 'bevestiging', 'openingen', 'objecten', 'plint']) matenWanden.forEach(w => blokken[w][k].forEach(x => maatStap(x, fase)));
      matenWanden.filter(inZone).forEach(w => { bijzStap(w, fase); blokken[w].bijz.forEach(x => maatStap(x, fase)); });
    } else {
      if (volgorde === 'fotos-dan-rondloop') fotoWanden.forEach(w => fotoStap(w, 'fotoronde', fotoWanden));
      matenWanden.forEach(w => {
        const b = blokken[w];
        if (volgorde === 'rondloop') fotoStap(w, 'wand', matenWanden);
        b.lengte.forEach(x => maatStap(x, 'wand')); b.plafond.forEach(x => maatStap(x, 'wand')); b.openingen.forEach(x => maatStap(x, 'wand')); b.objecten.forEach(x => maatStap(x, 'wand')); b.plint.forEach(x => maatStap(x, 'wand'));
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
    const wzIn = x.werkzone, okW = w => K.WANDEN.includes(w); let goed = [], rest = null;
    if (Array.isArray(wzIn)) { goed = wzIn.filter(okW); const f = wzIn.filter(w => !okW(w)); if (f.length) rest = f; }
    else if (typeof wzIn === 'string' && okW(wzIn)) goed = [wzIn];
    else if (wzIn != null) rest = wzIn;
    x.werkzone = goed;
    if (rest !== null) { x._onbekend = Object.assign({}, x._onbekend, { werkzone: rest }); meld.push(x.naam + ': onbekende werkzone-waarden bewaard in _onbekend.'); }
    x.openingen = lijst(x.openingen); x.objecten = lijst(x.objecten); x.bijzonderheden = lijst(x.bijzonderheden);
    if (!isObj(x.rondje)) x.rondje = {};
    for (const k of Object.keys(x.rondje)) if (!isObj(x.rondje[k]) && K.RONDJE_KEUZES.includes(x.rondje[k])) x.rondje[k] = { waarde: x.rondje[k], tijd: null };
    zorgEntiteiten(x);
    const maten = (ent, waar) => { if (!isObj(ent)) return; if (!isObj(ent.maten)) ent.maten = {}; for (const k of Object.keys(ent.maten)) ent.maten[k] = normMaat(ent.maten[k], meld, x.naam + ' ' + waar + '.' + k); };
    for (const l of [x.wanden, x.plafondpunten, x.diagonalen, x.openingen, x.objecten, x.bijzonderheden]) for (const e of l) maten(e, e && e.id);
    return x;
  }
  K.lees = function (invoer) {
    const meld = [];
    if (!isObj(invoer)) return { opname: null, alleenLezen: true, origineel: invoer === undefined ? null : kloon(invoer), meldingen: ['Geen opname-object: niets omgezet, origineel bewaard.'] };
    const o = kloon(invoer), v = o.versie != null ? o.versie : o.schema_versie;
    if (geldigeVersie(v) && nieuwerDan(v, K.VERSIE)) return { opname: o, alleenLezen: true, origineel: null, meldingen: ['Opname-versie ' + v + ' is nieuwer dan deze app (' + K.VERSIE + '): alleen lezen, niets wordt omgezet of teruggeschreven.'] };
    if ((geldigeVersie(v) && nieuwerDan(K.VERSIE, v)) || (v != null && !geldigeVersie(v)) || (v == null && !Array.isArray(o.ruimtes))) {
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

  K._intern = { slotsVan, staatVan, geldigeMeting };
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof window !== 'undefined' ? window : globalThis);
