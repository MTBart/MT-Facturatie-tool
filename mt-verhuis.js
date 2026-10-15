// mt-verhuis.js — verhuisknop (F5 stap 2): de lokale gegevens van dít apparaat van het oude adres naar het nieuwe.
// Browseropslag is per adres; wat al in SharePoint staat komt na inloggen vanzelf terug. Dit pakt de rest in:
// een expliciete lijst lokale gegevens uit localStorage (V.sleutelMee: nooit tokens of caches) en de IndexedDB's 'mt-rapporten'
// (foto's + rapportconcepten) en 'mt-app' (losse opname), met aantallen en een SHA-256 per foto en per onderdeel.
// Het pakket gaat naar SharePoint (MT-Bedrijfstool/_verhuizing/<Entra object-id>/<apparaat>-<tijd>-<uuid>/: eerst de foto's, als
// laatste pakket.json, met conflictBehavior fail) en kan als vangnet ook gedownload worden. Het nieuwe adres importeert na
// inloggen: alleen wat er daar nog NIET is (nooit overschrijven), alles of niets (importjournaal + terugdraaien), alleen een
// pakket van dezelfde gebruiker (oid), controleert elke checksum en meldt "x foto's, y concepten overgezet".
// Er wordt op het oude adres nooit iets gewist; na een geslaagde verhuizing toont het een alleen-lezen-balk met de knop
// "Nieuw pakket maken" (wat daarna nog wordt ingevoerd gaat niet vanzelf mee).
// De verhuizer verhoogt NOOIT een IndexedDB-versie: ontbreekt er een store, dan stopt hij met een melding.
// UIT tot het domein gekoppeld is: alleen aan met de proefvlag localStorage mt_verhuis_proef = '1' (per apparaat).
(function (root) {
  'use strict';
  const V = root.MTVerhuis = root.MTVerhuis || {};
  V.VERSIE = 2;
  V.NIEUW_ADRES = 'https://tool.mortiseandtenon.nl';
  V.MAP = '_verhuizing';
  V.LIMIET_DOWNLOAD_MOBIEL = 150 * 1048576;   // boven deze grootte geen download-vangnet op een telefoon (base64 in het geheugen)
  // Schema's komen uit mt-fotostore.js (één definitie; ook de app zelf gebruikt die). Geen eigen kopie hier.
  V.schemas = () => { const s = root.MTFotoStore && root.MTFotoStore.SCHEMAS; if (!Array.isArray(s) || !s.length) throw new Error('databaseschema ontbreekt (mt-fotostore.js niet geladen)'); return s; };
  const ls = () => { try { return root.localStorage; } catch (e) { return null; } };
  V.aan = () => { try { return ls().getItem('mt_verhuis_proef') === '1'; } catch (e) { return false; } };

  // ── Wat gaat mee? Een EXPLICIETE lijst (geïnventariseerd uit v2, mobiel, uren en mt-*.js). ──
  // Alles wat hier niet in staat gaat niet mee: tokens (opnieuw inloggen/koppelen), caches en afgeleide lijsten (bouwen zich op het
  // nieuwe adres vanzelf opnieuw op), lopende timers (Toggl is de bron) en de verhuis-administratie zelf.
  V.SLEUTELS = new Set([
    // synct naar SharePoint (komt na inloggen terug; staat het lokaal al, dan blijft dat staan — en lokaal nog niet gesynct gaat mee)
    'mt_voorraad', 'mt_bestellijst', 'mt_bestellijst_v2', 'mt_history', 'mt_history_archive', 'mt_projecten', 'mt_leveranciers', 'mt_toeslag_lak', 'mt_toeslag_spuit',
    'mt_mail_links', 'mt_mail_oppak', 'mt_planning', 'mt_klant_codes', 'mt_offerte_keuze', 'mt_project_taken', 'mt_project_taken_v2', 'mt_supplier_map', 'mt_calc_offertes', 'mt_calc_defaults',
    'mt_taken_journaal', 'mt_bijlage_index', 'mt_todo_sync', 'mt_bestellijst_journaal', 'mt_koppel_journaal', 'mt_contacten', 'mt_contacten_journaal', 'mt_project_controle',
    'mt_project_afhank', 'mt_project_sjablonen', 'mt_uurtarieven',
    // alleen lokaal, niet te herbouwen
    'mt_retry_queue', 'mt_agenda_blocks', 'mt_planblokken', 'mt_notes', 'mt_tasks', 'mt_werkcodes', 'mt_projectnummers', 'mt_werkcode_wacht', 'mt_timer_stop_pending', 'mt_calc_offertes_backup',
    'mt_uren_entries', 'mt_uren_ik', 'mt_uren_planning', 'mt_uren_taken', 'mt_uren_capaciteit', 'mt_uren_projecten', 'mt_uren_teamleden', 'mt_user_projects',
    'mt_instellingen', 'mt_adminconfig', 'mt_opl_codes', 'mt_mb_admin', 'mt_vrijedagen', 'mt_verlof', 'mt_proj_adressen', 'mt_contacten_mobiel', 'mt_email_verwerkt',
    'mt_cf_vasten_uit', 'mt_fb_sent', 'mt_notif_read', 'mt_pv_gezien', 'mt_vandaag_gezien', 'mt_klant_sectie', 'mt_proj_sectie', 'mt_proj_sectie_per', 'mt_bl_weergave', 'mt_aanwezig_kaart', 'ncr_lev_overrides',
  ]);
  V.PREFIXEN = ['mt_rapdraft_', 'mt_csv_prijzen_', 'mt_bestellijst_onleesbaar_', 'mt_updates_gezien:', 'mtg:zoom:', 'mtg:alleen:', 'mtg:nood:', 'mtg:intro:', 'mtg:mp-init:', 'mtg:mp:', 'mtg:prognose:', 'mt_project_taken_v2_verweesd_', 'mt_bestellijst_v2_verweesd_'];
  // Bewust NIET mee (token, cache, afgeleid, lopende timer, sessie). Alles wat noch hier noch in SLEUTELS/PREFIXEN staat is "onbekend":
  // dat gaat niet mee maar wordt in het paneel genoemd, zodat iemand beoordeelt of er een nieuwe sleutel bij moet.
  V.UITGESLOTEN = new Set(['mt_toggl_token', 'mt_toggl_last_sync', 'mt_toggl_user_names', 'mt_toggl_user_map', 'mt_toggl_project_map', 'mt_toggl_proj_names', 'mt_toggl_names_ver',
    'mt_toggl_users_raw', 'mt_toggl_projecten_raw', 'mt_cache_facturen', 'mt_cache_klanten', 'mt_klanten_cache', 'mt_notificaties', 'mt_auditlog', 'mt_chatlog_buffer', 'mt_calc_map_state',
    'mt_timer', 'mt_uren_lopend',
    'mt_meter_stand', 'mt_device_id', 'mt_taken_lokaal_negeer', 'mt_bestel_lokaal_negeer',
    'mt_mobiel_afhank', 'mt_vandaag_laatste_project', 'mt_vandaag_geboekt', 'mt_deeplink', 'mt_startvenster_gezien']);   // mt_startvenster_gezien: sessionStorage, "X taken wachten op je" al gezien in deze sessie; mt_mobiel_afhank: kopie van mt_project_afhank voor Vandaag op de telefoon, wordt bij het laden opnieuw van SharePoint gehaald; mt_vandaag_laatste_project: het laatst gekozen project bij Melden (gemak); mt_vandaag_geboekt: korte (12 uur) herinnering tegen dubbel tijd boeken; mt_deeplink: een link van de tv, sessionStorage tot na het inloggen; mt_meter_stand: afgeleide stand van de projectmeter (badge bij ≥ 90%), wordt bij het openen van een project opnieuw berekend
  V.UITGESLOTEN_PREFIXEN = ['mt_csv_', 'mtg:advies:', 'mt_offcheck:'];   // mtg:advies:<datum>: het dagelijkse advies van Geld, afgeleid (wordt zo opnieuw berekend)   // mt_csv_<project>: sessionStorage (mt_csv_prijzen_<project> in localStorage staat wél bij PREFIXEN)
  V.sleutelMee = k => typeof k === 'string' && (V.SLEUTELS.has(k) || V.PREFIXEN.some(p => k.startsWith(p) && k.length > p.length));
  // Bijna-zeker-een-geheim in de waarde (ook bij een toegestane sleutel): JWT overal erin, of een kale base64-achtige reeks.
  const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, KALE_B64 = /^[A-Za-z0-9+/_=-]{200,}$/;
  V.waardeVerdacht = v => typeof v === 'string' && (JWT.test(v) || KALE_B64.test(v.trim()));
  // Splitst de localStorage in wat meegaat en wat niet (met reden, nooit de waarde).
  V.selecteer = function () {
    const s = ls(), mee = {}, overgeslagen = []; if (!s) return { mee, overgeslagen };
    const keys = []; for (let i = 0; i < s.length; i++) keys.push(s.key(i));
    for (const k of keys.sort()) {
      if (!/^(mt|ncr_)/.test(k)) continue;
      if (/^mt_verhuis/.test(k) || k === 'mt_verhuisd') continue;
      if (!V.sleutelMee(k)) { overgeslagen.push({ sleutel: k, reden: V.UITGESLOTEN.has(k) || V.UITGESLOTEN_PREFIXEN.some(p => k.startsWith(p)) ? 'bewust niet meegenomen (token, cache of tijdelijk)' : 'onbekend: nog niet beoordeeld' }); continue; }
      const w = s.getItem(k);
      if (V.waardeVerdacht(w)) { overgeslagen.push({ sleutel: k, reden: 'bevat een token- of sleutelachtige waarde' }); continue; }
      mee[k] = w;
    }
    return { mee, overgeslagen };
  };

  // ── Wie ben ik? De map op SharePoint is gebaseerd op de Entra object-id (oid) uit het token, niet op een e-mailadres. ──
  const OID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  V.oidUitToken = t => { try { const p = String(t || '').split('.')[1]; if (!p) return null; const j = JSON.parse(decodeURIComponent(escape(root.atob(p.replace(/-/g, '+').replace(/_/g, '/'))))); return OID.test(j.oid || '') ? String(j.oid).toLowerCase() : null; } catch (e) { return null; } };
  V.oidVan = async ctx => {
    let o = ctx && ctx.oid; if (typeof o === 'function') o = await o();
    if (!o && typeof root.getAuthToken === 'function') o = V.oidUitToken(await root.getAuthToken());
    return OID.test(o || '') ? String(o).toLowerCase() : null;
  };

  // ── Adapters (vervangbaar in tests) ──
  // IndexedDB. Openen gebeurt ZONDER versie: een bestaande database wordt nooit opgewaardeerd. Bestaat hij niet, dan wordt de
  // upgrade afgebroken (= afwezig) zodat er niet per ongeluk een lege versie 1 ontstaat. Alleen V.idb.maak() maakt een ontbrekende
  // database aan, met precies het schema uit mt-fotostore.js (versie + stores).
  const idbOpen = (naam, schema) => new Promise((res, rej) => {
    let r; try { r = schema ? root.indexedDB.open(naam, schema.versie) : root.indexedDB.open(naam); } catch (e) { return rej(e); }
    r.onupgradeneeded = e => {
      if (!schema) { e.target.transaction.abort(); return; }
      for (const st of schema.stores) if (!r.result.objectStoreNames.contains(st)) r.result.createObjectStore(st);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = e => { if (!schema && r.error && r.error.name === 'AbortError') { if (e && e.preventDefault) e.preventDefault(); res(null); } else rej(r.error); };
  });
  V.idb = {
    // { status: 'afwezig' | 'ok' | 'mist', ontbreekt: [stores], versie }
    async controle(db, stores) {
      const d = await idbOpen(db, null); if (!d) return { status: 'afwezig', ontbreekt: [], versie: 0 };
      const ontbreekt = stores.filter(s => !d.objectStoreNames.contains(s)), versie = d.version; d.close();
      return { status: ontbreekt.length ? 'mist' : 'ok', ontbreekt, versie };
    },
    async maak(schema) { const d = await idbOpen(schema.naam, schema); d.close(); },
    async lijst(db, store) {
      const d = await idbOpen(db, null); if (!d) return []; if (!d.objectStoreNames.contains(store)) { d.close(); return []; }
      return await new Promise((res, rej) => { const uit = [], tx = d.transaction(store, 'readonly'), c = tx.objectStore(store).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { uit.push({ key: cur.key, value: cur.value }); cur.continue(); } };
        tx.oncomplete = () => { d.close(); res(uit); }; tx.onerror = () => { d.close(); rej(tx.error); }; });
    },
    // Voegt records toe in ÉÉN transactie per store met add(): is de key er al (ConstraintError, bv. door een gelijktijdige
    // schrijver), dan wordt hij overgeslagen en nooit overschreven. Een andere fout (bv. QuotaExceeded) breekt de hele
    // transactie af: dan is er in deze store niets toegevoegd. → { toegevoegd: [keys], bestond: [keys] }
    // Alle keys van een store (zonder de waarden/foto's te laden) en één record. Voor het journaal en het herstel.
    async sleutels(db, store) {
      const d = await idbOpen(db, null); if (!d) return []; if (!d.objectStoreNames.contains(store)) { d.close(); return []; }
      return await new Promise((res, rej) => {
        const tx = d.transaction(store, 'readonly'), os = tx.objectStore(store);
        let uit = [];
        if (typeof os.getAllKeys === 'function') { const q = os.getAllKeys(); q.onsuccess = () => { uit = q.result || []; }; }
        else { const c = os.openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { uit.push(cur.key); cur.continue(); } }; }
        tx.oncomplete = () => { d.close(); res(uit); }; tx.onerror = tx.onabort = () => { d.close(); rej(tx.error); };
      });
    },
    async haal(db, store, key) {
      const d = await idbOpen(db, null); if (!d) return undefined; if (!d.objectStoreNames.contains(store)) { d.close(); return undefined; }
      return await new Promise((res, rej) => { const tx = d.transaction(store, 'readonly'), q = tx.objectStore(store).get(key); tx.oncomplete = () => { d.close(); res(q.result); }; tx.onerror = tx.onabort = () => { d.close(); rej(tx.error); }; });
    },
    async voegToe(db, store, recs) {
      const d = await idbOpen(db, null); if (!d) throw new Error(`database ${db} bestaat niet`);
      if (!d.objectStoreNames.contains(store)) { d.close(); throw new Error(`database ${db} mist store ${store}`); }
      return await new Promise((res, rej) => {
        const toegevoegd = [], bestond = []; let tx;
        try { tx = d.transaction(store, 'readwrite'); } catch (e) { d.close(); return rej(e); }
        const os = tx.objectStore(store);
        for (const r of recs) {
          let q; try { q = os.add(r.value, r.key); } catch (e) { try { tx.abort(); } catch (e2) {} d.close(); return rej(e); }
          q.onsuccess = () => toegevoegd.push(r.key);
          q.onerror = ev => { if (q.error && q.error.name === 'ConstraintError') { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); bestond.push(r.key); } };
        }
        tx.oncomplete = () => { d.close(); res({ toegevoegd, bestond }); };
        tx.onabort = () => { d.close(); rej(tx.error || new Error('IndexedDB-transactie afgebroken')); };
      });
    },
    async verwijder(db, store, keys) {
      const d = await idbOpen(db, null); if (!d) return; if (!d.objectStoreNames.contains(store)) { d.close(); return; }
      await new Promise((res, rej) => { const tx = d.transaction(store, 'readwrite'), os = tx.objectStore(store); for (const k of keys) os.delete(k); tx.oncomplete = () => { d.close(); res(); }; tx.onabort = tx.onerror = () => { d.close(); rej(tx.error); }; });
    },
  };
  // SharePoint via de bestaande Graph-login (MTCore): upload(pad, inhoud, {conflict}), lees(pad) → Blob/null, lijst(map) → [namen].
  const KLEIN = 3.5 * 1024 * 1024, BROK = 16 * 327680, POGINGEN = 3;   // grote bestanden via een uploadsessie, in brokken van 5 MiB, elk brok 3 keer
  V.sp = {
    async _basis() {
      const token = await root.getGraphToken(); if (!token) throw new Error('geen Graph-token (opnieuw inloggen)');
      if (!V.sp._site) { const r = await fetch('https://graph.microsoft.com/v1.0/sites/mortisetenon.sharepoint.com:/sites/MortiseTenon', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('site HTTP ' + r.status); V.sp._site = (await r.json()).id; }
      return { base: `https://graph.microsoft.com/v1.0/sites/${V.sp._site}/drive/root:/MT-Bedrijfstool/`, token };
    },
    async upload(pad, inhoud, opt) {
      const conflict = (opt && opt.conflict) || 'replace', { base, token } = await V.sp._basis(), blob = inhoud instanceof Blob ? inhoud : new Blob([inhoud], { type: 'application/json' }), url = base + root._encPath(pad);
      const bestaatAl = () => { const e = new Error(`upload ${pad}: bestaat al (HTTP 409)`); e.bestaatAl = true; return e; };
      if (blob.size <= KLEIN) {
        const r = await fetch(url + ':/content?@microsoft.graph.conflictBehavior=' + conflict, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
        if (r.status === 409) throw bestaatAl();
        if (!r.ok) throw new Error(`upload ${pad}: HTTP ${r.status}`); return;
      }
      const s = await fetch(url + ':/createUploadSession', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflict } }) });
      if (s.status === 409) throw bestaatAl();
      if (!s.ok) throw new Error(`uploadsessie ${pad}: HTTP ${s.status}`);
      const sessie = (await s.json()).uploadUrl;
      let van = 0, fouten = 0;
      while (van < blob.size) {
        const tot = Math.min(blob.size, van + BROK);
        try {
          const r = await fetch(sessie, { method: 'PUT', headers: { 'Content-Range': `bytes ${van}-${tot - 1}/${blob.size}` }, body: blob.slice(van, tot) });
          if (!(r.ok || r.status === 202)) throw new Error('HTTP ' + r.status);
          van = tot; fouten = 0;
        } catch (e) {
          // Brok mislukt: de server vragen wat hij al heeft (nextExpectedRanges) en vanaf daar opnieuw; max 3 keer per brok.
          if (++fouten >= POGINGEN) throw new Error(`upload ${pad} (vanaf ${van}): ${e.message} na ${POGINGEN} pogingen`);
          try {
            const st = await fetch(sessie); if (st.ok) { const j = await st.json(), r0 = j && j.nextExpectedRanges && j.nextExpectedRanges[0], start = r0 ? parseInt(String(r0).split('-')[0], 10) : NaN; if (Number.isInteger(start) && start >= 0 && start <= blob.size) van = start; }
          } catch (e2) { /* statusvraag mislukt: hetzelfde brok nog eens */ }
        }
      }
    },
    async lees(pad) {
      const { base, token } = await V.sp._basis(), r = await fetch(base + root._encPath(pad) + ':/content', { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 404) return null; if (!r.ok) throw new Error(`lezen ${pad}: HTTP ${r.status}`); return await r.blob();
    },
    async lijst(map) {
      const { base, token } = await V.sp._basis(), r = await fetch(base + root._encPath(map) + ':/children?$select=name,folder&$top=999', { headers: { Authorization: 'Bearer ' + token } });
      if (r.status === 404) return []; if (!r.ok) throw new Error(`lijst ${map}: HTTP ${r.status}`); return ((await r.json()).value || []).map(x => x.name);
    },
  };
  V.hash = async data => { const buf = data instanceof Blob ? await data.arrayBuffer() : new TextEncoder().encode(String(data)); const h = await root.crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); };

  // ── Blobs uit records halen (structured clone) en terugzetten ──
  // "Gewoon object" los van het realm (een record uit IndexedDB, een iframe of een test heeft een ander Object.prototype).
  const isGewoon = w => !!w && typeof w === 'object' && !Array.isArray(w) && !(w instanceof Blob) && Object.prototype.toString.call(w) === '[object Object]';
  function haalBlobs(waarde, blobs) {
    if (waarde instanceof Blob) { const id = 'b' + (blobs.length + 1); blobs.push({ id, blob: waarde }); return { __blob: id, mime: waarde.type || '' }; }
    if (Array.isArray(waarde)) return waarde.map(x => haalBlobs(x, blobs));
    if (waarde && typeof waarde === 'object' && isGewoon(waarde)) { const o = {}; for (const k of Object.keys(waarde)) o[k] = haalBlobs(waarde[k], blobs); return o; }
    return waarde;
  }
  function zetBlobs(waarde, perId) {
    if (waarde && typeof waarde === 'object' && typeof waarde.__blob === 'string' && Object.keys(waarde).every(k => k === '__blob' || k === 'mime')) { const b = perId[waarde.__blob]; if (!b) throw new Error('foto ontbreekt in het pakket: ' + waarde.__blob); return b; }
    if (Array.isArray(waarde)) return waarde.map(x => zetBlobs(x, perId));
    if (waarde && typeof waarde === 'object' && isGewoon(waarde)) { const o = {}; for (const k of Object.keys(waarde)) o[k] = zetBlobs(waarde[k], perId); return o; }
    return waarde;
  }
  const blobBytes = w => w instanceof Blob ? w.size : Array.isArray(w) ? w.reduce((a, x) => a + blobBytes(x), 0) : isGewoon(w) ? Object.keys(w).reduce((a, k) => a + blobBytes(w[k]), 0) : 0;

  // ── Wat staat er op dit apparaat? (de verhuispagina) ──
  V.inventaris = async function () {
    const s = ls(), keys = []; for (let i = 0; s && i < s.length; i++) keys.push(s.key(i));
    const get = k => { try { return JSON.parse(s.getItem(k) || 'null'); } catch (e) { return null; } };
    const sel = V.selecteer();
    const uit = { sleutels: Object.keys(sel.mee).length, nietMee: keys.filter(k => /^(mt|ncr_)/.test(k) && !/^mt_verhuis/.test(k) && k !== 'mt_verhuisd' && !(k in sel.mee)).length, overgeslagen: sel.overgeslagen,
      onbekend: sel.overgeslagen.filter(o => /^onbekend/.test(o.reden)).map(o => o.sleutel), onderbrokenImport: !!leesJournaal(),
      wachtrij: (get('mt_retry_queue') || []).length || 0, timer: !!s && !!s.getItem('mt_timer'), concepten: keys.filter(k => /^mt_rapdraft_/.test(k) && k in sel.mee).length, agendaBlokken: (get('mt_agenda_blocks') || []).length || 0,
      fotos: { totaal: 0, lokaal: 0, wacht: 0, fout: 0, sync: 0 }, idbConcepten: 0, fouten: [], bytes: { ls: 0, idb: 0, totaal: 0 } };
    for (const v of Object.values(sel.mee)) uit.bytes.ls += String(v).length * 2;
    for (const db of V.schemas()) for (const st of db.stores) {
      try { const recs = await V.idb.lijst(db.naam, st);
        for (const r of recs) uit.bytes.idb += blobBytes(r.value);
        if (db.naam === 'mt-rapporten' && st === 'fotos') for (const r of recs) { uit.fotos.totaal++; const x = r.value && r.value.status; if (x in uit.fotos) uit.fotos[x]++; }
        else uit.idbConcepten += recs.length;
      } catch (e) { uit.fouten.push(`${db.naam}/${st}: ${e.message || e}`); }
    }
    uit.bytes.totaal = uit.bytes.ls + uit.bytes.idb;
    uit.nogTeVersturen = uit.wachtrij + uit.fotos.lokaal + uit.fotos.wacht + uit.fotos.fout;
    return uit;
  };
  // Download-vangnet: op een telefoon niet boven 150 MB (het hele bestand moet als base64 in het geheugen).
  V.downloadMag = (bytes, mobiel) => !(mobiel && bytes > V.LIMIET_DOWNLOAD_MOBIEL);

  // ── Pakket maken ──
  const nieuwId = () => (root.crypto && typeof root.crypto.randomUUID === 'function') ? root.crypto.randomUUID() : (() => { const b = root.crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = [...b].map(x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; })();
  V.maakPakket = async function (meta) {
    const oid = (meta && meta.oid) || null; if (!OID.test(oid || '')) throw new Error('niet ingelogd (geen gebruiker-id): log opnieuw in en probeer nog eens');
    const sel = V.selecteer(), lsDeel = sel.mee;
    const blobs = [], idb = {};
    for (const db of V.schemas()) { idb[db.naam] = {}; for (const st of db.stores) { const recs = await V.idb.lijst(db.naam, st); idb[db.naam][st] = recs.map(r => ({ key: r.key, value: haalBlobs(r.value, blobs) })); } }
    const blobInfo = [];
    for (const b of blobs) blobInfo.push({ id: b.id, grootte: b.blob.size, mime: b.blob.type || '', sha256: await V.hash(b.blob) });
    const tel = { sleutels: Object.keys(lsDeel).length, fotos: ((idb['mt-rapporten'] || {}).fotos || []).length, concepten: Object.keys(lsDeel).filter(k => /^mt_rapdraft_/.test(k)).length + ((idb['mt-rapporten'] || {}).drafts || []).length + ((idb['mt-app'] || {}).drafts || []).length, blobs: blobs.length, overgeslagen: sel.overgeslagen.length };
    const pakket = { soort: 'mt-verhuispakket', versie: V.VERSIE, id: nieuwId(), gemaakt: new Date().toISOString(), bron: (root.location && root.location.origin) || '', apparaat: (meta && meta.apparaat) || '', gebruiker: (meta && meta.gebruiker) || '', gebruiker_oid: String(oid).toLowerCase(),
      tellingen: tel, overgeslagen: sel.overgeslagen, localStorage: lsDeel, idb, blobs: blobInfo };
    pakket.sha256 = { localStorage: await V.hash(JSON.stringify(lsDeel)), idb: await V.hash(JSON.stringify(idb)) };
    return { pakket, blobs };
  };
  const stuk = s => String(s || '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'onbekend';
  // Pad: <oid>/<apparaat>-<tijd>-<uuid>: de oid scheidt gebruikers, de uuid maakt elke poging uniek (nooit overschrijven).
  V.gebruikersMap = oid => { if (!OID.test(oid || '')) throw new Error('ongeldige gebruiker-id'); return `${V.MAP}/${String(oid).toLowerCase()}`; };
  V.pad = (oid, apparaat, tijd, id) => `${V.gebruikersMap(oid)}/${stuk(apparaat)}-${String(tijd).replace(/[:.]/g, '-').slice(0, 19)}-${String(id || nieuwId()).toLowerCase().replace(/[^a-f0-9-]/g, '')}`;
  V.padVan = p => V.pad(p.gebruiker_oid, p.apparaat, p.gemaakt, p.id);
  // Naar SharePoint: eerst alle foto's, dan pakket.json (dat bestand = "pakket compleet"; conflictBehavior fail). Geeft het pad terug.
  V.naarSharePoint = async function (r, opt) {
    const map = V.padVan(r.pakket), voortgang = (opt && opt.voortgang) || (() => {}), json = JSON.stringify(r.pakket);
    let n = 0; for (const b of r.blobs) { await V.sp.upload(`${map}/blobs/${b.id}`, b.blob); voortgang(++n, r.blobs.length); }
    try { await V.sp.upload(`${map}/pakket.json`, json, { conflict: 'fail' }); }
    catch (e) {   // een eerdere poging kan al gelukt zijn (antwoord kwijt): dan is het goed als de inhoud identiek is
      if (!e.bestaatAl) throw e;
      const bestaand = await V.sp.lees(`${map}/pakket.json`);
      if (!bestaand || await bestaand.text() !== json) throw new Error('pakket.json bestaat al met andere inhoud: niets overschreven');
    }
    return map;
  };
  // Vangnet: één bestand om te downloaden, met de foto's erin (base64).
  V.alsDownload = async function (r) {
    const b64 = async blob => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); return root.btoa(s); };
    const inhoud = Object.assign({}, r.pakket, { blobData: {} });
    for (const b of r.blobs) inhoud.blobData[b.id] = await b64(b.blob);
    return new Blob([JSON.stringify(inhoud)], { type: 'application/json' });
  };
  V.download = async function (r, naam) {
    const blob = await V.alsDownload(r), a = root.document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = naam || `mt-verhuizing-${String(r.pakket.gemaakt).slice(0, 19).replace(/[:T]/g, '-')}.json`;
    root.document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  // ── Importeren op het nieuwe adres: alles of niets ──
  // pakket = pakket.json (object); blobVan(id) → Blob (SharePoint of uit het downloadbestand); opt.oid = de ingelogde gebruiker.
  // Nooit overschrijven. Wat DEZE run toevoegt komt in een journaal; gaat er iets mis (bv. QuotaExceeded), dan draait precies
  // dat terug en volgt "onderbroken, niets veranderd, opnieuw proberen".
  //
  // CRASHVEILIG: het journaal staat ook in localStorage (mt_verhuis_journaal) en wordt vastgelegd VÓÓR elke schrijfactie:
  //  - localStorage: de sleutel + een vingerafdruk van de waarde, daarna pas setItem.
  //  - IndexedDB: per store eerst de KANDIDAAT-records (alleen keys die er nog niet waren, met een vingerafdruk van de inhoud), daarna pas
  //    de add-transactie, en daarna de bevestiging met de echt toegevoegde keys. Sluit de tab precies tussen "transactie klaar" en
  //    "bevestigd", dan weet het herstel toch wat het mocht opruimen: een kandidaat die er nu staat met EXACT dezelfde inhoud.
  //    Een record dat al bestond (niet in de kandidaten) of dat nu iets anders bevat, blijft staan.
  // EXCLUSIEF: alles wat het journaal of de data raakt (herstel én import) draait binnen navigator.locks.request(exclusief). Het
  // slot verdwijnt zodra de tab sluit, dus een gecrashte import is meteen te herstellen; en twee tabbladen kunnen nooit tegelijk
  // importeren of herstellen. Zonder navigator.locks wordt er NIET geïmporteerd (geen onveilige terugval).
  const JOURNAAL = 'mt_verhuis_journaal', LOCKNAAM = 'mt-verhuis-import';
  // Vingerafdruk = SHA-256 (geen 32-bit hash): het herstel verwijdert alleen bij een EXACTE digest-match, dus nooit gewijzigde gebruikersdata.
  // Een vingerafdruk uit een oud journaal (zonder "sha256:") komt nooit overeen: dan blijft alles staan (liever een overbodig record dan een kwijt record).
  const fp = async v => 'sha256:' + await V.hash(String(v));
  // Canonieke inhoud van een IndexedDB-record: de structuur, alle gewone waarden en van elke foto grootte, type EN de bytes (SHA-256).
  // Onbekende soorten (Map, Set, class-instanties…) geven een vingerafdruk die nooit overeenkomt: die worden dus nooit verwijderd.
  async function stabiel(w) {
    if (w instanceof Blob) return 'B' + w.size + ':' + w.type + ':' + await V.hash(w);
    if (w instanceof Date) return 'D' + w.getTime();
    if (Array.isArray(w)) { const d = []; for (const x of w) d.push(await stabiel(x)); return '[' + d.join(',') + ']'; }
    if (root.ArrayBuffer && (w instanceof root.ArrayBuffer || root.ArrayBuffer.isView(w))) return 'A' + await V.hash(new Blob([w]));
    if (isGewoon(w)) { const d = []; for (const k of Object.keys(w).sort()) d.push(JSON.stringify(k) + ':' + await stabiel(w[k])); return '{' + d.join(',') + '}'; }
    if (w && typeof w === 'object') return '?' + nieuwId();
    let j; try { j = JSON.stringify(w); } catch (e) { return '?' + nieuwId(); }
    return j === undefined ? 'u' : j;
  }
  const fpRecord = async w => fp(await stabiel(w));
  const leesJournaal = () => { try { return JSON.parse(ls().getItem(JOURNAAL) || 'null'); } catch (e) { return null; } };
  const BEZET = 'er loopt al een import of herstel in een ander tabblad: wacht even. Niets veranderd';
  const GEEN_LOCKS = 'deze browser kan tabbladen niet op slot zetten (navigator.locks ontbreekt): importeren staat uit, omdat twee tabbladen elkaars werk zouden kunnen verstoren. Gebruik een recente Chrome, Edge, Firefox of Safari. Niets veranderd';
  V.heeftSlot = () => { const L = root.navigator && root.navigator.locks; return !!L && typeof L.request === 'function'; };
  async function metSlot(fn) {
    if (!V.heeftSlot()) throw new Error(GEEN_LOCKS);
    return await root.navigator.locks.request(LOCKNAAM, { mode: 'exclusive', ifAvailable: true }, async slot => { if (!slot) throw new Error(BEZET); return await fn(); });
  }
  // Draait terug wat het journaal bevat. → { fouten: [onderdelen], sleutels, records }.
  //  - localStorage: een sleutel alleen als hij nog onze waarde heeft (vingerafdruk).
  //  - IndexedDB bevestigd: precies de toegevoegde keys. Afgebroken transactie: niets (was atomair). Niet bevestigd (crash): alleen kandidaten
  //    die er nu staan met dezelfde vingerafdruk als wat wij zouden schrijven.
  async function terugdraaien(journaal) {
    const s = ls(), fouten = []; let sl = 0, rec = 0;
    for (const [k, f] of (journaal.ls || []).slice().reverse()) { try { const w = s.getItem(k); if (w != null && await fp(w) === f) { s.removeItem(k); sl++; } } catch (e) { fouten.push(k); } }
    for (const j of (journaal.idb || []).slice().reverse()) {
      try {
        if (j.afgebroken) continue;
        let keys = j.keys;
        if (!Array.isArray(keys)) {
          keys = [];
          for (const c of (j.kand || [])) { const w = await V.idb.haal(j.db, j.store, c.key); if (w !== undefined && await fpRecord(w) === c.fp) keys.push(c.key); }
        }
        if (keys.length) { await V.idb.verwijder(j.db, j.store, keys); rec += keys.length; }
      } catch (e) { fouten.push(`${j.db}/${j.store}`); }
    }
    return { fouten, sleutels: sl, records: rec };
  }
  async function herstelBinnenSlot() {
    const s = ls(), j = leesJournaal(); if (!j) return null;
    const r = await terugdraaien(j);
    if (r.fouten.length) throw new Error(`een eerder onderbroken import kon niet volledig worden teruggedraaid (${r.fouten.join(', ')}): start geen nieuwe import maar laat dit nakijken`);
    try { s.removeItem(JOURNAAL); } catch (e) {}
    return { sleutels: r.sleutels, records: r.records };
  }
  // Herstelt een onderbroken import (journaal blijft staan na een crash). → null (niets te doen) of { sleutels, records }.
  V.herstelJournaal = () => metSlot(herstelBinnenSlot);
  V.importeer = async function (pakket, blobVan, opt) {
    if (!pakket || pakket.soort !== 'mt-verhuispakket') throw new Error('geen verhuispakket');
    if (pakket.versie !== V.VERSIE) throw new Error('pakket van een oude of nieuwere versie: maak op het oude adres een nieuw pakket');
    const oid = opt && opt.oid; if (!OID.test(oid || '')) throw new Error('niet ingelogd (geen gebruiker-id): log in en probeer nog eens');
    if (String(pakket.gebruiker_oid || '').toLowerCase() !== String(oid).toLowerCase()) throw new Error('dit pakket is van een andere gebruiker: niets geïmporteerd');
    if (!V.heeftSlot()) throw new Error(GEEN_LOCKS);
    if (await V.hash(JSON.stringify(pakket.localStorage)) !== pakket.sha256.localStorage || await V.hash(JSON.stringify(pakket.idb)) !== pakket.sha256.idb) throw new Error('checksum van het pakket klopt niet: niets geïmporteerd');
    const perId = {};
    for (const b of pakket.blobs || []) {                 // eerst álle foto's ophalen en controleren — pas daarna iets schrijven
      const blob = await blobVan(b.id); if (!blob) throw new Error(`foto ${b.id} ontbreekt: niets geïmporteerd`);
      if (blob.size !== b.grootte || await V.hash(blob) !== b.sha256) throw new Error(`foto ${b.id}: checksum klopt niet: niets geïmporteerd`);
      perId[b.id] = blob.type || !b.mime ? blob : new Blob([blob], { type: b.mime });
    }
    return await metSlot(async () => {                    // vanaf hier raakt alles de data: exclusief over alle tabbladen
      // Voorcontrole van alle databases waar iets in moet: ontbreekt er een store, dan stoppen we vóór er iets geschreven is.
      const plan = [];
      for (const sch of V.schemas()) {
        const recs = []; for (const st of sch.stores) { const lijst = ((pakket.idb || {})[sch.naam] || {})[st] || []; if (lijst.length) recs.push([st, lijst]); }
        if (!recs.length) continue;
        const c = await V.idb.controle(sch.naam, sch.stores);
        if (c.status === 'mist') throw new Error(`database ${sch.naam} mist onderdeel ${c.ontbreekt.join(', ')}: de verhuizer wijzigt nooit een databaseversie. Niets veranderd; open eerst de app op dit adres of neem contact op`);
        plan.push({ sch, status: c.status, recs });
      }
      const s = ls(), uit = { sleutels: 0, sleutelsAlAanwezig: [], overgeslagen: (pakket.overgeslagen || []).length, fotos: 0, fotosAlAanwezig: 0, concepten: 0, conceptenAlAanwezig: 0 };
      // Een journaal van een eerdere, onderbroken import (tab gesloten): met het slot in handen weten we dat niemand het nog gebruikt.
      uit.hersteld = await herstelBinnenSlot();
      const journaal = { id: nieuwId(), gemaakt: pakket.gemaakt, t: Date.now(), ls: [], idb: [] };
      const bewaar = () => { journaal.t = Date.now(); s.setItem(JOURNAAL, JSON.stringify(journaal)); };
      try {
        bewaar();
        for (const [k, v] of Object.entries(pakket.localStorage || {})) {
          if (!V.sleutelMee(k) || V.waardeVerdacht(v)) continue;
          if (s.getItem(k) != null) { uit.sleutelsAlAanwezig.push(k); continue; }   // al hier (bv. uit SharePoint): niet overschrijven
          journaal.ls.push([k, await fp(v)]); bewaar();   // eerst vastleggen (write-ahead), dan schrijven
          s.setItem(k, v); uit.sleutels++; if (/^mt_rapdraft_/.test(k)) uit.concepten++;   // controle en schrijven zonder tussenruimte
        }
        for (const p of plan) {
          if (p.status === 'afwezig') { try { await V.idb.maak(p.sch); } catch (e) { const c2 = await V.idb.controle(p.sch.naam, p.sch.stores); if (c2.status !== 'ok') throw e; } }
          for (const [st, lijst] of p.recs) {
            const foto = p.sch.naam === 'mt-rapporten' && st === 'fotos';
            const recs = lijst.map(r => ({ key: r.key, value: zetBlobs(r.value, perId) }));
            // 1. kandidaten VASTLEGGEN vóór de write: alleen keys die er nu nog niet zijn, met een vingerafdruk van wat wij erin zetten
            const bestond = new Set((await V.idb.sleutels(p.sch.naam, st)).map(k => JSON.stringify(k)));
            const kand = []; for (const r of recs) if (!bestond.has(JSON.stringify(r.key))) kand.push({ key: r.key, fp: await fpRecord(r.value) });
            const entry = { db: p.sch.naam, store: st, kand, keys: null };
            journaal.idb.push(entry); bewaar();
            // 2. de write: één transactie, dus alles of niets in deze store
            let res; try { res = await V.idb.voegToe(p.sch.naam, st, recs); } catch (e) { entry.afgebroken = true; try { bewaar(); } catch (e2) {} throw e; }
            // 3. bevestigen met wat er echt is toegevoegd
            entry.keys = res.toegevoegd; bewaar();
            if (foto) { uit.fotos += res.toegevoegd.length; uit.fotosAlAanwezig += res.bestond.length; } else { uit.concepten += res.toegevoegd.length; uit.conceptenAlAanwezig += res.bestond.length; }
          }
        }
      } catch (e) {
        const r = await terugdraaien(journaal), mis = r.fouten;
        try { if (!mis.length) s.removeItem(JOURNAAL); } catch (e2) {}   // bij een mislukt terugdraaien blijft het journaal voor de volgende keer
        const m = mis.length ? `onderbroken; terugdraaien deels mislukt (${mis.join(', ')}): importeer opnieuw, wat er al staat wordt overgeslagen` : 'onderbroken, niets veranderd, opnieuw proberen';
        const er = new Error(`${m} (${e && e.name === 'QuotaExceededError' ? 'opslag vol' : (e && e.message) || e})`); er.oorzaak = e; er.terugdraaienMislukt = mis; throw er;
      }
      try { s.removeItem(JOURNAAL); } catch (e) {}   // pas na volledig succes
      try { s.setItem('mt_verhuis_import:' + pakket.gemaakt, JSON.stringify({ t: Date.now(), bron: pakket.bron, uit: Object.assign({}, uit, { sleutelsAlAanwezig: uit.sleutelsAlAanwezig.length }) })); } catch (e) {}
      return uit;
    });
  };
  V.importeerVanSharePoint = async function (map, opt) {
    const p = await V.sp.lees(`${map}/pakket.json`); if (!p) throw new Error('pakket.json niet gevonden (nog niet compleet?)');
    const pakket = JSON.parse(await p.text());
    return await V.importeer(pakket, id => V.sp.lees(`${map}/blobs/${id}`), opt);
  };
  V.importeerDownload = async function (bestand, opt) {
    const pakket = JSON.parse(await bestand.text()), data = pakket.blobData || {}; delete pakket.blobData;
    const blob = id => { const b = data[id]; if (b == null) return null; const bin = root.atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const info = (pakket.blobs || []).find(x => x.id === id); return new Blob([u], { type: (info && info.mime) || '' }); };
    return await V.importeer(pakket, async id => blob(id), opt);
  };
  // Alleen COMPLETE pakketten van deze gebruiker: pakket.json bestaat (wordt als laatste geschreven), hoort bij deze oid en
  // alle foto's waar het naar verwijst staan er. → [{ map, naam, gemaakt, apparaat, tellingen }], nieuwste eerst.
  V.pakketten = async oid => {
    const basis = V.gebruikersMap(oid), uit = [];
    for (const n of (await V.sp.lijst(basis)).sort().reverse()) {
      const map = `${basis}/${n}`;
      try {
        const m = await V.sp.lees(`${map}/pakket.json`); if (!m) continue;
        const p = JSON.parse(await m.text());
        if (!p || p.soort !== 'mt-verhuispakket' || String(p.gebruiker_oid || '').toLowerCase() !== String(oid).toLowerCase()) continue;
        const aanwezig = new Set(await V.sp.lijst(`${map}/blobs`));
        if ((p.blobs || []).some(b => !aanwezig.has(b.id))) continue;
        uit.push({ map, naam: n, gemaakt: p.gemaakt, apparaat: p.apparaat, tellingen: p.tellingen || {} });
      } catch (e) { /* onleesbaar of half: niet tonen */ }
    }
    return uit.sort((a, b) => String(b.gemaakt).localeCompare(String(a.gemaakt)));
  };

  // ── Weergave: verhuispaneel (oud én nieuw adres) ──
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (n / 1048576).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' MB';
  // ctx: { gebruiker (label), oid | () => oid (anders uit het token), apparaat, mobiel, toast(t) }
  V.zetContext = ctx => { V.ctx = ctx || {}; };
  V.paneel = async function (el, ctx) {
    ctx = ctx || V.ctx || {}; const toast = ctx.toast || (() => {});
    el.innerHTML = '<div class="mtv-melding">Inventaris van dit apparaat…</div>';
    let inv; try { inv = await V.inventaris(); } catch (e) { el.innerHTML = `<div class="mtv-melding">Inventaris mislukt: ${esc(e.message)}</div>`; return; }
    let oid = null; try { oid = await V.oidVan(ctx); } catch (e) { oid = null; }
    const nieuw = root.location && root.location.origin === V.NIEUW_ADRES, al = V.verhuisd(), dlMag = V.downloadMag(inv.bytes.totaal, !!ctx.mobiel);
    const verdacht = inv.overgeslagen.filter(o => /^bevat/.test(o.reden));
    const waarsch = [!oid ? 'Je bent niet (meer) ingelogd: log opnieuw in om te verhuizen.' : '',
      inv.timer ? 'Er loopt een timer: stop die eerst (Toggl is de bron; de timer gaat niet mee).' : '',
      inv.nogTeVersturen ? `Nog niet verstuurd: ${inv.wachtrij} in de wachtrij, ${inv.fotos.lokaal + inv.fotos.wacht + inv.fotos.fout} foto's. Ga eerst online zodat het zelf verstuurt; wat overblijft gaat mee in het pakket.` : '',
      inv.onbekend.length ? 'Onbekende lokale gegevens, niet meegenomen — laat beoordelen of ze mee moeten (geen waarden getoond): ' + inv.onbekend.join(', ') + '.' : '',
      !V.heeftSlot() ? 'Deze browser kan tabbladen niet op slot zetten (navigator.locks): importeren is uitgeschakeld. Gebruik een recente browser.' : '',
      inv.onderbrokenImport ? 'Er staat een import-journaal van een onderbroken (of nog lopende) import. Bij de volgende import wordt eerst teruggedraaid wat die al had toegevoegd.' : '',
      verdacht.length ? 'Niet meegenomen omdat de waarde op een token of sleutel lijkt (geen waarden getoond): ' + verdacht.map(o => o.sleutel).join(', ') + '.' : '',
      inv.fouten.length ? 'Niet alles leesbaar: ' + inv.fouten.join('; ') : ''].filter(Boolean);
    el.innerHTML = `<div class="mtv">
      <p><b>Op dit apparaat:</b> ${esc(inv.sleutels)} instellingen/lokale gegevens, ${esc(inv.fotos.totaal)} foto's (${esc(inv.fotos.sync)} al op SharePoint), ${esc(inv.concepten + inv.idbConcepten)} concepten, ${esc(inv.agendaBlokken)} eigen agendablokken, ${esc(inv.wachtrij)} in de wachtrij. <b>Totale grootte: ${esc(mb(inv.bytes.totaal))}.</b> Tokens en tijdelijke caches (${esc(inv.nietMee)}) gaan niet mee: op het nieuwe adres log je opnieuw in, koppel je Toggl opnieuw en bouwen de lijsten zich vanzelf weer op.</p>
      ${waarsch.map(w => `<div class="mtv-let">${esc(w)}</div>`).join('')}
      ${al ? `<div class="mtv-let"><b>Dit apparaat is al verhuisd</b> (${esc(new Date(al.t).toLocaleString('nl-NL'))}). Er is niets gewist, maar wat je hier sindsdien nog invoerde, gaat niet vanzelf mee naar het nieuwe adres. Maak een nieuw pakket en importeer dat daar: wat daar al staat wordt nooit overschreven.</div>` : ''}
      ${nieuw ? '' : `<div class="mtv-rij"><button class="mtv-knop aan" data-v="maak"${oid ? '' : ' disabled'}>${al ? 'Nieuw pakket maken (naar SharePoint)' : 'Verhuispakket maken (naar SharePoint)'}</button></div>`}
      ${!nieuw && !dlMag ? `<div class="mtv-let">Het download-vangnet staat uit: boven ${esc(mb(V.LIMIET_DOWNLOAD_MOBIEL))} past het niet veilig in het geheugen van een telefoon. Het pakket gaat dan alleen via SharePoint; verhuis zo nodig vanaf een pc.</div>` : ''}
      <div class="mtv-uit" data-v="uit"></div>
      <hr><p><b>Op het nieuwe adres:</b> pakket ophalen en importeren. Er wordt niets overschreven wat er al staat, en een onderbroken import draait volledig terug.</p>
      <div class="mtv-rij"><button class="mtv-knop" data-v="lijst"${oid ? '' : ' disabled'}>Mijn verhuispakketten zoeken</button><label class="mtv-knop">Bestand importeren (vangnet)<input type="file" accept="application/json" data-v="bestand" hidden></label></div>
      <div class="mtv-uit" data-v="pakketten"></div></div>`;
    const uit = el.querySelector('[data-v="uit"]'), lijst = el.querySelector('[data-v="pakketten"]');
    const toon = (doel, html) => { doel.innerHTML = html; };
    const dlKnop = () => dlMag ? '<button class="mtv-knop" data-v="download">Ook downloaden (vangnet)</button>' : '';
    const resultaat = u => `<div class="mtv-ok">Overgezet: ${esc(u.fotos)} foto's, ${esc(u.concepten)} concepten, ${esc(u.sleutels)} lokale gegevens.${u.sleutelsAlAanwezig.length || u.fotosAlAanwezig || u.conceptenAlAanwezig ? ` Al aanwezig en dus overgeslagen: ${u.sleutelsAlAanwezig.length} gegevens, ${u.fotosAlAanwezig} foto's, ${u.conceptenAlAanwezig} concepten.` : ''}</div>`;
    let laatste = null;
    el.addEventListener('click', async e => {
      const k = e.target.closest('[data-v]'); if (!k || k.tagName === 'INPUT') return;
      const w = k.dataset.v;
      if (w === 'maak') {
        k.disabled = true; toon(uit, 'Pakket maken…');
        try {
          laatste = await V.maakPakket({ gebruiker: ctx.gebruiker, oid, apparaat: ctx.apparaat });
          const grootte = laatste.blobs.reduce((a, b) => a + b.blob.size, 0);
          const map = await V.naarSharePoint(laatste, { voortgang: (n, t) => toon(uit, `Foto's naar SharePoint: ${n} van ${t}…`) });
          toon(uit, `<div class="mtv-ok">Pakket staat op SharePoint (${esc(map)}): ${esc(laatste.pakket.tellingen.sleutels)} gegevens, ${esc(laatste.pakket.tellingen.fotos)} foto's, ${esc(laatste.pakket.tellingen.concepten)} concepten (${esc(mb(grootte))}), met checksums.</div>
            <div class="mtv-rij">${dlKnop()}<button class="mtv-knop" data-v="klaar">Dit apparaat is verhuisd</button></div>`);
          laatste.map = map;
        } catch (er) { toon(uit, `<div class="mtv-let">Niet gelukt: ${esc(er.message)}. Er is niets gewist; probeer opnieuw${dlMag ? ' of gebruik de download' : ''}.</div><div class="mtv-rij">${dlMag ? '<button class="mtv-knop" data-v="download">Downloaden (vangnet)</button>' : ''}</div>`); }
        k.disabled = false;
      } else if (w === 'download') {
        try { if (!laatste) laatste = await V.maakPakket({ gebruiker: ctx.gebruiker, oid, apparaat: ctx.apparaat }); await V.download(laatste); toast('Verhuispakket gedownload'); }
        catch (er) { toast('Downloaden mislukt: ' + er.message); }
      } else if (w === 'klaar') {
        V.markeerVerhuisd(laatste && laatste.map, laatste && laatste.pakket.tellingen); V.balk(); toast('Gemarkeerd als verhuisd — er is niets gewist');
      } else if (w === 'lijst') {
        toon(lijst, 'Zoeken…');
        try { const ps = await V.pakketten(oid); toon(lijst, ps.length ? ps.map(p => `<div class="mtv-rij"><span>${esc(p.apparaat || p.naam)} — ${esc(new Date(p.gemaakt).toLocaleString('nl-NL'))} (${esc(p.tellingen.fotos || 0)} foto's)</span><button class="mtv-knop" data-v="import" data-map="${esc(p.map)}">Importeren</button></div>`).join('') : 'Geen complete pakketten gevonden.'); }
        catch (er) { toon(lijst, `<div class="mtv-let">Zoeken mislukt: ${esc(er.message)}</div>`); }
      } else if (w === 'import') {
        k.disabled = true;
        try { toon(lijst, resultaat(await V.importeerVanSharePoint(k.dataset.map, { oid }))); } catch (er) { toon(lijst, `<div class="mtv-let">Niet geïmporteerd: ${esc(er.message)}</div>`); }
      }
    });
    el.querySelector('[data-v="bestand"]').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { toon(lijst, resultaat(await V.importeerDownload(f, { oid }))); } catch (er) { toon(lijst, `<div class="mtv-let">Niet geïmporteerd: ${esc(er.message)}</div>`); }
    });
  };
  V.css = function () {
    if (!root.document || root.document.getElementById('mtv-css')) return;
    const s = root.document.createElement('style'); s.id = 'mtv-css';
    s.textContent = `.mtv{font-size:14px;line-height:1.5}.mtv-rij{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}
.mtv-knop{border:1px solid #ccc;background:#fff;border-radius:8px;padding:0 14px;min-height:44px;font:inherit;cursor:pointer;display:inline-flex;align-items:center}
.mtv-knop.aan{background:#2A4A38;color:#fff;border-color:#2A4A38}.mtv-let{background:#fbf0dc;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13px}
.mtv-ok{background:#e3f1e8;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13px}.mtv-melding{color:#888}
.mtv-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:flex-end;justify-content:center}
.mtv-overlay>div{background:#fff;width:100%;max-width:640px;max-height:90vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px}
.mtv-balk{position:sticky;top:0;z-index:99998;background:#7a4b00;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;text-align:center}
.mtv-balk a{color:#fff}.mtv-balk button{margin-left:8px;min-height:36px;border:2px solid #fff;background:#fff;color:#7a4b00;border-radius:8px;font:700 13px system-ui,sans-serif;padding:0 12px;cursor:pointer}`;
    root.document.head.appendChild(s);
  };
  V.overlay = function (ctx) {
    V.css(); const o = root.document.createElement('div'); o.className = 'mtv-overlay';
    o.innerHTML = '<div role="dialog" aria-modal="true"><div style="display:flex;justify-content:space-between;align-items:center"><b>Verhuizen naar het nieuwe adres</b><button class="mtv-knop" data-sluit="1">Sluiten</button></div><div data-plek="1"></div></div>';
    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-sluit]')) o.remove(); });
    root.document.body.appendChild(o); V.paneel(o.querySelector('[data-plek]'), ctx || V.ctx); return o;
  };
  // Alleen-lezen-balk op het oude adres zodra dit apparaat verhuisd is — met een eerlijke tekst en een opvallende knop.
  V.balk = function () {
    const v = V.verhuisd(); if (!v || !root.document || (root.location && root.location.origin === V.NIEUW_ADRES) || root.document.getElementById('mtv-balk')) return;
    V.css(); const b = root.document.createElement('div'); b.id = 'mtv-balk'; b.className = 'mtv-balk';
    b.innerHTML = `Dit apparaat is verhuisd naar <a href="${esc(V.NIEUW_ADRES)}">${esc(V.NIEUW_ADRES.replace('https://', ''))}</a> — werk daar verder. Er is niets gewist, maar wat je hier nog invoert gaat niet vanzelf mee. <button data-mtv-nieuw="1">Nieuw pakket maken</button>`;
    b.addEventListener('click', e => { if (e.target.closest('[data-mtv-nieuw]')) V.overlay(V.ctx); });
    root.document.body.insertBefore(b, root.document.body.firstChild);
  };

  // Oud adres: na een geslaagde verhuizing alleen nog lezen (balk). Er wordt niets gewist.
  V.markeerVerhuisd = (map, tellingen) => { try { ls().setItem('mt_verhuisd', JSON.stringify({ naar: V.NIEUW_ADRES, map, tellingen, t: Date.now() })); } catch (e) {} };
  V.verhuisd = () => { try { return JSON.parse(ls().getItem('mt_verhuisd') || 'null'); } catch (e) { return null; } };
})(typeof window !== 'undefined' ? window : globalThis);
