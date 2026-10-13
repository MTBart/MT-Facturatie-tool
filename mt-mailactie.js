/* ============================================================================
 * mt-mailactie.js — gedeelde, pure regels voor mail-acties (Outlook-paneel én cockpit). Geen DOM, geen opslag, geen netwerk.
 * ----------------------------------------------------------------------------
 *  - Bijlagen → projectmap: de submappen en het voorstel per bijlage (dezelfde regels als de inbox, mt-inbox.js).
 *  - "Pak op" (wie pakt een gesprek uit info@ op): het record per gesprek, de samenvoeger voor SharePoint, de Outlook-categorie.
 *  - "Binnenkomend": de status per gesprek in info@ — Nieuw → Opgepakt door X → Lead/project gekoppeld → Afgehandeld (met reden).
 *  - De projecttag "[260812]" in het onderwerp (antwoord als info@, de mailstroomregel, de cc-regel).
 *  - "Maak lead van deze mail": het voorstel (contact uit de afzender, titel uit het onderwerp).
 *  - Projectgegevens voor het paneel: nummer, fase, contact en adres met een navigatielink.
 * Opslag "Pak op": mt_mail_oppak.json in de privé SharePoint-map (nooit in de repo). Per gesprek alleen: postbus, gesprek-id,
 * status, wie (e-mail en naam), wanneer, reden en de gekoppelde projectcodes. Geen onderwerp, afzender of mailtekst.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root) return;

  // ── bijlagen ──
  const SUBMAPPEN = ['01_Offerte', '02_Ontwerp', '03_Vectorworks', '04_Holzher', '05_Aangeleverd',
    '06_Fotos', '07_Administratie', '08_Archief', '09_Werktekeningen', '10_CNC'];
  // Voorstel op bestandstype en naam. Bij twijfel: 05_Aangeleverd.
  function submapVoorstel(naam, type) {
    const n = String(naam || '').toLowerCase(), ext = (n.match(/\.([a-z0-9]+)$/) || [])[1] || '', t = String(type || '').toLowerCase();
    if (/^(vwx|vwxp|vwxw|mcd)$/.test(ext)) return '03_Vectorworks';
    if (/^(hop|hops|hhos)$/.test(ext)) return '04_Holzher';
    if (/^(ncr|mpr|mprx|pgmx|nc|cnc|xcs|bpp)$/.test(ext)) return '10_CNC';
    if (/offerte|prijsopgave|quotation|\bquote\b|aanbieding/.test(n)) return '01_Offerte';
    if (/factuur|invoice|pakbon|orderbevestiging|order confirmation|bestelbevestiging/.test(n)) return '07_Administratie';
    if (/werktekening|productietekening|shop ?drawing/.test(n)) return '09_Werktekeningen';
    if (/schets|ontwerp|render|impressie|moodboard|sketch/.test(n) || /^(skp|3dm)$/.test(ext)) return '02_Ontwerp';
    if (/^image\//.test(t) || /^(jpe?g|png|heic|heif|webp|gif|tiff?)$/.test(ext)) return '06_Fotos';
    return '05_Aangeleverd';
  }
  // Alleen echte bestanden (geen ingesloten logo's, doorgestuurde mails of OneDrive-links).
  const isBestand = x => !!x && !x.isInline && !/itemAttachment|referenceAttachment/.test(String(x['@odata.type'] || ''));
  // Samenvoeger voor mt_bijlage_index.json (gelijk aan die in v2.html): per id wint de nieuwste `tijd`.
  function bijlageIndexSamen(lokaal, spData) {
    const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
    const L = Array.isArray(lees(lokaal)) ? lees(lokaal) : [], R = Array.isArray(lees(spData)) ? lees(spData) : [];
    const per = new Map();
    [...R, ...L].forEach(x => { if (!x || !x.id) return; const o = per.get(x.id); if (!o || String(x.tijd || '') >= String(o.tijd || '')) per.set(x.id, x); });
    return [...per.values()];
  }
  // Bestandsnaam zoals de cockpit hem opslaat (geen \ / : * ? " < > |, geen punt of spatie aan het eind).
  const veiligeNaam = naam => String(naam || 'bijlage').replace(/[\\/:*?"<>|]/g, '_').trim().replace(/[. ]+$/, '') || 'bijlage';

  // ── "Pak op" ──
  const OPPAK_STATUS = ['opgepakt', 'afgehandeld', 'vrij'];
  const AFHANDEL_REDENEN = [['beantwoord', 'Beantwoord'], ['geen_actie', 'Geen actie nodig'], ['doorgestuurd', 'Doorgestuurd'],
    ['leverancier', 'Leverancier of administratie'], ['spam', 'Reclame of spam'], ['anders', 'Anders']];
  const CATEGORIE_PREFIX = 'Opgepakt: ';
  const oppakSleutel = (mbx, conversationId) => (conversationId ? String(mbx || '').toLowerCase() + '|' + conversationId : '');
  // Weergavenaam: de naam uit het profiel, anders het deel vóór de @ met een hoofdletter.
  function naamVan(email, weergave) {
    const w = String(weergave || '').trim();
    if (w) return w.slice(0, 60);
    const l = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
    return l ? l.charAt(0).toUpperCase() + l.slice(1, 60) : '';
  }
  const categorie = naam => CATEGORIE_PREFIX + String(naam || '').replace(/[,;]/g, ' ').trim().slice(0, 60);
  const isOppakCategorie = c => typeof c === 'string' && c.indexOf(CATEGORIE_PREFIX) === 0;
  // Nieuwe categorielijst: alle bestaande behalve een andere "Opgepakt: …", plus de nieuwe (of zonder bij vrijgeven).
  function categorieenNa(bestaand, naam) {
    const rest = (Array.isArray(bestaand) ? bestaand : []).filter(c => !isOppakCategorie(c));
    return naam ? rest.concat([categorie(naam)]) : rest;
  }
  // Eén record per gesprek. status: opgepakt | afgehandeld (met reden) | vrij (teruggezet).
  function oppakRecord(oud, o, nu) {
    if (!OPPAK_STATUS.includes(o.status)) throw new Error('onbekende status');
    if (o.status === 'afgehandeld' && !AFHANDEL_REDENEN.some(r => r[0] === o.reden)) throw new Error('kies een reden');
    const t = Math.max(Number(nu) || Date.now(), (Number(oud && oud.gewijzigd) || 0) + 1);
    return {
      mbx: String(o.mbx || (oud && oud.mbx) || '').toLowerCase(), conversationId: o.conversationId || (oud && oud.conversationId) || '',
      status: o.status, door: String(o.door || '').toLowerCase(), naam: String(o.naam || '').slice(0, 60),
      tijd: new Date(t).toISOString(), gewijzigd: t,
      reden: o.status === 'afgehandeld' ? o.reden : '', toelichting: o.status === 'afgehandeld' ? String(o.toelichting || '').slice(0, 200) : '',
      codes: Array.isArray(o.codes) ? o.codes.filter(Boolean).map(String).slice(0, 10) : ((oud && oud.codes) || []),
      // wie het eerst oppakte blijft zichtbaar bij afhandelen door een ander
      opgepakt_door: o.status === 'opgepakt' ? String(o.door || '').toLowerCase() : ((oud && oud.opgepakt_door) || ''),
      opgepakt_naam: o.status === 'opgepakt' ? String(o.naam || '').slice(0, 60) : ((oud && oud.opgepakt_naam) || ''),
      opgepakt_tijd: o.status === 'opgepakt' ? new Date(t).toISOString() : ((oud && oud.opgepakt_tijd) || '')
    };
  }
  // Samenvoeger voor mt_mail_oppak.json ({sleutel: record}): per gesprek wint de nieuwste `gewijzigd`; gelijk → lokaal. Niets valt weg.
  function oppakSamen(lokaal, spData) {
    const lees = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } };
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    const L = isObj(lees(lokaal)) ? lees(lokaal) : {}, R = isObj(lees(spData)) ? lees(spData) : {};
    const uit = {};
    for (const k of new Set([...Object.keys(R), ...Object.keys(L)])) {
      const l = L[k], r = R[k];
      if (!isObj(l)) { uit[k] = r; continue; }
      if (!isObj(r)) { uit[k] = l; continue; }
      uit[k] = (Number(l.gewijzigd) || 0) >= (Number(r.gewijzigd) || 0) ? l : r;
    }
    return uit;
  }

  // ── projecttag ──
  const NR_RE = /^\d{6}$/;
  const tag = nr => (NR_RE.test(String(nr || '')) ? '[' + nr + ']' : '');
  // Het eerste projectnummer tussen [ ] in een onderwerp (de vorm van de mailstroomregel: "[26" + 4 cijfers + "]").
  function tagUitOnderwerp(onderwerp) { const m = /\[\s*(26\d{4})\s*\]/.exec(String(onderwerp || '')); return m ? m[1] : ''; }
  // Tag achteraan toevoegen, alleen als hij er nog niet staat; zonder geldig nummer blijft het onderwerp gelijk.
  function onderwerpMetTag(onderwerp, nr) {
    const s = String(onderwerp || '').trim(), t = tag(nr);
    if (!t || new RegExp('\\[\\s*' + nr + '\\s*\\]').test(s)) return s;
    return (s ? s + ' ' : '') + t;
  }
  // Het projectnummer van een project (alleen 6 cijfers; een oude code is geen tag).
  const nummerVan = (p, nummerFn) => { const n = p && (typeof nummerFn === 'function' ? nummerFn(p) : (p.projectnummer || p.code)); return NR_RE.test(String(n || '')) ? String(n) : ''; };

  // ── cc-regel (antwoord op een gekoppeld gesprek → info@ in cc) ──
  // nodig = het is een antwoord (gesprek-id), het onderwerp draagt een projecttag, info@ staat nog niet in aan/cc/bcc, en je schrijft niet zelf als info@.
  function ccInfoNodig(o) {
    o = o || {};
    const info = String(o.info || '').toLowerCase();
    if (!info || !o.conversationId || !tagUitOnderwerp(o.onderwerp)) return false;
    const adressen = [].concat(o.aan || [], o.cc || [], o.bcc || []).map(x => String((x && (x.emailAddress || x.address)) || x || '').toLowerCase());
    if (adressen.includes(info)) return false;
    if (String(o.van || '').toLowerCase() === info) return false;
    return true;
  }

  // ── lead uit een mail ──
  // Onderwerp zonder "RE:", "FW:", "Antw:", "Doorst:" en zonder [tags]; hooguit 80 tekens.
  function schoonOnderwerp(s) {
    let t = String(s || '');
    for (let i = 0; i < 6; i++) { const n = t.replace(/^\s*(re|fw|fwd|aw|antw|antwoord|doorst|wg|tr)\s*(\[\d+\])?\s*:\s*/i, ''); if (n === t) break; t = n; }
    return t.replace(/\[[^\]]{1,20}\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  // Voorstel uit de afzender en het onderwerp. `msg` = Graph-bericht.
  function leadVoorstel(msg) {
    const e = (msg && msg.from && msg.from.emailAddress) || {};
    const adres = String(e.address || '').toLowerCase(), naam = String(e.name || '').trim();
    return { klant_naam: (naam && naam.toLowerCase() !== adres ? naam : naamVan(adres)).slice(0, 80), klant_email: adres, titel: schoonOnderwerp(msg && msg.subject), bron: 'mail' };
  }

  // ── "Binnenkomend": status per gesprek ──
  // gesprek = {mbx, conversationId, berichten:[{id, internetMessageId, receivedDateTime, categories}]}
  // ctx = {links: mt_mail_links ({code:[record]}), oppak: mt_mail_oppak, verzonden: {conversationId: laatste verzendtijd ISO}, nu (ms), teLangUren (24), eigenDomein ('mortiseandtenon.nl')}
  // → {status: 'nieuw'|'opgepakt'|'gekoppeld'|'afgehandeld', codes, door, naam, tijd, reden, beantwoord, teLang, laatste}
  function binnenStatus(gesprek, ctx) {
    ctx = ctx || {};
    const mbx = String(gesprek.mbx || '').toLowerCase(), msgs = Array.isArray(gesprek.berichten) ? gesprek.berichten : [];
    const imids = new Set(msgs.map(m => m && m.internetMessageId).filter(Boolean)), ids = new Set(msgs.map(m => m && m.id).filter(Boolean));
    const codes = [];
    const links = ctx.links && typeof ctx.links === 'object' ? ctx.links : {};
    for (const code in links) {
      if ((Array.isArray(links[code]) ? links[code] : []).some(x => x && !x.ontkoppeld && ((x.internetMessageId && imids.has(x.internetMessageId))
        || (String(x.mbx || '').toLowerCase() === mbx && (ids.has(x.id) || ids.has(x.iid)))))) codes.push(code);
    }
    const rec = (ctx.oppak || {})[oppakSleutel(mbx, gesprek.conversationId)] || null;
    const eigen = '@' + String(ctx.eigenDomein || 'mortiseandtenon.nl').toLowerCase().replace(/^@/, '');
    const extern = m => { const a = String(m && m.from && m.from.emailAddress && m.from.emailAddress.address || '').toLowerCase(); return !!a && !a.endsWith(eigen); };
    const tms = m => Date.parse(m && m.receivedDateTime) || 0;
    // "laatste" = de nieuwste mail van buiten het bedrijf (een bcc-kopie van ons eigen antwoord telt niet als nieuwe vraag); zonder externe mail de nieuwste.
    const bronMsgs = msgs.some(extern) ? msgs.filter(extern) : msgs;
    const laatste = bronMsgs.map(m => String(m && m.receivedDateTime || '')).sort((a, b) => (Date.parse(a) || 0) - (Date.parse(b) || 0)).pop() || '';
    const cat = msgs.map(m => (Array.isArray(m && m.categories) ? m.categories : []).find(isOppakCategorie)).find(Boolean) || '';
    const verz = (ctx.verzonden || {})[gesprek.conversationId] || '';
    const beantwoord = !!(verz && laatste && (Date.parse(verz) || 0) >= (Date.parse(laatste) || 0));
    const uit = { status: 'nieuw', codes, door: '', naam: '', tijd: '', reden: '', toelichting: '', beantwoord, teLang: false, laatste, heropend: false };
    // Afgehandeld blijft afgehandeld, tenzij er daarna een mail van buiten het bedrijf in hetzelfde gesprek kwam (de klant reageert opnieuw).
    const sindsAfgehandeld = rec && rec.status === 'afgehandeld' ? Date.parse(rec.tijd) || 0 : 0;
    const heropend = !!sindsAfgehandeld && msgs.some(m => extern(m) && tms(m) > sindsAfgehandeld);
    if (heropend) uit.heropend = true;
    if (rec && rec.status === 'afgehandeld' && !heropend) Object.assign(uit, { status: 'afgehandeld', door: rec.door, naam: rec.naam, tijd: rec.tijd, reden: rec.reden, toelichting: rec.toelichting || '' });
    else if (codes.length) Object.assign(uit, { status: 'gekoppeld' });
    else if (rec && rec.status === 'opgepakt') Object.assign(uit, { status: 'opgepakt', door: rec.door, naam: rec.naam, tijd: rec.tijd });
    else if (cat) Object.assign(uit, { status: 'opgepakt', naam: cat.slice(CATEGORIE_PREFIX.length) });   // met de hand in Outlook gezet
    // wie het oppakte, ook als het gesprek inmiddels gekoppeld of afgehandeld is
    if (rec && rec.opgepakt_naam && uit.status !== 'opgepakt') { uit.opgepakt_naam = rec.opgepakt_naam; uit.opgepakt_tijd = rec.opgepakt_tijd; }
    else if (uit.status === 'gekoppeld' && cat) uit.opgepakt_naam = cat.slice(CATEGORIE_PREFIX.length);
    const uren = Number(ctx.teLangUren) > 0 ? Number(ctx.teLangUren) : 24, nu = Number(ctx.nu) || Date.now();
    uit.teLang = uit.status === 'nieuw' && !beantwoord && !!laatste && (nu - Date.parse(laatste)) > uren * 3600000;
    return uit;
  }
  // Graph-berichten (inbox van info@) → gesprekken, nieuwste eerst.
  function groepeerGesprekken(berichten, mbx) {
    const per = new Map();
    (Array.isArray(berichten) ? berichten : []).forEach(m => {
      if (!m) return;
      const k = m.conversationId || ('los|' + (m.internetMessageId || m.id));
      if (!per.has(k)) per.set(k, { mbx: String(mbx || '').toLowerCase(), conversationId: m.conversationId || '', berichten: [] });
      per.get(k).berichten.push(m);
    });
    const tijd = g => g.berichten.map(m => String(m.receivedDateTime || '')).sort().pop() || '';
    return [...per.values()].sort((a, b) => tijd(b).localeCompare(tijd(a)));
  }
  // Tellers per status (voor de kaart).
  function tel(statussen) {
    const t = { nieuw: 0, opgepakt: 0, gekoppeld: 0, afgehandeld: 0, teLang: 0 };
    (statussen || []).forEach(s => { if (s && t[s.status] != null) t[s.status]++; if (s && s.teLang) t.teLang++; });
    return t;
  }

  // ── projectgegevens voor het paneel ──
  // p = project uit mt_projecten; opts.lead = MTLead, opts.project = MTProject, opts.ua = navigator.userAgent.
  function projectInfo(p, opts) {
    opts = opts || {};
    if (!p) return null;
    const g = p.gegevens && typeof p.gegevens === 'object' ? p.gegevens : {};
    const contactNaam = [g.voornaam, g.achternaam].filter(Boolean).join(' ').trim() || p.klant_naam || '';
    const adres = [g.straat, [g.postcode, g.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const L = opts.lead, P = opts.project;
    return {
      code: p.code, nummer: nummerVan(p, opts.nummer) || p.werkcode || p.code, naam: p.naam || p.code,
      fase: p.fase && L && typeof L.label === 'function' ? L.label(p.fase) : (p.status || ''),
      lead: !!(L && typeof L.isLead === 'function' && L.isLead(p)),
      contact: { naam: contactNaam, bedrijf: p.klant_naam && p.klant_naam !== contactNaam ? p.klant_naam : '', email: p.klant_email || '', telefoon: p.klant_telefoon || '' },
      adres, navUrl: adres && P && typeof P.navUrl === 'function' ? P.navUrl(adres, opts.ua || '') : '',
      volgendeActie: p.volgende_actie && typeof p.volgende_actie === 'object' ? { tekst: p.volgende_actie.tekst || '', datum: p.volgende_actie.datum || '' } : null
    };
  }

  root.MTMail = {
    SUBMAPPEN, submapVoorstel, isBestand, bijlageIndexSamen, veiligeNaam,
    OPPAK_STATUS, AFHANDEL_REDENEN, CATEGORIE_PREFIX, oppakSleutel, naamVan, categorie, isOppakCategorie, categorieenNa, oppakRecord, oppakSamen,
    tag, tagUitOnderwerp, onderwerpMetTag, nummerVan, ccInfoNodig,
    schoonOnderwerp, leadVoorstel,
    binnenStatus, groepeerGesprekken, tel,
    projectInfo
  };
})(typeof window !== 'undefined' ? window : globalThis);
