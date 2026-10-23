/* ============================================================================
 * mt-calcopslag.js — veilige opslag van de calculaties (mt_calc_offertes.json)
 * ----------------------------------------------------------------------------
 * Waarom (plan 21-10, F1/F2/F3): de calculatie hield alle offertes in het geheugen
 * van het tabblad en schreef bij elke wijziging de héle lijst naar SharePoint, met
 * een geldige ETag. Stond het tabblad lang open, dan zette het zo oudere offertes
 * over nieuwere heen, zonder 412 en zonder melding.
 *
 * Nu geldt voor élke schrijfactie (automatisch én de Opslaan-knop):
 *   vers lezen → per offerte samenvoegen → schrijven met de ETag van die lezing.
 * Eén schrijfrij: er loopt nooit meer dan één cyclus tegelijk; verzoeken die binnenkomen
 * terwijl er al één wacht, liften mee.
 *
 * Samenvoegen per offerte (geen samenvoeging per veld, geen stille "nieuwste stempel wint"):
 *   - basis  = de versie (hash) die dit tabblad als laatste van SharePoint kende;
 *   - vuil   = dit apparaat heeft de offerte sinds die basis gewijzigd (met de basis van toen);
 *   - schoon lokaal              → SharePoint wint;
 *   - vuil, SharePoint ongewijzigd → lokaal wint;
 *   - vuil én SharePoint gewijzigd → conflict: lokaal blijft (behalve bij een instorting) en de
 *     andere versie wordt duurzaam bewaard in `_conflicten` (begrensd), met een melding.
 * Een offerte die maar aan één kant bestaat, blijft altijd staan. De lijst wordt nooit kleiner.
 * Klokken van pc's tellen niet mee in de keuze (alleen bij de allereerste keer, zie eersteKeer).
 *
 * Deze motor is zuiver: geen DOM, geen fetch. v2.html geeft lees/schrijf/opslag mee.
 * ========================================================================== */
(function (root) {
  'use strict';
  const UIT_HASH = new Set(['_conflicten', '_verdrongen', '_gewijzigd', '_door']);
  const MAX_KOPIEEN = 5, MAX_BYTES = 300000, MAX_GESCHIEDENIS = 12;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

  // Stabiele JSON (sleutels gesorteerd), zodat dezelfde inhoud op elk apparaat dezelfde hash geeft.
  // Volgt JSON.stringify: undefined/functie in een lijst (ook een gat) = null, in een object = weg.
  const geenJson = v => v === undefined || typeof v === 'function' || typeof v === 'symbol';
  function canon(v) {
    if (geenJson(v)) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (typeof v.toJSON === 'function') return canon(v.toJSON());
    if (Array.isArray(v)) return '[' + Array.from(v, canon).join(',') + ']';
    return '{' + Object.keys(v).filter(k => !geenJson(v[k])).sort()
      .map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  function h32(s, seed) {                                  // FNV-1a, twee zaden = 64 bit
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }
  // Inhoud van een offerte, zonder de boekhouding eromheen (stempel, kopieën).
  function hash(o) {
    if (!isObj(o)) return 'x';
    const r = {}; Object.keys(o).forEach(k => { if (!UIT_HASH.has(k)) r[k] = o[k]; });
    const s = canon(r);
    return h32(s, 2166136261) + h32(s, 33554467) + s.length.toString(36);
  }
  // Inhoud plus stempel: om exact dezelfde (oude) versie te herkennen.
  const vol = o => hash(o) + '|' + String((o && o._gewijzigd) || '');
  const kloon = o => JSON.parse(JSON.stringify(o));
  // Dezelfde maat als de oude samenvoeger en de projectmap: regels met een omschrijving.
  const gevuld = o => ['materiaal', 'uren'].reduce((n, v) =>
    n + ((o && Array.isArray(o[v])) ? o[v] : []).filter(r => String((r && r.omschrijving) || '').trim()).length, 0);
  const instorting = (nieuw, oud) => gevuld(oud) >= 3 && gevuld(nieuw) * 2 < gevuld(oud);

  // Een bewaarde versie: zonder kopieën in kopieën en zonder de mailtekst (die staat in Outlook).
  function kaal(o) {
    const x = kloon(o); delete x._conflicten; delete x._verdrongen;
    if (isObj(x.mail_context)) delete x.mail_context.body_html;
    return x;
  }
  function kopie(o, info) {
    let off = kaal(o);
    if (JSON.stringify(off).length > MAX_BYTES / 2) {       // uitzonderlijk groot: alleen de kern bewaren
      off = { titel: off.titel, project_code: off.project_code, meta: off.meta, materiaal: off.materiaal, uren: off.uren, _ingekort_bewaard: true };
    }
    return Object.assign({ id: 'k' + hash(o), tijd: info.tijd || '', bron: info.bron || '', reden: info.reden || '',
      door: info.door || '', gevuld: gevuld(o), gezien: !!info.gezien }, { offerte: off });
  }
  // Kopieën van beide kanten samen: per id één, "gezien" blijft gezien; begrensd in aantal én bytes
  // (eerst de geziene, dan de oudste vallen af; de nieuwste blijft altijd).
  function lijstenSamen() {
    const per = new Map();
    for (const l of arguments) (Array.isArray(l) ? l : []).forEach(c => {
      if (!isObj(c) || !c.id) return;
      const o = per.get(c.id);
      per.set(c.id, o ? Object.assign({}, o, { gezien: !!(o.gezien || c.gezien) }) : c);
    });
    let uit = [...per.values()].sort((a, b) => String(a.tijd).localeCompare(String(b.tijd)) || String(a.id).localeCompare(String(b.id)));
    const weg = () => { const i = uit.findIndex(c => c.gezien); uit.splice(i >= 0 && i < uit.length - 1 ? i : 0, 1); };
    while (uit.length > MAX_KOPIEEN) weg();
    while (uit.length > 1 && JSON.stringify(uit).length > MAX_BYTES) weg();
    return uit;
  }

  // L/R = { sleutel: offerte } (lokaal / SharePoint). opt = { vuil, basis, gezien, eersteKeer, tijd, door }.
  // → { offertes, uitkomst: {k: …}, nieuw: [sleutels met een nieuwe kopie] }
  function samen(L, R, opt) {
    opt = opt || {}; L = isObj(L) ? L : {}; R = isObj(R) ? R : {};
    const vuil = opt.vuil || {}, basis = opt.basis || {}, gezien = opt.gezien || {};
    const info = (bron, reden) => ({ bron, reden, tijd: opt.tijd || '', door: opt.door || '' });
    const offertes = {}, uitkomst = {}, nieuw = [];
    for (const k of new Set([...Object.keys(R), ...Object.keys(L)])) {
      const a = L[k], b = R[k];
      if (!isObj(b)) { if (isObj(a)) { offertes[k] = a; uitkomst[k] = 'lokaal-nieuw'; } continue; }
      if (!isObj(a)) { offertes[k] = b; uitkomst[k] = 'remote'; continue; }
      const ha = hash(a), hb = hash(b);
      const lijst = lijstenSamen(a._conflicten, b._conflicten), verdr = b._verdrongen || a._verdrongen;
      const met = (o, extra) => {
        const x = Object.assign({}, o), l = extra ? lijstenSamen(lijst, [extra]) : lijst;
        if (l.length) x._conflicten = l; else delete x._conflicten;
        if (verdr && !x._verdrongen) x._verdrongen = verdr;
        return x;
      };
      if (ha === hb) { offertes[k] = met(b); uitkomst[k] = 'gelijk'; continue; }
      const d = vuil[k];
      let lokaalGewijzigd = !!d && (d.basis == null || ha !== d.basis), basisVanD = d ? d.basis : null;
      // Allereerste keer met deze versie (nog geen boekhouding): een lokaal nieuwere stempel is
      // waarschijnlijk werk dat nog niet gedeeld was → als gewijzigd met onbekende basis behandelen.
      if (!d && opt.eersteKeer && String(a._gewijzigd || '') > String(b._gewijzigd || '')) { lokaalGewijzigd = true; basisVanD = null; }
      if (!lokaalGewijzigd) {
        const kende = basis[k] === ha;                    // lokaal = de laatst bekende SharePoint-versie
        // SharePoint viel terug naar exact een oudere versie die wij al hadden (inhoud én stempel: een oude client die zijn oude lijst
        // terugschrijft). Iemand die bewust iets terugdraait, schrijft een nieuwe stempel en valt hier dus niet onder.
        if (kende && (gezien[k] || []).includes(vol(b))) {
          offertes[k] = met(a, kopie(b, info('elders', 'oudere versie'))); uitkomst[k] = 'terugval'; nieuw.push(k);
        } else if (kende && instorting(b, a)) {           // sterk ingekort: dat mag, maar onze volle versie blijft bewaard
          offertes[k] = met(b, kopie(a, info('deze pc', 'ingekort'))); uitkomst[k] = 'krimp'; nieuw.push(k);
        } else if (kende && String(b._gewijzigd || '') < String(a._gewijzigd || '')) {
          // De nieuwe versie op SharePoint heeft een óudere stempel dan wat wij kenden: een oude client die een oude stand
          // terugschrijft, of een pc met een achterlopende klok. Niet te onderscheiden → overnemen, maar onze versie bewaren en melden.
          offertes[k] = met(b, kopie(a, info('deze pc', 'oudere stempel'))); uitkomst[k] = 'krimp'; nieuw.push(k);
        } else if (opt.eersteKeer) {
          // Allereerste keer: een afwijkende lokale versie gaat nooit stil weg. Bewaard (als gezien: meestal is het
          // gewoon een verouderde kopie), terug te vinden bij de versies van deze offerte.
          offertes[k] = met(b, Object.assign(kopie(a, info('deze pc', 'eerste keer')), { gezien: true })); uitkomst[k] = 'krimp';
        } else { offertes[k] = met(b); uitkomst[k] = 'remote'; }
        continue;
      }
      const remoteGewijzigd = basisVanD == null || hb !== basisVanD;
      if (!remoteGewijzigd) { offertes[k] = met(a); uitkomst[k] = 'lokaal'; continue; }
      if (instorting(a, b)) { offertes[k] = met(b, kopie(a, info('deze pc', 'gelijktijdig'))); uitkomst[k] = 'conflict-remote'; }
      else { offertes[k] = met(a, kopie(b, info('elders', 'gelijktijdig'))); uitkomst[k] = 'conflict-lokaal'; }
      nieuw.push(k);
    }
    return { offertes, uitkomst, nieuw };
  }

  /* ── De motor ───────────────────────────────────────────────────────────────
   * cfg = {
   *   lees():  Promise<{status:200|404, data, etag}>   (gooit bij een fout)
   *   schrijf(body, etag|null): Promise<{status, ok, etag}>   (etag null = alleen aanmaken)
   *   offertes(): het live object { sleutel: offerte }
   *   bewaarOffertes(): cachePayload() naar localStorage (zonder SharePoint)
   *   lsLees(), lsZet(tekst): de eigen boekhouding (per pc, gedeeld door de tabbladen)
   *   lsLeesOffertes(): de gedeelde lokale kopie (mt_calc_offertes) zoals hij nu in localStorage staat
   *   lsSleutels(voorvoegsel), lsLeesSleutel(k), lsZetSleutel(k, tekst), lsWisSleutel(k): concepten per tabblad
   *   nu(), door(), timeoutMs, opStatus(), opWijziging({vervangen, conflicten}), opSync({ok, reden})
   * } */
  const CONCEPT = 'mt_calc_concept_';   // + tabblad-id: de niet-gedeelde offertes van dat tabblad (herstelbaar na een crash)
  function maak(cfg) {
    const nu = cfg.nu || (() => Date.now());
    const iso = () => new Date(nu()).toISOString();
    const TIMEOUT = cfg.timeoutMs || 20000;
    // dit tabblad; v2 bewaart het id in sessionStorage, zodat het na herladen hetzelfde tabblad blijft
    const TAB = cfg.tabId || ('t' + nu().toString(36) + Math.random().toString(36).slice(2, 8));
    const LEVEND_MS = 120000;
    // Hartslag: zolang dit tabblad niet-gedeeld werk heeft, het concept elke 30 s verversen (zo weten andere tabbladen dat het leeft).
    const hart = setInterval(() => { if (Object.keys(S.vuil).length) bewaarConcept(); }, 30000);
    if (hart && typeof hart.unref === 'function') hart.unref();
    const S = { vuil: {}, basis: {}, gezien: {}, gen: {}, gedeeldOm: {}, teSchrijven: new Set(), dicht: null, fout: null, bezig: false, eersteKeer: false, geladen: false };
    const leesJson = f => { try { const t = f && f(); return t ? JSON.parse(t) : null; } catch (e) { return null; } };
    const tik = f => { try { f && f(); } catch (e) { if (root.console) console.warn('calcopslag:', e); } };
    const status = () => tik(cfg.opStatus);
    const metTijd = (p, wat) => new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('SharePoint reageert niet (' + wat + ' duurde langer dan ' + Math.round(TIMEOUT / 1000) + ' s)')), TIMEOUT);
      Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
    });
    const reden = e => String((e && e.message) || e || 'onbekende fout');
    // De boekhouding is gedeeld door de tabbladen van deze browser en staat per tabblad: { perTab: { tab: { offerte: record } } }.
    // Een tabblad schrijft alleen zijn eigen deel; records van andere tabbladen blijven staan (ook voor dezelfde offerte).
    // Records van een verdwenen tabblad neemt het eerstvolgende tabblad over dat laadt of schrijft.
    const overgenomen = new Set();      // verdwenen tabbladen waarvan dit tabblad het werk heeft overgenomen
    // Overgenomen, tenzij dat tabblad intussen weer leeft (uit de slaapstand terug): dan is zijn deel weer van hem.
    // Wat we van zo'n tabblad overnamen en zelf niet verder bewerkten, geven we dan terug.
    const vanTab = {};                  // offerte -> { tabs: [..], gen } : overgenomen van die tabbladen, bij die bewerkingsteller
    const noteerVan = (k, t) => { const v = vanTab[k]; if (v) { if (!v.tabs.includes(t)) v.tabs.push(t); } else vanTab[k] = { tabs: [t], gen: S.gen[k] || 0 }; };
    const isOvergenomen = t => {
      if (!overgenomen.has(t)) return false;
      if (!levend(t)) return true;
      overgenomen.delete(t);
      // Pas teruggeven als géén ander overgenomen tabblad dezelfde offerte nog claimt.
      Object.keys(vanTab).forEach(k => { const v = vanTab[k]; if (!v.tabs.includes(t)) return; v.tabs = v.tabs.filter(x => x !== t);
        if (v.tabs.length) return; if ((S.gen[k] || 0) === v.gen) { delete S.vuil[k]; delete S.basis[k]; } delete vanTab[k]; });
      return false;
    };
    function perTab() {
      const s = leesJson(cfg.lsLees), per = {};
      if (s && isObj(s.perTab)) Object.keys(s.perTab).forEach(t => { if (isObj(s.perTab[t])) per[t] = s.perTab[t]; });
      else if (s && isObj(s.vuil)) Object.keys(s.vuil).forEach(k => {        // oude vorm (één record per offerte)
        const d = s.vuil[k]; if (!isObj(d)) return; const t = d.tab || 'oud'; (per[t] = per[t] || {})[k] = d; });
      return per;
    }
    // Offertes die een ánder (nog niet overgenomen) tabblad gewijzigd en niet gedeeld heeft.
    const andereVuil = () => { const per = perTab(), v = {}; Object.keys(per).forEach(t => { if (t === TAB || isOvergenomen(t)) return;
      Object.keys(per[t]).forEach(k => { if (isObj(per[t][k])) v[k] = Object.assign({}, per[t][k], { tab: t }); }); }); return v; };
    function bewaarSync() {
      try {
        const s = leesJson(cfg.lsLees), per = perTab();
        [...overgenomen].forEach(t => { if (isOvergenomen(t)) delete per[t]; });
        const eigen = {}; Object.keys(S.vuil).forEach(k => { eigen[k] = Object.assign({}, S.vuil[k]); });
        if (Object.keys(eigen).length) per[TAB] = eigen; else delete per[TAB];
        // Geschiedenis van alle tabbladen samen (een ouder tabblad mag die van een ander niet wissen).
        const gezien = {}, ls = (s && isObj(s.gezien)) ? s.gezien : {};
        new Set([...Object.keys(ls), ...Object.keys(S.gezien)]).forEach(k => {
          const l = []; [...(Array.isArray(ls[k]) ? ls[k] : []), ...(S.gezien[k] || [])].forEach(h => { const i = l.indexOf(h); if (i >= 0) l.splice(i, 1); l.push(h); });
          gezien[k] = l.slice(-MAX_GESCHIEDENIS);
        });
        cfg.lsZet(JSON.stringify({ v: 2, perTab: per, gezien }));
      } catch (e) { if (root.console) console.warn('calcopslag: boekhouding bewaren mislukt', e); }
      bewaarConcept();
    }
    // Eigen concept: de actuele inhoud van elke offerte die dit tabblad nog niet gedeeld heeft, apart per tabblad.
    // Zo kan een ander tabblad die nooit wegdrukken, ook niet als beide tabbladen dezelfde offerte bewerken.
    function bewaarConcept() {
      if (typeof cfg.lsZetSleutel !== 'function') return;
      try {
        const live = cfg.offertes() || {}, o = {};
        Object.keys(S.vuil).forEach(k => { if (isObj(live[k])) o[k] = live[k]; });
        if (Object.keys(o).length) cfg.lsZetSleutel(CONCEPT + TAB, JSON.stringify({ tab: TAB, tijd: iso(), offertes: o }));
        else cfg.lsWisSleutel(CONCEPT + TAB);
      } catch (e) { if (root.console) console.warn('calcopslag: concept bewaren mislukt', e); }
    }
    const concepten = () => (typeof cfg.lsSleutels === 'function' ? cfg.lsSleutels(CONCEPT) : [])
      .map(sl => ({ sl, c: leesJson(() => cfg.lsLeesSleutel(sl)) })).filter(x => x.c && isObj(x.c.offertes));
    // Na een geslaagde schrijfactie: concepten (van welk tabblad ook) waarvan de inhoud nu veilig op SharePoint staat
    // (als stand of als bewaarde kopie), opruimen.
    function ruimConceptenOp(geschreven) {
      concepten().forEach(({ sl, c }) => {
        if (sl === CONCEPT + TAB) return;
        let weg = false;
        Object.keys(c.offertes).forEach(k => {
          const w = geschreven[k], h = hash(c.offertes[k]);
          const ids = Array.isArray(w && w._conflicten) ? w._conflicten.map(x => x.id) : [];
          // de bewaarde kopieën van dat tabblad moeten er ook staan (tenzij de lijst vol is: dan vielen de oudste bewust af)
          const kopieenVeilig = ids.length >= MAX_KOPIEEN || (Array.isArray(c.offertes[k]._conflicten) ? c.offertes[k]._conflicten : []).every(x => !x || !x.id || ids.includes(x.id));
          if (isObj(w) && kopieenVeilig && (hash(w) === h || ids.includes('k' + h))) { delete c.offertes[k]; weg = true; }
        });
        if (weg) tik(() => Object.keys(c.offertes).length ? cfg.lsZetSleutel(sl, JSON.stringify(c)) : cfg.lsWisSleutel(sl));
      });
    }
    // Wat dit tabblad naar de gedeelde lokale kopie schrijft: het eigen geheugen, behalve offertes die een ánder tabblad
    // gewijzigd en nog niet gedeeld heeft — die blijven zoals dat tabblad ze neerzette (nooit wegdrukken met een oude stand).
    function cachePayload() {
      const live = cfg.offertes() || {}, uit = Object.assign({}, live), ander = andereVuil();
      if (Object.keys(ander).length) {
        const ls = leesJson(cfg.lsLeesOffertes), lso = (ls && isObj(ls.offertes)) ? ls.offertes : {};
        Object.keys(ander).forEach(k => { if (isObj(lso[k]) && !S.vuil[k]) uit[k] = lso[k]; });   // ook zelf gewijzigd: eigen stand (het concept van de ander blijft)
      }
      return { versie: 2, offertes: uit };
    }
    function onthoud(k, h) {                               // versies die dit apparaat van SharePoint kende
      if (!h) return; const l = (S.gezien[k] || []).filter(x => x !== h); l.push(h);
      S.gezien[k] = l.slice(-MAX_GESCHIEDENIS);
    }

    // Na het laden uit localStorage: wat hier staat, geldt als de laatst bekende stand (tot de eerste lezing).
    function laad(syncTekst) {
      let s = null; try { s = syncTekst ? JSON.parse(syncTekst) : null; } catch (e) { s = null; }
      S.eersteKeer = !isObj(s);
      S.gezien = (s && isObj(s.gezien)) ? s.gezien : {};
      const live = cfg.offertes() || {};
      S.basis = {}; Object.keys(live).forEach(k => { S.basis[k] = hash(live[k]); });
      // Niet-gedeelde wijzigingen: die van dit tabblad (ook van vóór herladen: zelfde tab-id) en van tabbladen die er niet
      // meer zijn, worden van ons. Die van een ander tabblad dat nog leeft, blijven van dat tabblad.
      S.vuil = {};
      const per = perTab();
      Object.keys(per).forEach(t => {
        const eigen = t === TAB, neem = eigen || !levend(t);
        if (neem && !eigen) overgenomen.add(t);
        Object.keys(per[t]).forEach(k => { const d = per[t][k]; if (!isObj(d)) return;
          if (neem) { const nieuw = !S.vuil[k]; if (nieuw) S.vuil[k] = { basis: d.basis == null ? null : d.basis, sinds: d.sinds || iso() };
            if (!eigen && (nieuw || vanTab[k])) noteerVan(k, t); }
          else delete S.basis[k];   // wat hier van die offerte staat, is het werk van dat andere tabblad, niet wat wij van SharePoint kenden
        });
      });
      neemOver();
      S.geladen = true; bewaarSync(); status();
    }
    // Een tabblad "leeft" als zijn concept recent is bijgewerkt (elk tabblad met niet-gedeeld werk doet dat elke 30 s).
    function levend(tab) {
      if (!tab || tab === TAB) return false;
      const c = concepten().find(x => x.c.tab === tab);
      return !!c && nu() - (Date.parse(c.c.tijd) || 0) < LEVEND_MS;
    }
    // Concepten van dit tabblad en van verdwenen (gesloten of gecrashte) tabbladen overnemen. Heeft dit tabblad zelf ook
    // niet-gedeeld werk aan die offerte en wijkt het af, dan zijn er twee versies: het concept wordt bewaard als kopie, met
    // melding. Anders wordt het concept de stand. Concepten van een levend ander tabblad blijven van dat tabblad.
    function neemOver(alleenAnderen) {
      const live = cfg.offertes() || {}, per = perTab();
      concepten().forEach(({ c }) => {
        if (c.tab === TAB ? alleenAnderen : levend(c.tab)) return;
        if (c.tab !== TAB) overgenomen.add(c.tab);
        const rec = isObj(per[c.tab]) ? per[c.tab] : {};
        Object.keys(c.offertes).forEach(k => {
          const v = c.offertes[k]; if (!isObj(v)) return;
          if (!isObj(live[k])) live[k] = v;
          else if (hash(live[k]) === hash(v)) {                // zelfde inhoud: alleen de bewaarde kopieën van dat tabblad erbij
            const l = lijstenSamen(live[k]._conflicten, v._conflicten); if (l.length) live[k]._conflicten = l;
          } else {
            if (S.vuil[k]) {
              live[k]._conflicten = lijstenSamen(live[k]._conflicten, v._conflicten, [kopie(v, { bron: 'ander tabblad', reden: 'ander tabblad', tijd: c.tijd || iso() })]);
            } else {
              const l = lijstenSamen(live[k]._conflicten, v._conflicten);
              Object.keys(live[k]).forEach(p => { if (!(p in v)) delete live[k][p]; });
              Object.assign(live[k], kloon(v)); if (l.length) live[k]._conflicten = l;
            }
          }
          // basis: die van het verdwenen tabblad als we die kennen, anders onbekend (bij een afwijking op SharePoint blijven beide bewaard)
          const nieuw = !S.vuil[k];
          if (nieuw) { const d = rec[k]; S.vuil[k] = { basis: (isObj(d) && d.basis != null) ? d.basis : null, sinds: iso() }; }
          if (c.tab !== TAB && (nieuw || vanTab[k])) noteerVan(k, c.tab);
        });
      });
    }
    // Een wijziging vastleggen. Met sleutel: die offerte. Zonder: elke offerte die anders is dan wat dit tabblad
    // als laatste met SharePoint deelde (voor bewerkingen die meerdere offertes tegelijk raken).
    function markeer(k) {
      const live = cfg.offertes() || {};
      const een = key => {
        if (!S.vuil[key]) S.vuil[key] = { basis: S.basis[key] == null ? null : S.basis[key], sinds: iso() };
        S.gen[key] = (S.gen[key] || 0) + 1;
      };
      if (k) een(k);
      else Object.keys(live).forEach(key => { if (hash(live[key]) !== S.basis[key]) een(key); });
      bewaarSync(); status();
    }

    async function cyclus(poging) {
      neemOver(true);                                   // werk van een intussen verdwenen tabblad alsnog meenemen
      const live0 = cfg.offertes() || {};
      const snap = kloon(live0), gen0 = Object.assign({}, S.gen);
      let r;
      try { r = await metTijd(cfg.lees(), 'lezen'); }
      catch (e) { S.dicht = { reden: reden(e), tijd: nu() }; tik(() => cfg.opSync && cfg.opSync({ ok: false, reden: reden(e) })); return { ok: false, dicht: true, reden: reden(e) }; }
      // Alleen een echte 404 telt als "nog leeg". Een bestand zonder een offertes-object (beschadigd, verkeerde upload,
      // ander schema) wordt nooit als lege lijst behandeld en dus nooit overschreven.
      if (!r || (r.status !== 404 && !(r.status === 200 && isObj(r.data) && Object.prototype.hasOwnProperty.call(r.data, 'offertes') && isObj(r.data.offertes)))) {
        const rd = 'het bestand op SharePoint heeft een onverwachte vorm — er is niets overschreven';
        S.dicht = { reden: rd, tijd: nu() }; tik(() => cfg.opSync && cfg.opSync({ ok: false, reden: rd }));
        return { ok: false, dicht: true, reden: rd };
      }
      const R = r.status === 404 ? {} : r.data.offertes;
      const res = samen(snap, R, { vuil: S.vuil, basis: S.basis, gezien: S.gezien, eersteKeer: S.eersteKeer, tijd: iso(), door: cfg.door ? cfg.door() : '' });

      // Toepassen op het live geheugen. Is een offerte tijdens het lezen bewerkt, dan blijft de live stand staan;
      // nam SharePoint het over, dan wordt die versie als kopie bewaard (niets weg, wel een melding).
      const live = cfg.offertes() || {}, vervangen = [], conflicten = new Set(res.nieuw);
      for (const k of Object.keys(res.offertes)) {
        const u = res.uitkomst[k], m = res.offertes[k], bewerkt = (S.gen[k] || 0) !== (gen0[k] || 0);
        const hb = R[k] ? hash(R[k]) : null;
        const lokaalWint = u === 'lokaal' || u === 'lokaal-nieuw' || u === 'conflict-lokaal' || u === 'terugval';
        // Zelfde inhoud (of lokaal wint): het live object blijft hetzelfde object, alleen de kopieën komen erbij.
        // Zo tekent het scherm niet bij elke opslag opnieuw en houden lopende acties hun verwijzing.
        if (live[k] && (lokaalWint || hash(live[k]) === hash(m))) {
          const l = lijstenSamen(live[k]._conflicten, m._conflicten);
          if (l.length) live[k]._conflicten = l;
          if (m._verdrongen && !live[k]._verdrongen) live[k]._verdrongen = m._verdrongen;
          // Terugval: onze (nieuwere) versie moet SharePoint nog bereiken — als gewijzigd ten opzichte van wat er nu staat.
          if (u === 'terugval' && hb && !S.vuil[k]) S.vuil[k] = { basis: hb, sinds: iso() };
        } else if (!live[k]) {
          live[k] = m; vervangen.push(k);
        } else if (!bewerkt) {
          // Ter plekke vervangen: wie het object vasthoudt over een await (Moneybird-actie, projectmap), schrijft zo
          // in de actuele versie en niet in een losgekoppelde kopie die daarna nergens meer staat.
          Object.keys(live[k]).forEach(p => { if (!(p in m)) delete live[k][p]; });
          Object.assign(live[k], m); vervangen.push(k);
        } else {
          const extra = (hb && u !== 'gelijk' && hash(live[k]) !== hb) ? [kopie(R[k], { bron: 'elders', reden: 'gelijktijdig', tijd: iso(), door: cfg.door ? cfg.door() : '' })] : [];
          const l = lijstenSamen(live[k]._conflicten, m._conflicten, extra);
          if (l.length) live[k]._conflicten = l;
          if (extra.length) conflicten.add(k);
          if (!S.vuil[k]) S.vuil[k] = { basis: hb, sinds: iso() };
        }
        if (hb) { S.basis[k] = hb; onthoud(k, vol(R[k])); }
        if (S.vuil[k]) {
          if (!bewerkt && (u === 'remote' || u === 'gelijk' || u === 'krimp')) delete S.vuil[k];
          else if (hb) S.vuil[k].basis = hb;
        }
      }
      Object.keys(S.vuil).forEach(k => { if (!live[k]) delete S.vuil[k]; });
      S.dicht = null; S.eersteKeer = false;
      const t = nu(); Object.keys(live).forEach(k => { if (!S.vuil[k] && R[k]) S.gedeeldOm[k] = t; });
      tik(cfg.bewaarOffertes); bewaarSync();
      tik(() => cfg.opWijziging && cfg.opWijziging({ vervangen, conflicten: [...conflicten] }));

      // Schrijven, alleen als het samengevoegde resultaat anders is dan SharePoint.
      const keys = Object.keys(live);
      if (canon(live) === canon(R)) {
        keys.forEach(k => { if (S.vuil[k] && hash(live[k]) === S.basis[k] && (S.gen[k] || 0) === (gen0[k] || 0)) delete S.vuil[k]; S.gedeeldOm[k] = t; });
        S.fout = null; S.teSchrijven.clear(); bewaarSync();
        tik(() => ruimConceptenOp(R));
        tik(() => cfg.opSync && cfg.opSync({ ok: true }));
        return { ok: true, geschreven: false };
      }
      // Wat (nog) anders is dan SharePoint, ook als het alleen bewaarde kopieën zijn: telt als niet gedeeld tot de PUT lukt.
      S.teSchrijven = new Set(keys.filter(k => canon(live[k]) !== canon(R[k])));
      if (Object.keys(R).some(k => !live[k]) || (Object.keys(R).length && !keys.length)) {   // nooit kleiner dan SharePoint
        S.fout = { reden: 'de lijst zou kleiner worden dan op SharePoint — niet geschreven', tijd: t };
        return { ok: false, reden: S.fout.reden };
      }
      if (r.status !== 404 && !r.etag) {
        S.fout = { reden: 'SharePoint gaf geen versienummer (ETag) mee — niet blind overschreven', tijd: t };
        return { ok: false, reden: S.fout.reden };
      }
      const body = JSON.stringify({ versie: 2, offertes: live });
      const hashes = {}, volle = {}; keys.forEach(k => { hashes[k] = hash(live[k]); volle[k] = vol(live[k]); });
      const genP = Object.assign({}, S.gen);
      let w;
      try { w = await metTijd(cfg.schrijf(body, r.status === 404 ? null : r.etag), 'opslaan'); }
      catch (e) { S.fout = { reden: reden(e), tijd: nu() }; tik(() => cfg.opSync && cfg.opSync({ ok: false, reden: reden(e) })); return { ok: false, reden: reden(e) }; }
      if (w && w.status === 412) {
        if (poging < 3) return cyclus(poging + 1);       // iemand schreef tussendoor: opnieuw lezen en samenvoegen
        S.fout = { reden: 'SharePoint werd steeds tegelijk gewijzigd (3 pogingen)', tijd: nu() };
        return { ok: false, reden: S.fout.reden };
      }
      if (!w || !w.ok) {
        S.fout = { reden: 'SharePoint weigerde het opslaan (HTTP ' + (w && w.status) + ')', tijd: nu() };
        tik(() => cfg.opSync && cfg.opSync({ ok: false, reden: S.fout.reden }));
        return { ok: false, reden: S.fout.reden };
      }
      const t2 = nu();
      keys.forEach(k => {
        S.basis[k] = hashes[k]; onthoud(k, volle[k]); S.gedeeldOm[k] = t2;
        if (S.vuil[k]) { if ((S.gen[k] || 0) === (genP[k] || 0)) delete S.vuil[k]; else S.vuil[k].basis = hashes[k]; }
      });
      S.fout = null; S.teSchrijven.clear(); bewaarSync();
      tik(() => ruimConceptenOp(JSON.parse(body).offertes));
      tik(() => cfg.opSync && cfg.opSync({ ok: true }));
      return { ok: true, geschreven: true };
    }

    // De schrijfrij: één cyclus tegelijk; wie binnenkomt terwijl er al een wacht, krijgt die.
    let keten = Promise.resolve(), wachtend = null;
    function schrijf() {
      if (wachtend) return wachtend;
      const p = wachtend = keten.then(async () => {
        wachtend = null; S.bezig = true; status();
        try { return await cyclus(1); }
        catch (e) { S.fout = { reden: reden(e), tijd: nu() }; return { ok: false, reden: reden(e) }; }
        finally { S.bezig = false; status(); }
      });
      keten = p.then(() => {}, () => {});
      return p;
    }

    function statusVan(k) {
      if (S.dicht) return { staat: 'dicht', reden: S.dicht.reden, vuil: !!S.vuil[k] };
      if (S.vuil[k] || S.teSchrijven.has(k)) return S.bezig ? { staat: 'bezig' } : S.fout ? { staat: 'mislukt', reden: S.fout.reden } : { staat: 'lokaal' };
      return { staat: 'gedeeld', tijd: S.gedeeldOm[k] || null };
    }
    const conflictenVan = k => { const o = (cfg.offertes() || {})[k]; return (o && Array.isArray(o._conflicten)) ? o._conflicten : []; };
    // De gebruiker heeft de bewaarde versies bekeken: melding weg, kopieën blijven.
    function gezienMarkeer(k) {
      const o = (cfg.offertes() || {})[k]; if (!o || !Array.isArray(o._conflicten)) return Promise.resolve({ ok: true });
      o._conflicten = o._conflicten.map(c => Object.assign({}, c, { gezien: true }));
      markeer(k); tik(cfg.bewaarOffertes); return schrijf();
    }
    // Een bewaarde versie terugzetten (per offerte). De huidige stand gaat eerst zelf in de kopieën.
    function zetTerug(k, id) {
      const live = cfg.offertes() || {}, o = live[k], c = conflictenVan(k).find(x => x.id === id);
      if (!o || !c) return Promise.resolve({ ok: false, reden: 'versie niet gevonden' });
      const nieuw = kloon(c.offerte);
      nieuw._teruggezet = iso(); nieuw._gewijzigd = iso();
      if (o.mail_context && !nieuw.mail_context) nieuw.mail_context = o.mail_context;
      nieuw._conflicten = lijstenSamen(o._conflicten.map(x => x.id === id ? Object.assign({}, x, { gezien: true }) : x),
        [Object.assign(kopie(o, { bron: 'deze pc', reden: 'voor terugzetten', tijd: iso(), door: cfg.door ? cfg.door() : '' }), { gezien: true })]);
      if (o._verdrongen) nieuw._verdrongen = o._verdrongen;
      live[k] = nieuw; markeer(k); tik(cfg.bewaarOffertes);
      return schrijf();
    }

    return {
      laad, markeer, schrijf, status: statusVan, conflicten: conflictenVan, gezien: gezienMarkeer, zetTerug,
      conflictOpen: k => conflictenVan(k).some(c => !c.gezien),
      heeftOngedeeld: () => S.bezig || Object.keys(S.vuil).length > 0 || S.teSchrijven.size > 0,
      heeftOpenstaand: () => !!S.dicht || !!S.fout || Object.keys(S.vuil).length > 0 || S.teSchrijven.size > 0,
      cachePayload,
      isDicht: () => !!S.dicht,
      _S: S
    };
  }

  /* ── Getallen zoals mensen ze in Nederland typen ─────────────────────────────
   * "1234,56", "1.234,56", "1234.56", "1 234,56", "€ 1.234,56", "-3", "1,5", "1.5" → een getal.
   * Dubbelzinnig ("1.250": 1250 of 1,25?) of onleesbaar → géén stille 0, maar een status die de calculatie toont.
   * → { status: 'leeg'|'ok'|'onduidelijk'|'fout', waarde, oud }   (oud = hoe de vorige parser het las, voor bestaande waarden) */
  function getal(v) {
    if (v === null || v === undefined) return { status: 'leeg', waarde: null };
    if (typeof v === 'number') return isFinite(v) ? { status: 'ok', waarde: v } : { status: 'fout', waarde: null };
    const ruw = String(v);
    const oudX = Number(ruw.replace(/\s/g, '').replace(',', '.')), oud = isNaN(oudX) ? null : oudX;
    let s = ruw.replace(/[    ]/g, ' ').trim();
    if (!s) return { status: 'leeg', waarde: null };
    const fout = { status: 'fout', waarde: null, oud };
    let neg = false;
    const teken = () => { if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1).trim(); } };
    teken(); s = s.replace(/^(€|eur\b\.?)\s*/i, ''); teken(); s = s.replace(/\s*(€|eur\.?)$/i, '').trim();
    if (!s) return fout;
    if (/\s/.test(s)) {                                   // spaties alleen als duizendtalscheiding: 1 234,56
      if (!/^\d{1,3}( \d{3})+([.,]\d*)?$/.test(s)) return fout;
      s = s.replace(/ /g, '');
    }
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return fout;
    const punten = (s.match(/\./g) || []).length, kommas = (s.match(/,/g) || []).length;
    let heel, dec = '';
    const groepen = (deel, sep) => new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(deel);
    if (punten && kommas) {                               // beide: de laatste is het decimaalteken
      const decSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.', dznd = decSep === ',' ? '.' : ',';
      const i = s.lastIndexOf(decSep); heel = s.slice(0, i); dec = s.slice(i + 1);
      if (heel.includes(decSep) || !groepen(heel, dznd) || !/^\d*$/.test(dec)) return fout;
      heel = heel.split(dznd).join('');
    } else if (kommas) {
      if (kommas === 1) { [heel, dec] = s.split(','); }
      else if (groepen(s, ',')) heel = s.replace(/,/g, '');
      else return fout;
    } else if (punten) {
      if (punten > 1) { if (!groepen(s, '.')) return fout; heel = s.replace(/\./g, ''); }
      else {
        [heel, dec] = s.split('.');
        // precies drie cijfers na één punt (1.250): duizendtal of decimaal? Niet raden.
        if (dec.length === 3 && /^[1-9]\d{0,2}$/.test(heel)) return { status: 'onduidelijk', waarde: null, oud, opties: [Number(heel + dec), Number(heel + '.' + dec)] };
      }
    } else heel = s;
    if (!heel && !dec) return fout;
    const x = Number((heel || '0') + (dec ? '.' + dec : ''));
    if (!isFinite(x)) return fout;
    return { status: 'ok', waarde: neg ? -x : x };
  }
  // Zoals de calculatie een getal bewaart: Nederlandse schrijfwijze zonder duizendtallen ("1234,56"); ook oudere versies lezen dat goed.
  const getalTekst = x => String(x).replace('.', ',');

  const API = { samen, maak, hash, canon, gevuld, instorting, lijstenSamen, kopie, getal, getalTekst, MAX_KOPIEEN, MAX_BYTES };
  root.MTCalcOpslag = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
