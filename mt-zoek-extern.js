/* ============================================================================
 * mt-zoek-extern.js — externe zoekbronnen voor de zoekbalk: Moneybird (facturen/offertes) en SharePoint (mappen/bestanden)
 * ----------------------------------------------------------------------------
 * Zuivere logica, geen DOM: fetch, token en tijd worden meegegeven (dus testbaar met een nep-fetch en nep-klok).
 *
 *   const ext = MTZoekExtern.maak({ bronnen:[bronMoneybird({…}), bronSharePoint({…})], mag: soort => bool, onWijziging: () => {…} });
 *   ext.zoek(q);        // bij elke toetsaanslag: annuleert wat loopt en plant (na `wacht` ms) één nieuwe ronde; < `min` tekens = niets
 *   ext.groepen();      // [{soort,label,status,melding,retryAfter,items,totaal,meer}]  (alleen bronnen waar iets over te zeggen valt)
 *   ext.annuleer();
 *
 * Regels:
 *   - Debounce (standaard 400 ms) en minimaal 3 tekens; een nieuwe toetsaanslag breekt de lopende aanvragen af
 *     (AbortController) en een verouderd antwoord wordt genegeerd.
 *   - Per bron een eigen status: 'idle' (nog niets gevraagd), 'laden', 'klaar', 'leeg', 'fout', 'limiet' (429, met retryAfter
 *     in seconden). Bij 'limiet' wordt die bron niet opnieuw gevraagd vóór het Retry-After-tijdstip; andere bronnen lopen door.
 *   - Een bron die nog een index opbouwt (Moneybird, eerste keer) meldt 'opbouwen'; dat wordt hoogstens 3× opnieuw geprobeerd.
 *   - Alleen titel, klant, datum en soort worden getoond; details pas na openen (Moneybird/SharePoint zelf).
 *   - Openen: URL's gaan door veiligeUrl met een vaste lijst hosts (Moneybird: moneybird.com; SharePoint: veiligeLink-hosts).
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  const EXTERN = [
    { soort: 'moneybird', label: 'Moneybird', recht: 'moneybird' },
    { soort: 'sharepoint', label: 'SharePoint', recht: 'projecten' }
  ];
  const HOSTS = { moneybird: ['moneybird.com'], sharepoint: ['sharepoint.com', 'office.com', 'office365.com', 'outlook.com', 'microsoft.com'] };
  const MAX = 5;

  const tekst = v => String(v == null ? '' : v);
  const nlDatum = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tekst(d)); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  function limietFout(retryAfter) { const e = new Error('limiet'); e.limiet = true; e.retryAfter = retryAfter > 0 ? retryAfter : 30; return e; }
  // Retry-After (seconden of een datum) → seconden; onbekend → 0.
  function retryAfterVan(r, nu) {
    let h = null; try { h = r && r.headers && r.headers.get && r.headers.get('Retry-After'); } catch (e) {}
    if (!h) return 0;
    if (/^\d+$/.test(h)) return Math.min(Number(h), 600);
    const t = Date.parse(h); return isNaN(t) ? 0 : Math.max(0, Math.min(600, Math.ceil((t - (nu || Date.now())) / 1000)));
  }
  // Link veilig maken: alleen https naar de verwachte hosts; anders ''.
  function veiligeLinkVoor(soort, url) {
    const u = root.veiligeUrl || (root.MTCore && root.MTCore.veiligeUrl);
    if (typeof u !== 'function') return '';
    return u(url, { hosts: HOSTS[soort] || [] });
  }

  // ── bron: Moneybird via de worker-route /zoek/moneybird ──
  //   o.basis (worker-URL), o.fetch(url, {signal}) → Response (met auth), o.nu()
  function bronMoneybird(o) {
    const SOORTLABEL = { verkoopfactuur: 'factuur', inkoopfactuur: 'inkoopfactuur', offerte: 'offerte' };
    return {
      soort: 'moneybird', label: 'Moneybird',
      async haal(q, signal) {
        const r = await o.fetch(String(o.basis).replace(/\/+$/, '') + '/zoek/moneybird?q=' + encodeURIComponent(q) + '&max=10', { signal });
        if (r.status === 429) { let j = null; try { j = await r.json(); } catch (e) {} throw limietFout(retryAfterVan(r, o.nu && o.nu()) || (j && j.retry_after) || 30); }
        if (!r.ok) throw new Error('Moneybird: HTTP ' + r.status);
        const j = await r.json();
        if (j && j.status === 'opbouwen') return { opbouwen: true, retryAfter: j.retry_after > 0 ? j.retry_after : 5 };
        const items = (j && Array.isArray(j.items) ? j.items : []).map(x => ({
          soort: 'moneybird', id: tekst(x.soort) + ':' + tekst(x.id), titel: tekst(x.titel),
          sub: [tekst(x.klant), nlDatum(x.datum)].filter(Boolean).join(' · '), tag: SOORTLABEL[x.soort] || tekst(x.soort),
          data: { url: tekst(x.url) }
        }));
        return { items, totaal: j && j.totaal > 0 ? j.totaal : items.length };
      }
    };
  }

  // ── bron: SharePoint (projectbibliotheek) via Graph drive-search ──
  //   o.token() → Graph-token, o.drive (drive-id), o.root ('Nieuwe mappenstructuur'), o.fetch(url, init), o.nu()
  // De drive-search geeft geen parentReference.path terug: klant en "binnen de projectmap" volgen uit de webUrl.
  function bronSharePoint(o) {
    const rootEnc = encodeURIComponent(o.root).toLowerCase();
    return {
      soort: 'sharepoint', label: 'SharePoint',
      async haal(q, signal) {
        const token = await o.token();
        if (!token) throw new Error('SharePoint: niet ingelogd');
        const zoek = q.replace(/'/g, "''");
        const url = 'https://graph.microsoft.com/v1.0/drives/' + o.drive + '/root:/' + encodeURI(o.root) + ":/search(q='" + encodeURIComponent(zoek) + "')?$select=id,name,webUrl,folder,file,lastModifiedDateTime&$top=25";
        const r = await o.fetch(url, { signal, headers: { Authorization: 'Bearer ' + token } });
        if (r.status === 429) throw limietFout(retryAfterVan(r, o.nu && o.nu()));
        if (!r.ok) throw new Error('SharePoint: HTTP ' + r.status);
        const j = await r.json();
        const alle = [];
        (j && Array.isArray(j.value) ? j.value : []).forEach(x => {
          const w = tekst(x.webUrl), lw = w.toLowerCase(), i = lw.indexOf('/' + rootEnc + '/');
          if (i < 0 || !x.id || !x.name) return;                 // alleen binnen de projectbibliotheek
          let rest = w.slice(i + rootEnc.length + 2).split('?')[0].split('/'), klant = '';
          try { klant = decodeURIComponent(rest[0] || ''); } catch (e) { klant = rest[0] || ''; }
          alle.push({ soort: 'sharepoint', id: tekst(x.id), titel: tekst(x.name), sub: [rest.length > 1 ? klant : '', nlDatum(x.lastModifiedDateTime)].filter(Boolean).join(' · '), tag: x.folder ? 'map' : 'bestand', data: { url: w } });
        });
        return { items: alle, totaal: alle.length };
      }
    };
  }

  // ── beheer: debounce, annuleren, status per bron ──
  function maak(o) {
    const wacht = o.wacht > 0 ? o.wacht : 400, min = o.min > 0 ? o.min : 3;
    const nu = o.nu || (() => Date.now()), zetT = o.setTimeout || root.setTimeout.bind(root), wisT = o.clearTimeout || root.clearTimeout.bind(root);
    const AC = o.AbortController || root.AbortController;
    const staat = {}, regels = {};
    (o.bronnen || []).forEach(b => { staat[b.soort] = { status: 'idle', items: [], totaal: 0, melding: '', retryAfter: 0 }; regels[b.soort] = { ctl: null, blokTot: 0, poging: 0, retryT: null }; });
    let timer = null, ronde = 0, laatsteQ = '';
    const meld = () => { try { if (o.onWijziging) o.onWijziging(); } catch (e) {} };
    const mag = soort => typeof o.mag !== 'function' || !!o.mag(soort);
    const zet = (soort, v) => { Object.assign(staat[soort], { items: [], totaal: 0, melding: '', retryAfter: 0 }, v); };

    function stop() {
      if (timer) { wisT(timer); timer = null; }
      Object.keys(regels).forEach(k => { const r = regels[k]; if (r.ctl) { try { r.ctl.abort(); } catch (e) {} r.ctl = null; } if (r.retryT) { wisT(r.retryT); r.retryT = null; } r.poging = 0; });
    }
    async function ronde1(b, q, mijn) {
      const soort = b.soort, r = regels[soort];
      if (r.blokTot > nu()) { zet(soort, { status: 'limiet', retryAfter: Math.ceil((r.blokTot - nu()) / 1000), melding: b.label + ' is even druk — probeer het zo opnieuw.' }); return; }
      const ctl = AC ? new AC() : null; r.ctl = ctl;
      zet(soort, { status: 'laden' }); meld();
      try {
        const res = await b.haal(q, ctl ? ctl.signal : undefined);
        if (mijn !== ronde || r.ctl !== ctl) return;            // verouderd
        r.ctl = null;
        if (res && res.opbouwen) {
          zet(soort, { status: 'laden', melding: b.label + ' wordt voor het eerst ingelezen…' });
          if (r.poging++ < 3) r.retryT = zetT(() => { r.retryT = null; if (mijn === ronde) ronde1(b, q, mijn); }, Math.max(1, res.retryAfter || 5) * 1000);
          else zet(soort, { status: 'fout', melding: b.label + ' is nog niet klaar met inlezen. Probeer het over een minuut opnieuw.' });
        } else if (!res || !res.items || !res.items.length) zet(soort, { status: 'leeg' });
        else zet(soort, { status: 'klaar', items: res.items, totaal: res.totaal || res.items.length });
      } catch (e) {
        if (mijn !== ronde || r.ctl !== ctl) return;
        r.ctl = null;
        if (e && (e.name === 'AbortError' || e.code === 20)) return;
        if (e && e.limiet) { r.blokTot = nu() + e.retryAfter * 1000; zet(soort, { status: 'limiet', retryAfter: e.retryAfter, melding: b.label + ' is even druk — probeer het over ' + e.retryAfter + ' s opnieuw.' }); }
        else zet(soort, { status: 'fout', melding: b.label + ' is even niet bereikbaar.' });
      }
      meld();
    }
    const api = {
      staat, EXTERN,
      zoek(q) {
        q = tekst(q).trim(); laatsteQ = q; ronde++; stop();
        (o.bronnen || []).forEach(b => zet(b.soort, { status: 'idle' }));
        if (q.replace(/\s+/g, '').length < min) { meld(); return; }
        const mijn = ronde;
        timer = zetT(() => { timer = null; (o.bronnen || []).filter(b => mag(b.soort)).forEach(b => { ronde1(b, q, mijn); }); }, wacht);
        meld();
      },
      annuleer() { ronde++; stop(); (o.bronnen || []).forEach(b => zet(b.soort, { status: 'idle' })); meld(); },
      // Groepen voor de lijst: laden/limiet/fout/klaar tonen iets; leeg en idle verdwijnen.
      groepen() {
        return (o.bronnen || []).filter(b => mag(b.soort)).map(b => {
          const s = staat[b.soort];
          return { soort: b.soort, label: b.label, status: s.status, melding: s.melding, retryAfter: s.retryAfter, items: s.items.slice(0, MAX), totaal: s.totaal, meer: Math.max(0, s.totaal - Math.min(MAX, s.items.length)) };
        }).filter(g => g.status === 'laden' || g.status === 'limiet' || g.status === 'fout' || g.items.length);
      },
      // Staat van alle bronnen (voor "Geen treffers": pas als niets meer laadt en alles leeg is).
      bezig() { return Object.values(staat).some(s => s.status === 'laden') || !!timer; },
      get vraag() { return laatsteQ; }
    };
    return api;
  }

  // Een externe treffer openen (nieuw tabblad). Geeft true als er een veilige URL was.
  function openUrl(item, venster) {
    const w = venster || root;
    const u = veiligeLinkVoor(item && item.soort, item && item.data && item.data.url);
    if (!u) return false;
    try { w.open(u, '_blank', 'noopener,noreferrer'); } catch (e) { return false; }
    return true;
  }

  root.MTZoekExtern = { EXTERN, HOSTS, MAX, maak, bronMoneybird, bronSharePoint, openUrl, retryAfterVan, veiligeLinkVoor };
})(typeof window !== 'undefined' ? window : globalThis);
