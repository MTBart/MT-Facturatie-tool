/* ============================================================================
 * mt-takenbak.js: de takenbak naast de Capaciteit (C3): de rechterkolom die niet alleen "Ongepland" toont maar filterbaar is op klant, project, fase, activiteit, persoon en tekst
 * ----------------------------------------------------------------------------
 * Alleen rekenwerk, geen DOM, geen opslag (te testen met node). De tekening staat in mt-capaciteit-nieuw.js (zijkolom); die geeft de taken, afhankelijkheden, blokken en regels mee.
 * Een kaart is een open taak (niet klaar) met wat de bak nodig heeft om te filteren en te groeperen. Vijf lijsten: Ongepland (standaard, precies de lijst van de Capaciteit), Alles open,
 * Te laat, Wacht en Deze week. De stand (lijst, filters, groepering) is een gewoon object dat in de link en in de browser bewaard wordt (codeer/decodeer).
 * ========================================================================== */
(function (root) {
  'use strict';
  const TB = {};
  const P = () => root.MTPlanning;
  const laag = s => String(s == null ? '' : s).trim().toLowerCase();
  TB.MODI = [['ongepland', 'Ongepland'], ['alles', 'Alles open'], ['telaat', 'Te laat'], ['wacht', 'Wacht'], ['week', 'Deze week']];
  TB.GROEPEN = [['', 'Niet groeperen'], ['project', 'Project'], ['klant', 'Klant'], ['fase', 'Fase'], ['act', 'Activiteit']];
  TB.standaard = () => ({ modus: 'ongepland', klant: '', project: '', fase: '', act: '', wie: '', q: '', groep: '' });
  TB.sleutel = (code, id) => laag(code) + '\u0001' + String(id);
  const maandag = ymd => { const [y, m, d] = ymd.split('-').map(Number), n = Math.round(Date.UTC(y, m - 1, d) / 864e5), w = ((n + 4) % 7 + 7) % 7, ma = n - ((w + 6) % 7); const f = k => new Date((ma + k) * 864e5).toISOString().slice(0, 10); return { van: f(0), tot: f(6) }; };
  const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  // De open taken als kaarten. o = { team, vrij, vandaag, project(code) -> { naam, label, klant } }
  TB.items = function (takenObj, afhankObj, blokken, o) {
    o = o || {}; const p = P(), team = o.team || [], vandaag = isYmd(o.vandaag) ? o.vandaag : p.vandaagYmd(), wk = maandag(vandaag), uit = [];
    const bl = (Array.isArray(blokken) ? blokken : []).filter(b => b && !b._vervallen && isYmd(b.datum));
    Object.keys(takenObj || {}).sort().forEach(code => {
      if (code.startsWith('__') || !Array.isArray(takenObj[code])) return;
      const lijst = p.takenActief(takenObj[code]); if (!lijst.length) return;
      const info = (o.project && o.project(code)) || {}, wacht = p.wachtOverzicht(lijst, afhankObj && afhankObj[code], { vrij: o.vrij, vandaag });
      lijst.forEach(t => {
        const st = t.status || 'todo'; if (st === 'klaar') return;
        const w = wacht[t.id] || { wacht: false, op: [] }, blokken1 = p.taakBlokkenVan(t, lijst, code, bl, null).filter(b => b.status !== 'voorstel');
        const start = isYmd(t.start) ? t.start : '', eind = isYmd(t.eind) ? t.eind : '', s0 = start || eind, e0 = eind || start;
        const blDat = blokken1.map(b => b.datum).sort(), heeftDatum = !!s0, heeftBlok = blokken1.length > 0;
        const van = heeftDatum ? s0 : (blDat[0] || ''), tot = heeftDatum ? e0 : (blDat[blDat.length - 1] || '');
        const mensen = []; p.taakMensen(t).forEach(m => { const s = laag(p.persoonSlug(m, team) || m); if (s && !mensen.includes(s)) mensen.push(s); });
        uit.push({ code, id: t.id, naam: t.naam || '(zonder naam)', status: st, wacht: st === 'wacht' || (st === 'todo' && !!w.wacht), wachtTekst: p.wachtOpTekst ? p.wachtOpTekst(w) : '', voorstel: !!t.voorstel, mijlpaal: t.soort === 'mijlpaal',
          min: p.taakRamingMin(t), start: van, eind: tot, heeftDatum, heeftBlok, gepland: heeftDatum || heeftBlok, mensen, activiteit: laag(t.activiteit), fase: String(t.fase || '').trim(),
          klant: String(info.klant || '').trim(), projectNaam: String(info.naam || ''), projectLabel: String(info.label || code),
          teLaat: !!tot && tot < vandaag, dezeWeek: !!van && van <= wk.tot && tot >= wk.van });
      });
    });
    return uit;
  };
  // Hoort deze kaart bij de gekozen lijst? ong = de sleutels van de Ongepland-lijst van de Capaciteit (die lijst blijft precies zoals hij was)
  TB.inModus = (it, modus, ong) => modus === 'alles' ? true : modus === 'telaat' ? it.teLaat : modus === 'wacht' ? it.wacht : modus === 'week' ? it.dezeWeek : !!(ong && ong.has(TB.sleutel(it.code, it.id)));
  // Filters (EN): klant, project, fase, activiteit, persoon en tekst; leeg = alles. De bovenste filterbalk (project, persoon) rekent de aanroeper er al uit.
  TB.filter = function (items, f) {
    f = Object.assign(TB.standaard(), f || {}); const q = laag(f.q);
    return items.filter(it => (!f.klant || laag(it.klant) === laag(f.klant)) && (!f.project || laag(it.code) === laag(f.project)) && (!f.fase || (f.fase === '-' ? !it.fase : laag(it.fase) === laag(f.fase))) && (!f.act || laag(it.activiteit) === laag(f.act))
      && (!f.wie || (f.wie === '-' ? !it.mensen.length : it.mensen.includes(laag(f.wie)))) && (!q || laag([it.naam, it.projectLabel, it.projectNaam, it.klant, it.fase, it.activiteit].join(' ')).includes(q)));
  };
  TB.aantalFilters = f => { f = f || {}; return ['klant', 'project', 'fase', 'act', 'wie', 'q'].filter(k => String(f[k] || '').trim() !== '').length; };
  // De waarden voor de keuzelijsten, uit de kaarten van de gekozen lijst (zodat er geen lege keuze in staat)
  TB.opties = function (items) {
    const uniek = fn => [...new Map(items.map(fn).filter(x => x && x[0]).map(x => [laag(x[0]), x])).values()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    return { klant: uniek(it => [it.klant, it.klant]), project: uniek(it => [it.code, it.projectLabel]), fase: uniek(it => [it.fase, it.fase]), act: uniek(it => [it.activiteit, it.activiteit]), wie: uniek(it => null).concat([...new Set([].concat(...items.map(it => it.mensen)))].sort().map(s => [s, s])) };
  };
  // Groeperen: per project, klant, fase of activiteit; per groep het aantal en de uren. Zonder groepering één groep met sleutel ''.
  TB.groepeer = function (items, groep) {
    if (!groep) return [{ k: '', label: '', items, min: items.reduce((s, x) => s + x.min, 0) }];
    const sl = it => groep === 'project' ? [it.code, it.projectLabel] : groep === 'klant' ? [it.klant || '', it.klant || 'Zonder klant'] : groep === 'fase' ? [it.fase || '', it.fase || 'Zonder fase'] : [it.activiteit || '', it.activiteit ? it.activiteit.charAt(0).toUpperCase() + it.activiteit.slice(1) : 'Zonder activiteit'];
    const m = new Map(); items.forEach(it => { const [k, l] = sl(it), kk = laag(k); if (!m.has(kk)) m.set(kk, { k: kk, label: l, items: [], min: 0 }); const g = m.get(kk); g.items.push(it); g.min += it.min; });
    return [...m.values()].sort((a, b) => (a.k === '' ? 1 : 0) - (b.k === '' ? 1 : 0) || String(a.label).localeCompare(String(b.label)));
  };
  // De volgorde: een voorstel eerst, dan op datum (taken zonder datum achteraan), dan project en naam
  TB.sorteer = items => items.slice().sort((a, b) => (b.voorstel - a.voorstel) || ((a.start || '9999') < (b.start || '9999') ? -1 : (a.start || '9999') > (b.start || '9999') ? 1 : 0) || (laag(a.code) < laag(b.code) ? -1 : laag(a.code) > laag(b.code) ? 1 : 0) || (a.naam < b.naam ? -1 : a.naam > b.naam ? 1 : 0));
  // De stand in de link ('bak' = de lijst, 'bf' = de filters en de groepering) en terug. Alleen geldige waarden; een onbekend filter valt weg.
  TB.codeer = function (st) {
    st = Object.assign(TB.standaard(), st || {}); const e = encodeURIComponent, delen = [];
    [['klant', 'k'], ['project', 'p'], ['fase', 'f'], ['act', 'a'], ['wie', 'w'], ['q', 'q'], ['groep', 'g']].forEach(([k, c]) => { const v = String(st[k] || '').trim().slice(0, 80); if (v) delen.push(c + '~' + e(v)); });
    return { bak: st.modus && st.modus !== 'ongepland' && TB.MODI.some(x => x[0] === st.modus) ? st.modus : '', bf: delen.join(';') };
  };
  TB.decodeer = function (bak, bf) {
    const st = TB.standaard(); if (TB.MODI.some(x => x[0] === bak)) st.modus = bak;
    const naam = { k: 'klant', p: 'project', f: 'fase', a: 'act', w: 'wie', q: 'q', g: 'groep' };
    String(bf || '').split(';').forEach(d => { const i = d.indexOf('~'); if (i < 1 || !naam[d.slice(0, i)]) return; let v; try { v = decodeURIComponent(d.slice(i + 1)); } catch (x) { return; } v = v.trim().slice(0, 80); if (!v) return; if (naam[d.slice(0, i)] === 'groep' && !TB.GROEPEN.some(x => x[0] === v)) return; st[naam[d.slice(0, i)]] = v; });
    return st;
  };
  TB.geldigBak = v => TB.MODI.some(x => x[0] === v) ? v : '';
  TB.geldigBf = v => { const s = String(v == null ? '' : v); return s.length <= 700 && /^[\w~;%.\-*()!'+]*$/.test(s) ? s : ''; };

  root.MTTakenbak = TB;
  if (typeof module !== 'undefined' && module.exports) module.exports = TB;
})(typeof window !== 'undefined' ? window : globalThis);
