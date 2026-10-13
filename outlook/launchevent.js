/* ============================================================================
 * outlook/launchevent.js — PROEF: automatisch info@ in de cc bij een antwoord op een gekoppeld gesprek (event-based activation).
 * ----------------------------------------------------------------------------
 * Hoort bij outlook/manifest-gebeurtenissen.xml (het aparte testmanifest; het gewone manifest.xml kent geen gebeurtenissen).
 * Draait zonder zichtbaar venster op de gebeurtenis OnNewMessageCompose (Mailbox 1.10): Outlook opent een antwoord of nieuw bericht en roept
 * onNewMessageComposeHandler aan. Standaard UIT: er gebeurt niets tenzij de instelling "mt_auto_cc" aan staat (roamingSettings; aan te zetten met
 * het vinkje in het paneel in een opstelvenster).
 * Regel (dezelfde als MTMail.ccInfoNodig in mt-mailactie.js; de harnas-test vergelijkt ze): het is een antwoord (er is een gespreks-id), het onderwerp
 * draagt een projecttag "[26xxxx]", info@ staat nog niet in Aan/Cc/Bcc en je schrijft niet zelf als info@. Dan wordt info@ aan de cc toegevoegd.
 * Bewust zelfstandig: de JavaScript-runtime van klassiek Outlook voor Windows laadt alleen dit ene bestand (geen mt-mailactie.js, geen netwerk, geen aanmelding).
 * Daarom kan het NIET controleren of het gesprek echt gekoppeld is: de tag in het onderwerp is het teken (die zet "Antwoord als info@" of de mailstroomregel).
 * Beperkingen: zie outlook/README.md ("Automatisch info@ in de cc").
 * ========================================================================== */
(function (root) {
  'use strict';
  var INFO = 'info@mortiseandtenon.nl', VLAG = 'mt_auto_cc';

  function tagUitOnderwerp(onderwerp) { var m = /\[\s*(26\d{4})\s*\]/.exec(String(onderwerp || '')); return m ? m[1] : ''; }
  function adresVan(x) { return String((x && (x.emailAddress || x.address)) || x || '').toLowerCase(); }
  function ccInfoNodig(o) {
    o = o || {};
    var info = String(o.info || '').toLowerCase();
    if (!info || !o.conversationId || !tagUitOnderwerp(o.onderwerp)) return false;
    var adressen = [].concat(o.aan || [], o.cc || [], o.bcc || []).map(adresVan);
    if (adressen.indexOf(info) >= 0) return false;
    if (String(o.van || '').toLowerCase() === info) return false;
    return true;
  }
  function waarde(f) {   // Office.js-aanroep met terugbelfunctie → belofte; null bij een fout of een ontbrekende eigenschap
    return new Promise(function (res) {
      try { f(function (r) { res(r && r.status === (root.Office && Office.AsyncResultStatus ? Office.AsyncResultStatus.Succeeded : 'succeeded') ? r.value : null); }); }
      catch (e) { res(null); }
    });
  }
  function aanGezet() { try { return Office.context.roamingSettings.get(VLAG) === true; } catch (e) { return false; } }

  async function onNewMessageComposeHandler(event) {
    try {
      if (!aanGezet()) return;                                  // standaard uit
      var it = Office.context.mailbox.item;
      if (!it || !it.conversationId || !it.subject || !it.cc) return;   // geen antwoord (nieuw bericht) of geen opstelvenster
      var lees = function (e) { return e && typeof e.getAsync === 'function' ? waarde(function (cb) { e.getAsync(cb); }) : Promise.resolve(null); };
      var res = await Promise.all([lees(it.subject), lees(it.to), lees(it.cc), lees(it.bcc), lees(it.from)]);
      var nodig = ccInfoNodig({ info: INFO, conversationId: it.conversationId, onderwerp: res[0], aan: res[1] || [], cc: res[2] || [], bcc: res[3] || [], van: res[4] && res[4].emailAddress });
      if (nodig) await waarde(function (cb) { it.cc.addAsync([INFO], cb); });
    } catch (e) { /* een proef mag het opstellen nooit blokkeren */ }
    finally { try { event.completed(); } catch (e2) { /* geen gebeurtenis (test) */ } }
  }

  root.MTLaunch = { INFO: INFO, VLAG: VLAG, tagUitOnderwerp: tagUitOnderwerp, ccInfoNodig: ccInfoNodig, onNewMessageComposeHandler: onNewMessageComposeHandler };
  if (root.Office && Office.actions && typeof Office.actions.associate === 'function') Office.actions.associate('onNewMessageComposeHandler', onNewMessageComposeHandler);
})(typeof window !== 'undefined' ? window : globalThis);
