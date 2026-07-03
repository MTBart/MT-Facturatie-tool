/* ============================================================================
 * mt-dialog.js — nette <dialog>-flows als vervanger voor prompt()/confirm()
 * ----------------------------------------------------------------------------
 * Audit 2026-07-02, actie S6: de blokkerende browser-dialogen (grijs, buiten
 * de huisstijl, geen HTML) vervangen door één herbruikbare, Promise-gebaseerde
 * <dialog>-helper in de cockpit-tokens (--green/--gold, Segoe UI toolbreed).
 *
 * Waarom een EIGEN bestand i.p.v. in mt-core.js:
 *   - mt-core.js is per zijn eigen kop-comment de DATA/AUTH-laag (esc/_encPath/
 *     MSAL/_SP). Een UI-widget met eigen CSS + DOM hoort daar niet bij.
 *   - De repo splitst herbruikbare brokken al in losse <script src> (calc-engine,
 *     mt-toggl, mt-inbox). Dit volgt datzelfde patroon: los bestand, ?v=-cachebust,
 *     globals expliciet op window (geen build-pipeline).
 *   - Zo is de dialog-laag zelfstandig te laden door v2 én (later) mobiel.
 *
 * Interface (alles Promise-gebaseerd; Escape/annuleren/backdrop = afwijzen):
 *   mtDialog.confirm(opts)  -> Promise<boolean>            (false bij annuleren)
 *   mtDialog.prompt(opts)   -> Promise<string|null>        (null bij annuleren)
 *   mtDialog.choose(opts)   -> Promise<number|null>        (gekozen index, null bij annuleren)
 *   mtDialog.alert(opts)    -> Promise<void>
 *
 * opts (string wordt als {message} opgevat):
 *   { title?, message?, html?, okLabel?, cancelLabel?, danger?, defaultValue?,
 *     placeholder?, multiline?, choices?: [{label, sublabel?}], defaultIndex? }
 *   - html: vertrouwde HTML-body (bv. mail-preview). message: platte tekst,
 *     wordt ge-escaped en \n → <br>.
 *   - danger: kleurt de OK-knop rood (verwijder-acties).
 *
 * Gedrag is bewust IDENTIEK aan de vervangen prompt/confirm: zelfde teksten en
 * uitkomsten, alleen de UI-laag verandert.
 * ========================================================================== */
(function (root) {
  'use strict';
  if (!root || !root.document) return;
  const doc = root.document;

  // esc — leun op de canonieke escaper uit mt-core; val faalveilig terug.
  const esc = typeof root.esc === 'function'
    ? root.esc
    : (s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

  // Tekst → veilige HTML met behoud van regeleinden (net als de \n in prompt-teksten).
  function textToHtml(s) { return esc(s).replace(/\n/g, '<br>'); }

  // Eénmalig de stylesheet injecteren (cockpit-tokens; geen inline-CSS-herhaling).
  let styleInjected = false;
  function ensureStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const css = `
    dialog.mt-dialog{
      border:none;border-radius:12px;padding:0;max-width:480px;width:calc(100vw - 40px);
      background:var(--surface-overlay,#fff);color:var(--text,#1a1a1a);
      box-shadow:0 12px 40px rgba(0,0,0,.28);font-family:var(--sans,Segoe UI,system-ui,sans-serif);
    }
    dialog.mt-dialog::backdrop{background:rgba(20,30,24,.42);backdrop-filter:blur(1px)}
    dialog.mt-dialog .mtd-head{
      padding:16px 20px 0;font-family:var(--serif,var(--sans));font-size:16px;font-weight:600;color:var(--green,#2A4A38);
    }
    dialog.mt-dialog .mtd-body{padding:12px 20px 4px;font-size:14px;line-height:1.55;color:var(--text,#1a1a1a);max-height:60vh;overflow:auto}
    dialog.mt-dialog .mtd-body a{color:var(--gold-text,#7A6010)}
    dialog.mt-dialog .mtd-field{
      width:100%;margin-top:12px;padding:9px 11px;font:inherit;font-size:14px;
      border:1px solid var(--border,#ccc);border-radius:8px;background:var(--surface,#fafafa);color:var(--text,#1a1a1a);outline:none;
    }
    dialog.mt-dialog .mtd-field:focus{border-color:var(--gold,#B8962E);box-shadow:0 0 0 3px var(--gold-50,#FBF5E0)}
    textarea.mtd-field{resize:vertical;min-height:72px}
    dialog.mt-dialog .mtd-choices{margin-top:10px;display:flex;flex-direction:column;gap:6px}
    dialog.mt-dialog .mtd-choice{
      text-align:left;padding:9px 12px;border:1px solid var(--border,#ccc);border-radius:8px;
      background:var(--surface,#fafafa);color:var(--text,#1a1a1a);cursor:pointer;font:inherit;font-size:13px;line-height:1.4;
    }
    dialog.mt-dialog .mtd-choice:hover,dialog.mt-dialog .mtd-choice:focus{border-color:var(--green,#2A4A38);background:var(--green-50,#E6EFE9);outline:none}
    dialog.mt-dialog .mtd-choice .mtd-sub{display:block;color:var(--text-dim,#666);font-size:12px;margin-top:2px}
    dialog.mt-dialog .mtd-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px 18px}
    dialog.mt-dialog .mtd-btn{
      padding:8px 16px;border-radius:8px;border:1px solid var(--border,#ccc);background:var(--surface,#f4f4f4);
      color:var(--text,#1a1a1a);font:inherit;font-size:13px;font-weight:500;cursor:pointer;
    }
    dialog.mt-dialog .mtd-btn:hover{background:var(--surface-sunken,#ececec)}
    dialog.mt-dialog .mtd-btn.mtd-ok{background:var(--green,#2A4A38);border-color:var(--green,#2A4A38);color:#fff}
    dialog.mt-dialog .mtd-btn.mtd-ok:hover{background:var(--green-700,#1E3829)}
    dialog.mt-dialog .mtd-btn.mtd-ok.mtd-danger{background:var(--red,#c0392b);border-color:var(--red,#c0392b)}
    dialog.mt-dialog .mtd-btn.mtd-ok.mtd-danger:hover{filter:brightness(.92)}
    `;
    const st = doc.createElement('style');
    st.textContent = css;
    doc.head.appendChild(st);
  }

  // Kern: bouw een <dialog>, toon modaal, resolve met resultaat, ruim op.
  // kind bepaalt welke body-elementen + welke resolve-waarde.
  function open(kind, opts) {
    ensureStyle();
    opts = (typeof opts === 'string') ? { message: opts } : (opts || {});
    return new Promise(resolve => {
      const dlg = doc.createElement('dialog');
      dlg.className = 'mt-dialog';

      const bodyHtml = opts.html != null ? String(opts.html)
        : (opts.message != null ? textToHtml(opts.message) : '');
      let inner = '';
      if (opts.title) inner += `<div class="mtd-head">${esc(opts.title)}</div>`;
      inner += `<div class="mtd-body">${bodyHtml}`;

      if (kind === 'prompt') {
        const val = opts.defaultValue == null ? '' : String(opts.defaultValue);
        const ph = opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : '';
        inner += opts.multiline
          ? `<textarea class="mtd-field" id="mtd-input"${ph}>${esc(val)}</textarea>`
          : `<input type="text" class="mtd-field" id="mtd-input" value="${esc(val)}"${ph}>`;
      }
      if (kind === 'choose') {
        inner += `<div class="mtd-choices" id="mtd-choices">`;
        (opts.choices || []).forEach((c, i) => {
          const label = typeof c === 'string' ? c : (c.label || '');
          const sub = (c && c.sublabel) ? `<span class="mtd-sub">${esc(c.sublabel)}</span>` : '';
          inner += `<button type="button" class="mtd-choice" data-i="${i}">${esc(label)}${sub}</button>`;
        });
        inner += `</div>`;
      }
      inner += `</div>`;

      // Voettekst-knoppen. 'choose' heeft alleen Annuleren (keuze = klik op item).
      const okLabel = esc(opts.okLabel || 'OK');
      const cancelLabel = esc(opts.cancelLabel || 'Annuleren');
      const dangerCls = opts.danger ? ' mtd-danger' : '';
      inner += `<div class="mtd-foot">`;
      if (kind !== 'alert') inner += `<button type="button" class="mtd-btn" id="mtd-cancel">${cancelLabel}</button>`;
      if (kind !== 'choose') inner += `<button type="button" class="mtd-btn mtd-ok${dangerCls}" id="mtd-ok">${okLabel}</button>`;
      inner += `</div>`;
      dlg.innerHTML = inner;
      doc.body.appendChild(dlg);

      let done = false;
      function finish(result) {
        if (done) return; done = true;
        try { dlg.close(); } catch (e) {}
        dlg.remove();
        resolve(result);
      }
      const cancelVal = kind === 'confirm' ? false : null;

      const okBtn = dlg.querySelector('#mtd-ok');
      const cancelBtn = dlg.querySelector('#mtd-cancel');
      const input = dlg.querySelector('#mtd-input');

      if (okBtn) okBtn.addEventListener('click', () => {
        if (kind === 'prompt') finish(input ? input.value : '');
        else if (kind === 'alert') finish(undefined);
        else finish(true);          // confirm
      });
      if (cancelBtn) cancelBtn.addEventListener('click', () => finish(cancelVal));
      if (kind === 'choose') {
        dlg.querySelectorAll('.mtd-choice').forEach(btn =>
          btn.addEventListener('click', () => finish(parseInt(btn.getAttribute('data-i'), 10))));
      }

      // Escape / systeem-cancel (backdrop bij sommige browsers) = afwijzen.
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(cancelVal); });
      // Klik op de backdrop (buiten de dialoog-inhoud) = afwijzen.
      dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(cancelVal); });

      dlg.showModal();
      // Focus: prompt → invoerveld (met selectie), anders de OK-knop.
      if (input) { input.focus(); if (input.select) input.select(); }
      else if (okBtn) okBtn.focus();
      else if (cancelBtn) cancelBtn.focus();

      // Enter in een 1-regelig promptveld = bevestigen.
      if (input && !opts.multiline) input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      });
    });
  }

  root.mtDialog = {
    confirm: (opts) => open('confirm', opts),
    prompt: (opts) => open('prompt', opts),
    choose: (opts) => open('choose', opts),
    alert: (opts) => open('alert', opts)
  };

})(typeof window !== 'undefined' ? window : null);
