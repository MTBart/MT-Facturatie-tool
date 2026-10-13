/* ============================================================================
 * mt-binnenkomend.js — het overzicht "Binnenkomend" in Projecten: wie pakt wat op uit info@.
 * ----------------------------------------------------------------------------
 *  - Leest de inbox (laatste 30 dagen) en de verzonden items van de gedeelde postbus via Graph (alleen in het geheugen).
 *  - De status per gesprek komt uit MTMail.binnenStatus (mt-mailactie.js): Nieuw → Opgepakt door X → Lead/project gekoppeld → Afgehandeld (met reden).
 *  - "Opgepakt" en "afgehandeld" staan in het gedeelde register mt_mail_oppak (privé SharePoint, via _SP.KEYS): een record per gesprek,
 *    samengevoegd per sleutel (MTMail.oppakSamen), nooit last-write-wins over het hele bestand. Het Outlook-paneel schrijft in hetzelfde register.
 *  - Alles wordt met DOM-knooppunten en textContent getekend (geen HTML-strings): mail-onderwerpen en afzenders zijn externe tekst.
 * Afhankelijkheden worden aangereikt (deps), zodat de module zonder browser te testen is. In de cockpit: MTBinnenkomend.start().
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;
  const REGISTER = 'mt_mail_oppak', DAGEN = 30, MAX_PAGINAS = 3, MAX_RIJEN = 40, VERS_MS = 120000;
  const STATUS_LABEL = { nieuw: 'Nieuw', opgepakt: 'Opgepakt', gekoppeld: 'Lead/project gekoppeld', afgehandeld: 'Afgehandeld' };

  function maak(d) {
    // magSchrijven() = het recht om te wijzigen (in de cockpit: inbox alles of verwerken); zonder dat zijn "Pak op" en "Afhandelen" er niet en weigert schrijf() ook.
    const magSchrijven = typeof d.magSchrijven === 'function' ? d.magSchrijven : () => true;
    const M = d.M, K = d.K || null, doc = d.doc || (root.document), nu = d.nu || (() => Date.now());
    let items = [], verzondenKaart = {}, laatsteLaad = 0, bezig = false, fout = '', filter = 'open', verzondenOk = true;

    function h(tag, props, ...kids) {
      const n = doc.createElement(tag);
      Object.keys(props || {}).forEach(k => {
        const v = props[k];
        if (k === 'tekst') n.textContent = v; else if (k === 'klik') n.addEventListener('click', v);
        else if (v !== false && v != null) n.setAttribute(k, v);
      });
      kids.flat().forEach(c => { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
      return n;
    }
    const plek = () => doc.getElementById('binnenkomend-kaart');
    const base = () => (d.mbx === 'me' ? 'https://graph.microsoft.com/v1.0/me' : 'https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(d.mbx));
    const lees = k => { try { const v = JSON.parse(d.opslag.lees(k) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };

    // Een Graph-lijst van één map, nieuwste eerst, vanaf een tijdstip (met join samengesteld: er wordt geen HTML geplakt).
    const mapUrl = (map, veld, sinds, sel) => [base(), '/mailFolders/', map, '/messages?$filter=', encodeURIComponent(veld + ' ge ' + sinds), '&$orderby=', encodeURIComponent(veld + ' desc'), '&$top=100&', sel].join('');
    async function haalAlles(url) {
      let uit = [], volgende = url, pag = 0;
      while (volgende && pag < MAX_PAGINAS) { const r = await d.fetch(volgende); uit = uit.concat((r && r.value) || []); volgende = r && r['@odata.nextLink']; pag++; }
      return uit;
    }
    async function laad(force) {
      if (bezig) return;
      if (!force && laatsteLaad && nu() - laatsteLaad < VERS_MS) { teken(); return; }
      bezig = true; fout = ''; teken();
      try {
        const sinds = new Date(nu() - DAGEN * 86400000).toISOString();
        const sel = '$select=id,subject,from,receivedDateTime,conversationId,internetMessageId,categories,webLink,hasAttachments';
        const msgs = await haalAlles(mapUrl('inbox', 'receivedDateTime', sinds, sel));
        const verzonden = {};
        try {   // zacht: zonder verzonden items bestaat "beantwoord" gewoon niet
          const v = await haalAlles(mapUrl('sentitems', 'sentDateTime', sinds, '$select=conversationId,sentDateTime'));
          v.forEach(x => { if (x && x.conversationId && x.sentDateTime && String(x.sentDateTime) > String(verzonden[x.conversationId] || '')) verzonden[x.conversationId] = x.sentDateTime; });
          verzondenOk = true;
        } catch (e) { verzondenOk = false; }
        verzondenKaart = verzonden; bouw(M.groepeerGesprekken(msgs, d.mbx), verzonden);
        laatsteLaad = nu();
      } catch (e) { fout = (e && e.status === 403) ? 'Geen toegang tot ' + d.mbx + ' (Volledige toegang in Exchange nodig).' : 'Binnenkomend laden mislukt: ' + String((e && e.message) || e).slice(0, 160); }
      bezig = false; teken();
    }
    function bouw(gesprekken, verzonden) {
      const ctx = { links: K && K.alle ? K.alle() : {}, oppak: lees(REGISTER), verzonden, nu: nu(), teLangUren: 24 };
      items = gesprekken.map(g => {
        const nieuwste = g.berichten.slice().sort((a, b) => String(b.receivedDateTime || '').localeCompare(String(a.receivedDateTime || '')))[0] || {};
        const van = (nieuwste.from && nieuwste.from.emailAddress) || {};
        return { g, s: M.binnenStatus(g, ctx), laatste: nieuwste, van: M.naamVan(van.address, van.name), onderwerp: M.schoonOnderwerp(nieuwste.subject) || '(geen onderwerp)' };
      });
    }
    // Opnieuw rekenen na een wijziging in het register of de koppelingen (zonder netwerk).
    function herbereken() {
      bouw(items.map(i => i.g), verzondenKaart);
    }

    function schrijf(item, status, reden) {
      if (!magSchrijven()) throw new Error('je hebt geen recht om gesprekken op te pakken of af te handelen');
      if (!M.oppakToegestaan(item.g.mbx)) throw new Error('"Pak op" werkt alleen in de gedeelde postbus info@');
      const sleutel = M.oppakSleutel(item.g.mbx, item.g.conversationId);
      if (!sleutel) throw new Error('dit bericht heeft geen gespreks-id');
      const register = lees(REGISTER), mij = d.wie() || {};
      register[sleutel] = M.oppakRecord(register[sleutel] || null, { status, reden, mbx: item.g.mbx, conversationId: item.g.conversationId, door: mij.email, naam: M.naamVan(mij.email, mij.naam), codes: item.s.codes }, nu());
      d.opslag.schrijf(REGISTER, JSON.stringify(register));
    }
    async function actie(item, status) {
      let reden = '';
      const mijnMail = String((d.wie() || {}).email || '').toLowerCase();
      if (status === 'opgepakt' && item.s.status === 'opgepakt' && item.s.door && item.s.door !== mijnMail && d.dialoog.confirm) {
        const ok = await d.dialoog.confirm({ title: 'Overnemen?', message: 'Dit gesprek is al opgepakt door ' + (item.s.naam || item.s.door) + '. Overnemen?', okLabel: 'Overnemen' });
        if (!ok) return;
      }
      if (status === 'afgehandeld') {
        const i = await d.dialoog.choose({ title: 'Afhandelen: waarom?', message: 'Kies de reden; ze staat in het overzicht.', choices: M.AFHANDEL_REDENEN.map(r => ({ label: r[1] })) });
        if (i == null) return;
        reden = M.AFHANDEL_REDENEN[i][0];
      }
      try { schrijf(item, status, reden); } catch (e) { await d.dialoog.alert({ title: 'Binnenkomend', message: 'Vastleggen lukte niet: ' + String((e && e.message) || e) }); return; }
      herbereken(); teken();
    }

    function wie(s) {
      if (s.status === 'opgepakt') return 'door ' + (s.naam || M.naamVan(s.door, ''));
      if (s.status === 'afgehandeld') return ((M.AFHANDEL_REDENEN.find(r => r[0] === s.reden) || [])[1] || '') + (s.naam ? ' · ' + s.naam : '');
      if (s.status === 'gekoppeld') return (s.codes || []).map(c => (d.projNaam ? d.projNaam(c) : c)).join(', ') + (s.opgepakt_naam ? ' · opgepakt door ' + s.opgepakt_naam : '');
      return '';
    }
    function rij(i) {
      const s = i.s, kan = !!i.g.conversationId, knoppen = [], schrijfOk = magSchrijven() && M.oppakToegestaan(i.g.mbx);
      if (schrijfOk && (s.status === 'nieuw' || s.status === 'opgepakt')) {
        knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-secondary', disabled: kan ? null : 'disabled', klik: () => actie(i, 'opgepakt'), tekst: s.status === 'opgepakt' ? 'Overnemen' : 'Pak op' }));
        knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-secondary', disabled: kan ? null : 'disabled', klik: () => actie(i, 'afgehandeld'), tekst: 'Afhandelen…' }));
      }
      if (schrijfOk && s.status === 'opgepakt' && s.door) knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-secondary', klik: () => actie(i, 'vrij'), tekst: 'Vrijgeven' }));
      if (schrijfOk && s.status === 'afgehandeld') knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-secondary', klik: () => actie(i, 'opgepakt'), tekst: 'Weer oppakken' }));
      if ((s.status === 'nieuw' || s.status === 'opgepakt') && d.maakLead) knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-gold', klik: () => d.maakLead({ mbx: i.g.mbx, mail: i.laatste.id }), tekst: 'Maak lead' }));
      if (s.status === 'gekoppeld' && s.codes[0] && d.openProject) knoppen.push(h('button', { type: 'button', class: 'btn btn-xs btn-secondary', klik: () => d.openProject(s.codes[0]), tekst: 'Open dossier' }));
      const link = d.veiligeUrl ? d.veiligeUrl(i.laatste.webLink) : '';
      if (link) knoppen.push(h('a', { class: 'btn btn-xs btn-secondary', href: link, target: '_blank', rel: 'noopener noreferrer', tekst: 'Mail' }));
      return h('div', { class: 'bk-rij bk-' + s.status + (s.teLang ? ' bk-telang' : ''), 'data-status': s.status },
        h('div', { class: 'bk-kop' }, h('span', { class: 'bk-pil', tekst: STATUS_LABEL[s.status] || s.status }), s.teLang ? h('span', { class: 'bk-let', tekst: 'te lang open', title: 'Dit gesprek staat al langer dan een dag op Nieuw' }) : null, s.heropend ? h('span', { class: 'bk-let', tekst: 'nieuwe reactie', title: 'Er kwam een mail van buiten nadat dit gesprek was afgehandeld' }) : null,
          h('span', { class: 'bk-van', tekst: i.van })),
        h('div', { class: 'bk-onderwerp', tekst: i.onderwerp }),
        wie(s) ? h('div', { class: 'dos-meta', tekst: wie(s) + (s.beantwoord ? ' · beantwoord' : '') }) : (s.beantwoord ? h('div', { class: 'dos-meta', tekst: 'beantwoord' }) : null),
        knoppen.length ? h('div', { class: 'bk-acties' }, knoppen) : null);
    }
    function teken() {
      const p = plek(); if (!p) return;
      while (p.firstChild) p.removeChild(p.firstChild);
      p.hidden = false;
      const t = M.tel(items.map(i => i.s));
      const kop = h('div', { class: 'card-title', style: 'display:flex;justify-content:space-between;align-items:center;gap:6px' }, h('span', { tekst: 'Binnenkomend' }),
        h('button', { type: 'button', class: 'btn btn-xs btn-secondary', klik: () => laad(true), disabled: bezig ? 'disabled' : null, tekst: bezig ? 'Laden…' : 'Ververs' }));
      const sel = h('select', { 'aria-label': 'Filter binnenkomend', klik: null }, h('option', { value: 'open', tekst: 'Open' }), h('option', { value: 'alles', tekst: 'Alles' }));
      sel.value = filter; sel.addEventListener('change', () => { filter = sel.value; teken(); });
      p.appendChild(kop);
      if (fout) { p.appendChild(h('div', { class: 'lead-let', role: 'alert', tekst: fout })); return; }
      p.appendChild(h('div', { class: 'dos-meta', tekst: 'Nieuw ' + t.nieuw + ' · Opgepakt ' + t.opgepakt + ' · Gekoppeld ' + t.gekoppeld + ' · Afgehandeld ' + t.afgehandeld }));
      if (t.teLang) p.appendChild(h('div', { class: 'lead-let', tekst: '⚠ ' + t.teLang + (t.teLang === 1 ? ' gesprek staat' : ' gesprekken staan') + ' al langer dan een dag op Nieuw.' }));
      p.appendChild(sel);
      const zicht = items.filter(i => filter === 'alles' || i.s.status === 'nieuw' || i.s.status === 'opgepakt');
      if (!zicht.length && !bezig) p.appendChild(h('div', { class: 'dos-meta', tekst: items.length ? 'Alles is opgepakt of afgehandeld.' : 'Geen berichten in de afgelopen ' + DAGEN + ' dagen.' }));
      zicht.slice(0, MAX_RIJEN).forEach(i => p.appendChild(rij(i)));
      if (zicht.length > MAX_RIJEN) p.appendChild(h('div', { class: 'dos-meta', tekst: '… en nog ' + (zicht.length - MAX_RIJEN) + ' oudere.' }));
      if (!verzondenOk) p.appendChild(h('div', { class: 'dos-meta', tekst: 'De verzonden items konden niet worden gelezen; "beantwoord" ontbreekt.' }));
    }
    return { laad, teken, filterZet: v => { filter = v; teken(); }, _items: () => items, _acties: actie };
  }

  const api = { maak, REGISTER, STATUS_LABEL };
  // In de cockpit: een instantie op info@, met de bestaande Graph-aanroep, koppelregister en dialogen.
  api.start = function () {
    if (api._inst) return api._inst;
    if (typeof root.ibFetch !== 'function' || !root.MTMail) return null;
    api._inst = maak({
      M: root.MTMail, K: root.MTKoppel, doc: root.document, mbx: typeof root.INBOX_DEFAULT === 'string' ? root.INBOX_DEFAULT : 'info@mortiseandtenon.nl',
      fetch: url => root.ibFetch(url), opslag: { lees: k => root.localStorage.getItem(k), schrijf: (k, t) => root.localStorage.setItem(k, t) },
      wie: () => ({ email: (typeof root.mtMijEmail === 'function' && root.mtMijEmail()) || '', naam: (root.MTRol && root.MTRol.me && root.MTRol.me.naam) || '' }),
      magSchrijven: () => (typeof root.binnenkomendMagSchrijven === 'function' ? root.binnenkomendMagSchrijven() : true),
      dialoog: root.mtDialog, maakLead: o => (typeof root.leadVanMailOpen === 'function' ? root.leadVanMailOpen(o) : null),
      openProject: c => root.openProject(c, { sectie: 'dossier' }), projNaam: c => (typeof root.projKort === 'function' ? root.projKort(c) : c), veiligeUrl: u => (root.veiligeUrl ? root.veiligeUrl(u, { hosts: ['office.com', 'office365.com', 'outlook.com', 'microsoft.com'] }) : '')
    });
    return api._inst;
  };
  root.MTBinnenkomend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
