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
    if (spec.soort !== 'taakrand' && spec.soort !== 'taakdatums' && spec.soort !== 'taakwis' && !lid && !(spec.soort === 'taakbalk' && !spec.persoon)) return 'Onbekende persoon.';   // een taakbalk zonder persoon (rij Niet toegewezen) kan alleen schuiven
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
    } else if (spec.soort === 'taakbalk' || spec.soort === 'taakrand' || spec.soort === 'taakdatums' || spec.soort === 'taakwis') {
      const t = spec.taak;
      if (!t || !t.code || !t.id) return 'Onbekende taak.';
      if (t.voorstel) return 'Een voorstel van de werkplaats neem je eerst over (Mijn werk) voordat je het verplaatst.';
      if (spec.soort === 'taakrand') {
        if (spec.kant !== 'start' && spec.kant !== 'eind') return 'Onbekende rand.';
        if (!isYmd(spec.datum) && !(Number.isInteger(spec.delta) && spec.delta !== 0)) return 'Ongeldige dag.';
      } else if (spec.soort === 'taakdatums') {
        if (!isYmd(spec.startDatum) || !isYmd(spec.eindDatum)) return 'Ongeldige dag.';
      } else if (spec.soort === 'taakwis') {   // de datums wissen (terug naar Ongepland): niet zolang er nog een planblok aan de taak hangt (dan bleef hij toch gepland)
        if ((ctx.blokken || []).some(b => actief(b) && b.taak_id != null && String(b.taak_id) === String(t.id) && String(b.project_code || '').toLowerCase() === String(t.code).toLowerCase())) return 'Aan deze taak hangt nog een planblok: verplaats, verwijder of zet dat eerst om.';
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
  //   { soort: 'taakdatums', taak, startDatum, eindDatum }                                                  beide datums rechtstreeks (de dialoog Datums wijzigen); zelfde regels als taakrand: start naar de eerstvolgende werkdag, eind naar de vorige
  //   { soort: 'taakwis', taak, gezien? }                                                                        de datums wissen (het taakpaneel): terug naar Ongepland; geen opvolgers, niet met een planblok eraan
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
    if (telBedrijf(d0.start, d0.eind, vs) === null) return { ok: false, reden: TE_LANG };   // een bestaand traject langer dan drie jaar schuiven we niet
    let d = delta;
    if (!Number.isInteger(d)) { const van = naarBedrijfsdag(vanDatum, true, vs), doel = naarBedrijfsdag(datum, true, vs); if (!van || !doel) return { ok: false, reden: 'Ongeldige dag.' }; d = bedrijfTussen(van, doel, vs); if (d === null) return { ok: false, reden: TE_LANG }; }
    if (d === 0) return { ok: true, start: d0.start, eind: d0.eind };
    const start = plusBedrijf(d0.start, d, vs), eind = plusBedrijf(d0.eind, d, vs); if (!start || !eind || telBedrijf(start, eind, vs) === null) return { ok: false, reden: TE_LANG };
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
  // Beide datums rechtstreeks (de dialoog Datums wijzigen): start naar de eerstvolgende bedrijfswerkdag, eind naar de vorige; eind nooit voor start; een mijlpaal heeft een datum. -> { ok, start, eind } | { ok:false, reden }
  V.taakZet = function (t, start, eind, ctx) {
    if (!isYmd(start) || !isYmd(eind)) return { ok: false, reden: 'Ongeldige dag.' };
    const vs = verplichtSet(ctx);
    if (t.soort === 'mijlpaal') { if (start !== eind) return { ok: false, reden: 'Een mijlpaal heeft één datum.' }; const d = naarBedrijfsdag(start, true, vs); return d ? { ok: true, start: d, eind: d } : { ok: false, reden: 'Ongeldige dag.' }; }
    if (eind < start) return { ok: false, reden: 'Het eind ligt voor de start.' };
    const s = naarBedrijfsdag(start, true, vs), e = naarBedrijfsdag(eind, false, vs); if (!s || !e) return { ok: false, reden: 'Ongeldige dag.' };
    if (e < s) return { ok: false, reden: 'Tussen de start en het eind ligt geen werkdag.' };
    if (telBedrijf(s, e, vs) === null) return { ok: false, reden: TE_LANG };
    return { ok: true, start: s, eind: e };
  };
  // Het plan voor een sleepactie op een taak (zuiver rekenwerk). ctx = { taken (de actieve taken van dat project), team, verlof, vrijedagen, werktijden, werkuren, mag }
  // -> { ok:false, reden } | { ok:true, noop:true } | { ok:true, taak:{id, code, naam}, lijst (de personen na afloop), start?, eind?, melding, voor }
  V.taakPlan = function (spec, ctx) {
    const reden = V.controle(spec, Object.assign({}, ctx, { blokken: [] })); if (reden) return { ok: false, reden };
    const P = root.MTPlanning, team = ctx.team || [];
    const zonderP = spec.soort === 'taakrand' || spec.soort === 'taakdatums' || spec.soort === 'taakwis', lid = zonderP ? null : team.find(m => m && String(m.slug).toLowerCase() === String(spec.persoon).toLowerCase()), slug = lid ? String(lid.slug).toLowerCase() : '';
    const t = (ctx.taken || []).find(x => x && !x._vervallen && String(x.id) === String(spec.taak.id)); if (!t) return { ok: false, reden: 'Deze taak bestaat niet meer.' };
    if ((t.status || 'todo') === 'klaar') return { ok: false, reden: 'Een klare taak plan je niet meer in.' };
    if (t.voorstel) return { ok: false, reden: 'Een voorstel van de werkplaats neem je eerst over (Mijn werk) voordat je het inplant.' };
    const nu = P.taakMensen(t), van = String(spec.van == null ? '' : spec.van).toLowerCase();
    let lijst = nu;
    if (spec.soort === 'taakbalk' && slug) lijst = P.MEERDERE_PERSONEN ? (nu.includes(van) ? nu.map(p => p === van ? slug : p) : [slug].concat(nu)) : [slug];
    else if (spec.soort === 'nieuw') lijst = P.MEERDERE_PERSONEN ? [slug].concat(nu.filter(p => p !== slug)) : [slug];
    lijst = lijst.filter((p, i) => p && lijst.indexOf(p) === i);
    const zelfde = JSON.stringify(lijst) === JSON.stringify(zonderP || P.MEERDERE_PERSONEN ? nu : nu.slice(0, 1));
    const voor = { toegewezen: t.toegewezen || '', start: t.start || '', eind: t.eind || '', lijst: nu, personen: t.personen ? JSON.parse(JSON.stringify(t.personen)) : null };
    let datums = null, melding = '';
    if (spec.soort === 'nieuw') {
      datums = V.taakDatums(t, slug, spec.datum, ctx); if (!datums.ok) return datums;
      if (datums.verschoven) melding = lid.naam + ' werkt niet op ' + dagMnd(spec.datum) + ': de taak begint op ' + dagMnd(datums.start) + '.';
    } else if (spec.soort === 'taakrand') {
      datums = V.taakRand(t, spec.kant, spec.datum, spec.delta, ctx); if (!datums.ok) return datums;
    } else if (spec.soort === 'taakdatums') {
      datums = V.taakZet(t, spec.startDatum, spec.eindDatum, ctx); if (!datums.ok) return datums;
    } else if (spec.soort === 'taakwis') {
      datums = { ok: true, start: '', eind: '' }; melding = 'De taak staat weer in Ongepland.';   // start en eind weg; de persoon blijft
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
    if (plan.start === '') { delete t.start; delete t.eind; }   // taakwis: terug naar Ongepland
    else if (plan.start !== undefined) { t.start = plan.start; t.eind = plan.eind; }
  };
  const SCHRIJF_REDEN = { lezen: 'SharePoint is niet bereikbaar; er is niets gewijzigd.', ontbreekt: 'De takenlijst bestaat nog niet op SharePoint; er is niets gewijzigd.', vorm: 'De takenlijst heeft een onverwachte vorm; er is niets gewijzigd.', recht: 'Dit mag je niet met jouw rol.', geblokkeerd: 'De takenlijst is geblokkeerd; er is niets gewijzigd.',
    schrijven: 'Opslaan is niet gelukt, ook niet na een paar pogingen (iemand anders wijzigt tegelijk, of SharePoint is niet bereikbaar). Er is niets gewijzigd.', aanroep: 'Onvolledige aanroep.' };
  // Tijdgrenzen (T5b): na ZACHT (20 s) een rustige melding "Opslaan duurt lang"; de actie blijft gelockt. Na HARD (90 s) geven we het wachten op: de echte lees- of schrijfactie loopt door (de fetch is niet
  // af te breken) en houdt het slot van DEZE taak vast tot hij klaar is. Daarna wordt vers gelezen en vastgesteld of de eigen wijziging erin staat: opgeslagen, niet opgeslagen of iemand anders wijzigde dit tegelijk.
  const ZACHT = 20000, HARD = 90000;
  const TIJD_LEZEN = 'SharePoint reageert niet; er is niets gewijzigd.', TIJD_SCHRIJVEN = 'Opslaan duurt erg lang (90 seconden). Zodra SharePoint antwoordt controleer ik of het gelukt is en meld ik dat; tot die tijd is deze taak vergrendeld.';
  const BEZET = 'Voor deze taak loopt nog een opslag; wacht tot die klaar is.';
  const stempelsVan = (x, velden) => { const uit = {}; velden.forEach(k => { uit[k] = Number(x && x._vs && x._vs[k] && x._vs[k].t) || 0; }); return uit; };
  // De _ts per persoon (en of er een tombstone is): wat er van personen op dit moment staat. Een persoon erbij of weg, of een wijziging van een entry, verandert dit.
  const personenStand = x => { const uit = {}, p = x && x.personen; if (p && typeof p === 'object' && !Array.isArray(p)) Object.keys(p).forEach(k => { const e = p[k]; if (e && typeof e === 'object') uit[k] = String(e._ts || '') + (e.weg ? '!' : ''); }); return uit; };
  const gelijkStand = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
  // Het slot per taak: het aantal lopende echte lees- en schrijfacties (plus een nog lopende controle) op die taak. Zolang het > 0 is, start er geen tweede actie op dezelfde taak; andere taken mogen wel.
  const slots = new Map();
  const sleutelVan = (code, id) => String(code == null ? '' : code).toLowerCase() + '\u0001' + String(id == null ? '' : id);
  const slotMin = (k, d) => { const n = (slots.get(k) || 0) + d; if (n > 0) slots.set(k, n); else slots.delete(k); };
  V.taakBezig = (code, id) => (slots.get(sleutelVan(code, id)) || 0) > 0;
  V.slotenLeeg = () => slots.clear();   // alleen voor tests
  const maakSt = (o, sleutel) => ({ sleutel, zacht: o.zacht || o.timeout || ZACHT, hard: o.hard || HARD, traag: o.traag, echt: [], verlaten: false, gemeld: false, samen: null, fase: '' });
  // Lezen en schrijven met een tijdgrens. Het wachten wordt na st.hard opgegeven (het slot blijft staan tot de echte belofte klaar is) en daarna start er niets meer: een verlaten actie schrijft nooit alsnog.
  const tijdSp = (sp, st) => {
    const doe = (fase, echt) => {
      if (st.verlaten) return Promise.reject(Object.assign(new Error('afgebroken'), { timeout: st.fase || fase }));
      slotMin(st.sleutel, 1);
      let p; try { p = Promise.resolve(echt()); } catch (e) { p = Promise.reject(e); }
      const klaar = () => slotMin(st.sleutel, -1);
      p.then(klaar, klaar); st.echt.push(p.then(() => 0, () => 0));
      return new Promise((ok, nee) => {
        const h1 = setTimeout(() => { if (!st.gemeld && typeof st.traag === 'function') { st.gemeld = true; try { st.traag(); } catch (e) {} } }, st.zacht);
        const h2 = setTimeout(() => { st.verlaten = true; st.fase = fase; nee(Object.assign(new Error('time-out'), { timeout: fase })); }, st.hard);
        p.then(v => { clearTimeout(h1); clearTimeout(h2); ok(v); }, e => { clearTimeout(h1); clearTimeout(h2); nee(e); });
      });
    };
    return { read: n => doe('lezen', () => sp.read(n)),
      write: (n, d, m) => doe('schrijven', () => sp.write(n, d, typeof m === 'function' ? ((r, l) => { const x = m(r, l); if (x !== null && x !== undefined) st.samen = x; return x; }) : m)) };   // st.samen: de laatste samengevoegde stand van een 412
  };
  const schrijfFout = res => res.reden === 'weigering' ? (res.fout || 'Niet gewijzigd.') : (res.reden === 'lezen' && /time-out|afgebroken/.test(res.fout || '')) ? TIJD_LEZEN : (SCHRIJF_REDEN[res.reden] || 'Niet gewijzigd.');
  const opvolgerSleutel = v => (v && v.ok ? v.wijzigingen.map(w => w.id + ':' + w.naar.start + ':' + w.naar.eind).sort().join('|') : '');
  // Staat de taak (en de opvolgers) in `taken` zoals bedoeld? b = { toegewezen?, lijst?, start?, eind?, opvolgers?: [{id,start,eind}] }; wat ontbreekt wordt niet vergeleken.
  const komtOvereen = (taken, id, b) => {
    const P = root.MTPlanning, t = (taken || []).find(x => x && String(x.id) === String(id)); if (!t || !b) return false;
    if (b.toegewezen !== undefined && (t.toegewezen || '') !== b.toegewezen) return false;
    if (b.lijst !== undefined && JSON.stringify(P.taakMensen(t)) !== JSON.stringify(b.lijst)) return false;
    if (b.start !== undefined && ((t.start || '') !== b.start || (t.eind || '') !== (b.eind || ''))) return false;
    return (b.opvolgers || []).every(v => { const y = taken.find(x => x && String(x.id) === String(v.id)); return !!y && (y.start || '') === v.start && (y.eind || '') === v.eind; });
  };
  const staatNu = (t, team) => {
    const lid = (team || []).find(m => m && String(m.slug).toLowerCase() === String(t.toegewezen || '').toLowerCase());
    return (t.toegewezen ? (lid ? lid.naam : t.toegewezen) : 'niemand') + (isYmd(t.start) ? ', ' + dagMnd(t.start) + (isYmd(t.eind) && t.eind !== t.start ? ' t/m ' + dagMnd(t.eind) : '') : ', zonder datums');
  };
  // Wie wijzigde het laatst een veld dat nu anders is dan bedoeld? (de naam via o.naamVan, anders "Iemand anders")
  const wieAnders = (t, b, o) => {
    let beste = null;
    [['toegewezen', b.toegewezen], ['start', b.start], ['eind', b.eind]].forEach(([k, doel]) => { if (doel === undefined || (t[k] || '') === doel) return; const s = t._vs && t._vs[k]; if (s && (!beste || Number(s.t) > Number(beste.t))) beste = s; });
    return (beste && beste.door && typeof o.naamVan === 'function' && o.naamVan(beste.door)) || 'Iemand anders';
  };
  const tegelijkTekst = (taken, id, b, o) => {
    const t = (taken || []).find(x => x && String(x.id) === String(id)); if (!t) return 'Iemand anders verwijderde deze taak tegelijk; jouw wijziging is niet overgenomen.';
    return wieAnders(t, b, o) + ' wijzigde dit tegelijk; nu staat er ' + staatNu(t, (o.ctx() || {}).team) + '. Jouw wijziging is niet (helemaal) overgenomen.';
  };
  // Na een time-out op het schrijven: wacht tot de echte actie klaar is (het slot blijft zolang staan), lees dan vers en stel vast wat er van staat.
  // -> Promise<{ soort: 'opgeslagen' | 'niet' | 'tegelijk' | 'onbekend', tekst, data? }>; (de aanroeper claimt het slot synchroon met slotMin(+1); hier komt het vrij)
  const uitkomst = async (o, st, code, id, bedoeld, voor, naam) => {
    const P = root.MTPlanning, bestand = 'mt_project_taken_v2.json';
    try {
      await Promise.all(st.echt);
      const st2 = maakSt(o, st.sleutel); let raw;
      try { raw = await tijdSp(o.sp, st2).read(bestand); } catch (e) { return { soort: 'onbekend', tekst: 'Ik kon niet vaststellen of het opslaan van "' + naam + '" gelukt is: SharePoint antwoordt niet. Ververs de planning om te zien hoe het er nu voor staat.' }; }
      let samen, data = null;
      try { samen = P.takenSamen(null, raw); data = P.takenSamen(o.lokaal(), raw); } catch (e) { return { soort: 'onbekend', tekst: 'Ik kon niet vaststellen of het opslaan van "' + naam + '" gelukt is: de takenlijst heeft een onverwachte vorm. Ververs de planning.' }; }
      const taken = P.takenActief(Array.isArray(samen[code]) ? samen[code] : []), team = (o.ctx() || {}).team;
      if (bedoeld && komtOvereen(taken, id, bedoeld)) return { soort: 'opgeslagen', tekst: 'Opgeslagen: ' + naam + ' (' + staatNu(taken.find(x => String(x.id) === String(id)), team) + ').', data };
      if (voor && komtOvereen(taken, id, voor)) return { soort: 'niet', tekst: 'Niet opgeslagen: ' + naam + ' staat nog zoals voorheen. Probeer het opnieuw.', data };
      return { soort: 'tegelijk', tekst: tegelijkTekst(taken, id, bedoeld || {}, o), data };
    } finally { slotMin(st.sleutel, -1); }
  };
  // Het slot vasthouden terwijl de controle loopt (synchroon claimen, zodat er geen gaatje is tussen de time-out en de controle)
  const controleer = (o, st, code, id, bedoeld, voor, naam) => { slotMin(st.sleutel, 1); return uitkomst(o, st, code, id, bedoeld, voor, naam); };
  // De hele sleepactie: plan op de lokale stand (voor de vraag over opvolgers), dan takenSchrijf die vers leest, het plan opnieuw op de verse stand rekent, de opvolgers opnieuw rekent (wijkt de set af van wat de
  // gebruiker bevestigde, dan één keer opnieuw vragen met de nieuwe set; daarna afbreken), de taak aanpast en schrijft. Daarna wordt de samengevoegde stand vergeleken met wat bedoeld was (tegelijk gewijzigd?).
  // o = { sp, lokaal(), ctx(), nu(), door, dev, projectId, mag(spec), zacht?, hard?, traag?(), naamVan?(door), verschuif(taken, {id,start,eind}) -> verschuifVoorstel, vraagOpvolgers(v) -> Promise<0 (mee) | 1 (alleen deze taak) | null> }
  // -> { ok:false, reden } | { ok:false, bezet:true, reden } | { ok:false, onzeker: Promise<uitkomst>, reden } | { ok:false, geannuleerd:true } | { ok:true, noop:true }
  //    | { ok:true, opgeslagen:true, tegelijk:tekst, data, taken } (iemand was tegelijk; geen ongedaan maken) | { ok:true, wijziging, melding, opgeslagen:true, behouden:true, data, taken }
  V.plaatsTaak = async function (spec, o) {
    const P = root.MTPlanning, ctx0 = o.ctx(), plan0 = V.taakPlan(spec, ctx0); if (!plan0.ok || plan0.noop) return plan0;
    const code = plan0.taak.code, id = plan0.taak.id; if (V.taakBezig(code, id)) return { ok: false, bezet: true, reden: BEZET };
    const st = maakSt(o, sleutelVan(code, id)), sp = tijdSp(o.sp, st); let mee = true, getoond = '';
    if (plan0.start !== undefined && plan0.start !== '' && o.verschuif) {   // datums wissen schuift geen opvolgers
      const v = o.verschuif(ctx0.taken, { id, start: plan0.start, eind: plan0.eind }); getoond = opvolgerSleutel(v);
      if (getoond) { const k = await o.vraagOpvolgers(v); if (k === null || k === undefined) return { ok: false, geannuleerd: true, reden: '' }; mee = (k === 0); }
    }
    for (let ronde = 0; ronde < 2; ronde++) {
      let plan = null, verschoven = [], noop = false, afwijking = null, bedoeld = null, anders = ''; st.samen = null;
      let res; try {
        res = await P.takenSchrijf(sp, { code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
          // het taakpaneel geeft mee welke datums de gebruiker zag (spec.gezien): staan er op de verse stand andere, dan niets overschrijven (slepen geeft dit niet mee en rekent zoals altijd op de verse stand)
          if (spec.gezien) { const g = werk.find(x => x && String(x.id) === String(id)); if (g && ((g.start || '') !== (spec.gezien.start || '') || (g.eind || '') !== (spec.gezien.eind || ''))) { anders = wieAnders(g, { start: spec.gezien.start || '', eind: spec.gezien.eind || '' }, o) + ' wijzigde de datums intussen (nu ' + staatNu(g, (o.ctx() || {}).team) + '); jouw wijziging is niet opgeslagen.'; return false; } }
          plan = V.taakPlan(spec, Object.assign({}, o.ctx(), { taken: werk })); if (!plan.ok) return { fout: plan.reden };   // opnieuw op de verse stand: iemand kan intussen iets gewijzigd hebben
          if (plan.noop) { noop = true; return false; }
          const t = werk.find(x => x.id === id), oud = {}; werk.forEach(x => { oud[x.id] = { start: x.start || '', eind: x.eind || '' }; });
          let v2 = null;
          if (plan.start !== undefined && plan.start !== '' && o.verschuif) {   // de opvolgers opnieuw op de verse stand: wijkt de set af van wat de gebruiker bevestigde, dan eerst opnieuw vragen
            v2 = o.verschuif(werk.map(x => x === t ? Object.assign({}, x, { start: oud[id].start, eind: oud[id].eind }) : x), { id, start: plan.start, eind: plan.eind });
            if (mee && opvolgerSleutel(v2) !== getoond) { afwijking = v2; return false; }
          }
          V.pasTaakToe(t, plan, { nu: o.nu(), door: o.door, team: ctx0.team });
          if (v2 && v2.ok && mee) P.voorstelToepassen(werk, v2, { metOpvolgers: true }).forEach(x => { const y = werk.find(w => w.id === x.id); if (y && y.id !== id && (y.start !== x.start || y.eind !== x.eind)) { verschoven.push({ id: y.id, voor: oud[y.id] }); y.start = x.start; y.eind = x.eind; } });
          bedoeld = { toegewezen: t.toegewezen || '', lijst: P.taakMensen(t), start: plan.start === undefined ? undefined : (t.start || ''), eind: plan.start === undefined ? undefined : (t.eind || ''),
            opvolgers: verschoven.map(x => { const y = werk.find(w => w.id === x.id); return { id: x.id, start: (y && y.start) || '', eind: (y && y.eind) || '' }; }) };
          return werk;
        } });
      } catch (e) {
        if (e && e.timeout === 'schrijven') return { ok: false, reden: TIJD_SCHRIJVEN, onzeker: controleer(o, st, code, id, bedoeld, plan ? { toegewezen: plan.voor.toegewezen, lijst: plan.voor.lijst, start: plan.voor.start, eind: plan.voor.eind } : null, plan0.taak.naam) };
        return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : SCHRIJF_REDEN.schrijven };
      }
      if (anders) return { ok: false, tegelijk: true, reden: anders };
      if (afwijking) {
        if (ronde === 1) return { ok: false, reden: 'De opvolgers zijn intussen veranderd; er is niets gewijzigd. Probeer het opnieuw.' };
        const nieuweSet = opvolgerSleutel(afwijking);
        if (nieuweSet) { const k = await o.vraagOpvolgers(afwijking); if (k === null || k === undefined) return { ok: false, geannuleerd: true, reden: '' }; mee = (k === 0); }
        getoond = nieuweSet; continue;
      }
      if (noop) return { ok: true, noop: true };
      if (!res.ok) return { ok: false, reden: schrijfFout(res) };
      // wat er na de write echt staat: bij een 412 is dat de samengevoegde stand (st.samen), anders wat we schreven
      const data = st.samen && typeof st.samen === 'object' ? st.samen : res.data, taken = data && Array.isArray(data[code]) ? P.takenActief(data[code]) : res.taken;
      if (!komtOvereen(taken, id, bedoeld)) return { ok: true, opgeslagen: true, tegelijk: tegelijkTekst(taken, id, bedoeld || {}, o), data, taken };   // iemand wijzigde tegelijk en won: eerlijk melden en de lokale kopie op de samengevoegde stand zetten
      const na = taken.find(x => x.id === id) || {}, velden = ['toegewezen', 'start', 'eind'];
      return { ok: true, opgeslagen: true, behouden: true, melding: plan.melding || '', data, taken,
        wijziging: { soort: 'taak', id, code, naam: plan.taak.naam, voor: plan.voor, na: { persoon: plan.lijst[0] || '', datum: plan.start || na.start || '', eind: plan.eind || na.eind || '', start: '' }, stempels: stempelsVan(na, velden), personenNa: personenStand(na),
          opvolgers: verschoven.map(x => Object.assign({ stempels: stempelsVan(taken.find(y => y.id === x.id), ['start', 'eind']) }, x)) } };
    }
    return { ok: false, reden: 'De opvolgers zijn intussen veranderd; er is niets gewijzigd. Probeer het opnieuw.' };
  };
  // Ongedaan maken: alleen als niemand de taak (of een verschoven opvolger) sindsdien wijzigde: dezelfde stempels van toegewezen, start en eind, en dezelfde personen (de _ts per persoon, inclusief tombstones en wie
  // erbij of weg is); zet toegewezen, personen en de datums terug. Zelfde slot, tijdgrenzen en controle achteraf als plaatsTaak.
  V.taakHerstel = async function (w, o) {
    const P = root.MTPlanning; if (!w || w.soort !== 'taak') return { ok: false, reden: 'Er is niets om ongedaan te maken.' };
    if (V.taakBezig(w.code, w.id)) return { ok: false, bezet: true, reden: BEZET };
    const st = maakSt(o, sleutelVan(w.code, w.id)), naam = w.naam || 'de taak'; let bedoeld = null, res;
    try {
      res = await P.takenSchrijf(tijdSp(o.sp, st), { code: w.code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
        const t = werk.find(x => x.id === w.id); if (!t) return { fout: 'Deze taak bestaat niet meer; niets teruggezet.' };
        const zelfde = (x, s) => Object.keys(s).every(k => (Number(x && x._vs && x._vs[k] && x._vs[k].t) || 0) === s[k]);
        if (!zelfde(t, w.stempels) || !gelijkStand(personenStand(t), w.personenNa || {}) || (w.opvolgers || []).some(v => !zelfde(werk.find(x => x.id === v.id), v.stempels))) return { fout: 'Deze taak is intussen door iemand anders gewijzigd; niet teruggezet.' };
        if (P.MEERDERE_PERSONEN) P.personenZet(t, w.voor.lijst, { nu: o.nu(), door: o.door, team: (o.ctx() || {}).team }); else if ((w.voor.toegewezen || '') !== (t.toegewezen || '')) P.toegewezenZet(t, w.voor.toegewezen, { nu: o.nu(), door: o.door });
        if (w.voor.start) t.start = w.voor.start; else delete t.start; if (w.voor.eind) t.eind = w.voor.eind; else delete t.eind;
        (w.opvolgers || []).forEach(v => { const y = werk.find(x => x.id === v.id); if (y) { y.start = v.voor.start; y.eind = v.voor.eind; } });
        bedoeld = { toegewezen: t.toegewezen || '', lijst: P.taakMensen(t), start: t.start || '', eind: t.eind || '', opvolgers: (w.opvolgers || []).map(v => ({ id: v.id, start: v.voor.start || '', eind: v.voor.eind || '' })) };
        return werk;
      } });
    } catch (e) {
      if (e && e.timeout === 'schrijven') return { ok: false, reden: TIJD_SCHRIJVEN, onzeker: controleer(o, st, w.code, w.id, bedoeld, { toegewezen: (w.na && w.na.persoon) || '', start: (w.na && w.na.datum) || undefined, eind: (w.na && w.na.eind) || undefined }, naam) };
      return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : SCHRIJF_REDEN.schrijven };
    }
    if (!res.ok) return { ok: false, reden: schrijfFout(res) };
    const data = st.samen && typeof st.samen === 'object' ? st.samen : res.data, taken = data && Array.isArray(data[w.code]) ? P.takenActief(data[w.code]) : res.taken;
    if (bedoeld && !komtOvereen(taken, w.id, bedoeld)) return { ok: true, opgeslagen: true, tegelijk: tegelijkTekst(taken, w.id, bedoeld, o), data, taken };
    return { ok: true, opgeslagen: true, data };
  };

  // ═══ T6: oude tb:-planblokken omzetten naar een taakbalk ═══════════════════════════════════════════════════════════════════
  // Planblokken die bij een taak horen (taak_id mét dezelfde projectcode, of zonder taak_id een unieke naam in het project: MTPlanning.taakBlokkenVan) kunnen één taakbalk worden: de taak krijgt de persoon van de
  // blokken als eerste persoon en, als hij nog geen eigen datums heeft, de eerste en de laatste blokdag (op werkdagen) als start en eind; een taak met eigen datums houdt die en krijgt alleen de persoon. Meer blokken
  // bij verschillende personen: geweigerd. Pas daarna krijgt elk blok een tombstone, en alleen als het blok sinds het lezen niet is gewijzigd (stempel, dag, persoon, tijd, minuten) en de tombstone ook echt won.
  // Lukt een deel niet, dan staat de taak goed en tellen de resterende blokken gewoon mee (de planblokken van een taak gaan van de raming af): niets dubbel; opnieuw omzetten kan.
  // Het plan voor de blokken van één taak (zuiver). blokken = een blok of een lijst.
  // -> { ok:false, reden } | { ok:true, noop:true, melding, lijst } | { ok:true, lijst, zelfde, start?, eind?, eigenDatums, melding, aantal }
  V.omzetPlan = function (blokken, t, ctx) {
    const P = root.MTPlanning, team = ctx.team || [], lb = (Array.isArray(blokken) ? blokken : [blokken]).filter(Boolean);
    if (!lb.length) return { ok: false, reden: 'Er is geen planblok om om te zetten.' };
    const slugs = lb.map(b => String(P.persoonSlug(b.persoon, team) || '').toLowerCase()), onbekend = lb.find((b, i) => !slugs[i]);
    if (onbekend) return { ok: false, reden: 'De persoon van dit planblok' + (onbekend.persoon ? ' (' + onbekend.persoon + ')' : '') + ' staat niet in het team; er is niets omgezet.' };
    if (new Set(slugs).size > 1) return { ok: false, reden: 'Deze taak heeft blokken bij meerdere personen; pas ze eerst aan. Er is niets omgezet.' };
    const slug = slugs[0], nu = P.taakMensen(t), lijst = P.MEERDERE_PERSONEN ? [slug].concat(nu.filter(p => p !== slug)) : [slug];
    const zelfde = JSON.stringify(lijst) === JSON.stringify(P.MEERDERE_PERSONEN ? nu : nu.slice(0, 1));
    const eigen = isYmd(t.start) && isYmd(t.eind) && t.eind >= t.start, vs = verplichtSet(ctx);
    let start, eind, melding = '';
    if (eigen) melding = 'De taak had al eigen datums (' + dagMnd(t.start) + (t.eind !== t.start ? ' t/m ' + dagMnd(t.eind) : '') + '); die zijn behouden. Alleen de persoon is gezet.';
    else {
      if (lb.some(b => !isYmd(b.datum))) return { ok: false, reden: 'Een planblok heeft geen geldige dag; er is niets omgezet.' };
      const dagen = lb.map(b => b.datum).sort(), eerste = dagen[0], laatste = dagen[dagen.length - 1];
      start = naarBedrijfsdag(eerste, true, vs); eind = naarBedrijfsdag(laatste, false, vs);
      if (!start || !eind) return { ok: false, reden: 'Er is geen werkdag gevonden voor dit planblok; er is niets omgezet.' };
      if (eind < start) eind = start;
      if (start !== eerste || eind !== laatste) melding = 'Een planblok stond niet op een werkdag; de balk staat op ' + dagMnd(start) + (eind !== start ? ' t/m ' + dagMnd(eind) : '') + '.';
    }
    if (zelfde && (eigen || (t.start === start && t.eind === eind))) return { ok: true, noop: true, melding, lijst, aantal: lb.length };
    return Object.assign({ ok: true, lijst, zelfde, eigenDatums: eigen, melding, aantal: lb.length }, eigen ? {} : { start, eind });
  };
  const blokSnap = b => ({ id: b.id, _gewijzigd: b._gewijzigd, datum: b.datum, persoon: b.persoon, start: b.start, duurMin: b.duurMin });
  const blokGelijk = (b, s) => !s || (b._gewijzigd === s._gewijzigd && b.datum === s.datum && String(b.persoon || '') === String(s.persoon || '') && String(b.start || '') === String(s.start || '') && Math.round(Number(b.duurMin) || 0) === Math.round(Number(s.duurMin) || 0));
  // Het blok een tombstone geven (zoals ongedaan maken van een uit Ongepland gesleept blok): zelfde stempel als elke planblok-wijziging. Met snap (wat we eerder lazen) alleen als het blok nog precies zo is.
  // -> { ok:true, alWeg:true } | { ok:true, blokken, wijziging } | { ok:false, gewijzigd:true, reden } | { ok:false, reden }
  V.blokWeg = function (blokId, ctx, snap) {
    if (!ctx || !ctx.mag) return { ok: false, reden: 'Dit mag je niet met jouw rol.' };
    const lijst = Array.isArray(ctx.blokken) ? ctx.blokken : [], b = lijst.find(x => x && String(x.id) === String(blokId));
    if (!b || b._vervallen) return { ok: true, alWeg: true };
    if (!blokGelijk(b, snap)) return { ok: false, gewijzigd: true, reden: 'Het planblok is intussen gewijzigd; controleer het en zet opnieuw om.' };
    const stempel = ctx.stempel || ((x) => { x._gewijzigd = Date.now(); return x; }), ts = new Date(ctx.nu || Date.now()).toISOString(), wie = ctx.wie || '';
    const nieuw = stempel(Object.assign({}, b, { _vervallen: { tijd: ts, door: wie } }), b);
    return { ok: true, blokken: lijst.map(x => x === b ? nieuw : x), wijziging: { soort: 'weg', id: b.id, stempel: nieuw._gewijzigd } };
  };
  const BLOK_WEG_MISLUKT = 'De taak is omgezet, maar een planblok is nog niet verwijderd (SharePoint nam de wijziging niet aan). Het blok telt nog gewoon mee, dus er is niets dubbel. Probeer het opnieuw.';
  const BLOK_GEWIJZIGD = 'De taak is omgezet, maar een planblok is intussen gewijzigd en is blijven staan (het telt nog gewoon mee, dus niets dubbel). Controleer het blok en zet opnieuw om.';
  const TIJD_BLOK = 'Het verwijderen van het planblok duurt erg lang (90 seconden). De taak is omgezet. Zodra SharePoint antwoordt controleer ik of het blok weg is en meld ik dat; tot die tijd is deze taak vergrendeld.';
  const kort = (belofte, ms) => new Promise((ok, nee) => { const h = setTimeout(() => nee(Object.assign(new Error('time-out'), { timeout: 'lezen' })), ms); Promise.resolve(belofte).then(v => { clearTimeout(h); ok(v); }, e => { clearTimeout(h); nee(e); }); });
  // Eén blok weghalen met de tijdgrens van de taakroute: na `hard` geven we het wachten op, maar de echte belofte houdt het slot van de taak vast tot hij klaar is (een belofte die nooit klaarkomt houdt het voor altijd vast).
  // -> { uitslag: 'ok' | 'alWeg' | 'gewijzigd' | 'mislukt' | 'hangt', p?, reden? }
  const wegEen = (o, sleutel, id, snap, opnieuw, hard) => {
    slotMin(sleutel, 1);
    let p; try { p = Promise.resolve(o.blokWeg(id, { snap, opnieuw: !!opnieuw })); } catch (e) { p = Promise.reject(e); }
    const af = () => slotMin(sleutel, -1); p.then(af, af);
    return new Promise(ok => {
      const h = setTimeout(() => ok({ uitslag: 'hangt', p }), hard);
      p.then(w => { clearTimeout(h); ok(w && w.ok ? { uitslag: w.alWeg ? 'alWeg' : 'ok' } : { uitslag: w && w.gewijzigd ? 'gewijzigd' : 'mislukt', reden: w && w.reden }); }, () => { clearTimeout(h); ok({ uitslag: 'mislukt' }); });
    });
  };
  // Na een hangende blok-write: wacht op de echte belofte (het slot blijft zolang staan), lees de planblokken vers en stel vast wat er van de blokken staat.
  const blokUitkomst = async (o, sleutel, p, snaps, hard) => {
    try {
      await p.then(() => 0, () => 0);
      let vers; try { vers = await kort(o.blokken(), hard); } catch (e) { vers = null; }
      if (!vers || !vers.ok || !Array.isArray(vers.blokken)) return { soort: 'onbekend', tekst: 'Ik kon niet vaststellen of het planblok is verwijderd: SharePoint antwoordt niet. De taak is omgezet; ververs de planning en zet zo nodig opnieuw om.' };
      const nog = snaps.filter(s => vers.blokken.some(b => b && String(b.id) === String(s.id) && !b._vervallen));
      if (!nog.length) return { soort: 'opgeslagen', tekst: 'Het planblok is verwijderd: omzetten klaar.' };
      if (nog.some(s => { const b = vers.blokken.find(x => x && String(x.id) === String(s.id) && !x._vervallen); return !blokGelijk(b, s); })) return { soort: 'tegelijk', tekst: 'Iemand wijzigde het planblok tegelijk en het is blijven staan. De taak is omgezet; controleer het blok en zet opnieuw om.' };
      return { soort: 'niet', tekst: 'Het planblok is niet verwijderd. De taak staat goed en het blok telt gewoon mee; zet opnieuw om om het blok te verwijderen.' };
    } finally { slotMin(sleutel, -1); }
  };
  // De blokken één voor één weghalen, elk met zijn eigen snapshot (de controle vlak voor de tombstone staat in o.blokWeg). -> { klaar, gewijzigd, mislukt: [id], alWegN, hangt?: { i, p } }
  const blokStap = async (o, sleutel, snaps, opnieuw, hard) => {
    const klaar = [], gewijzigd = [], mislukt = []; let alWegN = 0;
    for (let i = 0; i < snaps.length; i++) {
      const w = await wegEen(o, sleutel, snaps[i].id, snaps[i], opnieuw, hard);
      if (w.uitslag === 'hangt') return { klaar, gewijzigd, mislukt, alWegN, hangt: { i, p: w.p } };
      if (w.uitslag === 'alWeg') alWegN++;
      (w.uitslag === 'ok' || w.uitslag === 'alWeg' ? klaar : w.uitslag === 'gewijzigd' ? gewijzigd : mislukt).push(snaps[i].id);
    }
    return { klaar, gewijzigd, mislukt, alWegN };
  };
  // Het resultaat voor wat er van de blokken overbleef (gedeeld): hangt (de uitkomst komt later), een rest (gewijzigd of mislukt) of klaar (null).
  const blokRest = (o, sleutel, snaps, st, hard) => {
    const restSnaps = ids => snaps.filter(x => ids.indexOf(x.id) >= 0);
    if (st.hangt) { const rest = snaps.slice(st.hangt.i).map(x => x.id); slotMin(sleutel, 1); return { omgezet: true, blokWeg: false, reden: TIJD_BLOK, melding: TIJD_BLOK, rest, restSnaps: restSnaps(rest), onzeker: blokUitkomst(o, sleutel, st.hangt.p, snaps.slice(st.hangt.i), hard) }; }
    const rest = st.gewijzigd.concat(st.mislukt);
    if (rest.length) return { omgezet: true, blokWeg: false, opnieuw: true, gewijzigd: st.gewijzigd.length > 0, rest, restSnaps: restSnaps(rest), melding: st.gewijzigd.length ? BLOK_GEWIJZIGD : BLOK_WEG_MISLUKT };
    return null;
  };
  // Opruimen (de retry na een gedeeltelijk mislukt omzetten): ALLEEN de resterende blokken met hun oorspronkelijke snapshots. Geen takenSchrijf en geen herberekening van persoon of datums: een intussen
  // handmatig gewijzigde taak blijft onaangeroerd, een nieuw blok blijft staan, en elk blok krijgt dezelfde stempelcontrole voor de tombstone en dezelfde bevestigingsread erna (in o.blokWeg).
  // spec = { taak: {code, id, naam}, resten: [snapshot] }
  V.opruimen = async function (spec, o) {
    const s = spec || {}, tk = s.taak || {}, snaps = (Array.isArray(s.resten) ? s.resten : []).filter(x => x && x.id !== undefined && x.id !== null);
    if (!tk.code || !tk.id || !snaps.length) return { ok: false, reden: 'Onvolledige aanroep.' };
    const ctx0 = o.ctx(); if (!ctx0 || !ctx0.mag) return { ok: false, reden: 'Dit mag je niet met jouw rol.' };
    if (V.taakBezig(tk.code, tk.id)) return { ok: false, bezet: true, reden: BEZET };
    const sleutel = sleutelVan(tk.code, tk.id); slotMin(sleutel, 1);
    try {
      const hard = o.hard || HARD, st = await blokStap(o, sleutel, snaps, true, hard), rest = blokRest(o, sleutel, snaps, st, hard);
      if (rest) return Object.assign({ ok: true }, rest);
      if (st.alWegN === snaps.length) return { ok: true, alOmgezet: true, melding: 'De planblokken waren al verwijderd; er is niets gewijzigd.' };
      return { ok: true, omgezet: true, blokWeg: true, melding: snaps.length > 1 ? 'De planblokken zijn verwijderd.' : 'Het planblok is verwijderd.' };
    } finally { slotMin(sleutel, -1); }
  };
  // spec = { blokId, taak: {code, id, naam}, opnieuw? (alleen of de bevestiging is overgeslagen: de route is dezelfde) }
  // o = { sp, lokaal(), ctx(), nu(), door, dev, projectId, mag(spec), zacht?, hard?, traag?(), naamVan?(door), blokken() -> Promise<{ok, online, blokken, reden?}> (vers),
  //       blokWeg(blokId, { snap, opnieuw }) -> Promise<{ok, alWeg?, gewijzigd?, reden?}> (vers lezen, vergelijken met snap, tombstone, delen en controleren dat die won) }
  // -> { ok:false, reden } | { ok:false, bezet } | { ok:false, onzeker, reden } | { ok:true, alOmgezet, melding }
  //    | { ok:true, omgezet:true, blokWeg:true|false, gewijzigd?, rest?: [blokId], onzeker?, melding, data?, taken? } | { ok:true, tegelijk, data, taken }
  V.omzetten = async function (spec, o) {
    const s = spec || {}, tk = s.taak || {};
    if (!s.blokId || !tk.code || !tk.id) return { ok: false, reden: 'Onvolledige aanroep.' };
    const ctx0 = o.ctx(); if (!ctx0 || !ctx0.mag) return { ok: false, reden: 'Dit mag je niet met jouw rol.' };
    if (V.taakBezig(tk.code, tk.id)) return { ok: false, bezet: true, reden: BEZET };
    const sleutel = sleutelVan(tk.code, tk.id); slotMin(sleutel, 1);   // de hele omzetting is één bewerking op deze taak: geen tweede (slepen, uittrekken, omzetten) ertussen
    try { return await omzetKern(s, o, ctx0, sleutel); } finally { slotMin(sleutel, -1); }
  };
  async function omzetKern(s, o, ctx0, sleutel) {
    const P = root.MTPlanning, code = s.taak.code, id = s.taak.id, naam = s.taak.naam || 'de taak', hard = o.hard || HARD;
    let vers; try { vers = await kort(o.blokken(), hard); } catch (e) { vers = { ok: false, reden: 'SharePoint reageert niet; er is niets omgezet.' }; }
    if (!vers || !vers.ok) return { ok: false, reden: (vers && vers.reden) || 'Er is niets omgezet.' };
    if (vers.online === false) return { ok: false, reden: 'SharePoint is niet bereikbaar; er is niets omgezet.' };
    const blok = (vers.blokken || []).find(b => b && String(b.id) === String(s.blokId) && !b._vervallen);
    if (!blok) { await wegEen(o, sleutel, s.blokId, null, s.opnieuw, hard); return { ok: true, alOmgezet: true, melding: 'Dit planblok is al omgezet of verwijderd; er is niets gewijzigd.' }; }   // (een nog niet gedeelde tombstone wordt alsnog naar SharePoint gebracht)
    const st = maakSt(o, sleutel), sp = tijdSp(o.sp, st); let plan = null, noop = false, bedoeld = null, voor = null, snaps = [], res;
    try {
      res = await P.takenSchrijf(sp, { code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
        const t = werk.find(x => x && x.id === id); if (!t) return { fout: 'Deze taak bestaat niet meer; er is niets omgezet.' };
        if ((t.status || 'todo') === 'klaar') return { fout: 'Een klare taak zet je niet om; er is niets omgezet.' };
        const gekoppeld = P.taakBlokkenVan(t, werk, code, vers.blokken, (o.ctx() || {}).alleTaken);   // alle actieve blokken van deze taak (zelfde project)
        if (!gekoppeld.some(b => String(b.id) === String(s.blokId))) return { fout: 'Dit planblok hoort niet meer ondubbelzinnig bij deze taak (de naam of de koppeling is veranderd); er is niets omgezet.' };
        if (gekoppeld.some(b => b.status === 'voorstel')) return { fout: 'Een open voorstel van de werkplaats zet je niet om; kantoor beslist daar eerst over.' };
        plan = V.omzetPlan(gekoppeld, t, Object.assign({}, o.ctx(), { taken: werk })); if (!plan.ok) return { fout: plan.reden };
        snaps = gekoppeld.map(blokSnap);
        voor = { toegewezen: t.toegewezen || '', lijst: P.taakMensen(t), start: t.start || '', eind: t.eind || '' };
        if (plan.noop) { noop = true; return false; }
        V.pasTaakToe(t, plan, { nu: o.nu(), door: o.door, team: ctx0.team });
        bedoeld = { toegewezen: t.toegewezen || '', lijst: P.taakMensen(t), start: t.start || '', eind: t.eind || '' };
        return werk;
      } });
    } catch (e) {
      if (e && e.timeout === 'schrijven') return { ok: false, reden: TIJD_SCHRIJVEN, onzeker: controleer(o, st, code, id, bedoeld, voor, naam) };
      return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : SCHRIJF_REDEN.schrijven };
    }
    let uit = {};
    if (!noop) {
      if (!res.ok) return { ok: false, reden: schrijfFout(res) };
      const data = st.samen && typeof st.samen === 'object' ? st.samen : res.data, taken = data && Array.isArray(data[code]) ? P.takenActief(data[code]) : res.taken;
      if (!komtOvereen(taken, id, bedoeld)) return { ok: true, opgeslagen: true, tegelijk: tegelijkTekst(taken, id, bedoeld, o), data, taken };   // iemand wijzigde tegelijk en won: de blokken blijven staan
      uit = { data, taken };
    }
    // de taak staat goed: nu de blokken, één voor één, elk met zijn eigen controle (dezelfde functie als de retry)
    const bst = await blokStap(o, sleutel, snaps, s.opnieuw, hard), rest = blokRest(o, sleutel, snaps, bst, hard);
    if (rest) return Object.assign({ ok: true }, rest, uit);
    const alWegN = bst.alWegN;
    const lid = (ctx0.team || []).find(m => m && String(m.slug).toLowerCase() === (plan.lijst[0] || '')), wie = lid ? lid.naam : (plan.lijst[0] || '');
    if (noop && alWegN === snaps.length) return Object.assign({ ok: true, alOmgezet: true, melding: 'Dit planblok was al omgezet; er is niets gewijzigd.' }, uit);
    return Object.assign({ ok: true, omgezet: true, blokWeg: true, opgeslagen: true, aantal: snaps.length,
      melding: noop ? 'Het planblok is verwijderd; de taak stond al goed (' + wie + ').' : 'Omgezet naar een taakbalk: ' + naam + ' → ' + wie + (plan.start ? ', ' + dagMnd(plan.start) + (plan.eind !== plan.start ? ' t/m ' + dagMnd(plan.eind) : '') : '') + (snaps.length > 1 ? ' (' + snaps.length + ' planblokken samengevoegd)' : '') + '.' + (plan.melding ? ' ' + plan.melding : '') }, uit);
  }

  // ═══ Het taakpaneel: de velden van één taak wijzigen (mt-taakpaneel.js) ═══════════════════════════════════════════════════
  // Naam, notities (omschrijving), raming (duur_uur), activiteit, prioriteit, persoon (toegewezen), status en fase (de bucket), via dezelfde schrijfkern (takenSchrijf: vers lezen, ETag, 412 samenvoegen, max 3), hetzelfde
  // slot per taak, dezelfde tijdgrenzen en dezelfde controle achteraf als slepen. Datums gaan hier NIET langs: dat blijft de sleep-spec taakdatums (plaatsTaak, met de vraag over de opvolgers).
  // Geen stil overschrijven: staat er op de verse stand iets anders dan wat de gebruiker zag toen hij begon (`gezien`), dan wordt er niets geschreven en zegt de uitkomst wie het wijzigde.
  // spec = { code, id, naam, velden: { veld: nieuw }, gezien?: { veld: oud zoals getoond }, reden? (verplicht bij status 'wacht') }
  // -> { ok:false, reden } | { ok:false, bezet } | { ok:false, tegelijk:true, reden } | { ok:false, onzeker, reden } | { ok:true, noop:true }
  //    | { ok:true, opgeslagen:true, tegelijk:tekst, data, taken } | { ok:true, opgeslagen:true, behouden:true, data, taken, oudTaak, wijziging }
  V.PANEEL_VELDEN = ['naam', 'omschrijving', 'duur_uur', 'activiteit', 'prioriteit', 'toegewezen', 'status', 'fase'];
  const VELD_LABEL = { naam: 'de naam', omschrijving: 'de notities', duur_uur: 'de raming', activiteit: 'de activiteit', prioriteit: 'de prioriteit', toegewezen: 'de persoon', status: 'de status', fase: 'de fase', wacht_reden: 'de wachtreden', klaar_op: 'de klaardatum' };
  const PRIO_OK = ['high', 'medium', 'low'];
  const veldNorm = (k, v) => k === 'duur_uur' ? String(Math.round((Number(String(v == null ? '' : v).replace(',', '.')) || 0) * 100) / 100) : String(v == null ? '' : v).trim();
  const veldVan = (t, k) => veldNorm(k, k === 'status' ? (t.status || 'todo') : t[k]);
  const geraakt = velden => { const s = new Set(); Object.keys(velden).forEach(k => { s.add(k); if (k === 'status') { s.add('wacht_reden'); s.add('klaar_op'); } }); return [...s]; };
  // Eén veld toepassen (ter plekke). -> '' of de reden waarom het niet kan
  const zetVeld = (t, k, v, spec, opt, team) => {
    const P = root.MTPlanning, w = veldNorm(k, v);
    if (k === 'naam') { if (!w) return 'Een taak heeft een naam nodig.'; t.naam = w.slice(0, 200); return ''; }
    if (k === 'omschrijving') { if (w) t.omschrijving = String(v).replace(/\s+$/, '').slice(0, 4000); else delete t.omschrijving; return ''; }
    if (k === 'duur_uur') { const n = Number(w); if (!isFinite(n) || n < 0 || n > 10000) return 'Geen geldige raming.'; t.duur_uur = n; return ''; }
    if (k === 'activiteit') { if (w && !P.activiteit(w)) return 'Onbekende activiteit.'; if (w) t.activiteit = w; else delete t.activiteit; return ''; }
    if (k === 'fase') { if (w) t.fase = w.slice(0, 80); else delete t.fase; return ''; }   // de bucket: de naam van de fase, zoals het sjabloon hem zet
    if (k === 'prioriteit') { if (w && !PRIO_OK.includes(w)) return 'Onbekende prioriteit.'; if (w) t.prioriteit = w; else delete t.prioriteit; return ''; }
    if (k === 'toegewezen') { if (w && !(team || []).some(m => m && String(m.slug).toLowerCase() === w.toLowerCase())) return 'Onbekende persoon.'; if (w !== String(t.toegewezen || '')) P.toegewezenZet(t, w, opt); return ''; }
    if (k === 'status') { const r = P.statusZet(t, w, { reden: spec.reden || '' }); return r.ok ? '' : r.fout; }
    return 'Dit veld kan hier niet gewijzigd worden.';
  };
  const veldenOvereen = (taken, id, b) => { const t = (taken || []).find(x => x && String(x.id) === String(id)); return !!t && !!b && Object.keys(b).every(k => veldVan(t, k) === b[k]); };
  const veldWie = (t, ks, o) => { let beste = null; ks.forEach(k => { const s = t && t._vs && t._vs[k]; if (s && (!beste || Number(s.t) > Number(beste.t))) beste = s; }); return (beste && beste.door && typeof o.naamVan === 'function' && o.naamVan(beste.door)) || 'Iemand anders'; };
  const veldTegelijk = (taken, id, b, o) => {
    const t = (taken || []).find(x => x && String(x.id) === String(id)); if (!t) return 'Iemand anders verwijderde deze taak tegelijk; jouw wijziging is niet overgenomen.';
    const ks = Object.keys(b || {}).filter(k => veldVan(t, k) !== b[k]);
    return veldWie(t, ks, o) + ' wijzigde ' + (ks.map(k => VELD_LABEL[k] || k).join(' en ') || 'deze taak') + ' tegelijk; jouw wijziging is niet (helemaal) overgenomen.';
  };
  // Na een time-out op het schrijven (zelfde aanpak als uitkomst(), maar dan per veld vergeleken)
  const veldUitkomst = async (o, st, code, id, bedoeld, voor, naam) => {
    const P = root.MTPlanning, bestand = 'mt_project_taken_v2.json';
    try {
      await Promise.all(st.echt);
      let raw; try { raw = await tijdSp(o.sp, maakSt(o, st.sleutel)).read(bestand); } catch (e) { return { soort: 'onbekend', tekst: 'Ik kon niet vaststellen of het opslaan van "' + naam + '" gelukt is: SharePoint antwoordt niet. Open de taak opnieuw om te zien hoe hij er nu bij staat.' }; }
      let samen, data; try { samen = P.takenSamen(null, raw); data = P.takenSamen(o.lokaal(), raw); } catch (e) { return { soort: 'onbekend', tekst: 'Ik kon niet vaststellen of het opslaan van "' + naam + '" gelukt is: de takenlijst heeft een onverwachte vorm.' }; }
      const taken = P.takenActief(Array.isArray(samen[code]) ? samen[code] : []);
      if (bedoeld && veldenOvereen(taken, id, bedoeld)) return { soort: 'opgeslagen', tekst: 'Opgeslagen: ' + naam + '.', data };
      if (voor && veldenOvereen(taken, id, voor)) return { soort: 'niet', tekst: 'Niet opgeslagen: ' + naam + ' staat nog zoals voorheen. Probeer het opnieuw.', data };
      return { soort: 'tegelijk', tekst: veldTegelijk(taken, id, bedoeld || {}, o), data };
    } finally { slotMin(st.sleutel, -1); }
  };
  const veldControleer = (o, st, code, id, bedoeld, voor, naam) => { slotMin(st.sleutel, 1); return veldUitkomst(o, st, code, id, bedoeld, voor, naam); };
  V.taakWijzig = async function (spec, o) {
    const P = root.MTPlanning, s = spec || {}, code = s.code, id = s.id, velden = s.velden && typeof s.velden === 'object' ? s.velden : null;
    if (!code || id == null || !velden || !Object.keys(velden).length) return { ok: false, reden: 'Onvolledige aanroep.' };
    if (Object.keys(velden).some(k => !V.PANEEL_VELDEN.includes(k))) return { ok: false, reden: 'Dit veld kan hier niet gewijzigd worden.' };
    if (Object.keys(velden).some(k => !s.gezien || !Object.prototype.hasOwnProperty.call(s.gezien, k))) return { ok: false, reden: 'Onvolledige aanroep: zonder de getoonde waarde kan ik niet controleren of iemand anders het intussen wijzigde.' };   // geen stil overschrijven: de conflictbewaking is verplicht
    if (V.taakBezig(code, id)) return { ok: false, bezet: true, reden: BEZET };
    const st = maakSt(o, sleutelVan(code, id)), naam = s.naam || 'de taak', team = (o.ctx() || {}).team || [];
    let noop = false, anders = '', bedoeld = null, voorN = null, voorRuw = null, oudTaak = null, ks = [], res;
    try {
      res = await P.takenSchrijf(tijdSp(o.sp, st), { code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
        const t = werk.find(x => x && String(x.id) === String(id)); if (!t) return { fout: 'Deze taak bestaat niet meer; er is niets gewijzigd.' };
        // iemand anders was eerder (op de verse stand staat iets anders dan wat de gebruiker zag): niets schrijven
        const alle = geraakt(velden), afw = Object.keys(s.gezien || {}).filter(k => alle.includes(k) && veldVan(t, k) !== veldNorm(k, s.gezien[k]));   // bij de status tellen de wachtreden en de klaardatum mee
        if (afw.length) { anders = veldWie(t, afw, o) + ' wijzigde ' + afw.map(k => VELD_LABEL[k] || k).join(' en ') + ' intussen; jouw wijziging is niet opgeslagen. Je ziet nu de nieuwe stand.'; return false; }
        ks = geraakt(velden);
        const zelfdeReden = velden.status !== 'wacht' || String(t.wacht_reden || '') === String(s.reden || '').replace(/\s+/g, ' ').trim();
        if (Object.keys(velden).every(k => veldVan(t, k) === veldNorm(k, velden[k])) && zelfdeReden) { noop = true; return false; }
        oudTaak = JSON.parse(JSON.stringify(t));
        voorRuw = {}; ks.forEach(k => { voorRuw[k] = t[k] === undefined ? null : JSON.parse(JSON.stringify(t[k])); });
        voorN = {}; ks.forEach(k => { voorN[k] = veldVan(t, k); });
        for (const k of Object.keys(velden)) { const f = zetVeld(t, k, velden[k], s, { nu: o.nu(), door: o.door, team }, team); if (f) return { fout: f }; }
        bedoeld = {}; ks.forEach(k => { bedoeld[k] = veldVan(t, k); });   // ook de meebewegende velden (wachtreden, klaardatum) worden achteraf gecontroleerd
        return werk;
      } });
    } catch (e) {
      if (e && e.timeout === 'schrijven') return { ok: false, reden: TIJD_SCHRIJVEN, onzeker: veldControleer(o, st, code, id, bedoeld, voorN, naam) };
      return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : SCHRIJF_REDEN.schrijven };
    }
    if (anders) return { ok: false, tegelijk: true, reden: anders };
    if (noop) return { ok: true, noop: true };
    if (!res.ok) return { ok: false, reden: schrijfFout(res) };
    const data = st.samen && typeof st.samen === 'object' ? st.samen : res.data, taken = data && Array.isArray(data[code]) ? P.takenActief(data[code]) : res.taken;
    if (!veldenOvereen(taken, id, bedoeld)) return { ok: true, opgeslagen: true, tegelijk: veldTegelijk(taken, id, bedoeld, o), data, taken };
    const na = taken.find(x => String(x.id) === String(id)) || {};
    return { ok: true, opgeslagen: true, behouden: true, data, taken, oudTaak,
      wijziging: { soort: 'velden', code, id, naam: na.naam || naam, velden: ks, voor: voorRuw, voorN, na: bedoeld, stempels: stempelsVan(na, ks), personenNa: personenStand(na) } };
  };
  // Ongedaan maken van taakWijzig: alleen als niemand de geraakte velden sindsdien wijzigde (dezelfde stempels, dezelfde personen); zet de oude waarden precies terug.
  V.taakWijzigHerstel = async function (w, o) {
    const P = root.MTPlanning; if (!w || w.soort !== 'velden' || !w.voor) return { ok: false, reden: 'Er is niets om ongedaan te maken.' };
    if (V.taakBezig(w.code, w.id)) return { ok: false, bezet: true, reden: BEZET };
    const st = maakSt(o, sleutelVan(w.code, w.id)), naam = w.naam || 'de taak', team = (o.ctx() || {}).team || []; let bedoeld = null, res;
    try {
      res = await P.takenSchrijf(tijdSp(o.sp, st), { code: w.code, lokaal: o.lokaal(), nu: o.nu(), door: o.door, dev: o.dev, projectId: o.projectId, mag: o.mag, muteer: werk => {
        const t = werk.find(x => x && String(x.id) === String(w.id)); if (!t) return { fout: 'Deze taak bestaat niet meer; niets teruggezet.' };
        const zelfde = Object.keys(w.stempels || {}).every(k => (Number(t._vs && t._vs[k] && t._vs[k].t) || 0) === w.stempels[k]);
        if (!zelfde || !gelijkStand(personenStand(t), w.personenNa || {})) return { fout: 'Deze taak is intussen door iemand anders gewijzigd; niet teruggezet.' };
        Object.keys(w.voor).forEach(k => {
          if (k === 'toegewezen') { const oud = String(w.voor[k] || ''); if (oud !== String(t.toegewezen || '')) P.toegewezenZet(t, oud, { nu: o.nu(), door: o.door, team }); return; }
          if (w.voor[k] === null) delete t[k]; else t[k] = JSON.parse(JSON.stringify(w.voor[k]));
        });
        bedoeld = {}; (w.velden || []).forEach(k => { bedoeld[k] = veldVan(t, k); });
        return werk;
      } });
    } catch (e) {
      if (e && e.timeout === 'schrijven') return { ok: false, reden: TIJD_SCHRIJVEN, onzeker: veldControleer(o, st, w.code, w.id, bedoeld, w.na, naam) };
      return { ok: false, reden: e && e.timeout === 'lezen' ? TIJD_LEZEN : SCHRIJF_REDEN.schrijven };
    }
    if (!res.ok) return { ok: false, reden: schrijfFout(res) };
    const data = st.samen && typeof st.samen === 'object' ? st.samen : res.data, taken = data && Array.isArray(data[w.code]) ? P.takenActief(data[w.code]) : res.taken;
    if (bedoeld && !veldenOvereen(taken, w.id, bedoeld)) return { ok: true, opgeslagen: true, tegelijk: veldTegelijk(taken, w.id, bedoeld, o), data, taken };
    return { ok: true, opgeslagen: true, data };
  };

  root.MTPlanVerplaats = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
