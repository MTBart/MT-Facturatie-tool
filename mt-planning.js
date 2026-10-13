/* ============================================================================
 * mt-planning.js — planning-kern (P0/P1), gedeeld door v2.html en mobiel.html
 * ----------------------------------------------------------------------------
 * Pure functies, geen DOM en geen opslag: zo zijn ze te testen zonder browser.
 *
 *  • Eenheden: ÉÉN tijdseenheid = minuten. Toggl-entries staan in seconden (`duur`), planblokken
 *    in minuten (`duurMin`), taakramingen in uren (`duur_uur`). Alles gaat via de helpers hieronder.
 *  • Persoonsleutel: ÉÉN sleutel = het team-slug ('bart'). Planblokken hebben slug of e-mail,
 *    entries een naam of "User 123". `persoonSlug` brengt ze op dezelfde noemer.
 *  • Tarief: ÉÉN bron = Instellingen ▸ Uurtarieven (`mt_uurtarieven`); de standaard staat hier.
 *  • Taken per project (uitbreiding van het bestaande mt_project_taken, geen tweede model):
 *    activiteit, budget in minuten, toegewezen, stempel per veld (`_vs`), tombstone (`_vervallen`).
 *  • Meter: budget / gepland / geklokt (gekoppeld aan een taak) / geklokt (ongekoppeld) / resterend.
 * ========================================================================== */
(function (root) {
  'use strict';
  const P = {};

  // ── Eenheden: minuten ────────────────────────────────────────────────────────────────────────────
  const getal = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
  P.secNaarMin = s => Math.round(getal(s) / 60);
  P.urenNaarMin = u => Math.round(getal(u) * 60);
  P.minNaarUren = m => Math.round(getal(m) / 60 * 100) / 100;
  // "12,5 u" (één decimaal, komma)
  P.fmtUur = m => (Math.round(getal(m) / 60 * 10) / 10).toString().replace('.', ',') + ' u';
  // Duur van een geklokte entry in minuten (`duur` in seconden; `duration` is de ruwe Toggl-naam).
  P.entryMin = e => {
    if (!e) return 0;
    const s = e.duur != null ? e.duur : e.duration;
    const n = getal(s);
    return n > 0 ? Math.round(n / 60) : 0;
  };

  // ── Persoonsleutel: team-slug ────────────────────────────────────────────────────────────────────
  // team = [{slug, email, naam, label}]. Slug, e-mail, naam of label (hoofdletterongevoelig) → slug.
  // Zonder team (mobiel): een e-mailadres geeft het deel voor de @. Onbekend → ''.
  P.persoonSlug = function (x, team) {
    const s = String(x == null ? '' : x).trim().toLowerCase();
    if (!s) return '';
    for (const m of (team || [])) {
      if (!m) continue;
      const kand = [m.slug, m.email, m.naam, m.label].filter(Boolean).map(v => String(v).trim().toLowerCase());
      if (kand.includes(s)) return String(m.slug || '').toLowerCase();
    }
    if (!(team && team.length) && s.includes('@')) return s.split('@')[0];
    return (team && team.length) ? '' : s;
  };
  P.zelfdePersoon = (a, b, team) => {
    const sa = P.persoonSlug(a, team), sb = P.persoonSlug(b, team);
    if (sa && sb) return sa === sb;
    return String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase() && !!String(a || '').trim();
  };

  // ── Geklokte entries filteren zoals de Agenda (lege set = alles; AG_NONE = niets) ─────────────────
  // codes/pers: Set of array; van/tot: ymd (inclusief), op de startdatum van de entry.
  P.AG_NONE = '__none__';
  P.entriesFilter = function (entries, { codes = null, pers = null, van = null, tot = null, team = null } = {}) {
    const set = x => x instanceof Set ? x : (Array.isArray(x) ? new Set(x) : null);
    const c = set(codes), p = set(pers);
    if ((c && c.has(P.AG_NONE)) || (p && p.has(P.AG_NONE))) return [];
    const persSlugs = p && p.size ? new Set([...p].map(v => P.persoonSlug(v, team) || String(v).trim().toLowerCase())) : null;
    return (entries || []).filter(e => {
      if (!e) return false;
      const dag = String(e.datum || e.start || '').slice(0, 10);
      if (van && dag < van) return false;
      if (tot && dag > tot) return false;
      if (c && c.size && !c.has(e.project_code)) return false;
      if (persSlugs) {
        const sl = P.persoonSlug(e.teamlid, team) || String(e.teamlid == null ? '' : e.teamlid).trim().toLowerCase();
        if (!persSlugs.has(sl)) return false;
      }
      return true;
    });
  };

  // ── Uurtarief: één bron ──────────────────────────────────────────────────────────────────────────
  // Instellingen ▸ Uurtarieven (`mt_uurtarieven`: {bart: 55, …, _std: 55}). Ontbreekt de standaard daar,
  // dan geldt deze waarde. Ook de calculatie (nieuwe uurregels) en de nacalculatie gebruiken deze bron.
  P.UURTARIEF_STD = 55;
  P.uurtariefStd = cfg => {
    const v = cfg && cfg._std;
    return (v != null && v !== '' && isFinite(Number(v))) ? Number(v) : P.UURTARIEF_STD;
  };
  P.uurtarief = function (cfg, naam) {
    const t = cfg || {}, k = String(naam || '').toLowerCase().trim(), k1 = k.split(/[ @.]/)[0];   // "bart witte" / "bart@…" → "bart"
    const v = t[k] != null ? t[k] : (t[k1] != null ? t[k1] : null);
    return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : P.uurtariefStd(t);
  };

  root.MTPlanning = P;
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
