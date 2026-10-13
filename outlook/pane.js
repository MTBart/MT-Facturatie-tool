/* ============================================================================
 * outlook/pane.js — het MT-paneel in Outlook: de geopende mail koppelen, bijlagen naar de projectmap, lead maken, oppakken en antwoorden
 * ----------------------------------------------------------------------------
 * Draait als taakvenster naast een geopende mail (Office.js, Mailbox ≥ 1.5). Aanmelden via NAA (nested app authentication,
 * msal-browser 3.x), daarna rechtstreeks naar Graph — de worker wordt NIET gebruikt (een ID-token onder NAA is onbetrouwbaar).
 * Hergebruikt de gedeelde modules: mt-core.js (esc, veiligeUrl, SharePoint-synclaag), mt-koppel.js (koppelen, voorstellen, samenvoegen),
 * mt-zoek.js (dezelfde projectzoeker als de zoekbalk), mt-project.js (de resolver: nummer, oude code, offertenummer), mt-lead.js (fases)
 * en mt-mailactie.js (submappen, "Pak op", projecttag, projectgegevens). De koppelingen staan in dezelfde privé SharePoint-bestanden als in
 * de cockpit (mt_mail_links.json, mt_koppel_journaal.json, mt_mail_oppak.json, mt_bijlage_index.json); mt_projecten.json wordt alleen gelezen.
 * Een lead maken gebeurt in de tool zelf (de echte aanmaakroute met nummer en volgende actie): het paneel opent hem met deze mail.
 * In het opstelvenster (antwoord) toont het paneel of info@ in de cc staat bij een gekoppeld gesprek, met een knop en de proef-vlag.
 *
 * Testbaar: maak(deps) krijgt Office, msal, fetch, document, … mee (zie ol3-paneel-harness); zonder deps start het vanzelf op Office.onReady.
 * Veiligheid: alle tekst komt via textContent; links via veiligeUrl (https + vaste host); geen innerHTML, geen inline handlers.
 * ========================================================================== */
(function (root) {
  'use strict';

  // clientId en tenant zijn geen geheimen (staan ook publiek in v2.html). Scopes: een deelverzameling van wat de cockpit al heeft.
  const G = 'https://graph.microsoft.com/';
  const CONFIG = {
    clientId: 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb',
    authority: 'https://login.microsoftonline.com/15b652c3-ff53-433f-a29d-e9626cbafb41',
    scopes: [G + 'Files.ReadWrite', G + 'Sites.ReadWrite.All', G + 'Mail.Read'],
    // Alleen voor een gedeelde postbus (info@) erbij gevraagd, zodat wie dat niet gebruikt er ook niet om hoeft toe te stemmen.
    scopesGedeeld: [G + 'Files.ReadWrite', G + 'Sites.ReadWrite.All', G + 'Mail.Read', G + 'Mail.Read.Shared'],
    // Alleen bij een schrijfactie op de mail zelf (de categorie "Opgepakt: …", een antwoordconcept), pas op het moment van de klik.
    scopesSchrijf: [G + 'Files.ReadWrite', G + 'Sites.ReadWrite.All', G + 'Mail.ReadWrite'],
    scopesSchrijfGedeeld: [G + 'Files.ReadWrite', G + 'Sites.ReadWrite.All', G + 'Mail.ReadWrite', G + 'Mail.ReadWrite.Shared'],
    graph: 'https://graph.microsoft.com/v1.0',
    select: 'id,internetMessageId,conversationId,subject,from,receivedDateTime,webLink,hasAttachments',   // bewust zonder mailtekst of preview
    projDrive: 'b!lTex941J7USVCgvB3IzGjgLtfqmMmeJBvKGym8WK_yoejLeBeRL4SJ3YbCz59r4c',                       // de projectmappen (On-Prem-Data), zoals in de cockpit
    bijlageMax: 25 * 1024 * 1024                                                                          // groter: via de cockpit
  };
  const BESTANDEN = { projecten: 'mt_projecten', links: 'mt_mail_links', journaal: 'mt_koppel_journaal', oppak: 'mt_mail_oppak', bijlagen: 'mt_bijlage_index' };
  const ITEM_MAX_PAGINAS = 10;
  const WACHT_SLEUTEL = 'mt_paneel_journaal_wacht';   // enige sessionStorage-sleutel: journaalregels die nog niet naar SharePoint zijn
  const VLAG_AUTO_CC = 'mt_auto_cc';                   // roamingSettings: automatisch info@ in cc (proef, standaard uit)

  function maak(d) {
    const doc = d.document, Office = d.Office, win = d.window || root;
    const cfg = Object.assign({}, CONFIG, d.config || {});
    const K = d.MTKoppel, Z = d.MTZoek, C = d.MTCore, P = d.MTProject || null, L = d.MTLead || null, M = d.MTMail || null;
    const INFO = (K && K.STANDAARD_MBX) || '';
    const el = id => doc.getElementById(id);
    const diag = {};                                  // wat de proef moet bewijzen; staat in het uitklapblok "Diagnose"
    const cache = {}, gewijzigd = new Set();          // opslag-adapter voor MTKoppel: geheugen, schrijven naar SharePoint na elke actie
    let pca = null, SP = null, projecten = [], perCode = new Map(), zoekIndex = null, voorstelIx = null, resolverIx = null;
    let oppak = null, bijlIndex = null;               // null = niet te lezen (die functie staat dan uit; koppelen werkt gewoon)
    let huidig = null, teller = 0, bezig = false, gegevensTs = 0;
    // Journaalregels die nog niet in SharePoint staan (het journaal is een apart bestand en kan na de koppelingen mislukken): in het geheugen en in
    // sessionStorage, en vóór de volgende actie opnieuw weggeschreven.
    const leesWacht = () => { try { const v = JSON.parse(win.sessionStorage.getItem(WACHT_SLEUTEL) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    let wachtJournaal = leesWacht();
    function zetWacht(a) { wachtJournaal = a; try { if (a.length) win.sessionStorage.setItem(WACHT_SLEUTEL, JSON.stringify(a)); else win.sessionStorage.removeItem(WACHT_SLEUTEL); } catch (e) {} }
    const parseLijst = t => { try { const v = JSON.parse(t); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    function wachtendInCache() {
      if (!wachtJournaal.length) return;
      cache[BESTANDEN.journaal] = JSON.stringify(K.journaalSamen(cache[BESTANDEN.journaal] || '[]', JSON.stringify(wachtJournaal)));
      gewijzigd.add(BESTANDEN.journaal);
    }     // huidig = {msg, mbx, base, gesprek, codes, bevestig}

    // ── kleine DOM-helpers (alles via textContent) ──
    function h(tag, props, ...kids) {
      const n = doc.createElement(tag);
      Object.keys(props || {}).forEach(k => {
        if (k === 'tekst') n.textContent = props[k];
        else if (k === 'klik') n.addEventListener('click', props[k]);
        else if (k === 'invoer') n.addEventListener('input', props[k]);
        else if (k === 'wijzig') n.addEventListener('change', props[k]);
        else if (props[k] === true) n.setAttribute(k, '');
        else if (props[k] !== false && props[k] != null) n.setAttribute(k, props[k]);
      });
      kids.flat().forEach(x => { if (x != null && x !== false) n.appendChild(typeof x === 'string' ? doc.createTextNode(x) : x); });
      return n;
    }
    const leeg = n => { while (n && n.firstChild) n.removeChild(n.firstChild); };
    const tekstIn = (id, t) => { const n = el(id); if (n) n.textContent = t == null ? '' : String(t); };
    const toon = (id, ja) => { const n = el(id); if (n) n.hidden = !ja; };
    function melding(t, soort) { const n = el('melding'); if (!n) return; n.textContent = t || ''; n.setAttribute('data-soort', soort || 'info'); }
    const nlDatum = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    const nlTijd = s => { const dt = new Date(s); return isNaN(dt) ? '' : nlDatum(dt.toISOString()) + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'); };
    const veilig = (u, hosts) => { const f = win.veiligeUrl || (C && C.veiligeUrl); return typeof f === 'function' ? f(u, { hosts }) : ''; };
    const foutTekst = e => (e && e.message) || String(e);

    // ── omgeving ──
    function omgeving() {
      const r = Office && Office.context && Office.context.requirements, ok = (n, v) => { try { return !!(r && r.isSetSupported && r.isSetSupported(n, v)); } catch (e) { return false; } };
      const mb = Office && Office.context && Office.context.mailbox, host = mb && mb.diagnostics ? mb.diagnostics.hostName : '';
      return { mailbox15: ok('Mailbox', '1.5'), mailbox18: ok('Mailbox', '1.8'), mailbox110: ok('Mailbox', '1.10'), mailbox113: ok('Mailbox', '1.13'), naa: ok('NestedAppAuth', '1.1'),
        host: host || '', mobiel: /ios|android/i.test(host || '') };
    }

    // ── aanmelden (NAA) ──
    const vraagtInteractie = e => !!e && (e.name === 'InteractionRequiredAuthError' || /interaction_required|consent_required|login_required|no_tokens_found|user_login_error|uiRequired/i.test(String(e.errorCode || e.code || e.message || '')));
    async function aanmelden() {
      if (!d.msal || typeof d.msal.createNestablePublicClientApplication !== 'function') throw new Error('msal-browser 3.x met NAA ontbreekt');
      pca = await d.msal.createNestablePublicClientApplication({ auth: { clientId: cfg.clientId, authority: cfg.authority } });
      win.getGraphToken = () => token();               // mt-core's SharePoint-laag (makeSP) vraagt zijn Graph-token hier
      await token();                                   // meteen vragen: bij ontbrekende toestemming komt de popup nu, niet midden in een actie
    }
    async function token(scopes) {
      const req = { scopes: scopes || cfg.scopes };
      try { const r = await pca.acquireTokenSilent(req); return r.accessToken; }
      catch (e) {
        if (!vraagtInteractie(e)) throw e;
        const r = await pca.acquireTokenPopup(req); return r.accessToken;
      }
    }

    // ── Graph ──
    async function graaf(pad, opt) {
      const tok = await token(opt && opt.gedeeld ? cfg.scopesGedeeld : cfg.scopes), url = /^https:/.test(pad) ? pad : cfg.graph + pad;
      for (let poging = 0; ; poging++) {
        const r = await d.fetch(url, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'IdType="ImmutableId"' } });
        if (r.status === 429 && poging < 1) {
          const sec = Math.min(10, Math.max(1, parseInt((r.headers && r.headers.get && r.headers.get('Retry-After')) || '', 10) || 2));
          await new Promise(res => (d.setTimeout || setTimeout)(res, sec * 1000)); continue;
        }
        if (!r.ok) { const e = new Error('Graph HTTP ' + r.status); e.status = r.status; throw e; }
        try { diag.preferenceApplied = r.headers && r.headers.get ? r.headers.get('Preference-Applied') : null; } catch (e) {}
        return r.json();
      }
    }
    // Schrijven op de mail (categorie, antwoordconcept): eigen scopes, ZONDER ImmutableId-header (het concept-id gaat naar convertToEwsId).
    async function graafSchrijf(methode, pad, body, gedeeld) {
      const tok = await token(gedeeld ? cfg.scopesSchrijfGedeeld : cfg.scopesSchrijf);
      const r = await d.fetch(cfg.graph + pad, { method: methode, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      if (!r.ok) { const e = new Error('Graph HTTP ' + r.status); e.status = r.status; throw e; }
      return r.status === 204 ? {} : r.json().catch(() => ({}));
    }
    async function haalGesprek(base, cid, gedeeld) {
      if (!cid) return [];
      let items = [], volgende = base + '/messages?$filter=' + encodeURIComponent("conversationId eq '" + String(cid).replace(/'/g, "''") + "'") + '&$select=' + cfg.select + '&$top=50', pag = 0;
      while (volgende && pag < ITEM_MAX_PAGINAS) { const r = await graaf(volgende, { gedeeld }); items = items.concat((r && r.value) || []); volgende = r && r['@odata.nextLink']; pag++; }
      return items;
    }

    // ── de geopende mail ──
    const itemNu = () => (Office && Office.context && Office.context.mailbox && Office.context.mailbox.item) || null;
    const isOpstel = it => !!(it && it.subject && typeof it.subject.getAsync === 'function');
    function sharedProps(it) {
      return new Promise(res => {
        if (!it || typeof it.getSharedPropertiesAsync !== 'function') return res(null);
        try { it.getSharedPropertiesAsync(r => res(r && r.status === ((Office.AsyncResultStatus && Office.AsyncResultStatus.Succeeded) || 'succeeded') ? r.value : null)); } catch (e) { res(null); }
      });
    }
    function restId(it, env) {
      const mb = Office.context.mailbox;
      if (!env.mobiel && typeof mb.convertToRestId === 'function') return mb.convertToRestId(it.itemId, (Office.MailboxEnums && Office.MailboxEnums.RestVersion && Office.MailboxEnums.RestVersion.v2_0) || 'v2.0');
      return it.itemId;   // op mobiel is itemId al een REST-id
    }
    const ik = () => { try { const u = Office.context.mailbox.userProfile || {}; return { email: String(u.emailAddress || '').toLowerCase(), naam: M ? M.naamVan(u.emailAddress, u.displayName) : (u.displayName || '') }; } catch (e) { return { email: '', naam: '' }; } };

    // ── opslag-adapter + SharePoint ──
    function adapterZetten() {
      K.opslag = { lees: k => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null), schrijf: (k, t) => { cache[k] = t; gewijzigd.add(k); } };
      K.wie = () => ik().email;
    }
    async function leesZacht(naam) { try { return { ok: true, v: await SP.read(naam + '.json') }; } catch (e) { return { ok: false, fout: foutTekst(e) }; } }
    async function laadGegevens() {
      SP = SP || C.makeSP({ etagKeys: new Set(Object.values(BESTANDEN)), toast: t => melding(t, 'waarschuwing') });
      const [pr, li, jo, op, bi] = await Promise.all([SP.read(BESTANDEN.projecten + '.json'), SP.read(BESTANDEN.links + '.json'), SP.read(BESTANDEN.journaal + '.json'),
        leesZacht(BESTANDEN.oppak), leesZacht(BESTANDEN.bijlagen)]);   // een leesfout van de eerste drie gooit: nooit "leeg" aannemen
      projecten = (Array.isArray(pr) ? pr : []).filter(p => p && p.code && !p._vervallen);
      perCode = new Map(projecten.map(p => [p.code, p]));
      cache[BESTANDEN.links] = JSON.stringify(li && typeof li === 'object' && !Array.isArray(li) ? li : {});
      cache[BESTANDEN.journaal] = JSON.stringify(Array.isArray(jo) ? jo : []);
      // "Pak op" en de bijlage-index zijn los: kunnen ze niet gelezen worden, dan staat alleen die functie uit (nooit leeg overschrijven).
      oppak = op.ok ? (op.v && typeof op.v === 'object' && !Array.isArray(op.v) ? op.v : {}) : null;
      bijlIndex = bi.ok ? (Array.isArray(bi.v) ? bi.v : []) : null;
      if (!op.ok) diag.oppakFout = op.fout; if (!bi.ok) diag.bijlagenFout = bi.fout;
      gewijzigd.clear(); wachtendInCache();
      zoekIndex = Z.index(Z.bronVan({ projecten }, {}));
      voorstelIx = K.voorstelIndex({ projecten, klanten: [], klantenVol: [] });
      resolverIx = P ? P.index(projecten) : null;
      diag.projecten = projecten.length; gegevensTs = Date.now();
    }
    // Gedeelde gegevens hooguit elke minuut opnieuw lezen (collega's koppelen ook), nooit terwijl er een niet-opgeslagen wijziging wacht.
    const verversGegevens = () => (zoekIndex && (gewijzigd.size || Date.now() - gegevensTs < 60000)) ? Promise.resolve() : laadGegevens();
    async function schrijfBestand(k) {
      const samen = k === BESTANDEN.links ? K.linksSamen : K.journaalSamen;
      return SP.write(k + '.json', cache[k], (remote, local) => { const m = samen(JSON.stringify(local), remote); cache[k] = JSON.stringify(m); return m; });
    }
    // Eerst de koppelingen, dan het journaal. Mislukt het journaal, dan staat de koppeling er wél: een deelresultaat, geen fout.
    // nieuweJ = de journaalregels van déze actie: pas NADAT de koppelingen zijn opgeslagen worden ze als "wachtend" bewaard (anders zou een herstart een
    // journaalregel schrijven voor een koppeling die er niet is).
    async function bewaar(nieuweJ) {
      const uit = { links: true, journaal: true };
      if (gewijzigd.has(BESTANDEN.links)) { if (!(await schrijfBestand(BESTANDEN.links))) throw new Error('Opslaan van ' + BESTANDEN.links + ' mislukt'); gewijzigd.delete(BESTANDEN.links); }
      if (nieuweJ && nieuweJ.length) zetWacht(wachtJournaal.concat(nieuweJ.filter(x => !wachtJournaal.some(w => w.id === x.id))));
      if (gewijzigd.has(BESTANDEN.journaal)) {
        if (await schrijfBestand(BESTANDEN.journaal)) { gewijzigd.delete(BESTANDEN.journaal); zetWacht([]); } else uit.journaal = false;
      }
      return uit;
    }
    // Vóór de volgende actie (en bij het starten): wachtende journaalregels alsnog wegschrijven.
    async function flushWachtend() {
      if (!gewijzigd.has(BESTANDEN.journaal) && !wachtJournaal.length) return true;
      if (!gewijzigd.has(BESTANDEN.journaal)) wachtendInCache();
      try { return (await bewaar()).journaal; } catch (e) { return false; }
    }
    // Eén los bestand (Pak op, bijlage-index) met zijn eigen samenvoeger; geeft de samengevoegde stand terug of gooit.
    async function schrijfLos(naam, data, samen) {
      let stand = data;
      const ok = await SP.write(naam + '.json', JSON.stringify(data), (remote, local) => { stand = samen(JSON.stringify(local), remote); return stand; });
      if (!ok) throw new Error('Opslaan van ' + naam + ' mislukt');
      return stand;
    }

    // ── weergave ──
    const projNaam = code => { const p = perCode.get(code); return p ? [p.naam || p.code, p.klant_naam].filter(Boolean).join(' · ') : code; };
    function toolUrl(hash) { try { const b = new URL('../v2.html', d.location.href); const u = b.origin + b.pathname + hash; return veilig(u, [new URL(u).hostname]); } catch (e) { return ''; } }
    function dossierLink(code) {
      const u = toolUrl('#projecten/' + encodeURIComponent(code) + '/dossier');
      return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', tekst: 'Open dossier' }) : null;
    }
    function toonMail() {
      const m = huidig.msg;
      tekstIn('mail-onderwerp', m.subject || '(geen onderwerp)');
      tekstIn('mail-van', (m.from && m.from.emailAddress ? [m.from.emailAddress.name, m.from.emailAddress.address].filter(Boolean).join(' · ') : '') + (m.receivedDateTime ? ' — ' + nlDatum(m.receivedDateTime) : ''));
    }
    // Projectgegevens: nummer, fase, contact en adres (met een navigatielink naar Google Maps of Apple Kaarten).
    function projectBlok(code) {
      const info = M && M.projectInfo(perCode.get(code), { lead: L, project: P, ua: (win.navigator && win.navigator.userAgent) || '' });
      if (!info) return null;
      const regels = [h('div', { class: 'pg-kop' }, h('strong', { tekst: info.nummer }), info.fase ? h('span', { class: 'fase', tekst: ' · ' + info.fase }) : null)];
      const c = info.contact;
      if (c.naam || c.bedrijf) regels.push(h('div', { tekst: 'Contact: ' + [c.naam, c.bedrijf].filter(Boolean).join(', ') }));
      const kanalen = [];
      const mail = c.email && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(c.email) ? h('a', { href: 'mailto:' + c.email, tekst: c.email }) : null;
      if (mail) kanalen.push(mail);
      const tel = String(c.telefoon || '').replace(/[^\d+]/g, '');
      if (tel.length >= 6) kanalen.push(h('a', { href: 'tel:' + tel, tekst: c.telefoon }));
      if (kanalen.length) regels.push(h('div', {}, kanalen.reduce((a, x, i) => a.concat(i ? [' · ', x] : [x]), [])));
      if (info.adres) {
        const nav = info.navUrl ? veilig(info.navUrl, ['google.com', 'apple.com']) : '';
        regels.push(h('div', {}, 'Adres: ', nav ? h('a', { href: nav, target: '_blank', rel: 'noopener noreferrer', title: 'Navigeer naar ' + info.adres, tekst: info.adres + ' (navigeer)' }) : info.adres));
      }
      if (info.volgendeActie && (info.volgendeActie.tekst || info.volgendeActie.datum)) regels.push(h('div', { class: 'sub', tekst: 'Volgende actie: ' + [info.volgendeActie.tekst, nlDatum(info.volgendeActie.datum)].filter(Boolean).join(' — ') }));
      return h('div', { class: 'projectgegevens' }, regels);
    }
    function tekenGekoppeld() {
      const lijst = el('gekoppeld-lijst'), sec = el('gekoppeld'); leeg(lijst);
      const codes = huidig.codes = K.mailProjecten(huidig.msg);
      const elders = K.mailProjectenElders ? K.mailProjectenElders(huidig.msg) : [];
      sec.hidden = !codes.length && !elders.length;
      codes.forEach(code => {
        const rest = (huidig.gesprek || []).filter(x => !K.mailProjecten(x).includes(code)).length;
        const acties = [];
        if (rest) acties.push(h('button', { type: 'button', klik: () => vraagBevestiging(code), tekst: 'Rest van het gesprek ook koppelen (' + rest + ')' }));
        if (huidig.msg.hasAttachments && M) acties.push(h('button', { type: 'button', class: 'secundair', klik: () => bijlagenOpenen(code), tekst: 'Bijlagen naar de projectmap…' }));
        if (INFO) acties.push(h('button', { type: 'button', class: 'secundair', klik: () => vraagAntwoord(code), tekst: 'Antwoord als info@' }));
        lijst.appendChild(h('li', {}, h('span', { class: 'kb-gekoppeld', tekst: '✓ ' + projNaam(code) }), ' ', dossierLink(code), projectBlok(code),
          acties.length ? h('div', { class: 'acties' }, acties) : null));
      });
      // dezelfde mail hangt via een andere postbus al aan een project: geen tweede koppeling nodig; deze kopie mag erbij (dan kan iedereen hem openen)
      elders.forEach(code => lijst.appendChild(h('li', { class: 'elders' }, h('span', { tekst: 'Al gekoppeld aan ' + projNaam(code) + ' via een andere postbus. ' }), dossierLink(code),
        h('div', { class: 'acties' }, h('button', { type: 'button', class: 'secundair', klik: () => vraagBevestiging(code), tekst: 'Ook deze kopie koppelen' })))));
      tekenLead(); tekenOppak();
    }
    function rijMetKnop(code, titel, sub, extra) {
      const n = (huidig.gesprek || []).filter(x => !K.mailProjecten(x).includes(code)).length || 1;
      return h('li', {}, h('strong', { tekst: titel }), sub ? h('span', { class: 'sub', tekst: ' ' + sub }) : null, extra ? h('div', { class: 'waarom', tekst: extra }) : null,
        h('button', { type: 'button', klik: () => vraagBevestiging(code), 'aria-label': 'Koppel het hele gesprek aan ' + titel, tekst: 'Koppel hele gesprek (' + n + ')' }));
    }
    function tekenVoorstel() {
      const lijst = el('voorstel-lijst'); leeg(lijst);
      const v = K.koppelVoorstel(huidig.msg, { index: voorstelIx, gesprek: huidig.gesprek || [] });
      if (!v.length) { lijst.appendChild(h('li', { class: 'leeg', tekst: 'Geen voorstel — zoek hieronder een project.' })); return; }
      v.forEach(x => lijst.appendChild(rijMetKnop(x.code, projNaam(x.code), '', 'Waarom: ' + x.redenen.join('; '))));
    }
    const VIA = { id: 'project-id', code: 'code', nummer: 'projectnummer', werkcode: 'werkcode', alias: 'oude code', offerte: 'offertenummer' };
    // Zoeken: eerst de resolver (exact: projectnummer, oude code, werkcode, offertenummer), dan dezelfde zoeker als de zoekbalk (naam, klant, …).
    function tekenZoek() {
      const lijst = el('zoek-lijst'), q = (el('zoek-veld').value || '').trim(); leeg(lijst);
      if (!q || !zoekIndex || !huidig) return;
      const rijen = [], gezien = new Set();
      const exact = resolverIx ? P.vind(resolverIx, q) : null;
      if (exact && exact.soort === 'een' && exact.project && exact.project.code) {
        gezien.add(exact.project.code);
        rijen.push(rijMetKnop(exact.project.code, projNaam(exact.project.code), '', 'Gevonden op ' + (VIA[exact.via] || exact.via) + ' ' + exact.sleutel));
      } else if (exact && exact.soort === 'ambigu') {
        rijen.push(h('li', { class: 'leeg', tekst: q + ' past bij ' + exact.kandidaten.length + ' projecten (' + (VIA[exact.via] || exact.via) + '); kies hieronder het juiste.' }));
      }
      const r = Z.zoek(zoekIndex, q, { soorten: ['project'], max: 5 }), items = r.groepen.length ? r.groepen[0].items : [];
      items.forEach(it => { if (!it.data || gezien.has(it.data.code)) return; gezien.add(it.data.code); rijen.push(rijMetKnop(it.data.code, it.titel, it.sub, null)); });
      if (!gezien.size) { lijst.appendChild(h('li', { class: 'leeg', tekst: 'Geen project gevonden.' })); rijen.filter(x => x.className === 'leeg').forEach(x => lijst.appendChild(x)); return; }
      rijen.forEach(x => lijst.appendChild(x));
    }

    // ── bevestigen (één venster voor alle acties) ──
    function bevestigVraag(o) {
      if (bezig || !huidig) return;
      huidig.bevestig = o;
      const sec = el('bevestig'); sec.hidden = false;
      el('bevestig-tekst').textContent = o.tekst;
      const ja = el('bevestig-ja'); ja.textContent = o.ok || 'Ja'; if (ja.focus) ja.focus();
    }
    function vraagBevestiging(code) {
      if (bezig) return;
      const nieuw = (huidig.gesprek.length ? huidig.gesprek : [huidig.msg]).filter(m => !K.mailProjecten(m).includes(code));
      bevestigVraag({ soort: 'koppel', code, nieuw, ok: 'Ja, koppel', tekst: nieuw.length + (nieuw.length === 1 ? ' mail' : ' mails') + ' van dit gesprek koppelen aan ' + projNaam(code) + '?' });
    }
    async function voerUit() {
      const b = huidig && huidig.bevestig; if (!b || bezig) return;
      bezig = true; el('bevestig-ja').disabled = true; el('bevestig').hidden = true;
      try {
        if (b.soort === 'koppel') await koppelUit(b);
        else if (b.soort === 'bijlagen') await bijlagenUit(b);
        else if (b.soort === 'antwoord') await antwoordUit(b);
        else if (b.soort === 'oppak') await oppakUit(b);
      } finally { bezig = false; el('bevestig-ja').disabled = false; if (huidig) huidig.bevestig = null; }
    }
    async function koppelUit(b) {
      let snap = null;
      try {
        await flushWachtend();
        snap = { l: cache[BESTANDEN.links], j: cache[BESTANDEN.journaal], g: new Set(gewijzigd) };   // terugdraaien als het opslaan van de koppelingen mislukt
        const voorIds = new Set(parseLijst(cache[BESTANDEN.journaal]).map(x => x && x.id));
        let nieuw = 0, al = 0;
        b.nieuw.forEach(m => {
          const r = K.koppelMail(b.code, m, { bron: 'paneel', mbx: huidig.mbx, idType: 'immutable' });
          if (r.status === 'nieuw' || r.status === 'herkoppeld') nieuw++; else al++;
        });
        const nieuweJ = parseLijst(cache[BESTANDEN.journaal]).filter(x => x && !voorIds.has(x.id));
        const res = await bewaar(nieuweJ);
        const tekstOk = '✓ ' + nieuw + (nieuw === 1 ? ' mail' : ' mails') + ' gekoppeld aan ' + projNaam(b.code) + (al ? ' (' + al + ' waren al gekoppeld)' : '') + '.'
          + (huidig.msg.hasAttachments && M ? ' Deze mail heeft bijlagen: kies "Bijlagen naar de projectmap…" om ze op te slaan.' : '');
        if (res.journaal) melding(tekstOk, 'ok');
        else melding(tekstOk + ' Het journaal is nog niet opgeslagen; dat wordt bij de volgende actie opnieuw geprobeerd.', 'waarschuwing');
        tekenGekoppeld(); tekenVoorstel(); tekenZoek();
      } catch (e) {
        if (snap) { cache[BESTANDEN.links] = snap.l; cache[BESTANDEN.journaal] = snap.j; gewijzigd.clear(); snap.g.forEach(k => gewijzigd.add(k)); if (huidig) { tekenGekoppeld(); tekenVoorstel(); tekenZoek(); } }
        melding('Opslaan lukte niet: ' + foutTekst(e) + '. De koppeling staat nog niet in de tool; probeer het opnieuw.', 'fout');
      }
    }
    function annuleer() { if (huidig) huidig.bevestig = null; el('bevestig').hidden = true; }

    // ── bijlagen → projectmap: per bijlage een voorgestelde submap, de mens kiest en bevestigt ──
    async function bijlagenOpenen(code) {
      const sec = el('bijlagen'), lijst = el('bijlagen-lijst'); leeg(lijst); tekstIn('bijlagen-titel', 'Bijlagen naar ' + projNaam(code));
      const p = perCode.get(code);
      if (!p || !p.map || !p.map.itemId) {
        sec.hidden = false;
        lijst.appendChild(h('li', { class: 'leeg', tekst: 'De projectmap van dit project is nog niet bekend in de tool. Open het dossier in de tool en gebruik daar 📎 (die zoekt of maakt de map); daarna kan het hier.' }));
        return;
      }
      if (!bijlIndex) { sec.hidden = false; lijst.appendChild(h('li', { class: 'leeg', tekst: 'De bijlage-index kon niet worden gelezen; opslaan staat uit om dubbel opslaan te voorkomen. Probeer het later opnieuw.' })); return; }
      melding('Bijlagen ophalen…', 'info');
      let alle;
      try { alle = ((await graaf(huidig.base + '/messages/' + encodeURIComponent(huidig.msg.id) + '/attachments?$select=id,name,contentType,size,isInline', { gedeeld: huidig.mbx !== 'me' })) || {}).value || []; }
      catch (e) { melding('Bijlagen ophalen mislukt: ' + foutTekst(e), 'fout'); return; }
      melding('', 'info');
      const items = alle.filter(x => M.isBestand(x) && String(x.contentType || '').toLowerCase() !== 'message/rfc822');
      const imid = huidig.msg.internetMessageId || huidig.msg.id;
      huidig.bijlagen = { code, imid, items: items.map(x => {
        const id = huidig.mbx + '|' + imid + '|' + x.id, naam = x.name || 'bijlage';
        const uniek = items.filter(y => (y.name || 'bijlage') === naam).length === 1;
        const al = bijlIndex.find(r => r.id === id && r.status === 'opgeslagen' && r.code === code)
          || (uniek ? bijlIndex.find(r => r.status === 'opgeslagen' && r.code === code && r.mbx === huidig.mbx && r.imid === imid && r.naam === naam && (r.grootte == null || r.grootte === x.size)) : null);
        return { attId: x.id, naam, type: x.contentType || '', grootte: x.size || 0, id, sub: al ? al.sub : M.submapVoorstel(naam, x.contentType), aan: !al && (x.size || 0) <= cfg.bijlageMax, al, teGroot: (x.size || 0) > cfg.bijlageMax };
      }) };
      sec.hidden = false;
      if (!items.length) { lijst.appendChild(h('li', { class: 'leeg', tekst: alle.length ? 'Alleen ingesloten bijlagen (bv. logo\'s) of doorgestuurde mails: niets op te slaan.' : 'Deze mail heeft geen bijlagen.' })); return; }
      huidig.bijlagen.items.forEach((it, i) => {
        const vink = h('input', { type: 'checkbox', id: 'bijl-' + i, 'aria-label': 'Opslaan: ' + it.naam });
        vink.checked = it.aan; vink.disabled = it.teGroot; vink.addEventListener('change', () => { it.aan = vink.checked; });
        const kies = h('select', { 'aria-label': 'Submap voor ' + it.naam }, M.SUBMAPPEN.map(s => { const o = h('option', { value: s, tekst: s }); if (s === it.sub) o.selected = true; return o; }));
        kies.addEventListener('change', () => { it.sub = kies.value; });
        lijst.appendChild(h('li', {}, h('label', { for: 'bijl-' + i }, vink, ' ', it.naam, h('span', { class: 'sub', tekst: ' (' + Math.max(1, Math.round(it.grootte / 1024)) + ' kB)' })), ' ', kies,
          it.al ? h('div', { class: 'sub', tekst: '✓ al opgeslagen in ' + it.al.sub }) : null,
          it.teGroot ? h('div', { class: 'sub', tekst: 'Te groot voor het paneel; sla deze op via de tool.' }) : null));
      });
      lijst.appendChild(h('li', {}, h('button', { type: 'button', klik: () => {
        const gekozen = huidig.bijlagen.items.filter(x => x.aan);
        if (!gekozen.length) { melding('Niets aangevinkt — er wordt niets opgeslagen.', 'info'); return; }
        bevestigVraag({ soort: 'bijlagen', code, gekozen, ok: 'Ja, opslaan', tekst: gekozen.length + (gekozen.length === 1 ? ' bijlage' : ' bijlagen') + ' opslaan in de projectmap van ' + projNaam(code) + ' (' + [...new Set(gekozen.map(x => x.sub))].join(', ') + ')? Kopie: de mail blijft in Outlook; er wordt niets overschreven.' });
      }, tekst: 'Aangevinkte opslaan…' })));
    }
    const bytesGelijk = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    // Nooit overschrijven: zelfde naam + zelfde inhoud → overslaan; zelfde naam + andere inhoud → SharePoint geeft een nieuwe naam (rename).
    async function uploadBijlage(map, sub, naam, bytes, type) {
      const veiligNaam = M.veiligeNaam(naam), tok = await token(), auth = { Authorization: 'Bearer ' + tok };
      const pad = cfg.graph + '/drives/' + encodeURIComponent(cfg.projDrive) + '/items/' + encodeURIComponent(map.itemId) + ':/' + [sub, veiligNaam].map(encodeURIComponent).join('/');
      const er = await d.fetch(pad + '?$select=id,name,size,webUrl', { headers: auth });
      if (er.ok) {
        const best = await er.json();
        if (best.size === bytes.length) {
          const cr = await d.fetch(pad + ':/content', { headers: auth });
          if (cr.ok && bytesGelijk(new Uint8Array(await cr.arrayBuffer()), bytes)) return { id: best.id, webUrl: best.webUrl, naam: best.name, status: 'al-aanwezig' };
        }
      } else if (er.status !== 404) throw new Error('controle bestaand bestand HTTP ' + er.status);
      const r = await d.fetch(pad + ':/content?@microsoft.graph.conflictBehavior=rename', { method: 'PUT', headers: Object.assign({ 'Content-Type': type || 'application/octet-stream' }, auth), body: bytes });
      if (!r.ok) throw new Error('upload HTTP ' + r.status);
      const it = await r.json();
      return { id: it.id, webUrl: it.webUrl, naam: it.name || veiligNaam, status: it.name && it.name !== veiligNaam ? 'hernoemd' : 'opgeslagen' };
    }
    async function bijlagenUit(b) {
      const p = perCode.get(b.code), uit = { ok: 0, al: 0, hernoemd: [], fout: 0, laatste: '' }, nieuw = [];
      const tokGraph = await token(huidig.mbx !== 'me' ? cfg.scopesGedeeld : cfg.scopes);
      for (const it of b.gekozen) {
        try {
          melding('Opslaan ' + (uit.ok + uit.al + uit.fout + 1) + '/' + b.gekozen.length + ': ' + it.naam + '…', 'info');
          const r = await d.fetch(cfg.graph + huidig.base + '/messages/' + encodeURIComponent(huidig.msg.id) + '/attachments/' + encodeURIComponent(it.attId) + '/$value', { headers: { Authorization: 'Bearer ' + tokGraph, Prefer: 'IdType="ImmutableId"' } });
          if (!r.ok) throw new Error('bijlage ophalen HTTP ' + r.status);
          const bytes = new Uint8Array(await r.arrayBuffer());
          const res = await uploadBijlage(p.map, it.sub, it.naam, bytes, it.type);
          nieuw.push({ id: it.id, mbx: huidig.mbx, imid: b.imid || huidig.bijlagen.imid, mailId: huidig.msg.id, attId: it.attId, naam: it.naam, grootte: it.grootte, code: b.code, sub: it.sub,
            status: 'opgeslagen', itemId: res.id, webUrl: res.webUrl, opgeslagenAls: res.naam, uitkomst: res.status, bron: 'paneel', tijd: new Date().toISOString() });
          if (res.status === 'al-aanwezig') uit.al++; else { uit.ok++; if (res.status === 'hernoemd') uit.hernoemd.push(it.naam + ' → ' + res.naam); }
        } catch (e) { uit.fout++; uit.laatste = foutTekst(e); }
      }
      let indexOk = true;
      if (nieuw.length) {
        try { bijlIndex = await schrijfLos(BESTANDEN.bijlagen, M.bijlageIndexSamen(JSON.stringify(nieuw), bijlIndex), M.bijlageIndexSamen); }
        catch (e) { indexOk = false; bijlIndex = M.bijlageIndexSamen(JSON.stringify(nieuw), bijlIndex); }
      }
      const delen = [];
      if (uit.ok) delen.push(uit.ok + ' opgeslagen');
      if (uit.al) delen.push(uit.al + ' stond' + (uit.al === 1 ? '' : 'en') + ' er al (overgeslagen)');
      if (uit.hernoemd.length) delen.push('nieuwe naam omdat er al een ander bestand zo heette: ' + uit.hernoemd.join(', '));
      if (uit.fout) delen.push(uit.fout + ' mislukt (' + uit.laatste + ') — probeer opnieuw');
      if (!indexOk) delen.push('de bijlage-index is nog niet bijgewerkt');
      melding((uit.fout || !indexOk ? '⚠ ' : '✓ ') + 'Bijlagen ' + projNaam(b.code) + ': ' + delen.join(' · '), uit.fout || !indexOk ? 'waarschuwing' : 'ok');
      el('bijlagen').hidden = true;
    }

    // ── "Maak lead van deze mail": de echte aanmaakroute in de tool (nummer, volgende actie met datum verplicht, hele gesprek gekoppeld) ──
    function tekenLead() {
      const sec = el('lead'); if (!sec) return;
      const gekoppeld = (huidig.codes || []).length > 0;
      sec.hidden = !huidig || !M;
      if (sec.hidden) return;
      const lijst = el('lead-inhoud'); leeg(lijst);
      if (gekoppeld) { lijst.appendChild(h('p', { class: 'sub', tekst: 'Dit gesprek hangt al aan ' + huidig.codes.map(projNaam).join(', ') + '; een nieuwe lead is niet nodig.' })); return; }
      const v = M.leadVoorstel(huidig.msg);
      lijst.appendChild(h('p', { class: 'sub', tekst: 'Voorstel: titel "' + (v.titel || '(geen onderwerp)') + '", contact ' + [v.klant_naam, v.klant_email].filter(Boolean).join(' · ') + ', bron mail. In de tool vul je de volgende actie met datum in (verplicht); daarna wordt het hele gesprek (' + (huidig.gesprek || []).length + ') gekoppeld.' }));
      const u = toolUrl('#lead/nieuw?mbx=' + encodeURIComponent(huidig.mbx) + '&mail=' + encodeURIComponent(huidig.msg.id));
      if (u) lijst.appendChild(h('a', { class: 'knop', href: u, target: '_blank', rel: 'noopener noreferrer', tekst: 'Maak lead van deze mail' }));
    }

    // ── "Pak op": wie pakt dit gesprek op (gedeelde postbus) ──
    const oppakSleutel = () => (M && huidig ? M.oppakSleutel(huidig.mbx, huidig.msg.conversationId) : '');
    function tekenOppak() {
      const sec = el('oppak'); if (!sec) return;
      const kan = !!(M && huidig && huidig.mbx !== 'me' && huidig.msg.conversationId);
      sec.hidden = !kan; if (!kan) return;
      const inh = el('oppak-inhoud'); leeg(inh);
      if (!oppak) { inh.appendChild(h('p', { class: 'sub', tekst: 'Wie wat oppakt kon niet worden gelezen; deze functie staat even uit.' })); return; }
      const rec = oppak[oppakSleutel()], mij = ik();
      if (rec && rec.status === 'opgepakt') inh.appendChild(h('p', { tekst: 'Opgepakt door ' + (rec.door === mij.email ? 'jou' : rec.naam || rec.door) + (rec.tijd ? ' (' + nlTijd(rec.tijd) + ')' : '') }));
      else if (rec && rec.status === 'afgehandeld') inh.appendChild(h('p', { tekst: 'Afgehandeld door ' + (rec.naam || rec.door) + ': ' + redenLabel(rec.reden) + (rec.toelichting ? ' — ' + rec.toelichting : '') + (rec.tijd ? ' (' + nlTijd(rec.tijd) + ')' : '') }));
      else inh.appendChild(h('p', { class: 'sub', tekst: 'Nog door niemand opgepakt.' }));
      const knoppen = [];
      if (!rec || rec.status !== 'opgepakt' || rec.door !== mij.email) knoppen.push(h('button', { type: 'button', klik: () => pakOp('opgepakt'), tekst: rec && rec.status === 'opgepakt' ? 'Zelf oppakken' : 'Pak op' }));
      if (rec && rec.status === 'opgepakt' && rec.door === mij.email) knoppen.push(h('button', { type: 'button', class: 'secundair', klik: () => pakOp('vrij'), tekst: 'Terugzetten' }));
      if (!rec || rec.status !== 'afgehandeld') {
        const kies = h('select', { id: 'oppak-reden', 'aria-label': 'Reden van afhandelen' }, [h('option', { value: '', tekst: 'Afhandelen: kies een reden…' })].concat(M.AFHANDEL_REDENEN.map(r => h('option', { value: r[0], tekst: r[1] }))));
        const knop = h('button', { type: 'button', class: 'secundair', disabled: true, klik: () => pakOp('afgehandeld', kies.value), tekst: 'Afhandelen' });
        kies.addEventListener('change', () => { knop.disabled = !kies.value; });
        knoppen.push(h('span', { class: 'afhandel' }, kies, ' ', knop));
      } else knoppen.push(h('button', { type: 'button', class: 'secundair', klik: () => pakOp('opgepakt'), tekst: 'Weer oppakken' }));
      inh.appendChild(h('div', { class: 'acties' }, knoppen));
    }
    const redenLabel = r => { const x = M && M.AFHANDEL_REDENEN.find(y => y[0] === r); return x ? x[1] : (r || ''); };
    function pakOp(status, reden) {
      if (status === 'afgehandeld') bevestigVraag({ soort: 'oppak', status, reden, ok: 'Ja, afhandelen', tekst: 'Dit gesprek afhandelen met reden "' + redenLabel(reden) + '"? In "Binnenkomend" staat het dan als afgehandeld.' });
      else { huidig.bevestig = { soort: 'oppak', status, reden: '' }; return voerUit(); }   // oppakken en terugzetten: één klik, altijd terug te draaien
    }
    async function oppakUit(b) {
      const sleutel = oppakSleutel(); if (!sleutel || !oppak) return;
      const mij = ik(), oud = oppak[sleutel] || null, snap = oppak;
      let rec;
      try { rec = M.oppakRecord(oud, { status: b.status, reden: b.reden, mbx: huidig.mbx, conversationId: huidig.msg.conversationId, door: mij.email, naam: mij.naam, codes: huidig.codes || [] }, Date.now()); }
      catch (e) { melding(foutTekst(e), 'fout'); return; }
      try { oppak = await schrijfLos(BESTANDEN.oppak, Object.assign({}, oppak, { [sleutel]: rec }), M.oppakSamen); }
      catch (e) { oppak = snap; tekenOppak(); melding('Vastleggen lukte niet: ' + foutTekst(e) + '. Er is niets gewijzigd; probeer het opnieuw.', 'fout'); return; }
      tekenOppak();
      const wat = b.status === 'opgepakt' ? 'Opgepakt door jou' : b.status === 'vrij' ? 'Teruggezet: niemand pakt het nu op' : 'Afgehandeld (' + redenLabel(b.reden) + ')';
      if (b.status === 'afgehandeld') { melding('✓ ' + wat + '.', 'ok'); return; }
      // De Outlook-categorie "Opgepakt: <naam>" op de mails van dit gesprek in de gedeelde postbus (een andere "Opgepakt: …" gaat eraf).
      try {
        const lijst = await graaf(huidig.base + '/messages?$filter=' + encodeURIComponent("conversationId eq '" + String(huidig.msg.conversationId).replace(/'/g, "''") + "'") + '&$select=id,categories&$top=50', { gedeeld: true });
        let n = 0;
        for (const m of ((lijst && lijst.value) || []).slice(0, 50)) {
          const nieuw = M.categorieenNa(m.categories, b.status === 'opgepakt' ? mij.naam : '');
          if (JSON.stringify(nieuw) === JSON.stringify(m.categories || [])) continue;
          await graafSchrijf('PATCH', huidig.base + '/messages/' + encodeURIComponent(m.id), { categories: nieuw }, true); n++;
        }
        melding('✓ ' + wat + '.' + (n ? ' Categorie in Outlook bijgewerkt (' + n + (n === 1 ? ' mail' : ' mails') + ').' : ''), 'ok');
      } catch (e) {
        melding('✓ ' + wat + ' (vastgelegd in de tool). De categorie in Outlook lukte niet (' + foutTekst(e) + (e && e.status === 403 ? ': de machtiging Mail.ReadWrite.Shared of Volledige toegang op de postbus ontbreekt, zie outlook/README.md' : '') + ').', 'waarschuwing');
      }
    }

    // ── "Antwoord als info@": een antwoordconcept met Van = info@ en de projecttag in het onderwerp ──
    function vraagAntwoord(code) {
      const p = perCode.get(code), nr = M ? M.nummerVan(p) : '';
      bevestigVraag({ soort: 'antwoord', code, nr, ok: 'Ja, maak concept', tekst: 'Een antwoordconcept (allen beantwoorden) maken met Van: ' + INFO + (nr ? ' en ' + M.tag(nr) + ' in het onderwerp' : ' (dit project heeft nog geen projectnummer, dus geen tag in het onderwerp)')
        + '? Verzenden als info@ vereist "Verzenden als"-rechten op info@; zonder die rechten weigert Outlook het verzenden.' });
    }
    async function antwoordUit(b) {
      try {
        melding('Concept maken…', 'info');
        let base = huidig.base, bronId = huidig.msg.id, gedeeld = huidig.mbx !== 'me', vanZetten = false;
        if (huidig.mbx !== INFO) {
          // Staat dezelfde mail ook in info@? Dan het antwoord vanuit info@ zelf (het concept staat dan in de concepten van info@).
          let kopie = [];
          try { kopie = ((await graaf('/users/' + encodeURIComponent(INFO) + '/messages?$filter=' + encodeURIComponent("internetMessageId eq '" + String(huidig.msg.internetMessageId || '').replace(/'/g, "''") + "'") + '&$select=id&$top=2', { gedeeld: true })) || {}).value || []; }
          catch (e) { kopie = []; }
          if (huidig.msg.internetMessageId && kopie.length === 1) { base = '/users/' + encodeURIComponent(INFO); gedeeld = true; bronId = kopie[0].id; }
          else { vanZetten = true; }                     // niet in info@: antwoord vanuit de eigen postbus, Van = info@
        }
        const concept = await graafSchrijf('POST', base + '/messages/' + encodeURIComponent(bronId) + '/createReplyAll', {}, gedeeld);
        const patch = { subject: M.onderwerpMetTag(concept.subject || ('RE: ' + (huidig.msg.subject || '')), b.nr) };
        if (vanZetten) patch.from = { emailAddress: { address: INFO } };
        await graafSchrijf('PATCH', base + '/messages/' + encodeURIComponent(concept.id), patch, gedeeld);
        const mb = Office.context.mailbox, rv = (Office.MailboxEnums && Office.MailboxEnums.RestVersion && Office.MailboxEnums.RestVersion.v2_0) || 'v2.0';
        if (mb && typeof mb.displayMessageForm === 'function' && typeof mb.convertToEwsId === 'function') {
          mb.displayMessageForm(mb.convertToEwsId(concept.id, rv));
          melding('✓ Concept geopend: Van ' + INFO + ', onderwerp "' + patch.subject + '". Lukt verzenden niet, dan ontbreken de "Verzenden als"-rechten op info@ (beheerder, zie outlook/README.md).', 'ok');
        } else {
          melding('✓ Concept staat klaar in Concepten (' + (gedeeld ? INFO : 'je eigen postbus') + '): onderwerp "' + patch.subject + '".', 'ok');
        }
      } catch (e) {
        const st = e && e.status;
        melding(st === 403 || st === 401 ? 'Concept maken mislukt (' + st + '): geen schrijfrechten op info@. Nodig: Volledige toegang op info@ en de machtiging Mail.ReadWrite.Shared (zie outlook/README.md).'
          : 'Concept maken mislukt: ' + foutTekst(e), 'fout');
      }
    }

    function toonDiagnose() { const n = el('diagnose-tekst'); if (n) n.textContent = JSON.stringify(diag, null, 1); }

    // Wat Office.js zonder netwerk weet: onderwerp en afzender (altijd tonen, ook als aanmelden of de gedeelde gegevens straks falen).
    function basis(it) {
      tekstIn('mail-onderwerp', it ? (typeof it.subject === 'string' ? it.subject : '') || (isOpstel(it) ? '' : '(geen onderwerp)') : '');
      tekstIn('mail-van', it && it.from && typeof it.from.getAsync !== 'function' ? [it.from.displayName, it.from.emailAddress].filter(Boolean).join(' · ') : '');
    }
    // ── één mail laden (ook bij ItemChanged in een vastgepind paneel) ──
    async function laadItem() {
      const mijn = ++teller, it = itemNu(), env = diag.omgeving;
      huidig = null; annuleer(); melding('');
      ['gekoppeld-lijst', 'voorstel-lijst', 'zoek-lijst', 'bijlagen-lijst', 'lead-inhoud', 'oppak-inhoud'].forEach(id => leeg(el(id)));
      ['gekoppeld', 'bijlagen', 'lead', 'oppak'].forEach(id => toon(id, false));
      basis(it);
      if (!it) { melding('Open een mail om hem te koppelen.', 'info'); return; }
      diag.item = { itemIdLengte: String(it.itemId || '').length, conversationId: !!it.conversationId };
      try {
        // 2. Graph-id (REST) en eventueel de gedeelde postbus
        const shared = env.mailbox18 || env.mailbox113 ? await sharedProps(it) : null;
        const doel = shared && shared.targetMailbox ? String(shared.targetMailbox).toLowerCase() : '';
        if (doel && !env.mailbox113) {   // de gedeelde postbus vraagt Mailbox 1.13 (en Mail.Read.Shared): op een oudere client een nette melding, geen Graph-aanroep
          melding('Deze mail staat in een gedeelde postbus (' + doel + '). Dat wordt pas ondersteund vanaf Outlook met Mailbox 1.13; werk Outlook bij of koppel de mail via de cockpit.', 'fout');
          diag.postbus = doel; diag.fout = 'gedeelde postbus zonder Mailbox 1.13'; toonDiagnose(); return;
        }
        const base = doel ? '/users/' + encodeURIComponent(doel) : '/me', mbx = doel || 'me';
        const rid = restId(it, env);
        diag.restId = { omgezet: rid !== it.itemId, lengte: String(rid || '').length }; diag.postbus = doel || 'eigen';
        melding('Mail ophalen…', 'info');
        const gedeeld = !!doel;
        const msg = await graaf(base + '/messages/' + encodeURIComponent(rid) + '?$select=' + cfg.select, { gedeeld });
        if (mijn !== teller) return;
        diag.graphId = { gelijkAanRestId: msg.id === rid, lengte: String(msg.id || '').length }; diag.immutableHeader = diag.preferenceApplied || '(geen Preference-Applied in het antwoord)';
        // 3. het hele gesprek (voor het voorstel en de koppelknop) en de gedeelde gegevens
        const [gesprek] = await Promise.all([haalGesprek(base, msg.conversationId, gedeeld).catch(e => { diag.gesprekFout = String(e.message || e); return []; }), verversGegevens()]);
        if (mijn !== teller) return;
        const gm = gesprek.map(x => Object.assign({}, x, { mbx }));
        if (!gm.some(x => K.sleutel(x) === K.sleutel(msg))) gm.push(Object.assign({}, msg, { mbx }));   // de geopende mail hoort er altijd bij
        huidig = { msg: Object.assign({}, msg, { mbx }), mbx, base, gesprek: gm, codes: [] };
        diag.gesprek = huidig.gesprek.length;
        melding('', 'info'); toonMail(); tekenGekoppeld(); tekenVoorstel(); tekenZoek();
      } catch (e) {
        if (mijn !== teller) return;
        const status = e && e.status;
        melding(status === 401 || status === 403 ? 'Geen toegang tot deze mail of de gedeelde gegevens (' + status + '). Controleer de Azure-instellingen in outlook/README.md.'
          : status === 404 ? 'Deze mail is in Graph niet gevonden (404) — mogelijk een andere postbus dan je eigen.'
          : 'Ophalen mislukt: ' + foutTekst(e), 'fout');
        diag.fout = foutTekst(e);
      }
      toonDiagnose();
    }

    // ── het opstelvenster (antwoord): info@ in de cc bij een gekoppeld gesprek ──
    const asyncWaarde = (f, ...a) => new Promise(res => { try { f(...a, r => res(r && r.status === ((Office.AsyncResultStatus && Office.AsyncResultStatus.Succeeded) || 'succeeded') ? r.value : null)); } catch (e) { res(null); } });
    function autoCcAan() { try { return Office.context.roamingSettings.get(VLAG_AUTO_CC) === true; } catch (e) { return false; } }
    async function zetAutoCc(aan) {
      try { const rs = Office.context.roamingSettings; if (aan) rs.set(VLAG_AUTO_CC, true); else rs.remove(VLAG_AUTO_CC); await new Promise(res => rs.saveAsync(() => res())); return true; }
      catch (e) { return false; }
    }
    async function laadOpstel() {
      const it = itemNu(), sec = el('opstel'), inh = el('opstel-inhoud'); if (!sec || !inh) return;
      ['gekoppeld', 'bijlagen', 'lead', 'oppak'].forEach(id => toon(id, false));
      ['h-voorstel', 'h-zoek'].forEach(id => { const n = el(id); if (n && n.parentNode) n.parentNode.hidden = true; });
      sec.hidden = false; leeg(inh); melding('', 'info');
      const [onderwerp, aan, cc, bcc, van] = await Promise.all([asyncWaarde(it.subject.getAsync.bind(it.subject)), it.to && it.to.getAsync ? asyncWaarde(it.to.getAsync.bind(it.to)) : null,
        it.cc && it.cc.getAsync ? asyncWaarde(it.cc.getAsync.bind(it.cc)) : null, it.bcc && it.bcc.getAsync ? asyncWaarde(it.bcc.getAsync.bind(it.bcc)) : null,
        it.from && typeof it.from.getAsync === 'function' ? asyncWaarde(it.from.getAsync.bind(it.from)) : null]);
      tekstIn('mail-onderwerp', onderwerp || '(nog geen onderwerp)'); tekstIn('mail-van', '');
      const nr = M ? M.tagUitOnderwerp(onderwerp) : '';
      const nodig = M && M.ccInfoNodig({ info: INFO, conversationId: it.conversationId, onderwerp, aan: aan || [], cc: cc || [], bcc: bcc || [], van: van && van.emailAddress });
      if (!it.conversationId || !nr) inh.appendChild(h('p', { class: 'sub', tekst: nr ? 'Nieuw bericht (geen antwoord): info@ hoeft niet in de cc.' : 'Geen projecttag ([26…]) in het onderwerp: dit is (nog) geen antwoord op een gekoppeld gesprek.' }));
      else if (nodig) {
        inh.appendChild(h('p', { class: 'let', tekst: 'Antwoord op een gekoppeld gesprek (' + M.tag(nr) + '): info@ staat nog niet in de cc.' }));
        inh.appendChild(h('button', { type: 'button', klik: async () => {
          const r = await new Promise(res => { try { it.cc.addAsync([INFO], x => res(x)); } catch (e) { res({ status: 'failed', error: e }); } });
          if (r && r.status === ((Office.AsyncResultStatus && Office.AsyncResultStatus.Succeeded) || 'succeeded')) { melding('✓ info@ staat in de cc.', 'ok'); laadOpstel(); }
          else melding('info@ in de cc zetten lukte niet; zet hem er met de hand bij.', 'fout');
        }, tekst: 'Zet info@ in de cc' }));
      } else inh.appendChild(h('p', { class: 'ok', tekst: '✓ info@ krijgt dit antwoord (' + M.tag(nr) + ').' }));
      // proef-vlag: automatisch info@ in de cc (alleen met het manifest met gebeurtenissen; standaard uit)
      const vink = h('input', { type: 'checkbox', id: 'auto-cc' }); vink.checked = autoCcAan();
      vink.addEventListener('change', async () => { const ok = await zetAutoCc(vink.checked); melding(ok ? (vink.checked ? 'Automatisch info@ in de cc staat aan (proef).' : 'Automatisch info@ in de cc staat uit.') : 'Opslaan van de instelling lukte niet.', ok ? 'ok' : 'fout'); });
      inh.appendChild(h('p', { class: 'sub' }, h('label', { for: 'auto-cc' }, vink, ' Automatisch info@ in de cc bij antwoorden op gekoppelde gesprekken (proef, standaard uit; werkt alleen met het manifest met gebeurtenissen, zie README)')));
      diag.opstel = { conversationId: !!it.conversationId, tag: !!nr, nodig: !!nodig, autoCc: autoCcAan() }; toonDiagnose();
    }

    // ── starten ──
    async function start(info) {
      const mb = Office && Office.context && Office.context.mailbox;
      if (!mb || (info && info.host && Office.HostType && info.host !== Office.HostType.Outlook)) { melding('Dit paneel werkt alleen in Outlook.', 'fout'); return; }
      const env = diag.omgeving = omgeving(); toonDiagnose();
      if (!env.mailbox15) { melding('Deze Outlook-versie is te oud voor het MT-paneel (Mailbox 1.5 nodig).', 'fout'); return; }
      if (isOpstel(itemNu())) { await laadOpstel(); return; }   // opstelvenster: geen aanmelding of Graph nodig
      adapterZetten(); basis(itemNu());
      const cockpit = new URL('../v2.html', d.location.href).href;
      if (!env.naa) {   // terugval: geen nested app authentication in deze Outlook-versie
        melding('Aanmelden in Outlook (NAA) wordt in deze Outlook-versie niet ondersteund. Koppel de mail via de cockpit: ' + cockpit, 'fout');
        toonDiagnose(); return;
      }
      try { melding('Aanmelden…', 'info'); await aanmelden(); }
      catch (e) { melding('Aanmelden mislukt: ' + foutTekst(e) + '. Controleer de Azure-redirect en Conditional Access (zie outlook/README.md).', 'fout'); diag.aanmeldFout = foutTekst(e); toonDiagnose(); return; }
      try { await laadGegevens(); }
      catch (e) { melding('De projecten en koppelingen konden niet worden gelezen (' + foutTekst(e) + '). Er wordt niets gewijzigd.', 'fout'); diag.gegevensFout = foutTekst(e); toonDiagnose(); return; }
      if (wachtJournaal.length || gewijzigd.has(BESTANDEN.journaal)) await flushWachtend();   // een journaal dat vorige keer niet lukte
      el('bevestig-ja').addEventListener('click', voerUit); el('bevestig-nee').addEventListener('click', annuleer);
      el('zoek-veld').addEventListener('input', tekenZoek);
      try { mb.addHandlerAsync(Office.EventType.ItemChanged, () => { laadItem(); }); } catch (e) { diag.itemChanged = 'niet beschikbaar'; }
      await laadItem();
    }

    return { start, laadItem, voerUit, annuleer, omgeving, diag, _cache: cache, _wacht: () => wachtJournaal, _oppak: () => oppak, _bijlIndex: () => bijlIndex };
  }

  root.MTPaneel = { maak, CONFIG, BESTANDEN, VLAG_AUTO_CC };
  if (root.Office && typeof root.Office.onReady === 'function' && !root.__MT_PANEEL_TEST) {
    root.Office.onReady(info => {
      const p = maak({ Office: root.Office, msal: root.msal, fetch: (u, i) => root.fetch(u, i), document: root.document, window: root, location: root.location,
        MTKoppel: root.MTKoppel, MTZoek: root.MTZoek, MTCore: root.MTCore, MTProject: root.MTProject, MTLead: root.MTLead, MTMail: root.MTMail });
      root.__paneel = p; p.start(info);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
