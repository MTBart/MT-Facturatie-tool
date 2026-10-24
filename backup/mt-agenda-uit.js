/* ============================================================================
 * mt-agenda-uit.js: het fundament om tijden uit de tool in Outlook te zetten (brok D0). NOG NIET IN GEBRUIK: de vlag staat uit en er is niets aan gekoppeld.
 * ----------------------------------------------------------------------------
 * Wat dit regelt (Codex-punten uit keuzeplan D, 3, 4, 5, 6, 9):
 *  - een ECHTE uitgaande wachtrij (outbox) met een vast id per opdracht: twee apparaten die dezelfde opdracht maken, maken één record (idempotent samenvoegen),
 *    en een afspraak wordt nooit blind opnieuw aangemaakt: bij twijfel (time-out, onbekende uitkomst) alleen terugzoeken op de tool-markering;
 *  - één opdracht tegelijk per agenda (een claim met een korte looptijd, na het schrijven teruggelezen);
 *  - elke afspraak draagt de tool-markering (extended property mtId = planblok:<id>, en mtOp = het opdracht-id) en een transactionId = het opdracht-id;
 *  - na elke schrijfactie een terugleescontrole; wijkt de stand in Outlook af dan een CONFLICT (nooit opnieuw overschrijven);
 *  - een opdracht voor een collega wordt een voorstel dat die collega zelf bevestigt ("wacht-bevestiging"); nooit automatisch uitgevoerd, en alleen de eigenaar voert uit, in zijn eigen agenda (/me);
 *  - controles vóór uitvoeren: eigenaar, bestaand bron-blok, duur (hoogstens 10 uur), datumvenster (hoogstens ~6 maanden vooruit), unieke en kloppende operatie-id.
 * Alles komt van buiten via init(deps) en parameters: { sp: { read, write } (zoals P.blokSchrijf), graph(url, opties) -> json (gooit een fout met .status), vlag(), nu(), team(), ik(), apparaat, blok(id) }.
 * Zonder vlag (standaard) doet verwerk() niets: geen lezen, geen schrijven, geen aanroep naar Microsoft. Rekenwerk (ids, controle, samenvoegen, kandidaten) is zonder netwerk te testen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const U = {};
  let D = null;
  U.BESTAND = 'mt_agenda_outbox.json';
  U.TZ = 'W. Europe Standard Time';
  const GUID = '3f6c1b0e-7a52-4d19-9c8e-5b2a4e60d731';   // vaste naamruimte voor de markering van de tool (een eigen, onzichtbare eigenschap op de afspraak)
  U.PROP_MT = 'String {' + GUID + '} Name mtId';
  U.PROP_OP = 'String {' + GUID + '} Name mtOp';
  U.MAX_DUUR_MIN = 600; U.MAX_VOORUIT_DAGEN = 183; U.MAX_TERUG_DAGEN = 1; U.CLAIM_MS = 5 * 60 * 1000; U.GRAPH_MS = 30 * 1000; U.CLAIM_MARGE_MS = 40 * 1000; U.MAX_ZOEK = 3; U.LIGT_LANG_MS = 3 * 24 * 3600 * 1000;
  // "Vandaag" in de tijdzone van de agenda (Amsterdam), niet in UTC: vlak na middernacht klopt de datumgrens dan met Outlook
  const AMS = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch (e) { return null; } })();
  U.vandaagAms = nu => { try { if (AMS) { const p = {}; AMS.formatToParts(new Date(nu)).forEach(x => { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; } } catch (e) { /* terugval */ } return new Date(nu).toISOString().slice(0, 10); };
  // De stand loopt alleen omhoog (zo kan samenvoegen nooit een stap terugzetten). Wie bezig is staat NIET in de stand maar in `claim` (een korte reservering op één apparaat).
  // Eindstanden onderling: wat echt in Outlook staat (gelinkt, verwijderd) wint van "mislukt" of een besluit vooraf, en een conflict wint van beide (de gebruiker moet het zien). Zo kan een late of verlopen uitvoerder
  // een bewezen koppeling niet stil vervangen door iets anders, en niet andersom.
  const RANG = { 'wacht-bevestiging': 1, bevestigd: 2, onzeker: 3, afgewezen: 5, ingetrokken: 5, mislukt: 5, linked: 6, verwijderd: 6, conflict: 7 };
  U.STATUSSEN = Object.keys(RANG); U.eindstand = s => RANG[s] >= 5;
  const SOORTEN = ['create', 'update', 'delete'];

  // ── hulpjes ──
  const kopie = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const nr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymd = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && ymd(nr(s)) === s;
  const tijdMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s == null ? '' : s).trim().toLowerCase();
  const cyrb53 = (str, seed = 0) => { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return 4294967296 * (2097151 & h2) + (h1 >>> 0); };
  const teamLid = (team, s) => (team || []).find(t => t && slug(t.slug) === slug(s)) || null;

  // ── de opdracht-id: vast voor dezelfde opdracht, op elk apparaat gelijk ──
  // create en delete: één per blok en eigenaar (dus nooit twee afspraken voor hetzelfde blok in dezelfde agenda); update: per versie van het blok.
  U.opId = function (soort, bronType, bronId, eigenaar, versie) {
    const delen = [soort, bronType, String(bronId), slug(eigenaar)]; if (soort === 'update') delen.push(String(versie || ''));
    return 'ag_' + String(soort).charAt(0) + '_' + cyrb53(delen.join('|')).toString(36);
  };
  // De versie van een blok voor een update: alles wat in de afspraak komt. Dezelfde inhoud = dezelfde versie = hetzelfde opdracht-id.
  U.blokVersie = b => cyrb53(JSON.stringify([b && b.datum, b && b.start, b && b.duurMin, b && b.persoon, b && b.taak, b && b.project_code, b && b.notitie])).toString(36);

  // ── de inhoud van de afspraak ──
  // extra: { onderwerp?, plaats?, tekst? (gewone regels, wordt veilig HTML), herinnering? (minuten voor het begin of null) }
  U.payloadVoor = function (blok, extra) {
    extra = extra || {};
    const s = tijdMin(blok && blok.start), dm = Math.round(Number(blok && blok.duurMin));
    if (!blok || !isYmd(blok.datum) || s === null || !(dm > 0)) return null;
    const e = s + dm; if (e > 24 * 60) return null;   // niet over middernacht (dat wordt een eigen opdracht)
    const regels = String(extra.tekst || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const onderwerp = String(extra.onderwerp || blok.taak || 'Planblok').trim().slice(0, 200);
    return { onderwerp, plaats: String(extra.plaats || '').trim().slice(0, 200), html: [regels.map(x => ['<p>', esc(x), '</p>'].join('')).join(''), '<p style="color:#666">Gemaakt door de MT tool. Verzetten mag hier; de tool neemt het over.</p>'].join(''), start: { dateTime: blok.datum + 'T' + hhmm(s) + ':00', timeZone: U.TZ }, end: { dateTime: blok.datum + 'T' + hhmm(e) + ':00', timeZone: U.TZ }, herinnering: extra.herinnering === undefined || extra.herinnering === null ? null : Math.max(0, Math.min(10080, Math.round(Number(extra.herinnering)) || 0)), mtId: 'planblok:' + blok.id };
  };

  // ── controle vóór het aanmaken én vóór het uitvoeren ── → '' (goed) of de reden
  U.controle = function (op, ctx) {
    ctx = ctx || {};
    if (!op || typeof op !== 'object') return 'geen opdracht';
    if (!SOORTEN.includes(op.soort)) return 'onbekende soort';
    if (!op.bron || op.bron.type !== 'planblok' || !op.bron.id) return 'onbekend brontype';
    const team = ctx.team || [];
    if (!teamLid(team, op.eigenaar)) return 'de eigenaar van de agenda is geen teamlid';
    if (!teamLid(team, op.door)) return 'de maker van de opdracht is geen teamlid';
    if (op.id !== U.opId(op.soort, op.bron.type, op.bron.id, op.eigenaar, op.versie)) return 'het opdracht-id klopt niet met de inhoud';
    if (!RANG[op.status]) return 'onbekende stand';
    if (op.soort !== 'delete') {
      const p = op.payload;
      if (!p || !isYmd(String(p.start && p.start.dateTime || '').slice(0, 10)) || !p.end) return 'de afspraak mist een begin of eind';
      const d = String(p.start.dateTime).slice(0, 10), a = tijdMin(String(p.start.dateTime).slice(11, 16)), b = tijdMin(String(p.end.dateTime).slice(11, 16));
      if (String(p.end.dateTime).slice(0, 10) !== d || a === null || b === null || b <= a) return 'het eind ligt niet na het begin op dezelfde dag';
      if (b - a > U.MAX_DUUR_MIN) return 'langer dan 10 uur';
      const vandaag = ctx.vandaag || U.vandaagAms(ctx.nu || Date.now());
      if (nr(d) > nr(vandaag) + U.MAX_VOORUIT_DAGEN) return 'te ver vooruit (meer dan ~6 maanden)';
      if (nr(d) < nr(vandaag) - U.MAX_TERUG_DAGEN) return 'in het verleden';
      if (p.mtId !== 'planblok:' + op.bron.id) return 'de markering klopt niet met het blok';
    }
    if (op.soort !== 'create' && !(op.koppeling && op.koppeling.id)) return 'er is nog geen gekoppelde afspraak om te wijzigen';
    if (op.status !== 'wacht-bevestiging' && slug(op.door) !== slug(op.eigenaar) && !op.bevestigdDoor) return 'een opdracht voor een ander is niet door die ander bevestigd';
    if (ctx.blok !== undefined && op.soort !== 'delete') { const b = typeof ctx.blok === 'function' ? ctx.blok(op.bron.id) : null; if (!b || b._vervallen) return 'het planblok bestaat niet (meer)'; }
    return '';
  };

  // ── een nieuwe opdracht ──
  // spec: { soort, blok, eigenaar, extra?, koppeling? (voor update en delete) } ctx: { ik, team, nu, vandaag?, blok? } → { ok, op } | { ok: false, reden }
  U.nieuw = function (spec, ctx) {
    ctx = ctx || {}; spec = spec || {};
    const blok = spec.blok, eigenaar = slug(spec.eigenaar), ik = slug(ctx.ik);
    if (!blok || blok.id === undefined || blok.id === null || blok.id === '') return { ok: false, reden: 'geen planblok' };
    if (!SOORTEN.includes(spec.soort)) return { ok: false, reden: 'onbekende soort' };
    const payload = spec.soort === 'delete' ? null : U.payloadVoor(blok, spec.extra);
    if (spec.soort !== 'delete' && !payload) return { ok: false, reden: 'het planblok mist een datum, tijd of duur' };
    const versie = spec.soort === 'update' ? U.blokVersie(blok) : undefined;
    const op = { id: U.opId(spec.soort, 'planblok', blok.id, eigenaar, versie), soort: spec.soort, bron: { type: 'planblok', id: String(blok.id) }, eigenaar, door: ik, ts: new Date(ctx.nu || Date.now()).toISOString(), status: eigenaar === ik ? 'bevestigd' : 'wacht-bevestiging' };
    if (versie !== undefined) op.versie = versie;
    if (payload) op.payload = payload;
    if (spec.koppeling) op.koppeling = kopie(spec.koppeling);
    const r = U.controle(op, Object.assign({}, ctx, { blok: ctx.blok === undefined ? (id => String(id) === String(blok.id) ? blok : null) : ctx.blok }));
    return r ? { ok: false, reden: r } : { ok: true, op };
  };

  // ── samenvoegen (op elk apparaat dezelfde uitkomst, in elke volgorde; er verdwijnt nooit een opdracht) ──
  U.outboxVorm = obj => Array.isArray(obj) ? '' : 'outbox: geen lijst';
  const claimOud = (a, b) => (a.ts - b.ts) || (String(a.apparaat) < String(b.apparaat) ? -1 : String(a.apparaat) > String(b.apparaat) ? 1 : 0);
  const opSamen = (l, r) => {
    const rl = RANG[l.status] || 0, rr = RANG[r.status] || 0;
    const vl = Number(l.rev) || 0, vr = Number(r.rev) || 0;   // rev: telt bij elke wijziging van de uitvoerder op; bij dezelfde stand wint de nieuwste wijziging (daarna de inhoud, zodat het op elk apparaat gelijk uitpakt)
    const w = rl !== rr ? (rl > rr ? l : r) : vl !== vr ? (vl > vr ? l : r) : (JSON.stringify(l) <= JSON.stringify(r) ? l : r);
    const uit = kopie(w), ander = w === l ? r : l;
    // De inhoud: is een van beide verder in de keten, dan geldt de inhoud van die (dat is wat er is uitgevoerd); anders de nieuwste bedoeling (op tijd van maken, daarna de inhoud: op elk apparaat gelijk).
    // Twee apparaten die vóór het versturen een ander blok-resultaat zagen: de laatste wijziging van het blok wint, nooit een willekeurige.
    uit.payload = kopie(l.payload !== undefined && r.payload !== undefined ? (rl !== rr ? w.payload : (String(l.ts) !== String(r.ts) ? (String(l.ts) > String(r.ts) ? l.payload : r.payload) : (JSON.stringify(l.payload) <= JSON.stringify(r.payload) ? l.payload : r.payload))) : (l.payload || r.payload));
    ['koppeling', 'uitkomst', 'bevestigdDoor', 'bevestigdTs'].forEach(k => { if (uit[k] === undefined && ander[k] !== undefined) uit[k] = kopie(ander[k]); });
    uit.zoekpogingen = Math.max(Number(l.zoekpogingen) || 0, Number(r.zoekpogingen) || 0) || undefined; if (uit.zoekpogingen === undefined) delete uit.zoekpogingen;
    // de claim: twee apparaten die tegelijk claimen: de oudste (daarna het apparaat) wint, op elk apparaat gelijk. Een claim die vrijgegeven is (claimVrij >= zijn tijd) telt niet meer, ook niet uit een oude kopie.
    const vrij = Math.max(Number(l.claimVrij) || 0, Number(r.claimVrij) || 0), cl = [l.claim, r.claim].filter(c => c && c.ts > vrij).sort(claimOud);
    if (cl.length && !U.eindstand(uit.status)) uit.claim = kopie(cl[0]); else delete uit.claim;
    if (vrij) uit.claimVrij = vrij; else delete uit.claimVrij;
    return uit;
  };
  U.outboxSamen = function (lokaal, remote) {
    const lees = (x, naam) => { if (x === null || x === undefined) return []; if (U.outboxVorm(x)) throw new Error('samenvoegen (' + naam + '): ' + U.outboxVorm(x)); return x; };
    const L = lees(lokaal, 'lokaal'), R = lees(remote, 'remote'), per = new Map();
    [...R, ...L].forEach(x => { if (!x || typeof x !== 'object' || !x.id) return; const k = String(x.id), e = per.get(k); per.set(k, e ? opSamen(e, x) : kopie(x)); });
    return [...per.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || (String(a.id) < String(b.id) ? -1 : 1));
  };
  U.voegToe = (lijst, op) => U.outboxSamen(lijst, [op]);   // een opdracht met een bestaand id wordt NIET een tweede: de uitkomst is dezelfde lijst

  // ── de keuze van de eigenaar ──
  const wijzig = (lijst, id, f) => { const l = kopie(Array.isArray(lijst) ? lijst : []), i = l.findIndex(x => x && x.id === id); if (i < 0) return { ok: false, reden: 'onbekende opdracht', lijst: l }; const r = f(l[i]); if (r) return { ok: false, reden: r, lijst: l }; return { ok: true, lijst: l }; };
  U.bevestig = (lijst, id, ik, nu) => wijzig(lijst, id, o => { if (slug(o.eigenaar) !== slug(ik)) return 'alleen de eigenaar van de agenda bevestigt'; if (o.status !== 'wacht-bevestiging') return 'wacht niet (meer) op bevestiging'; o.status = 'bevestigd'; o.bevestigdDoor = slug(ik); o.bevestigdTs = new Date(nu || Date.now()).toISOString(); return ''; });
  U.wijsAf = (lijst, id, ik, nu) => wijzig(lijst, id, o => { if (slug(o.eigenaar) !== slug(ik)) return 'alleen de eigenaar van de agenda wijst af'; if (o.status !== 'wacht-bevestiging') return 'wacht niet (meer) op bevestiging'; o.status = 'afgewezen'; o.uitkomst = { tekst: 'afgewezen door ' + slug(ik), ts: new Date(nu || Date.now()).toISOString() }; return ''; });
  U.trekIn = (lijst, id, ik, nu) => wijzig(lijst, id, o => { if (slug(o.door) !== slug(ik)) return 'alleen de maker trekt een opdracht in'; if (o.status !== 'wacht-bevestiging' && o.status !== 'bevestigd') return 'de opdracht is al begonnen'; o.status = 'ingetrokken'; o.uitkomst = { tekst: 'ingetrokken door ' + slug(ik), ts: new Date(nu || Date.now()).toISOString() }; return ''; });
  U.wachtOpMij = (lijst, ik) => (lijst || []).filter(o => o && o.status === 'wacht-bevestiging' && slug(o.eigenaar) === slug(ik));
  // Wat ik voor een ander zette en wat nog wacht; "blijftLiggen" na drie dagen (de planner toont dan "wacht op bevestiging van X" met nadruk, de opdracht verdwijnt nooit stil)
  U.wachtOpAnderen = (lijst, ik, nu) => (lijst || []).filter(o => o && o.status === 'wacht-bevestiging' && slug(o.door) === slug(ik) && slug(o.eigenaar) !== slug(ik)).map(o => ({ id: o.id, eigenaar: o.eigenaar, bron: o.bron, blijftLiggen: (nu || Date.now()) - Date.parse(o.ts) > U.LIGT_LANG_MS }));
  // De gekoppelde afspraak van een blok in een agenda (voor een wijziging of verwijdering): uit de laatste gelukte opdracht
  U.koppelingVan = (lijst, blokId, eigenaar) => { const l = (lijst || []).filter(o => o && o.bron && String(o.bron.id) === String(blokId) && slug(o.eigenaar) === slug(eigenaar) && o.status === 'linked' && o.koppeling && o.koppeling.id).sort((a, b) => String(b.uitkomst && b.uitkomst.ts || b.ts).localeCompare(String(a.uitkomst && a.uitkomst.ts || a.ts))); return l.length ? kopie(l[0].koppeling) : null; };

  // ── welke opdracht is de volgende voor mijn agenda? Één tegelijk, de oudste eerst, per blok in volgorde. ──
  U.kandidaat = function (lijst, ik, nu) {
    nu = nu || Date.now(); const mijn = (lijst || []).filter(o => o && slug(o.eigenaar) === slug(ik));
    if (mijn.some(o => !U.eindstand(o.status) && o.claim && o.claim.tot > nu)) return { bezet: true };   // een andere opdracht loopt (hier of op een ander apparaat): niet twee tegelijk in dezelfde agenda
    const open = mijn.filter(o => ['bevestigd', 'onzeker'].includes(o.status) && !(o.wachtTot && o.wachtTot > nu)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || (a.id < b.id ? -1 : 1));
    for (const o of open) {   // een wijziging of verwijdering komt na een nog lopende aanmaak van hetzelfde blok
      const eerder = mijn.some(x => x !== o && x.bron.id === o.bron.id && x.soort === 'create' && !U.eindstand(x.status) && (o.soort !== 'create'));
      if (!eerder) return { op: o };
    }
    return null;
  };

  // ── schrijven naar de outbox (vers lezen, wijzigen, schrijven met samenvoegen bij een 412) ──
  async function schrijfOutbox(sp, wijziging) {
    let raw = await sp.read(U.BESTAND); if (raw === null || raw === undefined) raw = [];
    if (U.outboxVorm(raw)) throw new Error(U.outboxVorm(raw));
    const werk = wijziging(kopie(raw)); if (!werk) return { ok: false, geweigerd: true, data: raw };
    const samen = U.outboxSamen(werk, raw);
    if (JSON.stringify(samen) === JSON.stringify(raw)) return { ok: true, data: raw, geschreven: false };
    let eind = samen;
    const ok = await sp.write(U.BESTAND, samen, remote => { try { const s = U.outboxSamen(samen, remote); eind = s; return s; } catch (e) { return null; } });
    return { ok: !!ok, data: eind, geschreven: !!ok };
  }
  U.schrijfOutbox = schrijfOutbox;
  const zetOp = (lijst, id, f) => { const i = lijst.findIndex(x => x && x.id === id); if (i < 0) return null; const o = lijst[i]; if (f(o) === false) return null; return lijst; };   // f mag false geven: dan geen wijziging

  // ── Graph ──
  const kop = (extra) => Object.assign({ Prefer: 'outlook.timezone="' + U.TZ + '"', 'Content-Type': 'application/json' }, extra || {});
  const BASIS = 'https://graph.microsoft.com/v1.0/me';
  const SEL = '$select=id,subject,start,end,iCalUId,changeKey,isCancelled&$expand=' + encodeURIComponent("singleValueExtendedProperties($filter=id eq '" + U.PROP_MT + "' or id eq '" + U.PROP_OP + "')");
  const eigenschap = (ev, naam) => { const p = (ev && ev.singleValueExtendedProperties || []).find(x => x && x.id === naam); return p ? p.value : undefined; };
  const filterOp = (naam, waarde) => [BASIS, '/events?$filter=', encodeURIComponent(["singleValueExtendedProperties/Any(ep: ep/id eq '", naam, "' and ep/value eq '", String(waarde).replace(/'/g, "''"), "')"].join('')), '&', SEL].join('');
  const zelfde = (ev, p) => !!ev && String(ev.subject || '').trim() === String(p.onderwerp).trim() && String(ev.start && ev.start.dateTime || '').slice(0, 16) === p.start.dateTime.slice(0, 16) && String(ev.end && ev.end.dateTime || '').slice(0, 16) === p.end.dateTime.slice(0, 16);
  const koppelVan = ev => ({ id: ev.id, iCalUId: ev.iCalUId || '', changeKey: ev.changeKey || '', etag: ev['@odata.etag'] || '' });
  const lichaam = (op) => { const p = op.payload; const b = { subject: p.onderwerp, body: { contentType: 'HTML', content: p.html }, start: p.start, end: p.end, showAs: 'busy', isReminderOn: p.herinnering !== null, location: { displayName: p.plaats || '' } }; if (p.herinnering !== null) b.reminderMinutesBeforeStart = p.herinnering; return b; };
  const marks = op => [{ id: U.PROP_MT, value: op.payload.mtId }, { id: U.PROP_OP, value: op.id }];

  // Het uitvoeren van één opdracht in mijn eigen agenda. → { status, koppeling?, tekst?, wachtTot?, zoekpogingen? }
  async function voerUit(op, ctx) {
    const g = ctx.graph, p = op.payload;
    const vind = async () => { const r = await g(filterOp(U.PROP_OP, op.id), { headers: kop() }); const v = (r && r.value || []).filter(e => !e.isCancelled); return v.length ? v[0] : null; };
    const vindMt = async () => { const r = await g(filterOp(U.PROP_MT, op.bron.type + ':' + op.bron.id), { headers: kop() }); const v = (r && r.value || []).filter(e => !e.isCancelled); return v.length ? v[0] : null; };
    const lees = async id => g(BASIS + '/events/' + encodeURIComponent(id) + '?' + SEL, { headers: kop() });
    const klaar = (ev) => {   // terugleescontrole: de inhoud EN de tool-markering (mtId, bij een aanmaak ook mtOp) moeten kloppen
      if (!zelfde(ev, p)) return { status: 'conflict', koppeling: koppelVan(ev), tekst: 'na het schrijven wijkt de afspraak in Outlook af van wat bedoeld was' };
      if (eigenschap(ev, U.PROP_MT) !== p.mtId || (op.soort === 'create' && eigenschap(ev, U.PROP_OP) !== op.id)) return { status: 'conflict', koppeling: koppelVan(ev), tekst: 'de afspraak draagt niet de markering van deze opdracht (een andere afspraak met dezelfde tijd?); niets is aangepast' };
      return { status: 'linked', koppeling: koppelVan(ev), tekst: 'gemaakt en teruggelezen' };
    };
    if (op.soort === 'create') {
      const bestaand = await vind();   // eerst terugzoeken: misschien staat hij er al (een eerdere poging, of een ander apparaat)
      if (bestaand) { const ev = await lees(bestaand.id); return klaar(ev); }
      if (op.status === 'onzeker') {   // de uitkomst was onbekend: NOOIT blind opnieuw aanmaken; alleen terugzoeken, een paar keer
        const n = (Number(op.zoekpogingen) || 0) + 1;
        return n >= U.MAX_ZOEK ? { status: 'mislukt', zoekpogingen: n, tekst: 'niet terug te vinden na een onbekende uitkomst; er is niets nieuws aangemaakt. Opnieuw proberen is een nieuwe, bewuste opdracht.' } : { status: 'onzeker', zoekpogingen: n, wachtTot: ctx.nu + 60 * 1000 * n, tekst: 'uitkomst nog onbekend; er wordt teruggezocht' };
      }
      let r;
      try { r = await g(BASIS + '/events', { method: 'POST', headers: kop(), body: JSON.stringify(Object.assign(lichaam(op), { transactionId: op.id, singleValueExtendedProperties: marks(op) })) }); }
      catch (e) {
        if (e && e.status === 429) return { status: 'bevestigd', wachtTot: ctx.nu + Math.max(5, Number(e.retryAfter) || 30) * 1000, tekst: 'Microsoft vraagt om te wachten' };
        if (e && e.status >= 400 && e.status < 500) return { status: 'mislukt', tekst: 'Microsoft weigerde de afspraak (HTTP ' + e.status + ')' };
        return { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, tekst: 'geen antwoord (netwerk of server): uitkomst onbekend, er wordt teruggezocht' };
      }
      if (!r || !r.id) return { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, tekst: 'antwoord zonder afspraak-id: uitkomst onbekend' };
      let ev; try { ev = await lees(r.id); } catch (e) { return { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, koppeling: koppelVan(r), tekst: 'aangemaakt maar niet kunnen terugleggen: uitkomst wordt gecontroleerd' }; }
      return klaar(ev);
    }
    // update en delete: de gekoppelde afspraak moet er nog zijn en mag in Outlook niet veranderd zijn sinds we hem laatst zagen
    const k = op.koppeling; let ev = null;
    try { ev = await lees(k.id); } catch (e) { if (e && e.status === 404) ev = null; else throw e; }
    if (!ev) { const mt = await vindMt(); if (!mt) return op.soort === 'delete' ? { status: 'verwijderd', tekst: 'de afspraak was er al niet meer' } : { status: 'conflict', tekst: 'de gekoppelde afspraak is in Outlook niet meer te vinden (verwijderd?)' }; ev = await lees(mt.id); k.id = ev.id; }
    if (eigenschap(ev, U.PROP_MT) !== op.bron.type + ':' + op.bron.id) return { status: 'conflict', koppeling: koppelVan(ev), tekst: 'de gekoppelde afspraak draagt niet de markering van dit blok; er is niets aangepast of verwijderd' };   // nooit een afspraak aanraken die niet aantoonbaar van de tool is
    if (op.status === 'onzeker' && op.soort === 'update' && zelfde(ev, p)) return klaar(ev);   // de wijziging was al aangekomen (de vorige poging kreeg alleen geen antwoord)
    if (k.changeKey && ev.changeKey && k.changeKey !== ev.changeKey) return { status: 'conflict', koppeling: koppelVan(ev), tekst: 'de afspraak is in Outlook gewijzigd sinds de tool hem het laatst zag; niets is overschreven' };
    if (op.soort === 'update') {
      try { await g(BASIS + '/events/' + encodeURIComponent(ev.id), { method: 'PATCH', headers: kop(ev['@odata.etag'] ? { 'If-Match': ev['@odata.etag'] } : {}), body: JSON.stringify(lichaam(op)) }); }
      catch (e) { if (e && e.status === 412) return { status: 'conflict', tekst: 'de afspraak veranderde tijdens het schrijven; niets is overschreven' }; if (e && e.status === 429) return { status: 'bevestigd', wachtTot: ctx.nu + Math.max(5, Number(e.retryAfter) || 30) * 1000, tekst: 'Microsoft vraagt om te wachten' }; if (e && e.status >= 400 && e.status < 500) return { status: 'mislukt', tekst: 'Microsoft weigerde de wijziging (HTTP ' + e.status + ')' }; return { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, tekst: 'geen antwoord: uitkomst onbekend, er wordt teruggelezen' }; }
      const na = await lees(ev.id); return klaar(na);
    }
    try { await g(BASIS + '/events/' + encodeURIComponent(ev.id), { method: 'DELETE', headers: kop(ev['@odata.etag'] ? { 'If-Match': ev['@odata.etag'] } : {}) }); }
    catch (e) { if (e && e.status === 412) return { status: 'conflict', tekst: 'de afspraak veranderde tijdens het verwijderen; niets is verwijderd' }; if (e && e.status === 404) return { status: 'verwijderd', tekst: 'de afspraak was er al niet meer' }; if (e && e.status === 429) return { status: 'bevestigd', wachtTot: ctx.nu + Math.max(5, Number(e.retryAfter) || 30) * 1000, tekst: 'Microsoft vraagt om te wachten' }; return { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, tekst: 'geen antwoord: uitkomst onbekend' }; }
    try { await lees(ev.id); return { status: 'conflict', tekst: 'na het verwijderen staat de afspraak er nog' }; } catch (e) { return e && e.status === 404 ? { status: 'verwijderd', tekst: 'verwijderd en teruggelezen' } : { status: 'onzeker', zoekpogingen: 0, wachtTot: ctx.nu + 60 * 1000, tekst: 'verwijderd, maar de controle gaf geen antwoord: uitkomst wordt gecontroleerd' }; }   // alleen een 404 bewijst dat hij weg is
  }
  U.voerUit = voerUit;

  // ── de loop: één opdracht per aanroep, alleen met de vlag aan ──
  // o: { sp, graph, vlag(), nu(), ik, team, apparaat, blok(id)?, naUitkomst?(op) } → { status: 'uit'|'leeg'|'bezet'|'geweigerd'|'uitgevoerd'|'fout', op?, reden? }
  U.verwerk = async function (o) {
    o = Object.assign({}, D || {}, o || {});
    const aan = !!D && typeof D.vlag === 'function' ? !!D.vlag() : false;   // alleen de vlag van init() telt (niet een vlag die een aanroeper meegeeft)
    if (!aan) return { status: 'uit' };   // standaard uit: geen lezen, geen schrijven, geen aanroep
    const nu = typeof o.nu === 'function' ? o.nu() : Date.now(), ik = slug(typeof o.ik === 'function' ? o.ik() : o.ik), team = typeof o.team === 'function' ? o.team() : o.team, apparaat = String(o.apparaat || 'apparaat');
    if (!o.sp || !o.graph || !ik) return { status: 'fout', reden: 'onvolledige aanroep' };
    // Elke aanroep naar Microsoft krijgt een eigen tijdslimiet, en een schrijfactie begint niet meer als de claim bijna verloopt (dan zou een tweede apparaat dezelfde agenda overnemen).
    const t0 = Date.now(), graaf = o.graph, graph = (url, opt) => {
      const schrijft = !!(opt && opt.method && opt.method !== 'GET');
      if (schrijft && Date.now() - t0 > U.CLAIM_MS - U.CLAIM_MARGE_MS) return Promise.reject(Object.assign(new Error('claim bijna verlopen'), { intern: true }));
      let klok; const tijd = new Promise((_, nee) => { klok = setTimeout(() => nee(Object.assign(new Error('time-out'), { intern: true })), U.GRAPH_MS); });
      return Promise.race([graaf(url, opt), tijd]).finally(() => clearTimeout(klok));
    };
    let stand; try { stand = await o.sp.read(U.BESTAND); } catch (e) { return { status: 'fout', reden: 'outbox lezen mislukt' }; }
    if (stand === null || stand === undefined) stand = [];
    if (U.outboxVorm(stand)) return { status: 'fout', reden: U.outboxVorm(stand) };
    const k = U.kandidaat(stand, ik, nu);
    if (!k) return { status: 'leeg' }; if (k.bezet) return { status: 'bezet' };
    let op = k.op;
    const vandaag = ymd(Math.floor(nu / 864e5));
    const why = U.controle(op, { team, nu, vandaag, blok: typeof o.blok === 'function' ? o.blok : undefined });
    if (why) {
      await schrijfOutbox(o.sp, l => zetOp(l, op.id, x => { x.status = 'mislukt'; x.uitkomst = { tekst: 'geweigerd: ' + why, ts: new Date(nu).toISOString() }; delete x.claim; x.rev = (Number(x.rev) || 0) + 1; }) ? l : null).catch(() => {});
      return { status: 'geweigerd', op, reden: why };
    }
    // de claim: één opdracht tegelijk in deze agenda. Na het schrijven teruglezen: staat mijn claim er nog, dan mag ik.
    // Een eerdere claim die verlopen is zonder uitkomst: die uitvoerder kan midden in het aanmaken zijn gestopt. Dan is de uitkomst onbekend: alleen terugzoeken, nooit blind opnieuw aanmaken.
    const claim = { apparaat, ts: nu, tot: nu + U.CLAIM_MS }, verlopen = !!(op.claim && op.claim.tot <= nu);
    try { await schrijfOutbox(o.sp, l => zetOp(l, op.id, x => { if (U.eindstand(x.status) || (x.claim && x.claim.tot > nu && x.claim.apparaat !== apparaat)) return false; if (x.claim && x.claim.tot <= nu) x.claimVrij = Math.max(Number(x.claimVrij) || 0, x.claim.ts); x.claim = claim; x.rev = (Number(x.rev) || 0) + 1; }) ? l : null); } catch (e) { return { status: 'fout', reden: 'claim schrijven mislukt' }; }
    let na; try { na = await o.sp.read(U.BESTAND); } catch (e) { return { status: 'fout', reden: 'claim teruglezen mislukt' }; }
    const nu1 = (na || []).find(x => x && x.id === op.id);
    if (!nu1 || U.eindstand(nu1.status) || !nu1.claim || nu1.claim.apparaat !== apparaat || nu1.claim.ts !== claim.ts) return { status: 'bezet' };
    const eerder = (na || []).find(x => x && x.id !== op.id && slug(x.eigenaar) === ik && !U.eindstand(x.status) && x.claim && x.claim.tot > nu && claimOud(x.claim, claim) < 0);
    if (eerder) {   // een andere opdracht van mijn agenda was eerder aan de beurt: mijn claim vrijgeven
      await schrijfOutbox(o.sp, l => zetOp(l, op.id, x => { x.claimVrij = Math.max(Number(x.claimVrij) || 0, claim.ts); delete x.claim; x.rev = (Number(x.rev) || 0) + 1; }) ? l : null).catch(() => {});
      return { status: 'bezet' };
    }
    const uitvoerOp = Object.assign({}, nu1, { status: (verlopen && nu1.soort === 'create') ? 'onzeker' : nu1.status });
    let r; try { r = await voerUit(uitvoerOp, { graph, nu }); } catch (e) { r = { status: 'onzeker', zoekpogingen: Number(op.zoekpogingen) || 0, wachtTot: nu + 60000, tekst: 'onverwachte fout (' + (e && e.status ? 'HTTP ' + e.status : 'netwerk') + '): uitkomst onbekend' }; }
    let eind;
    try { eind = await schrijfOutbox(o.sp, l => zetOp(l, op.id, x => { if (RANG[r.status] >= RANG[x.status]) x.status = r.status; x.claimVrij = Math.max(Number(x.claimVrij) || 0, claim.ts); delete x.claim; x.rev = (Number(x.rev) || 0) + 1; if (r.koppeling) x.koppeling = r.koppeling; x.uitkomst = { tekst: r.tekst || '', ts: new Date(nu).toISOString() }; if (r.zoekpogingen !== undefined) x.zoekpogingen = r.zoekpogingen; if (r.wachtTot) x.wachtTot = r.wachtTot; else delete x.wachtTot; }) ? l : null); }
    catch (e) { return { status: 'fout', reden: 'uitkomst opslaan mislukt (de afspraak is mogelijk gemaakt; bij de volgende ronde wordt teruggezocht)', op }; }
    const klaarOp = ((eind && eind.data) || []).find(x => x && x.id === op.id) || Object.assign({}, op, r);
    if (typeof o.naUitkomst === 'function') { try { o.naUitkomst(klaarOp); } catch (e) { /* de aanroeper stempelt het blok; een fout daar maakt de uitkomst niet ongedaan */ } }
    return { status: 'uitgevoerd', op: klaarOp, uitkomst: r };
  };
  U.init = function (deps) { D = deps; return U; };
  root.MTAgendaUit = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
