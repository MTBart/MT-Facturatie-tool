/* ============================================================================
 * mt-zoek-extern.js — externe zoekbronnen voor de zoekbalk: e-mail (Graph), Moneybird (facturen/offertes) en SharePoint (mappen/bestanden)
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
    { soort: 'mail', label: 'E-mail', recht: 'inbox' },
    { soort: 'moneybird', label: 'Moneybird', recht: 'moneybird' },
    { soort: 'sharepoint', label: 'SharePoint', recht: 'projecten' }
  ];
  const HOSTS = { mail: ['office.com', 'office365.com', 'outlook.com', 'microsoft.com'], moneybird: ['moneybird.com'], sharepoint: ['sharepoint.com', 'office.com', 'office365.com', 'outlook.com', 'microsoft.com'] };
  const MAX = 5;
  const MAX_WACHT = 24 * 3600;   // productplafond voor Retry-After (zelfde als de worker)
  // 45 → "45 s", 600 → "10 min", 7200 → "2 uur"
  const wachtTekst = s => (s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' uur');

  const tekst = v => String(v == null ? '' : v);
  const nlDatum = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tekst(d)); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
  function limietFout(retryAfter) { const e = new Error('limiet'); e.limiet = true; e.retryAfter = retryAfter > 0 ? retryAfter : 30; return e; }
  // Retry-After (seconden of een datum) → seconden; onbekend → 0.
  function retryAfterVan(r, nu) {
    let h = null; try { h = r && r.headers && r.headers.get && r.headers.get('Retry-After'); } catch (e) {}
    if (!h) return 0;
    if (/^\d+$/.test(h)) return Math.min(Number(h), MAX_WACHT);
    const t = Date.parse(h); return isNaN(t) ? 0 : Math.max(0, Math.min(MAX_WACHT, Math.ceil((t - (nu || Date.now())) / 1000)));
  }
  // Link veilig maken: alleen https naar de verwachte hosts; anders ''.
  function veiligeLinkVoor(soort, url) {
    const u = root.veiligeUrl || (root.MTCore && root.MTCore.veiligeUrl);
    if (typeof u !== 'function') return '';
    return u(url, { hosts: HOSTS[soort] || [] });
  }

  // ── bron: e-mail via Graph $search, in de eigen postbus en (als je daar toegang toe hebt) in een gedeelde postbus (info@) ──
  //   o.token(), o.fetch(url, init), o.nu(), o.infoAdres (gedeelde postbus, optioneel),
  //   o.gekoppeld(msg) → projectcodes waaraan de mail al hangt (MTKoppel.mailProjecten); alleen voor de tag.
  // Toegang tot info@ wordt niet vooraf aangenomen: een 403/404 van die postbus betekent "geen toegang" en wordt stil overgeslagen (en niet
  // opnieuw geprobeerd in deze sessie); een 403 op de eigen postbus is wél een fout. Graph geeft geen bodytekst terug: alleen onderwerp,
  // afzender, datum en de webLink; de inhoud staat pas na openen in Outlook.
  // Zoekfrase voor Graph $search (KQL): operatoren en velden worden onschadelijk gemaakt, zodat elke invoer een gewone woordenzoekopdracht is:
  // aanhalingstekens, backslash, dubbele punt en haakjes weg, alles kleine letters (AND/OR/NOT werken alleen in hoofdletters), max. 100 tekens.
  // "from:naam OR to:klant" wordt dus "from naam or to klant".
  const kqlVeilig = q => String(q == null ? '' : q).toLowerCase().replace(/["\\:()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100).trim();
  function bronMail(o) {
    const SEL = 'id,internetMessageId,conversationId,subject,from,receivedDateTime,webLink';
    const bussen = [{ id: 'me', label: 'je eigen postbus', base: 'https://graph.microsoft.com/v1.0/me', mbx: 'me', tag: '' }];
    if (o.infoAdres) bussen.push({ id: 'info', label: 'info@', base: 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(o.infoAdres), mbx: String(o.infoAdres).toLowerCase(), optioneel: true, tag: 'info@' });
    const geenToegang = new Set(), blokTot = {};   // blokTot: per postbus het tijdstip (ms) tot wanneer die na een 429 wordt overgeslagen
    const nuMs = () => (o.nu ? o.nu() : Date.now());
    return {
      soort: 'mail', label: 'E-mail', geenToegang, blokTot,
      async haal(q, signal) {
        const token = await o.token();
        if (!token) throw new Error('E-mail: niet ingelogd');
        const zoek = kqlVeilig(q);
        if (!zoek) return { items: [], totaal: 0 };
        const een = async b => {
          const r = await o.fetch(b.base + '/messages?$search=' + encodeURIComponent('"' + zoek + '"') + '&$top=10&$select=' + SEL,
            { signal, headers: { Authorization: 'Bearer ' + token, Prefer: 'IdType="ImmutableId"' } });
          if (r.status === 429) { const ra = retryAfterVan(r, nuMs()) || 30; blokTot[b.id] = nuMs() + ra * 1000; throw limietFout(ra); }
          if (r.status === 403 || r.status === 404) { const e = new Error('E-mail: geen toegang tot ' + b.label); e.geenToegang = true; throw e; }
          if (!r.ok) throw new Error('E-mail: HTTP ' + r.status);
          const j = await r.json();
          return (j && Array.isArray(j.value) ? j.value : []).map(m => Object.assign({ _bus: b }, m));
        };
        const nu = nuMs();
        const beschikbaar = bussen.filter(b => !geenToegang.has(b.id));
        const geblokt = beschikbaar.filter(b => (blokTot[b.id] || 0) > nu), aanvragen = beschikbaar.filter(b => !((blokTot[b.id] || 0) > nu));
        const notities = geblokt.map(b => b.label);
        const goed = []; const fouten = []; let gelukt = 0;
        if (aanvragen.length) {
          const uitkomsten = await Promise.allSettled(aanvragen.map(een));
          uitkomsten.forEach((u, i) => {
            if (u.status === 'fulfilled') { gelukt++; goed.push(...u.value); }
            else if (u.reason && u.reason.geenToegang && aanvragen[i].optioneel) geenToegang.add(aanvragen[i].id);   // geen recht op info@: stil overslaan
            else { fouten.push(u.reason); notities.push(aanvragen[i].label); }
          });
        }
        if (!gelukt) {
          // geen enkele postbus leverde iets: de langste wachttijd (ook die van al geblokkeerde postbussen) of de eerste fout
          const rest = geblokt.map(b => Math.ceil((blokTot[b.id] - nu) / 1000));
          const lim = fouten.filter(e => e && e.limiet).map(e => e.retryAfter).concat(rest).sort((a, c) => c - a)[0];
          if (lim) throw limietFout(lim);
          if (signal && signal.aborted) { const e = new Error('afgebroken'); e.name = 'AbortError'; throw e; }
          if (fouten.length) throw fouten[0];
          return { items: [], totaal: 0 };
        }
        const gezien = new Set(), uit = [];
        goed.sort((a, c) => tekst(c.receivedDateTime).localeCompare(tekst(a.receivedDateTime))).forEach(m => {
          const sl = m.internetMessageId || m.id; if (!sl || gezien.has(sl)) return; gezien.add(sl);
          const van = m.from && m.from.emailAddress ? (m.from.emailAddress.name || m.from.emailAddress.address || '') : '';
          const msg = { id: tekst(m.id), internetMessageId: tekst(m.internetMessageId), conversationId: tekst(m.conversationId), subject: tekst(m.subject), mbx: m._bus.mbx, idType: 'immutable' };
          let codes = []; try { codes = o.gekoppeld ? o.gekoppeld(msg) || [] : []; } catch (e) { codes = []; }
          uit.push({
            soort: 'mail', id: tekst(m.internetMessageId || m.id) + '|' + m._bus.id, titel: tekst(m.subject) || '(geen onderwerp)',
            sub: [tekst(van), nlDatum(m.receivedDateTime), m._bus.tag].filter(Boolean).join(' · '), tag: codes.length ? 'mail · dossier' : 'mail',
            data: { url: tekst(m.webLink), msg }
          });
        });
        // Deelresultaat: een postbus die even niet kon (429 of fout) wordt gemeld; de andere levert gewoon.
        return { items: uit.slice(0, 10), totaal: uit.length, notitie: notities.length ? notities.join(' en ') + ' even niet beschikbaar' : '' };
      }
    };
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
    (o.bronnen || []).forEach(b => { staat[b.soort] = { status: 'idle', items: [], totaal: 0, melding: '', notitie: '', retryAfter: 0 }; regels[b.soort] = { ctl: null, blokTot: 0, poging: 0, retryT: null }; });
    let timer = null, ronde = 0, laatsteQ = '';
    const meld = () => { try { if (o.onWijziging) o.onWijziging(); } catch (e) {} };
    const mag = soort => typeof o.mag !== 'function' || !!o.mag(soort);
    const zet = (soort, v) => { Object.assign(staat[soort], { items: [], totaal: 0, melding: '', retryAfter: 0, notitie: '' }, v); };

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
        } else if (!res || !res.items || !res.items.length) zet(soort, res && res.notitie ? { status: 'klaar', notitie: res.notitie } : { status: 'leeg' });
        else zet(soort, { status: 'klaar', items: res.items, totaal: res.totaal || res.items.length, notitie: res.notitie || '' });
      } catch (e) {
        if (mijn !== ronde || r.ctl !== ctl) return;
        r.ctl = null;
        if (e && (e.name === 'AbortError' || e.code === 20)) return;
        if (e && e.limiet) { r.blokTot = nu() + e.retryAfter * 1000; zet(soort, { status: 'limiet', retryAfter: e.retryAfter, melding: b.label + ' is even druk — probeer het over ' + wachtTekst(e.retryAfter) + ' opnieuw.' }); }
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
          return { soort: b.soort, label: b.label, status: s.status, melding: s.melding, notitie: s.notitie, retryAfter: s.retryAfter, items: s.items.slice(0, MAX), totaal: s.totaal, meer: Math.max(0, s.totaal - Math.min(MAX, s.items.length)) };
        }).filter(g => g.status === 'laden' || g.status === 'limiet' || g.status === 'fout' || g.items.length || g.notitie);
      },
      // Staat van alle bronnen (voor "Geen treffers": pas als niets meer laadt en alles leeg is).
      bezig() { return Object.values(staat).some(s => s.status === 'laden') || !!timer; },
      get vraag() { return laatsteQ; }
    };
    return api;
  }

  // Een externe treffer openen. Een mail die al aan een project gekoppeld is opent het dossier van dat project (opt.naarDossier(code));
  // anders de webLink in Outlook (nieuw tabblad, alleen verwachte hosts). Geeft 'dossier', 'url' of false terug.
  function openItem(item, opt, venster) {
    opt = opt || {};
    if (item && item.soort === 'mail' && typeof opt.gekoppeld === 'function' && typeof opt.naarDossier === 'function') {
      let codes = []; try { codes = opt.gekoppeld(item.data && item.data.msg) || []; } catch (e) { codes = []; }
      if (codes.length) { opt.naarDossier(codes[0]); return 'dossier'; }
    }
    return openUrl(item, venster) ? 'url' : false;
  }
  // Een externe treffer openen (nieuw tabblad). Geeft true als er een veilige URL was.
  function openUrl(item, venster) {
    const w = venster || root;
    const u = veiligeLinkVoor(item && item.soort, item && item.data && item.data.url);
    if (!u) return false;
    try { w.open(u, '_blank', 'noopener,noreferrer'); } catch (e) { return false; }
    return true;
  }

  root.MTZoekExtern = { EXTERN, HOSTS, MAX, MAX_WACHT, wachtTekst, kqlVeilig, maak, bronMail, bronMoneybird, bronSharePoint, openUrl, openItem, retryAfterVan, veiligeLinkVoor };
})(typeof window !== 'undefined' ? window : globalThis);
