/* ============================================================================
 * mt-contacten.js — contactenregister (overal contactpersonen, automatisch aanvullen)
 * ----------------------------------------------------------------------------
 * Kern (MTContacten) kent geen v2-DOM: alleen een opslag-adapter (standaard
 * localStorage) en een "wie"-functie. De UI (MTContactenUI) staat onderaan dit bestand.
 *
 * Opslag: mt_contacten = [contact…] (privé SharePoint via _SP.KEYS, NOOIT de publieke repo).
 *   contact = {id, naam, voornaam?, functie?, emails:[lowercase], telefoons:[{nr,soort}],
 *              organisatie:{type:'klant'|'leverancier'|'intern'|'overig', klantCode?, mbContactId?, naam},
 *              locatie?:{code,naam,adres?}, projecten:[{code,rol?}], notities?, algemeen?,
 *              herkomst:{<veld>:{bron,tijd,door,ook?,via?}}, voorstellen:[{veld,waarde,bron,reden,tijd}],
 *              geweigerd:[{veld,waarde,tijd,door}],
 *              _gewijzigd, _door, _vervallen?:{tijd,door,reden}, _samengevoegd_in?}
 *   bron ∈ hand | moneybird | project | mail | handtekening | ai
 * Regels (de kern van dit register):
 *   - Een automatische bron vult ALLEEN lege velden of voegt een extra e-mail/telefoon/project toe.
 *     Een afwijkende waarde wordt een VOORSTEL; er wordt nooit stil overschreven.
 *   - Velden met bron 'hand' worden bij het samenvoegen tussen pc's nooit door automatische
 *     bronnen overschreven (merger).
 *   - Ontdubbelen: primair op e-mailadres (lowercase), secundair naam + organisatie.
 *   - Verwijderen en samenvoegen zijn handacties met een tombstone (`_vervallen`, evt.
 *     `_samengevoegd_in`); de tombstone houdt de e-mailadressen vast, zodat een automatische
 *     bron een verwijderd contact niet opnieuw aanmaakt.
 *   - Elke wijziging: _door/_gewijzigd + een journaalregel in mt_contacten_journaal
 *     (alleen toevoegen, max 2000; bevat geen e-mailadressen of telefoonnummers).
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  const KEY = 'mt_contacten', JKEY = 'mt_contacten_journaal', JMAX = 2000;
  const BRONNEN = ['hand', 'moneybird', 'project', 'mail', 'handtekening', 'ai'];
  const ORG_TYPES = ['klant', 'leverancier', 'intern', 'overig'];
  const SCALAIR = ['naam', 'voornaam', 'functie', 'notities'];
  const LIJSTEN = ['emails', 'telefoons', 'projecten'];
  const EIGEN_DOMEIN = 'mortiseandtenon.nl';
  const FREEMAIL_EIGEN = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.nl', 'outlook.com', 'outlook.nl', 'live.com', 'live.nl', 'msn.com',
    'ziggo.nl', 'kpnmail.nl', 'kpnplanet.nl', 'planet.nl', 'home.nl', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'yahoo.nl', 'hetnet.nl',
    'chello.nl', 'casema.nl', 'upcmail.nl', 'telfort.nl', 'quicknet.nl', 'tele2.nl', 'xs4all.nl', 'protonmail.com', 'proton.me', 'gmx.com',
    'gmx.net', 'gmx.de', 'aol.com', 'zonnet.nl', 'online.nl', 'caiway.nl', 'solcon.nl', EIGEN_DOMEIN]);
  const EMAIL_RE = /^[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}$/i;
  const GENERIEK_RE = /^(info|administratie|facturen|factuur|verkoop|sales|support|service|contact|webshop|office|inkoop|orders?|bestellingen|boekhouding|receptie|planning|mail|post|secretariaat)$/i;
  const NOREPLY_RE = /^(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|postmaster|notifications?|bounces?)\b/i;

  const kopie = x => JSON.parse(JSON.stringify(x));
  const lijstVan = v => Array.isArray(v) ? v : [];
  const tijdVan = x => { const v = x && x._gewijzigd; if (typeof v === 'number') return v; const t = Date.parse(v || ''); return isNaN(t) ? 0 : t; };
  const leesJson = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };

  const C = {
    BRONNEN, ORG_TYPES,
    // ── adapters (vervangbaar) ──
    opslag: {
      lees(key) { try { return root.localStorage.getItem(key); } catch (e) { return null; } },
      schrijf(key, tekst) { root.localStorage.setItem(key, tekst); }
    },
    wie() { try { return (typeof root.mtMijEmail === 'function' && root.mtMijEmail()) || ''; } catch (e) { return ''; } },
    nu() { return Date.now(); },
    nieuweId() { return 'c' + C.nu().toString(36) + Math.random().toString(36).slice(2, 7); },

    // ── normalisatie ──
    normEmail(s) {
      const e = String(s == null ? '' : s).trim().toLowerCase().replace(/^mailto:/, '').replace(/[>.,;]+$/, '').replace(/^</, '');
      return EMAIL_RE.test(e) ? e : '';
    },
    // Sleutel waarmee telefoonnummers vergeleken worden (+31 / 0031 / (0) → 0…). '' = geen bruikbaar nummer.
    normTel(nr) {
      let s = String(nr == null ? '' : nr).replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
      if (s.startsWith('+31')) s = '0' + s.slice(3); else if (s.startsWith('0031')) s = '0' + s.slice(4);
      return s.replace(/\D/g, '').length >= 6 ? s : '';
    },
    soortTel(nr) { return /^06\d{8}$/.test(C.normTel(nr)) ? 'mobiel' : 'vast'; },
    normNaam(s) {
      return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    },
    normOrg(s) { return C.normNaam(s).replace(/\b(b v|bv|n v|nv|vof|holding)\b/g, ' ').replace(/\s+/g, ' ').trim(); },
    domein(adres) { const d = String(adres || '').toLowerCase().split('@')[1] || ''; return d; },
    isFreemail(domein) {
      const set = (root.MTKoppel && root.MTKoppel.FREEMAIL) || FREEMAIL_EIGEN;
      return !domein || set.has(String(domein).toLowerCase());
    },
    // Zelfde organisatie? klantCode gelijk, mbContactId gelijk, of genormaliseerde naam gelijk.
    zelfdeOrg(a, b) {
      a = a || {}; b = b || {};
      if (a.klantCode && b.klantCode) return String(a.klantCode).toUpperCase() === String(b.klantCode).toUpperCase();
      if (a.mbContactId && b.mbContactId && String(a.mbContactId) === String(b.mbContactId)) return true;
      const x = C.normOrg(a.naam), y = C.normOrg(b.naam);
      return !!x && x === y;
    },
    // Weergavenaam: naam, anders het eerste e-mailadres.
    weergave(c) { return (c && (c.naam || (c.emails && c.emails[0]) || (c.organisatie && c.organisatie.naam))) || '(zonder naam)'; },

    // ── opslag ──
    // Zorgt dat een record (ook van een oudere versie of een handmatig herstel) alle verwachte velden heeft.
    herstel(c) {
      if (!c || typeof c !== 'object') return c;
      ['emails', 'telefoons', 'projecten', 'voorstellen', 'geweigerd'].forEach(f => { if (!Array.isArray(c[f])) c[f] = []; });
      if (!c.herkomst || typeof c.herkomst !== 'object') c.herkomst = {};
      if (!c.organisatie || typeof c.organisatie !== 'object') c.organisatie = C.schoonOrg({});
      return c;
    },
    lees() {
      const v = leesJson(C.opslag.lees(KEY));
      return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.id).map(C.herstel) : [];
    },
    bewaar(lijst) { C.opslag.schrijf(KEY, JSON.stringify(lijst)); },
    actief(c) { return !!c && !c._vervallen; },
    actieven(lijst) { return (lijst || C.lees()).filter(C.actief); },
    // Stempel = nu, maar altijd later dan de stand waarop de wijziging voortbouwt.
    stempel(c, vorig) {
      let t = C.nu(); const v = tijdVan(vorig); if (v >= t) t = v + 1;
      c._gewijzigd = t; const w = C.wie(); if (w) c._door = w; return c;
    },

    // ── journaal ──
    journaal(regels) {
      try {
        let j = leesJson(C.opslag.lees(JKEY)); if (!Array.isArray(j)) j = [];
        const nu = C.nu(), door = C.wie();
        lijstVan(regels).forEach((r, i) => j.push(Object.assign({ id: 'j' + nu.toString(36) + i + Math.random().toString(36).slice(2, 6), tijd: new Date(nu).toISOString(), door }, r)));
        if (j.length > JMAX) j = j.slice(-JMAX);
        C.opslag.schrijf(JKEY, JSON.stringify(j));
        return true;
      } catch (e) { console.warn('contacten-journaal schrijven mislukt:', e && e.message); return false; }
    },
    // Samenvoeger voor _SP: alleen toevoegen, vereniging op id, op tijd, laatste 2000.
    journaalSamen(lokaal, spData) {
      const L = lijstVan(leesJson(lokaal)), R = lijstVan(leesJson(spData));
      const per = new Map(); [...R, ...L].forEach(x => { if (x && x.id && !per.has(x.id)) per.set(x.id, x); });
      return [...per.values()].sort((a, b) => String(a.tijd).localeCompare(String(b.tijd))).slice(-JMAX);
    },

    // ── herkomst ──
    zetHerkomst(c, veld, bron, tijd, door, extra) {
      c.herkomst = c.herkomst || {};
      c.herkomst[veld] = Object.assign({ bron, tijd, door: door || '' }, extra || {});
    },
    // Lijstveld waar een automatische bron iets aan toevoegt: een bestaande herkomst blijft staan
    // (hand blijft hand), de nieuwe bron komt erbij in `ook`.
    herkomstLijst(c, veld, bron, tijd, door) {
      c.herkomst = c.herkomst || {};
      const h = c.herkomst[veld];
      if (!h) { c.herkomst[veld] = { bron, tijd, door: door || '' }; return; }
      if (h.bron !== bron) { h.ook = Array.from(new Set([...(h.ook || []), bron])); }
    },
    herk(c, veld) { return (c && c.herkomst && c.herkomst[veld]) || null; },
    isHand(c, veld) { const h = C.herk(c, veld); return !!h && h.bron === 'hand'; },
    alleBronnen(c) {
      const s = new Set();
      Object.values((c && c.herkomst) || {}).forEach(h => { if (h) { s.add(h.bron); (h.ook || []).forEach(b => s.add(b)); } });
      return BRONNEN.filter(b => s.has(b));
    },

    // ── contact maken ──
    leegOrg(o) {
      o = o || {};
      return { type: ORG_TYPES.includes(o.type) ? o.type : 'overig', klantCode: o.klantCode ? String(o.klantCode).toUpperCase() : undefined,
        mbContactId: o.mbContactId ? String(o.mbContactId) : undefined, naam: String(o.naam || '').trim() };
    },
    schoonOrg(o) { const x = C.leegOrg(o); Object.keys(x).forEach(k => { if (x[k] === undefined) delete x[k]; }); return x; },
    orgLeeg(o) { return !o || (!o.naam && !o.klantCode && !o.mbContactId); },
    schoneTelefoons(lijst) {
      const uit = [], gezien = new Set();
      lijstVan(lijst).forEach(t => {
        const nr = String(typeof t === 'string' ? t : (t && t.nr) || '').trim(), k = C.normTel(nr);
        if (!k || gezien.has(k)) return; gezien.add(k);
        uit.push({ nr, soort: (t && t.soort) || C.soortTel(nr) });
      });
      return uit;
    },
    schoneEmails(lijst) {
      const uit = [];
      lijstVan(lijst).forEach(e => { const n = C.normEmail(e); if (n && !uit.includes(n)) uit.push(n); });
      return uit;
    },
    schoneProjecten(lijst) {
      const uit = [], gezien = new Set();
      lijstVan(lijst).forEach(p => {
        const code = String(typeof p === 'string' ? p : (p && p.code) || '').trim(); if (!code || gezien.has(code)) return; gezien.add(code);
        const rol = p && p.rol ? String(p.rol).trim() : ''; uit.push(rol ? { code, rol } : { code });
      });
      return uit;
    },
    // `ink` = inkomende gegevens van een bron (ook voor handmatig aanmaken, met bron 'hand').
    nieuw(ink, bron, tijd, door) {
      tijd = tijd || new Date(C.nu()).toISOString();
      const c = { id: C.nieuweId(), naam: String(ink.naam || '').trim(), emails: C.schoneEmails(ink.emails), telefoons: C.schoneTelefoons(ink.telefoons),
        organisatie: C.schoonOrg(ink.organisatie), projecten: C.schoneProjecten(ink.projecten), herkomst: {}, voorstellen: [], geweigerd: [] };
      ['voornaam', 'functie', 'notities'].forEach(f => { const v = String(ink[f] || '').trim(); if (v) c[f] = v; });
      if (ink.algemeen) c.algemeen = true;
      if (ink.locatie && (ink.locatie.code || ink.locatie.naam)) {
        c.locatie = { code: String(ink.locatie.code || '').toUpperCase(), naam: String(ink.locatie.naam || ''), adres: String(ink.locatie.adres || '') };
        if (!c.locatie.adres) delete c.locatie.adres;
      }
      SCALAIR.forEach(f => { if (c[f]) C.zetHerkomst(c, f, bron, tijd, door); });
      if (!C.orgLeeg(c.organisatie)) C.zetHerkomst(c, 'organisatie', bron, tijd, door);
      if (c.locatie) C.zetHerkomst(c, 'locatie', bron, tijd, door);
      LIJSTEN.forEach(l => { if (c[l].length) C.zetHerkomst(c, l, bron, tijd, door); });
      return c;
    },

    // ── ontdubbelen ──
    index(lijst) {
      const ix = { email: new Map(), id: new Map(), naam: new Map() };
      (lijst || []).forEach(c => {
        ix.id.set(c.id, c);
        lijstVan(c.emails).forEach(e => { const o = ix.email.get(e); if (!o || (o._vervallen && !c._vervallen)) ix.email.set(e, c); });
        if (!c._vervallen && c.naam) { const k = C.normNaam(c.naam); if (k) { if (!ix.naam.has(k)) ix.naam.set(k, []); ix.naam.get(k).push(c); } }
      });
      return ix;
    },
    indexToevoegen(ix, c) {
      ix.id.set(c.id, c);
      lijstVan(c.emails).forEach(e => ix.email.set(e, c));
      if (!c._vervallen && c.naam) { const k = C.normNaam(c.naam); if (k) { if (!ix.naam.has(k)) ix.naam.set(k, []); ix.naam.get(k).push(c); } }
    },
    // Volgt een samenvoeg-tombstone naar het contact waarin hij is opgegaan.
    oplossen(ix, c) {
      let n = 0;
      while (c && c._vervallen && c._samengevoegd_in && n++ < 6) { const t = ix.id.get(c._samengevoegd_in); if (!t) break; c = t; }
      return c;
    },
    // Bestaand contact bij inkomende gegevens: eerst e-mail, dan naam + organisatie.
    vind(ix, ink) {
      for (const e of lijstVan(ink.emails)) { const c = ix.email.get(e); if (c) return C.oplossen(ix, c); }
      const k = C.normNaam(ink.naam);
      if (k && !C.orgLeeg(ink.organisatie)) {
        const kand = (ix.naam.get(k) || []).find(c => C.actief(c) && !C.orgLeeg(c.organisatie) && C.zelfdeOrg(c.organisatie, ink.organisatie));
        if (kand) return kand;
      }
      return null;
    },
    // Mogelijke dubbelen onder actieve contacten (gedeeld e-mailadres of gelijke naam + organisatie).
    dubbelen(lijst) {
      const act = C.actieven(lijst || C.lees()), uit = [], gezien = new Set();
      const paar = (a, b, reden) => { const k = [a.id, b.id].sort().join('|'); if (a.id !== b.id && !gezien.has(k)) { gezien.add(k); uit.push({ a, b, reden }); } };
      const perEmail = new Map(), perNaam = new Map();
      act.forEach(c => {
        lijstVan(c.emails).forEach(e => { if (perEmail.has(e)) paar(perEmail.get(e), c, 'zelfde e-mailadres'); else perEmail.set(e, c); });
        const k = C.normNaam(c.naam);
        if (k) { (perNaam.get(k) || []).forEach(o => { if (C.zelfdeOrg(o.organisatie, c.organisatie) && !C.orgLeeg(c.organisatie)) paar(o, c, 'zelfde naam en organisatie'); }); if (!perNaam.has(k)) perNaam.set(k, []); perNaam.get(k).push(c); }
      });
      return uit;
    },

    // ── automatisch aanvullen (nooit overschrijven) ──
    voorstelSleutel(v) { return v.veld + '|' + C.normNaam(typeof v.waarde === 'object' ? JSON.stringify(v.waarde) : v.waarde); },
    isGeweigerd(c, veld, waarde) {
      const k = C.voorstelSleutel({ veld, waarde });
      return lijstVan(c.geweigerd).some(g => C.voorstelSleutel(g) === k);
    },
    voegVoorstelToe(c, veld, waarde, bron, reden, tijd) {
      if (C.isGeweigerd(c, veld, waarde)) return null;
      const k = C.voorstelSleutel({ veld, waarde });
      c.voorstellen = lijstVan(c.voorstellen);
      if (c.voorstellen.some(v => C.voorstelSleutel(v) === k)) return null;
      const v = { veld, waarde, bron, reden: reden || '', tijd: tijd || new Date(C.nu()).toISOString() };
      c.voorstellen.push(v); return v;
    },
    // Past `ink` toe op contact `c` (in place). Geeft {velden:[…], voorstellen:[…]} van wat er veranderde.
    // opts: {bron, tijd, door, ix (voor 'e-mail hoort al bij ander contact'), reden}
    aanvullen(c, ink, opts) {
      const bron = opts.bron, tijd = opts.tijd || new Date(C.nu()).toISOString(), door = opts.door || '';
      const res = { velden: [], voorstellen: [] };
      const reden = opts.reden || ('Andere waarde uit ' + bron);
      const voorstel = (veld, waarde) => { const v = C.voegVoorstelToe(c, veld, waarde, bron, reden, tijd); if (v) res.voorstellen.push(v); };
      const gevuld = (veld) => { if (!res.velden.includes(veld)) res.velden.push(veld); };
      // scalaire velden
      SCALAIR.forEach(f => {
        const nieuw = String(ink[f] || '').trim(); if (!nieuw) return;
        const oud = String(c[f] || '').trim();
        if (!oud) { c[f] = nieuw; if (f === 'naam' && ink.algemeen) c.algemeen = true; C.zetHerkomst(c, f, bron, tijd, door); gevuld(f); return; }
        if (C.normNaam(oud) === C.normNaam(nieuw)) return;
        if (ink.algemeen && f !== 'notities') return;                // een algemeen adres stelt geen persoonsgegevens voor
        voorstel(f, nieuw);
      });
      // organisatie: ontbrekende deelvelden vullen, afwijkende naam/klant → voorstel
      const io = C.schoonOrg(ink.organisatie);
      if (!C.orgLeeg(io)) {
        const o = c.organisatie = c.organisatie || C.schoonOrg({}); let veranderd = false;
        const wasLeeg = C.orgLeeg(o);
        if (wasLeeg && io.type) { o.type = io.type; veranderd = true; }
        if (!o.naam && io.naam) { o.naam = io.naam; veranderd = true; }
        if (!o.klantCode && io.klantCode) { o.klantCode = io.klantCode; veranderd = true; }
        if (!o.mbContactId && io.mbContactId) { o.mbContactId = io.mbContactId; veranderd = true; }
        if (veranderd) { if (!C.herk(c, 'organisatie')) C.zetHerkomst(c, 'organisatie', bron, tijd, door); gevuld('organisatie'); }
        const afwijkt = (o.naam && io.naam && C.normOrg(o.naam) !== C.normOrg(io.naam) && !C.zelfdeOrg(o, io))
          || (o.klantCode && io.klantCode && o.klantCode !== io.klantCode)
          || (o.mbContactId && io.mbContactId && String(o.mbContactId) !== String(io.mbContactId))
          || (!wasLeeg && o.type !== io.type && io.type && io.type !== 'overig');
        if (afwijkt && !ink.algemeen) voorstel('organisatie', io);
      }
      // locatie
      const il = ink.locatie && (ink.locatie.code || ink.locatie.naam) ? { code: String(ink.locatie.code || '').toUpperCase(), naam: String(ink.locatie.naam || ''), adres: String(ink.locatie.adres || '') } : null;
      if (il) {
        if (!c.locatie || (!c.locatie.code && !c.locatie.naam)) { c.locatie = il; if (!il.adres) delete c.locatie.adres; C.zetHerkomst(c, 'locatie', bron, tijd, door); gevuld('locatie'); }
        else {
          if (!c.locatie.adres && il.adres) { c.locatie.adres = il.adres; gevuld('locatie'); }
          if (il.code && c.locatie.code && il.code !== c.locatie.code) voorstel('locatie', il);
        }
      }
      // lijsten: alleen toevoegen
      const anders = opts.ix;
      const elders = (soort, sleutel) => {                          // hoort dit al bij een ander actief contact?
        if (!anders || soort !== 'email') return false;
        const o = anders.email.get(sleutel); return !!o && o.id !== c.id;
      };
      lijstVan(ink.emails).forEach(e => {
        e = C.normEmail(e); if (!e || c.emails.includes(e) || elders('email', e) || C.isGeweigerd(c, 'email', e)) return;
        c.emails.push(e); C.herkomstLijst(c, 'emails', bron, tijd, door); gevuld('emails');
        if (anders) anders.email.set(e, c);
      });
      const bekendTel = new Set(c.telefoons.map(t => C.normTel(t.nr)));
      C.schoneTelefoons(ink.telefoons).forEach(t => {
        const k = C.normTel(t.nr); if (bekendTel.has(k) || C.isGeweigerd(c, 'telefoon', t.nr)) return;
        bekendTel.add(k); c.telefoons.push(t); C.herkomstLijst(c, 'telefoons', bron, tijd, door); gevuld('telefoons');
      });
      const bekendP = new Map(c.projecten.map(p => [p.code, p]));
      C.schoneProjecten(ink.projecten).forEach(p => {
        const b = bekendP.get(p.code);
        if (b) { if (!b.rol && p.rol) { b.rol = p.rol; gevuld('projecten'); } return; }
        if (C.isGeweigerd(c, 'project', p.code)) return;
        c.projecten.push(p); bekendP.set(p.code, p); C.herkomstLijst(c, 'projecten', bron, tijd, door); gevuld('projecten');
      });
      return res;
    },

    // Rekent uit wat een reeks inkomende gegevens met de lijst zou doen — SCHRIJFT NIETS (droogloop).
    // inkomend: [{bron, reden?, naam, …}] → {lijst, nieuw:[contact], aangevuld:[{id,naam,velden}],
    //   voorstellen:[{id,naam,veld,waarde,bron}], overgeslagen, samenvatting:{nieuw,aangevuld,voorstellen,overgeslagen}, tekst}
    bereken(lijst, inkomend, opts) {
      opts = opts || {};
      const tijd = new Date(C.nu()).toISOString(), door = C.wie();
      const werk = kopie(lijstVan(lijst)), ix = C.index(werk);
      const nieuw = new Map(), geraakt = new Map(), voorstellen = [];
      let overgeslagen = 0;
      lijstVan(inkomend).forEach(raw => {
        const ink = Object.assign({}, raw, { emails: C.schoneEmails(raw.emails), telefoons: C.schoneTelefoons(raw.telefoons) });
        if (!ink.emails.length && !String(ink.naam || '').trim()) return;
        const bron = raw.bron || 'ai';
        let c = C.vind(ix, ink);
        if (c && c._vervallen) { overgeslagen++; return; }          // handmatig verwijderd/samengevoegd: niet terugbrengen
        if (!c) {
          // e-mailadressen die al bij een ander contact horen niet nogmaals meenemen
          ink.emails = ink.emails.filter(e => !ix.email.has(e));
          c = C.nieuw(ink, bron, tijd, door); werk.push(c); C.indexToevoegen(ix, c); nieuw.set(c.id, c); return;
        }
        const res = C.aanvullen(c, ink, { bron, tijd, door, ix, reden: raw.reden });
        res.voorstellen.forEach(v => voorstellen.push({ id: c.id, naam: C.weergave(c), veld: v.veld, waarde: v.waarde, bron: v.bron }));
        if (nieuw.has(c.id)) return;                                 // nieuw in deze run: telt als nieuw
        if (res.velden.length || res.voorstellen.length) {
          const g = geraakt.get(c.id) || { id: c.id, naam: C.weergave(c), velden: [], voorstellen: 0 };
          res.velden.forEach(v => { if (!g.velden.includes(v)) g.velden.push(v); }); g.voorstellen += res.voorstellen.length; geraakt.set(c.id, g);
        }
      });
      // stempel alles wat veranderde (nieuw én aangevuld) één keer
      const orig = new Map(lijstVan(lijst).map(c => [c.id, c]));
      nieuw.forEach(c => C.stempel(c, null));
      geraakt.forEach(g => { const c = ix.id.get(g.id); C.stempel(c, orig.get(g.id)); });
      const aangevuld = [...geraakt.values()].filter(g => g.velden.length);
      const metVoorstel = [...geraakt.values()].filter(g => g.voorstellen);
      const samenvatting = { nieuw: nieuw.size, aangevuld: aangevuld.length, voorstellen: voorstellen.length, overgeslagen };
      return { lijst: werk, nieuw: [...nieuw.values()], aangevuld, metVoorstel, voorstellen, overgeslagen, samenvatting,
        tekst: samenvatting.nieuw + ' nieuw, ' + samenvatting.aangevuld + ' aangevuld, ' + samenvatting.voorstellen + ' voorstellen' };
    },
    // Plan opslaan + journaal (na bevestiging). Geeft true bij succes.
    pasPlanToe(plan, bronLabel) {
      if (!plan || !plan.lijst) return false;
      const s = plan.samenvatting;
      if (!s.nieuw && !s.aangevuld && !plan.voorstellen.length) return true;
      C.bewaar(plan.lijst);
      const regels = [{ actie: 'bijwerken', bron: bronLabel || '', nieuw: s.nieuw, aangevuld: s.aangevuld, voorstellen: s.voorstellen, ids: plan.nieuw.map(c => c.id) }];
      plan.aangevuld.forEach(g => regels.push({ actie: 'aanvullen', contact: g.id, velden: g.velden, bron: bronLabel || '' }));
      plan.metVoorstel.forEach(g => regels.push({ actie: 'voorstel', contact: g.id, aantal: g.voorstellen, bron: bronLabel || '' }));
      C.journaal(regels);
      return true;
    },

    // ── samenvoegen tussen pc's (de _SP-merger) ──
    // Per contact wint de nieuwste stempel (gelijk → deterministisch op inhoud; beide ongestempeld → SharePoint).
    // Daarbovenop: een veld met bron 'hand' wordt niet door een automatisch veld van de winnaar overschreven,
    // lijsten groeien (vereniging), voorstellen/geweigerd worden verenigd. Tombstones winnen als ze nieuwer zijn.
    samenContact(l, r) {
      C.herstel(l); C.herstel(r);
      const tl = tijdVan(l), tr = tijdVan(r);
      let win, verl;
      if (tl > tr) { win = l; verl = r; }
      else if (tr > tl) { win = r; verl = l; }
      else if (!tl) { win = r; verl = l; }                              // beide ongestempeld → SharePoint
      else { win = JSON.stringify(l) >= JSON.stringify(r) ? l : r; verl = win === l ? r : l; }
      if (win._vervallen) {
        // een tombstone houdt de e-mailadressen vast (ook die van een gelijktijdig gewijzigde kopie),
        // zodat een automatische bron het contact niet opnieuw aanmaakt
        const t = kopie(win); t.emails = C.schoneEmails([...lijstVan(win.emails), ...lijstVan(verl.emails)]); return t;
      }
      const uit = kopie(win); uit.herkomst = uit.herkomst || {};
      const vh = (verl.herkomst || {});
      // scalaire velden
      [...SCALAIR, 'organisatie', 'locatie'].forEach(f => {
        const wh = uit.herkomst[f], lh = vh[f];
        const wv = uit[f], lv = verl[f];
        const leeg = x => x === undefined || x === null || x === '' || (typeof x === 'object' && !Object.keys(x).length) || (f === 'organisatie' && C.orgLeeg(x));
        if (!leeg(lv) && JSON.stringify(wv) !== JSON.stringify(lv)) {
          const verliesHand = lh && lh.bron === 'hand' && !(wh && wh.bron === 'hand');
          if (leeg(wv) && !(wh && wh.bron === 'hand') || verliesHand) { uit[f] = kopie(lv); if (lh) uit.herkomst[f] = kopie(lh); }
        }
      });
      // geweigerd: vereniging (een expliciet verwijderd/geweigerd item blijft weg)
      const geweigerd = new Map();
      [...lijstVan(win.geweigerd), ...lijstVan(verl.geweigerd)].forEach(g => { if (g) geweigerd.set(C.voorstelSleutel(g), g); });
      uit.geweigerd = [...geweigerd.values()];
      const weg = (f, x) => lijstVan(uit.geweigerd).some(g => g && (f === 'emails' ? g.veld === 'email' && C.normEmail(g.waarde) === x
        : f === 'telefoons' ? g.veld === 'telefoon' && C.normTel(g.waarde) === C.normTel(x.nr) : g.veld === 'project' && g.waarde === x.code));
      // lijsten: de met de hand bewerkte kant is gezaghebbend; items van de andere kant blijven, behalve wat expliciet is verwijderd
      const sl = { emails: e => e, telefoons: t => C.normTel(t.nr), projecten: p => p.code };
      LIJSTEN.forEach(f => {
        const wh = uit.herkomst[f], lh = vh[f], wL = lijstVan(win[f]), lL = lijstVan(verl[f]);
        const auth = (wh && wh.bron === 'hand') ? wL : (lh && lh.bron === 'hand') ? lL : null;
        const rest = auth === wL ? lL : wL;
        const lijst = auth ? [...auth, ...rest.filter(x => !weg(f, x))] : [...wL, ...lL];
        const gezien = new Set(), res = [];
        lijst.forEach(x => { const k = sl[f](x); if (k && !gezien.has(k)) { gezien.add(k); res.push(kopie(x)); } });
        uit[f] = res;
        if (!wh && lh) uit.herkomst[f] = kopie(lh);
        else if (wh && lh && lh.bron === 'hand' && wh.bron !== 'hand') uit.herkomst[f] = kopie(lh);
      });
      // voorstellen: vereniging minus geweigerd en minus wat inmiddels in het contact staat
      const reeds = v => {
        if (v.veld === 'telefoon') return uit.telefoons.some(t => C.normTel(t.nr) === C.normTel(v.waarde && v.waarde.nr || v.waarde));
        if (v.veld === 'email') return uit.emails.includes(C.normEmail(v.waarde));
        if (v.veld === 'organisatie' || v.veld === 'locatie') return JSON.stringify(uit[v.veld]) === JSON.stringify(v.waarde);
        return SCALAIR.includes(v.veld) && C.normNaam(uit[v.veld]) === C.normNaam(v.waarde);
      };
      const vs = new Map();
      [...lijstVan(win.voorstellen), ...lijstVan(verl.voorstellen)].forEach(v => {
        if (!v) return; const k = C.voorstelSleutel(v);
        if (!vs.has(k) && !geweigerd.has(k) && !reeds(v)) vs.set(k, v);
      });
      uit.voorstellen = [...vs.values()];
      return uit;
    },
    samen(lokaal, spData) {
      const L = lijstVan(leesJson(lokaal)), R = lijstVan(leesJson(spData));
      const perId = new Map(), los = [];
      const nr = [...R.map(x => ['r', x]), ...L.map(x => ['l', x])];
      nr.forEach(([kant, x]) => {
        if (!x || typeof x !== 'object' || !x.id) { los.push(x); return; }
        const o = perId.get(x.id);
        perId.set(x.id, o ? (kant === 'l' ? C.samenContact(x, o) : C.samenContact(o, x)) : x);
      });
      return [...perId.values(), ...los.filter(x => x && typeof x === 'object')];
    },

    // ── handacties (elk met stempel + journaal) ──
    _wijzig(id, fn, actie, extra) {
      const lijst = C.lees(), i = lijst.findIndex(c => c.id === id);
      if (i < 0) return { ok: false, fout: 'Contact niet gevonden' };
      const voor = lijst[i], c = kopie(voor);
      const r = fn(c, lijst);
      if (r && r.ok === false) return r;
      C.stempel(c, voor); lijst[i] = c;
      (r && r.ook || []).forEach(o => { const j = lijst.findIndex(x => x.id === o.id); if (j >= 0) lijst[j] = C.stempel(o, lijst[j]); });
      C.bewaar(lijst);
      C.journaal([Object.assign({ actie, contact: id, bron: 'hand' }, extra || {}, r && r.journaal || {})]);
      return { ok: true, contact: c };
    },
    _emailElders(lijst, id, emails) {
      for (const e of emails) { const o = lijst.find(x => x.id !== id && C.actief(x) && lijstVan(x.emails).includes(e)); if (o) return o; }
      return null;
    },
    // Nieuw contact met de hand. velden = {naam, voornaam, functie, emails, telefoons, organisatie, locatie, projecten, notities}
    maak(velden) {
      const lijst = C.lees(), emails = C.schoneEmails(velden.emails);
      const dub = C._emailElders(lijst, '', emails);
      if (dub) return { ok: false, fout: 'Dit e-mailadres hoort al bij ' + C.weergave(dub), dubbel: dub };
      if (!String(velden.naam || '').trim() && !emails.length) return { ok: false, fout: 'Vul een naam of e-mailadres in' };
      const c = C.nieuw(Object.assign({}, velden, { emails }), 'hand', new Date(C.nu()).toISOString(), C.wie());
      C.stempel(c, null); lijst.push(c); C.bewaar(lijst);
      C.journaal([{ actie: 'aanmaak', contact: c.id, bron: 'hand' }]);
      return { ok: true, contact: c };
    },
    // Velden wijzigen met de hand. Alleen echt gewijzigde velden krijgen herkomst 'hand'.
    bewerk(id, patch) {
      return C._wijzig(id, (c, lijst) => {
        const tijd = new Date(C.nu()).toISOString(), door = C.wie(), gewijzigd = [];
        const zet = f => { C.zetHerkomst(c, f, 'hand', tijd, door); gewijzigd.push(f); };
        SCALAIR.forEach(f => {
          if (!(f in patch)) return; const v = String(patch[f] || '').trim();
          if (v === String(c[f] || '')) return;
          if (v) c[f] = v; else delete c[f];
          if (f === 'naam') delete c.algemeen;
          zet(f);
        });
        if ('emails' in patch) {
          const e = C.schoneEmails(patch.emails);
          if (JSON.stringify(e) !== JSON.stringify(c.emails)) {
            const dub = C._emailElders(lijst, id, e);
            if (dub) return { ok: false, fout: 'Dit e-mailadres hoort al bij ' + C.weergave(dub) };
            c.geweigerd = lijstVan(c.geweigerd);
            c.emails.filter(x => !e.includes(x)).forEach(x => c.geweigerd.push({ veld: 'email', waarde: x, tijd, door }));
            c.emails = e; zet('emails');
          }
        }
        if ('telefoons' in patch) {
          const t = C.schoneTelefoons(patch.telefoons);
          if (JSON.stringify(t) !== JSON.stringify(c.telefoons)) {
            c.geweigerd = lijstVan(c.geweigerd);
            const nieuweK = new Set(t.map(x => C.normTel(x.nr)));
            c.telefoons.filter(x => !nieuweK.has(C.normTel(x.nr))).forEach(x => c.geweigerd.push({ veld: 'telefoon', waarde: x.nr, tijd, door }));
            c.telefoons = t; zet('telefoons');
          }
        }
        if ('projecten' in patch) {
          const p = C.schoneProjecten(patch.projecten);
          if (JSON.stringify(p) !== JSON.stringify(c.projecten)) {
            c.geweigerd = lijstVan(c.geweigerd);
            const codes = new Set(p.map(x => x.code));
            c.projecten.filter(x => !codes.has(x.code)).forEach(x => c.geweigerd.push({ veld: 'project', waarde: x.code, tijd, door }));
            c.projecten = p; zet('projecten');
          }
        }
        if ('organisatie' in patch) {
          const o = C.schoonOrg(patch.organisatie);
          if (JSON.stringify(o) !== JSON.stringify(C.schoonOrg(c.organisatie))) { c.organisatie = o; zet('organisatie'); }
        }
        if ('locatie' in patch) {
          const l = patch.locatie && (patch.locatie.code || patch.locatie.naam || patch.locatie.adres)
            ? { code: String(patch.locatie.code || '').toUpperCase(), naam: String(patch.locatie.naam || '').trim(), adres: String(patch.locatie.adres || '').trim() } : null;
          if (l && !l.adres) delete l.adres;
          if (JSON.stringify(l) !== JSON.stringify(c.locatie || null)) { if (l) c.locatie = l; else delete c.locatie; zet('locatie'); }
        }
        if (!gewijzigd.length) return { ok: false, fout: 'Niets gewijzigd' };
        return { journaal: { velden: gewijzigd } };
      }, 'bewerk');
    },
    koppelProject(id, code, rol) {
      return C._wijzig(id, c => {
        const p = c.projecten.find(x => x.code === code);
        if (p && (!rol || p.rol === rol)) return { ok: false, fout: 'Al gekoppeld' };
        if (p) p.rol = rol; else c.projecten.push(rol ? { code, rol } : { code });
        c.geweigerd = lijstVan(c.geweigerd).filter(g => !(g.veld === 'project' && g.waarde === code));
        C.zetHerkomst(c, 'projecten', 'hand', new Date(C.nu()).toISOString(), C.wie());
        return { journaal: { project: code } };
      }, 'koppel-project');
    },
    ontkoppelProject(id, code) {
      return C._wijzig(id, c => {
        if (!c.projecten.some(x => x.code === code)) return { ok: false, fout: 'Niet gekoppeld' };
        const tijd = new Date(C.nu()).toISOString(), door = C.wie();
        c.projecten = c.projecten.filter(x => x.code !== code);
        c.geweigerd = lijstVan(c.geweigerd); c.geweigerd.push({ veld: 'project', waarde: code, tijd, door });
        C.zetHerkomst(c, 'projecten', 'hand', tijd, door);
        return { journaal: { project: code } };
      }, 'ontkoppel-project');
    },
    // Voorstel accepteren of weigeren (door een mens). Geaccepteerd = bron 'hand' (via de oorspronkelijke bron).
    beslis(id, sleutel, accepteer) {
      return C._wijzig(id, (c, lijst) => {
        const i = lijstVan(c.voorstellen).findIndex(v => C.voorstelSleutel(v) === sleutel);
        if (i < 0) return { ok: false, fout: 'Voorstel niet meer aanwezig' };
        const v = c.voorstellen[i], tijd = new Date(C.nu()).toISOString(), door = C.wie();
        if (accepteer) {
          if (v.veld === 'telefoon') {
            const t = C.schoneTelefoons([v.waarde && v.waarde.nr ? v.waarde : { nr: v.waarde }]);
            t.forEach(x => { if (!c.telefoons.some(y => C.normTel(y.nr) === C.normTel(x.nr))) c.telefoons.push(x); });
            C.zetHerkomst(c, 'telefoons', 'hand', tijd, door, { via: v.bron });
          } else if (v.veld === 'email') {
            const e = C.normEmail(v.waarde);
            if (!e) return { ok: false, fout: 'Ongeldig e-mailadres' };
            const dub = C._emailElders(lijst, id, [e]); if (dub) return { ok: false, fout: 'Dit e-mailadres hoort al bij ' + C.weergave(dub) };
            if (!c.emails.includes(e)) c.emails.push(e);
            C.zetHerkomst(c, 'emails', 'hand', tijd, door, { via: v.bron });
          } else if (v.veld === 'organisatie') {
            c.organisatie = C.schoonOrg(Object.assign({}, c.organisatie, v.waarde)); C.zetHerkomst(c, 'organisatie', 'hand', tijd, door, { via: v.bron });
          } else if (v.veld === 'locatie') {
            c.locatie = kopie(v.waarde); C.zetHerkomst(c, 'locatie', 'hand', tijd, door, { via: v.bron });
          } else if (SCALAIR.includes(v.veld)) {
            c[v.veld] = String(v.waarde || '').trim(); if (v.veld === 'naam') delete c.algemeen; C.zetHerkomst(c, v.veld, 'hand', tijd, door, { via: v.bron });
          } else return { ok: false, fout: 'Onbekend veld' };
        } else {
          c.geweigerd = lijstVan(c.geweigerd); c.geweigerd.push({ veld: v.veld, waarde: v.waarde, tijd, door });
        }
        c.voorstellen.splice(i, 1);
        return { journaal: { veld: v.veld, voorstelBron: v.bron } };
      }, accepteer ? 'voorstel-akkoord' : 'voorstel-geweigerd');
    },
    // Samenvoegen met de hand: `bronId` gaat op in `doelId`. Niets gaat verloren: afwijkende
    // scalaire waarden van het bron-contact worden voorstellen bij het doel.
    voegSamen(doelId, bronId) {
      if (doelId === bronId) return { ok: false, fout: 'Kies twee verschillende contacten' };
      const lijst = C.lees(), di = lijst.findIndex(c => c.id === doelId && C.actief(c)), bi = lijst.findIndex(c => c.id === bronId && C.actief(c));
      if (di < 0 || bi < 0) return { ok: false, fout: 'Contact niet gevonden' };
      const dv = lijst[di], bv = lijst[bi], d = C.herstel(kopie(dv)), b = C.herstel(kopie(bv)), tijd = new Date(C.nu()).toISOString(), door = C.wie();
      SCALAIR.forEach(f => {
        if (!b[f]) return;
        if (!d[f]) { d[f] = b[f]; if (b.herkomst && b.herkomst[f]) d.herkomst[f] = b.herkomst[f]; }
        else if (C.normNaam(d[f]) !== C.normNaam(b[f])) C.voegVoorstelToe(d, f, b[f], 'hand', 'Uit samengevoegd contact', tijd);
      });
      if (C.orgLeeg(d.organisatie) && !C.orgLeeg(b.organisatie)) { d.organisatie = b.organisatie; if (b.herkomst.organisatie) d.herkomst.organisatie = b.herkomst.organisatie; }
      else if (!C.orgLeeg(b.organisatie) && !C.zelfdeOrg(d.organisatie, b.organisatie)) C.voegVoorstelToe(d, 'organisatie', C.schoonOrg(b.organisatie), 'hand', 'Uit samengevoegd contact', tijd);
      if (!d.locatie && b.locatie) { d.locatie = b.locatie; if (b.herkomst.locatie) d.herkomst.locatie = b.herkomst.locatie; }
      d.emails = C.schoneEmails([...d.emails, ...b.emails]);
      d.telefoons = C.schoneTelefoons([...d.telefoons, ...b.telefoons]);
      d.projecten = C.schoneProjecten([...d.projecten, ...b.projecten]);
      LIJSTEN.forEach(f => { if (b.herkomst && b.herkomst[f] && !d.herkomst[f]) d.herkomst[f] = b.herkomst[f]; });
      if (!d.algemeen !== !b.algemeen && b.algemeen === undefined) { /* doel blijft zoals het was */ }
      const gew = new Map(); [...lijstVan(d.geweigerd), ...lijstVan(b.geweigerd)].forEach(g => gew.set(C.voorstelSleutel(g), g)); d.geweigerd = [...gew.values()];
      lijstVan(b.voorstellen).forEach(v => { if (!C.isGeweigerd(d, v.veld, v.waarde)) { const k = C.voorstelSleutel(v); if (!d.voorstellen.some(x => C.voorstelSleutel(x) === k)) d.voorstellen.push(v); } });
      b._vervallen = { tijd, door, reden: 'samengevoegd' }; b._samengevoegd_in = doelId;
      C.stempel(d, dv); C.stempel(b, bv);
      lijst[di] = d; lijst[bi] = b; C.bewaar(lijst);
      C.journaal([{ actie: 'samenvoegen', contact: doelId, samengevoegd: bronId, bron: 'hand' }]);
      return { ok: true, contact: d };
    },
    verwijder(id) {
      return C._wijzig(id, c => { c._vervallen = { tijd: new Date(C.nu()).toISOString(), door: C.wie(), reden: 'verwijderd' }; return {}; }, 'verwijder');
    },

    // ── opvragen ──
    perId(id) { return C.lees().find(c => c.id === id) || null; },
    perEmail(adres) { const e = C.normEmail(adres); return e ? (C.actieven().find(c => c.emails.includes(e)) || null) : null; },
    // Contacten van een klant (en evt. locatie): organisatie.klantCode / mbContactId / gekoppeld aan een van zijn projecten.
    voorKlant(klantCode, opts) {
      opts = opts || {};
      const kl = String(klantCode || '').toUpperCase(), loc = String(opts.loc || '').toUpperCase();
      const mbIds = new Set([...(opts.mbIds || [])].map(String)), codes = new Set(opts.projectCodes || []);
      return C.actieven(opts.lijst).filter(c => {
        const o = c.organisatie || {};
        const hoort = (kl && String(o.klantCode || '').toUpperCase() === kl) || (o.mbContactId && mbIds.has(String(o.mbContactId)))
          || lijstVan(c.projecten).some(p => codes.has(p.code));
        if (!hoort) return false;
        return !loc || !c.locatie || !c.locatie.code || c.locatie.code === loc;
      }).sort(C.sorteer);
    },
    sorteer(a, b) { return (a.algemeen ? 1 : 0) - (b.algemeen ? 1 : 0) || C.normNaam(C.weergave(a)).localeCompare(C.normNaam(C.weergave(b)), 'nl'); },
    // Contacten van een project; bestaan er geen, dan die van de klant/locatie (afgeleid).
    // proj = {code, klant?, loc?}; zonder klant/loc wordt die uit de code gehaald (KLANT-LOC-PRODUCT).
    voorProject(proj, opts) {
      opts = opts || {};
      const code = proj && proj.code; if (!code) return { direct: [], afgeleid: [] };
      const act = C.actieven(opts.lijst);
      const direct = act.filter(c => lijstVan(c.projecten).some(p => p.code === code)).sort(C.sorteer);
      const delen = String(code).split('-');
      const kl = String(proj.klant || delen[0] || '').toUpperCase(), loc = String(proj.loc || (delen.length >= 3 ? delen[1] : '') || '').toUpperCase();
      const afgeleid = kl ? act.filter(c => !direct.includes(c) && String((c.organisatie || {}).klantCode || '').toUpperCase() === kl
        && (!loc || !c.locatie || !c.locatie.code || c.locatie.code === loc)).sort(C.sorteer) : [];
      return { direct, afgeleid };
    },
    // Zoeken op naam / e-mail / telefoon (cijfers) / organisatie / functie. Elke zoekterm moet ergens voorkomen.
    zoek(q, opts) {
      opts = opts || {};
      const termen = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!termen.length) return [];
      const act = C.actieven(opts.lijst);
      const telZoek = t => { let x = t.replace(/\(0\)/g, '').replace(/[^\d+]/g, ''); if (x.startsWith('+31')) x = '0' + x.slice(3); else if (x.startsWith('0031')) x = '0' + x.slice(4); return x.replace(/\D/g, ''); };
      const heelNr = /^[\d\s()+.-]{6,}$/.test(String(q).trim()) ? telZoek(String(q).trim()) : '';
      const res = act.filter(c => {
        if (heelNr.length >= 6 && c.telefoons.some(t => C.normTel(t.nr).replace(/\D/g, '').includes(heelNr))) return true;
        const hooi = [C.normNaam(c.naam), C.normNaam(c.voornaam), C.normNaam(c.functie), C.normNaam((c.organisatie || {}).naam), C.normNaam((c.organisatie || {}).klantCode),
          c.emails.join(' ')].join(' ');
        const nrs = c.telefoons.map(t => C.normTel(t.nr).replace(/\D/g, ''));
        return termen.every(t => {
          const tel = /^[\d\s()+.-]{3,}$/.test(t) ? telZoek(t) : '';
          if (tel.length >= 3 && nrs.some(n => n.includes(tel))) return true;
          return hooi.includes(t) || hooi.includes(C.normNaam(t));
        });
      });
      return res.sort(C.sorteer).slice(0, opts.max || 50);
    },
    telHref(nr) { const s = String(nr || '').replace(/\(0\)/g, '').replace(/[^\d+]/g, ''); return s ? 'tel:' + s : ''; },
    mailHref(adres) { const e = C.normEmail(adres); return e ? 'mailto:' + e : ''; },
    routeHref(adres) { const a = String(adres || '').trim(); return a ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a) : ''; }
  };
  root.MTContacten = C;
  // ══ Bronnen: elk levert "inkomende" gegevens ({bron, naam, emails, …}); C.bereken legt ze op de lijst. ══
  // Alleen leesbare bronnen; niets hier schrijft naar Moneybird of SharePoint.
  const B = C.bronnen = {
    // Moneybird-contacten (bedrijf + contact_people). ctx: {type(mbId), klantCode(mbId), locatie(mbId)} (alles optioneel).
    uitMoneybird(lijst, ctx) {
      ctx = ctx || {}; const uit = [];
      lijstVan(lijst).forEach(m => {
        if (!m || m.id === undefined || m.id === null) return;
        const mbId = String(m.id), bedrijf = String(m.company_name || '').trim(), pers = [m.firstname, m.lastname].filter(Boolean).join(' ').trim();
        if (!bedrijf && !pers) return;
        const org = { type: (ctx.type && ctx.type(mbId)) || 'klant', klantCode: (ctx.klantCode && ctx.klantCode(mbId)) || undefined, mbContactId: mbId, naam: bedrijf || pers };
        const loc = ctx.locatie ? ctx.locatie(mbId) : null;
        const tels = [m.phone, m.mobile];
        const adres = [m.address1, [m.zipcode, m.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        const basis = { bron: 'moneybird', reden: 'Andere waarde in Moneybird', organisatie: org, locatie: loc ? Object.assign({}, loc, adres && !loc.adres ? { adres } : {}) : undefined };
        if (bedrijf && pers) uit.push(Object.assign({}, basis, { naam: pers, voornaam: m.firstname || '', emails: [m.email], telefoons: tels }));
        else if (m.email || m.phone || m.mobile) uit.push(Object.assign({}, basis, { naam: bedrijf || pers, algemeen: !!bedrijf, emails: [m.email], telefoons: tels }));
        lijstVan(m.contact_people).forEach(p => {
          if (!p) return; const naam = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
          if (!naam && !p.email) return;
          uit.push(Object.assign({}, basis, { naam, voornaam: p.firstname || '', functie: p.department || '', emails: [p.email], telefoons: [p.phone] }));
        });
      });
      return uit;
    },
    // Verrijkte registry (KLANTEN_VOL: naam, code, mb_contact_id, email, telefoon, plaats, soort) als vangnet
    // voor wat Moneybird niet (meer) levert. `skipMb` = Set van Moneybird-id's die al via uitMoneybird binnenkomen.
    uitRegistry(vol, ctx, skipMb) {
      ctx = ctx || {}; const uit = [];
      lijstVan(vol).forEach(v => {
        if (!v || !v.naam || (!v.email && !v.telefoon)) return;
        if (v.mb_contact_id && skipMb && skipMb.has(String(v.mb_contact_id))) return;
        const org = { type: v.soort === 'leverancier' ? 'leverancier' : 'klant', klantCode: v.code || undefined, mbContactId: v.mb_contact_id || undefined, naam: v.naam };
        uit.push({ bron: 'moneybird', reden: 'Andere waarde in de klantregistry', naam: v.naam, algemeen: true, emails: [v.email], telefoons: [v.telefoon], organisatie: org });
      });
      return uit;
    },
    // Projecten: klant_email / klant_telefoon / klant_naam / loc. ctx: {klantNaam(code)} (optioneel).
    uitProjecten(projecten, ctx) {
      ctx = ctx || {}; const uit = [];
      lijstVan(projecten).forEach(p => {
        if (!p || !p.code || p._vervallen || p.bron === 'app') return;
        if (!p.klant_email && !p.klant_telefoon) return;
        const klantNaam = String(p.klant_naam || (ctx.klantNaam && ctx.klantNaam(p.klant)) || '').trim();
        const kl = String(p.klant || '').toUpperCase();
        uit.push({ bron: 'project', reden: 'Andere waarde in project ' + p.code, naam: klantNaam, algemeen: true, emails: [p.klant_email], telefoons: [p.klant_telefoon],
          organisatie: { type: kl === 'INT' ? 'intern' : 'klant', klantCode: kl || undefined, mbContactId: p.mb_contact_id || undefined, naam: klantNaam },
          locatie: p.loc ? { code: p.loc, naam: (typeof root.projLocLabel === 'function' ? root.projLocLabel(p) : p.loc_naam) || '' } : undefined, projecten: [{ code: p.code }] });
      });
      return uit;
    },
    // "Achternaam, Voornaam" → "Voornaam Achternaam"; generieke afzenders (info, facturen…) geven ''.
    schoonNaam(naam, adres) {
      let n = String(naam || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (!n || n.includes('@')) return '';
      const lok = String(adres || '').split('@')[0].toLowerCase();
      if (n.toLowerCase() === lok || GENERIEK_RE.test(n)) return '';
      const d = n.split(',');
      if (d.length === 2 && !/\d/.test(n) && d.every(x => x.trim())) n = d[1].trim() + ' ' + d[0].trim();
      return n;
    },
    // Gekoppelde mails: mt_mail_links = {code:[{fromAddr, from, …, ontkoppeld?}]}. ctx: {domeinen: Map(domein → org)}.
    uitMails(links, ctx) {
      ctx = ctx || {}; const per = new Map();
      Object.keys(links || {}).forEach(code => {
        lijstVan(links[code]).forEach(x => {
          if (!x || x.ontkoppeld) return;
          const adres = C.normEmail(x.fromAddr); if (!adres) return;
          const dom = C.domein(adres);
          if (dom === EIGEN_DOMEIN || NOREPLY_RE.test(adres.split('@')[0])) return;
          const naam = B.schoonNaam(x.from, adres);
          let o = per.get(adres); if (!o) { o = { adres, naam: '', codes: new Set() }; per.set(adres, o); }
          if (naam && !o.naam) o.naam = naam;
          o.codes.add(code);
        });
      });
      const uit = [];
      per.forEach(o => {
        const dom = C.domein(o.adres), bekend = ctx.domeinen && ctx.domeinen.get(dom);
        const organisatie = bekend ? Object.assign({}, bekend)
          : (C.isFreemail(dom) ? { type: 'overig', naam: '' } : { type: 'overig', naam: dom });
        uit.push({ bron: 'mail', reden: 'Andere naam in gekoppelde mail', naam: o.naam, algemeen: !o.naam, emails: [o.adres], organisatie,
          projecten: [...o.codes].map(code => ({ code })) });
      });
      return uit;
    },

    // ── handtekening-herkenning (d): alleen VOORSTELLEN ──
    tekstUitBody(body, isHtml) {
      let t = String(body == null ? '' : body);
      if (isHtml) {
        const kop = t.search(/id=["'](divRplyFwdMsg|appendonsend)["']/i); if (kop > 0) t = t.slice(0, kop);      // Outlook: alles onder de reply-kop is citaat
        t = t.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<[^>]+>/g, '');
        t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
          .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCharCode(+n); } catch (e) { return ' '; } });
      }
      return t.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ');
    },
    FUNCTIE_RE: /\b(directeur|directie|eigenaar|medeeigenaar|manager|projectleider|projectmanager|uitvoerder|werkvoorbereider|calculator|inkoper|inkoop|architect|interieurarchitect|binnenhuisarchitect|ontwerper|adviseur|consultant|co[oö]rdinator|bedrijfsleider|vestigingsmanager|accountmanager|account manager|verkoper|verkoopadviseur|commercieel|bouwkundige|constructeur|planner|medewerker|assistent|assistente|secretaresse|administratie|monteur|teamleider|opzichter|toezichthouder|ceo|cfo|coo|owner|founder|partner|projectcoördinator)\b/i,
    TEL_RE: /(^|[^\d])((?:(?:\+|00)31[\s.-]*(?:\(0\))?[\s.-]*|0)[1-9](?:[\s.-]*\d){8})(?!\d)/g,
    // → {telefoons:[{nr,soort}], functie}. De handtekening = de regels na de groet, anders de laatste regels
    // van het nieuwe stuk (citaat/doorgestuurde tekst eronder blijft buiten beschouwing).
    handtekening(body, opts) {
      opts = opts || {};
      const tekst = B.tekstUitBody(body, !!opts.html);
      let regels = tekst.split('\n').map(r => r.trim());
      const stop = regels.findIndex((r, i) => i > 2 && (/^>/.test(r) || /^-{2,}\s*(oorspronkelijk|original|forwarded|doorgestuurd)/i.test(r) || /^(op .{6,80} schreef|on .{6,80} wrote)/i.test(r)
        || /^(van|from)\s*:\s*\S/i.test(r) || /^_{5,}$/.test(r)));
      if (stop > 0) regels = regels.slice(0, stop);
      regels = regels.filter(Boolean);
      const groet = regels.map((r, i) => /^((met )?(vriendelijke|hartelijke|vriendelijk|warme) groet|groet(en)?\b|mvg\b|kind regards|best regards|regards|hartelijk|met groet|cheers)/i.test(r) ? i : -1).filter(i => i >= 0).pop();
      const sig = (groet !== undefined ? regels.slice(groet + 1) : regels.slice(-8)).slice(0, 14);
      const res = { telefoons: [], functie: '' };
      const gezien = new Set();
      sig.forEach(r => {
        if (/^\s*(f|fax)\b\s*[:.]/i.test(r) || /\b(kvk|btw|iban|bic)\b/i.test(r)) return;
        let m; B.TEL_RE.lastIndex = 0;
        while ((m = B.TEL_RE.exec(r))) {
          const nr = m[2].replace(/\s+/g, ' ').trim(), k = C.normTel(nr); if (!k || gezien.has(k)) continue; gezien.add(k);
          const voor = r.slice(0, m.index + m[1].length).toLowerCase();
          if (/\b(f|fax)\s*[:.]?\s*$/.test(voor)) continue;                                  // "T: … | F: …" op één regel
          const soort = /\b(m|mob|mobiel|gsm|cell|mobile)\s*[:.]?\s*$/.test(voor) ? 'mobiel' : /\b(t|tel|telefoon|direct|kantoor)\s*[:.]?\s*$/.test(voor) ? 'vast' : C.soortTel(nr);
          res.telefoons.push({ nr, soort });
        }
      });
      // functie: regel met een functiewoord, kort, zonder cijfers/@/web; bij voorkeur vlak na de naamregel
      const naamK = C.normNaam(opts.naam || '');
      const naamIdx = naamK ? sig.findIndex(r => { const k = C.normNaam(r); return k && (k === naamK || k.includes(naamK) || naamK.includes(k) && k.split(' ').length >= 2); }) : -1;
      const kandidaat = r => r.length >= 3 && r.length <= 60 && !/[\d@]|https?:|www\./i.test(r) && B.FUNCTIE_RE.test(r);
      let f = naamIdx >= 0 ? sig.slice(naamIdx + 1, naamIdx + 4).find(kandidaat) : '';
      if (!f) f = sig.find(kandidaat) || '';
      res.functie = String(f || '').replace(/^[|,\-–•\s]+|[|,\-–•\s]+$/g, '').trim();
      return res;
    },
    // Voorstellen uit de handtekening van een gekoppelde mail voor het contact bij `fromAddr`. Maakt
    // alleen voorstellen (en eventueel een nieuw leeg contact via `maakAan`); wijzigt nooit bestaande velden.
    // → {contact, nieuwVoorstellen:[…], gevonden:{telefoons,functie}, bestaat}
    handtekeningVoorstellen(msg, opts) {
      opts = opts || {};
      const adres = C.normEmail(msg && msg.from && msg.from.emailAddress && msg.from.emailAddress.address || msg && msg.fromAddr);
      const uit = { adres, contact: null, nieuwVoorstellen: [], gevonden: { telefoons: [], functie: '' }, bestaat: false };
      if (!adres || C.domein(adres) === EIGEN_DOMEIN || NOREPLY_RE.test(adres.split('@')[0])) return uit;
      const naam = B.schoonNaam(msg.from && msg.from.emailAddress && msg.from.emailAddress.name, adres);
      const isHtml = !!(msg.body && /html/i.test(msg.body.contentType || ''));
      const g = B.handtekening((msg.body && msg.body.content) || msg.bodyPreview || '', { html: isHtml, naam });
      uit.gevonden = g; uit.naam = naam;
      let c = C.perEmail(adres); uit.bestaat = !!c;
      if (!c) { uit.contact = null; return uit; }
      uit.contact = c;
      const tijd = new Date(C.nu()).toISOString(), w = kopie(c), kand = [];
      const bied = (veld, waarde, reden) => {
        const k = C.voorstelSleutel({ veld, waarde });
        if (C.isGeweigerd(w, veld, waarde) || w.voorstellen.some(v => C.voorstelSleutel(v) === k)) return;
        kand.push({ veld, waarde, reden });
      };
      g.telefoons.forEach(t => { if (!w.telefoons.some(x => C.normTel(x.nr) === C.normTel(t.nr))) bied('telefoon', t, 'Telefoonnummer in de handtekening van een gekoppelde mail'); });
      if (g.functie && C.normNaam(g.functie) !== C.normNaam(w.functie)) bied('functie', g.functie, 'Functie in de handtekening van een gekoppelde mail');
      uit.kandidaten = kand;
      if (opts.droog || !kand.length) return uit;
      const nieuw = [];
      const lijst = C.lees(), i = lijst.findIndex(x => x.id === c.id), w2 = kopie(lijst[i]);
      kand.forEach(k => { const v = C.voegVoorstelToe(w2, k.veld, k.waarde, 'handtekening', k.reden, tijd); if (v) nieuw.push(v); });
      if (nieuw.length) {
        C.stempel(w2, lijst[i]); lijst[i] = w2; C.bewaar(lijst);
        C.journaal([{ actie: 'voorstel', contact: w2.id, aantal: nieuw.length, bron: 'handtekening' }]);
        uit.contact = w2;
      }
      uit.nieuwVoorstellen = nieuw;
      return uit;
    },

    // ── bij elkaar rapen in de browser (leest v2-globals, schrijft niets) ──
    domeinKaart() {
      const kaart = new Map();
      const zet = (adres, org) => { const d = C.domein(adres); if (d && !C.isFreemail(d) && !kaart.has(d)) kaart.set(d, C.schoonOrg(org)); };
      const vol = typeof KLANTEN_VOL !== 'undefined' ? KLANTEN_VOL : [], kl = typeof KLANTEN !== 'undefined' ? KLANTEN : [], pr = typeof PROJECT_CODES !== 'undefined' ? PROJECT_CODES : [];
      lijstVan(vol).forEach(k => { if (k && k.email) zet(k.email, { type: k.soort === 'leverancier' ? 'leverancier' : 'klant', klantCode: k.code, mbContactId: k.mb_contact_id, naam: k.naam }); });
      lijstVan(kl).forEach(k => { if (k && k.email) zet(k.email, { type: 'klant', klantCode: k.code, mbContactId: k.mb_contact_id, naam: k.naam }); });
      lijstVan(pr).forEach(p => { if (p && p.klant_email && p.klant) zet(p.klant_email, { type: 'klant', klantCode: p.klant, mbContactId: p.mb_contact_id, naam: p.klant_naam }); });
      return kaart;
    }
  };
  // ══════════════════════════════════════════════════════════════════════════
  // UI (MTContactenUI): klantpagina-sectie, projectkaart, zoeker, detail, droogloop, inbox-balk, mobiel.
  // Alle klikken lopen via één gedelegeerde handler (data-mtc="actie" data-id/data-code): geen
  // quoting-problemen in onclick-attributen, en alles wat uit data komt gaat door esc().
  // ══════════════════════════════════════════════════════════════════════════
  const doc = root.document;
  if (!doc) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const HERK = { hand: ['✋', 'Handmatig'], moneybird: ['🧾', 'Moneybird'], project: ['📁', 'Project'], mail: ['✉', 'Gekoppelde mail'], handtekening: ['✍', 'Handtekening'], ai: ['✨', 'AI'] };
  const NL_DATUM = t => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const jsCode = c => String(c || '').replace(/[^A-Za-z0-9_.\-]/g, '');

  const CSS = `
.mtc-kop{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.mtc-acties-kop{display:flex;gap:6px;flex-wrap:wrap}
.mtc-rij{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 2px;border-bottom:1px solid var(--border-hair,#e3e8e5)}
.mtc-rij:last-child{border-bottom:none}
.mtc-main{min-width:0;flex:1 1 220px}
.mtc-naam{font-size:14px;font-weight:600;color:var(--text,#1a1a1a)}
.mtc-link{background:none;border:none;padding:0;font:inherit;color:var(--green,#2A4A38);cursor:pointer;text-align:left;text-decoration:underline;text-decoration-color:transparent;min-height:24px}
.mtc-link:hover,.mtc-link:focus-visible{text-decoration-color:currentColor}
.mtc-functie{font-weight:400;font-size:12px;color:var(--text-dim,#666)}
.mtc-sub{font-size:12px;color:var(--text-dim,#666);margin-top:2px;display:flex;gap:4px 8px;flex-wrap:wrap;align-items:center}
.mtc-chip{font-family:var(--mono,monospace);font-size:11px;color:var(--green,#2A4A38);background:var(--green-light,#E6EFE9);border-radius:10px;padding:0 7px;text-decoration:none}
.mtc-acties{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.mtc-btn{display:inline-flex;align-items:center;gap:5px;min-height:36px;padding:0 10px;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--surface,#fafafa);color:var(--text,#1a1a1a);font-size:13px;text-decoration:none;cursor:pointer;font-family:inherit;max-width:100%}
.mtc-btn:hover,.mtc-btn:focus-visible{border-color:var(--green,#2A4A38);background:var(--green-light,#E6EFE9)}
.mtc-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.mtc-herk{display:inline-flex;gap:2px;font-size:12px;opacity:.85}
.mtc-voorstel{display:inline-block;font-size:11px;font-weight:600;color:#7A6010;background:#FBF5E0;border:1px solid #E5CF85;border-radius:10px;padding:0 7px;margin-left:6px;cursor:pointer}
.mtc-leeg{font-size:13px;color:var(--text-faint,#888);padding:6px 0}
.mtc-algemeen{font-size:11px;color:var(--text-faint,#888);margin-left:6px;font-weight:400}
.mtc-dubbel{font-size:12px;background:#FBF5E0;border:1px solid #E5CF85;border-radius:8px;padding:6px 10px;margin:8px 0}
.mtc-ov{position:fixed;inset:0;z-index:10040;background:rgba(20,30,24,.42);display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
.mtc-paneel{background:var(--surface-overlay,#fff);color:var(--text,#1a1a1a);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);width:100%;max-width:560px;padding:14px 16px 16px;font-size:13px}
.mtc-paneel h3{margin:0;font-size:16px;color:var(--green,#2A4A38)}
.mtc-kopregel{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.mtc-x{min-width:36px;min-height:36px;border:none;background:none;font-size:16px;cursor:pointer;color:var(--text-dim,#666)}
.mtc-veld{margin:8px 0}
.mtc-veld label{display:block;font-size:12px;font-weight:600;margin-bottom:2px}
.mtc-veld input,.mtc-veld textarea,.mtc-veld select{width:100%;box-sizing:border-box;padding:7px 9px;font:inherit;font-size:13px;border:1px solid var(--border,#ccc);border-radius:8px;background:var(--surface,#fafafa);color:inherit}
.mtc-veld textarea{min-height:54px;resize:vertical}
.mtc-rij2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mtc-hint{font-size:11px;color:var(--text-faint,#888);margin-top:2px}
.mtc-fout{color:var(--red,#b3261e);font-size:12px;min-height:16px;margin-top:6px}
.mtc-voet{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-top:12px}
.mtc-sectie{border-top:1px solid var(--border-hair,#e3e8e5);margin-top:12px;padding-top:8px}
.mtc-sectie h4{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-dim,#666)}
.mtc-vs{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--border-hair,#e3e8e5)}
.mtc-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:10060;background:#1a1a1a;color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;max-width:90vw}
.ov-blok[data-mtc-project]{margin-bottom:var(--space-3,12px)}
.mtc-hdrknop{background:none;border:1px solid transparent;border-radius:8px;min-width:36px;min-height:36px;font-size:16px;cursor:pointer;color:inherit}
.mtc-hdrknop:hover,.mtc-hdrknop:focus-visible{border-color:currentColor}
.mtc-inbox{font-size:12px;background:#F4F7F6;border:1px solid var(--border,#ccc);border-radius:8px;padding:6px 10px;margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mtc-mrij{padding:10px 0;border-bottom:1px solid var(--border,#e3e8e5)}
.mtc-mrij:last-child{border-bottom:none}
.mtc-mbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--border,#ccc);background:var(--surface,#fff);color:inherit;text-decoration:none;font-size:14px}
@media (pointer:coarse),(max-width:600px){.mtc-link{min-height:44px;display:inline-flex;align-items:center}.mtc-chip{min-height:32px;display:inline-flex;align-items:center;padding:0 10px}.mtc-voorstel{min-height:32px}.mtc-hdrknop,.mtc-x{min-width:44px;min-height:44px}}
@media(max-width:600px){.mtc-rij2{grid-template-columns:1fr}.mtc-ov{padding:0}.mtc-paneel{border-radius:0;max-width:none;min-height:100vh}.mtc-btn{min-height:40px}}
`;
  function stijl() {
    if (doc.getElementById('mtc-stijl')) return;
    const s = doc.createElement('style'); s.id = 'mtc-stijl'; s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }
  stijl();

  function toast(msg) {
    try {
      if (typeof root.planToast === 'function') return root.planToast(msg);
      if (typeof root.showToast === 'function') return root.showToast(msg);
    } catch (e) {}
    const t = doc.createElement('div'); t.className = 'mtc-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    doc.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  }

  // ── herkomst ──
  function herkIcoon(bron) {
    const h = HERK[bron] || ['•', bron];
    return '<span class="mtc-herk-i" role="img" aria-label="Bron: ' + esc(h[1]) + '" title="Bron: ' + esc(h[1]) + '">' + h[0] + '</span>';
  }
  function herkRij(c) {
    const b = C.alleBronnen(c); if (!b.length) return '';
    return '<span class="mtc-herk">' + b.map(herkIcoon).join('') + '</span>';
  }
  function herkTekst(c, veld) {
    const h = C.herk(c, veld); if (!h) return '';
    const hb = HERK[h.bron] || ['•', h.bron];
    const via = h.via ? ' — bevestigd, voorgesteld door ' + ((HERK[h.via] || ['', h.via])[1]).toLowerCase() : '';
    const ook = (h.ook && h.ook.length) ? ' + ' + h.ook.map(x => (HERK[x] || ['', x])[1]).join(', ') : '';
    const door = h.door ? ' · ' + String(h.door).split('@')[0] : '';
    return '<div class="mtc-hint">' + hb[0] + ' ' + esc(hb[1] + ook + via) + (h.tijd ? ' · ' + esc(NL_DATUM(h.tijd)) : '') + esc(door) + '</div>';
  }

  // ── rijen ──
  const adresVan = (c, opts) => (c.locatie && c.locatie.adres) || (opts && opts.adres) || '';
  function bel(c, groot) {
    const t = lijstVan(c.telefoons), max = groot ? 3 : 2;
    return t.slice(0, max).map(x => {
      const h = C.telHref(x.nr); if (!h) return '';
      return '<a class="' + (groot ? 'mtc-mbtn' : 'mtc-btn') + '" href="' + esc(h) + '" aria-label="Bel ' + esc(C.weergave(c)) + ' (' + esc(x.soort || 'telefoon') + '): ' + esc(x.nr) + '">📞 <span>' + esc(x.nr) + '</span></a>';
    }).join('') + (!groot && t.length > max ? '<button type="button" class="mtc-btn" data-mtc="detail" data-id="' + esc(c.id) + '" aria-label="Nog ' + (t.length - max) + ' telefoonnummers van ' + esc(C.weergave(c)) + '">+' + (t.length - max) + '</button>' : '');
  }
  function mail(c, groot) {
    const m = lijstVan(c.emails), max = groot ? 2 : 1;
    return m.slice(0, max).map(e => '<a class="' + (groot ? 'mtc-mbtn' : 'mtc-btn') + '" href="' + esc(C.mailHref(e)) + '" aria-label="Mail ' + esc(C.weergave(c)) + ': ' + esc(e) + '">✉ <span>' + esc(e) + '</span></a>').join('')
      + (!groot && m.length > max ? '<button type="button" class="mtc-btn" data-mtc="detail" data-id="' + esc(c.id) + '" aria-label="Nog ' + (m.length - max) + ' e-mailadressen van ' + esc(C.weergave(c)) + '">+' + (m.length - max) + '</button>' : '');
  }
  function route(c, opts, groot) {
    const a = adresVan(c, opts), h = C.routeHref(a); if (!h) return '';
    return '<a class="' + (groot ? 'mtc-mbtn' : 'mtc-btn') + '" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer" aria-label="Route naar ' + esc(a) + ' (opent kaarten in een nieuw tabblad)">📍 <span>Route</span></a>';
  }
  // Locatie zonder naam: zoek de naam bij de klant (v2: klantInfo); anders weglaten — nooit een kale code.
  function locatieNaam(c) {
    const l = c.locatie; if (!l) return '';
    const code = String(l.code || '').toUpperCase(), naam = String(l.naam || '').trim();
    if (naam && naam.toUpperCase() !== code) return naam;
    const kl = c.organisatie && c.organisatie.klantCode;
    if (code && kl && typeof root.klantInfo === 'function') {
      try { const x = (root.klantInfo(kl).locaties || []).find(y => y.code === code); const n = x && String(x.naam || '').trim(); if (n && n.toUpperCase() !== code) return n; } catch (e) {}
    }
    return '';
  }
  function orgRegel(c) {
    const o = c.organisatie || {};
    return [o.naam, locatieNaam(c)].filter(Boolean).map(esc).join(' · ');
  }
  // opts: {adres, projectChips, extra (html achter de acties)}
  function contactRij(c, opts) {
    opts = opts || {};
    const nv = lijstVan(c.voorstellen).length;
    const chips = opts.projectChips === false ? '' : lijstVan(c.projecten).slice(0, 4).map(p => {
      const href = (root.mtRoute && typeof root.mtRoute.format === 'function') ? root.mtRoute.format({ code: p.code }) : '#';
      return '<a class="mtc-chip" href="' + esc(href) + '" title="Project ' + esc(p.code) + (p.rol ? ' — ' + esc(p.rol) : '') + '">' + esc(p.code) + '</a>';
    }).join('') + (c.projecten && c.projecten.length > 4 ? '<span class="mtc-hint">+' + (c.projecten.length - 4) + '</span>' : '');
    return '<div class="mtc-rij" data-id="' + esc(c.id) + '"><div class="mtc-main">'
      + '<div class="mtc-naam"><button type="button" class="mtc-link" data-mtc="detail" data-id="' + esc(c.id) + '">' + esc(C.weergave(c)) + '</button>'
      + (c.functie ? ' <span class="mtc-functie">' + esc(c.functie) + '</span>' : '') + (c.algemeen ? '<span class="mtc-algemeen">algemeen adres</span>' : '')
      + (nv ? '<button type="button" class="mtc-voorstel" data-mtc="detail" data-id="' + esc(c.id) + '" title="Voorstellen bekijken">' + nv + ' voorstel' + (nv === 1 ? '' : 'len') + '</button>' : '') + '</div>'
      + '<div class="mtc-sub">' + orgRegel(c) + chips + ' ' + herkRij(c) + '</div></div>'
      + '<div class="mtc-acties">' + bel(c) + mail(c) + route(c, opts) + (opts.extra || '') + '</div></div>';
  }

  const UI = {};

  // ── klantpagina: pill "Contacten" ──  info = klantInfo(), projen = klantProjecten(), opts = {loc}
  UI.klantSectie = function (info, projen, opts) {
    opts = opts || {};
    const loc = opts.loc || '';
    const lijst = C.voorKlant(info.kl, { loc, mbIds: info.mbIds, projectCodes: (projen || []).map(p => p.code) });
    const adres = [info.adres, info.plaats].filter(Boolean).join(', ');
    const ids = new Set(lijst.map(c => c.id));
    const dub = C.dubbelen(lijst).filter(d => ids.has(d.a.id) && ids.has(d.b.id));
    const dubHtml = dub.length ? '<div class="mtc-dubbel" role="note">Mogelijk dubbel: ' + dub.slice(0, 3).map(d => '<button type="button" class="mtc-link" data-mtc="detail" data-id="' + esc(d.a.id) + '">' + esc(C.weergave(d.a)) + '</button> en ' + esc(C.weergave(d.b)) + ' (' + esc(d.reden) + ')').join('; ')
      + ' — open een van beide en kies “Samenvoegen met…”.</div>' : '';
    return '<div class="mtc-kop"><div class="card-title" style="margin:0">Contacten — ' + esc(info.naam) + (loc ? ' › ' + esc(loc) : '') + '</div>'
      + '<div class="mtc-acties-kop">'
      + '<button type="button" class="btn btn-secondary btn-sm" data-mtc="zoek">🔎 Zoeken</button>'
      + '<button type="button" class="btn btn-secondary btn-sm" data-recht="projecten:wijzigen" data-mtc="nieuw" data-klant="' + esc(info.kl) + '" data-loc="' + esc(loc) + '">+ Contact</button>'
      + '<button type="button" class="btn btn-secondary btn-sm" data-recht="projecten:wijzigen" data-mtc="bijwerken" title="Vult contacten aan uit Moneybird, projecten en gekoppelde mails — eerst een overzicht, pas na je akkoord opslaan">↻ Contacten bijwerken</button></div></div>'
      + dubHtml
      + (lijst.length ? lijst.map(c => contactRij(c, { adres })).join('')
        : '<div class="mtc-leeg">Nog geen contacten bij deze klant. Kies “Contacten bijwerken” om ze uit Moneybird, de projecten en gekoppelde mails te halen, of voeg er met “+ Contact” een toe.</div>');
  };

  // ── projectkaart (Overzicht) ──
  const projKlantCode = proj => String(proj.klant || String(proj.code || '').split('-')[0] || '').toUpperCase();
  function projectInner(proj) {
    const vp = C.voorProject(proj), code = proj.code, kb = root.MTKoppelUI ? root.MTKoppelUI.badge : () => '';
    const rij = (c, direct) => contactRij(c, { projectChips: false,
      extra: kb({ status: direct ? 'gekoppeld' : 'open', klein: true, label: (typeof projKort === 'function' ? projKort(code) : code), titel: direct ? 'Gekoppeld aan dit project — klik om te ontkoppelen' : 'Hoort bij de klant, nog niet aan dit project gekoppeld — klik om te koppelen',
        onclick: "MTContactenUI.projectPop(this,'" + jsCode(c.id) + "','" + jsCode(code) + "'," + (direct ? 'true' : 'false') + ')' }) });
    let html = '<div class="card-title mtc-kop" style="margin-bottom:6px"><span>Contactpersonen</span><span class="mtc-acties-kop">'
      + '<button type="button" class="btn btn-xs btn-secondary" data-recht="projecten:wijzigen" data-mtc="koppel-kies" data-code="' + esc(code) + '" title="Een bestaand contact aan dit project koppelen">+ Koppel</button>'
      + '<button type="button" class="btn btn-xs btn-secondary" data-recht="projecten:wijzigen" data-mtc="nieuw" data-code="' + esc(code) + '" data-klant="' + esc(projKlantCode(proj)) + '" data-loc="' + esc(proj.loc || '') + '">+ Nieuw</button></span></div>';
    if (vp.direct.length) html += vp.direct.map(c => rij(c, true)).join('');
    else if (vp.afgeleid.length) html += '<div class="mtc-hint" style="margin-bottom:4px">Nog niemand aan dit project gekoppeld — dit zijn de contacten van de klant' + (proj.loc ? '/locatie' : '') + ':</div>' + vp.afgeleid.slice(0, 5).map(c => rij(c, false)).join('');
    if (vp.direct.length && vp.afgeleid.length) html += '<div class="mtc-hint" style="margin-top:6px">Ook bij de klant: ' + vp.afgeleid.slice(0, 4).map(c => '<button type="button" class="mtc-link" data-mtc="koppel-vraag" data-id="' + esc(c.id) + '" data-code="' + esc(code) + '">' + esc(C.weergave(c)) + '</button>').join(', ') + (vp.afgeleid.length > 4 ? ' …' : '') + '</div>';
    if (!vp.direct.length && !vp.afgeleid.length) html += '<div class="mtc-leeg">Nog geen contactpersonen. Voeg er een toe of werk de contacten bij vanuit de klantpagina.</div>';
    return html;
  }
  UI.projectKaart = function (proj) {
    if (!proj || !proj.code) return '';
    let inner = ''; try { inner = projectInner(proj); } catch (e) { console.warn('contactenkaart:', e && e.message); inner = '<div class="mtc-leeg">Contacten konden niet laden.</div>'; }
    return '<section class="ov-blok" data-mtc-project="' + esc(proj.code) + '" data-mtc-klant="' + esc(proj.klant || '') + '" data-mtc-loc="' + esc(proj.loc || '') + '">' + inner + '</section>';
  };
  UI.projectPop = function (anker, id, code, isDirect) {
    const c = C.perId(id); if (!c || !root.MTKoppelUI) return;
    const naam = esc(C.weergave(c));
    const html = isDirect
      ? '<p style="margin:0 0 8px">' + naam + ' is gekoppeld aan <b>' + esc(code) + '</b>.</p><button type="button" class="btn btn-sm btn-secondary" data-recht="projecten:wijzigen" data-mtc="ontkoppel" data-id="' + esc(id) + '" data-code="' + esc(code) + '">Ontkoppelen</button> <button type="button" class="btn btn-sm btn-secondary" data-mtc="detail" data-id="' + esc(id) + '">Details</button>'
      : '<p style="margin:0 0 8px">' + naam + ' hoort bij de klant maar is nog niet aan <b>' + esc(code) + '</b> gekoppeld.</p><button type="button" class="btn btn-sm btn-gold" data-recht="projecten:wijzigen" data-mtc="koppel" data-id="' + esc(id) + '" data-code="' + esc(code) + '">Koppel aan ' + esc(code) + '</button> <button type="button" class="btn btn-sm btn-secondary" data-mtc="detail" data-id="' + esc(id) + '">Details</button>';
    root.MTKoppelUI.popover(anker, html, { titel: 'Contact ' + (isDirect ? 'ontkoppelen' : 'koppelen') });
  };

  // ── overlays (zoeker, detail) ──
  // Terwijl een overlay open staat is de rest van de pagina (en een lagere overlay) niet bereikbaar, ook niet voor schermlezers.
  function vergrendel() {
    const ovs = [...doc.querySelectorAll('.mtc-ov')];
    [...doc.body.children].forEach(el => {
      if (el.classList.contains('mtc-ov') || el.hasAttribute('data-mtc-inert') || /^(SCRIPT|STYLE)$/.test(el.tagName)) return;
      el.setAttribute('inert', ''); el.setAttribute('data-mtc-inert', '1');
    });
    ovs.forEach((o, i) => {
      if (i < ovs.length - 1) { o.setAttribute('inert', ''); o.setAttribute('data-mtc-inert', '1'); }
      else if (o.hasAttribute('data-mtc-inert')) { o.removeAttribute('inert'); o.removeAttribute('data-mtc-inert'); }
    });
  }
  function ontgrendel() {
    if (doc.querySelector('.mtc-ov')) return vergrendel();
    doc.querySelectorAll('[data-mtc-inert]').forEach(e => { e.removeAttribute('inert'); e.removeAttribute('data-mtc-inert'); });
  }
  function overlay(html, label) {
    const opener = doc.activeElement;
    const ov = doc.createElement('div'); ov.className = 'mtc-ov'; ov.setAttribute('data-mtc-ov', '1');
    ov.innerHTML = '<div class="mtc-paneel" role="dialog" aria-modal="true" aria-label="' + esc(label) + '" tabindex="-1">' + html + '</div>';
    doc.body.appendChild(ov);
    ov._opener = opener; vergrendel();
    ov.addEventListener('mousedown', e => { if (e.target === ov) sluitOv(ov); });
    ov.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); sluitOv(ov); return; }
      if (e.key !== 'Tab') return;
      const f = [...ov.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x => !x.hidden);
      if (!f.length) return;
      const eerste = f[0], laatste = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === eerste) { e.preventDefault(); laatste.focus(); }
      else if (!e.shiftKey && doc.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
    });
    const fok = ov.querySelector('input:not([type=hidden]),textarea,select') || ov.querySelector('button') || ov.firstElementChild;
    if (fok && fok.focus) fok.focus();
    return ov;
  }
  function sluitOv(ov) {
    if (!ov) return;
    const op = ov._opener; ov.remove(); ontgrendel();
    if (op && op.isConnected && op.focus) { try { op.focus(); } catch (e) {} }
  }
  const ovVan = el => el && el.closest ? el.closest('.mtc-ov') : null;
  async function vraag(o) {
    try { if (root.mtDialog && typeof root.mtDialog.confirm === 'function') return await root.mtDialog.confirm(o); } catch (e) {}
    return typeof root.confirm === 'function' ? root.confirm((o.title ? o.title + '\n\n' : '') + (o.message || '')) : false;
  }

  // ── zoeker ──  opts: {titel, kies(id), start()→[contact], prefill, klantContext}
  UI.zoek = function (opts) {
    opts = opts || {};
    const eerder = doc.querySelector('.mtc-ov[data-mtc-zoek]'), eerderOpener = eerder ? eerder._opener : null;
    if (eerder) { eerder.remove(); ontgrendel(); }
    const html = '<div class="mtc-kopregel"><h3>' + esc(opts.titel || 'Contact zoeken') + '</h3><button type="button" class="mtc-x" data-mtc="sluit" aria-label="Sluiten">✕</button></div>'
      + '<div class="mtc-veld"><label for="mtc-zoek-q">Naam, e-mail, telefoon of organisatie</label><input id="mtc-zoek-q" type="search" autocomplete="off"></div>'
      + '<div id="mtc-zoek-res" aria-live="polite"></div>'
      + '<div class="mtc-voet"><span></span><button type="button" class="btn btn-sm btn-secondary" data-recht="projecten:wijzigen" data-mtc="zoek-nieuw">+ Nieuw contact</button></div>';
    const ov = overlay(html, opts.titel || 'Contact zoeken');
    ov._kies = opts.kies || null; ov._prefill = opts.prefill || null; ov.setAttribute('data-mtc-zoek', '1');
    if (eerderOpener) ov._opener = eerderOpener;
    const inp = ov.querySelector('#mtc-zoek-q'), res = ov.querySelector('#mtc-zoek-res');
    const kiesKnop = c => ov._kies ? '<button type="button" class="mtc-btn" data-mtc="kies" data-id="' + esc(c.id) + '">Kies</button>' : '';
    const teken = () => {
      const q = inp.value.trim();
      const r = q ? C.zoek(q, { max: 30 }) : (opts.start ? opts.start().slice(0, 30) : []);
      res.innerHTML = r.length ? r.map(c => contactRij(c, { projectChips: !ov._kies, extra: kiesKnop(c) })).join('')
        : '<div class="mtc-leeg">' + (q ? 'Geen contact gevonden.' : 'Typ een naam, e-mailadres of telefoonnummer.') + '</div>';
    };
    inp.addEventListener('input', teken); teken();
    return ov;
  };
  UI.koppelKies = function (code) {
    const proj = (typeof PROJECT_CODES !== 'undefined' ? PROJECT_CODES : []).find(p => p && p.code === code) || { code };
    UI.zoek({ titel: 'Contact koppelen aan ' + code,
      start: () => { const vp = C.voorProject(proj); return vp.afgeleid; },
      kies: id => { const r = C.koppelProject(id, code); toast(r.ok ? 'Contact gekoppeld aan ' + code : (r.fout || 'Koppelen mislukt')); UI.ververs(); },
      prefill: prefillVoor({ code, klant: projKlantCode(proj), loc: proj.loc || '' }) });
  };

  // ── detail / bewerken ──
  function prefillVoor(ds) {
    const kl = String(ds.klant || '').toUpperCase(), loc = String(ds.loc || '').toUpperCase(), uit = { organisatie: { type: 'klant', klantCode: kl, naam: '' }, projecten: ds.code ? [{ code: ds.code }] : [] };
    try {
      if (kl && typeof klantInfo === 'function') {
        const info = klantInfo(kl, { loc });
        uit.organisatie.naam = info.naam || ''; if (info.mbHoofd) uit.organisatie.mbContactId = String(info.mbHoofd);
        const l = loc && (info.locaties || []).find(x => x.code === loc); if (l) uit.locatie = { code: l.code, naam: l.naam || '' };
      }
    } catch (e) {}
    return uit;
  }
  const FELDEN = [['naam', 'Naam'], ['voornaam', 'Voornaam'], ['functie', 'Functie'], ['emails', 'E-mailadressen'], ['telefoons', 'Telefoonnummers'], ['organisatie', 'Organisatie'], ['locatie', 'Locatie'], ['notities', 'Notities'], ['projecten', 'Projecten']];
  const VELDLABEL = { naam: 'Naam', voornaam: 'Voornaam', functie: 'Functie', notities: 'Notities', organisatie: 'Organisatie', locatie: 'Locatie', telefoon: 'Telefoon', email: 'E-mail' };
  function fmtWaarde(v) {
    const w = v.waarde;
    if (v.veld === 'telefoon') return (w && w.nr) || String(w);
    if (v.veld === 'organisatie') return [w.naam, w.klantCode && '(' + w.klantCode + ')'].filter(Boolean).join(' ');
    if (v.veld === 'locatie') return [w.naam, w.code && '(' + w.code + ')', w.adres].filter(Boolean).join(' ');
    return String(w == null ? '' : w);
  }
  function detailHtml(c, opts) {
    opts = opts || {};
    const nieuw = !c, d = c || C.nieuw(Object.assign({ naam: '' }, opts.prefill || {}), 'hand', '', '');
    const o = d.organisatie || {}, l = d.locatie || {};
    const H = v => nieuw ? '' : herkTekst(d, v);
    const rij = (lbl, id, val, extra) => '<div class="mtc-veld"><label for="mtc-f-' + id + '">' + lbl + '</label><input id="mtc-f-' + id + '" type="text" value="' + esc(val || '') + '"' + (extra || '') + '>' + '</div>';
    const projCodes = (typeof PROJECT_CODES !== 'undefined' ? PROJECT_CODES : []).filter(p => p && p.code && !p._vervallen).map(p => '<option value="' + esc(p.code) + '">').join('');
    let h = '<div class="mtc-kopregel"><h3>' + (nieuw ? 'Nieuw contact' : esc(C.weergave(d))) + '</h3><button type="button" class="mtc-x" data-mtc="sluit" aria-label="Sluiten">✕</button></div>';
    if (!nieuw && d.algemeen) h += '<div class="mtc-hint">Algemeen adres van de organisatie (geen persoon).</div>';
    if (!nieuw && lijstVan(d.voorstellen).length) {
      h += '<div class="mtc-sectie" style="margin-top:6px;border-top:none"><h4>Voorstellen (' + d.voorstellen.length + ')</h4>' + d.voorstellen.map(v => {
        const hb = HERK[v.bron] || ['•', v.bron], sl = C.voorstelSleutel(v);
        return '<div class="mtc-vs"><div>' + esc(VELDLABEL[v.veld] || v.veld) + ': <b>' + esc(fmtWaarde(v)) + '</b><div class="mtc-hint">' + hb[0] + ' ' + esc(hb[1]) + (v.reden ? ' — ' + esc(v.reden) : '') + '</div></div>'
          + '<div class="mtc-acties"><button type="button" class="btn btn-xs btn-gold" data-recht="projecten:wijzigen" data-mtc="vs-ja" data-id="' + esc(d.id) + '" data-sleutel="' + esc(sl) + '">Accepteren</button>'
          + '<button type="button" class="btn btn-xs btn-secondary" data-recht="projecten:wijzigen" data-mtc="vs-nee" data-id="' + esc(d.id) + '" data-sleutel="' + esc(sl) + '">Weigeren</button></div></div>';
      }).join('') + '</div>';
    }
    h += '<div class="mtc-rij2">' + rij('Naam', 'naam', d.naam) + rij('Voornaam', 'voornaam', d.voornaam) + '</div>' + H('naam') + H('voornaam')
      + rij('Functie', 'functie', d.functie) + H('functie')
      + '<div class="mtc-veld"><label for="mtc-f-emails">E-mailadressen (één per regel)</label><textarea id="mtc-f-emails">' + esc((d.emails || []).join('\n')) + '</textarea></div>' + H('emails')
      + '<div class="mtc-veld"><label for="mtc-f-telefoons">Telefoonnummers (één per regel)</label><textarea id="mtc-f-telefoons">' + esc((d.telefoons || []).map(t => t.nr).join('\n')) + '</textarea></div>' + H('telefoons')
      + '<div class="mtc-sectie"><h4>Organisatie</h4><div class="mtc-rij2"><div class="mtc-veld"><label for="mtc-f-orgtype">Soort</label><select id="mtc-f-orgtype">'
      + C.ORG_TYPES.map(t => '<option value="' + t + '"' + (o.type === t ? ' selected' : '') + '>' + { klant: 'Klant', leverancier: 'Leverancier', intern: 'Intern', overig: 'Overig' }[t] + '</option>').join('') + '</select></div>'
      + rij('Klantcode', 'orgcode', o.klantCode, ' maxlength="12"') + '</div>' + rij('Naam organisatie', 'orgnaam', o.naam) + H('organisatie')
      + '<h4 style="margin-top:8px">Locatie</h4><div class="mtc-rij2">' + rij('Code', 'loccode', l.code, ' maxlength="12"') + rij('Naam', 'locnaam', l.naam) + '</div>' + rij('Adres (voor “Route”)', 'locadres', l.adres) + H('locatie') + '</div>'
      + '<div class="mtc-veld"><label for="mtc-f-notities">Notities</label><textarea id="mtc-f-notities">' + esc(d.notities || '') + '</textarea></div>' + H('notities')
      + '<div class="mtc-sectie"><h4>Projecten</h4><div id="mtc-f-projecten">' + (lijstVan(d.projecten).length ? d.projecten.map(p =>
        '<span class="mtc-chip" style="display:inline-flex;gap:4px;align-items:center;margin:0 4px 4px 0">' + esc(p.code) + (p.rol ? ' · ' + esc(p.rol) : '')
        + (nieuw ? '' : ' <button type="button" class="mtc-x" style="min-width:22px;min-height:22px;font-size:12px" data-mtc="ontkoppel-p" data-id="' + esc(d.id) + '" data-code="' + esc(p.code) + '" aria-label="Ontkoppel ' + esc(p.code) + '">✕</button>') + '</span>').join('')
        : '<span class="mtc-hint">Niet aan een project gekoppeld.</span>') + '</div>' + H('projecten')
      + '<div class="mtc-rij2" style="margin-top:6px"><div class="mtc-veld" style="margin:0"><label for="mtc-f-projnieuw">Koppel project (code)</label><input id="mtc-f-projnieuw" list="mtc-projlijst" autocomplete="off"><datalist id="mtc-projlijst">' + projCodes + '</datalist></div>'
      + '<div class="mtc-veld" style="margin:0"><label for="mtc-f-projrol">Rol (optioneel)</label><input id="mtc-f-projrol" type="text"></div></div></div>'
      + '<div class="mtc-fout" id="mtc-fout" role="alert"></div>'
      + '<div class="mtc-voet"><div class="mtc-acties"><button type="button" class="btn btn-gold btn-sm" data-recht="projecten:wijzigen" data-mtc="opslaan" data-id="' + esc(nieuw ? '' : d.id) + '">' + (nieuw ? 'Aanmaken' : 'Opslaan') + '</button><button type="button" class="btn btn-secondary btn-sm" data-mtc="sluit">Annuleren</button></div>'
      + (nieuw ? '' : '<div class="mtc-acties"><button type="button" class="btn btn-secondary btn-sm" data-recht="projecten:wijzigen" data-mtc="samenvoegen" data-id="' + esc(d.id) + '" title="Een ander (dubbel) contact gaat op in dit contact">Samenvoegen met…</button>'
        + '<button type="button" class="btn btn-danger btn-sm" data-recht="projecten:wijzigen" data-mtc="verwijder" data-id="' + esc(d.id) + '">Verwijderen</button></div>') + '</div>';
    return h;
  }
  UI.detail = function (id, opts) {
    opts = opts || {};
    const c = id ? C.perId(id) : null;
    if (id && (!c || c._vervallen)) { toast('Dit contact bestaat niet meer'); return null; }
    const bestaand = doc.querySelector('.mtc-ov[data-mtc-detail="' + (id || 'nieuw') + '"]');
    if (bestaand) { bestaand.querySelector('.mtc-paneel').innerHTML = detailHtml(c, opts); bestaand._vorm0 = rawVelden(bestaand); return bestaand; }
    const ov = overlay(detailHtml(c, opts), c ? C.weergave(c) : 'Nieuw contact');
    ov.setAttribute('data-mtc-detail', id || 'nieuw'); ov._prefill = opts.prefill || null; ov._naNieuw = opts.naNieuw || null; ov._vorm0 = rawVelden(ov);
    return ov;
  };
  const FORM_IDS = ['naam', 'voornaam', 'functie', 'emails', 'telefoons', 'orgtype', 'orgcode', 'orgnaam', 'loccode', 'locnaam', 'locadres', 'notities'];
  function rawVelden(ov) { const o = {}; FORM_IDS.forEach(id => { const e = ov.querySelector('#mtc-f-' + id); o[id] = e ? e.value : ''; }); return o; }
  function leesFormulier(ov, c) {
    const v = id => { const e = ov.querySelector('#mtc-f-' + id); return e ? e.value : ''; };
    // bij een bestaand contact gaan alleen velden mee die de gebruiker zelf aanpaste (een sync tijdens het bewerken wordt zo niet overschreven)
    const gewijzigd = (...ids) => !c || !ov._vorm0 || ids.some(id => v(id) !== ov._vorm0[id]);
    const emails = v('emails').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
    const slecht = gewijzigd('emails') ? emails.find(x => !C.normEmail(x)) : null;
    if (slecht) return { fout: 'Geen geldig e-mailadres: ' + slecht };
    const bekend = new Map((c ? c.telefoons : []).map(t => [C.normTel(t.nr), t]));
    const tels = v('telefoons').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const slechtTel = gewijzigd('telefoons') ? tels.find(x => !C.normTel(x)) : null;
    if (slechtTel) return { fout: 'Geen geldig telefoonnummer: ' + slechtTel };
    const patch = {};
    if (gewijzigd('naam')) patch.naam = v('naam');
    if (gewijzigd('voornaam')) patch.voornaam = v('voornaam');
    if (gewijzigd('functie')) patch.functie = v('functie');
    if (gewijzigd('notities')) patch.notities = v('notities');
    if (gewijzigd('emails')) patch.emails = emails;
    if (gewijzigd('telefoons')) patch.telefoons = tels.map(x => bekend.get(C.normTel(x)) || { nr: x });
    if (gewijzigd('orgtype', 'orgcode', 'orgnaam')) {
      patch.organisatie = Object.assign({}, c ? c.organisatie : {}, { type: v('orgtype'), klantCode: v('orgcode').trim(), naam: v('orgnaam').trim() });
      if (!patch.organisatie.klantCode) delete patch.organisatie.klantCode;
    }
    if (gewijzigd('loccode', 'locnaam', 'locadres')) patch.locatie = { code: v('loccode').trim(), naam: v('locnaam').trim(), adres: v('locadres').trim() };
    return { patch, projNieuw: v('projnieuw').trim(), projRol: v('projrol').trim() };
  }
  function opslaanDetail(ov, id) {
    const c = id ? C.perId(id) : null, fout = ov.querySelector('#mtc-fout');
    const f = leesFormulier(ov, c); if (f.fout) { fout.textContent = f.fout; return; }
    let r;
    if (!c) {
      const pre = ov._prefill || {}, p = f.patch;
      r = C.maak(Object.assign({}, p, { projecten: [...(pre.projecten || []), ...(f.projNieuw ? [{ code: f.projNieuw, rol: f.projRol }] : [])],
        organisatie: Object.assign({}, pre.organisatie || {}, p.organisatie), locatie: p.locatie.code || p.locatie.naam || p.locatie.adres ? p.locatie : (pre.locatie || null) }));
    } else {
      r = Object.keys(f.patch).length ? C.bewerk(id, f.patch) : { ok: false, fout: 'Niets gewijzigd' };
      if (!r.ok && r.fout === 'Niets gewijzigd') r = { ok: true, contact: c, ongewijzigd: true };
      if (r.ok && f.projNieuw) { const k = C.koppelProject(id, f.projNieuw, f.projRol); if (!k.ok && k.fout !== 'Al gekoppeld') r = k; }
    }
    if (!r.ok) { fout.textContent = r.fout || 'Opslaan mislukt'; return; }
    sluitOv(ov); toast(r.ongewijzigd ? 'Geen wijzigingen' : (c ? 'Contact opgeslagen' : 'Contact aangemaakt')); UI.ververs();
    if (!c && ov._naNieuw) ov._naNieuw(r.contact);
  }

  // ── ververs alles wat contacten toont ──
  UI.ververs = function () {
    try {
      if (typeof _klantHuidig !== 'undefined' && _klantHuidig && typeof _klantSectieRender === 'function') {
        const el = doc.getElementById('klant-sectie-inhoud'); if (el && el.dataset.sectie === 'contacten') _klantSectieRender();
      }
    } catch (e) { console.warn('contacten verversen (klant):', e && e.message); }
    doc.querySelectorAll('[data-mtc-project]').forEach(el => {
      try { el.innerHTML = projectInner({ code: el.dataset.mtcProject, klant: el.dataset.mtcKlant, loc: el.dataset.mtcLoc }); } catch (e) {}
    });
    const z = doc.querySelector('#mtc-zoek-q'); if (z) z.dispatchEvent(new root.Event('input'));
    doc.querySelectorAll('.mtc-ov[data-mtc-detail]').forEach(ov => {
      const id = ov.getAttribute('data-mtc-detail'); if (id === 'nieuw') return;
      const c = C.perId(id);
      if (!c || c._vervallen) { sluitOv(ov); return; }
      ov.querySelector('.mtc-paneel').innerHTML = detailHtml(c, {}); ov._vorm0 = rawVelden(ov);
    });
    try { const nn = doc.getElementById('mtc-instel-status'); if (nn) nn.textContent = C.actieven().length + ' contacten'; } catch (e) {}
  };

  // ── Contacten bijwerken (droogloop eerst, dan pas opslaan) ──
  let bezig = false;
  function mbCtx() {
    const vol = typeof KLANTEN_VOL !== 'undefined' ? KLANTEN_VOL : [], klanten = typeof KLANTEN !== 'undefined' ? KLANTEN : [];
    return {
      type: id => { const v = vol.find(x => String(x.mb_contact_id || '') === id); return v && v.soort === 'leverancier' ? 'leverancier' : 'klant'; },
      klantCode: id => (typeof klantCodeVoorMb === 'function' ? klantCodeVoorMb(id) : null) || null,
      locatie: id => { for (const k of klanten) { const l = Array.isArray(k.locaties) && k.locaties.find(x => String(x.mb_contact_id || '') === id); if (l) return { code: l.code, naam: l.naam || '' }; } return null; }
    };
  }
  async function mbContactenLaden(info) {
    let cache = null;
    try { const c = JSON.parse(root.localStorage.getItem('mt_cache_klanten') || 'null'); if (c && Array.isArray(c.data)) cache = c; } catch (e) {}
    if (cache && Date.now() - cache.ts < 7 * 864e5) { info.mb = { bron: 'cache van ' + NL_DATUM(cache.ts), n: cache.data.length }; return cache.data; }
    if (typeof mbGet === 'function' && typeof getAdmin === 'function') {
      try {
        let pagina = 1; const alle = [];
        for (;;) {
          const r = await mbGet(getAdmin() + '/contacts?page=' + pagina + '&per_page=100');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const b = await r.json(); if (!Array.isArray(b) || !b.length) break;
          alle.push(...b); if (b.length < 100 || pagina >= 30) break; pagina++;
        }
        info.mb = { bron: 'zojuist opgehaald', n: alle.length }; return alle;
      } catch (e) { console.warn('Moneybird-contacten ophalen mislukt:', e.message); }
    }
    if (cache) { info.mb = { bron: 'oude cache van ' + NL_DATUM(cache.ts), n: cache.data.length }; return cache.data; }
    info.mb = { bron: 'niet beschikbaar', n: 0 }; return [];
  }
  async function verzamel() {
    const info = {}, ctx = mbCtx(), items = [];
    const mb = await mbContactenLaden(info);
    const inMb = new Set(mb.map(m => String(m.id)));
    const a = B.uitMoneybird(mb, ctx); items.push(...a);
    const reg = B.uitRegistry(typeof KLANTEN_VOL !== 'undefined' ? KLANTEN_VOL : [], ctx, inMb); items.push(...reg); info.registry = reg.length;
    const pr = B.uitProjecten(typeof PROJECT_CODES !== 'undefined' ? PROJECT_CODES : [], { klantNaam: code => typeof klantByCode === 'function' && (klantByCode(code) || {}).naam || '' }); items.push(...pr); info.projecten = pr.length;
    const ml = B.uitMails(root.MTKoppel ? root.MTKoppel.alle() : {}, { domeinen: B.domeinKaart() }); items.push(...ml); info.mails = ml.length;
    return { items, info };
  }
  function planHtml(plan, info) {
    const s = plan.samenvatting, L = [];
    L.push('<p style="margin:0 0 8px"><b>' + esc(plan.tekst) + '</b>' + (s.overgeslagen ? ' <span style="color:var(--text-dim)">(' + s.overgeslagen + ' eerder verwijderd, overgeslagen)</span>' : '') + '</p>');
    L.push('<ul style="margin:0 0 8px 18px;padding:0;font-size:12px;color:var(--text-dim)"><li>Moneybird: ' + info.mb.n + ' contacten (' + esc(info.mb.bron) + ')</li><li>Klantregistry: ' + (info.registry || 0)
      + '</li><li>Projecten: ' + (info.projecten || 0) + ' met klantgegevens</li><li>Gekoppelde mails: ' + (info.mails || 0) + ' afzenders</li></ul>');
    const vb = [];
    plan.nieuw.slice(0, 5).forEach(c => vb.push('Nieuw: ' + C.weergave(c) + (c.organisatie && c.organisatie.naam ? ' (' + c.organisatie.naam + ')' : '')));
    plan.aangevuld.slice(0, 4).forEach(g => vb.push('Aangevuld: ' + g.naam + ' — ' + g.velden.join(', ')));
    plan.voorstellen.slice(0, 4).forEach(v => vb.push('Voorstel: ' + v.naam + ' — ' + (VELDLABEL[v.veld] || v.veld).toLowerCase()));
    if (vb.length) L.push('<div style="font-size:12px">' + vb.map(x => '<div>' + esc(x) + '</div>').join('') + (s.nieuw + s.aangevuld + s.voorstellen > vb.length ? '<div style="color:var(--text-dim)">…</div>' : '') + '</div>');
    L.push('<p style="margin:8px 0 0;font-size:12px;color:var(--text-dim)">Er wordt niets overschreven: een afwijkende waarde komt als voorstel in het contact te staan. Pas na “Opslaan” wordt er iets bewaard.</p>');
    return L.join('');
  }
  UI.bijwerken = async function () {
    if (bezig) return; bezig = true;
    const knoppen = [...doc.querySelectorAll('[data-mtc="bijwerken"]')]; knoppen.forEach(k => { k.disabled = true; });
    const status = doc.getElementById('mtc-instel-status'); if (status) status.textContent = 'Gegevens verzamelen…';
    try {
      const { items, info } = await verzamel();
      const plan = C.bereken(C.lees(), items);
      const s = plan.samenvatting;
      if (!s.nieuw && !s.aangevuld && !s.voorstellen) {
        if (root.mtDialog && root.mtDialog.alert) await root.mtDialog.alert({ title: 'Contacten bijwerken', html: '<p>Alles is al bijgewerkt — er valt niets aan te vullen.</p><p style="font-size:12px;color:var(--text-dim)">Gelezen: Moneybird ' + info.mb.n + ' (' + esc(info.mb.bron) + '), ' + (info.projecten || 0) + ' projecten, ' + (info.mails || 0) + ' mail-afzenders.</p>' });
        else toast('Contacten zijn al bijgewerkt');
        return;
      }
      const ja = await vraag({ title: 'Contacten bijwerken — controleer eerst', html: planHtml(plan, info), message: plan.tekst, okLabel: 'Opslaan', cancelLabel: 'Annuleren' });
      if (!ja) { toast('Niets opgeslagen'); return; }
      // het register kan tijdens het wachten zijn gewijzigd: opnieuw rekenen op de verse lijst;
      // wijkt dat af van wat je zag, dan eerst nogmaals akkoord vragen
      let vers = C.bereken(C.lees(), items);
      if (vers.tekst !== plan.tekst) {
        const ja2 = await vraag({ title: 'Contacten bijwerken — intussen is er iets veranderd', html: planHtml(vers, info), message: vers.tekst, okLabel: 'Opslaan', cancelLabel: 'Annuleren' });
        if (!ja2) { toast('Niets opgeslagen'); return; }
        vers = C.bereken(C.lees(), items);
      }
      C.pasPlanToe(vers, 'bijwerken');
      toast('Contacten bijgewerkt: ' + vers.tekst); UI.ververs();
    } catch (e) {
      console.warn('contacten bijwerken mislukt:', e && e.message); toast('Contacten bijwerken mislukte: ' + (e && e.message || e));
    } finally {
      bezig = false; knoppen.forEach(k => { k.disabled = false; }); if (status) status.textContent = C.actieven().length + ' contacten';
    }
  };

  // ── inbox: handtekening-voorstellen bij een gekoppelde mail (leesvenster) ──
  let laatsteMail = null;
  UI.inboxHandtekening = function (m, host) {
    host = host || doc.getElementById('inbox-contactwrap'); if (!host) return;
    host.innerHTML = ''; laatsteMail = null;
    if (!m || !root.MTKoppel || !root.MTKoppel.mailProjecten(m).length) return;
    let r; try { r = B.handtekeningVoorstellen(m, { droog: true }); } catch (e) { console.warn('handtekening-herkenning:', e && e.message); return; }
    if (!r.adres) return;
    if (r.bestaat) {
      const kand = r.kandidaten || [];
      if (!kand.length) return;
      laatsteMail = m;
      const velden = Array.from(new Set(kand.map(v => (VELDLABEL[v.veld] || v.veld).toLowerCase())));
      host.innerHTML = '<div class="mtc-inbox" role="status">📇 <span><b>' + esc(C.weergave(r.contact)) + '</b>: ' + (kand.length === 1 ? '1 nieuw gegeven' : kand.length + ' nieuwe gegevens') + ' in de handtekening (' + esc(velden.join(', ')) + ')</span>'
        + '<button type="button" class="btn btn-xs btn-secondary" data-recht="projecten:wijzigen" data-mtc="hs-bewaar" title="Bewaart ze als voorstel bij het contact; er wordt niets overschreven">Als voorstel bewaren</button></div>';
      return;
    }
    laatsteMail = m;
    const g = r.gevonden, delen = [r.naam || r.adres].concat(g.telefoons.map(t => t.nr), g.functie ? [g.functie] : []);
    host.innerHTML = '<div class="mtc-inbox" role="status">📇 <span>Nieuw contact? <b>' + esc(delen[0]) + '</b>' + (delen.length > 1 ? ' — ' + esc(delen.slice(1).join(' · ')) : '') + '</span>'
      + '<button type="button" class="btn btn-xs btn-secondary" data-recht="projecten:wijzigen" data-mtc="mail-contact" title="Maakt het contact aan bij de projecten van deze mail; telefoon en functie uit de handtekening komen als voorstel">Contact aanmaken</button></div>';
  };
  function maakUitMail(m) {
    const K = root.MTKoppel, adres = C.normEmail(m.from && m.from.emailAddress && m.from.emailAddress.address || m.fromAddr);
    if (!K || !adres) return false;
    const rec = { fromAddr: adres, from: m.from && m.from.emailAddress && m.from.emailAddress.name || '' };
    const links = {}; K.mailProjecten(m).forEach(code => { links[code] = [rec]; });
    const plan = C.bereken(C.lees(), B.uitMails(links, { domeinen: B.domeinKaart() }));
    C.pasPlanToe(plan, 'mail');
    B.handtekeningVoorstellen(m);
    return true;
  }

  // ── mobiel (alleen lezen: bellen/mailen bij het project) ──
  async function mobielLijst() {
    let lijst = [];
    try { const c = JSON.parse(root.localStorage.getItem('mt_contacten_mobiel') || 'null'); if (c && Array.isArray(c.data) && Date.now() - (c.ts || 0) < 14 * 864e5) lijst = c.data; } catch (e) {}
    try {
      const ingelogd = typeof _SP !== 'undefined' && typeof _msAccount !== 'undefined' && _msAccount && !(typeof _demoMode !== 'undefined' && _demoMode);
      if (ingelogd) {
        const d = await _SP.read('mt_contacten.json');
        if (Array.isArray(d)) {
          // alleen wat de project-sheet nodig heeft (geen notities, herkomst of voorstellen); verlopen na 14 dagen
          lijst = d.filter(c => c && c.id && !c._vervallen).map(c => ({ id: c.id, naam: c.naam, functie: c.functie, emails: c.emails, telefoons: c.telefoons, organisatie: c.organisatie, locatie: c.locatie, projecten: c.projecten, algemeen: c.algemeen }));
          try { root.localStorage.setItem('mt_contacten_mobiel', JSON.stringify({ ts: Date.now(), data: lijst })); } catch (e) {}
        }
      }
    } catch (e) { console.warn('contacten laden (mobiel):', e && e.message); }
    return lijst;
  }
  function mobielRij(c, adres) {
    const sub = [c.functie, c.organisatie && c.organisatie.naam].filter(Boolean).map(esc).join(' · ');
    return '<div class="mtc-mrij"><div style="font-size:15px;font-weight:600">' + esc(C.weergave(c)) + '</div>' + (sub ? '<div style="font-size:12px;color:var(--text-dim)">' + sub + '</div>' : '')
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' + bel(c, true) + mail(c, true) + route(c, { adres }, true) + '</div></div>';
  }
  UI.mobielWis = function () { try { root.localStorage.removeItem('mt_contacten_mobiel'); } catch (e) {} };
  UI.mobielSheet = async function (p, host, adres) {
    if (!host || !p || !p.code) return;
    host.dataset.mtcProj = p.code; host.innerHTML = '<div class="mtc-leeg">Contactpersonen laden…</div>';
    const lijst = await mobielLijst();
    if (host.dataset.mtcProj !== p.code) return;                         // intussen een ander project geopend
    const vp = C.voorProject({ code: p.code }, { lijst });
    const toon = vp.direct.length ? vp.direct : vp.afgeleid.slice(0, 4);
    host.innerHTML = toon.length
      ? (vp.direct.length ? '' : '<div class="mtc-hint" style="margin-bottom:4px">Contacten van de klant:</div>') + toon.map(c => mobielRij(c, adres)).join('')
      : '<div class="mtc-leeg">Nog geen contactpersonen bekend.</div>';
  };

  // ── gedelegeerde klikken ──
  UI.sluitAlles = function () { doc.querySelectorAll('.mtc-ov').forEach(o => o.remove()); ontgrendel(); };
  const SCHRIJF = new Set(['nieuw', 'zoek-nieuw', 'bijwerken', 'koppel-kies', 'kies', 'koppel', 'ontkoppel', 'ontkoppel-p', 'opslaan', 'vs-ja', 'vs-nee', 'samenvoegen', 'verwijder', 'mail-contact', 'hs-bewaar']);
  function klik(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-mtc]') : null; if (!el) return;
    const a = el.dataset.mtc, id = el.dataset.id, code = el.dataset.code, ov = ovVan(el);
    if (SCHRIJF.has(a) && root.MTRol && typeof root.MTRol.mag === 'function' && !root.MTRol.mag('projecten:wijzigen')) { toast('Je hebt geen rechten om contacten te wijzigen'); e.preventDefault(); return; }
    const klaarPop = () => { if (root.MTKoppelUI && root.MTKoppelUI.sluit) root.MTKoppelUI.sluit(); };
    switch (a) {
      case 'detail': klaarPop(); UI.detail(id); break;
      case 'zoek': UI.zoek(); break;
      case 'sluit': sluitOv(ov); break;
      case 'nieuw': UI.detail(null, { prefill: prefillVoor({ klant: el.dataset.klant, loc: el.dataset.loc, code }) }); break;
      case 'zoek-nieuw': { const pre = ov && ov._prefill; sluitOv(ov); UI.detail(null, { prefill: pre || null }); break; }
      case 'bijwerken': UI.bijwerken(); break;
      case 'koppel-kies': UI.koppelKies(code); break;
      case 'koppel-vraag': UI.projectPop(el, id, code, false); break;
      case 'kies': { const f = ov && ov._kies; if (f) { sluitOv(ov); f(id); } break; }
      case 'koppel': { klaarPop(); const r = C.koppelProject(id, code); toast(r.ok ? 'Gekoppeld aan ' + code : (r.fout || 'Koppelen mislukt')); UI.ververs(); break; }
      case 'ontkoppel': { klaarPop(); const r = C.ontkoppelProject(id, code); toast(r.ok ? 'Ontkoppeld van ' + code : (r.fout || 'Ontkoppelen mislukt')); UI.ververs(); break; }
      case 'ontkoppel-p': { const r = C.ontkoppelProject(id, code); toast(r.ok ? 'Ontkoppeld van ' + code : (r.fout || 'Ontkoppelen mislukt')); UI.ververs(); break; }
      case 'opslaan': opslaanDetail(ov, id || null); break;
      case 'vs-ja': case 'vs-nee': { const r = C.beslis(id, el.dataset.sleutel, a === 'vs-ja'); toast(r.ok ? (a === 'vs-ja' ? 'Voorstel overgenomen' : 'Voorstel geweigerd — komt niet terug') : (r.fout || 'Mislukt')); UI.ververs(); break; }
      case 'samenvoegen': {
        const doel = C.perId(id); if (!doel) break;
        const kand = new Map(); C.dubbelen().forEach(d => { if (d.a.id === id) kand.set(d.b.id, d.b); if (d.b.id === id) kand.set(d.a.id, d.a); });
        UI.zoek({ titel: 'Samenvoegen in ' + C.weergave(doel), start: () => [...kand.values()],
          kies: async oid => {
            const bron = C.perId(oid); if (!bron || oid === id) return;
            const ja = await vraag({ title: 'Samenvoegen', message: C.weergave(bron) + ' gaat op in ' + C.weergave(doel) + '.\nE-mailadressen, telefoonnummers en projecten worden verenigd; een afwijkende naam of functie komt als voorstel in ' + C.weergave(doel) + '. Het samengevoegde contact blijft als verwijderd bewaard.', okLabel: 'Samenvoegen' });
            if (!ja) return;
            const r = C.voegSamen(id, oid); toast(r.ok ? 'Contacten samengevoegd' : (r.fout || 'Samenvoegen mislukt')); UI.ververs();
          } });
        break;
      }
      case 'verwijder': (async () => {
        const c = C.perId(id); if (!c) return;
        const ja = await vraag({ title: 'Contact verwijderen', message: C.weergave(c) + ' verwijderen? Het contact blijft als verwijderd bewaard en wordt niet automatisch opnieuw aangemaakt.', okLabel: 'Verwijderen', danger: true });
        if (!ja) return;
        const r = C.verwijder(id); if (r.ok) { sluitOv(ovVan(el)); toast('Contact verwijderd'); UI.ververs(); } else toast(r.fout || 'Verwijderen mislukt');
      })(); break;
      case 'hs-bewaar': {
        if (!laatsteMail) break;
        const r = B.handtekeningVoorstellen(laatsteMail);
        const host = doc.getElementById('inbox-contactwrap');
        if (host) host.innerHTML = r.contact ? '<div class="mtc-inbox" role="status">📇 <span>' + r.nieuwVoorstellen.length + ' voorstel' + (r.nieuwVoorstellen.length === 1 ? '' : 'len') + ' bewaard bij <b>' + esc(C.weergave(r.contact)) + '</b></span><button type="button" class="btn btn-xs btn-secondary" data-mtc="detail" data-id="' + esc(r.contact.id) + '">Bekijken</button></div>' : '';
        toast('Voorstellen bewaard'); UI.ververs(); break;
      }
      case 'mail-contact': if (laatsteMail && maakUitMail(laatsteMail)) { toast('Contact aangemaakt'); UI.inboxHandtekening(laatsteMail); UI.ververs(); } break;
      default: return;
    }
    e.preventDefault();
  }
  if (!root.__mtcKlik) { root.__mtcKlik = true; doc.addEventListener('click', klik); }

  UI.zoekOpen = () => UI.zoek();
  UI._intern = { contactRij, detailHtml, planHtml, mobielRij, projectInner, maakUitMail, leesFormulier };
  root.MTContactenUI = UI;

})(typeof window !== 'undefined' ? window : null);
