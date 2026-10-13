/* ============================================================================
 * outlook/pane.js — het MT-paneel in Outlook (spike): de geopende mail koppelen aan een project
 * ----------------------------------------------------------------------------
 * Draait als taakvenster naast een geopende mail (Office.js, Mailbox ≥ 1.5). Aanmelden via NAA (nested app authentication,
 * msal-browser 3.x), daarna rechtstreeks naar Graph — de worker wordt NIET gebruikt (een ID-token onder NAA is onbetrouwbaar).
 * Hergebruikt de gedeelde modules: mt-core.js (esc, veiligeUrl, SharePoint-synclaag), mt-koppel.js (koppelen, voorstellen, samenvoegen)
 * en mt-zoek.js (dezelfde projectzoeker als de zoekbalk). De koppelingen staan in dezelfde privé SharePoint-bestanden als in de cockpit
 * (mt_mail_links.json, mt_koppel_journaal.json); het paneel leest mt_projecten.json. Niets staat in de repo of in localStorage.
 *
 * Testbaar: maak(deps) krijgt Office, msal, fetch, document, … mee (zie zoek-outlook-harness); zonder deps start het vanzelf op Office.onReady.
 * Veiligheid: alle tekst komt via textContent; links via veiligeUrl (https + vaste host); geen innerHTML, geen inline handlers.
 * ========================================================================== */
(function (root) {
  'use strict';

  // clientId en tenant zijn geen geheimen (staan ook publiek in v2.html). Scopes: een deelverzameling van wat de cockpit al heeft.
  const CONFIG = {
    clientId: 'a091db96-24ed-4b64-8b9d-7c55bc86cfdb',
    authority: 'https://login.microsoftonline.com/15b652c3-ff53-433f-a29d-e9626cbafb41',
    scopes: ['https://graph.microsoft.com/Files.ReadWrite', 'https://graph.microsoft.com/Sites.ReadWrite.All', 'https://graph.microsoft.com/Mail.Read'],
    // Alleen voor een gedeelde postbus (info@) erbij gevraagd, zodat wie dat niet gebruikt er ook niet om hoeft toe te stemmen.
    scopesGedeeld: ['https://graph.microsoft.com/Files.ReadWrite', 'https://graph.microsoft.com/Sites.ReadWrite.All', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Mail.Read.Shared'],
    graph: 'https://graph.microsoft.com/v1.0',
    select: 'id,internetMessageId,conversationId,subject,from,receivedDateTime,webLink,hasAttachments'   // bewust zonder mailtekst of preview
  };
  const BESTANDEN = { projecten: 'mt_projecten', links: 'mt_mail_links', journaal: 'mt_koppel_journaal' };
  const ITEM_MAX_PAGINAS = 10;
  const WACHT_SLEUTEL = 'mt_paneel_journaal_wacht';   // enige sessionStorage-sleutel: journaalregels die nog niet naar SharePoint zijn

  function maak(d) {
    const doc = d.document, Office = d.Office, win = d.window || root;
    const cfg = Object.assign({}, CONFIG, d.config || {});
    const K = d.MTKoppel, Z = d.MTZoek, C = d.MTCore;
    const el = id => doc.getElementById(id);
    const diag = {};                                  // wat de spike moet bewijzen; staat in het uitklapblok "Diagnose"
    const cache = {}, gewijzigd = new Set();          // opslag-adapter voor MTKoppel: geheugen, schrijven naar SharePoint na elke actie
    let pca = null, SP = null, projecten = [], perCode = new Map(), zoekIndex = null, voorstelIx = null;
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
    }     // huidig = {msg, mbx, base, gesprek, codes}

    // ── kleine DOM-helpers (alles via textContent) ──
    function h(tag, props, ...kids) {
      const n = doc.createElement(tag);
      Object.keys(props || {}).forEach(k => {
        if (k === 'tekst') n.textContent = props[k];
        else if (k === 'klik') n.addEventListener('click', props[k]);
        else if (k === 'invoer') n.addEventListener('input', props[k]);
        else n.setAttribute(k, props[k]);
      });
      kids.flat().forEach(x => { if (x != null) n.appendChild(typeof x === 'string' ? doc.createTextNode(x) : x); });
      return n;
    }
    const leeg = n => { while (n && n.firstChild) n.removeChild(n.firstChild); };
    const tekstIn = (id, t) => { const n = el(id); if (n) n.textContent = t == null ? '' : String(t); };
    function melding(t, soort) { const n = el('melding'); if (!n) return; n.textContent = t || ''; n.setAttribute('data-soort', soort || 'info'); }
    const nlDatum = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
    const veilig = (u, hosts) => { const f = win.veiligeUrl || (C && C.veiligeUrl); return typeof f === 'function' ? f(u, { hosts }) : ''; };

    // ── omgeving ──
    function omgeving() {
      const r = Office && Office.context && Office.context.requirements, ok = (n, v) => { try { return !!(r && r.isSetSupported && r.isSetSupported(n, v)); } catch (e) { return false; } };
      const mb = Office && Office.context && Office.context.mailbox, host = mb && mb.diagnostics ? mb.diagnostics.hostName : '';
      return { mailbox15: ok('Mailbox', '1.5'), mailbox18: ok('Mailbox', '1.8'), mailbox113: ok('Mailbox', '1.13'), naa: ok('NestedAppAuth', '1.1'),
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

    // ── Graph (alleen lezen; schrijven gaat via SharePoint met ETag) ──
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
    async function haalGesprek(base, cid, gedeeld) {
      if (!cid) return [];
      let items = [], volgende = base + '/messages?$filter=' + encodeURIComponent("conversationId eq '" + String(cid).replace(/'/g, "''") + "'") + '&$select=' + cfg.select + '&$top=50', pag = 0;
      while (volgende && pag < ITEM_MAX_PAGINAS) { const r = await graaf(volgende, { gedeeld }); items = items.concat((r && r.value) || []); volgende = r && r['@odata.nextLink']; pag++; }
      return items;
    }

    // ── de geopende mail ──
    const itemNu = () => (Office && Office.context && Office.context.mailbox && Office.context.mailbox.item) || null;
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

    // ── opslag-adapter + SharePoint ──
    function adapterZetten() {
      K.opslag = { lees: k => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null), schrijf: (k, t) => { cache[k] = t; gewijzigd.add(k); } };
      K.wie = () => { try { return ((Office.context.mailbox.userProfile && Office.context.mailbox.userProfile.emailAddress) || '').toLowerCase(); } catch (e) { return ''; } };
    }
    async function laadGegevens() {
      SP = SP || C.makeSP({ etagKeys: new Set(Object.values(BESTANDEN)), toast: t => melding(t, 'waarschuwing') });
      const [pr, li, jo] = await Promise.all([SP.read(BESTANDEN.projecten + '.json'), SP.read(BESTANDEN.links + '.json'), SP.read(BESTANDEN.journaal + '.json')]);   // een leesfout gooit: nooit "leeg" aannemen
      projecten = (Array.isArray(pr) ? pr : []).filter(p => p && p.code && !p._vervallen);
      perCode = new Map(projecten.map(p => [p.code, p]));
      cache[BESTANDEN.links] = JSON.stringify(li && typeof li === 'object' && !Array.isArray(li) ? li : {});
      cache[BESTANDEN.journaal] = JSON.stringify(Array.isArray(jo) ? jo : []);
      gewijzigd.clear(); wachtendInCache();
      zoekIndex = Z.index(Z.bronVan({ projecten }, {}));
      voorstelIx = K.voorstelIndex({ projecten, klanten: [], klantenVol: [] });
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

    // ── weergave ──
    const projNaam = code => { const p = perCode.get(code); return p ? [p.naam || p.code, p.klant_naam].filter(Boolean).join(' · ') : code; };
    function dossierLink(code) {
      let u = ''; try { const b = new URL('../v2.html', d.location.href); u = b.origin + b.pathname + '#projecten/' + encodeURIComponent(code) + '/dossier'; } catch (e) { return null; }
      const veiligUrl = veilig(u, [new URL(u).hostname]);
      return veiligUrl ? h('a', { href: veiligUrl, target: '_blank', rel: 'noopener noreferrer', tekst: 'Open dossier' }) : null;
    }
    function toonMail() {
      const m = huidig.msg;
      tekstIn('mail-onderwerp', m.subject || '(geen onderwerp)');
      tekstIn('mail-van', (m.from && m.from.emailAddress ? [m.from.emailAddress.name, m.from.emailAddress.address].filter(Boolean).join(' · ') : '') + (m.receivedDateTime ? ' — ' + nlDatum(m.receivedDateTime) : ''));
    }
    function tekenGekoppeld() {
      const lijst = el('gekoppeld-lijst'), sec = el('gekoppeld'); leeg(lijst);
      const codes = huidig.codes = K.mailProjecten(huidig.msg);
      sec.hidden = !codes.length;
      codes.forEach(code => {
        const rest = (huidig.gesprek || []).filter(x => !K.mailProjecten(x).includes(code)).length;
        lijst.appendChild(h('li', {}, h('span', { class: 'kb-gekoppeld', tekst: '✓ ' + projNaam(code) }), ' ', dossierLink(code),
          rest ? [' ', h('button', { type: 'button', klik: () => vraagBevestiging(code), tekst: 'Rest van het gesprek ook koppelen (' + rest + ')' })] : null));
      });
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
    function tekenZoek() {
      const lijst = el('zoek-lijst'), q = (el('zoek-veld').value || '').trim(); leeg(lijst);
      if (!q || !zoekIndex || !huidig) return;
      const r = Z.zoek(zoekIndex, q, { soorten: ['project'], max: 5 }), items = r.groepen.length ? r.groepen[0].items : [];
      if (!items.length) { lijst.appendChild(h('li', { class: 'leeg', tekst: 'Geen project gevonden.' })); return; }
      items.forEach(it => lijst.appendChild(rijMetKnop(it.data.code, it.titel, it.sub, null)));
    }
    function vraagBevestiging(code) {
      if (bezig) return;
      const nieuw = (huidig.gesprek.length ? huidig.gesprek : [huidig.msg]).filter(m => !K.mailProjecten(m).includes(code));
      const sec = el('bevestig'), tk = el('bevestig-tekst'); sec.hidden = false;
      huidig.bevestig = { code, nieuw };
      tk.textContent = nieuw.length + (nieuw.length === 1 ? ' mail' : ' mails') + ' van dit gesprek koppelen aan ' + projNaam(code) + '?';
      const ja = el('bevestig-ja'); if (ja && ja.focus) ja.focus();
    }
    async function voerUit() {
      const b = huidig && huidig.bevestig; if (!b || bezig) return;
      bezig = true; el('bevestig-ja').disabled = true; el('bevestig').hidden = true;
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
        const tekstOk = '✓ ' + nieuw + (nieuw === 1 ? ' mail' : ' mails') + ' gekoppeld aan ' + projNaam(b.code) + (al ? ' (' + al + ' waren al gekoppeld)' : '') + '.';
        if (res.journaal) melding(tekstOk, 'ok');
        else melding(tekstOk + ' Het journaal is nog niet opgeslagen; dat wordt bij de volgende actie opnieuw geprobeerd.', 'waarschuwing');
        tekenGekoppeld(); tekenVoorstel(); tekenZoek();
      } catch (e) {
        if (snap) { cache[BESTANDEN.links] = snap.l; cache[BESTANDEN.journaal] = snap.j; gewijzigd.clear(); snap.g.forEach(k => gewijzigd.add(k)); if (huidig) { tekenGekoppeld(); tekenVoorstel(); tekenZoek(); } }
        melding('Opslaan lukte niet: ' + (e && e.message || e) + '. De koppeling staat nog niet in de tool; probeer het opnieuw.', 'fout');
      } finally { bezig = false; el('bevestig-ja').disabled = false; huidig.bevestig = null; }
    }
    function annuleer() { if (huidig) huidig.bevestig = null; el('bevestig').hidden = true; }
    function toonDiagnose() { const n = el('diagnose-tekst'); if (n) n.textContent = JSON.stringify(diag, null, 1); }

    // Wat Office.js zonder netwerk weet: onderwerp en afzender (altijd tonen, ook als aanmelden of de gedeelde gegevens straks falen).
    function basis(it) {
      tekstIn('mail-onderwerp', it ? it.subject || '(geen onderwerp)' : '');
      tekstIn('mail-van', it && it.from ? [it.from.displayName, it.from.emailAddress].filter(Boolean).join(' · ') : '');
    }
    // ── één mail laden (ook bij ItemChanged in een vastgepind paneel) ──
    async function laadItem() {
      const mijn = ++teller, it = itemNu(), env = diag.omgeving;
      huidig = null; annuleer(); melding('');
      ['gekoppeld-lijst', 'voorstel-lijst', 'zoek-lijst'].forEach(id => leeg(el(id))); el('gekoppeld').hidden = true;
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
          : 'Ophalen mislukt: ' + (e && e.message || e), 'fout');
        diag.fout = String(e && e.message || e);
      }
      toonDiagnose();
    }

    // ── starten ──
    async function start(info) {
      const mb = Office && Office.context && Office.context.mailbox;
      if (!mb || (info && info.host && Office.HostType && info.host !== Office.HostType.Outlook)) { melding('Dit paneel werkt alleen in Outlook.', 'fout'); return; }
      const env = diag.omgeving = omgeving(); toonDiagnose();
      if (!env.mailbox15) { melding('Deze Outlook-versie is te oud voor het MT-paneel (Mailbox 1.5 nodig).', 'fout'); return; }
      adapterZetten(); basis(itemNu());
      const cockpit = new URL('../v2.html', d.location.href).href;
      if (!env.naa) {   // terugval: geen nested app authentication in deze Outlook-versie
        melding('Aanmelden in Outlook (NAA) wordt in deze Outlook-versie niet ondersteund. Koppel de mail via de cockpit: ' + cockpit, 'fout');
        toonDiagnose(); return;
      }
      try { melding('Aanmelden…', 'info'); await aanmelden(); }
      catch (e) { melding('Aanmelden mislukt: ' + (e && e.message || e) + '. Controleer de Azure-redirect en Conditional Access (zie outlook/README.md).', 'fout'); diag.aanmeldFout = String(e && e.message || e); toonDiagnose(); return; }
      try { await laadGegevens(); }
      catch (e) { melding('De projecten en koppelingen konden niet worden gelezen (' + (e && e.message || e) + '). Er wordt niets gewijzigd.', 'fout'); diag.gegevensFout = String(e && e.message || e); toonDiagnose(); return; }
      if (wachtJournaal.length || gewijzigd.has(BESTANDEN.journaal)) await flushWachtend();   // een journaal dat vorige keer niet lukte
      el('bevestig-ja').addEventListener('click', voerUit); el('bevestig-nee').addEventListener('click', annuleer);
      el('zoek-veld').addEventListener('input', tekenZoek);
      try { mb.addHandlerAsync(Office.EventType.ItemChanged, () => { laadItem(); }); } catch (e) { diag.itemChanged = 'niet beschikbaar'; }
      await laadItem();
    }

    return { start, laadItem, voerUit, annuleer, omgeving, diag, _cache: cache, _wacht: () => wachtJournaal };
  }

  root.MTPaneel = { maak, CONFIG, BESTANDEN };
  if (root.Office && typeof root.Office.onReady === 'function' && !root.__MT_PANEEL_TEST) {
    root.Office.onReady(info => {
      const p = maak({ Office: root.Office, msal: root.msal, fetch: (u, i) => root.fetch(u, i), document: root.document, window: root, location: root.location,
        MTKoppel: root.MTKoppel, MTZoek: root.MTZoek, MTCore: root.MTCore });
      root.__paneel = p; p.start(info);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
