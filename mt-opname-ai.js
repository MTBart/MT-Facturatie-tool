// mt-opname-ai.js — herkenning uit de wandfoto's (beta). Per wandfoto wijst de AI aan wat erop zit: het kader van de wand (de vier hoeken), de openingen (raam, deur), wat vast aan de
// wand zit (stopcontact, schakelaar, radiator, leiding, vensterbank, koof, ...) en wat los in de kamer staat. Dat is altijd een VOORSTEL: de opnemer vinkt aan wat klopt, daarna komt het
// als onderdeel in het draadmodel en vraagt de route de maten. Er komt nooit een maat uit de foto: een geschatte wandlengte is alleen het grijze voorstel (K.zetVoorstel) en telt nergens mee.
// De foto gaat hiervoor (verkleind) via de eigen worker naar de AI; dat gebeurt alleen na een tik op de knop. De host (mobiel.html) levert de aanroep: host.herken(verzoek) geeft
// { status, tekst } terug. Zonder die functie is er geen knop. Bouwt uitsluitend met DOM-methoden (textContent), nooit innerHTML.
(function (root) {
  'use strict';
  const M = root.MTOpname, X = M.X, K = X.K, G = X.G, O = X.O, h = X.h, S = X.S, lijst = X.lijst;
  const AI = M.AI = {};
  AI.MODEL = 'claude-sonnet-5-5';
  AI.MAX_TOKENS = 4096;                                                  // het plafond van de worker; het denkwerk van het model telt mee, daarom effort laag
  AI.MAX_ZIJDE = 1568;                                                   // de foto gaat verkleind mee (langste zijde in pixels); het origineel blijft onaangeroerd op het toestel
  AI.TYPES = ['raam', 'deur', 'stopcontact', 'schakelaar', 'radiator', 'leiding', 'vensterbank', 'overig', 'los'];
  AI.TYPE_NAAM = { raam: 'Raam of kozijn', deur: 'Deur', stopcontact: 'Stopcontact', schakelaar: 'Schakelaar', radiator: 'Radiator', leiding: 'Leiding of kraan', vensterbank: 'Vensterbank', overig: 'Iets anders', los: 'Los' };
  // Drie groepen (Bart, 13-11): de ruimte zelf (openingen in de schil), wat constructief vast zit, en losse spullen. Losse spullen worden alleen genoteerd, nooit gemeten.
  AI.groep = type => type === 'raam' || type === 'deur' ? 'ruimte' : type === 'los' ? 'los' : 'constructief';
  AI.GROEP_NAAM = { ruimte: 'De ruimte zelf (openingen)', constructief: 'Vast aan de wand', los: 'Los in de kamer (alleen genoteerd)' };

  const punt = { type: 'object', additionalProperties: false, required: ['x', 'y', 'zichtbaar'], properties: { x: { type: 'number' }, y: { type: 'number' }, zichtbaar: { type: 'boolean' } } };
  AI.SCHEMA = { type: 'object', additionalProperties: false, required: ['bruikbaar', 'hoeken', 'onderdelen', 'wand_lengte_mm', 'opmerking'], properties: {
    bruikbaar: { type: 'boolean' },
    hoeken: { type: 'object', additionalProperties: false, required: ['linksonder', 'rechtsonder', 'rechtsboven', 'linksboven'], properties: { linksonder: punt, rechtsonder: punt, rechtsboven: punt, linksboven: punt } },
    onderdelen: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'omschrijving', 'x0', 'y0', 'x1', 'y1', 'zekerheid'], properties: {
      type: { type: 'string', enum: AI.TYPES }, omschrijving: { type: 'string' }, x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' }, zekerheid: { type: 'string', enum: ['hoog', 'middel', 'laag'] } } } },
    wand_lengte_mm: { type: 'number' },
    opmerking: { type: 'string' } } };

  AI.SYSTEEM = [
    'Je helpt een meubelmaker bij het inmeten van een kamer voor een maatwerkmeubel. Je krijgt één foto van één wand, van binnen in de kamer genomen. Wijs aan wat er op die wand zit. Jouw uitkomst is een voorstel: de opnemer controleert het en meet daarna alles zelf na met een laserafstandsmeter. Noem dus alleen wat je echt ziet en verzin geen maten.',
    'Coördinaten zijn fracties van de foto: x loopt van 0 (linkerrand) tot 1 (rechterrand), y van 0 (bovenrand) tot 1 (onderrand).',
    'hoeken: de vier hoekpunten van het wandvlak dat recht voor de camera ligt (de wand waar de foto van gemaakt is, niet de zijwanden, de vloer of het plafond). linksonder en rechtsonder zijn de punten waar die wand en de vloer samenkomen in de linker en rechter kamerhoek; linksboven en rechtsboven waar de wand en het plafond samenkomen. Is een hoekpunt niet te zien (buiten beeld of afgedekt door een meubel), zet dan zichtbaar op false en geef je beste schatting voor x en y.',
    'onderdelen: alles wat op deze wand zit of ervoor staat, elk met een type. raam: een raam of kozijn in deze wand. deur: een deur of deuropening in deze wand. stopcontact: een wandcontactdoos (ook data of antenne). schakelaar: een lichtschakelaar, thermostaat of bedieningspaneel. radiator: een radiator of convector. leiding: een zichtbare leiding, kraan, afvoer of meter. vensterbank: een vensterbank. overig: iets anders dat vast zit en in de weg kan zitten voor een meubel, zoals een koof, balk, kolom, schoorsteen, nis, ventilatierooster, meterkast, vaste lamp of wandplank; zet in de omschrijving wat het is. los: wat los in de kamer staat en zo weg kan, zoals meubels, dozen, planten, staande lampen, gordijnen en spullen; neem alleen de grote losse dingen op die het zicht op de wand afdekken.',
    'Geef per onderdeel het omsluitende kader (x0 en y0 linksboven, x1 en y1 rechtsonder), een korte omschrijving in het Nederlands van hooguit zes woorden, en hoe zeker je bent: hoog, middel of laag. Neem alleen op wat op de wand recht voor de camera zit of er direct voor staat, niet wat op een zijwand zit. Twijfel je of iets er echt is, kies dan zekerheid laag. Is er niets, geef dan een lege lijst.',
    'wand_lengte_mm: een grove schatting van de lengte van deze wand van hoek tot hoek, in millimeters, afgeleid van herkenbare vaste maten (een binnendeur is ongeveer 2015 tot 2315 mm hoog en 830 tot 930 mm breed, een standaard plafond is ongeveer 2600 mm hoog, een stopcontact zit meestal op 300 of 1050 mm). Staat de wand niet van hoek tot hoek op de foto of is er geen houvast, geef dan 0.',
    'bruikbaar: false als de foto geen wand van een kamer laat zien, of te donker of te onscherp is om iets aan te wijzen. opmerking: één korte zin met wat de opnemer moet weten (bijvoorbeeld dat een deel van de wand is afgedekt of dat de foto schuin genomen is), of leeg.'
  ].join('\n\n');

  // Het verzoek voor één wandfoto. metSchema = false is de terugval als de API het vaste antwoordformaat weigert: dan vraagt de tekst zelf om alleen JSON.
  AI.verzoek = function (b64, tekst, metSchema) {
    const uit = { model: AI.MODEL, max_tokens: AI.MAX_TOKENS, system: AI.SYSTEEM, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: tekst + (metSchema === false ? '\n\nAntwoord met alleen één JSON-object, zonder uitleg ervoor of erna, met precies deze velden: ' + JSON.stringify(AI.SCHEMA) : '') }] }] };
    if (metSchema !== false) uit.output_config.format = { type: 'json_schema', schema: AI.SCHEMA };
    return uit;
  };

  // Het antwoord van de worker lezen: een SSE-stream (of gewoon JSON) van de Messages API. Geeft { data } of { fout, status, formaat } (formaat: de API weigerde het antwoordformaat).
  AI.leesAntwoord = function (status, ruw) {
    const tekstIn = String(ruw == null ? '' : ruw); let tekst = '', stop = null, fout = null;
    const foutUit = j => { const e = j && (j.error || j); return e && typeof e === 'object' ? String(e.message || e.type || e.reden || '') : typeof e === 'string' ? e : ''; };
    if (tekstIn.trimStart().charAt(0) === '{') {
      let j = null; try { j = JSON.parse(tekstIn); } catch (e) { j = null; }
      if (j && (j.type === 'error' || j.error)) fout = foutUit(j) || 'onbekende fout';
      else if (j && Array.isArray(j.content)) { tekst = j.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join(''); stop = j.stop_reason || null; }
    } else {
      for (const regel of tekstIn.split('\n')) {
        const s = regel.trim(); if (s.slice(0, 5) !== 'data:') continue;
        const p = s.slice(5).trim(); if (!p || p === '[DONE]') continue;
        let ev; try { ev = JSON.parse(p); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') tekst += ev.delta.text;
        else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'text' && typeof ev.content_block.text === 'string') tekst += ev.content_block.text;
        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') fout = foutUit(ev) || 'onbekende fout';
      }
    }
    if (!(status >= 200 && status < 300) || fout) {
      const f = fout || (status === 401 || status === 403 ? 'je bent niet ingelogd of hebt geen recht op de AI' : 'de AI gaf een fout (' + status + ')');
      return { fout: f, status, formaat: status === 400 && /output_config|format|schema/i.test(f) };
    }
    if (stop === 'refusal') return { fout: 'de AI wilde deze foto niet beoordelen', status };
    const a = tekst.indexOf('{'), b = tekst.lastIndexOf('}');
    let data = null; if (a >= 0 && b > a) { try { data = JSON.parse(tekst.slice(a, b + 1)); } catch (e) { data = null; } }
    if (!data) return { fout: stop === 'max_tokens' ? 'het antwoord was te lang en is afgebroken' : 'het antwoord van de AI was niet te lezen', status };
    return { data };
  };

  const num = v => typeof v === 'number' && isFinite(v), tussen = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Het ruwe antwoord veilig maken: alleen bekende velden, coördinaten binnen de foto, hooguit 40 onderdelen. afm: de afmetingen van de verstuurde foto (voor het geval het model toch pixels geeft).
  AI.normaliseer = function (d, afm) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const uit = { bruikbaar: d.bruikbaar !== false, hoeken: null, hoeken_gezien: false, onderdelen: [], los: [], lengte_mm: null, opmerking: String(d.opmerking == null ? '' : d.opmerking).replace(/\s+/g, ' ').trim().slice(0, 300) };
    const hkIn = d.hoeken && typeof d.hoeken === 'object' ? ['linksonder', 'rechtsonder', 'rechtsboven', 'linksboven'].map(n => d.hoeken[n]) : [], ond = lijst(d.onderdelen).filter(o => o && typeof o === 'object').slice(0, 40);
    // fracties verwacht; komen er toch pixels (waarden ruim boven 1), dan omrekenen met de afmetingen van de verstuurde foto
    const alle = []; for (const p of hkIn) if (p && num(p.x) && num(p.y)) alle.push(p.x, p.y); for (const o of ond) for (const k of ['x0', 'y0', 'x1', 'y1']) if (num(o[k])) alle.push(o[k]);
    const pixels = alle.some(v => v > 1.5) && afm && afm.w > 0 && afm.h > 0, fx = v => tussen(pixels ? v / afm.w : v, 0, 1), fy = v => tussen(pixels ? v / afm.h : v, 0, 1);
    if (alle.some(v => v > 1.5) && !pixels) return uit.bruikbaar ? Object.assign(uit, { opmerking: uit.opmerking || 'De plekken op de foto waren niet te lezen.' }) : uit;
    if (hkIn.length === 4 && hkIn.every(p => p && num(p.x) && num(p.y))) {
      const pts = hkIn.map(p => [Math.round(fx(p.x) * 10000) / 10000, Math.round(fy(p.y) * 10000) / 10000]), lo = pts[0], ro = pts[1], rb = pts[2], lb = pts[3];
      uit.hoeken_gezien = hkIn.every(p => p.zichtbaar !== false);
      if (uit.hoeken_gezien && lo[0] < ro[0] && lb[0] < rb[0] && lb[1] < lo[1] && rb[1] < ro[1] && G.hoekenGeldig(pts)) uit.hoeken = pts;
    }
    for (const o of ond) {
      if (![o.x0, o.y0, o.x1, o.y1].every(num)) continue;
      const x0 = fx(Math.min(o.x0, o.x1)), x1 = fx(Math.max(o.x0, o.x1)), y0 = fy(Math.min(o.y0, o.y1)), y1 = fy(Math.max(o.y0, o.y1));
      if (x1 - x0 < 0.004 || y1 - y0 < 0.004) continue;
      const type = AI.TYPES.includes(o.type) ? o.type : 'overig', r4 = v => Math.round(v * 10000) / 10000;
      const item = { type, naam: String(o.omschrijving == null ? '' : o.omschrijving).replace(/\s+/g, ' ').trim().slice(0, 60), x0: r4(x0), y0: r4(y0), x1: r4(x1), y1: r4(y1), zeker: ['hoog', 'middel', 'laag'].includes(o.zekerheid) ? o.zekerheid : 'laag' };
      (type === 'los' ? uit.los : uit.onderdelen).push(item);
    }
    uit.onderdelen.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    if (num(d.wand_lengte_mm) && d.wand_lengte_mm >= 500 && d.wand_lengte_mm <= 30000) uit.lengte_mm = Math.round(d.wand_lengte_mm / 10) * 10;
    return uit;
  };

  // Een kader op de foto (fracties van het beeld) naar het wandvlak: u van links naar rechts, v van de vloer naar het plafond, beide 0 tot 1. Met de vier wandhoeken via de homografie;
  // zonder hoeken geldt de foto zelf als de wand (grof, maar de volgorde van links naar rechts klopt). Zodra de hoeken er zijn, wordt opnieuw gerekend (X.aiHerplaats).
  AI.naarWand = function (lay, bb) {
    const hk = lay && Array.isArray(lay.hoeken) && lay.hoeken.length === 4 && lay.hoeken.every(Boolean) && !lay.onbekend ? lay.hoeken : null, afb = hk ? G.wandAfbeelding(hk) : null;
    let us = null, vs = null;
    if (afb) { const q = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(p => afb.naarWand(p[0], p[1])); if (q.every(p => p && num(p[0]) && num(p[1]))) { us = q.map(p => p[0]); vs = q.map(p => p[1]); } }
    if (!us) { us = [bb.x0, bb.x1]; vs = [1 - bb.y1, 1 - bb.y0]; }
    const r3 = v => Math.round(tussen(v, 0, 1) * 1000) / 1000;
    let u0 = r3(Math.min.apply(null, us)), u1 = r3(Math.max.apply(null, us)), v0 = r3(Math.min.apply(null, vs)), v1 = r3(Math.max.apply(null, vs));
    if (u1 - u0 < 0.01) { if (u0 > 0.99) u0 = 0.99; u1 = Math.min(1, u0 + 0.01); }
    if (v1 - v0 < 0.01) { if (v0 > 0.99) v0 = 0.99; v1 = Math.min(1, v0 + 0.01); }
    return { u0, u1, v0, v1 };
  };
  const overlap = (a, b) => {                                            // deel van het kleinste kader dat in het andere valt (0 tot 1)
    const w = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0), hh = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0); if (!(w > 0 && hh > 0)) return 0;
    const kl = Math.min((a.u1 - a.u0) * (a.v1 - a.v0), (b.u1 - b.u0) * (b.v1 - b.v0)); return kl > 0 ? w * hh / kl : 0;
  };
  const entType = e => e ? (e.soort === 'raam' || e.soort === 'deur' ? e.soort : e.type) : null;
  const opWand = (r, w) => lijst(r.openingen).concat(lijst(r.objecten)).filter(e => e && e.id && e.wand === w);
  // Staat dit onderdeel er al? Zelfde soort op (ongeveer) dezelfde plek op de wand. Geeft het id van het bestaande onderdeel, of null.
  AI.bestaat = function (r, w, lay, it) {
    const uv = AI.naarWand(lay, it), vormen = (lay && lay.vormen) || {};
    for (const e of opWand(r, w)) { if (entType(e) !== it.type) continue; if (it.type === 'vensterbank') return e.id; const v = vormen[e.id]; if (v && overlap(uv, v) > 0.4) return e.id; }
    return null;
  };
  // De toegangsdeur staat al op wand 1 (zonder plek): de duidelijkste deur op de foto hoort daarbij, in plaats van een tweede deur te worden.
  AI.koppelDeur = function (r, w, lay, res) {
    const td = r.toegangsdeur && lijst(r.openingen).find(e => e && e.id === r.toegangsdeur && e.wand === w); if (!td || ((lay && lay.vormen) || {})[td.id]) return null;
    const rang = { hoog: 0, middel: 1, laag: 2 }, deuren = res.onderdelen.filter(o => o.type === 'deur').sort((a, b) => rang[a.zeker] - rang[b.zeker] || (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    return deuren.length ? { item: deuren[0], id: td.id } : null;
  };

  // Wat uit de foto herkend is volgt het kader van de wand: na het zetten of aanpassen van de hoeken worden de plekken (fracties op de wand) en het hulpgetal positie_x opnieuw berekend.
  X.aiHerplaats = function (w) {
    const r = X.ruimte(), lay = X.wandLayout(w); if (!r || !lay.ai_vormen) return 0;
    const o = X.kloon(S.rec.opname), rr = o.ruimtes.find(x => x.id === r.id), kw = G.kamer(r).wanden[w], L = kw && kw.lengte > 0 ? kw.lengte : null; let n = 0;
    lay.vormen = lay.vormen || {};
    for (const id of Object.keys(lay.ai_vormen)) {
      const e = opWand(rr, w).find(x => x.id === id);
      if (!e) { delete lay.ai_vormen[id]; continue; }
      const uv = AI.naarWand(lay, lay.ai_vormen[id]); lay.vormen[id] = uv; n++;
      if (L) e.positie_x = Math.round(uv.u0 * L);
    }
    S.rec.opname = o; return n;
  };

  // Het gekozen deel van een voorstel in de opname zetten. kies: de indexen in res.onderdelen die de opnemer heeft aangevinkt. Alles in één keer op een kopie; gaat er iets mis, dan verandert er niets.
  AI.pasToe = function (w, res, kies) {
    const r0 = X.ruimte(), rid = r0.id, foto = X.wandFotoRec(w), inZone = lijst(r0.werkzone).includes(w), kw = G.kamer(r0).wanden[w];
    const layOud = X.wandLayout(w, true), lay = JSON.parse(JSON.stringify(layOud));
    lay.vormen = lay.vormen || {}; lay.ai_vormen = lay.ai_vormen || {};
    let o = S.rec.opname, n = 0;
    const stap = q => { if (!q || q.fout || !q.opname) throw new Error((q && q.fout) || 'toevoegen is niet gelukt'); o = q.opname; return q; };
    const ent = (lijstNaam, id) => lijst(o.ruimtes.find(x => x.id === rid)[lijstNaam]).find(e => e && e.id === id);
    // 1. het kader van de wand: alleen als de opnemer voor deze foto nog geen hoeken heeft gezet
    if (res.hoeken && foto && !(lay.foto === foto.id && Array.isArray(lay.hoeken))) { lay.foto = foto.id; lay.hoeken = res.hoeken.map(p => p.slice()); lay.onbekend = false; lay.hoeken_bron = 'foto-voorstel'; lay.tijd = X.nu(); }
    // 2. de wandlengte: alleen als grijs voorstel (telt nooit als meting; geeft de getekende schatting een betere verhouding)
    if (res.lengte_mm) { const q = K.zetVoorstel(o, rid, 'wanden.' + w + '.maten.lengte', { schatting_mm: res.lengte_mm }); if (q && q.opname) o = q.opname; }
    // 3. de onderdelen, van links naar rechts
    const koppel = AI.koppelDeur(r0, w, layOud, res), ramen = [], gemaakt = {};
    const volgorde = res.onderdelen.map((it, i) => i).sort((a, b) => (AI.groep(res.onderdelen[a].type) === 'ruimte' ? 0 : 1) - (AI.groep(res.onderdelen[b].type) === 'ruimte' ? 0 : 1) || a - b);          // eerst de openingen: een vensterbank zoekt zijn raam
    volgorde.forEach(i => {
      const it = res.onderdelen[i];
      if (!kies.has(i)) return;
      const bb = { x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 }, uv = AI.naarWand(lay, bb);
      if (koppel && koppel.item === it) { lay.ai_vormen[koppel.id] = bb; const e = ent('openingen', koppel.id); if (e && it.naam) e.omschrijving = it.naam; gemaakt[i] = koppel.id; n++; return; }
      let e = null;
      if (it.type === 'raam' || it.type === 'deur') {
        const q = stap(K.voegOpeningToe(o, rid, { soort: it.type, wand: w })); e = ent('openingen', q.id);
        if (it.type === 'raam') ramen.push({ id: q.id, x0: it.x0, x1: it.x1 });
        lay.ai_vormen[q.id] = bb;
      } else if (it.type === 'vensterbank') {
        const bij = ramen.map(rm => ({ rm, o: Math.min(rm.x1, it.x1) - Math.max(rm.x0, it.x0) })).filter(x => x.o > 0.3 * (it.x1 - it.x0)).sort((a, b) => b.o - a.o)[0];
        const q = stap(K.voegObjectToe(o, rid, { type: 'vensterbank', wand: w, opening: bij ? bij.rm.id : undefined })); e = ent('objecten', q.id);
      } else {
        const hoek = it.type === 'radiator' || !kw ? undefined : ((uv.u0 + uv.u1) / 2 < 0.5 ? kw.van : kw.naar);
        const q = stap(K.voegObjectToe(o, rid, { type: it.type, wand: w, hoek, naam: it.type === 'overig' ? (it.naam || 'Onbekend onderdeel') : undefined })); e = ent('objecten', q.id);
        lay.ai_vormen[q.id] = bb;
      }
      if (e) { e.herkend = 'foto'; if (it.naam) e.omschrijving = it.naam; if (!inZone && e.eigen) delete e.eigen; gemaakt[i] = e.id; n++; }          // buiten de werkzone is het "gezien", niet zelf toegevoegd: het wordt pas gemeten na "Toch meten"
    });
    // losse spullen: alleen genoteerd bij de wand (voor later, bijvoorbeeld om in de tekening te zetten), nooit een onderdeel of een maat
    lay.ai = { foto: foto ? foto.id : null, tijd: X.nu(), model: AI.MODEL, toegepast: true,
      resultaat: Object.assign({}, res, { onderdelen: res.onderdelen.map((it, i) => gemaakt[i] ? Object.assign({}, it, { id: gemaakt[i] }) : it) }) };
    if (!X.wijzig({ opname: o, fout: null })) throw new Error('opslaan is niet gelukt');
    S.rec.layout[S.ruimteId][w] = lay;                                   // dezelfde plek als X.wandLayout
    X.aiHerplaats(w); X.bewaar();
    return n;
  };

  // ── De foto verkleinen (alleen de kopie die naar de AI gaat) ──
  AI.verklein = function (blob) {
    return new Promise((ok, fail) => {
      const u = root.URL.createObjectURL(blob), img = new root.Image();
      img.onload = () => {
        try {
          const s = Math.min(1, AI.MAX_ZIJDE / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * s)), hh = Math.max(1, Math.round(img.naturalHeight * s));
          const c = root.document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(img, 0, 0, w, hh);
          const data = c.toDataURL('image/jpeg', 0.82); root.URL.revokeObjectURL(u);
          ok({ b64: data.slice(data.indexOf(',') + 1), w, h: hh });
        } catch (e) { root.URL.revokeObjectURL(u); fail(e); }
      };
      img.onerror = () => { root.URL.revokeObjectURL(u); fail(new Error('het beeld is niet te openen')); };
      img.src = u;
    });
  };

  X.herkenMag = () => !!(S.host && typeof S.host.herken === 'function');
  AI.vraag = async function (b64, tekst) {
    let r = await S.host.herken(AI.verzoek(b64, tekst, true)), uit = AI.leesAntwoord(r.status, r.tekst);
    if (uit.fout && uit.formaat) { r = await S.host.herken(AI.verzoek(b64, tekst, false)); uit = AI.leesAntwoord(r.status, r.tekst); }          // terugval: zonder vast antwoordformaat
    if (uit.fout) throw new Error(uit.fout);
    return uit.data;
  };
  // Eén wand: de foto ophalen, verkleinen, laten beoordelen. In het verzoek staat alleen het wandnummer, geen naam van de ruimte, het project of de klant.
  AI.herkenWand = async function (w) {
    const r = X.ruimte(), ids = K.wandIds(r), rec = X.wandFotoRec(w); if (!rec) throw new Error('er is nog geen foto van deze wand');
    const fr = await O.leesFoto(S.rec.opname.opname_id + ':' + rec.id); if (!fr || !fr.blob) throw new Error('het beeld staat niet op dit toestel');
    const klein = await AI.verklein(fr.blob);
    const data = await AI.vraag(klein.b64, 'Dit is de foto van wand ' + (ids.indexOf(w) + 1) + ' van de ' + ids.length + ' wanden van de kamer.');
    const res = AI.normaliseer(data, klein); if (!res) throw new Error('het antwoord van de AI was niet te lezen');
    return res;
  };

  // ── Het blad: herkennen, nakijken, in het draadmodel zetten ──
  const metFoto = () => K.wandIds(X.ruimte()).filter(w => X.wandFotoRec(w));
  const eerder = w => { const lay = X.wandLayout(w), f = X.wandFotoRec(w); return lay.ai && f && lay.ai.foto === f.id && lay.ai.resultaat ? lay.ai : null; };
  X.herkenKaart = function () {
    if (!X.herkenMag()) return null;
    const ws = metFoto(); if (!ws.length) return null;
    if (ws.every(w => { const e = eerder(w); return e && e.toegepast; })) return h('div', { class: 'opn-onderrij' }, h('button', { type: 'button', class: 'opn-link', text: 'Herkenning uit de foto\'s bekijken of opnieuw doen', onclick: () => X.herkenBlad() }));
    return h('div', { class: 'opn-kaart opn-herken' }, h('div', { class: 'opn-kaart-titel', text: 'Draadmodel uit de foto\'s' }),
      h('p', { text: 'Laat de AI per wandfoto aanwijzen wat erop zit: het kader van de wand, ramen en deuren, stopcontacten, radiatoren en leidingen. Jij kijkt het voorstel na, daarna meet je alles na.' }),
      h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: 'Herken wat er op de foto\'s staat', onclick: () => X.herkenBlad() }));
  };
  X.herkenBlad = function (wanden) {
    const r = X.ruimte(), ws = (wanden && wanden.length ? wanden : metFoto()).filter(w => X.wandFotoRec(w)), nr = w => K.wandIds(r).indexOf(w) + 1;
    const st = S.ai = { per: {}, bezig: false, gestopt: false };
    for (const w of ws) { const e = eerder(w); st.per[w] = e ? { staat: 'klaar', res: e.resultaat, eerder: true } : { staat: 'wacht' }; }
    const inhoud = h('div', { class: 'opn-herkenblad' });
    const levend = () => S.ai === st && !!inhoud.isConnected;
    const kiesStandaard = w => {
      const p = st.per[w], lay = X.wandLayout(w), koppel = AI.koppelDeur(X.ruimte(), w, lay, p.res); p.kies = new Set(); p.staatAl = {}; p.koppel = koppel ? p.res.onderdelen.indexOf(koppel.item) : -1;
      p.res.onderdelen.forEach((it, i) => {
        const al = it.id && opWand(X.ruimte(), w).some(e => e.id === it.id) ? it.id : (koppel && koppel.item === it ? null : AI.bestaat(X.ruimte(), w, lay, it));
        if (al) p.staatAl[i] = al; else if (it.zeker !== 'laag') p.kies.add(i);
      });
    };
    const start = async opnieuw => {
      if (st.bezig) return; st.bezig = true; st.gestopt = false;
      for (const w of ws) { if (opnieuw || st.per[w].staat !== 'klaar') st.per[w] = { staat: 'wacht' }; }
      bouw();
      for (const w of ws) {
        const p = st.per[w]; if (p.staat === 'klaar') continue;
        if (!levend() || st.gestopt) break;
        p.staat = 'bezig'; bouw();
        try { p.res = await AI.herkenWand(w); p.staat = 'klaar'; const lay = X.wandLayout(w, true), f = X.wandFotoRec(w); lay.ai = { foto: f.id, tijd: X.nu(), model: AI.MODEL, toegepast: false, resultaat: p.res }; X.bewaar(); }
        catch (e) { p.staat = 'fout'; p.fout = String((e && e.message) || e); }
        if (levend()) bouw();
      }
      st.bezig = false; if (levend()) bouw();
    };
    const zet = () => {
      let n = 0, wn = 0; const mis = [];
      for (const w of ws) {
        const p = st.per[w]; if (p.staat !== 'klaar' || !p.res || !p.res.bruikbaar) continue;
        try { const k = AI.pasToe(w, p.res, p.kies || new Set()); n += k; wn++; } catch (e) { mis.push('wand ' + nr(w) + ': ' + ((e && e.message) || e)); }
      }
      S.ai = null; X.sluitBlad();
      X.toast(mis.length ? 'Niet alles is gelukt (' + mis.join('; ') + ').' : n + (n === 1 ? ' onderdeel' : ' onderdelen') + ' in het draadmodel gezet op ' + wn + (wn === 1 ? ' wand' : ' wanden') + '. Kijk per wand of het klopt en meet alles na.');
      X.teken();
    };
    function wandKaart(w) {
      const p = st.per[w], kaart = h('div', { class: 'opn-kaart opn-herkenwand' });
      const kop = h('div', { class: 'opn-herkenkop' }, h('div', { class: 'opn-kaart-titel', text: 'Wand ' + nr(w) }));
      kaart.appendChild(kop);
      if (p.staat === 'wacht') { kop.appendChild(h('span', { class: 'opn-hint', text: 'wacht' })); return kaart; }
      if (p.staat === 'bezig') { kop.appendChild(h('span', { class: 'opn-hint opn-bezig', text: 'de AI kijkt naar de foto...' })); return kaart; }
      if (p.staat === 'fout') { kaart.appendChild(h('p', { class: 'opn-fouttekst', text: 'Niet gelukt: ' + p.fout + '.' })); return kaart; }
      const res = p.res; if (!p.kies) kiesStandaard(w);
      if (!res.bruikbaar) { kaart.appendChild(h('p', { class: 'opn-waarschuwing', text: 'Deze foto is niet bruikbaar voor herkenning.' + (res.opmerking ? ' ' + res.opmerking : '') })); return kaart; }
      const lay = X.wandLayout(w), f = X.wandFotoRec(w), eigenHoeken = lay.foto === f.id && Array.isArray(lay.hoeken) && lay.hoeken_bron !== 'foto-voorstel';
      const regels = [eigenHoeken ? 'Kader van de wand: je eigen hoeken blijven staan.' : res.hoeken ? 'Kader van de wand: gevonden.' : 'Kader van de wand: niet goed te zien, wijs de hoeken zelf aan.'];
      if (res.lengte_mm) regels.push('Wandlengte ongeveer ' + String(Math.round(res.lengte_mm / 100) / 10).replace('.', ',') + ' m (een schatting, geen maat).');
      if (res.opmerking) regels.push(res.opmerking);
      kaart.appendChild(h('p', { class: 'opn-hint', text: regels.join(' ') }));
      for (const g of ['ruimte', 'constructief']) {
        const idx = res.onderdelen.map((it, i) => i).filter(i => AI.groep(res.onderdelen[i].type) === g); if (!idx.length) continue;
        kaart.appendChild(h('div', { class: 'opn-label', text: AI.GROEP_NAAM[g] }));
        const chips = h('div', { class: 'opn-chips' });
        for (const i of idx) {
          const it = res.onderdelen[i], al = p.staatAl[i], tekst = AI.TYPE_NAAM[it.type] + (it.naam && it.naam.toLowerCase() !== AI.TYPE_NAAM[it.type].toLowerCase() ? ': ' + it.naam : '') + (al ? ' (staat er al)' : p.koppel === i ? ' (de toegangsdeur)' : it.zeker === 'laag' ? ' (onzeker)' : '');
          const knop = h('button', { type: 'button', class: 'opn-chip' + (p.kies.has(i) ? ' is-aan' : ''), disabled: !!al, 'aria-pressed': p.kies.has(i) ? 'true' : 'false', onclick: () => { if (p.kies.has(i)) p.kies.delete(i); else p.kies.add(i); knop.classList.toggle('is-aan', p.kies.has(i)); knop.setAttribute('aria-pressed', p.kies.has(i) ? 'true' : 'false'); telKnop(); } }, tekst);
          chips.appendChild(knop);
        }
        kaart.appendChild(chips);
      }
      if (!res.onderdelen.length) kaart.appendChild(h('p', { class: 'opn-hint', text: 'Niets vasts gevonden op deze wand.' }));
      if (res.los.length) { kaart.appendChild(h('div', { class: 'opn-label', text: AI.GROEP_NAAM.los })); kaart.appendChild(h('p', { class: 'opn-hint', text: res.los.map(x => x.naam || 'iets').join(', ') + '.' })); }
      return kaart;
    }
    let zetKnop = null;
    const telKnop = () => { if (!zetKnop) return; let n = 0; for (const w of ws) { const p = st.per[w]; if (p.staat === 'klaar' && p.kies) n += p.kies.size; } zetKnop.textContent = n ? 'Zet ' + n + (n === 1 ? ' onderdeel' : ' onderdelen') + ' in het draadmodel' : 'Zet het kader van de wanden in het draadmodel'; };
    function bouw() {
      X.leeg(inhoud); zetKnop = null;
      const wacht = ws.filter(w => st.per[w].staat === 'wacht').length, klaar = ws.filter(w => st.per[w].staat === 'klaar').length, fout = ws.filter(w => st.per[w].staat === 'fout').length;
      if (!ws.length) { inhoud.appendChild(h('p', { class: 'opn-hint', text: 'Er zijn nog geen wandfoto\'s. Maak eerst de fotoronde.' })); return; }
      if (!st.bezig && wacht === ws.length) {
        inhoud.appendChild(h('p', { text: 'De AI kijkt per wandfoto wat erop zit en maakt een voorstel: het kader van de wand, de openingen, wat vast zit en wat los staat. Jij vinkt aan wat klopt. Maten komen er niet uit de foto: die meet je daarna zelf.' }));
        inhoud.appendChild(h('p', { class: 'opn-hint', text: 'Hiervoor ' + (ws.length === 1 ? 'gaat de foto van deze wand' : 'gaan de ' + ws.length + ' wandfoto\'s') + ' verkleind naar de AI van de MT-tool (Claude). De rest van de opname blijft op dit toestel. Dit duurt ongeveer een halve minuut per foto.' }));
        inhoud.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', text: ws.length === 1 ? 'Start de herkenning' : 'Start de herkenning (' + ws.length + ' foto\'s)', onclick: () => start(false) }));
        return;
      }
      if (st.bezig) inhoud.appendChild(h('p', { class: 'opn-hint', text: 'Bezig: ' + klaar + ' van ' + ws.length + ' klaar. Laat dit scherm open.' }));
      for (const w of ws) inhoud.appendChild(wandKaart(w));
      if (st.bezig) { inhoud.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-licht', text: 'Stoppen na deze foto', onclick: () => { st.gestopt = true; } })); return; }
      if (klaar) { zetKnop = h('button', { type: 'button', class: 'opn-btn opn-btn-groot opn-btn-primair', onclick: zet }); telKnop(); inhoud.appendChild(zetKnop); }
      const rij = h('div', { class: 'opn-onderrij' });
      if (wacht || fout) rij.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: fout ? 'Mislukte foto\'s opnieuw proberen' : 'Verder met de rest', onclick: () => { for (const w of ws) if (st.per[w].staat === 'fout') st.per[w] = { staat: 'wacht' }; start(false); } }));
      if (klaar) rij.appendChild(h('button', { type: 'button', class: 'opn-btn opn-btn-klein', text: 'Alles opnieuw laten herkennen', onclick: () => start(true) }));
      inhoud.appendChild(rij);
    }
    X.blad(ws.length === 1 ? 'Herken uit de foto van wand ' + nr(ws[0]) : 'Herken uit de foto\'s', [inhoud]);
    bouw();
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
