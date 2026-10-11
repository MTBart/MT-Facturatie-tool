/* ============================================================================
 * mt-zoekbalk.js — de universele zoekbalk (kader): invoerveld + uitklaplijst met treffers per soort
 * ----------------------------------------------------------------------------
 * Eén component voor cockpit (v2.html) en app (mobiel.html). Het component zoekt zelf niets: de aanroeper
 * geeft `zoek(q)` mee (in de praktijk MTZoek.zoek uit mt-zoek.js) en weet zelf hoe een treffer opent.
 *
 *   const zb = MTZoekbalk.init({
 *     veld,                         // het <input>-element (krijgt role=combobox)
 *     host,                         // element waarin de lijst komt (standaard de ouder van veld)
 *     zoek: q => ({groepen:[{soort, label, items:[{soort,id,titel,sub,tag,data}], meer}]}),
 *     open: item => {…},            // klik/Enter op een treffer
 *     vraag: q => {…},              // optioneel: "Vraag dit aan Larry: “<q>”" onderaan; zonder = geen vraagregel
 *     vraagLabel: 'Vraag dit aan Larry',   // optioneel
 *     extern: {zoek(q), annuleer(), groepen(), bezig()},   // optioneel: asynchrone bronnen (mt-zoek-extern.js MTZoekExtern.maak)
 *                                   // groepen() geeft {soort,label,status:'laden'|'limiet'|'fout'|'klaar',melding,items,meer}; na elke
 *                                   // wijziging roept de aanroeper ctl.ververs({behoud:true}) aan
 *     rechten: () => ({klaar, melding}),   // optioneel: zijn de rollen geladen? Zolang klaar=false toont de lijst alleen de melding
 *                                   // ("Laden…"), zoekt niets en opent niets (fail-closed; MTZoek.rolStatus)
 *     mag: soort => bool,           // optioneel: wordt bij het openen opnieuw gecontroleerd (de rol kan zijn veranderd sinds de lijst getoond werd)
 *     toetsHint: 'Enter = gemarkeerde regel · Shift+Enter = vraag aan Larry',   // optioneel: kleine regel onderaan (alleen met vraagregel)
 *     inline: false,                // true = de lijst staat in de pagina (mobiele zoeklaag) i.p.v. als zwevende uitklaplijst
 *     vraagMag: () => bool,         // optioneel: rechtencheck voor de vraagregel
 *     isVraag: q => bool,           // optioneel: lijkt de invoer een vraag? (dan staat de vraagregel vooraf actief)
 *     lijstId: 'zb-lijst'           // optioneel: id van de lijst (nodig als er twee balken op één pagina staan)
 *   });
 *
 * Enter-contract: de gemarkeerde regel (gouden balk + ↵) bepaalt wat Enter doet. Voorgeselecteerd is een lokale treffer alleen als hij
 * sterk is (rang 0 of 1: exacte code/alias of "begint met"); anders — zwakke treffers, geen treffers, een vraag (vraagteken, 4+ woorden) —
 * de vraagregel. Shift+Enter gaat altijd naar de vraagregel. Zonder vraagregel (app) is de eerste lokale treffer gemarkeerd.
 * Toetsen: pijltje omlaag/omhoog = door de treffers, Enter = openen, Esc = lijst sluiten (nog eens Esc = veld
 * leegmaken), Tab = sluiten. In inline-modus laat het component Esc en Tab aan de zoeklaag zelf. Muis/aanraking: klik op een treffer; mousedown houdt de focus in het veld.
 * Toegankelijkheid: ARIA 1.2 combobox + listbox (role=group per soort), aria-activedescendant, een
 * aria-live-regel met het aantal treffers.
 * Veiligheid: alle tekst gaat door esc(); er zijn geen inline handlers — één delegatie op de lijst met
 * data-i / data-vraag-attributen.
 * ========================================================================== */
(function (root) {
  'use strict';
  const doc = root && root.document;
  if (!doc) return;

  const esc = typeof root.esc === 'function' ? root.esc : s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICOON = { project: '📁', klant: '🏢', locatie: '📍', taak: '☑', contact: '👤', moneybird: '🧾', sharepoint: '🗂' };

  if (!doc.getElementById('mt-zb-stijl')) {
    const st = doc.createElement('style'); st.id = 'mt-zb-stijl';
    st.textContent = [
      '.zb-veld{width:100%;box-sizing:border-box;background:var(--n-0,#fff);color:var(--n-900,#172521);border:1px solid var(--border,#D6DEDB);border-radius:20px;padding:8px 16px;font:inherit;font-size:13px;outline:none;box-shadow:var(--shadow-sm,0 1px 2px rgba(44,40,28,.05))}',
      '.zb-veld::placeholder{color:#8B9893}',
      '.zb-veld:focus{border-color:var(--gold,#B8962E);box-shadow:0 2px 12px rgba(0,0,0,.18)}',
      '.zb-lijst{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);width:min(560px,92vw);max-height:min(70vh,520px);overflow-y:auto;background:var(--n-0,#fff);color:var(--n-900,#172521);',
      'border:1px solid var(--border,#D6DEDB);border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.28);padding:6px 0;z-index:300;text-align:left}',
      '.zb-lijst[hidden]{display:none}',
      '.zb-kop{padding:8px 14px 4px;font:600 11px/1.2 var(--sans,system-ui,sans-serif);letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim,#5A6862)}',
      '.zb-rij{display:flex;align-items:center;gap:10px;min-height:38px;padding:6px 14px;cursor:pointer;font-size:13px}',
      '.zb-rij:hover{background:var(--n-150,#EDF1F0)}',
      '.zb-rij.zb-actief{background:var(--green-50,#E6EFE9);box-shadow:inset 3px 0 0 var(--gold,#B8962E)}',
      '.zb-ico{flex:0 0 20px;text-align:center}',
      '.zb-tekst{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}',
      '.zb-titel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
      '.zb-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--text-dim,#5A6862)}',
      '.zb-tag{flex:0 0 auto;font:11px var(--mono,monospace);color:var(--text-dim,#5A6862);background:var(--n-150,#EDF1F0);border-radius:10px;padding:1px 8px}',
      '.zb-meer,.zb-leeg{padding:2px 14px 6px 44px;font-size:11.5px;color:var(--text-faint,#8B9893)}',
      '.zb-leeg{padding:10px 14px;font-style:italic}',
      '.zb-vraag{border-top:1px solid var(--border,#D6DEDB);margin-top:4px}',
      '.zb-vraag .zb-titel{font-weight:600}',
      '.zb-lijst.zb-inline{position:static;transform:none;width:auto;max-height:none;border:0;border-radius:0;box-shadow:none;padding:0 0 24px;overflow:visible}',
      '.zb-limiet,.zb-fout{color:var(--warning,#B8762E)}',
      '.zb-rij.zb-actief::after{content:"↵";flex:0 0 auto;margin-left:6px;color:var(--text-dim,#5A6862);font-size:14px}',
      '.zb-toetsen{padding:4px 14px 2px;font-size:11px;color:var(--text-faint,#8B9893)}',
      '@media (pointer:coarse){.zb-rij.zb-actief::after,.zb-toetsen{display:none}}',
      '.zb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
      '@media (max-width:760px){.zb-lijst{position:absolute;left:0;right:0;width:auto;transform:none;max-height:60vh;border-radius:0 0 12px 12px}}',
      '@media (pointer:coarse){.zb-rij{min-height:46px}}'
    ].join('');
    (doc.head || doc.documentElement).appendChild(st);
  }

  const MTZoekbalk = {
    init(opt) {
      const veld = opt && opt.veld;
      if (!veld || typeof opt.zoek !== 'function' || typeof opt.open !== 'function') throw new Error('MTZoekbalk.init: veld, zoek en open zijn verplicht');
      const host = opt.host || veld.parentNode;
      try { if (root.getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) {}
      const lijstId = opt.lijstId || 'zb-lijst';
      const lijst = doc.createElement('div');
      const inline = !!opt.inline, vraagLabel = opt.vraagLabel || 'Vraag dit aan Larry';
      lijst.id = lijstId; lijst.className = 'zb-lijst' + (inline ? ' zb-inline' : ''); lijst.setAttribute('role', 'listbox'); lijst.setAttribute('aria-label', 'Zoekresultaten'); lijst.hidden = true;
      const status = doc.createElement('div'); status.className = 'zb-sr'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      host.appendChild(lijst); host.appendChild(status);
      veld.setAttribute('role', 'combobox'); veld.setAttribute('aria-autocomplete', 'list'); veld.setAttribute('aria-haspopup', 'listbox');
      veld.setAttribute('aria-controls', lijstId); veld.setAttribute('aria-expanded', 'false'); veld.setAttribute('autocomplete', 'off');
      if (!veld.getAttribute('aria-label')) veld.setAttribute('aria-label', 'Zoeken');

      let rijen = [], act = -1, open = false, bewogen = false;   // rijen: [{item}|{vraag:true}]; bewogen = gebruiker heeft zelf een regel gekozen
      const sleutel = r => (r ? (r.vraag ? 'vraag' : r.item.soort + ':' + r.item.id) : '');
      const rechtenStatus = () => { try { return opt.rechten ? opt.rechten() || { klaar: true } : { klaar: true }; } catch (e) { return { klaar: false, melding: 'Laden…' }; } };
      const rechtenKlaar = () => !!rechtenStatus().klaar;
      const vraagKan = () => typeof opt.vraag === 'function' && (typeof opt.vraagMag !== 'function' || !!opt.vraagMag());

      // scroll=false bij hover: scrollIntoView onder de muis zou de regel tussen mousedown en mouseup laten verschuiven (dan vervalt de klik).
      function zet(i, scroll) {
        act = i;
        lijst.querySelectorAll('[role=option]').forEach(el => {
          const aan = Number(el.dataset.i) === i;
          el.classList.toggle('zb-actief', aan); el.setAttribute('aria-selected', aan ? 'true' : 'false');
          if (aan && scroll !== false && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
        });
        if (i >= 0) veld.setAttribute('aria-activedescendant', lijstId + '-o' + i); else veld.removeAttribute('aria-activedescendant');
      }
      function toon(wel) {
        open = !!wel; lijst.hidden = !wel; veld.setAttribute('aria-expanded', wel ? 'true' : 'false');
        if (!wel) veld.removeAttribute('aria-activedescendant');
      }
      function sluit() { toon(false); act = -1; }

      // Muis/aanraking: tussen indrukken en loslaten tekent de lijst niet opnieuw (een extern resultaat dat net binnenkomt zou de
      // regel onder de vinger vervangen, waardoor de browser geen click meer op die regel stuurt). Wat uitgesteld is, volgt na het loslaten.
      let ingedrukt = null, los = null, uitgesteld = false, vrijT = null;
      function vrijgeven() {
        ingedrukt = null; los = null; if (vrijT) { clearTimeout(vrijT); vrijT = null; }
        if (uitgesteld) { uitgesteld = false; ververs({ behoud: true }); }
      }
      function ververs(o) {
        if (ingedrukt) { uitgesteld = true; return; }
        const behoud = !!(o && o.behoud === true), vorige = behoud && bewogen ? sleutel(rijen[act]) : '';
        const q = veld.value.trim();
        if (!q) { rijen = []; lijst.innerHTML = ''; status.textContent = ''; sluit(); return; }
        const rs = rechtenStatus();
        if (!rs.klaar) {   // fail-closed: geen resultaten, geen vraagregel, niets te openen zolang de rechten niet bekend zijn
          rijen = []; lijst.innerHTML = '<div class="zb-leeg" role="presentation">' + esc(rs.melding || 'Laden…') + '</div>';
          status.textContent = rs.melding || 'Laden…'; toon(true); act = -1; veld.removeAttribute('aria-activedescendant'); return;
        }
        let res; try { res = opt.zoek(q) || { groepen: [] }; } catch (e) { res = { groepen: [] }; if (root.console) root.console.warn('zoekbalk:', e); }
        let ext = []; try { ext = opt.extern ? opt.extern.groepen() || [] : []; } catch (e) { ext = []; }
        rijen = []; let h = '';
        const nLokaal = (res.groepen || []).reduce((a, g) => a + ((g && g.items && g.items.length) || 0), 0);
        (res.groepen || []).concat(ext).forEach((g, gi) => {
          const heeft = g && g.items && g.items.length, melding = g && !heeft && (g.status === 'laden' || g.status === 'limiet' || g.status === 'fout');
          if (!heeft && !melding) return;
          const kopId = lijstId + '-g' + gi;
          h += '<div role="group" aria-labelledby="' + esc(kopId) + '"><div class="zb-kop" role="presentation" id="' + esc(kopId) + '">' + esc(g.label) + '</div>';
          if (melding) h += '<div class="zb-leeg zb-' + esc(g.status) + '" role="presentation">' + esc(g.status === 'laden' ? (g.melding || 'Zoeken…') : g.melding || 'Niet beschikbaar.') + '</div>';
          (g.items || []).forEach(it => {
            const i = rijen.length; rijen.push({ item: it });
            h += '<div role="option" id="' + esc(lijstId + '-o' + i) + '" class="zb-rij" data-i="' + i + '" aria-selected="false">'
              + '<span class="zb-ico" aria-hidden="true">' + esc(ICOON[it.soort] || '•') + '</span>'
              + '<span class="zb-tekst"><span class="zb-titel">' + esc(it.titel) + '</span>' + (it.sub ? '<span class="zb-sub">' + esc(it.sub) + '</span>' : '') + '</span>'
              + (it.tag ? '<span class="zb-tag">' + esc(it.tag) + '</span>' : '') + '</div>';
          });
          if (g.meer > 0) h += '<div class="zb-meer" role="presentation">+' + esc(g.meer) + ' meer — typ verder om te verfijnen</div>';
          h += '</div>';
        });
        const n = rijen.length, extBezig = !!(opt.extern && opt.extern.bezig && opt.extern.bezig());
        if (!n && !ext.some(g => g.status === 'laden' || g.status === 'limiet' || g.status === 'fout')) h += '<div class="zb-leeg" role="presentation">' + (extBezig ? 'Zoeken…' : 'Geen treffers. Verfijn je zoekterm.') + '</div>';
        const kanVragen = vraagKan();
        let vraagIdx = -1;
        if (kanVragen) {
          vraagIdx = rijen.length; rijen.push({ vraag: true });
          h += '<div role="group" aria-label="Claude"><div role="option" id="' + esc(lijstId + '-o' + vraagIdx) + '" class="zb-rij zb-vraag" data-i="' + vraagIdx + '" data-vraag="1" aria-selected="false">'
            + '<span class="zb-ico" aria-hidden="true">✨</span><span class="zb-tekst"><span class="zb-titel">' + esc(vraagLabel) + ': “' + esc(q) + '”</span></span></div></div>'
            + '<div class="zb-toetsen" role="presentation">' + esc(opt.toetsHint || 'Enter = gemarkeerde regel · Shift+Enter = vraag aan Larry') + '</div>';
        }
        lijst.innerHTML = h;
        status.textContent = (n ? n + (n === 1 ? ' treffer' : ' treffers') : 'Geen treffers') + (extBezig ? ', andere bronnen worden nog doorzocht' : '');
        toon(true);
        // Beginstand: de eerste lokale treffer (externe bronnen worden nooit zelf voorgeselecteerd), anders de vraagregel.
        const vraagVoorop = kanVragen && typeof opt.isVraag === 'function' && opt.isVraag(q);
        // Enter-contract: alleen een sterke lokale treffer (rang 0/1) wordt voorgeselecteerd; anders de vraagregel (als die er is).
        let sterkIdx = -1, sterkRang = 99;
        for (let i = 0; i < nLokaal; i++) { const rg = rijen[i].item.rang == null ? 0 : rijen[i].item.rang; if (rg < sterkRang) { sterkRang = rg; sterkIdx = i; } }
        if (sterkRang > 1) sterkIdx = -1;
        let begin = vraagVoorop ? vraagIdx : sterkIdx >= 0 ? sterkIdx : kanVragen ? vraagIdx : n ? 0 : -1;
        const terug = vorige ? rijen.findIndex(r => sleutel(r) === vorige) : -1;
        if (terug >= 0) begin = terug; else if (vorige) bewogen = false;
        zet(begin);
      }

      function kies(i) {
        const r = rijen[i]; if (!r) return;
        // Rechten opnieuw toetsen vlak vóór het openen: de lijst kan zijn getoond vóór de rol binnen was of daarna veranderd zijn.
        if (!rechtenKlaar() || (!r.vraag && typeof opt.mag === 'function' && !opt.mag(r.item.soort))) { ververs(); return; }
        const q = veld.value.trim();
        veld.value = ''; bewogen = false; if (opt.extern) opt.extern.annuleer(); ververs();
        // Na het afhandelen van deze klik: andere click-away-handlers op de pagina zien dan niet meer de (al vervangen) lijst.
        setTimeout(() => { if (r.vraag) { if (vraagKan()) opt.vraag(q); } else opt.open(r.item); }, 0);
      }

      veld.addEventListener('input', () => { bewogen = false; if (opt.extern && rechtenKlaar()) opt.extern.zoek(veld.value); ververs(); });
      veld.addEventListener('focus', () => { if (veld.value.trim() && !open) ververs(); });
      veld.addEventListener('keydown', e => {
        if (e.isComposing) return;
        const n = rijen.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) { ververs(); return; } if (n) { bewogen = true; zet((act + 1) % n); } }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (open && n) { bewogen = true; zet(act <= 0 ? n - 1 : act - 1); } }
        else if (e.key === 'Enter') {
          if (e.shiftKey) { const vi = rijen.findIndex(r => r.vraag); if (open && vi >= 0) { e.preventDefault(); kies(vi); } return; }   // Shift+Enter: altijd naar de vraag
          if (open && act >= 0) { e.preventDefault(); kies(act); }
        }
        else if (e.key === 'Escape') { if (inline) return; if (open) { e.preventDefault(); sluit(); } else if (veld.value) { e.preventDefault(); veld.value = ''; bewogen = false; if (opt.extern) opt.extern.annuleer(); ververs(); } }
        else if (e.key === 'Tab') { if (!inline) sluit(); }
      });
      // Muis/aanraking: de focus blijft in het veld; het openen gebeurt op click.
      const optieVan = e => { const el = e.target && e.target.closest ? e.target.closest('[role=option]') : null; return el && lijst.contains(el) ? el : null; };
      const sleutelVan = el => (el ? sleutel(rijen[Number(el.dataset.i)]) : null);
      const indrukken = e => {
        const el = optieVan(e); ingedrukt = el ? sleutelVan(el) || null : null; los = null;
        if (vrijT) clearTimeout(vrijT); vrijT = ingedrukt ? setTimeout(vrijgeven, 3000) : null;   // vangnet: loslaten buiten het venster
      };
      const loslaten = e => { if (ingedrukt) { los = sleutelVan(optieVan(e)); setTimeout(() => { if (ingedrukt) vrijgeven(); }, 400); } };   // de click volgt direct; anders toch vrijgeven
      lijst.addEventListener('pointerdown', indrukken);
      // De focus blijft in het veld (anders sluit de blur de lijst vóór de click); het openen gebeurt op click.
      lijst.addEventListener('mousedown', e => { e.preventDefault(); indrukken(e); });
      lijst.addEventListener('pointerup', loslaten);
      lijst.addEventListener('mouseup', loslaten);
      lijst.addEventListener('pointercancel', () => vrijgeven());
      lijst.addEventListener('click', e => {
        const el = optieVan(e);
        let i = el ? Number(el.dataset.i) : -1;
        // De regel is tussen indrukken en loslaten opnieuw getekend: de click gaat dan naar de lijst zelf; gebruik de ingedrukte regel.
        if (i < 0 && ingedrukt && (los === null || los === ingedrukt)) i = rijen.findIndex(r => sleutel(r) === ingedrukt);
        ingedrukt = null; los = null; if (vrijT) { clearTimeout(vrijT); vrijT = null; }
        if (i >= 0) { uitgesteld = false; kies(i); } else if (uitgesteld) vrijgeven();
      });
      // Hover markeert de regel (aria-activedescendant volgt de muis) zonder te scrollen.
      lijst.addEventListener('mousemove', e => {
        const el = optieVan(e);
        if (el && Number(el.dataset.i) !== act) { bewogen = true; zet(Number(el.dataset.i), false); }
      });
      if (!inline) doc.addEventListener('mousedown', e => { if (open && e.target !== veld && !lijst.contains(e.target)) sluit(); });

      // Rechten of gegevens zijn veranderd (bv. de rol komt binnen): lijst sluiten en met de nieuwe stand opnieuw opbouwen.
      function herlaad() {
        sluit(); bewogen = false;
        if (veld.value.trim()) { if (opt.extern && rechtenKlaar()) opt.extern.zoek(veld.value); ververs(); }
      }
      return {
        ververs, herlaad, sluit, lijst, veld,
        focus() { veld.focus(); },
        get open() { return open; }
      };
    }
  };
  root.MTZoekbalk = MTZoekbalk;
})(typeof window !== 'undefined' ? window : undefined);
