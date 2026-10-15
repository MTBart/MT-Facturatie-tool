/* ============================================================================
 * mt-startvenster.js — "X taken wachten op je" (Toggl Focus-stijl), planning stap 3
 * ----------------------------------------------------------------------------
 * Bij het openen van Agenda/Planning op de desktop en bij het openen van de telefoon-app: als er GEEN Toggl-timer loopt en je open taken hebt
 * (te laat · vandaag · deze week, dezelfde berekening als Mijn werk / Vandaag), komt er één venster met maximaal 5 taken, elk met een knop
 * "Start timer", en onderaan "Overslaan". Na Overslaan of na een gestarte timer komt het in dezelfde sessie niet terug (sessionStorage).
 *
 * Tekent met de bestaande mtDialog.choose (Esc, achtergrond of Overslaan = overslaan; alles als tekst, nooit als HTML) en schrijft zelf niets:
 * het starten van de timer is de bestaande route van de host (cockpit: Toggl Track via de worker; telefoon: de timer van Vandaag).
 * Nooit een fout naar buiten: is er geen rol, geen login, geen taken of is de timerstand onbekend, dan blijft het venster weg.
 * Alles komt van buiten via init(deps), zodat het zonder de hele app te testen is.
 *
 * deps: { doc, storage (sessionStorage), dialog():mtDialog, toast(tekst), demo():bool, rolKlaar():bool (/me geladen; tot dan geen venster), lezen():bool (rol "lezen"), magTimer():bool,
 *         klaar():bool (takenlijst geladen), mijnWerk():{groepen}, timerLoopt():Promise<true|false|null>, project(code):{label}|null,
 *         start(item):Promise<{ok,reden}|any>, nogActief():bool (optioneel: is de tab nog in beeld), slaap(ms):Promise (optioneel) }
 * ========================================================================== */
(function (root) {
  'use strict';
  const S = {};
  let D = null;
  const LS_GEZIEN = 'mt_startvenster_gezien', MAX = 5, POGINGEN = 4, WACHT_MS = 3000;
  const GROEPEN = [['teLaat', 'te laat'], ['vandaag', 'vandaag'], ['week', 'deze week']];

  const gezien = () => { try { return D.storage.getItem(LS_GEZIEN) === '1'; } catch (e) { return false; } };
  const markeerGezien = () => { try { D.storage.setItem(LS_GEZIEN, '1'); } catch (e) { /* geen opslag: dan blijft alleen het geheugen over */ } };
  const slaap = ms => (D.slaap ? D.slaap(ms) : new Promise(r => setTimeout(r, ms)));

  // Puur: uit de uitkomst van mijnWerk de taken voor het venster. Een taak die op "Wacht" staat is geblokkeerd en krijgt geen startknop;
  // planblokken zonder taak horen er niet in. → { totaal, items: [{ item, groep, wanneer }] } (max `max` items, in de volgorde te laat · vandaag · week).
  S.kies = function (mw, max) {
    const groepen = (mw && mw.groepen) || {}, lijst = [];
    GROEPEN.forEach(([k, tekst]) => (groepen[k] || []).forEach(i => { if (i && i.soort === 'taak' && i.taak && i.status !== 'klaar' && i.status !== 'wacht') lijst.push({ item: i, groep: k, wanneer: tekst }); }));
    return { totaal: lijst.length, items: lijst.slice(0, max || MAX) };
  };
  S.titel = n => n === 1 ? '1 taak wacht op je' : n + ' taken wachten op je';

  // Fail-closed op de rol: zolang de rolgegevens (/me) niet binnen zijn is het 'wacht'; zonder rolKlaar-dep ook (nooit "mag vanzelf").
  const rolStand = () => {
    try {
      if (!D.rolKlaar || !D.rolKlaar()) return 'wacht';
      return (D.lezen && D.lezen()) || !D.magTimer || !D.magTimer() ? 'nee' : 'ja';
    } catch (e) { return 'wacht'; }
  };
  async function wachtOpGegevens() {
    for (let i = 0; i < POGINGEN; i++) {
      if (D.nogActief && !D.nogActief()) return null;
      const rol = rolStand();
      if (rol === 'nee') return null;
      let loopt = null;
      if (rol === 'ja' && D.klaar()) { try { loopt = await D.timerLoopt(); } catch (e) { loopt = null; } }
      if (loopt === true) return null;             // er loopt al een timer: geen venster
      if (loopt === false) return { loopt };       // takenlijst klaar en geen timer
      if (i < POGINGEN - 1) await slaap(WACHT_MS); // nog niet te weten (laden, niet ingelogd): even later nog eens
    }
    return null;
  }

  // Toont het venster als het mag. → true als het getoond is.
  S.toon = async function () {
    if (!D || S.bezig || gezien()) return false;
    S.bezig = true;
    try {
      if (D.demo && D.demo()) return false;
      if (!(await wachtOpGegevens())) return false;
      if (D.nogActief && !D.nogActief()) return false;
      const k = S.kies(D.mijnWerk(), MAX);
      if (!k.items.length) return false;
      const keuzes = k.items.map(x => {
        const p = D.project ? D.project(x.item.code) : null;
        return { label: 'Start timer: ' + x.item.taak.naam, sublabel: [p ? (p.label || p.naam || x.item.code) : String(x.item.code || ''), x.wanneer].filter(Boolean).join(' · ') };
      });
      const d = D.dialog();
      const belofte = d.choose({ title: S.titel(k.totaal), message: k.totaal > k.items.length ? 'De eerste ' + k.items.length + ' van ' + k.totaal + '. Er loopt nu geen timer.' : 'Er loopt nu geen timer.', choices: keuzes, cancelLabel: 'Overslaan' });
      try { const eerste = D.doc.querySelector('dialog.mt-dialog .mtd-choice'); if (eerste) eerste.focus(); } catch (e) { /* focus is gemak */ }
      const i = await belofte;
      markeerGezien();                              // Overslaan, Esc of een gestarte timer: niet nog eens in deze sessie
      if (typeof i !== 'number' || !k.items[i]) return true;
      if (rolStand() !== 'ja') { if (D.toast) D.toast('Dit mag je niet met jouw rol.'); return true; }   // opnieuw vlak voor de start
      try {
        const r = await D.start(k.items[i].item);
        if (r && r.ok === false && D.toast) D.toast(r.reden || 'De timer kon niet starten.');
        else if (D.toast && r && r.ok) D.toast('Timer gestart op ' + k.items[i].item.taak.naam);
      } catch (e) { if (D.toast) D.toast('De timer kon niet starten: ' + String((e && e.message) || e)); }
      return true;
    } catch (e) {
      try { console.warn('Startvenster:', e && e.message); } catch (x) {}
      return false;
    } finally { S.bezig = false; }
  };

  S.init = function (deps) { D = deps; return S; };
  S._gezien = () => (D ? gezien() : false);
  root.MTStartvenster = S;
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof window !== 'undefined' ? window : globalThis);
