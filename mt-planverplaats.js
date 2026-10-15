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
 *  - een open voorstel wordt door kantoor beslist en wordt niet versleept; niet naar een dag waarop de persoon verlof heeft of volgens zijn werktijden niet werkt; niet naar een
 *    verplichte vrije dag; niet naar een weekend;
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
    if (!lid) return 'Onbekende persoon.';
    if (!isYmd(spec.datum)) return 'Ongeldige dag.';
    const w = dow(spec.datum); if (w === 0 || w === 6) return 'Dit is een weekend: plannen op die dag kan niet.';
    const v = (ctx.verlof || []).find(x => x && gelijkAan(x.persoon, lid.slug, team) && spec.datum >= x.van && spec.datum <= x.tm);
    if (v) return lid.naam + ' heeft verlof op ' + spec.datum + '.';
    // Werktijden (Admin > Team en werktijden): werkt deze persoon op die weekdag volgens zijn rooster niet, dan geldt het als verlof. Zonder record van die persoon: niets (zoals voorheen).
    const P = root.MTPlanning, rec = P && P.werktijdenMap && ctx.werktijden ? P.werktijdenMap(ctx.werktijden)[String(lid.slug).toLowerCase()] : null;
    if (rec && P.werktijdDagMin(rec, (w + 6) % 7) <= 0) return lid.naam + ' werkt volgens de werktijden niet op ' + spec.datum + '.';
    const vd = (ctx.vrijedagen || []).find(x => x && x.datum === spec.datum);
    if (vd && vd.type === 'verplicht') return 'Verplichte vrije dag: plannen geblokkeerd.';
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
    } else return 'Onbekende actie.';
    return '';
  };

  // → { ok, reden } | { ok:true, noop:true } | { ok:true, blokken, wijziging }
  // Het gevraagde dagdeel: ochtend 08:00-12:00, middag 13:00-17:00 (zie V.eerstePlek voor wat er gebeurt als het blok er niet in past)
  const dagdeelStart = (lijst, spec, duur, negeerId, team) => spec.dagdeel === 1 ? V.eerstePlek(lijst, spec.persoon, spec.datum, 13 * 60, 17 * 60, duur, negeerId, team) : V.eerstePlek(lijst, spec.persoon, spec.datum, 8 * 60, 12 * 60, duur, negeerId, team);
  // Een planblok uit Ongepland heeft een vast id uit project en taak: twee apparaten die dezelfde taak tegelijk inplannen maken dus hetzelfde record, en de samenvoeger
  // (per id, nieuwste stempel wint) maakt er één blok van in plaats van twee.
  V.blokIdVoorTaak = (code, taakId) => 'tb:' + String(code == null ? '' : code).trim().toLowerCase() + ':' + String(taakId == null ? '' : taakId);
  V.pas = function (spec, ctx) {
    const reden = V.controle(spec, ctx); if (reden) return { ok: false, reden };
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

  root.MTPlanVerplaats = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
