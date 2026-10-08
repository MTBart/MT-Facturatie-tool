// mt-rapport.js — tabblad Rapporten (G8): de rapporten voor de CEO-avond, met per sectie een oordeel, cijfers met
// branchevergelijking, tekst, acties en een draad "vraag / opmerking". Alleen met recht `geld` (de worker dwingt dat
// af): de eigenaar vinkt acties af, de administratie leest en stelt vragen. Claude zet de rapporten en antwoorden in KV.
// Alle tekst uit een rapport wordt ge-escaped; de tekst kent alleen beperkte markdown (alinea's, **vet**, lijstjes, tabellen).
(function (root) {
  'use strict';
  const R = root.MTRapport = root.MTRapport || {};
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OORDEEL = { groen: { l: 'goed', k: 'g', rang: 3 }, oranje: { l: 'let op', k: 'o', rang: 2 }, rood: { l: 'actie nodig', k: 'r', rang: 1 }, neutraal: { l: 'neutraal', k: 'n', rang: null } };
  const oordeel = o => OORDEEL[o] || OORDEEL.neutraal;
  const MAX_TEKST = 2000;
  const st = R._st = { el: null, bron: null, mag: false, magVragen: false, index: [], open: {}, id: null, data: null, vorige: null, openSec: Object.create(null), lokaal: [], concept: Object.create(null), bezig: false, ixCompleet: true };
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  // ── Beperkte markdown → HTML (eerst escapen, dan alleen **vet**, lijstjes en tabellen) ──
  R.md = function (t) {
    const inl = s => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    const cellen = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    return String(t == null ? '' : t).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(b => {
      const rr = b.split('\n').filter(x => x.trim() !== ''); if (!rr.length) return '';
      if (rr.every(x => /^\s*\|/.test(x))) {
        const scheid = r => cellen(r).every(c => /^:?-{2,}:?$/.test(c));
        const kop = rr.length > 1 && scheid(rr[1]) ? cellen(rr[0]) : null, body = rr.filter((r, i) => !(kop && i < 2) && !scheid(r));
        return `<div class="mtr-tabel"><table>${kop ? `<thead><tr>${kop.map(c => `<th>${inl(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.map(r => `<tr>${cellen(r).map(c => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      }
      if (rr.every(x => /^\s*[-*]\s+/.test(x))) return `<ul>${rr.map(x => `<li>${inl(x.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      if (rr.every(x => /^\s*\d+[.)]\s+/.test(x))) return `<ol>${rr.map(x => `<li>${inl(x.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      return `<p>${rr.map(inl).join('<br>')}</p>`;
    }).join('');
  };
  // Wat is er veranderd t.o.v. het vorige rapport: oordeel per sectie (op sectie-id).
  R.verschil = function (nu, vorige) {
    if (!nu || !vorige) return null;
    const oud = new Map((vorige.secties || []).filter(s => s && s.id != null).map(s => [String(s.id), s])), uit = { anders: [], nieuw: [], weg: [], gelijk: 0 };
    for (const s of nu.secties || []) {
      if (!s || s.id == null) continue;
      const o = oud.get(String(s.id)); oud.delete(String(s.id));
      if (!o) { uit.nieuw.push(s); continue; }
      const a = oordeel(o.oordeel), b = oordeel(s.oordeel);
      if (a === b) { uit.gelijk++; continue; }
      uit.anders.push({ sectie: s, van: o.oordeel in OORDEEL ? o.oordeel : 'neutraal', naar: s.oordeel in OORDEEL ? s.oordeel : 'neutraal', richting: a.rang == null || b.rang == null ? null : b.rang > a.rang ? 'beter' : 'slechter' });
    }
    uit.weg = [...oud.values()];
    return uit;
  };

  function css() {
    if (document.getElementById('mtr-css')) return;
    const s = document.createElement('style'); s.id = 'mtr-css';
    s.textContent = `
.mtr{--mtr-g:#2A7A4A;--mtr-o:#B7791F;--mtr-r:#B4412F;--mtr-zacht:var(--text-faint,#8a8a80);font-size:15px;max-width:900px;margin:0 auto;line-height:1.45}
.mtr *{box-sizing:border-box}
.mtr-kop{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 10px}.mtr-kop h2{margin:0;flex:1}
.mtr-kop select{padding:7px 9px;border:1px solid var(--border,#ccc);border-radius:8px;font-size:14px;max-width:100%}
.mtr-kaart,.mtr-sec{background:var(--card,#fff);border:1px solid var(--border,#e4e2da);border-radius:10px;padding:12px 14px;margin-bottom:12px}
.mtr-zacht{color:var(--mtr-zacht);font-size:13px}
.mtr-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.mtr-chip{display:inline-flex;align-items:center;gap:5px;border-radius:14px;padding:3px 10px;font-size:13px;border:1px solid transparent;background:#eeede7;color:#555;cursor:pointer;font:inherit;font-size:13px;min-height:30px}
.mtr-chip::before{content:"";width:9px;height:9px;border-radius:50%;background:#9a9a92}
.mtr-chip.g{background:#e3f1e8;color:var(--mtr-g)}.mtr-chip.g::before{background:var(--mtr-g)}
.mtr-chip.o{background:#fbf0dc;color:#8a5a12}.mtr-chip.o::before{background:var(--mtr-o)}
.mtr-chip.r{background:#fbe3dd;color:var(--mtr-r)}.mtr-chip.r::before{background:var(--mtr-r)}
.mtr-sec>summary{cursor:pointer;list-style:none}.mtr-sec>summary::-webkit-details-marker{display:none}
.mtr-sec>summary .t{font-weight:600;margin:0 6px}.mtr-kern{margin-top:4px;color:#444}
.mtr-sec[open]>summary{border-bottom:1px solid var(--border,#eee);padding-bottom:8px;margin-bottom:8px}
.mtr-badge{display:inline-block;background:var(--mtr-r);color:#fff;border-radius:10px;padding:0 7px;font-size:12px;margin-left:4px}
.mtr-tabel{overflow-x:auto;margin:8px 0}.mtr-tabel table{border-collapse:collapse;width:100%;font-size:14px}
.mtr-tabel th,.mtr-tabel td{border-bottom:1px solid var(--border,#eee);padding:5px 8px;text-align:left;vertical-align:top}
.mtr-tabel th{font-size:12px;color:var(--mtr-zacht);font-weight:600}
.mtr-acties{list-style:none;padding:0;margin:6px 0}.mtr-acties li{margin:6px 0}.mtr-acties label{display:flex;gap:8px;align-items:flex-start}
.mtr-acties input{margin-top:3px;width:18px;height:18px}.mtr-gedaan{text-decoration:line-through;color:var(--mtr-zacht)}
.mtr-draad{margin-top:10px;border-top:1px dashed var(--border,#ddd);padding-top:8px}
.mtr-bericht{background:#f4f3ee;border-radius:10px;padding:7px 10px;margin:6px 0;white-space:pre-wrap;word-wrap:break-word}
.mtr-bericht.claude{background:#e8eef9;margin-left:18px}.mtr-bericht .wie{font-size:12px;color:var(--mtr-zacht);white-space:normal;margin-bottom:2px}
.mtr-draad textarea{width:100%;min-height:64px;padding:8px;border:1px solid var(--border,#ccc);border-radius:8px;font:inherit;font-size:15px}
.mtr-knop{border:1px solid var(--border,#ddd);background:var(--card,#fff);border-radius:16px;padding:5px 12px;font-size:14px;cursor:pointer;min-height:34px}
.mtr-knop.aan{background:var(--green,#2A4A38);color:#fff;border-color:transparent}
.mtr-veranderd li{margin:3px 0}
.mtr-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--green,#2A4A38);color:#fff;padding:9px 14px;border-radius:20px;font-size:13px;z-index:9100}
@media(max-width:600px){.mtr{font-size:15px}.mtr-kaart,.mtr-sec{padding:10px 11px}.mtr-cijfers thead{display:none}.mtr-cijfers tr{display:block;padding:6px 0;border-bottom:1px solid var(--border,#eee)}
.mtr-cijfers td{display:block;border:0;padding:1px 0}.mtr-cijfers td[data-l]::before{content:attr(data-l) ": ";color:var(--mtr-zacht);font-size:12px}}
`;
    document.head.appendChild(s);
  }
  function toast(t) { const o = document.createElement('div'); o.className = 'mtr-toast'; o.textContent = t; document.body.appendChild(o); setTimeout(() => o.remove(), 3500); }
  const wanneer = ts => { if (!ts) return ''; try { return new Date(ts).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  // ── Laden ──
  R.start = async function (el, opties) {
    st.el = el; st.bron = opties.bron; st.mag = !!opties.magWijzigen; st.magVragen = opties.magVragen !== false; st.wie = opties.wie || ''; st.opBadge = opties.opBadge || null;
    css();
    el.innerHTML = '<div class="mtr"><div class="mtr-zacht">Rapporten laden…</div></div>';
    await R.laad();
  };
  R.laad = async function () {
    const ix = await st.bron.haal('/geld/rapporten');
    if (!ix || ix.error) { st.el.innerHTML = `<div class="mtr"><div class="mtr-kaart">Rapporten konden niet worden geladen${ix && ix.error ? ': ' + esc(ix.error) : ''}.</div></div>`; return; }
    st.index = ix.rapporten || []; st.open = ix.open || {}; st.ixCompleet = ix.compleet !== false;
    if (st.opBadge) st.opBadge(ix.open_totaal || 0);
    if (!st.index.length) { st.el.innerHTML = '<div class="mtr"><div class="mtr-kop"><h2>Rapporten</h2></div><div class="mtr-kaart">Nog geen rapporten. Claude zet ze hier klaar voor de CEO-avond.</div></div>'; return; }
    const bewaard = ls.get('mtr:id:' + st.wie);
    await R.kies(st.id && st.index.some(x => x.id === st.id) ? st.id : bewaard && st.index.some(x => x.id === bewaard) ? bewaard : st.index[0].id);
  };
  R.kies = async function (id) {
    st.id = id; ls.set('mtr:id:' + st.wie, id);
    const i = st.index.findIndex(x => x.id === id), vorigeId = i >= 0 && st.index[i + 1] ? st.index[i + 1].id : null;
    const [d, v] = await Promise.all([st.bron.haal('/geld/rapport?id=' + encodeURIComponent(id)), vorigeId ? st.bron.haal('/geld/rapport?id=' + encodeURIComponent(vorigeId)) : Promise.resolve(null)]);
    if (!d || d.error || !d.rapport) { st.el.innerHTML = `<div class="mtr"><div class="mtr-kaart">Rapport kon niet worden geladen${d && d.error ? ': ' + esc(d.error) : ''}${d && d.fout ? ' (' + esc(d.fout) + ')' : ''}.</div></div>`; return; }
    st.data = d; st.vorige = v && v.rapport ? Object.assign({ _id: vorigeId }, v.rapport) : null;
    teken();
  };
  // Net verstuurde vragen tonen tot de server ze ook ziet (KV kan even achterlopen), hooguit 3 minuten.
  function vragen() {
    const srv = (st.data && st.data.vragen) || [], ids = new Set(srv.map(x => x.id));
    st.lokaal = st.lokaal.filter(x => Date.now() - x.t < 180000 && !ids.has(x.v.id));
    return srv.concat(st.lokaal.filter(x => x.v.rapport_id === st.id).map(x => x.v));
  }
  function actieStatus(a) { const o = (st.data.acties || {})[a.id]; return o ? o : { status: a.status === 'gedaan' ? 'gedaan' : 'open' }; }

  // ── Tekenen ──
  function teken() {
    const r = st.data.rapport, secties = (Array.isArray(r.secties) ? r.secties : []).filter(s => s && s.id != null), vr = vragen();
    const openPer = Object.create(null); for (const q of vr) if (q.open) openPer[q.sectie_id] = (openPer[q.sectie_id] || 0) + 1;
    const onvolledig = st.data.compleet === false || !st.ixCompleet;
    const vs = R.verschil(r, st.vorige);
    const veranderd = !vs ? '' : `<div class="mtr-veranderd" style="margin-top:10px"><b>Wat is er veranderd t.o.v. ${esc((st.index.find(x => x.id === st.vorige._id) || {}).titel || st.vorige._id)}</b>
      ${vs.anders.length || vs.nieuw.length || vs.weg.length ? `<ul>${vs.anders.map(x => `<li>${esc(x.sectie.titel || x.sectie.id)}: <span class="mtr-chip ${oordeel(x.van).k}">${esc(oordeel(x.van).l)}</span> → <span class="mtr-chip ${oordeel(x.naar).k}">${esc(oordeel(x.naar).l)}</span>${x.richting ? ` (${x.richting})` : ''}</li>`).join('')}
        ${vs.nieuw.map(s => `<li>Nieuw: ${esc(s.titel || s.id)}</li>`).join('')}${vs.weg.map(s => `<li>Niet meer in dit rapport: ${esc(s.titel || s.id)}</li>`).join('')}</ul>` : '<div class="mtr-zacht">Geen oordelen veranderd.</div>'}</div>`;
    st.el.innerHTML = `<div class="mtr">
  <div class="mtr-kop"><h2>Rapporten</h2>${st.index.length > 1 ? `<select data-kies="1" aria-label="Kies een rapport">${st.index.map(x => `<option value="${esc(x.id)}" ${x.id === st.id ? 'selected' : ''}>${esc(x.titel)}${x.periode ? ' — ' + esc(x.periode) : ''}${st.open[x.id] ? ` (${st.open[x.id]} open)` : ''}</option>`).join('')}</select>` : ''}</div>
  <div class="mtr-kaart"><h3 style="margin:0">${esc(r.titel || st.id)}</h3><div class="mtr-zacht">${esc([r.periode, r.gemaakt ? 'gemaakt ' + r.gemaakt : ''].filter(Boolean).join(' · '))}</div>
    ${Array.isArray(r.samenvatting) && r.samenvatting.length ? `<ul>${r.samenvatting.map(z => `<li>${R.md(z).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>` : ''}
    <div class="mtr-chips">${secties.map(s => `<button class="mtr-chip ${oordeel(s.oordeel).k}" data-naar="${esc(s.id)}" title="${esc(oordeel(s.oordeel).l)}">${esc(s.titel || s.id)}${openPer[s.id] ? ` <span class="mtr-badge">${openPer[s.id]}</span>` : ''}</button>`).join('')}</div>
    ${veranderd}${onvolledig ? '<div class="mtr-zacht" style="margin-top:8px">Let op: niet alle vragen konden worden geladen (te veel); tellingen kunnen hoger zijn.</div>' : ''}</div>
  ${secties.map(s => sectieHtml(s, vr.filter(q => q.sectie_id === String(s.id)), openPer[s.id] || 0)).join('')}
</div>`;
    st.el.querySelectorAll('details.mtr-sec').forEach(d => d.addEventListener('toggle', () => { st.openSec[d.dataset.sec] = d.open; }));
    st.el.querySelectorAll('textarea[data-tekst]').forEach(x => x.addEventListener('input', () => { st.concept[st.id + ':' + x.dataset.tekst] = x.value; }));
    st.el.querySelector('.mtr').addEventListener('click', klik);
    const kies = st.el.querySelector('[data-kies]'); if (kies) kies.addEventListener('change', () => R.kies(kies.value));
  }
  function sectieHtml(s, draad, nOpen) {
    const o = oordeel(s.oordeel), id = String(s.id), cijfers = Array.isArray(s.cijfers) ? s.cijfers.filter(Boolean) : [], branche = cijfers.some(c => c.branche != null && c.branche !== ''), toel = cijfers.some(c => c.toelichting);
    const acties = Array.isArray(s.acties) ? s.acties.filter(a => a && a.id != null) : [], bronnen = Array.isArray(s.bronnen) ? s.bronnen : s.bronnen ? [s.bronnen] : [];
    const bron = b => typeof b === 'string' ? esc(b) : b && typeof b === 'object' ? (/^https:\/\//i.test(String(b.url || '')) ? `<a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.titel || b.url)}</a>` : esc(b.titel || '')) : '';
    return `<details class="mtr-sec" id="mtr-sec-${esc(id)}" data-sec="${esc(id)}" ${st.openSec[id] ? 'open' : ''}>
  <summary><span class="mtr-chip ${o.k}">${esc(o.l)}</span><span class="t">${esc(s.titel || id)}</span>${nOpen ? `<span class="mtr-badge">${nOpen} open vra${nOpen === 1 ? 'ag' : 'gen'}</span>` : ''}${s.kern ? `<div class="mtr-kern">${esc(s.kern)}</div>` : ''}</summary>
  ${cijfers.length ? `<div class="mtr-tabel"><table class="mtr-cijfers"><thead><tr><th>Cijfer</th><th>Waarde</th>${branche ? '<th>Branche</th>' : ''}${toel ? '<th>Toelichting</th>' : ''}</tr></thead><tbody>${cijfers.map(c => `<tr><td><b>${esc(c.label)}</b></td><td data-l="Waarde">${esc(c.waarde)}</td>${branche ? `<td data-l="Branche">${esc(c.branche == null ? '—' : c.branche)}</td>` : ''}${toel ? `<td data-l="Toelichting">${esc(c.toelichting || '')}</td>` : ''}</tr>`).join('')}</tbody></table></div>` : ''}
  ${s.tekst ? `<div class="mtr-tekst">${R.md(s.tekst)}</div>` : ''}
  ${acties.length ? `<b>Acties</b><ul class="mtr-acties">${acties.map(a => { const x = actieStatus(a), klaar = x.status === 'gedaan'; return `<li><label><input type="checkbox" data-actie="${esc(a.id)}" ${klaar ? 'checked' : ''} ${st.mag ? '' : 'disabled'}><span><span class="${klaar ? 'mtr-gedaan' : ''}">${esc(a.tekst)}</span>${a.wie ? ` <span class="mtr-zacht">— ${esc(a.wie)}</span>` : ''}${klaar && x.door ? `<br><span class="mtr-zacht">gedaan door ${esc(x.door)}${x.ts ? ', ' + esc(wanneer(x.ts)) : ''}</span>` : ''}</span></label></li>`; }).join('')}</ul>` : ''}
  ${bronnen.length ? `<div class="mtr-zacht">Bronnen: ${bronnen.map(bron).filter(Boolean).join(' · ')}</div>` : ''}
  <div class="mtr-draad"><b>Vraag / opmerking</b>
    ${draad.map(q => `<div class="mtr-bericht"><div class="wie">${esc(q.door || 'onbekend')} · ${esc(wanneer(q.ts))}${q.open ? ' · wacht op antwoord' : ''}</div>${esc(q.tekst)}</div>${(q.antwoorden || []).map(a => `<div class="mtr-bericht claude"><div class="wie">${esc(a.door || 'Claude')}${a.ts ? ' · ' + esc(wanneer(a.ts)) : ''}</div>${esc(a.tekst)}</div>`).join('')}${q.antwoorden_afgekapt ? '<div class="mtr-zacht">(meer antwoorden niet getoond)</div>' : ''}`).join('')}
    ${st.magVragen ? `<textarea data-tekst="${esc(id)}" maxlength="${MAX_TEKST}" placeholder="Stel een vraag of zet een opmerking bij ${esc(s.titel || id)}…">${esc(st.concept[st.id + ':' + id] || '')}</textarea>
    <div style="text-align:right;margin-top:6px"><button class="mtr-knop aan" data-vraag="${esc(id)}">Versturen</button></div>` : ''}</div>
</details>`;
  }

  // ── Interactie ──
  function klik(e) {
    const n = e.target.closest('[data-naar]');
    if (n) { const d = [...st.el.querySelectorAll('details.mtr-sec')].find(x => x.dataset.sec === n.dataset.naar); if (d) { d.open = true; st.openSec[d.dataset.sec] = true; if (d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
    const a = e.target.closest('input[data-actie]'); if (a) return actieZet(a);
    const v = e.target.closest('[data-vraag]'); if (v) return vraagStuur(v.dataset.vraag, v);
  }
  async function actieZet(inp) {
    if (!st.mag) { inp.checked = !inp.checked; return; }
    const status = inp.checked ? 'gedaan' : 'open', id = inp.dataset.actie;
    inp.disabled = true;
    const r = await st.bron.haal('/geld/rapport/actie', { method: 'POST', body: { rapport_id: st.id, actie_id: id, status } });
    if (!r || r.error) { toast('Niet opgeslagen' + (r && r.error ? ': ' + r.error : '')); inp.checked = !inp.checked; inp.disabled = false; return; }
    (st.data.acties = st.data.acties || {})[id] = r.actie || { status, door: '', ts: Date.now() };
    teken();
  }
  async function vraagStuur(sec, knop) {
    if (!st.magVragen || st.bezig) return;
    const ta = [...st.el.querySelectorAll('textarea[data-tekst]')].find(x => x.dataset.tekst === sec), tekst = ta ? ta.value.trim() : '';
    if (!tekst) { toast('Typ eerst je vraag of opmerking'); return; }
    if (tekst.length > MAX_TEKST) { toast(`Hooguit ${MAX_TEKST} tekens`); return; }
    st.bezig = true; knop.disabled = true;
    try {
      const r = await st.bron.haal('/geld/rapport/vraag', { method: 'POST', body: { rapport_id: st.id, sectie_id: sec, tekst } });
      if (!r || r.error || !r.vraag) { toast('Niet verstuurd' + (r && r.error ? ': ' + r.error : '')); knop.disabled = false; return; }
      st.lokaal.push({ v: r.vraag, t: Date.now() }); delete st.concept[st.id + ':' + sec];
      st.open[st.id] = (st.open[st.id] || 0) + 1; if (st.opBadge) st.opBadge(Object.values(st.open).reduce((x, y) => x + y, 0));
      st.openSec[sec] = true; toast('Verstuurd — Claude zet het antwoord erbij'); teken();
    } finally { st.bezig = false; }
  }
  // Voor de tabkop: aantal open vragen (zonder het tabblad te openen).
  R.telOpen = async function (bron) { try { const ix = await bron.haal('/geld/rapporten'); return ix && !ix.error ? ix.open_totaal || 0 : null; } catch (e) { return null; } };
})(typeof window !== 'undefined' ? window : globalThis);
