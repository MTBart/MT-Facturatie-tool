/* ============================================================================
 * mt-toggl-koppel.js — "Koppel je Toggl" per persoon (brok F1e-A)
 * ----------------------------------------------------------------------------
 * Gedeeld door v2.html en mobiel.html. Badge in Moneybird-stijl (MTKoppelUI uit
 * mt-koppel.js): "Niet gekoppeld · Toggl" → stappenmenu; "Gekoppeld · Toggl (naam)"
 * → details / vervangen / ontkoppelen. De sleutel gaat één keer naar de worker
 * (POST /mijn/toggl), die hem bij Toggl controleert en versleuteld bewaart; hij komt
 * nooit terug en wordt na verzenden uit het invoerveld gewist.
 * ========================================================================== */
(function (root) {
  'use strict';
  const doc = root.document;
  const T = { status: null, worker: '' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FOUT = {
    'sleutel-ongeldig': 'Deze sleutel werkt niet bij Toggl. Controleer of je hem helemaal hebt gekopieerd.',
    'sleutel-van-ander': 'Deze sleutel hoort bij een ander Toggl-account. Gebruik de sleutel uit je eigen profiel.',
    'email-niet-in-toggl': 'Je Microsoft-e-mailadres staat niet in de Toggl-werkruimte. Vraag de beheerder je Toggl-account op dit adres te zetten.',
    'sleutel-vorm': 'Dit lijkt geen Toggl-sleutel (minstens 16 tekens, zonder spaties).',
    'geen-sleutel': 'Plak eerst je sleutel.',
    'toggl-onbereikbaar': 'Toggl is nu niet bereikbaar. Probeer het zo opnieuw.',
    'te-vaak': 'Te veel pogingen. Probeer het over een uur opnieuw.',
    'geen-versleuteling': 'Koppelen is nog niet ingesteld door de beheerder (SLEUTEL_KEK).',
    'geen-rollen-opslag': 'Koppelen is nog niet ingesteld door de beheerder (KV MT_ROLLEN).',
    'geen-toegang': 'Je account heeft nog geen toegang.'
  };

  if (doc && !doc.getElementById('tgk-stijl')) {
    const st = doc.createElement('style'); st.id = 'tgk-stijl';
    st.textContent = '.tgk-scherm{position:fixed;inset:0;z-index:10060;background:rgba(20,30,25,.45);display:flex;align-items:center;justify-content:center;padding:16px}'
      + '.tgk-kaart{background:#fff;color:#1d2b27;border-radius:12px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.2);font:14px/1.5 system-ui,sans-serif}'
      + '.tgk-kaart h2{font-size:18px;margin:0 0 4px}.tgk-stappen{list-style:none;margin:12px 0;padding:0;counter-reset:s}'
      + '.tgk-stap{position:relative;padding:10px 0 10px 40px;border-top:1px solid #e3e8e6}.tgk-stap::before{counter-increment:s;content:counter(s);position:absolute;left:4px;top:10px;width:26px;height:26px;border-radius:50%;background:#1F5C36;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center}'
      + '.tgk-stap b{display:block}.tgk-mock{margin:8px 0 2px;border:1px solid #d5ddd9;border-radius:8px;padding:8px 10px;font-size:12px;background:#f7f9f8}'
      + '.tgk-mock .tgk-rij{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:#667}.tgk-mock .tgk-licht{background:#FFF4D6;border:1px dashed #E9C46A;border-radius:6px;padding:4px 6px;color:#7A5300;font-weight:600}'
      + '.tgk-veld{display:flex;gap:6px;margin-top:6px}.tgk-veld input{flex:1;min-height:40px;padding:0 10px;border:1px solid #ccd;border-radius:8px;font:inherit}'
      + '.tgk-knop{min-height:40px;padding:0 14px;border-radius:8px;border:1px solid #c9d2ce;background:#fff;font:inherit;cursor:pointer}.tgk-knop.tgk-hoofd{background:#1F5C36;color:#fff;border-color:#1F5C36}'
      + '.tgk-st{margin-top:8px;font-size:13px;min-height:1.2em}.tgk-st.fout{color:#8B1A1A}.tgk-st.goed{color:#1F5C36;font-weight:600}'
      + '.tgk-onder{display:flex;justify-content:space-between;gap:8px;margin-top:14px;flex-wrap:wrap}.tgk-extra{margin-top:10px;font-size:13px}.tgk-extra summary{cursor:pointer;color:#555}';
    (doc.head || doc.documentElement).appendChild(st);
  }

  async function api(methode, body, query) {
    const h = root.authHeader ? await root.authHeader() : {};
    if (!h['X-Auth-Token']) throw Object.assign(new Error('Niet ingelogd bij Microsoft'), { code: 'login' });
    let r;
    try {
      r = await root.fetch(T.worker.replace(/\/+$/, '') + '/mijn/toggl' + (query || ''), {
        method: methode, headers: body ? Object.assign({}, h, { 'Content-Type': 'application/json' }) : h, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw Object.assign(new Error('De tool kon de server niet bereiken. Controleer je verbinding en probeer het opnieuw.'), { code: 'netwerk' }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(FOUT[j.error] || ('Fout ' + r.status)), { code: j.error || r.status });
    return j;
  }
  T.laad = async function (worker) {
    T.worker = worker || T.worker;
    try { T.status = await api('GET'); } catch (e) { T.status = null; }
    T.teken();
    return T.status;
  };
  // Badge(s) tekenen in elk element met data-tgk-badge.
  T.badgeHtml = function () {
    if (!root.MTKoppelUI) return '';
    const f = T.status && T.status.focus;
    if (!T.status) return '';
    if (f && f.gekoppeld && f.bron === 'eigen') return root.MTKoppelUI.badge({ status: 'gekoppeld', label: 'Toggl' + (f.naam ? ' (' + f.naam + ')' : ''), titel: 'Je eigen Toggl-sleutel is gekoppeld — klik voor details', onclick: 'MTToggl.details(this)' });
    if (f && f.bron === 'onleesbaar') return root.MTKoppelUI.badge({ status: 'open', label: 'Toggl — opnieuw koppelen', waarschuwing: 'opgeslagen sleutel is niet meer bruikbaar', titel: 'Je opgeslagen Toggl-sleutel is niet meer bruikbaar — klik om hem opnieuw te koppelen', onclick: 'MTToggl.wizard()' });
    if (f && f.gekoppeld && f.bron === 'secret') return root.MTKoppelUI.badge({ status: 'gekoppeld', label: 'Toggl (via beheer)', titel: 'De beheerder heeft je Toggl-sleutel ingesteld — klik om je eigen te koppelen', onclick: 'MTToggl.details(this)' });
    return root.MTKoppelUI.badge({ status: 'open', label: 'Toggl', titel: 'Koppel je Toggl — klik voor de stappen', onclick: 'MTToggl.wizard()' });
  };
  T.teken = function () {
    if (!doc) return;
    doc.querySelectorAll('[data-tgk-badge]').forEach(el => { el.innerHTML = T.badgeHtml(); });
    doc.querySelectorAll('[data-tgk-kaart]').forEach(el => { el.style.display = T.status ? '' : 'none'; });   // oude worker → kaart weg
    doc.querySelectorAll('[data-tgk-alleen-open]').forEach(el => {   // bv. mobiel: kaart alleen als je nog niet gekoppeld bent
      const f = T.status && T.status.focus; el.style.display = T.status && !(f && f.gekoppeld) ? '' : 'none';
    });
  };
  T.details = function (anker) {
    if (!root.MTKoppelUI) return;
    const f = (T.status && T.status.focus) || {}, tr = (T.status && T.status.track) || {};
    const datum = ms => ms ? new Date(ms).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const eigen = f.bron === 'eigen';
    root.MTKoppelUI.popover(anker, `<div class="kb-pop-rij"><span class="kb-pop-n">${eigen
        ? `Toggl 2.0: <b>${esc(f.naam || 'gekoppeld')}</b>${f.sinds ? ' · sinds ' + esc(datum(f.sinds)) : ''}${f.bevestigd ? '' : '<br><span style="font-size:12px;color:#666">Nog geen eigen uren gezien; eigenaarschap wordt bevestigd zodra je uren boekt.</span>'}`
        : 'De beheerder heeft een Toggl-sleutel voor je ingesteld. Koppel je eigen sleutel, dan beheer je hem zelf.'}</span></div>
      ${tr.gekoppeld && tr.bron === 'eigen' ? `<div class="kb-pop-rij"><span class="kb-pop-n">Toggl Track (oud): <b>${esc(tr.naam || 'gekoppeld')}</b></span></div>` : ''}
      <div class="kb-pop-acties"><button type="button" class="btn btn-xs btn-secondary tgk-knop" onclick="MTKoppelUI.sluit();MTToggl.wizard()">${eigen ? 'Vervangen' : 'Eigen sleutel koppelen'}</button>
      ${eigen || (tr.gekoppeld && tr.bron === 'eigen') ? '<button type="button" class="btn btn-xs btn-danger tgk-knop" onclick="MTKoppelUI.sluit();MTToggl.ontkoppel()">Ontkoppelen</button>' : ''}</div>`,
      { titel: eigen ? 'Gekoppeld · Toggl' : 'Toggl via beheer' });
  };
  T.ontkoppel = async function () {
    const vraag = 'Je Toggl ontkoppelen? Je sleutel wordt bij de worker verwijderd. Je uren in Toggl blijven staan.';
    const ja = root.mtDialog ? await root.mtDialog.confirm({ title: 'Toggl ontkoppelen', message: vraag, okLabel: 'Ontkoppelen' }) : root.confirm(vraag);
    if (!ja) return;
    try { T.status = await api('DELETE'); } catch (e) { (root.mtDialog ? root.mtDialog.alert({ title: 'Toggl', message: e.message }) : root.alert(e.message)); }
    T.teken();
  };
  T.sluitWizard = function () {
    const s = doc.getElementById('tgk-scherm'); if (s) s.remove();
    if (T._esc) doc.removeEventListener('keydown', T._esc), T._esc = null;
    if (T._terug && T._terug.focus) try { T._terug.focus(); } catch (e) {}
  };
  T.wizard = function () {
    if (!doc || doc.getElementById('tgk-scherm')) return;
    T._terug = doc.activeElement;
    const s = doc.createElement('div'); s.id = 'tgk-scherm'; s.className = 'tgk-scherm';
    s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'tgk-titel');
    s.innerHTML = `<div class="tgk-kaart">
      <h2 id="tgk-titel">Koppel je Toggl</h2>
      <div style="color:#555;font-size:13px">Eén keer instellen. Daarna lopen je timer en uren in de tool via je eigen Toggl-account.</div>
      <ol class="tgk-stappen">
        <li class="tgk-stap"><b>Open Toggl</b>Ga naar Toggl 2.0 en log in. Klik rechtsboven op je naam/foto en kies <i>Profiel</i> (Profile settings).
          <div style="margin-top:6px"><a class="tgk-knop" style="display:inline-flex;align-items:center;text-decoration:none;color:inherit" href="https://focus.toggl.com" target="_blank" rel="noopener">Open Toggl ↗</a></div></li>
        <li class="tgk-stap"><b>Kopieer je API-token</b>Scroll in je profiel naar <i>API token</i> en klik op <i>Kopiëren</i> (soms eerst <i>Tonen</i>).
          <div class="tgk-mock" aria-hidden="true"><div class="tgk-rij"><span>Naam</span><span>Jouw naam</span></div><div class="tgk-rij"><span>E-mail</span><span>jij@mortiseandtenon.nl</span></div>
          <div class="tgk-rij tgk-licht"><span>API token</span><span>••••••••••••  [Kopiëren]</span></div></div></li>
        <li class="tgk-stap"><b>Plak hem hier</b>
          <div class="tgk-veld"><label for="tgk-focus" class="mt-vh" style="position:absolute;left:-9999px">API-token Toggl 2.0</label>
            <input id="tgk-focus" type="password" autocomplete="off" spellcheck="false" placeholder="Plak je API-token" aria-describedby="tgk-st">
            <button type="button" class="tgk-knop" id="tgk-toon" aria-label="Token tonen" aria-pressed="false">👁</button></div>
          <details class="tgk-extra"><summary>Ook je oude Toggl Track-token (alleen nodig zolang Track nog gebruikt wordt)</summary>
            <div class="tgk-veld"><label for="tgk-track" style="position:absolute;left:-9999px">API-token Toggl Track</label><input id="tgk-track" type="password" autocomplete="off" spellcheck="false" placeholder="Track: track.toggl.com → Profile → API Token"></div></details>
          <div class="tgk-st" id="tgk-st" aria-live="polite"></div></li>
      </ol>
      <div class="tgk-onder"><button type="button" class="tgk-knop" id="tgk-annuleer">Annuleren</button><button type="button" class="tgk-knop tgk-hoofd" id="tgk-koppel">Koppelen</button></div>
    </div>`;
    doc.body.appendChild(s);
    const veld = doc.getElementById('tgk-focus'), st = doc.getElementById('tgk-st'), knop = doc.getElementById('tgk-koppel');
    veld.focus();
    // Esc sluit; Tab blijft binnen het venster (focus-trap).
    T._esc = e => {
      if (e.key === 'Escape') { T.sluitWizard(); return; }
      if (e.key !== 'Tab') return;
      const f = [...s.querySelectorAll('a[href],button:not([disabled]),input,summary')];
      if (!f.length) return;
      const eerste = f[0], laatste = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === eerste) { e.preventDefault(); laatste.focus(); }
      else if (!e.shiftKey && doc.activeElement === laatste) { e.preventDefault(); eerste.focus(); }
    };
    doc.addEventListener('keydown', T._esc);
    s.addEventListener('mousedown', e => { if (e.target === s) T.sluitWizard(); });
    doc.getElementById('tgk-annuleer').onclick = T.sluitWizard;
    doc.getElementById('tgk-toon').onclick = function () { const zie = veld.type === 'password'; veld.type = zie ? 'text' : 'password'; this.setAttribute('aria-pressed', String(zie)); };
    veld.addEventListener('keydown', e => { if (e.key === 'Enter') knop.click(); });
    knop.onclick = async function () {
      const focus = veld.value.trim(), track = (doc.getElementById('tgk-track').value || '').trim();
      st.className = 'tgk-st'; st.textContent = 'Controleren bij Toggl…'; knop.disabled = true;
      try {
        T.status = await api('POST', Object.assign({}, focus ? { focus } : {}, track ? { track } : {}));
        veld.value = ''; doc.getElementById('tgk-track').value = '';
        const f = T.status.focus || {};
        st.className = 'tgk-st goed'; st.textContent = 'Gekoppeld' + (f.naam ? ' als ' + f.naam : '') + '.';
        T.teken();
        knop.textContent = 'Klaar'; knop.disabled = false; knop.onclick = T.sluitWizard;
      } catch (e) {
        st.className = 'tgk-st fout'; st.textContent = e.message; knop.disabled = false;
      }
    };
  };
  root.MTToggl = T;
})(typeof window !== 'undefined' ? window : globalThis);
