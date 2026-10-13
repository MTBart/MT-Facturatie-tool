/* ============================================================================
 * outlook/launchevent.js — PROEF: automatisch info@ in de cc bij een antwoord op een gekoppeld gesprek (event-based activation).
 * ----------------------------------------------------------------------------
 * Hoort bij outlook/manifest-gebeurtenissen.xml (het aparte testmanifest; het gewone manifest.xml kent geen gebeurtenissen).
 * Draait zonder zichtbaar venster op de gebeurtenis OnNewMessageCompose (Mailbox 1.10): Outlook opent een antwoord of nieuw bericht en roept
 * onNewMessageComposeHandler aan. Standaard UIT: er gebeurt niets tenzij de instelling "mt_auto_cc" aan staat (roamingSettings; aan te zetten met
 * het vinkje in het paneel in een opstelvenster).
 * Regel (dezelfde als MTMail.ccInfoNodig in mt-mailactie.js; de harnas-test vergelijkt ze): het is een antwoord (er is een gespreks-id), het gesprek is ECHT gekoppeld,
 * het onderwerp draagt een projecttag "[26xxxx]", info@ staat nog niet in Aan/Cc/Bcc en je schrijft niet zelf als info@. Dan wordt info@ aan de cc toegevoegd.
 * "Echt gekoppeld": het paneel onthoudt van elk gekoppeld gesprek een korte hash van het gespreks-id in de Outlook-instellingen (roamingSettings, sleutel mt_gekoppeld;
 * zelfde hash als MTMail.gespreksHash). Deze runtime heeft geen netwerk of aanmelding en kan het koppelregister zelf niet lezen; een tag alleen is niet genoeg.
 * Bewust zelfstandig: de JavaScript-runtime van klassiek Outlook voor Windows laadt alleen dit ene bestand (geen mt-mailactie.js, geen netwerk, geen aanmelding).
 * Een gesprek dat op een ander apparaat of door een collega is gekoppeld, staat hier (nog) niet in: dan gebeurt er niets (alleen de knop in het paneel).
 * Beperkingen: zie outlook/README.md ("Automatisch info@ in de cc").
 * ========================================================================== */
(function (root) {
  'use strict';
  var INFO = 'info@mortiseandtenon.nl', VLAG = 'mt_auto_cc', LIJST = 'mt_gekoppeld';

  function tagUitOnderwerp(onderwerp) { var m = /\[\s*(26\d{4})\s*\]/.exec(String(onderwerp || '')); return m ? m[1] : ''; }
  function gespreksHash(id) {   // gelijk aan MTMail.gespreksHash
    var s = String(id || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '').toLowerCase();
    if (!s) return '';
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function gespreksBekend(lijst, id) { var h = gespreksHash(id); return !!h && Array.isArray(lijst) && lijst.indexOf(h) >= 0; }
  function adresVan(x) { return String((x && (x.emailAddress || x.address)) || x || '').toLowerCase(); }
  function ccInfoNodig(o) {
    o = o || {};
    var info = String(o.info || '').toLowerCase();
    if (!info || !o.conversationId || o.gekoppeld !== true || !tagUitOnderwerp(o.onderwerp)) return false;
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
  function gekoppeldeLijst() { try { return Office.context.roamingSettings.get(LIJST) || []; } catch (e) { return []; } }
  function aanGezet() { try { return Office.context.roamingSettings.get(VLAG) === true; } catch (e) { return false; } }

  async function onNewMessageComposeHandler(event) {
    try {
      if (!aanGezet()) return;                                  // standaard uit
      var it = Office.context.mailbox.item;
      if (!it || !it.conversationId || !it.subject || !it.cc) return;   // geen antwoord (nieuw bericht) of geen opstelvenster
      var lees = function (e) { return e && typeof e.getAsync === 'function' ? waarde(function (cb) { e.getAsync(cb); }) : Promise.resolve(null); };
      var res = await Promise.all([lees(it.subject), lees(it.to), lees(it.cc), lees(it.bcc), lees(it.from)]);
      var nodig = ccInfoNodig({ info: INFO, conversationId: it.conversationId, gekoppeld: gespreksBekend(gekoppeldeLijst(), it.conversationId), onderwerp: res[0], aan: res[1] || [], cc: res[2] || [], bcc: res[3] || [], van: res[4] && res[4].emailAddress });
      if (nodig) await waarde(function (cb) { it.cc.addAsync([INFO], cb); });
    } catch (e) { /* een proef mag het opstellen nooit blokkeren */ }
    finally { try { event.completed(); } catch (e2) { /* geen gebeurtenis (test) */ } }
  }

  root.MTLaunch = { INFO: INFO, VLAG: VLAG, tagUitOnderwerp: tagUitOnderwerp, gespreksHash: gespreksHash, gespreksBekend: gespreksBekend, ccInfoNodig: ccInfoNodig, onNewMessageComposeHandler: onNewMessageComposeHandler };
  if (root.Office && Office.actions && typeof Office.actions.associate === 'function') Office.actions.associate('onNewMessageComposeHandler', onNewMessageComposeHandler);
})(typeof window !== 'undefined' ? window : globalThis);
