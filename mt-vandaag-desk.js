/* ============================================================================
 * mt-vandaag-desk.js: "Vandaag" op de desktop, alleen in de nieuwe stijl (restyling fase 1, brok 5)
 * ----------------------------------------------------------------------------
 * Eén scherm in de zin van het canvas (Main.dc.html): Mijn werk vandaag, Vraagt aandacht, Team deze week, Leveringen en Mijn uren, met bovenaan
 * Taken vandaag / Gepland / Geklokt. Het leest alleen; er wordt niets geschreven of gestart. Alle cijfers komen uit dezelfde rekenregels als de telefoon
 * en de rest van de cockpit (mt-planning.js: mijnWerk, teamCapaciteit, letOp, entriesFilter), dus een dag geeft hier dezelfde getallen als op de telefoon.
 * Elke regel is een link naar de bron (project, planning, bestellijst). Tekent met DOM-calls, nooit met opgebouwde HTML. Alles komt van buiten via
 * init(deps), zodat het zonder de hele cockpit te testen is; bouwModel() is rekenwerk zonder DOM.
 * Niet in de oude stijl: zonder html[data-stijl="nieuw"] blijft #vandaag-desk leeg en verborgen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const V = {};
  let D = null, P = null, alleInplannen = false;   // alleInplannen: "Alle N tonen" bij Nog in te plannen
  const PROJECT_ACTIEF = ['werkvoorbereiding', 'inkoop', 'productie', 'klaar_levering'];   // zelfde lijst als P.letOp / de tv

  const MND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const nr = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  const ymd = n => { const t = new Date(n * 864e5); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(t.getUTCDate()).padStart(2, '0'); };
  const wd = n => ((n + 4) % 7 + 7) % 7;   // 0 = zondag
  function isoWeek(s) { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), dag = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - dag); return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const uren = min => P.fmtUurMin(min);
  const klok = min => { const n = Math.max(0, Math.round(min || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };   // 1:47
  const zelfde = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();

  function mijnSlug() {
    const ik = String(D.ik() || '').toLowerCase(), lid = (D.team() || []).find(m => String(m.email || '').toLowerCase() === ik);
    return lid ? lid.slug : ik.split('@')[0];
  }

  // ── rekenwerk (geen DOM) ──
  V.bouwModel = function () {
    const vandaag = P.vandaagYmd(), team = D.team() || [], vrij = D.vrij ? D.vrij() : null, verlof = D.verlof ? D.verlof() : null;
    const taken = D.taken(), afh = D.afhank(), blokken = D.blokken(), me = mijnSlug();
    const m = { vandaag, week: isoWeek(vandaag), takenKlaar: D.takenKlaar ? !!D.takenKlaar() : true, takenStatus: D.takenStatusTekst ? D.takenStatusTekst() : '' };
    // 1. Mijn werk vandaag: precies mijnWerk() zoals Vandaag op de telefoon en het startvenster (eigen werk, zonder "nieuw voor mij"), de groepen te laat en vandaag
    const wtl = D.werktijden ? D.werktijden() : null, mw = P.mijnWerk(taken, afh, blokken, { team, vandaag, nu: D.nu(), mijn: me, nieuw: false, vrij, verlof, capPerDag: P.capPerDagVoor(me, wtl) });
    m.mijn = mw.groepen.teLaat.concat(mw.groepen.vandaag).map(it => {
      const taak = it.soort === 'taak';
      const status = taak ? (it.status === 'todo' ? (it.wacht && it.wacht.wacht ? 'wacht' : 'open') : it.status) : 'gepland';
      const wanneer = taak ? (it.groep === 'teLaat' ? 'te laat sinds ' + P.datumKort(it.eind || it.start) : (it.blokken && it.blokken.length && it.blokken[0].start ? it.blokken[0].start : 'vandaag')) : (it.groep === 'teLaat' ? 'te laat' : (it.start || 'vandaag'));
      return { id: it.id, code: it.code, naam: taak ? it.taak.naam : it.naam, status, teLaat: it.groep === 'teLaat', wanneer, min: taak ? it.gepland_min : it.duurMin, wachtTekst: taak && status === 'wacht' ? (it.taak.wacht_reden || it.wachtTekst || '') : '' };
    });
    // 1b. Nog in te plannen: dezelfde mijnWerk()-uitkomst, de taken van mij (niet klaar) zonder start, einddatum en planblok. Een open voorstel (taak met voorstel-markering) telt pas na akkoord
    // en blijft er dus buiten; een taak die alleen een voorstel-planblok heeft wacht op akkoord en staat al in een datumgroep. Een taak die op een voorganger wacht en geen datum heeft hoort er ook bij
    // (precies de indeling van de Ongepland-kolom in de Capaciteit, waar "Inplannen" naartoe gaat).
    const RANG = { high: 0, medium: 1, low: 2 }, nrm = c => (D.nummer ? D.nummer(c) : c) || '';
    const zonder = mw.groepen.zonderDatum.concat(mw.groepen.nietVrij).filter(P.nogInTePlannen);   // dezelfde regel als de telefoon (P.nogInTePlannen)
    m.inplannen = zonder.map(it => ({ id: it.id, code: it.code, naam: it.taak.naam, min: it.gepland_min || 0, rang: RANG[it.taak.prioriteit] !== undefined ? RANG[it.taak.prioriteit] : 3, stempel: it.stempelToegewezen || 0, wacht: it.status === 'todo' && !!(it.wacht && it.wacht.wacht), wachtTekst: it.wachtTekst || '' }))
      .sort((a, b) => String(nrm(a.code)).localeCompare(String(nrm(b.code)), 'nl', { numeric: true }) || (a.rang - b.rang) || ((a.stempel || Infinity) - (b.stempel || Infinity) || 0) || String(a.naam).localeCompare(String(b.naam), 'nl'));
    m.magInplannen = D.magInplannen ? !!D.magInplannen() : false;
    const dag = mw.week && mw.week.dagen.find(d => d.datum === vandaag);
    const entries = D.uren ? D.uren() : [];
    const ma = ymd(nr(vandaag) - ((wd(nr(vandaag)) + 6) % 7)), zo = ymd(nr(ma) + 6);
    const minVan = (van, tot) => P.entriesFilter(entries, { pers: [me], van, tot, team }).reduce((s, e) => s + P.entryMin(e), 0);
    m.getallen = { taken: m.mijn.length, gepland_min: dag ? dag.gepland_min : 0, geklokt_min: minVan(vandaag, vandaag) };
    const wu = D.werkuren ? D.werkuren() : null;
    m.uren = { week_min: minVan(ma, zo), doel_min: Math.round((wu && Number(wu[me]) > 0 ? Number(wu[me]) : 40) * 60) };
    // 2. Team deze week: teamCapaciteit() met één week, zoals de Capaciteit-weergave
    const k = P.teamCapaciteit(taken, afh, blokken, { team, vandaag, weken: 1, vrij, verlof, werkuren: wu, werktijden: wtl });
    m.team = k.rijen.filter(r => r.heeftCap).map(r => {
      const w = r.weken[0] || { vrij_min: 0, over_min: 0, cap_min: 0 };
      return { slug: r.slug, naam: r.naam, dagen: r.dagen.map(c => ({ datum: c.datum, werkdag: c.werkdag, verlof: c.verlof, cap_min: c.cap_min, gepland_min: c.gepland_min, over_min: c.over_min, nu: c.datum === vandaag })),
        vrij_min: w.vrij_min, over_min: w.over_min, tekst: w.over_min > 0 ? '+' + uren(w.over_min) + ' over' : (w.cap_min > 0 && w.vrij_min === 0 ? 'vol' : uren(w.vrij_min) + ' vrij') };
    });
    // 3. Vraagt aandacht: overbelasting (Capaciteit), open voorstellen, en letOp() (te laat, wacht op materiaal, nieuw gemeld), plus de wachtrij van Larry
    const projecten = D.projecten ? D.projecten() : [], lo = P.letOp(taken, afh, projecten, D.bestel ? D.bestel() : [], { vandaag, team, vrij });
    const a = []; m.aandacht = a;
    k.rijen.filter(r => r.heeftCap).forEach(r => {
      const c = r.dagen.find(x => x.over_min > 0 && x.datum >= vandaag); if (!c) return;
      a.push({ soort: 'over', titel: r.naam + ' staat ' + P.datumKort(c.datum) + ' ' + uren(c.over_min) + ' over', sub: c.items.slice(0, 2).map(i => i.naam).join(' · ') + (c.items.length > 2 ? ' …' : ''), actie: { k: 'agenda', view: 'capaciteit' } });
    });
    const pv = (blokken || []).filter(b => b && !b._vervallen && b.status === 'voorstel' && !(b.voorstel && b.voorstel.afgewezen)).length;
    if (pv) a.push({ soort: 'voorstel', titel: pv + (pv === 1 ? ' open planvoorstel' : ' open planvoorstellen'), sub: 'Wacht op akkoord in de Planning', actie: { k: 'agenda', view: 'capaciteit' } });
    lo.nieuwGemeld.forEach(i => a.push({ soort: 'voorstel', titel: i.soort === 'bestel' ? 'Voorstel voor de bestellijst' : 'Voorstel van de werkplaats', sub: i.naam + ' · ' + i.code, actie: i.soort === 'bestel' ? { k: 'tab', tab: 'bestelling' } : { k: 'project', code: i.code } }));
    if (lo.teLaat.length) { const e = lo.teLaat[0]; a.push({ soort: 'telaat', titel: lo.teLaat.length + (lo.teLaat.length === 1 ? ' taak te laat' : ' taken te laat'), sub: lo.teLaat.slice(0, 2).map(i => i.naam + ' (' + i.code + ')').join(' · ') + (lo.teLaat.length > 2 ? ' …' : ''), actie: { k: 'project', code: e.code } }); }
    lo.wachtMateriaal.slice(0, 4).forEach(i => a.push({ soort: 'materiaal', titel: 'Wacht op materiaal', sub: (i.soort === 'bestel' ? i.naam : (i.naam + (i.reden ? ' · ' + i.reden : ''))) + ' · ' + i.code, actie: i.soort === 'bestel' ? { k: 'tab', tab: 'bestelling' } : { k: 'project', code: i.code } }));
    const larry = D.larry ? Number(D.larry()) || 0 : 0;
    if (larry) a.push({ soort: 'larry', titel: larry + (larry === 1 ? ' item van Larry' : ' items van Larry'), sub: 'Review-wachtrij: onderaan deze pagina', actie: { k: 'larry' } });
    // 4. Leveringen komende 4 weken: actieve projecten met een leverdatum tot 4 weken vooruit (te late leverdatums met nog open taken ook)
    const eind = ymd(nr(vandaag) + 28);
    m.leveringen = projecten.filter(p => p && !p._vervallen && p.code && PROJECT_ACTIEF.includes(p.fase)).map(p => {
      const lever = P.isYmd(p.gegevens && p.gegevens.leverdatum) ? p.gegevens.leverdatum : ''; if (!lever || lever > eind) return null;
      const sl = Object.keys(taken || {}).find(c => zelfde(c, p.code)), open = (sl ? P.takenActief(taken[sl]) : []).filter(t => (t.status || 'todo') !== 'klaar').length;
      if (lever < vandaag && !open) return null;
      return { code: p.code, naam: p.naam || p.code, lever, open, teLaat: lever < vandaag, week: isoWeek(lever) };
    }).filter(Boolean).sort((x, y) => x.lever < y.lever ? -1 : x.lever > y.lever ? 1 : 0);
    return m;
  };

  // ── tekenen ──
  function el(tag, props, ...kids) {
    const e = D.doc.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else e.setAttribute(k, v === true ? '' : v);
    });
    kids.flat(2).forEach(x => { if (x === null || x === undefined || x === false) return; e.appendChild(typeof x === 'string' ? D.doc.createTextNode(x) : x); });
    return e;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svg(paden, klass) { const s = D.doc.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', klass || 'vd-ic'); paden.forEach(d => { const p = D.doc.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p); }); return s; }
  const IC = {
    over: ['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01'],
    voorstel: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
    materiaal: ['M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4M17 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4'],
    telaat: ['M12 7v5l3 2M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0'],
    larry: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
    pijl: ['M9 6l6 6l-6 6']
  };
  const STATUS = { open: 'Open', bezig: 'Bezig', wacht: 'Wacht', gepland: 'Gepland', klaar: 'Klaar' };
  function statusIcoon(s) {
    const e = D.doc.createElementNS(NS, 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('aria-hidden', 'true'); e.setAttribute('class', 'vd-st vd-st-' + s);
    const c = D.doc.createElementNS(NS, 'path'); c.setAttribute('d', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'); e.appendChild(c);
    if (s === 'bezig') { const h = D.doc.createElementNS(NS, 'path'); h.setAttribute('d', 'M12 6a6 6 0 0 1 0 12z'); h.setAttribute('class', 'vd-vul'); e.appendChild(h); }
    if (s === 'wacht') { const h = D.doc.createElementNS(NS, 'path'); h.setAttribute('d', 'M10 9v6M14 9v6'); e.appendChild(h); }
    return e;
  }
  function koppeling(actie, kids, klass) {
    const href = actie.k === 'project' ? D.href({ code: actie.code }) : actie.k === 'agenda' ? D.href({ tab: 'agenda' }) : actie.k === 'tab' ? D.href({ tab: actie.tab }) : '#';
    return el('a', { klass, href, klik: ev => { if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1) return; ev.preventDefault(); D.ga(actie); } }, kids);
  }
  function sectie(id, titel, rechts, kids, extra) {
    return el('section', { klass: 'vd-sec' + (extra ? ' ' + extra : ''), 'aria-labelledby': id }, el('div', { klass: 'vd-sec-kop' }, el('span', { id, tekst: titel }), rechts || null), kids);
  }
  const leeg = t => el('div', { klass: 'vd-leeg', tekst: t });

  V.teken = function () {
    const w = D && D.doc.getElementById('vandaag-desk'); if (!w) return;
    if (D.doc.documentElement.getAttribute('data-stijl') !== 'nieuw') { w.textContent = ''; w.hidden = true; return; }
    w.hidden = false; w.textContent = '';
    let m; try { m = V.bouwModel(); } catch (e) { console.warn('Vandaag (desktop):', e); w.appendChild(leeg('Vandaag kon niet worden berekend.')); return; }
    V.laatste = m;
    const n = nr(m.vandaag), dagNaam = DAG[wd(n)], d = Number(m.vandaag.slice(8)), mnd = MND[Number(m.vandaag.slice(5, 7)) - 1];
    // kop + drie getallen
    const getal = (l, v, kl) => el('div', { klass: 'vd-getal' }, el('span', { klass: 'vd-label', tekst: l }), el('span', { klass: 'vd-num' + (kl ? ' ' + kl : ''), tekst: v }));
    w.appendChild(el('div', { klass: 'vd-kop' },
      el('div', { klass: 'vd-datum' }, el('span', { klass: 'vd-sub', tekst: P.datumKort(m.vandaag) + ' · week ' + m.week }), el('h2', { klass: 'vd-titel', tekst: cap1(dagNaam) + ' ' + d + ' ' + mnd })),
      el('div', { klass: 'vd-getallen' }, getal('Taken vandaag', String(m.getallen.taken)), getal('Gepland', klok(m.getallen.gepland_min)), getal('Geklokt', klok(m.getallen.geklokt_min), 'vd-groen'))));
    if (!m.takenKlaar) w.appendChild(el('div', { klass: 'vd-melding', role: 'status', tekst: (m.takenStatus || 'De takenlijst is nog niet geladen.') + ' Je ziet alleen wat er al staat.' }));
    const raster = el('div', { klass: 'vd-raster' });
    // Mijn werk vandaag
    const mijnLijst = m.mijn.length ? m.mijn.map(t => koppeling({ k: 'project', code: t.code }, [
      statusIcoon(t.status),
      el('span', { klass: 'vd-tekst' }, el('span', { klass: 'vd-naam', tekst: t.naam }), el('span', { klass: 'vd-regel' + (t.status === 'wacht' || t.teLaat ? ' vd-warn' : '') }, el('i', { klass: 'vd-blokje', style: 'background:' + P.projectKleur(t.code) }), el('span', { klass: 'vd-code', tekst: D.nummer ? D.nummer(t.code) : t.code }), el('span', { tekst: (D.projectNaam ? D.projectNaam(t.code) : '') + ' · ' + (t.status === 'wacht' && t.wachtTekst ? 'wacht: ' + t.wachtTekst : t.wanneer) }))),
      el('span', { klass: 'vd-chip vd-chip-' + (t.teLaat ? 'telaat' : t.status), tekst: t.teLaat ? 'Te laat' : STATUS[t.status] || t.status }),
      el('span', { klass: 'vd-uren', tekst: t.min ? klok(t.min) : '' })], 'vd-taak')) : [leeg('Niets voor jou vandaag.')];
    raster.appendChild(sectie('vd-h-mijn', 'Mijn werk vandaag', el('a', { klass: 'vd-meer', href: D.href({ tab: 'agenda' }), klik: ev => { ev.preventDefault(); D.ga({ k: 'agenda', view: 'mijnwerk' }); }, tekst: 'Alles in Mijn werk' }), mijnLijst, 'vd-breed'));
    // Nog in te plannen: mijn taken zonder datum en zonder planblok, max 8 zichtbaar; de knop gebruikt de bestaande Capaciteit-route (alleen met het recht om te plannen)
    {
      const lijst = m.inplannen, MAXI = 8, zichtbaar = alleInplannen ? lijst : lijst.slice(0, MAXI);
      const rij = t => el('div', { klass: 'vd-inplrij' },
        koppeling({ k: 'project', code: t.code }, [el('span', { klass: 'vd-tekst' }, el('span', { klass: 'vd-naam', tekst: t.naam }), el('span', { klass: 'vd-regel' }, el('i', { klass: 'vd-blokje', style: 'background:' + P.projectKleur(t.code) }), el('span', { klass: 'vd-code', tekst: D.nummer ? D.nummer(t.code) : t.code }), el('span', { tekst: (D.projectNaam ? D.projectNaam(t.code) : '') + (t.wacht ? ' · wacht op ' + (t.wachtTekst || 'een voorganger') : '') })))], 'vd-inplink'),
        el('span', { klass: 'vd-uren', tekst: t.min ? klok(t.min) : '' }),
        m.magInplannen ? el('button', { type: 'button', klass: 'vd-inplknop', 'aria-label': 'Plan ' + t.naam + ' in', klik: () => D.ga({ k: 'inplannen', taak: { id: t.id, code: t.code, naam: t.naam, min: t.min } }) }, 'Inplannen') : null);
      const inhoud = lijst.length ? zichtbaar.map(rij) : [leeg(m.takenKlaar ? 'Alles is ingepland' : 'De takenlijst is nog niet geladen.')];
      if (lijst.length > MAXI) inhoud.push(el('div', { klass: 'vd-inplmeer' }, el('button', { type: 'button', id: 'vd-inpl-meer', klass: 'vd-meer', 'aria-expanded': alleInplannen ? 'true' : 'false', klik: () => { alleInplannen = !alleInplannen; V.teken(); const b = D.doc.getElementById('vd-inpl-meer'); if (b && b.focus) b.focus(); }, tekst: alleInplannen ? 'Minder tonen' : 'Alle ' + lijst.length + ' tonen' })));
      raster.appendChild(sectie('vd-h-inplannen', 'Nog in te plannen', el('span', { klass: 'vd-teller', tekst: String(lijst.length) }), inhoud, 'vd-breed'));
    }
    // Vraagt aandacht
    const aand =m.aandacht.length ? m.aandacht.map(x => koppeling(x.actie, [el('span', { klass: 'vd-blok vd-blok-' + x.soort }, svg(IC[x.soort] || IC.voorstel)), el('span', { klass: 'vd-tekst' }, el('span', { klass: 'vd-naam', tekst: x.titel }), el('span', { klass: 'vd-regel', tekst: x.sub })), svg(IC.pijl, 'vd-ic vd-pijl')], 'vd-rij')) : [leeg('Niets dat aandacht vraagt.')];
    raster.appendChild(sectie('vd-h-aandacht', 'Vraagt aandacht', el('span', { klass: 'vd-teller', tekst: String(m.aandacht.length) }), aand));
    // Team deze week
    const team = m.team.length ? m.team.map(t => koppeling({ k: 'agenda', view: 'capaciteit' }, [
      el('span', { klass: 'vd-avatar', tekst: String(t.naam || '').slice(0, 2).toUpperCase() }),
      el('span', { klass: 'vd-tekst' }, el('span', { klass: 'vd-naam', tekst: t.naam }), el('span', { klass: 'vd-regel', tekst: uren(t.dagen.reduce((s, c) => s + c.gepland_min, 0)) + ' gepland' })),
      el('span', { klass: 'vd-dagen', role: 'img', 'aria-label': t.dagen.map(c => P.datumKort(c.datum) + ': ' + (c.verlof ? 'verlof' : !c.werkdag ? 'vrij' : uren(c.gepland_min) + ' van ' + uren(c.cap_min))).join(', ') }, t.dagen.map(c => el('span', { klass: 'vd-dag' + (c.nu ? ' nu' : '') + (!c.werkdag || c.verlof ? ' vrij' : '') }, c.werkdag && !c.verlof && c.cap_min > 0 ? el('span', { klass: 'vd-vul' + (c.over_min > 0 ? ' over' : ''), style: 'height:' + Math.min(100, Math.round(c.gepland_min / c.cap_min * 100)) + '%' }) : null))),
      el('span', { klass: 'vd-vrij' + (t.over_min > 0 ? ' over' : ''), tekst: t.tekst })], 'vd-rij vd-teamrij')) : [leeg('Geen teamleden.')];
    raster.appendChild(sectie('vd-h-team', 'Team deze week', el('a', { klass: 'vd-meer', href: D.href({ tab: 'agenda' }), klik: ev => { ev.preventDefault(); D.ga({ k: 'agenda', view: 'capaciteit' }); }, tekst: 'Capaciteit' }), team));
    // Leveringen
    const lev = m.leveringen.length ? m.leveringen.map(l => koppeling({ k: 'project', code: l.code }, [
      el('span', { klass: 'vd-wk', tekst: 'week ' + l.week }), el('i', { klass: 'vd-ruit', 'aria-hidden': 'true' }),
      el('span', { klass: 'vd-tekst' }, el('span', { klass: 'vd-naam', tekst: (D.nummer ? D.nummer(l.code) : l.code) + ' ' + l.naam }), el('span', { klass: 'vd-regel', tekst: 'levering ' + P.datumKort(l.lever) + ' · ' + (l.open ? l.open + (l.open === 1 ? ' taak open' : ' taken open') : 'alles klaar') })),
      el('span', { klass: 'vd-chip vd-chip-' + (l.teLaat ? 'telaat' : l.open ? 'bezig' : 'klaar'), tekst: l.teLaat ? 'Te laat' : l.open ? 'Bezig' : 'Klaar' })], 'vd-rij vd-lever')) : [leeg('Geen leveringen de komende 4 weken.')];
    raster.appendChild(sectie('vd-h-lever', 'Leveringen', el('span', { klass: 'vd-sub', tekst: 'komende 4 weken' }), lev));
    // Mijn uren
    const pct = m.uren.doel_min ? Math.min(100, Math.round(m.uren.week_min / m.uren.doel_min * 100)) : 0;
    raster.appendChild(sectie('vd-h-uren', 'Mijn uren', el('a', { klass: 'vd-meer', href: D.href({ tab: 'toggl' }), klik: ev => { ev.preventDefault(); D.ga({ k: 'tab', tab: 'toggl' }); }, tekst: 'Naar Uren' }),
      el('div', { klass: 'vd-uren-blok' }, el('div', { klass: 'vd-uren-rij' }, el('span', { klass: 'vd-num-l', tekst: klok(m.uren.week_min) }), el('span', { klass: 'vd-sub', tekst: '/ ' + klok(m.uren.doel_min) + ' deze week' })),
        el('div', { klass: 'vd-balk', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Uren deze week' }, el('span', { style: 'width:' + pct + '%' })))));
    w.appendChild(raster);
    // de wachtrij van Larry blijft ongewijzigd eronder
    w.appendChild(el('h3', { klass: 'vd-larry-kop', id: 'vd-larry-kop', tekst: 'Review-wachtrij van Larry' }));
  };

  V.init = function (deps) { D = deps; P = deps.planning || root.MTPlanning; return V; };
  root.MTVandaagDesk = V;
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
})(typeof window !== 'undefined' ? window : globalThis);
