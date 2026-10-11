// mt-verhuis.js — verhuisknop (F5 stap 2): de lokale gegevens van dít apparaat van het oude adres naar het nieuwe.
// Browseropslag is per adres; wat al in SharePoint staat komt na inloggen vanzelf terug. Dit pakt de rest in:
// alle mt*-sleutels uit localStorage (behalve tokens: opnieuw inloggen/koppelen) en de IndexedDB's 'mt-rapporten'
// (foto's + rapportconcepten) en 'mt-app' (losse opname), met aantallen en een SHA-256 per foto en per onderdeel.
// Het pakket gaat naar SharePoint (MT-Bedrijfstool/_verhuizing/<gebruiker>/<apparaat>-<tijd>/: eerst de foto's, als
// laatste pakket.json) en kan als vangnet ook gedownload worden. Het nieuwe adres importeert na inloggen: alleen wat
// er daar nog NIET is (nooit overschrijven), controleert elke checksum en meldt "x foto's, y concepten overgezet".
// Er wordt op het oude adres nooit iets gewist; na een geslaagde verhuizing toont het een alleen-lezen-balk.
// UIT tot het domein gekoppeld is: alleen aan met de proefvlag localStorage mt_verhuis_proef = '1' (per apparaat).
(function (root) {
  'use strict';
  const V = root.MTVerhuis = root.MTVerhuis || {};
  V.VERSIE = 1;
  V.NIEUW_ADRES = 'https://tool.mortiseandtenon.nl';
  V.MAP = '_verhuizing';
  V.DBS = [{ naam: 'mt-rapporten', stores: ['fotos', 'drafts'] }, { naam: 'mt-app', stores: ['drafts'] }];
  const ls = () => { try { return root.localStorage; } catch (e) { return null; } };
  V.aan = () => { try { return ls().getItem('mt_verhuis_proef') === '1'; } catch (e) { return false; } };
  // Tokens en sleutels gaan nooit mee; de verhuis-administratie zelf ook niet.
  const NIET_MEE = /token|msal|secret|wachtwoord|password|api[_-]?key|credential/i;
  V.sleutelMee = k => /^mt/.test(k) && !NIET_MEE.test(k) && !/^mt_verhuis/.test(k) && k !== 'mt_verhuisd';

  // ── Adapters (vervangbaar in tests) ──
  // IndexedDB: lijst(db, store) → [{key, value}]; heeft(db, store, key); zet(db, store, key, value).
  // Lezen maakt NOOIT een database aan: bestaat hij nog niet, dan wordt de upgrade afgebroken (= leeg). Anders zou
  // hier een lege versie 1 ontstaan en maakt mt-fotostore (open met versie 1) zijn stores daarna nooit meer aan.
  // Schrijven maakt een ontbrekende database aan met versie 1 en álle stores die de app zelf ook aanmaakt.
  const idbOpen = (naam, maak) => new Promise((res, rej) => {
    let r; try { r = maak ? root.indexedDB.open(naam, 1) : root.indexedDB.open(naam); } catch (e) { return rej(e); }
    r.onupgradeneeded = e => {
      if (!maak) { e.target.transaction.abort(); return; }
      const def = V.DBS.find(x => x.naam === naam); for (const st of (def ? def.stores : [])) if (!r.result.objectStoreNames.contains(st)) r.result.createObjectStore(st);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = e => { if (!maak && r.error && r.error.name === 'AbortError') { if (e && e.preventDefault) e.preventDefault(); res(null); } else rej(r.error); };
  });
  V.idb = {
    async lijst(db, store) {
      const d = await idbOpen(db, false); if (!d) return []; if (!d.objectStoreNames.contains(store)) { d.close(); return []; }
      return await new Promise((res, rej) => { const uit = [], tx = d.transaction(store, 'readonly'), c = tx.objectStore(store).openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { uit.push({ key: cur.key, value: cur.value }); cur.continue(); } };
        tx.oncomplete = () => { d.close(); res(uit); }; tx.onerror = () => { d.close(); rej(tx.error); }; });
    },
    async heeft(db, store, key) {
      const d = await idbOpen(db, false); if (!d) return false; if (!d.objectStoreNames.contains(store)) { d.close(); return false; }
      return await new Promise((res, rej) => { const tx = d.transaction(store, 'readonly'), r = tx.objectStore(store).count(key); tx.oncomplete = () => { d.close(); res(r.result > 0); }; tx.onerror = () => { d.close(); rej(tx.error); }; });
    },
    async zet(db, store, key, value) {
      let d = await idbOpen(db, false); if (!d) d = await idbOpen(db, true);
      if (!d.objectStoreNames.contains(store)) {          // (zeldzaam) db bestaat, store niet: met een versie hoger aanmaken
        const v = d.version + 1; d.close();
        d = await new Promise((res, rej) => { const r = root.indexedDB.open(db, v); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      }
      await new Promise((res, rej) => { const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = () => { d.close(); res(); }; tx.onerror = () => { d.close(); rej(tx.error); }; });
    },
  };
  // SharePoint via de bestaande Graph-login (MTCore): upload(pad, inhoud), lees(pad) → Blob/null, lijst(map) → [namen].
  const KLEIN = 3.5 * 1024 * 1024, BROK = 16 * 327680;   // grote bestanden via een uploadsessie, in brokken van 5 MiB
  V.sp = {
    async _basis() {
      const token = await root.getGraphToken(); if (!token) throw new Error('geen Graph-token (opnieuw inloggen)');
      if (!V.sp._site) { const r = await fetch('https://graph.microsoft.com/v1.0/sites/mortisetenon.sharepoint.com:/sites/MortiseTenon', { headers: { Authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('site HTTP ' + r.status); V.sp._site = (await r.json()).id; }
      return { base: `https://graph.microsoft.com/v1.0/sites/${V.sp._site}/drive/root:/MT-Bedrijfstool/`, token };
    },
    async upload(pad, inhoud) {
      const { base, token } = await V.sp._basis(), blob = inhoud instanceof Blob ? inhoud : new Blob([inhoud], { type: 'application/json' }), url = base + root._encPath(pad);
      if (blob.size <= KLEIN) { const r = await fetch(url + ':/content', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }); if (!r.ok) throw new Error(`upload ${pad}: HTTP ${r.status}`); return; }
      const s = await fetch(url + ':/createUploadSession', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }) });
      if (!s.ok) throw new Error(`uploadsessie ${pad}: HTTP ${s.status}`);
      const sessie = (await s.json()).uploadUrl;
      for (let van = 0; van < blob.size; van += BROK) {
        const tot = Math.min(blob.size, van + BROK), r = await fetch(sessie, { method: 'PUT', headers: { 'Content-Range': `bytes ${van}-${tot - 1}/${blob.size}` }, body: blob.slice(van, tot) });
        if (!r.ok && r.status !== 202) throw new Error(`upload ${pad} (${van}): HTTP ${r.status}`);
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

  // ── Wat staat er op dit apparaat? (de verhuispagina) ──
  V.inventaris = async function () {
    const s = ls(), keys = []; for (let i = 0; s && i < s.length; i++) keys.push(s.key(i));
    const get = k => { try { return JSON.parse(s.getItem(k) || 'null'); } catch (e) { return null; } };
    const uit = { sleutels: keys.filter(V.sleutelMee).length, nietMee: keys.filter(k => /^mt/.test(k) && !V.sleutelMee(k)).length, wachtrij: (get('mt_retry_queue') || []).length || 0,
      timer: !!s && !!s.getItem('mt_timer'), concepten: keys.filter(k => /^mt_rapdraft_/.test(k)).length, agendaBlokken: (get('mt_agenda_blocks') || []).length || 0, fotos: { totaal: 0, lokaal: 0, wacht: 0, fout: 0, sync: 0 }, idbConcepten: 0, fouten: [] };
    for (const db of V.DBS) for (const st of db.stores) {
      try { const recs = await V.idb.lijst(db.naam, st);
        if (db.naam === 'mt-rapporten' && st === 'fotos') for (const r of recs) { uit.fotos.totaal++; const x = r.value && r.value.status; if (x in uit.fotos) uit.fotos[x]++; }
        else uit.idbConcepten += recs.length;
      } catch (e) { uit.fouten.push(`${db.naam}/${st}: ${e.message || e}`); }
    }
    uit.nogTeVersturen = uit.wachtrij + uit.fotos.lokaal + uit.fotos.wacht + uit.fotos.fout;
    return uit;
  };

  // ── Pakket maken ──
  V.maakPakket = async function (meta) {
    const s = ls(), keys = []; for (let i = 0; s && i < s.length; i++) keys.push(s.key(i));
    const lsDeel = {}; for (const k of keys.filter(V.sleutelMee).sort()) lsDeel[k] = s.getItem(k);
    const blobs = [], idb = {};
    for (const db of V.DBS) { idb[db.naam] = {}; for (const st of db.stores) { const recs = await V.idb.lijst(db.naam, st); idb[db.naam][st] = recs.map(r => ({ key: r.key, value: haalBlobs(r.value, blobs) })); } }
    const blobInfo = [];
    for (const b of blobs) blobInfo.push({ id: b.id, grootte: b.blob.size, mime: b.blob.type || '', sha256: await V.hash(b.blob) });
    const tel = { sleutels: Object.keys(lsDeel).length, fotos: (idb['mt-rapporten'].fotos || []).length, concepten: Object.keys(lsDeel).filter(k => /^mt_rapdraft_/.test(k)).length + (idb['mt-rapporten'].drafts || []).length + (idb['mt-app'].drafts || []).length, blobs: blobs.length };
    const pakket = { soort: 'mt-verhuispakket', versie: V.VERSIE, gemaakt: new Date().toISOString(), bron: (root.location && root.location.origin) || '', apparaat: (meta && meta.apparaat) || '', gebruiker: (meta && meta.gebruiker) || '',
      tellingen: tel, localStorage: lsDeel, idb, blobs: blobInfo };
    pakket.sha256 = { localStorage: await V.hash(JSON.stringify(lsDeel)), idb: await V.hash(JSON.stringify(idb)) };
    return { pakket, blobs };
  };
  const stuk = s => String(s || '').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'onbekend';
  V.pad = (gebruiker, apparaat, tijd) => `${V.MAP}/${stuk(String(gebruiker || '').split('@')[0])}/${stuk(apparaat)}-${String(tijd).replace(/[:.]/g, '-').slice(0, 19)}`;
  // Naar SharePoint: eerst alle foto's, dan pakket.json (dat bestand = "pakket compleet"). Geeft het pad terug.
  V.naarSharePoint = async function (r, opt) {
    const map = V.pad(r.pakket.gebruiker, r.pakket.apparaat, r.pakket.gemaakt), voortgang = (opt && opt.voortgang) || (() => {});
    let n = 0; for (const b of r.blobs) { await V.sp.upload(`${map}/blobs/${b.id}`, b.blob); voortgang(++n, r.blobs.length); }
    await V.sp.upload(`${map}/pakket.json`, JSON.stringify(r.pakket));
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

  // ── Importeren op het nieuwe adres ──
  // pakket = pakket.json (object); blobVan(id) → Blob (SharePoint of uit het downloadbestand). Nooit overschrijven.
  V.importeer = async function (pakket, blobVan) {
    if (!pakket || pakket.soort !== 'mt-verhuispakket' || pakket.versie !== V.VERSIE) throw new Error('geen (bekend) verhuispakket');
    if (await V.hash(JSON.stringify(pakket.localStorage)) !== pakket.sha256.localStorage || await V.hash(JSON.stringify(pakket.idb)) !== pakket.sha256.idb) throw new Error('checksum van het pakket klopt niet: niets geïmporteerd');
    const perId = {};
    for (const b of pakket.blobs || []) {                 // eerst álle foto's ophalen en controleren — pas daarna iets schrijven
      const blob = await blobVan(b.id); if (!blob) throw new Error(`foto ${b.id} ontbreekt: niets geïmporteerd`);
      if (blob.size !== b.grootte || await V.hash(blob) !== b.sha256) throw new Error(`foto ${b.id}: checksum klopt niet: niets geïmporteerd`);
      perId[b.id] = blob.type || !b.mime ? blob : new Blob([blob], { type: b.mime });
    }
    const s = ls(), uit = { sleutels: 0, sleutelsAlAanwezig: [], fotos: 0, fotosAlAanwezig: 0, concepten: 0, conceptenAlAanwezig: 0 };
    for (const [k, v] of Object.entries(pakket.localStorage || {})) {
      if (!V.sleutelMee(k)) continue;
      if (s.getItem(k) != null) { uit.sleutelsAlAanwezig.push(k); continue; }   // al hier (bv. uit SharePoint): niet overschrijven
      s.setItem(k, v); uit.sleutels++; if (/^mt_rapdraft_/.test(k)) uit.concepten++;
    }
    for (const db of V.DBS) for (const st of db.stores) for (const r of ((pakket.idb || {})[db.naam] || {})[st] || []) {
      const foto = db.naam === 'mt-rapporten' && st === 'fotos';
      if (await V.idb.heeft(db.naam, st, r.key)) { foto ? uit.fotosAlAanwezig++ : uit.conceptenAlAanwezig++; continue; }
      await V.idb.zet(db.naam, st, r.key, zetBlobs(r.value, perId)); foto ? uit.fotos++ : uit.concepten++;
    }
    try { s.setItem('mt_verhuis_import:' + pakket.gemaakt, JSON.stringify({ t: Date.now(), bron: pakket.bron, uit: Object.assign({}, uit, { sleutelsAlAanwezig: uit.sleutelsAlAanwezig.length }) })); } catch (e) {}
    return uit;
  };
  V.importeerVanSharePoint = async function (map) {
    const p = await V.sp.lees(`${map}/pakket.json`); if (!p) throw new Error('pakket.json niet gevonden (nog niet compleet?)');
    const pakket = JSON.parse(await p.text());
    return await V.importeer(pakket, id => V.sp.lees(`${map}/blobs/${id}`));
  };
  V.importeerDownload = async function (bestand) {
    const pakket = JSON.parse(await bestand.text()), data = pakket.blobData || {}; delete pakket.blobData;
    const blob = id => { const b = data[id]; if (b == null) return null; const bin = root.atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const info = (pakket.blobs || []).find(x => x.id === id); return new Blob([u], { type: (info && info.mime) || '' }); };
    return await V.importeer(pakket, async id => blob(id));
  };
  V.pakketten = async gebruiker => { const map = `${V.MAP}/${stuk(String(gebruiker || '').split('@')[0])}`; return (await V.sp.lijst(map)).sort().reverse().map(n => `${map}/${n}`); };

  // ── Weergave: verhuispaneel (oud én nieuw adres) ──
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = n => (n / 1048576).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) + ' MB';
  // ctx: { gebruiker, apparaat, toast(t) }
  V.paneel = async function (el, ctx) {
    ctx = ctx || {}; const toast = ctx.toast || (() => {});
    el.innerHTML = '<div class="mtv-melding">Inventaris van dit apparaat…</div>';
    let inv; try { inv = await V.inventaris(); } catch (e) { el.innerHTML = `<div class="mtv-melding">Inventaris mislukt: ${esc(e.message)}</div>`; return; }
    const nieuw = root.location && root.location.origin === V.NIEUW_ADRES, al = V.verhuisd();
    const waarsch = [inv.timer ? 'Er loopt een timer: stop die eerst (Toggl is de bron; de timer gaat niet mee).' : '',
      inv.nogTeVersturen ? `Nog niet verstuurd: ${inv.wachtrij} in de wachtrij, ${inv.fotos.lokaal + inv.fotos.wacht + inv.fotos.fout} foto's. Ga eerst online zodat het zelf verstuurt; wat overblijft gaat mee in het pakket.` : '',
      inv.fouten.length ? 'Niet alles leesbaar: ' + inv.fouten.join('; ') : ''].filter(Boolean);
    el.innerHTML = `<div class="mtv">
      <p><b>Op dit apparaat:</b> ${inv.sleutels} instellingen/lokale gegevens, ${inv.fotos.totaal} foto's (${inv.fotos.sync} al op SharePoint), ${inv.concepten + inv.idbConcepten} concepten, ${inv.agendaBlokken} eigen agendablokken, ${inv.wachtrij} in de wachtrij. Tokens gaan niet mee (${inv.nietMee}): op het nieuwe adres log je opnieuw in en koppel je Toggl opnieuw.</p>
      ${waarsch.map(w => `<div class="mtv-let">${esc(w)}</div>`).join('')}
      ${al ? `<div class="mtv-let">Dit apparaat is al verhuisd (${esc(new Date(al.t).toLocaleString('nl-NL'))}). Er is niets gewist; je kunt het pakket opnieuw maken.</div>` : ''}
      ${nieuw ? '' : `<div class="mtv-rij"><button class="mtv-knop aan" data-v="maak">Verhuispakket maken (naar SharePoint)</button></div>`}
      <div class="mtv-uit" data-v="uit"></div>
      <hr><p><b>Op het nieuwe adres:</b> pakket ophalen en importeren. Er wordt niets overschreven wat er al staat.</p>
      <div class="mtv-rij"><button class="mtv-knop" data-v="lijst">Mijn verhuispakketten zoeken</button><label class="mtv-knop">Bestand importeren (vangnet)<input type="file" accept="application/json" data-v="bestand" hidden></label></div>
      <div class="mtv-uit" data-v="pakketten"></div></div>`;
    const uit = el.querySelector('[data-v="uit"]'), lijst = el.querySelector('[data-v="pakketten"]');
    const toon = (doel, html) => { doel.innerHTML = html; };
    const resultaat = u => `<div class="mtv-ok">Overgezet: ${u.fotos} foto's, ${u.concepten} concepten, ${u.sleutels} lokale gegevens.${u.sleutelsAlAanwezig.length || u.fotosAlAanwezig || u.conceptenAlAanwezig ? ` Al aanwezig en dus overgeslagen: ${u.sleutelsAlAanwezig.length} gegevens, ${u.fotosAlAanwezig} foto's, ${u.conceptenAlAanwezig} concepten.` : ''}</div>`;
    let laatste = null;
    el.addEventListener('click', async e => {
      const k = e.target.closest('[data-v]'); if (!k || k.tagName === 'INPUT') return;
      const w = k.dataset.v;
      if (w === 'maak') {
        k.disabled = true; toon(uit, 'Pakket maken…');
        try {
          laatste = await V.maakPakket({ gebruiker: ctx.gebruiker, apparaat: ctx.apparaat });
          const grootte = laatste.blobs.reduce((a, b) => a + b.blob.size, 0);
          const map = await V.naarSharePoint(laatste, { voortgang: (n, t) => toon(uit, `Foto's naar SharePoint: ${n} van ${t}…`) });
          toon(uit, `<div class="mtv-ok">Pakket staat op SharePoint (${esc(map)}): ${laatste.pakket.tellingen.sleutels} gegevens, ${laatste.pakket.tellingen.fotos} foto's, ${laatste.pakket.tellingen.concepten} concepten (${mb(grootte)}), met checksums.</div>
            <div class="mtv-rij"><button class="mtv-knop" data-v="download">Ook downloaden (vangnet)</button><button class="mtv-knop" data-v="klaar">Dit apparaat is verhuisd</button></div>`);
          laatste.map = map;
        } catch (er) { toon(uit, `<div class="mtv-let">Niet gelukt: ${esc(er.message)}. Er is niets gewist; probeer opnieuw of gebruik de download.</div><div class="mtv-rij"><button class="mtv-knop" data-v="download">Downloaden (vangnet)</button></div>`); }
        k.disabled = false;
      } else if (w === 'download') {
        try { if (!laatste) laatste = await V.maakPakket({ gebruiker: ctx.gebruiker, apparaat: ctx.apparaat }); await V.download(laatste); toast('Verhuispakket gedownload'); }
        catch (er) { toast('Downloaden mislukt: ' + er.message); }
      } else if (w === 'klaar') {
        V.markeerVerhuisd(laatste && laatste.map, laatste && laatste.pakket.tellingen); V.balk(); toast('Gemarkeerd als verhuisd — er is niets gewist');
      } else if (w === 'lijst') {
        toon(lijst, 'Zoeken…');
        try { const ps = await V.pakketten(ctx.gebruiker); toon(lijst, ps.length ? ps.map(p => `<div class="mtv-rij"><span>${esc(p.split('/').pop())}</span><button class="mtv-knop" data-v="import" data-map="${esc(p)}">Importeren</button></div>`).join('') : 'Geen pakketten gevonden.'); }
        catch (er) { toon(lijst, `<div class="mtv-let">Zoeken mislukt: ${esc(er.message)}</div>`); }
      } else if (w === 'import') {
        k.disabled = true;
        try { toon(lijst, resultaat(await V.importeerVanSharePoint(k.dataset.map))); } catch (er) { toon(lijst, `<div class="mtv-let">Niet geïmporteerd: ${esc(er.message)}</div>`); }
      }
    });
    el.querySelector('[data-v="bestand"]').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { toon(lijst, resultaat(await V.importeerDownload(f))); } catch (er) { toon(lijst, `<div class="mtv-let">Niet geïmporteerd: ${esc(er.message)}</div>`); }
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
.mtv-balk a{color:#fff}`;
    root.document.head.appendChild(s);
  };
  V.overlay = function (ctx) {
    V.css(); const o = root.document.createElement('div'); o.className = 'mtv-overlay';
    o.innerHTML = '<div role="dialog" aria-modal="true"><div style="display:flex;justify-content:space-between;align-items:center"><b>Verhuizen naar het nieuwe adres</b><button class="mtv-knop" data-sluit="1">Sluiten</button></div><div data-plek="1"></div></div>';
    o.addEventListener('click', e => { if (e.target === o || e.target.closest('[data-sluit]')) o.remove(); });
    root.document.body.appendChild(o); V.paneel(o.querySelector('[data-plek]'), ctx); return o;
  };
  // Alleen-lezen-balk op het oude adres zodra dit apparaat verhuisd is.
  V.balk = function () {
    const v = V.verhuisd(); if (!v || !root.document || (root.location && root.location.origin === V.NIEUW_ADRES) || root.document.getElementById('mtv-balk')) return;
    V.css(); const b = root.document.createElement('div'); b.id = 'mtv-balk'; b.className = 'mtv-balk';
    b.innerHTML = `Dit apparaat is verhuisd naar <a href="${esc(V.NIEUW_ADRES)}">${esc(V.NIEUW_ADRES.replace('https://', ''))}</a> — werk daar verder. Hier alleen nog terugkijken (er is niets gewist).`;
    root.document.body.insertBefore(b, root.document.body.firstChild);
  };

  // Oud adres: na een geslaagde verhuizing alleen nog lezen (balk). Er wordt niets gewist.
  V.markeerVerhuisd = (map, tellingen) => { try { ls().setItem('mt_verhuisd', JSON.stringify({ naar: V.NIEUW_ADRES, map, tellingen, t: Date.now() })); } catch (e) {} };
  V.verhuisd = () => { try { return JSON.parse(ls().getItem('mt_verhuisd') || 'null'); } catch (e) { return null; } };
})(typeof window !== 'undefined' ? window : globalThis);
