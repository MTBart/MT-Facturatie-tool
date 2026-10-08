/* ============================================================================
 * mt-rollen.js — rol + rechten van de ingelogde gebruiker (brok F1c)
 * ----------------------------------------------------------------------------
 * Haalt GET <worker>/me op (rol, rechten volgens de matrix, modus). Verbergen is
 * alléén UI-gemak — de worker beslist — en gebeurt alleen in modus 'afdwingen'.
 * In 'uit'/'log' werkt de app precies als vóór F1.
 *
 * Markeren in HTML: data-recht="kolom" (elk niveau behalve geen) of
 * data-recht="kolom:niveau1|niveau2", bv. data-recht="moneybird" of
 * data-recht="projecten:wijzigen". Kolommen: projecten, taken, bestellijst,
 * opmerkingen, inbox, offertes, moneybird, mb_verwijderen, uren, verbeterpunten, ai, beheer.
 * Werkt met de oude worker (zonder /me): laad() geeft dan null en er verandert niets.
 * ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  const R = { me: null };

  // Eén stijlregel voor verborgen elementen (geen extra CSS nodig per pagina).
  if (doc && !doc.getElementById('mt-rol-stijl')) {
    const st = doc.createElement('style'); st.id = 'mt-rol-stijl';
    st.textContent = '.mt-rol-verborgen{display:none!important}'
      + '.mt-rol-scherm{position:fixed;inset:0;z-index:9999;background:var(--bg,#F4F7F6);display:flex;align-items:center;justify-content:center;padding:16px}'
      + '.mt-rol-kaart{max-width:420px;width:100%;background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.12);font:14px/1.5 system-ui,sans-serif;color:#1d2b27}'
      + '.mt-rol-kaart h2{font-size:18px;margin:0 0 8px}.mt-rol-kaart textarea{width:100%;min-height:70px;margin:12px 0;padding:8px;border:1px solid #ccd;border-radius:6px;font:inherit;box-sizing:border-box}'
      + '.mt-rol-kaart button{min-height:40px;padding:0 16px;border-radius:8px;border:0;background:#1F5C36;color:#fff;font:inherit;cursor:pointer}'
      + '.mt-rol-kaart .mt-rol-st{margin-top:10px;font-size:13px;color:#555}';
    (doc.head || doc.documentElement).appendChild(st);
  }

  const basis = w => String(w || '').replace(/\/+$/, '');
  R.laad = async function (worker) {
    try {
      const h = root.authHeader ? await root.authHeader() : {};
      if (!h || !h['X-Auth-Token']) return null;
      const r = root.fetchMetAuth ? await root.fetchMetAuth(basis(worker) + '/me') : await root.fetch(basis(worker) + '/me', { headers: h });   // 401 → één keer met vers token
      if (!r.ok) return null;
      const me = await r.json();
      if (!me || !('rol' in me) || !('modus' in me)) return null;   // oude worker
      R.me = me;
      try { root.dispatchEvent(new root.CustomEvent('mt-rol', { detail: me })); } catch (e) {}
      return me;
    } catch (e) { return null; }
  };
  R.afdwingen = () => !!(R.me && R.me.modus === 'afdwingen');
  R.recht = kolom => (R.me && R.me.rechten) ? R.me.rechten[kolom] : null;
  // Mag de gebruiker dit (UI)? Buiten 'afdwingen' altijd ja.
  R.mag = function (spec) {
    if (!R.afdwingen()) return true;
    if (!R.me.rechten) return false;
    const [kolom, niveaus] = String(spec || '').split(':');
    const v = R.me.rechten[kolom];
    if (!v) return false;
    return !niveaus || niveaus.split('|').includes(v);
  };
  // Beheer tonen kan in élke modus (de beheer-API is altijd afgedwongen).
  R.isBeheer = () => !!(R.me && R.me.rechten && R.me.rechten.beheer);
  // Geld (geldtijdlijn, financieel dashboard): in élke modus, want de worker dwingt het altijd af.
  // niveau 'wijzigen' = ijkpunten/instellingen aanpassen; anders volstaat lezen.
  // Een worker van vóór het recht `geld` (geen kolom geld in /me) → het oude gedrag: dashboard met moneybird, instellingen met beheer.
  R.magGeld = niveau => {
    const r = R.me && R.me.rechten;
    if (r && !('geld' in r)) return niveau === 'wijzigen' ? !!r.beheer : !!r.moneybird;
    const v = R.recht('geld'); return niveau === 'wijzigen' ? v === 'wijzigen' : !!v;
  };
  const toets = el => el.classList.toggle('mt-rol-verborgen', !R.mag(el.dataset.recht));
  R.pasToe = function (scope) {
    (scope || doc).querySelectorAll('[data-recht]').forEach(toets);
    // Knoppen die later getekend worden (lijsten, popovers) ook meenemen — alleen in 'afdwingen'.
    if (R.afdwingen() && !R._waker && root.MutationObserver && doc.body) {
      R._waker = new root.MutationObserver(lijst => lijst.forEach(mu => mu.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.dataset && n.dataset.recht) toets(n);
        n.querySelectorAll && n.querySelectorAll('[data-recht]').forEach(toets);
      })));
      R._waker.observe(doc.body, { childList: true, subtree: true });
    }
  };
  // Alleen in 'afdwingen': onbekende/gedeactiveerde gebruiker krijgt een nette pagina.
  R.geenToegangNodig = () => R.afdwingen() && !R.me.actief;
  R.toonGeenToegang = function (worker) {
    if (!doc || doc.getElementById('mt-rol-scherm')) return;
    const gedeac = R.me && R.me.reden === 'gedeactiveerd';
    const s = doc.createElement('div'); s.id = 'mt-rol-scherm'; s.className = 'mt-rol-scherm';
    s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'mt-rol-titel');
    s.innerHTML = '<div class="mt-rol-kaart"><h2 id="mt-rol-titel">' + (gedeac ? 'Je account is gedeactiveerd' : 'Je account heeft nog geen toegang') + '</h2>'
      + '<p>' + (gedeac ? 'Een beheerder heeft je toegang uitgezet. Vraag het opnieuw aan als dat niet klopt.' : 'Je bent ingelogd, maar er is nog geen rol voor je ingesteld.') + '</p>'
      + '<label for="mt-rol-bericht" style="font-size:13px">Bericht (optioneel)</label><textarea id="mt-rol-bericht" maxlength="300" placeholder="Bijv. waarvoor je de tool gebruikt"></textarea>'
      + '<button type="button" id="mt-rol-vraag">Vraag toegang aan</button><div class="mt-rol-st" id="mt-rol-st" aria-live="polite"></div></div>';
    doc.body.appendChild(s);
    const knop = doc.getElementById('mt-rol-vraag'), st = doc.getElementById('mt-rol-st');
    knop.focus();
    knop.onclick = async function () {
      knop.disabled = true; st.textContent = 'Versturen…';
      try {
        const h = await root.authHeader();
        const r = await root.fetch(basis(worker) + '/toegang', { method: 'POST', headers: Object.assign({}, h, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ bericht: doc.getElementById('mt-rol-bericht').value || '' }) });
        const j = await r.json().catch(() => ({}));
        st.textContent = r.ok ? (j.alAangevraagd ? 'Je aanvraag staat al klaar bij de beheerder.' : 'Aanvraag verstuurd — de beheerder ziet hem in Instellingen → Beheer.') : 'Versturen lukte niet (' + r.status + '). Probeer het later opnieuw.';
        if (!r.ok) knop.disabled = false;
      } catch (e) { st.textContent = 'Versturen lukte niet. Probeer het later opnieuw.'; knop.disabled = false; }
    };
  };
  root.MTRol = R;
})(typeof window !== 'undefined' ? window : globalThis);
