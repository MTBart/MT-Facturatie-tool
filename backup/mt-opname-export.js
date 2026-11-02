// mt-opname-export.js — volledige, herstelbare export van een opname (brok 3b, ChatGPT-review 043): de opname-JSON én alle foto's in één zip, en het terugzetten ervan.
// Voorwaarde vóór de beta: een opname staat nu alleen op één toestel (IndexedDB); zonder export is een verloren telefoon of een opgeruimde browseropslag het einde van het werk.
// Pure functies (Uint8Array in, Uint8Array uit), geen DOM, geen netwerk; node kan ze testen. Zip zonder compressie (foto's zijn al gecomprimeerd), UTF-8-namen; lezen kan ook deflate
// (via DecompressionStream), zodat een zip die met een ander programma is opgeslagen ook terug kan. Niets wordt overschreven: bestaat de opname al, dan komt het terugzetten als kopie.
(function (root) {
  'use strict';
  const E = root.MTOpnameExport = root.MTOpnameExport || {};
  const K = root.MTOpnameKern || (typeof require !== 'undefined' ? require('./mt-opname-kern.js') : null);
  E.FORMAAT = 'mt-opname-export'; E.FORMAAT_VERSIE = 1;
  const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
  const lijst = x => Array.isArray(x) ? x : [];

  // ── CRC32 en zip ──
  let TABEL = null;
  function crc32(b) {
    if (!TABEL) { TABEL = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABEL[n] = c >>> 0; } }
    let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = TABEL[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
  }
  E.crc32 = crc32;
  const u16 = (v, n) => { v.push(n & 255, (n >>> 8) & 255); }, u32 = (v, n) => { v.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); };
  // entries: [{ naam, data: Uint8Array }] -> { delen: [Uint8Array...], grootte } (de delen achter elkaar vormen de zip; in de browser: new Blob(delen))
  E.zipDelen = function (entries, datum) {
    const d = datum instanceof Date ? datum : new Date(), tijd = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dag = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const delen = [], centraal = []; let pos = 0;
    for (const e of entries) {
      const naam = enc.encode(e.naam), data = e.data, crc = crc32(data), kop = [];
      u32(kop, 0x04034b50); u16(kop, 20); u16(kop, 0x0800); u16(kop, 0); u16(kop, tijd); u16(kop, dag); u32(kop, crc); u32(kop, data.length); u32(kop, data.length); u16(kop, naam.length); u16(kop, 0);
      const kopB = Uint8Array.from(kop); delen.push(kopB, naam, data);
      const c = []; u32(c, 0x02014b50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, tijd); u16(c, dag); u32(c, crc); u32(c, data.length); u32(c, data.length); u16(c, naam.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, pos);
      centraal.push(Uint8Array.from(c), naam);
      pos += kopB.length + naam.length + data.length;
    }
    const cdGrootte = centraal.reduce((s, x) => s + x.length, 0), eind = []; u32(eind, 0x06054b50); u16(eind, 0); u16(eind, 0); u16(eind, entries.length); u16(eind, entries.length); u32(eind, cdGrootte); u32(eind, pos); u16(eind, 0);
    for (const x of centraal) delen.push(x); delen.push(Uint8Array.from(eind));
    return { delen, grootte: pos + cdGrootte + eind.length };
  };
  E.zipBytes = function (entries, datum) {
    const z = E.zipDelen(entries, datum), uit = new Uint8Array(z.grootte); let p = 0; for (const x of z.delen) { uit.set(x, p); p += x.length; } return uit;
  };
  async function inflateRaw(b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Deze browser kan geen gecomprimeerde zip lezen. Gebruik de zip die deze app zelf maakte.');
    const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  // -> [{ naam, data }] ; gooit een Error met een leesbare tekst bij een beschadigde zip
  E.leesZip = async function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Dit is geen zip-bestand (of het is afgebroken).');
    const n = dv.getUint16(eocd + 10, true), cdPos = dv.getUint32(eocd + 16, true), uit = [];
    let p = cdPos;
    for (let i = 0; i < n; i++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('De zip is beschadigd (inhoudsopgave klopt niet).');
      const methode = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), cs = dv.getUint32(p + 20, true), us = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const naam = dec.decode(bytes.subarray(p + 46, p + 46 + nl));
      if (lo + 30 > bytes.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error('De zip is beschadigd (bestand ' + naam + ').');
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      if (start + cs > bytes.length) throw new Error('De zip is afgebroken bij ' + naam + '.');
      let data = bytes.subarray(start, start + cs);
      if (methode === 8) data = await inflateRaw(data); else if (methode !== 0) throw new Error('Onbekende zip-compressie bij ' + naam + '.');
      if (data.length !== us || crc32(data) !== crc) throw new Error('Het bestand ' + naam + ' in de zip is beschadigd.');
      uit.push({ naam, data: Uint8Array.from(data) });
      p += 46 + nl + el + cl;
    }
    return uit;
  };

  // ── sha256 ──
  E.sha256 = async function (bytes) {
    const c = root.crypto || (typeof require !== 'undefined' ? require('crypto').webcrypto : null);
    if (!c || !c.subtle) return null;
    const h = new Uint8Array(await c.subtle.digest('SHA-256', bytes)); return Array.from(h).map(x => x.toString(16).padStart(2, '0')).join('');
  };

  // ── pakket maken en lezen ──
  const veilig = t => String(t || 'foto').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_');
  // rec: { id, opname, layout, instellingen }; fotoRecords: [{ id, blob/bytes (Uint8Array), naam, type, grootte, breedte, hoogte, tijd, ruimte, wand, soort, item }] (alle foto's van deze opname in de opslag, ook de gearchiveerde)
  E.maakPakket = async function (rec, fotoRecords, opties) {
    opties = opties || {};
    const o = rec.opname, verwijzingen = lijst(o.fotos).concat(lijst(o.fotos_verwijderd)), entries = [], fotoLijst = [], gebruikt = {};
    for (const f of lijst(fotoRecords)) {
      const korteId = String(f.id).indexOf(':') >= 0 ? String(f.id).split(':').slice(1).join(':') : String(f.id), vw = verwijzingen.find(v => v && v.id === korteId);
      let pad = 'fotos/' + veilig(vw && vw.bestand ? vw.bestand : 'los-' + korteId + '-' + (f.naam || 'foto'));
      while (gebruikt[pad]) pad = pad.replace(/(\.[a-z0-9]+)?$/i, '-' + korteId + '$1');
      gebruikt[pad] = true;
      const data = f.bytes || new Uint8Array(0);
      entries.push({ naam: pad, data });
      fotoLijst.push({ id: korteId, pad, grootte: data.length, sha256: await E.sha256(data), type: f.type || null, naam: f.naam || null, breedte: f.breedte || null, hoogte: f.hoogte || null, tijd: f.tijd || null, ruimte: f.ruimte || null, wand: f.wand || null, soort: f.soort || null, item: f.item || null, in_opname: !!vw && lijst(o.fotos).includes(vw), niet_in_verwijzingen: !vw });
    }
    const verwacht = lijst(o.fotos).filter(v => v && v.id), ontbrekend = verwacht.filter(v => !fotoLijst.some(x => x.id === v.id)).map(v => v.bestand || v.id);
    const manifest = { schema: E.FORMAAT, formaat: E.FORMAAT_VERSIE, gemaakt: opties.tijd || new Date().toISOString(), app: 'mt-opname-beta', kern_versie: K ? K.VERSIE : null, opname_id: o.opname_id, inhoudshash: K ? K.inhoudsHash(o) : null,
      opname: o, layout: rec.layout || {}, instellingen: rec.instellingen || {}, fotos: fotoLijst, fotos_ontbreken_in_opslag: ontbrekend };
    const json = enc.encode(JSON.stringify(manifest, null, 1));
    const leesmij = enc.encode('Export van een opname uit de MT tool (beta).\r\n\r\nopname.json  de volledige opname met layout en instellingen (en een lijst van alle foto\'s met sha256)\r\nfotos/       alle foto\'s, onveranderd (ook de foto\'s die uit de opname gehaald zijn)\r\n\r\nTerugzetten: Opname (beta) > Terugzetten uit een export. Er wordt niets overschreven; staat de opname al op het toestel, dan komt hij als kopie.\r\n');
    entries.unshift({ naam: 'opname.json', data: json }, { naam: 'LEESMIJ.txt', data: leesmij });
    return { entries, manifest, ontbrekend };
  };
  // Leest een zip en controleert hem: -> { fout, manifest, fotos: [{ meta, bytes }], meldingen }
  E.leesPakket = async function (bytes) {
    let items; try { items = await E.leesZip(bytes); } catch (e) { return { fout: e.message || String(e), manifest: null, fotos: [], meldingen: [] }; }
    const mf = items.find(x => x.naam === 'opname.json'); if (!mf) return { fout: 'Dit is geen opname-export: opname.json ontbreekt.', manifest: null, fotos: [], meldingen: [] };
    let manifest; try { manifest = JSON.parse(dec.decode(mf.data)); } catch (e) { return { fout: 'opname.json is geen geldige JSON.', manifest: null, fotos: [], meldingen: [] }; }
    if (!manifest || manifest.schema !== E.FORMAAT) return { fout: 'Dit is geen export van de opname-module.', manifest: null, fotos: [], meldingen: [] };
    if (manifest.formaat > E.FORMAAT_VERSIE) return { fout: 'Deze export komt uit een nieuwere versie van de app (formaat ' + manifest.formaat + ').', manifest, fotos: [], meldingen: [] };
    // De opname in de export moet kloppen met wat het manifest zegt: een opname-object, dezelfde id en een inhoudshash die opnieuw berekend gelijk is. Een export waarvan de JSON is aangepast
    // of beschadigd is (zip-CRC en foto-sha256 vangen dat niet af voor opname.json zelf) wordt geweigerd, zodat er geen verkeerde opname of vrijgave op het toestel komt.
    const o = manifest.opname;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { fout: 'De export is onbruikbaar: de opname zelf ontbreekt in opname.json. Er is niets teruggezet.', manifest, fotos: [], meldingen: [] };
    if (typeof manifest.opname_id !== 'string' || !manifest.opname_id || manifest.opname_id !== o.opname_id) return { fout: 'De export is niet in orde: het opname-nummer in de kop (' + manifest.opname_id + ') wijkt af van dat van de opname (' + o.opname_id + '). Er is niets teruggezet.', manifest, fotos: [], meldingen: [] };
    if (!K) return { fout: 'De inhoud van de export kan hier niet gecontroleerd worden. Er is niets teruggezet.', manifest, fotos: [], meldingen: [] };
    let hash; try { hash = K.inhoudsHash(o); } catch (e) { hash = null; }
    if (!manifest.inhoudshash || hash !== manifest.inhoudshash) return { fout: 'De export is beschadigd of aangepast: de inhoud van de opname klopt niet met de controlecode in de kop. Er is niets teruggezet.', manifest, fotos: [], meldingen: [] };
    const meldingen = [], fotos = [];
    for (const meta of lijst(manifest.fotos)) {
      const it = items.find(x => x.naam === meta.pad);
      if (!it) return { fout: 'In de zip ontbreekt de foto ' + meta.pad + '. Er is niets teruggezet.', manifest, fotos: [], meldingen };
      if (meta.sha256) { const h = await E.sha256(it.data); if (h && h !== meta.sha256) return { fout: 'De foto ' + meta.pad + ' is beschadigd (de controlesom klopt niet). Er is niets teruggezet.', manifest, fotos: [], meldingen }; }
      else meldingen.push('Geen controlesom voor ' + meta.pad + '.');
      fotos.push({ meta, bytes: it.data });
    }
    for (const naam of lijst(manifest.fotos_ontbreken_in_opslag)) meldingen.push('De export bevatte de foto ' + naam + ' al niet (ontbrak in de opslag van het toestel).');
    return { fout: null, manifest, fotos, meldingen };
  };
  // Wat er bij het terugzetten gebeurt, zonder iets te schrijven. bestaand: { id: opname-hash } van wat al op dit toestel staat.
  // Zelfde opname_id met dezelfde inhoud: niets te doen. Zelfde id met andere inhoud: komt als kopie met een nieuwe id (niets overschreven). Anders: terugzetten onder de eigen id.
  E.herstelPlan = function (pakket, bestaand, nu) {
    const m = pakket.manifest, id = m.opname_id, ander = bestaand && Object.prototype.hasOwnProperty.call(bestaand, id);
    if (ander && bestaand[id] === m.inhoudshash) return { actie: 'staat-al-op-toestel', opname_id: id, kopie: false };
    const nieuweId = ander ? id + '-hersteld-' + (nu || Date.now()).toString(36) : id;
    const opname = JSON.parse(JSON.stringify(m.opname)); opname.opname_id = nieuweId;
    if (ander) {
      opname._hersteld_van = { opname_id: id, export_gemaakt: m.gemaakt };
      // De vrijgave hoort bij de inhoud mét de oorspronkelijke id (de id telt mee in de inhoudshash). Een kopie heeft een nieuwe id, dus de vrijgave zou onverklaard "vervallen" lijken.
      // Eenvoudigste eerlijke variant: de kopie wordt expliciet "opgeslagen", de oude vrijgave wordt weggehaald en staat met reden en de gegevens ervan in _hersteld_van.vrijgave_vervallen.
      if (opname.status === 'vrijgegeven' || opname.vrijgave) {
        const v = opname.vrijgave && typeof opname.vrijgave === 'object' ? opname.vrijgave : {};
        opname._hersteld_van.vrijgave_vervallen = { reden: 'vrijgave vervallen: geïmporteerd als kopie van ' + id, tijd: new Date(nu || Date.now()).toISOString(), oude_vrijgave: { tijd: v.tijd || null, door: v.door || null, hash: v.hash || null, kern: v.kern || null } };
        opname.status = 'opgeslagen'; delete opname.vrijgave;
      }
    }
    const fotoRecords = pakket.fotos.map(f => ({ id: nieuweId + ':' + f.meta.id, opnameId: nieuweId, bytes: f.bytes, naam: f.meta.naam, type: f.meta.type || 'image/jpeg', grootte: f.meta.grootte, breedte: f.meta.breedte, hoogte: f.meta.hoogte, tijd: f.meta.tijd, ruimte: f.meta.ruimte, wand: f.meta.wand, soort: f.meta.soort, item: f.meta.item }));
    return { actie: ander ? 'kopie' : 'terugzetten', opname_id: nieuweId, kopie: !!ander, record: { id: nieuweId, opname, layout: JSON.parse(JSON.stringify(m.layout || {})), instellingen: JSON.parse(JSON.stringify(m.instellingen || {})) }, fotoRecords };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : globalThis);
