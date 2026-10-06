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
      return Object.assign({
        id: msg.id || '', internetMessageId: msg.internetMessageId || '', subject: msg.subject || '',
        from: van, date: msg.receivedDateTime || msg.date || '', webLink: msg.webLink || '',
        mbx: msg.mbx || '', ts: nu, gewijzigd: nu
      }, extra || {});
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
