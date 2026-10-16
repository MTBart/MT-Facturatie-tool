/* ============================================================================
 * mt-personen.js: de bediening voor meerdere personen op één taak (T3, keuzeplan 16-10)
 * ----------------------------------------------------------------------------
 * Een klein venster in het takenoverzicht van een project: kies de personen van een taak en geef per persoon een optioneel aantal uren. Zonder uren krijgt iedereen een
 * gelijk deel van de rest van de raming (MTPlanning.taakVerdeling). Dit bestand schrijft niets zelf: het geeft de keuze door aan opslaan(lijst, mins), en de aanroeper
 * zet die met MTPlanning.personenZet in de taak (samen met toegewezen en de stempels). Alleen zichtbaar als MTPlanning.MEERDERE_PERSONEN aan staat. Tekent met DOM-calls, nooit met HTML-tekst.
 *   MTPersonen.open({ doc, naam, team: [{slug, naam}], mensen: [slug…], mins: { slug: minuten }, opslaan(lijst, mins) })
 * ========================================================================== */
(function (root) {
  'use strict';
  const U = {};
  const el = (d, tag, props, ...kids) => {
    const e = d.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === false) return; if (k === 'klass') e.className = v; else if (k === 'tekst') e.textContent = v; else if (k === 'klik') e.addEventListener('click', v); else e.setAttribute(k, v === true ? '' : v); });
    kids.flat().forEach(x => { if (x !== null && x !== undefined && x !== false) e.appendChild(typeof x === 'string' ? d.createTextNode(x) : x); });
    return e;
  };
  U.open = function (o) {
    const d = o.doc, team = (o.team || []).filter(m => m && m.slug), gekozen = (o.mensen || []).slice(), mins = o.mins || {};
    const oud = d.getElementById('pers-dlg'); if (oud && oud.parentNode) oud.parentNode.removeChild(oud);
    const vorigeFocus = d.activeElement;
    const rijen = {};   // slug -> { vink, uur }
    const lijstEl = el(d, 'div', { style: 'display:flex;flex-direction:column;gap:6px;margin:12px 0' });
    team.forEach(m => {
      const vink = el(d, 'input', { type: 'checkbox', id: 'pers-v-' + m.slug, 'aria-label': m.naam || m.slug });
      vink.checked = gekozen.includes(m.slug);
      const uur = el(d, 'input', { type: 'number', min: '0', step: '0.25', placeholder: 'gelijk deel', 'aria-label': 'Uren voor ' + (m.naam || m.slug), style: 'width:96px;margin-left:auto' });
      if (Number(mins[m.slug]) > 0) uur.value = String(Math.round(Number(mins[m.slug]) / 60 * 100) / 100);
      uur.disabled = !vink.checked;
      vink.addEventListener('change', () => { uur.disabled = !vink.checked; if (vink.checked && !gekozen.includes(m.slug)) gekozen.push(m.slug); else if (!vink.checked) { const i = gekozen.indexOf(m.slug); if (i >= 0) gekozen.splice(i, 1); uur.value = ''; } });
      rijen[m.slug] = { vink, uur };
      lijstEl.appendChild(el(d, 'label', { style: 'display:flex;align-items:center;gap:10px', for: 'pers-v-' + m.slug }, vink, el(d, 'span', { tekst: m.naam || m.slug }), uur));
    });
    const sluit = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); try { if (vorigeFocus && vorigeFocus.focus) vorigeFocus.focus(); } catch (e) {} };
    const opslaan = () => {
      const lijst = gekozen.filter(s => rijen[s] && rijen[s].vink.checked), uit = {};
      lijst.forEach(s => { const u = Number(String(rijen[s].uur.value).replace(',', '.')); if (u > 0) uit[s] = Math.round(u * 60); });
      sluit(); try { o.opslaan(lijst, uit); } catch (e) { console.warn('Personen opslaan:', e); }
    };
    const kaart = el(d, 'div', { style: 'background:var(--surface,#fff);color:var(--ink,#222);border-radius:8px;padding:20px;min-width:300px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.25)' },
      el(d, 'h3', { id: 'pers-titel', style: 'margin:0 0 4px;font-size:16px', tekst: 'Personen' }),
      el(d, 'div', { style: 'font-size:13px;opacity:.75', tekst: o.naam || '' }),
      lijstEl,
      el(d, 'div', { style: 'font-size:12px;opacity:.7;margin-bottom:12px', tekst: 'Zonder uren krijgt iedereen een gelijk deel van de rest van de raming. De eerste persoon is ook "Toegewezen aan".' }),
      el(d, 'div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, el(d, 'button', { type: 'button', klass: 'btn btn-secondary', klik: sluit, tekst: 'Annuleren' }), el(d, 'button', { type: 'button', klass: 'btn btn-gold', id: 'pers-opslaan', klik: opslaan, tekst: 'Opslaan' })));
    const wrap = el(d, 'div', { id: 'pers-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pers-titel', style: 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center' }, kaart);
    wrap.addEventListener('click', ev => { if (ev.target === wrap) sluit(); });
    wrap.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); sluit(); } });
    d.body.appendChild(wrap);
    const eerste = wrap.querySelector('input[type=checkbox]'); if (eerste && eerste.focus) eerste.focus();
    return wrap;
  };
  root.MTPersonen = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
