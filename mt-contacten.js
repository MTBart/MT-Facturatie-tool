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
    // Naam voor het journaal: nooit een e-mailadres of nummer.
    journaalNaam(c) { return (c && (c.naam || (c.organisatie && c.organisatie.naam))) || '(zonder naam)'; },
    weergave(c) { return (c && (c.naam || (c.emails && c.emails[0]) || (c.organisatie && c.organisatie.naam))) || '(zonder naam)'; },

    // ── opslag ──
    lees() {
      const v = leesJson(C.opslag.lees(KEY));
      return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.id) : [];
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
      } catch (e) { console.warn('contacten-journaal schrijven mislukt:', e); return false; }
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
        // Een plaatshouder-naam van een algemeen adres mag door een echte persoonsnaam vervangen worden.
        if (f === 'naam' && c.algemeen && !ink.algemeen && !C.isHand(c, 'naam')) { c.naam = nieuw; delete c.algemeen; C.zetHerkomst(c, 'naam', bron, tijd, door); gevuld('naam'); return; }
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
        if (o.type === 'overig' && io.type && io.type !== 'overig' && !C.isHand(c, 'organisatie')) { o.type = io.type; veranderd = true; }
        if (veranderd) { if (!C.herk(c, 'organisatie')) C.zetHerkomst(c, 'organisatie', bron, tijd, door); gevuld('organisatie'); }
        const afwijkt = (o.naam && io.naam && C.normOrg(o.naam) !== C.normOrg(io.naam) && !C.zelfdeOrg(o, io))
          || (o.klantCode && io.klantCode && o.klantCode !== io.klantCode)
          || (o.mbContactId && io.mbContactId && String(o.mbContactId) !== String(io.mbContactId));
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
      const jn = id => C.journaalNaam(plan.lijst.find(c => c.id === id));
      plan.aangevuld.forEach(g => regels.push({ actie: 'aanvullen', contact: g.id, naam: jn(g.id), velden: g.velden, bron: bronLabel || '' }));
      plan.metVoorstel.forEach(g => regels.push({ actie: 'voorstel', contact: g.id, naam: jn(g.id), aantal: g.voorstellen, bron: bronLabel || '' }));
      C.journaal(regels);
      return true;
    },

    // ── samenvoegen tussen pc's (de _SP-merger) ──
    // Per contact wint de nieuwste stempel (gelijk → deterministisch op inhoud; beide ongestempeld → SharePoint).
    // Daarbovenop: een veld met bron 'hand' wordt niet door een automatisch veld van de winnaar overschreven,
    // lijsten groeien (vereniging), voorstellen/geweigerd worden verenigd. Tombstones winnen als ze nieuwer zijn.
    samenContact(l, r) {
      const tl = tijdVan(l), tr = tijdVan(r);
      let win, verl;
      if (tl > tr) { win = l; verl = r; }
      else if (tr > tl) { win = r; verl = l; }
      else if (!tl) { win = r; verl = l; }                              // beide ongestempeld → SharePoint
      else { win = JSON.stringify(l) >= JSON.stringify(r) ? l : r; verl = win === l ? r : l; }
      if (win._vervallen) return kopie(win);
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
      // lijsten
      const sl = { emails: e => e, telefoons: t => C.normTel(t.nr), projecten: p => p.code };
      LIJSTEN.forEach(f => {
        const wh = uit.herkomst[f], lh = vh[f], wL = lijstVan(win[f]), lL = lijstVan(verl[f]);
        let lijst;
        if (wh && wh.bron === 'hand') lijst = wL;
        else if (lh && lh.bron === 'hand') lijst = [...lL, ...wL];
        else lijst = [...wL, ...lL];
        const gezien = new Set(), res = [];
        lijst.forEach(x => { const k = sl[f](x); if (k && !gezien.has(k)) { gezien.add(k); res.push(kopie(x)); } });
        uit[f] = res;
        if (!wh && lh) uit.herkomst[f] = kopie(lh);
        else if (wh && lh && lh.bron === 'hand' && wh.bron !== 'hand') uit.herkomst[f] = kopie(lh);
      });
      // geweigerd: vereniging; voorstellen: vereniging minus geweigerd en minus wat inmiddels in het contact staat
      const geweigerd = new Map();
      [...lijstVan(win.geweigerd), ...lijstVan(verl.geweigerd)].forEach(g => { if (g) geweigerd.set(C.voorstelSleutel(g), g); });
      uit.geweigerd = [...geweigerd.values()];
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
      C.journaal([Object.assign({ actie, contact: id, naam: C.journaalNaam(c), bron: 'hand' }, extra || {}, r && r.journaal || {})]);
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
      C.journaal([{ actie: 'aanmaak', contact: c.id, naam: C.journaalNaam(c), bron: 'hand' }]);
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
      return C._wijzig(id, c => {
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
      const dv = lijst[di], bv = lijst[bi], d = kopie(dv), b = kopie(bv), tijd = new Date(C.nu()).toISOString(), door = C.wie();
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
      C.journaal([{ actie: 'samenvoegen', contact: doelId, samengevoegd: bronId, naam: C.journaalNaam(d), bron: 'hand' }]);
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
          locatie: p.loc ? { code: p.loc, naam: p.loc_naam || '' } : undefined, projecten: [{ code: p.code }] });
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
        t = t.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n').replace(/<[^>]+>/g, '');
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
      if (opts.droog) return uit;
      const tijd = new Date(C.nu()).toISOString(), lijst = C.lees(), i = lijst.findIndex(x => x.id === c.id), w = kopie(lijst[i]);
      const nieuw = [];
      g.telefoons.forEach(t => {
        if (w.telefoons.some(x => C.normTel(x.nr) === C.normTel(t.nr))) return;
        const v = C.voegVoorstelToe(w, 'telefoon', t, 'handtekening', 'Telefoonnummer in de handtekening van een gekoppelde mail', tijd); if (v) nieuw.push(v);
      });
      if (g.functie && C.normNaam(g.functie) !== C.normNaam(w.functie)) {
        const v = C.voegVoorstelToe(w, 'functie', g.functie, 'handtekening', 'Functie in de handtekening van een gekoppelde mail', tijd); if (v) nieuw.push(v);
      }
      if (nieuw.length) {
        C.stempel(w, lijst[i]); lijst[i] = w; C.bewaar(lijst);
        C.journaal([{ actie: 'voorstel', contact: w.id, naam: C.journaalNaam(w), aantal: nieuw.length, bron: 'handtekening' }]);
        uit.contact = w;
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
  //__UI__
})(typeof window !== 'undefined' ? window : null);
