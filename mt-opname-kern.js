// mt-opname-kern.js — rekenkern en datamodel van de nieuwe opname-module (opname-JSON v0.3), zonder DOM en zonder netwerk.
// Een telefoon-opname van een bestaande ruimte: wand voor wand foto's plus gemeten maten, waaruit later in Vectorworks een maatvaste ruimte gescript wordt.
// Grootste pijn (Bart, 31-10): onvolledige opnames, net dat ene stopcontact of die deurmaat gemist en dan 3x terug. Gemeten maten zijn leidend; een
// schatting uit de foto is alleen een grijs voorstel (voorstel) en telt nooit als meting.
// Brok 1 (alleen de kern): vragenlijst uit ruimte + werkzone, tellers, sluitcontrole, rondje controle, vrijgeef-check, takenlijst en veilig lezen/migreren.
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
  K.TOLERANTIE = { tegenover: 5, diagonaal: 10, diagonalen: 6 };         // mm: tegenoverliggende wanden, diagonaal tegen verwacht, twee diagonalen onderling
  K.RONDJE_LATER_BLOKKEERT = true;                                       // een categorie van het rondje op "later" telt als bekeken, maar blokkeert het vrijgeven (Bart: later is niet compleet)
  const WAND_NAAM = { N: 'noord', O: 'oost', Z: 'zuid', W: 'west' };
  const WAND_VAN_NAAR = { N: ['NW', 'NO'], O: ['NO', 'ZO'], Z: ['ZO', 'ZW'], W: ['ZW', 'NW'] };
  const TEGENOVER = { N: 'Z', Z: 'N', O: 'W', W: 'O' };
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
    rad_b: 'Buitenmaat van het paneel, zonder kranen en leidingen.', rad_h: 'Bovenkant tot onderkant paneel.', rad_o: 'Onderkant paneel tot afgewerkte vloer.',
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
    radiator: { naam: 'Radiator', cat: 'radiator', maten: [['breedte', 'breedte', 'hoe breed is de radiator?', DEF.rad_b], ['hoogte', 'hoogte', 'hoe hoog is de radiator?', DEF.rad_h], ['onderkant', 'onderkant', 'hoe hoog zit de onderkant boven de vloer?', DEF.rad_o]] },
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
  // Waar de maat vandaan gemeten wordt (kort): hoek | vloerpeil | zijkanten | boven-onder | opening | object
  function refVan(s) {
    if (s.eenheid === 'keuze') return 'object';
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
    const slot = (pad, ent, sleutel, bucket, o) => { const s = Object.assign({ pad, ent, sleutel, bucket, groep: 'maat', wand: null, object: null, eenheid: 'mm', keuzes: null, definitie: '', uitleg: '', referentie: '', kritiek: false }, o); s.referentie = refVan(s); out.push(s); };
    // basis: vier wandlengtes
    for (const w of K.WANDEN) slot('wanden.' + w + '.maten.lengte', tijdelijk(r.wanden, w, { van: WAND_VAN_NAAR[w][0], naar: WAND_VAN_NAAR[w][1] }), 'lengte', 'basis', { wand: w, kort: 'Wandlengte ' + WAND_NAAM[w],
      vraag: 'Hoe lang is de ' + wandTekst(w) + ', van hoek tot hoek?', uitleg: 'Hoek tot hoek, afgewerkt tot afgewerkt, op 1000 mm boven de vloer.', kritiek: true });
    // basis: plafondhoogte op één punt (het eerste punt); verdere punten zijn extra
    const pp = lijst(r.plafondpunten).length ? lijst(r.plafondpunten) : [tijdelijk([], 'P1', { plaats: 'midden' })];
    pp.forEach((p, i) => {
      const waar = p.wand ? 'bij de ' + wandTekst(p.wand) : p.plaats ? 'bij ' + p.plaats : 'op punt ' + p.id;
      slot('plafondpunten.' + p.id + '.maten.hoogte', p, 'hoogte', i === 0 ? 'basis' : 'extra', { wand: p.wand || null, kort: 'Plafondhoogte ' + p.id, vraag: 'Hoe hoog is het plafond ' + waar + '?',
        uitleg: 'Afgewerkte vloer tot afgewerkt plafond.', kritiek: true });
    });
    // basis: één diagonaal; de tweede is optioneel
    DIAGONALEN.forEach(([id, van, naar], i) => {
      const d = tijdelijk(r.diagonalen, id, { van, naar });
      slot('diagonalen.' + id + '.maten.lengte', d, 'lengte', i === 0 ? 'basis' : 'optie', { groep: 'ruimte', kort: 'Diagonaal ' + id,
        vraag: 'Hoe lang is de diagonaal van de ' + HOEK_NAAM[d.van || van] + ' naar de ' + HOEK_NAAM[d.naar || naar] + '?', uitleg: 'Hoek tot hoek op 1000 mm boven de vloer, afgewerkt.', kritiek: true });
    });
    // openingen: breedte, hoogte, positie vanaf de linkerhoek (kijkend naar de wand) en bij een raam de borstwering; de positie tot de rechterhoek hoort bij de werkzone
    for (const o of lijst(r.openingen)) {
      if (!o || !o.id) continue;
      const w = o.wand, nm = openingNaam(o), df = K.DEFINITIES[o.definitie] || 'opening', zijde = WAND_VAN_NAAR[w] || [], wz = inZone(w);
      const van = o.positie_vanaf && o.positie_vanaf !== 'hoek' ? o.positie_vanaf : (HOEK_NAAM[zijde[0]] || 'de linkerhoek');
      const basis = (sleutel, kort, vraag, referentie, extra) => slot('openingen.' + o.id + '.maten.' + sleutel, o, sleutel, 'basis', Object.assign({ groep: 'kozijn', wand: w, object: o.id, kort: o.id + ' ' + kort, vraag, definitie: o.definitie || '', referentie, kritiek: true }, extra));
      basis('breedte', 'breedte', 'Hoe breed is de ' + df + ' van ' + nm + '?', 'De twee zijkanten van de opening.');
      basis('hoogte', 'hoogte', 'Hoe hoog is de ' + df + ' van ' + nm + '?', 'Onderkant en bovenkant van de opening.');
      basis('positie', 'positie', 'Hoe ver zit ' + nm + ' van de ' + van + ', tot de dagkant?', 'Vaste hoek (' + (HOEK_NAAM[zijde[0]] || 'linkerhoek') + ') tot de dagkant, niet tot de afwerklijst.');
      if (o.soort !== 'deur') basis('borstwering', 'borstwering', 'Hoe hoog zit de onderkant van ' + nm + ' boven de vloer?', 'Afgewerkte vloer (vloerpeil) tot onderzijde van de raamopening.');
      if (wz) slot('openingen.' + o.id + '.maten.positie_rechts', o, 'positie_rechts', 'werkzone', { groep: 'kozijn', wand: w, object: o.id, kort: o.id + ' tot rechterhoek', definitie: o.definitie || '',
        vraag: 'Hoe ver zit ' + nm + ' van de ' + (HOEK_NAAM[zijde[1]] || 'rechterhoek') + ', tot de dagkant?', uitleg: 'Vaste hoek (' + (HOEK_NAAM[zijde[1]] || 'rechterhoek') + ') tot de dagkant.', kritiek: true });
    }
    // objecten: in de werkzone volledig; erbuiten alleen als de opnemer "toch meten" koos of het object zelf toevoegde
    for (const ob of lijst(r.objecten)) {
      const t = K.OBJECTTYPES[ob && ob.type]; if (!t || !ob.id) continue;
      const bucket = ob.wand && inZone(ob.wand) ? 'werkzone' : (ob.gezien === 'toch-meten' || ob.eigen) ? 'extra' : null;
      const nm = ob.naam || (t.naam + ' ' + ob.id), hoek = HOEK_NAAM[ob.hoek] ? 'de ' + HOEK_NAAM[ob.hoek] : 'de dichtstbijzijnde hoek';
      const maten = t.maten.concat(t.zonderOpening && !ob.opening ? t.zonderOpening : []);
      for (const [sleutel, kort, vraag, definitie, keuzes] of maten) {
        slot('objecten.' + ob.id + '.maten.' + sleutel, ob, sleutel, bucket, { groep: t.cat, wand: ob.wand || null, object: ob.id, eenheid: keuzes ? 'keuze' : 'mm', keuzes: keuzes || null, kort: ob.id + ' ' + kort,
          vraag: nm + ': ' + vraag.replace('van de hoek', 'van ' + hoek), definitie: '', uitleg: definitie, kritiek: t.cat === 'elektra' || t.cat === 'plint' });
      }
    }
    // bijzonderheden mogen een maat krijgen; doet de opnemer dat, dan hoort die bij de extra punten
    for (const b of lijst(r.bijzonderheden)) {
      if (!b || !b.id || !isObj(b.maten) || !eigen(b.maten, 'maat')) continue;
      slot('bijzonderheden.' + b.id + '.maten.maat', b, 'maat', 'extra', { groep: 'afw', wand: b.wand || null, object: b.id, kort: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + ' maat',
        vraag: (K.BIJZONDERHEDEN[b.soort] || 'Bijzonderheid') + ': welke maat hoort hierbij?', uitleg: 'Zoals genoteerd bij de bijzonderheid.' });
    }
    return out;
  }
  function slotNaarVraag(s, conf) {
    const m = maatOp(s.ent, s.sleutel), st = staatVan(m, s.keuzes);
    return { pad: s.pad, bucket: s.bucket, groep: s.groep, wand: s.wand, object: s.object, kort: s.kort, vraag: s.vraag, definitie: s.definitie, referentie: s.referentie, uitleg: s.uitleg, eenheid: s.eenheid, keuzes: s.keuzes, kritiek: s.kritiek,
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

  // ── Sluitcontrole ──
  // Niets wordt gecorrigeerd: de uitkomst is een lijst controles met uitleg. Alleen echt gemeten maten tellen mee; foto-voorstellen nooit.
  const lengte = (r, kind, id) => K.waarde(maatOp(vind(r[kind], id), 'lengte'));
  const wandPad = w => 'wanden.' + w + '.maten.lengte', diagPad = d => 'diagonalen.' + d + '.maten.lengte';
  K.sluitcontrole = function (ruimte) {
    const r = ruimte || {}, checks = [], T = K.TOLERANTIE;
    const wl = w => lengte(r, 'wanden', w), naam = w => 'wandlengte ' + WAND_NAAM[w];
    // tegenoverliggende wanden: maximaal 5 mm verschil
    [['N', 'Z'], ['W', 'O']].forEach(([a, b]) => {
      const x = wl(a), y = wl(b), titel = hoofd(wandTekst(a)) + ' tegenover ' + wandTekst(b);
      if (x == null || y == null) { checks.push({ id: 'tegenover-' + a + b, titel, status: 'wacht', detail: 'Meet eerst ' + [x == null ? naam(a) : '', y == null ? naam(b) : ''].filter(Boolean).join(' en ') + '.', maten: [wandPad(a), wandPad(b)], verschil_mm: null, tolerantie_mm: T.tegenover }); return; }
      const d = Math.abs(x - y), slecht = d > T.tegenover;
      checks.push({ id: 'tegenover-' + a + b, titel, status: slecht ? 'conflict' : 'ok', maten: slecht ? [wandPad(a), wandPad(b)] : [], verschil_mm: d, tolerantie_mm: T.tegenover,
        detail: x + ' en ' + y + ' mm, verschil ' + d + ' mm' + (d > 15 ? '. Controleer de referentie en meet beide opnieuw. De app past niets aan.' : slecht ? '. Controleer de referentie.' : '.') });
    });
    // verwachte diagonaal uit het gemiddelde van de tegenoverliggende wanden (is er maar één van het paar gemeten, dan die)
    const gem = (a, b) => { const x = wl(a), y = wl(b); return x != null && y != null ? (x + y) / 2 : (x != null ? x : y); };
    const L = gem('N', 'Z'), B = gem('W', 'O'), verwacht = L != null && B != null ? Math.sqrt(L * L + B * B) : null;
    const dg = DIAGONALEN.map(([id, van, naar]) => ({ id, van, naar, m: lengte(r, 'diagonalen', id) }));
    for (const d of dg) {
      const titel = 'Diagonaal ' + d.id + ' (' + d.van + ' naar ' + d.naar + ')';
      if (d.m == null) { if (d.id === 'A') checks.push({ id: 'diagonaal-A', titel, status: 'wacht', maten: [diagPad('A')], verschil_mm: null, tolerantie_mm: T.diagonaal, verwacht_mm: verwacht == null ? null : Math.round(verwacht), detail: verwacht == null ? 'Meet eerst de wandlengtes.' : 'Verwacht ongeveer ' + Math.round(verwacht) + ' mm bij deze wanden.' }); continue; }
      if (verwacht == null) { checks.push({ id: 'diagonaal-' + d.id, titel, status: 'wacht', maten: [diagPad(d.id)], verschil_mm: null, tolerantie_mm: T.diagonaal, verwacht_mm: null, detail: d.m + ' mm gemeten. Nog niet te toetsen: meet eerst de wandlengtes.' }); continue; }
      const v = Math.round(d.m - verwacht), slecht = Math.abs(v) > T.diagonaal;
      checks.push({ id: 'diagonaal-' + d.id, titel, status: slecht ? 'conflict' : 'ok', maten: slecht ? [diagPad(d.id)] : [], verschil_mm: v, tolerantie_mm: T.diagonaal, verwacht_mm: Math.round(verwacht),
        detail: d.m + ' mm gemeten, verwacht ' + Math.round(verwacht) + ' mm (' + (v > 0 ? '+' : '') + v + ' mm).' + (slecht ? ' Controleer de referentie en meet opnieuw. De app past niets aan.' : '') });
    }
    // de twee diagonalen onderling: maximaal 6 mm verschil, anders is de kamer niet haaks
    if (dg[0].m != null && dg[1].m != null) {
      const d = Math.abs(dg[0].m - dg[1].m), slecht = d > T.diagonalen;
      checks.push({ id: 'diagonalen-onderling', titel: 'Diagonalen onderling', status: slecht ? 'conflict' : 'ok', maten: slecht ? [diagPad('A'), diagPad('B')] : [], verschil_mm: d, tolerantie_mm: T.diagonalen,
        detail: slecht ? 'Verschil ' + d + ' mm: de kamer is niet haaks. Houd daar rekening mee bij kasten.' : 'Verschil ' + d + ' mm: de kamer is haaks.' });
    }
    const conflicten = checks.filter(c => c.status === 'conflict').map(c => ({ id: c.id, titel: c.titel, uitleg: c.detail, maten: c.maten.slice() }));
    return { checks, conflicten, verwacht_diagonaal_mm: verwacht == null ? null : Math.round(verwacht) };
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
      if (m.staat === 'gemeten' && s.pad.startsWith('openingen.') && (s.sleutel === 'breedte' || s.sleutel === 'hoogte') && !K.DEFINITIES[s.ent.definitie]) w.push({ code: 'definitie-ontbreekt', pad: s.pad, tekst: s.kort + ': kies de definitie (muursparing, dagmaat of kozijn buiten), anders is de maat dubbelzinnig.' });
      const v = K.waarde(m);
      if (v != null && s.sleutel === 'lengte' && s.pad.startsWith('wanden.') && (v < 300 || v > 15000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, tekst: s.kort + ': ' + v + ' mm ligt buiten 300 tot 15000 mm. Tikfout?' });
      if (v != null && s.pad.startsWith('plafondpunten.') && (v < 2000 || v > 5000)) w.push({ code: 'onwaarschijnlijk', pad: s.pad, tekst: s.kort + ': ' + v + ' mm ligt buiten 2000 tot 5000 mm. Tikfout?' });
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
  // "Vrijgeven voor maatwerk" kan pas als: werkzone gekozen, basis + werkzone + extra compleet (later telt niet, nvt wel), geen conflicten en het rondje gedaan.
  // Opslaan kan altijd (zie K.samenvatting). Geeft per reden een code en een tekst die de UI kan tonen.
  K.vrijgeefCheckRuimte = function (ruimte) {
    const r = ruimte || {}, redenen = [], t = K.tellers(r), nm = r.naam || r.id || 'Ruimte', rd = K.rondje(r), sc = K.sluitcontrole(r);
    if (!lijst(r.werkzone).filter(w => K.WANDEN.includes(w)).length) redenen.push({ code: 'werkzone', tekst: nm + ': kies waar het meubel komt (werkzone).' });
    [['basis', 'Basis'], ['werkzone', 'Werkzone'], ['extra', 'Extra']].forEach(([b, n]) => {
      const c = t[b]; if (!c.n) return;
      if (c.open) redenen.push({ code: 'open', bucket: b, aantal: c.open, tekst: nm + ' - ' + n + ': ' + c.open + (c.open === 1 ? ' punt moet' : ' punten moeten') + ' nog gemeten.' });
      if (c.later) redenen.push({ code: 'later', bucket: b, aantal: c.later, tekst: nm + ' - ' + n + ': ' + c.later + ' op later meten (telt niet als compleet).' });
    });
    for (const c of sc.conflicten) redenen.push({ code: 'conflict', id: c.id, tekst: nm + ': conflict in de maten, ' + c.titel + '. ' + c.uitleg });
    if (rd.wanden.length && rd.mis) redenen.push({ code: 'rondje', aantal: rd.mis, tekst: nm + ': rondje controle, ' + rd.mis + (rd.mis === 1 ? ' categorie' : ' categorieën') + ' nog niet bekeken.' });
    if (K.RONDJE_LATER_BLOKKEERT && rd.later) redenen.push({ code: 'rondje-later', aantal: rd.later, tekst: nm + ': rondje controle, ' + rd.later + (rd.later === 1 ? ' categorie staat' : ' categorieën staan') + ' op later meten.' });
    return { kan: redenen.length === 0, redenen, waarschuwingen: K.waarschuwingen(r) };
  };
  K.vrijgeefCheck = function (opname) {
    const rs = lijst(opname && opname.ruimtes), redenen = [], waarschuwingen = [];
    if (!rs.length) redenen.push({ code: 'geen-ruimte', tekst: 'Er is nog geen ruimte in deze opname.' });
    for (const r of rs) { const c = K.vrijgeefCheckRuimte(r); for (const x of c.redenen) redenen.push(Object.assign({ ruimte: r.id }, x)); for (const x of c.waarschuwingen) waarschuwingen.push(Object.assign({ ruimte: r.id }, x)); }
    for (const f of lijst(opname && opname.fotos)) if (f && !f.ruimte) waarschuwingen.push({ code: 'foto-zonder-ruimte', tekst: 'Foto ' + (f.bestand || f.id) + ' heeft geen ruimte.' });
    return { kan: redenen.length === 0, redenen, waarschuwingen };
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
    if (!voorstel || !getal(voorstel.waarde) || voorstel.waarde <= 0) return { opname: null, fout: 'Een voorstel heeft een waarde in mm.' };
    const o = kloon(opname), r = zoekRuimte(o, ruimteId); if (!r) return { opname: null, fout: 'Onbekende ruimte.' };
    zorgEntiteiten(r);
    const s = slotsVan(r).find(x => x.pad === pad); if (!s) return { opname: null, fout: 'Onbekend punt: ' + pad };
    s.ent.maten = isObj(s.ent.maten) ? s.ent.maten : {};
    const m = isObj(s.ent.maten[s.sleutel]) ? s.ent.maten[s.sleutel] : K.nieuweMaat();
    m.voorstel = { waarde: voorstel.waarde, bron: 'foto-voorstel', tijd: voorstel.tijd || tijd || nu() };
    if (getal(voorstel.pm)) m.voorstel.pm = voorstel.pm;                  // geschatte marge in mm
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
