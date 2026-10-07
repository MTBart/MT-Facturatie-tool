/* ============================================================================
 * mt-koppel.js — mail ↔ project koppelen (brok B4)
 * ----------------------------------------------------------------------------
 * Eén module voor wat eerst drie keer apart stond (inbox "koppel", inbox "maak
 * project" en maakProjectAan). De kern (MTKoppel.*) kent geen v2-DOM: alleen een
 * opslag-adapter (standaard localStorage) en optioneel een "wie"-functie, zodat
 * hij later ook in een Outlook-add-in kan draaien.
 *
 * Opslag (ongewijzigde vorm): mt_mail_links = { CODE: [koppeling…] }.
 *   koppeling = {id, internetMessageId, subject, from, date, webLink, mbx, ts,
 *                gewijzigd, ontkoppeld?, door?, bron?, herkoppeld?, idType?, iid?, id_bijgewerkt?}
 *   - idType:'immutable' = `id` is een immutable Graph-id (B5, blijft gelijk na verplaatsen)
 *   - iid = later gevonden immutable id bij een oud record; `id` blijft dan ongewijzigd
 *   - sleutel van een mail = internetMessageId || id (zoals altijd)
 *   - ontkoppelen = tombstone `ontkoppeld:<ms>` (niet wissen); herkoppelen maakt
 *     hetzelfde record weer actief met een nieuwere `gewijzigd`, zodat de bestaande
 *     samenvoeger (_SP.mergers.mt_mail_links: nieuwste stand per mail) klopt.
 * Journaal: mt_koppel_journaal = [{id, tijd, actie, code, sleutel, subject, door, bron}],
 *   alleen toevoegen, samenvoegen op id, laatste 2000.
 * Opslag is privé SharePoint (via _SP.KEYS), NOOIT de publieke repo.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  const LINKS = 'mt_mail_links', JOURNAAL = 'mt_koppel_journaal', JOURNAAL_MAX = 2000;
  // Oude koppelingen zonder mailbox komen uit de gedeelde info@-inbox (vaste regel, ook in de migratie).
  const STANDAARD_MBX = 'info@mortiseandtenon.nl';

  const K = {
    // ── adapters (vervangbaar, bv. in een add-in) ──
    opslag: {
      lees(key) { try { return root.localStorage.getItem(key); } catch (e) { return null; } },
      schrijf(key, tekst) { root.localStorage.setItem(key, tekst); }
    },
    wie() { try { return (typeof root.mtMijEmail === 'function' && root.mtMijEmail()) || ''; } catch (e) { return ''; } },
    nu() { return Date.now(); },

    // ── basis ──
    sleutel(x) { return x && (x.internetMessageId || x.id) || ''; },
    mbx(x) { return String((x && x.mbx) || STANDAARD_MBX).toLowerCase(); },
    actief(x) { return !!x && !x.ontkoppeld; },
    // Zelfde mail? Op sleutel, of op Graph-id (ook het bijgeschreven immutable id `iid`).
    zelfde(x, msg) {
      if (!x || !msg) return false;
      const s = K.sleutel(msg);
      return (!!s && K.sleutel(x) === s) || (!!msg.id && (x.id === msg.id || x.iid === msg.id));
    },
    alle() {
      try { const v = JSON.parse(K.opslag.lees(LINKS) || '{}'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
      catch (e) { return {}; }
    },
    bewaar(all) { K.opslag.schrijf(LINKS, JSON.stringify(all)); },

    // Graph-bericht (of het oude _ibProjBron-object) → koppel-record.
    record(msg, extra) {
      const van = msg && msg.from && msg.from.emailAddress
        ? (msg.from.emailAddress.name || msg.from.emailAddress.address || '')
        : (typeof (msg && msg.from) === 'string' ? msg.from : '');
      const nu = K.nu();
      const adres = String((msg && msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || msg.fromAddr || '').toLowerCase();
      return Object.assign({
        id: msg.id || '', internetMessageId: msg.internetMessageId || '', subject: msg.subject || '',
        from: van, date: msg.receivedDateTime || msg.date || '', webLink: msg.webLink || '',
        mbx: msg.mbx || '', ts: nu, gewijzigd: nu
      }, typeof msg.hasAttachments === 'boolean' ? { hasAttachments: msg.hasAttachments } : {},
        msg.conversationId ? { conversationId: msg.conversationId } : {}, adres ? { fromAddr: adres } : {}, extra || {});
    },

    // ── journaal ──
    journaal(actie, code, rec, opts) {
      try {
        let j = []; try { j = JSON.parse(K.opslag.lees(JOURNAAL) || '[]'); } catch (e) { j = []; }
        if (!Array.isArray(j)) j = [];
        j.push({ id: 'k' + K.nu().toString(36) + Math.random().toString(36).slice(2, 6), tijd: new Date(K.nu()).toISOString(),
          actie, code, sleutel: K.sleutel(rec), subject: (rec && rec.subject) || '',
          door: (opts && opts.door) || K.wie(), bron: (opts && opts.bron) || '' });
        if (j.length > JOURNAAL_MAX) j = j.slice(-JOURNAAL_MAX);
        K.opslag.schrijf(JOURNAAL, JSON.stringify(j));
        return true;
      } catch (e) { console.warn('koppel-journaal schrijven mislukt:', e); return false; }
    },
    // Samenvoeger voor _SP: alleen toevoegen, vereniging op id, op tijd, laatste 2000.
    journaalSamen(lokaal, spData) {
      const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
      const L = Array.isArray(lees(lokaal)) ? lees(lokaal) : [], R = Array.isArray(lees(spData)) ? lees(spData) : [];
      const per = new Map(); [...R, ...L].forEach(x => { if (x && x.id && !per.has(x.id)) per.set(x.id, x); });
      return [...per.values()].sort((a, b) => String(a.tijd).localeCompare(String(b.tijd))).slice(-JOURNAAL_MAX);
    },

    // ── kern-API ──
    // Koppel `msg` aan `code`. Uitkomst: {status:'nieuw'|'herkoppeld'|'al', record}.
    koppelMail(code, msg, opts) {
      opts = opts || {};
      if (!code || !msg || !K.sleutel(msg)) return { status: 'fout', record: null };
      const all = K.alle(), arr = Array.isArray(all[code]) ? all[code] : [];
      const door = opts.door || K.wie(), bron = opts.bron || 'hand';
      const act = arr.find(x => K.actief(x) && K.zelfde(x, msg));
      if (act) return { status: 'al', record: act };
      const oud = arr.find(x => K.zelfde(x, msg));
      let rec, status;
      if (oud) {                                   // eerder ontkoppeld → hetzelfde record weer actief
        const nu = K.nu();
        delete oud.ontkoppeld; oud.gewijzigd = Math.max(nu, (Number(oud.gewijzigd) || 0) + 1);
        oud.herkoppeld = oud.gewijzigd; oud.door = door; oud.bron = bron;
        if (msg.id && !oud.id) oud.id = msg.id;
        // Oud record + nu een immutable id bekend: bijschrijven als iid (id blijft staan).
        if (opts.idType === 'immutable' && msg.id && oud.id !== msg.id && !oud.iid) { oud.iid = msg.id; oud.id_bijgewerkt = nu; }
        rec = oud; status = 'herkoppeld';
      } else {
        rec = K.record(Object.assign({}, msg, opts.mbx ? { mbx: opts.mbx } : {}),
          Object.assign({ door, bron }, (opts.idType || msg.idType) ? { idType: opts.idType || msg.idType } : {}));
        arr.push(rec); status = 'nieuw';
      }
      all[code] = arr; K.bewaar(all);
      K.journaal(status === 'nieuw' ? 'koppel' : 'herkoppel', code, rec, { door, bron });
      return { status, record: rec };
    },
    // Tombstone op alle actieve koppelingen van deze mail onder `code`. Geeft het aantal terug.
    ontkoppelMail(code, sleutel, opts) {
      opts = opts || {};
      const all = K.alle(), arr = Array.isArray(all[code]) ? all[code] : [];
      const door = opts.door || K.wie(), nu = K.nu();
      let n = 0, laatste = null;
      arr.forEach(x => {
        if (K.actief(x) && (K.sleutel(x) === sleutel || (opts.id && (x.id === opts.id || x.iid === opts.id)))) {
          const t = Math.max(nu, (Number(x.gewijzigd) || 0) + 1);
          x.ontkoppeld = t; x.gewijzigd = t; x.ontkoppeld_door = door; n++; laatste = x;
        }
      });
      if (n) { K.bewaar(all); K.journaal('ontkoppel', code, laatste, { door, bron: opts.bron || 'hand' }); }
      return n;
    },
    // Immutable id bijschrijven bij de records van deze mail in déze mailbox (opts.mbx;
    // dezelfde mail heeft per mailbox een ander id) en optioneel alleen onder opts.code.
    // Alleen records die nog geen iid hebben. `id` blijft staan; `gewijzigd` wordt NIET
    // opgehoogd, zodat dit nooit een nieuwere (ont)koppeling van een andere pc verdringt.
    idBijwerken(sleutel, iid, opts) {
      opts = opts || {};
      if (!sleutel || !iid) return 0;
      const doelMbx = String(opts.mbx || STANDAARD_MBX).toLowerCase();
      const all = K.alle(), nu = K.nu(); let n = 0, laatste = null, codes = [];
      for (const code in all) {
        if (opts.code && code !== opts.code) continue;
        (Array.isArray(all[code]) ? all[code] : []).forEach(x => {
          if (K.sleutel(x) === sleutel && K.mbx(x) === doelMbx && !x.iid && x.id !== iid) { x.iid = iid; x.id_bijgewerkt = nu; n++; laatste = x; codes.push(code); }
        });
      }
      if (n) { K.bewaar(all); K.journaal('id-bijgewerkt', codes.join(','), laatste, { door: opts.door, bron: opts.bron || 'terugval' }); }
      return n;
    },
    // Een eerder ontkoppelde koppeling weer actief maken (zonder het bericht zelf).
    herkoppel(code, sleutel, opts) {
      const all = K.alle(), arr = Array.isArray(all[code]) ? all[code] : [];
      const x = arr.find(r => K.sleutel(r) === sleutel);
      if (!x) return false;
      if (K.actief(x)) return true;
      return K.koppelMail(code, x, opts).status === 'herkoppeld';
    },
    // Actieve koppelingen over meerdere projecten (klant-scope later): [{code, …record}].
    linksVoor(codes) {
      const all = K.alle(), uit = [];
      (Array.isArray(codes) ? codes : [codes]).forEach(code => {
        (Array.isArray(all[code]) ? all[code] : []).forEach(x => { if (K.actief(x)) uit.push(Object.assign({ code }, x)); });
      });
      return uit;
    },
    // ── Koppelvoorstellen (brok B9) — alleen voorstellen, NOOIT automatisch koppelen ──
    // Signalen (eenvoudig en uitlegbaar, score max 100):
    //   projectcode of offertenummer in onderwerp (60) / in de tekst-preview (45)
    //   ander bericht in hetzelfde gesprek al gekoppeld (70)
    //   eerder gekoppeld van dezelfde afzender (30)
    //   afzender = e-mail van het project (35) / afzenderdomein = klantdomein (25, recentste eerst)
    // Freemail-domeinen en het eigen domein tellen nooit als klantdomein.
    FREEMAIL: new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.nl','outlook.com','outlook.nl','live.com','live.nl','msn.com',
      'ziggo.nl','kpnmail.nl','kpnplanet.nl','planet.nl','home.nl','icloud.com','me.com','mac.com','yahoo.com','yahoo.nl','hetnet.nl',
      'chello.nl','casema.nl','upcmail.nl','telfort.nl','quicknet.nl','tele2.nl','xs4all.nl','protonmail.com','proton.me','gmx.com',
      'gmx.net','gmx.de','aol.com','zonnet.nl','online.nl','caiway.nl','solcon.nl','mortiseandtenon.nl']),
    domein(adres) { const d = String(adres || '').toLowerCase().split('@')[1] || ''; return d && !K.FREEMAIL.has(d) ? d : ''; },
    // Index één keer bouwen (per lijst-render), daarna per mail goedkoop scoren.
    voorstelIndex(opts) {
      opts = opts || {};
      // PROJECT_CODES is een `let` in v2.html (geen window-eigenschap) → ook via de gedeelde globale scope zoeken.
      const projecten = (opts.projecten || root.PROJECT_CODES || (typeof PROJECT_CODES !== 'undefined' ? PROJECT_CODES : [])).filter(p => p && p.code && p.status !== 'archief');
      const all = K.alle();
      const perCode = new Map(projecten.map(p => [p.code, p]));
      const codes = projecten.map(p => ({ code: p.code, re: new RegExp('(^|[^A-Za-z0-9-])' + p.code.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '($|[^A-Za-z0-9-])', 'i') }));
      const offertes = projecten.filter(p => p.offertenr).map(p => ({ code: p.code, nr: String(p.offertenr),
        re: new RegExp('(^|[^0-9])' + String(p.offertenr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9])') }));
      const gesprek = new Map(), afzender = new Map();
      for (const code in all) for (const x of (Array.isArray(all[code]) ? all[code] : [])) {
        if (!K.actief(x) || !perCode.has(code)) continue;
        if (x.conversationId) { if (!gesprek.has(x.conversationId)) gesprek.set(x.conversationId, new Set()); gesprek.get(x.conversationId).add(code); }
        const a = String(x.fromAddr || '').toLowerCase();
        if (a) { if (!afzender.has(a)) afzender.set(a, new Set()); afzender.get(a).add(code); }
      }
      // Klantdomeinen → klantcode (registry + e-mail op projecten); klant → projecten.
      const domKlant = new Map(), adresProj = new Map();
      const zetDom = (adres, kl) => { const d = K.domein(adres); if (d && kl) { if (!domKlant.has(d)) domKlant.set(d, new Set()); domKlant.get(d).add(String(kl).toUpperCase()); } };
      (opts.klantenVol || root.KLANTEN_VOL || []).forEach(k => { if (k && k.soort !== 'leverancier' && k.email && k.code) zetDom(k.email, k.code); });
      (opts.klanten || root.KLANTEN || []).forEach(k => { if (k && k.email && k.code) zetDom(k.email, k.code); });
      projecten.forEach(p => { if (p.klant_email) { zetDom(p.klant_email, p.klant); const a = String(p.klant_email).toLowerCase(); if (!adresProj.has(a)) adresProj.set(a, new Set()); adresProj.get(a).add(p.code); } });
      // Afzenders van eerdere koppelingen: hun domein telt pas als klantdomein bij ≥2 gekoppelde
      // mails voor die klant, en nooit als het een leveranciersdomein is (factuurmails aan een project).
      const lev = new Set((opts.klantenVol || root.KLANTEN_VOL || []).filter(k => k && k.soort === 'leverancier' && k.email).map(k => K.domein(k.email)).filter(Boolean));
      const telDom = new Map();
      for (const code in all) for (const x of (Array.isArray(all[code]) ? all[code] : [])) {
        const p = perCode.get(code), d = K.actief(x) && p && p.klant ? K.domein(x.fromAddr) : '';
        if (d && !lev.has(d)) { const k = d + '|' + String(p.klant).toUpperCase(); telDom.set(k, (telDom.get(k) || 0) + 1); }
      }
      telDom.forEach((n, k) => { if (n >= 2) { const [d, kl] = k.split('|'); zetDom('x@' + d, kl); } });
      const klantProj = new Map(); projecten.forEach(p => { const kl = String(p.klant || '').toUpperCase(); if (!kl) return; if (!klantProj.has(kl)) klantProj.set(kl, []); klantProj.get(kl).push(p); });
      klantProj.forEach(lijst => lijst.sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))));
      return { perCode, codes, offertes, gesprek, afzender, domKlant, adresProj, klantProj };
    },
    // → [{code, score, redenen:[…]}], max 3, hoogste eerst; zonder projecten waar de mail al aan hangt.
    koppelVoorstel(msg, opts) {
      opts = opts || {};
      if (!msg) return [];
      const ix = opts.index || K.voorstelIndex(opts);
      const al = new Set(K.mailProjecten(msg));
      const sc = new Map();
      const plus = (code, n, reden) => { if (!ix.perCode.has(code) || al.has(code)) return; const o = sc.get(code) || { code, score: 0, redenen: [] }; if (!o.redenen.includes(reden)) { o.score += n; o.redenen.push(reden); } sc.set(code, o); };
      const onderw = String(msg.subject || ''), tekst = String(msg.bodyPreview || '');
      ix.codes.forEach(c => { if (c.re.test(onderw)) plus(c.code, 60, 'projectcode in onderwerp'); else if (c.re.test(tekst)) plus(c.code, 45, 'projectcode in tekst'); });
      ix.offertes.forEach(o => { if (o.re.test(onderw)) plus(o.code, 60, 'offertenummer ' + o.nr + ' in onderwerp'); else if (o.re.test(tekst)) plus(o.code, 45, 'offertenummer ' + o.nr + ' in tekst'); });
      const cid = msg.conversationId;
      const gesprekCodes = new Set(cid && ix.gesprek.get(cid) || []);
      // Alleen bij een echt gesprek-id (anders zouden alle mails zonder id "één gesprek" zijn).
      if (cid) (opts.gesprek || []).forEach(m => { if (m && m !== msg && m.conversationId === cid) K.mailProjecten(m).forEach(c => gesprekCodes.add(c)); });
      gesprekCodes.forEach(c => plus(c, 70, 'ander bericht in dit gesprek is gekoppeld'));
      const adres = String((msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '').toLowerCase();
      (ix.afzender.get(adres) || []).forEach(c => plus(c, 30, 'eerder gekoppeld van deze afzender'));
      (ix.adresProj.get(adres) || []).forEach(c => plus(c, 35, 'afzender is het e-mailadres van het project'));
      const dom = K.domein(adres);
      if (dom) (ix.domKlant.get(dom) || []).forEach(kl => (ix.klantProj.get(kl) || []).forEach((p, i) => plus(p.code, Math.max(10, 25 - i * 3), 'afzenderdomein ' + dom + ' hoort bij klant ' + kl)));
      return [...sc.values()].map(o => Object.assign(o, { score: Math.min(100, o.score) }))
        .sort((a, b) => b.score - a.score || String((ix.perCode.get(b.code) || {}).created || '').localeCompare(String((ix.perCode.get(a.code) || {}).created || '')))
        .slice(0, 3);
    },
    VOORSTEL_STERK: 60,
    // ALLE projecten waar deze mail (actief) aan hangt, in opslagvolgorde.
    mailProjecten(msg) {
      if (!msg) return [];
      const all = K.alle(), uit = [];
      for (const code in all) {
        if ((Array.isArray(all[code]) ? all[code] : []).some(x => K.actief(x) && K.zelfde(x, msg))) uit.push(code);
      }
      return uit;
    }
  };
  root.MTKoppel = K;


  // ══ UI-helper (B11): één koppel-badge voor de hele tool, naar Moneybird-werkwijze ══
  //   open (geel/amber, schakel OPEN)      = niet gekoppeld → klik = voorstellen / koppelen
  //   voorstel (geel, schakel open, tekst) = er is een sterk voorstel → klik = voorstellen
  //   gekoppeld (groen, schakel DICHT)     = gekoppeld (+ doel) → klik = details / ontkoppelen
  // De betekenis zit in icoon (open/dicht) + tekst, niet alleen in kleur (kleurenblind-proof).
  // badge() geeft HTML terug (geen DOM nodig); popover() is de enige DOM-functie.
  const UI_ESC = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SVG_DICHT = '<svg class="kb-i" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const SVG_OPEN = '<svg class="kb-i" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>';
  const UI = {
    SVG_DICHT, SVG_OPEN,
    // o = {status:'open'|'voorstel'|'gekoppeld', label (het doel), tekst (hele tekst, alleen voor uitzonderingen),
    //      titel, onclick (JS-tekst), klein, icoon (alleen icoon), waarschuwing}
    // Vast copy-patroon: "Niet gekoppeld · doel" / "Koppel? CODE" / "Gekoppeld · doel".
    badge(o) {
      o = o || {};
      const st = ['open', 'voorstel', 'gekoppeld'].includes(o.status) ? o.status : 'open';
      const tekst = o.tekst ? String(o.tekst)
        : st === 'gekoppeld' ? 'Gekoppeld' + (o.label ? ' · ' + o.label : '')
        : st === 'voorstel' ? 'Koppel? ' + (o.label || '')
        : 'Niet gekoppeld' + (o.label ? ' · ' + o.label : '');
      const svg = st === 'gekoppeld' ? SVG_DICHT : SVG_OPEN;
      const basis = st === 'voorstel' ? 'Niet gekoppeld, voorstel: ' + (o.tekst || o.label || '')
        : o.tekst ? (st === 'gekoppeld' ? 'Gekoppeld: ' : 'Niet gekoppeld: ') + o.tekst : tekst;
      const let_ = o.waarschuwing ? ' (let op: ' + o.waarschuwing + ')' : '';
      // titel die al met de status begint vervangt de basis (anders leest een schermlezer "Niet gekoppeld — Niet gekoppeld …")
      const aria = o.titel && String(o.titel).toLowerCase().startsWith(basis.toLowerCase()) ? o.titel + let_ : basis + let_ + (o.titel ? ' — ' + o.titel : '');
      const cls = 'kb kb-' + st + (o.klein ? ' kb-klein' : '') + (o.icoon ? ' kb-icoon' : '') + (o.waarschuwing ? ' kb-let' : '');
      const inhoud = svg + (o.waarschuwing ? '<span class="kb-w" aria-hidden="true">⚠</span>' : '') + '<span class="kb-t">' + UI_ESC(tekst) + '</span>';
      const attr = ' class="' + cls + '" data-koppel="' + st + '" aria-label="' + UI_ESC(aria) + '" title="' + UI_ESC(o.titel || aria) + '"';
      return o.onclick ? '<button type="button"' + attr + ' onclick="' + UI_ESC(o.onclick) + '">' + inhoud + '</button>'
        : '<span role="img"' + attr + '>' + inhoud + '</span>';
    },
    // Popover naast de badge (op smal scherm als paneel onderin). Sluit met Esc, klik buiten, of ✕.
    popover(anker, html, opts) {
      opts = opts || {};
      const doc = root.document; if (!doc) return null;
      UI.sluit();
      const p = doc.createElement('div');
      p.className = 'kb-pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', opts.titel || 'Koppeling');
      p.innerHTML = '<div class="kb-pop-kop"><b>' + UI_ESC(opts.titel || 'Koppeling') + '</b><button type="button" class="kb-pop-x" aria-label="Sluiten" onclick="MTKoppelUI.sluit()">✕</button></div><div class="kb-pop-in">' + html + '</div>';
      p.id = 'kb-pop'; doc.body.appendChild(p);
      const smal = (root.innerWidth || 1024) < 600;
      if (anker && anker.getBoundingClientRect && !smal) {
        const r = anker.getBoundingClientRect(), b = Math.min(340, (root.innerWidth || 1024) - 16);
        p.style.width = b + 'px';
        p.style.left = Math.max(8, Math.min(r.left + (root.scrollX || 0), (root.scrollX || 0) + (root.innerWidth || 1024) - b - 8)) + 'px';
        // onder de badge; past het daar niet en boven wel → erboven
        const h = p.offsetHeight || 0, vh = root.innerHeight || 800;
        const boven = h && r.bottom + 6 + h > vh && r.top - 6 - h >= 0;
        p.style.top = ((boven ? r.top - 6 - h : r.bottom + 6) + (root.scrollY || 0)) + 'px';
      } else p.classList.add('kb-pop-onder');
      UI._anker = anker || null;
      if (anker && anker.setAttribute) { anker.setAttribute('aria-expanded', 'true'); anker.setAttribute('aria-controls', 'kb-pop'); }
      const eerste = p.querySelector('.kb-pop-in button, .kb-pop-in a, .kb-pop-in select, .kb-pop-in input'); if (eerste && eerste.focus) eerste.focus();
      setTimeout(() => {
        UI._buiten = e => { if (!p.contains(e.target) && e.target !== anker && !(anker && anker.contains && anker.contains(e.target))) UI.sluit(); };
        UI._esc = e => { if (e.key === 'Escape') UI.sluit(); };
        UI._resize = () => UI.sluit();
        doc.addEventListener('mousedown', UI._buiten); doc.addEventListener('keydown', UI._esc);
        if (root.addEventListener) root.addEventListener('resize', UI._resize);
      }, 0);
      return p;
    },
    // Sluit; stond de focus in de popover, dan terug naar de badge (als die er nog is).
    sluit() {
      const doc = root.document; if (!doc) return;
      const a = UI._anker, act = doc.activeElement;
      const focusTerug = !!(act && act.closest && act.closest('.kb-pop'));
      doc.querySelectorAll('.kb-pop').forEach(x => x.remove());
      if (UI._buiten) doc.removeEventListener('mousedown', UI._buiten);
      if (UI._esc) doc.removeEventListener('keydown', UI._esc);
      if (UI._resize && root.removeEventListener) root.removeEventListener('resize', UI._resize);
      UI._buiten = UI._esc = UI._resize = UI._anker = null;
      if (a && a.setAttribute) { a.setAttribute('aria-expanded', 'false'); a.removeAttribute('aria-controls'); }
      if (focusTerug && a && a.isConnected && a.focus) a.focus();
    },
    esc: UI_ESC
  };
  root.MTKoppelUI = UI;
  root.koppelBadge = UI.badge;

  // ── Compat-laag: de oude globale namen (v2.html + mt-inbox.js) leunen nu op MTKoppel ──
  root.mailLinksAll = () => K.alle();
  root.mailLinksSave = o => K.bewaar(o);
  root.mailLinkActief = x => K.actief(x);
  root.mailLinkIdent = x => K.sleutel(x) || undefined;
  root.mailLinksVoor = code => (K.alle()[code] || []).filter(K.actief);
  // Alleen bij het ruwe object (zonder opslaan/journaal) — voor oude aanroepers.
  root.mailLinkOntkoppel = (all, code, imid, mid) => {
    const nu = K.nu(); let n = 0;
    (all[code] || []).forEach(x => { if (K.actief(x) && (K.sleutel(x) === imid || (mid && (x.id === mid || x.iid === mid)))) { x.ontkoppeld = nu; x.gewijzigd = nu; n++; } });
    return n;
  };
  // Eerste project (oude API). Nieuwe code: MTKoppel.mailProjecten(msg).
  root.mailLinkInfo = m => {
    const codes = K.mailProjecten(m); if (!codes.length) return null;
    const entry = (K.alle()[codes[0]] || []).find(x => K.actief(x) && K.zelfde(x, m));
    return { code: codes[0], codes, entry };
  };
})(typeof window !== 'undefined' ? window : null);
