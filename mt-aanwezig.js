/* ============================================================================
 * mt-aanwezig.js — "Vandaag aanwezig" (brok F1e-C), gedeeld door v2 en mobiel
 * ----------------------------------------------------------------------------
 * Haalt GET <worker>/aanwezig (per teamlid: lopende timer, projectnaam, taak, sinds —
 * geen duur of totalen) en vult lokaal aan met wat de app zelf weet: planblokken van
 * vandaag en verlof. Klik op een persoon met een project → opener(project_id).
 * ========================================================================== */
(function (root) {
  'use strict';
  const A = { data: null, fout: null };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  A.laad = async function (worker) {
    try {
      const h = root.authHeader ? await root.authHeader() : {};
      if (!h['X-Auth-Token']) return null;
      const r = await root.fetch(String(worker).replace(/\/+$/, '') + '/aanwezig', { headers: h });
      if (!r.ok) { A.fout = r.status; return null; }
      const j = await r.json();
      if (!j || !Array.isArray(j.personen)) return null;   // oude worker
      A.data = j; A.fout = null; return j;
    } catch (e) { A.fout = 'netwerk'; return null; }
  };
  // o = {plan: {slug: [{start, tekst, voorstel}]}, verlof: Set(slug), opener: 'naamVanFunctie'}
  A.html = function (data, o) {
    o = o || {};
    const plan = o.plan || {}, verlof = o.verlof || new Set();
    if (!data || !data.personen || !data.personen.length) return '<div class="aw-leeg">Nog niemand met een rol in de tool.</div>';
    return '<ul class="aw-lijst">' + data.personen.map(p => {
      const opVerlof = verlof.has(p.slug), werk = p.status === 'aan-het-werk';
      const st = opVerlof && !werk ? ['aw-verlof', 'Verlof / vrij'] : werk ? ['aw-werk', 'Aan het werk'] : p.status === 'geen-timer' ? ['aw-stil', 'Geen timer'] : ['aw-onb', 'Onbekend'];
      const titelOnb = p.status === 'onbekend' ? ' title="Toggl nog niet gekoppeld voor deze persoon"' : '';
      const nu = werk ? `<div class="aw-nu">${esc(p.project || 'Project onbekend')}${p.taak ? ' · ' + esc(p.taak) : ''}${p.sinds ? ' · sinds ' + esc(hhmm(p.sinds)) : ''}</div>` : '';
      const pl = (plan[p.slug] || []).slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const gepland = pl.length ? `<div class="aw-plan">Gepland: ${pl.map(x => `<span class="${x.voorstel ? 'aw-voorstel' : ''}"${x.voorstel ? ' title="Voorstel, nog niet goedgekeurd"' : ''}>${esc(x.start || '')} ${esc(x.tekst || '')}${x.voorstel ? ' (voorstel)' : ''}</span>`).join(', ')}</div>` : '';
      const klik = werk && p.project_id != null && o.opener ? ` role="button" tabindex="0" class="aw-p aw-klik" onclick="${o.opener}(${Number(p.project_id)})" onkeydown="if(event.key==='Enter')${o.opener}(${Number(p.project_id)})" aria-label="${esc(p.naam)}: open project ${esc(p.project || '')}"` : ' class="aw-p"';
      return `<li${klik}><div class="aw-kop"><b>${esc(p.naam)}</b><span class="aw-st ${st[0]}"${titelOnb}>${st[1]}</span></div>${nu}${gepland}</li>`;
    }).join('') + '</ul>';
  };
  if (root.document && !root.document.getElementById('aw-stijl')) {
    const st = root.document.createElement('style'); st.id = 'aw-stijl';
    st.textContent = '.aw-lijst{list-style:none;margin:0;padding:0}.aw-p{padding:8px 4px;border-bottom:1px solid var(--border,#e3e8e6)}.aw-p:last-child{border-bottom:0}'
      + '.aw-klik{cursor:pointer}.aw-klik:hover,.aw-klik:focus{background:rgba(31,92,54,.05);outline:none}.aw-kop{display:flex;justify-content:space-between;gap:8px;align-items:center}'
      + '.aw-st{font-size:11px;padding:2px 8px;border-radius:10px;border:1px solid;white-space:nowrap}.aw-st::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px;background:currentColor}'
      + '.aw-werk{color:#1F5C36;background:#E3F1E7;border-color:#9CCBAA}.aw-stil{color:#555;background:#f2f4f3;border-color:#d5ddd9}.aw-verlof{color:#7A5300;background:#FFF4D6;border-color:#E9C46A}'
      + '.aw-onb{color:#777;background:#fff;border-color:#d5ddd9;border-style:dashed}.aw-onb::before{background:transparent;border:1px solid currentColor}'
      + '.aw-nu{font-size:12.5px;margin-top:2px}.aw-plan{font-size:12px;color:var(--text-dim,#666);margin-top:2px}.aw-voorstel{border-bottom:1px dashed currentColor}.aw-leeg{font-size:12px;color:var(--text-dim,#666)}';
    (root.document.head || root.document.documentElement).appendChild(st);
  }
  root.MTAanwezig = A;
})(typeof window !== 'undefined' ? window : globalThis);
