/* ============================================================================
 * mt-planverplaats.js: een planblok verplaatsen of uit Ongepland inplannen (restyling brok 8, slepen in de capaciteit)
 * ----------------------------------------------------------------------------
 * Alleen rekenwerk, geen DOM, geen opslag: de aanroeper (v2.html) geeft de huidige planblokken (mt_planblokken, inclusief tombstones) en
 * de regels mee en krijgt de nieuwe lijst terug; opslaan doet hij zelf met de bestaande read-merge-write (agPlanSave, de samenvoeger
 * _SP.mergers.mt_planblokken: per id wint de nieuwste stempel). Zo blijft elk blok een eigen record: twee mensen die tegelijk verschillende
 * blokken verplaatsen verliezen niets; dezelfde blok tegelijk = de nieuwste wint (en wie verliest hoort dat).
 *
 * Regels (dezelfde als agPlanDrop / agPlanNieuwFormulier in v2.html):
 *  - alleen met het recht om te plannen (de aanroeper bepaalt `mag`: rol "lezen" en werkplaats, de tv en een niet geladen rol mogen niet);
 *  - een open voorstel wordt door kantoor beslist en wordt niet versleept; niet naar een
 *    weekend. Verlof, een verplichte vrije dag en een dag waarop iemand volgens de werktijden niet werkt: eerst een vraag (V.waarschuwing), pas na bevestiging (spec.bevestigd) opgeslagen;
 *  - een blok verplaatsen verandert persoon, datum en start (de duur blijft); uit Ongepland ontstaat een nieuw planblok (taak_id, duur = het
 *    budget van de taak). Een taak met een datum maar zonder planblok wordt niet versleept (zijn uren zijn over meer dagen verdeeld).
 *  - op een dagdeel (ochtend/middag) komt het blok op de eerste tijd waarop het volledig in dat dagdeel past; past het nergens, direct na het laatste blok van die dag (nooit terug naar het begin met overlap); op een uur precies op die tijd.
 *  - een blok uit Ongepland krijgt een vast id uit project en taak (twee apparaten maken dan één blok).
 *  - Ongedaan maken zet persoon/datum/start terug (verplaatsen) of voegt een tombstone toe (nieuw blok), mits het blok sindsdien niet door
 *    iemand anders is gewijzigd (dezelfde stempel).
 * ========================================================================== */
(function (root) {
  'use strict';
  const V = {};
  const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const dow = s => { const [y, m, d] = s.split('-').map(Number), n = Math.round(Date.UTC(y, m - 1, d) / 864e5); return ((n + 4) % 7 + 7) % 7; };   // 0 = zondag
  const tijdMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const gelijkAan = (a, b, team) => { const x = String(a == null ? '' : a).trim().toLowerCase(), y = String(b == null ? '' : b).trim().toLowerCase(); if (!x || !y) return false; if (x === y) return true; const P = root.MTPlanning; return !!(P && P.zelfdePersoon && P.zelfdePersoon(a, b, team)); };
  const actief = b => !!b && typeof b === 'object' && !b._vervallen;
  V.blokVanId = (lijst, id) => (Array.isArray(lijst) ? lijst : []).find(b => actief(b) && String(b.id) === String(id)) || null;

  // De eerste begintijd (minuten) voor een blok van `duur` minuten die volledig binnen het dagdeel [basis, grens] past en geen blok met een tijd raakt dat die persoon die
  // dag al heeft. Past het nergens, dan komt het direct na het laatste blok van die dag (de overboeking is dan zichtbaar als dubbel/over), nooit terug naar het begin
  // van het dagdeel met overlap. Zonder blokken die dag: op het begin van het dagdeel.
  V.eerstePlek = function (blokken, slug, datum, basis, grens, duur, negeerId, team) {
    const bezet = (Array.isArray(blokken) ? blokken : []).filter(b => actief(b) && b.status !== 'voorstel' && String(b.id) !== String(negeerId) && b.datum === datum && gelijkAan(b.persoon, slug, team) && tijdMin(b.start) !== null)
      .map(b => [tijdMin(b.start), tijdMin(b.start) + Math.max(0, Math.round(Number(b.duurMin) || 0))]).sort((x, y) => x[0] - y[0]);
    const raakt = s => bezet.some(([a, e]) => a < s + duur && s < e);
    const kandidaten = [basis].concat(bezet.map(x => x[1]).filter(e => e > basis)).sort((x, y) => x - y);
    for (const s of kandidaten) if (s + duur <= grens && !raakt(s)) return s;
    const laatste = bezet.reduce((m, x) => Math.max(m, x[1]), 0);
    return Math.min(21 * 60, Math.max(basis, laatste));
  };
  // → '' (mag) of de reden in gewone taal
  V.controle = function (spec, ctx) {
    if (!ctx || !ctx.mag) return 'Dit mag je niet met jouw rol: verplaatsen is voor kantoor (de werkplaats dient een voorstel in).';
    if (!spec || typeof spec !== 'object') return 'Onbekende actie.';
    const team = ctx.team || [], lid = team.find(m => m && String(m.slug).toLowerCase() === String(spec.persoon || '').toLowerCase());
    // taakrand (een rand van een taakbalk): geen persoon; taakbalk (een taak naar een andere persoon of schuiven): de dag is optioneel en een weekend wordt genegeerd (zaterdag en zondag bestaan niet in het model)
    if (spec.soort !== 'taakrand' && !lid && !(spec.soort === 'taakbalk' && !spec.persoon)) return 'Onbekende persoon.';   // een taakbalk zonder persoon (rij Niet toegewezen) kan alleen schuiven
    if (spec.soort === 'verplaats' || spec.soort === 'nieuw') {
      if (!isYmd(spec.datum)) return 'Ongeldige dag.';
      const w = dow(spec.datum); if (w === 0 || w === 6) return 'Dit is een weekend: plannen op die dag kan niet.';
    }
    // Verlof, een verplichte vrije dag en een dag waarop iemand volgens zijn werktijden niet werkt zijn geen harde weigering meer: V.waarschuwing vraagt dan om bevestiging.
    if (spec.start != null && tijdMin(spec.start) === null) return 'Ongeldige begintijd.';
    if (spec.soort === 'verplaats') {
      const b = V.blokVanId(ctx.blokken, spec.blokId);
      if (!b) return 'Dit planblok bestaat niet meer.';
      if (b.status === 'voorstel') return 'Een open voorstel wordt door kantoor beslist en kan niet versleept worden.';
    } else if (spec.soort === 'nieuw') {
      const t = spec.taak;
      if (!t || !t.code || !t.id) return 'Onbekende taak.';
      if ((ctx.blokken || []).some(b => actief(b) && b.taak_id != null && String(b.taak_id) === String(t.id) && String(b.project_code || '').toLowerCase() === String(t.code).toLowerCase())) return 'Deze taak heeft al een planblok: versleep dat blok.';
      if (t.voorstel) return 'Een voorstel van de werkplaats neem je eerst over (Mijn werk) voordat je het inplant.';
    } else if (spec.soort === 'taakbalk' || spec.soort === 'taakrand') {
      const t = spec.taak;
      if (!t || !t.code || !t.id) return 'Onbekende taak.';
      if (t.voorstel) return 'Een voorstel van de werkplaats neem je eerst over (Mijn werk) voordat je het verplaatst.';
      if (spec.soort === 'taakrand') {
        if (spec.kant !== 'start' && spec.kant !== 'eind') return 'Onbekende rand.';
        if (!isYmd(spec.datum) && !(Number.isInteger(spec.delta) && spec.delta !== 0)) return 'Ongeldige dag.';
      } else if (spec.datum != null && spec.datum !== '' && !isYmd(spec.datum)) return 'Ongeldige dag.';
    } else return 'Onbekende actie.';
    return '';
  };

  // → { ok, reden } | { ok:true, noop:true } | { ok:true, blokken, wijziging }
  const DAGLANG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'], MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const dagMnd = s => Number(s.slice(8)) + ' ' + MND[Number(s.slice(5, 7)) - 1];
  // → '' (geen bezwaar) of de vraag die de gebruiker moet bevestigen ("Toch inplannen?"): verlof, een verplichte vrije dag of een dag waarop deze persoon volgens
  // mt_werktijden niet werkt. Zonder werktijden-record van die persoon: geen vraag voor een gewone weekdag (zoals voorheen). Harde weigeringen (rol, weekend, open voorstel,
  // onbekende persoon) staan in V.controle en komen eerst.
  V.waarschuwing = function (spec, ctx) {
    if (!spec || !ctx || V.controle(spec, ctx)) return '';
    const team = ctx.team || [], lid = team.find(m => m && String(m.slug).toLowerCase() === String(spec.persoon || '').toLowerCase()); if (!lid) return '';
    const w = dow(spec.datum);
    if ((ctx.verlof || []).some(x => x && gelijkAan(x.persoon, lid.slug, team) && spec.datum >= x.van && spec.datum <= x.tm)) return lid.naam + ' heeft verlof op ' + dagMnd(spec.datum) + '. Toch inplannen?';
    const vd = (ctx.vrijedagen || []).find(x => x && x.datum === spec.datum);
    if (vd && vd.type === 'verplicht') return dagMnd(spec.datum) + ' is een verplichte vrije dag. Toch inplannen?';
    const P = root.MTPlanning, rec = P && P.werktijdenMap && ctx.werktijden ? P.werktijdenMap(ctx.werktijden)[String(lid.slug).toLowerCase()] : null;
    if (rec && P.werktijdDagMin(rec, (w + 6) % 7) <= 0) return lid.naam + ' werkt volgens de werktijden niet op ' + DAGLANG[w] + ' ' + dagMnd(spec.datum) + '. Toch inplannen?';
    return '';
  };
  // Het gevraagde dagdeel: ochtend 08:00-12:00, middag 13:00-17:00 (zie V.eerstePlek voor wat er gebeurt als het blok er niet in past)
  const dagdeelStart = (lijst, spec, duur, negeerId, team) => spec.dagdeel === 1 ? V.eerstePlek(lijst, spec.persoon, spec.datum, 13 * 60, 17 * 60, duur, negeerId, team) : V.eerstePlek(lijst, spec.persoon, spec.datum, 8 * 60, 12 * 60, duur, negeerId, team);
  // Een planblok uit Ongepland heeft een vast id uit project en taak: twee apparaten die dezelfde taak tegelijk inplannen maken dus hetzelfde record, en de samenvoeger
  // (per id, nieuwste stempel wint) maakt er één blok van in plaats van twee.
  V.blokIdVoorTaak = (code, taakId) => 'tb:' + String(code == null ? '' : code).trim().toLowerCase() + ':' + String(taakId == null ? '' : taakId);
  V.pas = function (spec, ctx) {
    const reden = V.controle(spec, ctx); if (reden) return { ok: false, reden };
    if (spec.soort !== 'verplaats' && spec.soort !== 'nieuw') return { ok: false, reden: 'Een taak slepen gaat via de takenlijst (V.plaatsTaak), niet via een planblok.' };   // de taak-soorten (taakbalk, taakrand) maken nooit een planblok
    if (!spec.bevestigd) { const vraag = V.waarschuwing(spec, ctx); if (vraag) return { ok: false, vraag }; }   // de aanroeper vraagt het de gebruiker en roept opnieuw aan met bevestigd: true
    const lijst = Array.isArray(ctx.blokken) ? ctx.blokken : [], team = ctx.team || [], stempel = ctx.stempel || ((x, vorig) => { x._gewijzigd = Date.now(); return x; });
    const ts = new Date(ctx.nu || Date.now()).toISOString(), wie = ctx.wie || '';
    if (spec.soort === 'verplaats') {
      const b = V.blokVanId(lijst, spec.blokId), duur = Math.max(0, Math.round(Number(b.duurMin) || 0));
      const start = spec.start != null ? hhmm(tijdMin(spec.start)) : hhmm(dagdeelStart(lijst, spec, duur || 60, b.id, team));
      if (gelijkAan(b.persoon, spec.persoon, team) && b.datum === spec.datum && (spec.start != null ? tijdMin(b.start) === tijdMin(start) : (tijdMin(b.start) !== null && (tijdMin(b.start) < 12 * 60) === (spec.dagdeel !== 1)))) return { ok: true, noop: true };
      const voor = { persoon: b.persoon, datum: b.datum, start: b.start };
      const nieuw = stempel(Object.assign({}, b, { persoon: spec.persoon, datum: spec.datum, start, ts, door: wie }), b);
      return { ok: true, blokken: lijst.map(x => x === b ? nieuw : x), wijziging: { soort: 'verplaats', id: b.id, voor, na: { persoon: spec.persoon, datum: spec.datum, start }, stempel: nieuw._gewijzigd, naam: b.taak || b.project_code || 'Planblok' } };
    }
    const t = spec.taak, duur = Math.max(15, Math.round(Number(t.min) || 0)) || 60;
    const start = spec.start != null ? hhmm(tijdMin(spec.start)) : hhmm(dagdeelStart(lijst, spec, duur, null, team));
    const id = V.blokIdVoorTaak(t.code, t.id), vorig = lijst.find(x => x && String(x.id) === id) || null;   // een eerdere tombstone met dit id (ongedaan gemaakt) krijgt een nieuwere stempel
    const nieuw = stempel({ id, persoon: spec.persoon, project_code: t.code, taak: t.naam || '', taak_id: t.id, datum: spec.datum, start, duurMin: duur, notitie: '', ts, door: wie }, vorig);
    return { ok: true, blokken: lijst.filter(x => x !== vorig).concat([nieuw]), wijziging: { soort: 'nieuw', id, stempel: nieuw._gewijzigd, naam: t.naam || t.code, na: { persoon: spec.persoon, datum: spec.datum, start } } };
  };

  // Ongedaan maken: alleen als het blok sindsdien niet door iemand anders is gewijzigd (zelfde stempel).
  V.ongedaan = function (w, ctx) {
    if (!ctx || !ctx.mag) return { ok: false, reden: 'Dit mag je niet met jouw rol.' };
    if (!w || !w.id) return { ok: false, reden: 'Er is niets om ongedaan te maken.' };
    const lijst = Array.isArray(ctx.blokken) ? ctx.blokken : [], b = V.blokVanId(lijst, w.id);
    if (!b) return { ok: false, reden: 'Dit planblok bestaat niet meer; niets teruggezet.' };
    if (b._gewijzigd !== w.stempel) return { ok: false, reden: 'Dit blok is intussen door iemand anders gewijzigd; niet teruggezet.' };
    const stempel = ctx.stempel || ((x) => { x._gewijzigd = Date.now(); return x; }), ts = new Date(ctx.nu || Date.now()).toISOString(), wie = ctx.wie || '';
    const nieuw = w.soort === 'verplaats'
      ? stempel(Object.assign({}, b, { persoon: w.voor.persoon, datum: w.voor.datum, start: w.voor.start, ts, door: wie }), b)
      : stempel(Object.assign({}, b, { _vervallen: { tijd: ts, door: wie } }), b);
    return { ok: true, blokken: lijst.map(x => x === b ? nieuw : x) };
  };

  // ═══ Een taak slepen: de taakbalk (T4 en T5, keuzeplan 16-10) ═══════════════════════════════════════════════════════════
  // Slepen uit Ongepland, een taakbalk verplaatsen en een rand van een taakbalk uittrekken maakt geen planblok: de taak zelf wordt aangepast (toegewezen, start, eind), via de schrijfkern van de takenlijst
  // (MTPlanning.takenSchrijf: vers lezen, de lokale kopie erbij, stempelen, schrijven met de ETag; een 412 wordt samengevoegd en opnieuw geprobeerd, maximaal drie keer; lezen en schrijven krijgen een time-out van
  // 20 seconden). Oude tb:-planblokken blijven werken en worden niet aangeraakt (het omzetten is T6). Zaterdag en zondag bestaan niet in het model (de werktijden kennen alleen ma-vr). Spec:
  //   { soort: 'nieuw',    taak: {code, id, naam, min}, persoon, datum }                          uit Ongepland: toegewezen = persoon, start = de eerstvolgende werkbare dag vanaf datum, eind volgt
  //   { soort: 'taakbalk', taak, van, persoon, vanDatum?, datum? | delta? }                       een taakbalk: naar een andere persoon (alleen de persoon verandert) en/of horizontaal schuiven: beide randen
  //                                                                                                met hetzelfde aantal bedrijfswerkdagen (van de dag van de balk naar de dag waarop je loslaat, of delta bedrijfswerkdagen)
  //   { soort: 'taakrand', taak, kant: 'start'|'eind', datum | delta }                             een rand uittrekken: start of eind verandert; los op een weekend of verplichte vrije dag: start springt naar de
  //                                                                                                eerstvolgende werkdag, eind naar de vorige; een rand komt nooit voorbij de andere; een mijlpaal kan alleen schuiven
  // Met P.MEERDERE_PERSONEN: uit Ongepland wordt de persoon de eerste en blijven de anderen staan; bij een taakbalk wisselt alleen de persoon van die balk (van) in de lijst.
  // De duur is het aantal bedrijfswerkdagen (ma-vr min verplichte vrije dagen), niet per persoon: de balk houdt zijn zichtbare lengte en verlof van de nieuwe persoon vangt taakVerdeling op.
  const MAX_DAGEN = 1100;   // drie jaar: langer wordt niet stil afgekapt maar geweigerd
  const TE_LANG = 'Deze taak zou langer dan drie jaar duren; er is niets gewijzigd.';
  const pad2 = n => String(n).padStart(2, '0');
  const plusDag = (ymd, k) => { const [y, m, d] = ymd.split('-').map(Number), x = new Date(Date.UTC(y, m - 1, d + k)); return x.getUTCFullYear() + '-' + pad2(x.getUTCMonth() + 1) + '-' + pad2(x.getUTCDate()); };
  const wdIdx = ymd => (dow(ymd) + 6) % 7;   // 0 = maandag ... 6 = zondag
  const verplichtSet = ctx => new Set((ctx.vrijedagen || []).filter(v => v && v.type === 'verplicht').map(v => v.datum));
  const bedrijfsdag = (d, vs) => wdIdx(d) < 5 && !vs.has(d);
  const naarBedrijfsdag = (d, vooruit, vs) => { for (let i = 0; i < 60; i++, d = plusDag(d, vooruit ? 1 : -1)) if (bedrijfsdag(d, vs)) return d; return null; };
  const plusBedrijf = (d, n, vs) => { const stap = n < 0 ? -1 : 1; let k = Math.abs(n), i = 0; while (k > 0) { d = plusDag(d, stap); if (++i > MAX_DAGEN * 2) return null; if (bedrijfsdag(d, vs)) k--; } return d; };
  const bedrijfTussen = (a, b, vs) => { if (a === b) return 0; const stap = a < b ? 1 : -1; let n = 0, d = a, i = 0; while (d !== b) { d = plusDag(d, stap); if (++i > MAX_DAGEN * 2) return null; if (bedrijfsdag(d, vs)) n++; } return stap * n; };
  const telBedrijf = (a, b, vs) => { let n = 0; for (let d = a, i = 0; d <= b; d = plusDag(d, 1), i++) { if (i > MAX_DAGEN) return null; if (bedrijfsdag(d, vs)) n++; } return n; };
  // De datums van een taak die op persoon slug op dag datum wordt gezet (uit Ongepland). -> { ok, start, eind, verschoven } | { ok:false, reden }
  //  - start: datum zelf als die werkbaar is (werktijden, verlof, verplichte vrije dag), anders de eerstvolgende werkbare dag (verschoven: true)
  //  - eind: heeft de taak al een start en een eind, dan houdt hij zijn aantal bedrijfswerkdagen en schuift mee; anders zoveel werkbare dagen van deze persoon als nodig zijn voor de raming bij zijn
  //    dagcapaciteit (naar boven afgerond, minimaal één dag); een mijlpaal of een taak zonder raming krijgt één dag
  V.taakDatums = function (t, slug, datum, ctx) {
    const P = root.MTPlanning, o = { werktijden: ctx.werktijden, verlof: ctx.verlof, vrijedagen: ctx.vrijedagen, team: ctx.team }, werkbaar = d => P.werkbaarVoor(slug, d, o), vs = verplichtSet(ctx);
    let start = datum, verschoven = false;
    for (let i = 0; i < 120 && !werkbaar(start); i++) { start = plusDag(start, 1); verschoven = true; }
    if (!werkbaar(start)) return { ok: false, reden: 'Er is geen werkbare dag gevonden voor deze persoon.' };
    let eind = start;
    if (isYmd(t.start) && isYmd(t.eind) && t.eind >= t.start) {
      const n = telBedrijf(t.start, t.eind, vs); if (n === null) return { ok: false, reden: TE_LANG };
      eind = plusBedrijf(start, Math.max(1, n) - 1, vs); if (!eind) return { ok: false, reden: TE_LANG };
    } else {
      const rest = P.taakRamingMin(t);
      if (rest > 0) { let som = 0, klaar = false; for (let d = start, i = 0; i <= MAX_DAGEN; d = plusDag(d, 1), i++) if (werkbaar(d)) { eind = d; som += P.dagCapMin(slug, wdIdx(d), { werkuren: ctx.werkuren, werktijden: ctx.werktijden }); if (som >= rest) { klaar = true; break; } } if (!klaar) return { ok: false, reden: TE_LANG }; }
    }
    return { ok: true, start, eind, verschoven };
  };
  // De datums van een taak die een eigen start en eind heeft (voor schuiven en uittrekken): beide als bedrijfswerkdag (start vooruit, eind terug), eind nooit voor start.
  const eigenDatums = (t, vs) => {
    const s0 = isYmd(t.start) ? t.start : (isYmd(t.eind) ? t.eind : ''), e0 = isYmd(t.eind) ? t.eind : s0; if (!s0) return null;
    const s = naarBedrijfsdag(s0, true, vs), e0b = naarBedrijfsdag(e0, false, vs); if (!s || !e0b) return null;
    return { start: s, eind: e0b < s ? s : e0b };
  };
  // Schuiven: beide randen met hetzelfde aantal bedrijfswerkdagen (delta, of van de dag van de balk naar de dag waarop je loslaat). -> { ok, start, eind } | { ok:false, reden }
  V.taakVerschuif = function (t, vanDatum, datum, delta, ctx) {
    const vs = verplichtSet(ctx), d0 = eigenDatums(t, vs); if (!d0) return { ok: false, reden: 'Deze taak heeft geen datums om te verschuiven.' };
    let d = delta;
    if (!Number.isInteger(d)) { const van = naarBedrijfsdag(vanDatum, true, vs), doel = naarBedrijfsdag(datum, true, vs); if (!van || !doel) return { ok: false, reden: 'Ongeldige dag.' }; d = bedrijfTussen(van, doel, vs); if (d === null) return { ok: false, reden: TE_LANG }; }
    if (d === 0) return { ok: true, start: d0.start, eind: d0.eind };
    const start = plusBedrijf(d0.start, d, vs), eind = plusBedrijf(d0.eind, d, vs); if (!start || !eind) return { ok: false, reden: TE_LANG };
    return { ok: true, start, eind };
  };
  // Een rand uittrekken (kant 'start' of 'eind'), naar een dag of delta bedrijfswerkdagen. -> { ok, start, eind } | { ok:false, reden }
  V.taakRand = function (t, kant, datum, delta, ctx) {
    if (t.soort === 'mijlpaal') return { ok: false, reden: 'Een mijlpaal kun je alleen verschuiven.' };
    const vs = verplichtSet(ctx), d0 = eigenDatums(t, vs); if (!d0) return { ok: false, reden: 'Deze taak heeft geen datums om uit te trekken.' };
    let doel;
    if (Number.isInteger(delta) && delta !== 0) doel = plusBedrijf(kant === 'start' ? d0.start : d0.eind, delta, vs); else doel = naarBedrijfsdag(datum, kant === 'start', vs);   // start springt naar de eerstvolgende werkdag, eind naar de vorige
    if (!doel) return { ok: false, reden: TE_LANG };
    let start = d0.start, eind = d0.eind;
    if (kant === 'start') { start = doel > eind ? eind : doel; } else { eind = doel < start ? start : doel; }   // een rand komt nooit voorbij de andere
    if (telBedrijf(start, eind, vs) === null) return { ok: false, reden: TE_LANG };
    return { ok: true, start, eind };
  };
  // Het plan voor een sleepactie op een taak (zuiver rekenwerk). ctx = { taken (de actieve taken van dat project), team, verlof, vrijedagen, werktijden, werkuren, mag }
  // -> { ok:false, reden } | { ok:true, noop:true } | { ok:true, taak:{id, code, naam}, lijst (de personen na afloop), start?, eind?, melding, voor }
  V.taakPlan = function (spec, ctx) {
    const reden = V.controle(spec, Object.assign({}, ctx, { blokken: [] })); if (reden) return { ok: false, reden };
    const P = root.MTPlanning, team = ctx.team || [];
    const lid = spec.soort === 'taakrand' ? null : team.find(m => m && String(m.slug).toLowerCase() === String(spec.persoon).toLowerCase()), slug = lid ? String(lid.slug).toLowerCase() : '';
    const t = (ctx.taken || []).find(x => x && !x._vervallen && String(x.id) === String(spec.taak.id)); if (!t) return { ok: false, reden: 'Deze taak bestaat niet meer.' };
    if ((t.status || 'todo') === 'klaar') return { ok: false, reden: 'Een klare taak plan je niet meer in.' };
    if (t.voorstel) return { ok: false, reden: 'Een voorstel van de werkplaats neem je eerst over (Mijn werk) voordat je het inplant.' };
    const nu = P.taakMensen(t), van = String(spec.van == null ? '' : spec.van).toLowerCase();
    let lijst = nu;
    if (spec.soort === 'taakbalk' && slug) lijst = P.MEERDERE_PERSONEN ? (nu.includes(van) ? nu.map(p => p === van ? slug : p) : [slug].concat(nu)) : [slug];
    else if (spec.soort === 'nieuw') lijst = P.MEERDERE_PERSONEN ? [slug].concat(nu.filter(p => p !== slug)) : [slug];
    lijst = lijst.filter((p, i) => p && lijst.indexOf(p) === i);
    const zelfde = JSON.stringify(lijst) === JSON.stringify(spec.soort === 'taakrand' || P.MEERDERE_PERSONEN ? nu : nu.slice(0, 1));
    const voor = { toegewezen: t.toegewezen || '', start: t.start || '', eind: t.eind || '', lijst: nu, personen: t.personen ? JSON.parse(JSON.stringify(t.personen)) : null };
    let datums = null, melding = '';
    if (spec.soort === 'nieuw') {
      datums = V.taakDatums(t, slug, spec.datum, ctx); if (!datums.ok) return datums;
      if (datums.verschoven) melding = lid.naam + ' werkt niet op ' + dagMnd(spec.datum) + ': de taak begint op ' + dagMnd(datums.start) + '.';
    } else if (spec.soort === 'taakrand') {
      datums = V.taakRand(t, spec.kant, spec.datum, spec.delta, ctx); if (!datums.ok) return datums;
    } else if (spec.soort === 'taakbalk') {
      const dag = isYmd(spec.datum) && dow(spec.datum) !== 0 && dow(spec.datum) !== 6, schuif = Number.isInteger(spec.delta) ? spec.delta !== 0 : (dag && isYmd(spec.vanDatum) && spec.datum !== spec.vanDatum);
      if (schuif) { datums = V.taakVerschuif(t, spec.vanDatum, spec.datum, spec.delta, ctx); if (!datums.ok) return datums; }   // een weekend wordt genegeerd: dan verandert alleen de persoon
    }
    if (zelfde && (!datums || (datums.start === (t.start || '') && datums.eind === (t.eind || '')))) return { ok: true, noop: true };
    return Object.assign({ ok: true, taak: { id: t.id, code: spec.taak.code, naam: t.naam || spec.taak.naam || '' }, lijst, zelfde, melding, voor }, datums ? { start: datums.start, eind: datums.eind } : {});
  };
  // Het plan op een taak toepassen (ter plekke): de persoon (de takenmotor stempelt toegewezen; met de vlag ook personen) en de datums.
  V.pasTaakToe = function (t, plan, opt) {
    const P = root.MTPlanning; if (!plan.zelfde) { if (P.MEERDERE_PERSONEN) P.personenZet(t, plan.lijst, opt); else if ((plan.lijst[0] || '') !== (t.toegewezen || '')) P.toegewezenZet(t, plan.lijst[0], opt); }   // alleen de datums veranderen: de personen niet aanraken
    if (plan.start !== undefined) { t.start = plan.start; t.eind = plan.eind; }
  };
  const SCHRIJF_REDEN = { lezen: 'SharePoint is niet bereikbaar; er is niets gewijzigd.', ontbreekt: 'De takenlijst bestaat nog niet op SharePoint; er is niets gewijzigd.', vorm: 'De takenlijst heeft een onverwachte vorm; er is niets gewijzigd.', recht: 'Dit mag je niet met jouw rol.', geblokkeerd: 'De takenlijst is geblokkeerd; er is niets gewijzigd.',
    schrijven: 'Opslaan is niet gelukt, ook niet na een paar pogingen (iemand anders wijzigt tegelijk, of SharePoint is niet bereikbaar). Er is niets gewijzigd.', aanroep: 'Onvolledige aanroep.' };
  const TIJD_LEZEN = 'SharePoint reageert niet (20 seconden); er is niets gewijzigd.', TIJD_SCHRIJVEN = 'SharePoint reageert niet (20 seconden). Lokaal is niets gewijzigd; de wijziging is mogelijk wel doorgekomen, ververs de planning om dat te zien.';
  const stempelsVan = (x, velden) => { const uit = {}; velden.forEach(k => { uit[k] = Number(x && x._vs && x._vs[k] && x._vs[k].t) || 0; }); return uit; };
  // De _ts per persoon (en of er een tombstone is): wat er van personen op dit moment staat. Een persoon erbij of weg, of een wijziging van een entry, verandert dit.
  const personenStand = x => { const uit = {}, p = x && x.personen; if (p && typeof p === 'object' && !Array.isArray(p)) Object.keys(p).forEach(k => { const e = p[k]; if (e && typeof e === 'object') uit[k] = String(e._ts || '') + (e.weg ? '!' : ''); }); return uit; };
  const gelijkStand = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
  // lezen en schrijven met een time-out (20 s): een hangende verbinding geeft een eerlijke melding in plaats van een slot dat nooit vrijkomt
  const metTijd = (belofte, ms, fase) => new Promise((ok, nee) => { const h = setTimeout(() => nee(Object.assign(new Error('time-out'), { timeout: fase })), ms); Promise.resolve(belofte).then(v => { clearTimeout(h); ok(v); }, e => { clearTimeout(h); nee(e); }); });
  const tijdSp = (sp, ms) => ({ read: n => metTijd(sp.read(n), ms, 'lezen'), write: (n, d, m) => metTijd(sp.write(n, d, m), ms, 'schrijven') });
  const schrijfFout = res => res.reden === 'weigering' ? (res.fout || 'Niet gewijzigd.') : (res.reden === 'lezen' && /time-out/.test(res.fout || '')) ? TIJD_LEZEN : (SCHRIJF_REDEN[res.reden] || 'Niet gewijzigd.');
  const opvolgerSleutel = v => (v && v.ok ? v.wijzigingen.map(w => w.id + ':' + w.naar.start + ':' + w.naar.eind).sort().join('|') : '');
  // De hele sleepactie: plan op de lokale stand (voor de vraag over opvolgers), dan takenSchrijf die vers leest, het plan opnieuw op de verse stand rekent, de opvolgers opnieuw rekent (wijkt de set af van wat de
  // gebruiker bevestigde, dan één keer opnieuw vragen met de nieuwe set; daarna afbreken), de taak aanpast en schrijft.
  // o = { sp, lokaal(), ctx(), nu(), door, dev, projectId, mag(spec), timeout?, verschuif(taken, {id,start,eind}) -> verschuifVoorstel, vraagOpvolgers(v) -> Promise<0 (mee) | 1 (alleen deze taak) | null> }
  // -> { ok:false, reden } | { ok:false, geannuleerd:true } | { ok:true, noop:true } | { ok:true, wijziging, melding, opgeslagen:true, behouden:true, data, taken }
  V.plaatsTaak = async function (spec, o) {
    const P = root.MTPlanning, ctx0 = o.ctx(), plan0 = V.taakPlan(spec, ctx0); if (!plan0.ok || plan0.noop) return plan0;
    const code = plan0.taak.code, id = plan0.taak.id, sp = tijdSp(o.sp, o.timeout || 20000); let mee = true, getoond = '';
    if (plan0.start !== undefined && o.verschuif) {
      const v = o.verschuif(ctx0.taken, { id, start: plan0.start, eind: plan0.eind }); getoond = opvolgerSleutel(v);
      if (getoond) { const k = await o.vraagOpvolgers(v); if (k === null || k === undefined) return { ok: false, geannuleerd: true, reden: '' }; mee = (k === 0); }
    }
    for (let ronde = 0; ronde < 2; ronde++) {
      let plan = null, verschoven = [], noop = false, afwijking = null;
      let res; try {
        res = await P.takenSchrijf(sp, { code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
          plan = V.taakPlan(spec, Object.assign({}, o.ctx(), { taken: werk })); if (!plan.ok) return { fout: plan.reden };   // opnieuw op de verse stand: iemand kan intussen iets gewijzigd hebben
          if (plan.noop) { noop = true; return false; }
          const t = werk.find(x => x.id === id), oud = {}; werk.forEach(x => { oud[x.id] = { start: x.start || '', eind: x.eind || '' }; });
          let v2 = null;
          if (plan.start !== undefined && o.verschuif) {   // de opvolgers opnieuw op de verse stand: wijkt de set af van wat de gebruiker bevestigde, dan eerst opnieuw vragen
            v2 = o.verschuif(werk.map(x => x === t ? Object.assign({}, x, { start: oud[id].start, eind: oud[id].eind }) : x), { id, start: plan.start, eind: plan.eind });
            if (mee && opvolgerSleutel(v2) !== getoond) { afwijking = v2; return false; }
          }
          V.pasTaakToe(t, plan, { nu: o.nu(), door: o.door, team: ctx0.team });
          if (v2 && v2.ok && mee) P.voorstelToepassen(werk, v2, { metOpvolgers: true }).forEach(x => { const y = werk.find(w => w.id === x.id); if (y && y.id !== id && (y.start !== x.start || y.eind !== x.eind)) { verschoven.push({ id: y.id, voor: oud[y.id] }); y.start = x.start; y.eind = x.eind; } });
          return werk;
        } });
      } catch (e) { return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : TIJD_SCHRIJVEN }; }
      if (afwijking) {
        if (ronde === 1) return { ok: false, reden: 'De opvolgers zijn intussen veranderd; er is niets gewijzigd. Probeer het opnieuw.' };
        const nieuweSet = opvolgerSleutel(afwijking);
        if (nieuweSet) { const k = await o.vraagOpvolgers(afwijking); if (k === null || k === undefined) return { ok: false, geannuleerd: true, reden: '' }; mee = (k === 0); }
        getoond = nieuweSet; continue;
      }
      if (noop) return { ok: true, noop: true };
      if (!res.ok) return { ok: false, reden: schrijfFout(res) };
      const na = res.taken.find(x => x.id === id) || {}, velden = ['toegewezen', 'start', 'eind'];
      return { ok: true, opgeslagen: true, behouden: true, melding: plan.melding || '', data: res.data, taken: res.taken,
        wijziging: { soort: 'taak', id, code, naam: plan.taak.naam, voor: plan.voor, na: { persoon: plan.lijst[0] || '', datum: plan.start || na.start || '', eind: plan.eind || na.eind || '', start: '' }, stempels: stempelsVan(na, velden), personenNa: personenStand(na),
          opvolgers: verschoven.map(x => Object.assign({ stempels: stempelsVan(res.taken.find(y => y.id === x.id), ['start', 'eind']) }, x)) } };
    }
    return { ok: false, reden: 'De opvolgers zijn intussen veranderd; er is niets gewijzigd. Probeer het opnieuw.' };
  };
  // Ongedaan maken: alleen als niemand de taak (of een verschoven opvolger) sindsdien wijzigde: dezelfde stempels van toegewezen, start en eind, en dezelfde personen (de _ts per persoon, inclusief tombstones en wie
  // erbij of weg is); zet toegewezen, personen en de datums terug.
  V.taakHerstel = async function (w, o) {
    const P = root.MTPlanning; if (!w || w.soort !== 'taak') return { ok: false, reden: 'Er is niets om ongedaan te maken.' };
    let res; try {
      res = await P.takenSchrijf(tijdSp(o.sp, o.timeout || 20000), { code: w.code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
        const t = werk.find(x => x.id === w.id); if (!t) return { fout: 'Deze taak bestaat niet meer; niets teruggezet.' };
        const zelfde = (x, st) => Object.keys(st).every(k => (Number(x && x._vs && x._vs[k] && x._vs[k].t) || 0) === st[k]);
        if (!zelfde(t, w.stempels) || !gelijkStand(personenStand(t), w.personenNa || {}) || (w.opvolgers || []).some(v => !zelfde(werk.find(x => x.id === v.id), v.stempels))) return { fout: 'Deze taak is intussen door iemand anders gewijzigd; niet teruggezet.' };
        if (P.MEERDERE_PERSONEN) P.personenZet(t, w.voor.lijst, { nu: o.nu(), door: o.door, team: (o.ctx() || {}).team }); else if ((w.voor.toegewezen || '') !== (t.toegewezen || '')) P.toegewezenZet(t, w.voor.toegewezen, { nu: o.nu(), door: o.door });
        if (w.voor.start) t.start = w.voor.start; else delete t.start; if (w.voor.eind) t.eind = w.voor.eind; else delete t.eind;
        (w.opvolgers || []).forEach(v => { const y = werk.find(x => x.id === v.id); if (y) { y.start = v.voor.start; y.eind = v.voor.eind; } });
        return werk;
      } });
    } catch (e) { return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : TIJD_SCHRIJVEN }; }
    if (!res.ok) return { ok: false, reden: schrijfFout(res) };
    return { ok: true, opgeslagen: true, data: res.data };
  };

  root.MTPlanVerplaats = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
