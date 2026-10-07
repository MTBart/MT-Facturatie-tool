/* ============================================================================
 * calc-engine.js — Offerte-calculator reken-engine (Fase 0)
 * ----------------------------------------------------------------------------
 * Pure, framework-loze 1-op-1 vertaling van de bedrijfscoach-sheet
 * "Financieel plan" → de drie verborgen tabbladen die op elkaar stapelen:
 *
 *   [16] Inkooplijst grondstoffen  →  prijs_per_eenheid = inkoopprijs / inhoud
 *   [17] Kostprijzen berekenen     →  Σ(grondstof × hoeveelheid) + uren
 *   [18] Kost- en verkoopprijzen   →  + extra's + btw → verkoopprijs & marge
 *
 * Spec-bron: Administratie/financieel-plan/01-offerte-calculator.md (in de Vault).
 *
 * Geen DOM, geen I/O, geen netwerk → 100% unit-testbaar met node.
 * Opslag (Fase 1) gaat via _SP.read/_SP.write naar privé SharePoint-JSON
 * (mt_calc_materialen.json / mt_calc_producten.json / mt_calc_verkoop.json),
 * net als interiorcad-materialen.json — bevat inkoopprijs+marge, dus NIET in
 * de publieke repo committen als data; dit bestand bevat alleen logica.
 *
 * Conventies:
 *  - btw_tarief is een BREUK (0.21 = 21%), niet een percentage-getal.
 *  - bedragen in euro's, ex. btw tenzij anders benoemd.
 *  - lege/ongeldige invoer → null (sheet liet de cel leeg), niet 0.
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node/test
  if (root) root.MTCalc = api;                                              // browser → window.MTCalc
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // ---- helpers -------------------------------------------------------------
  const num = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
    return isNaN(n) ? null : n;
  };
  const isBlank = (v) => v === '' || v === null || v === undefined;

  // ==========================================================================
  // [16] Inkooplijst grondstoffen — materiaal
  // ==========================================================================
  const EENHEDEN = ['ml', 'l', 'g', 'kg', 'mm', 'cm', 'm', 'stuk(s)'];

  /**
   * prijs_per_eenheid = inkoopprijs_ex_btw / inhoud   (sheet kol G = F / D)
   * @returns {number|null}
   */
  function prijsPerEenheid(materiaal) {
    const prijs = num(materiaal && materiaal.inkoopprijs_ex_btw);
    const inhoud = num(materiaal && materiaal.inhoud);
    if (prijs === null || inhoud === null || inhoud === 0) return null;
    return prijs / inhoud;
  }

  /** Verrijk een materiaal met de afgeleide prijs_per_eenheid. */
  function verrijktMateriaal(m) {
    return Object.assign({}, m, { prijs_per_eenheid: prijsPerEenheid(m) });
  }

  /** Index op id voor snelle lookup (de VLOOKUP-bron van tab 17). */
  function indexMaterialen(materialen) {
    const byId = new Map();
    (materialen || []).forEach((m) => byId.set(m.id, verrijktMateriaal(m)));
    return byId;
  }

  // ==========================================================================
  // [17] Kostprijzen berekenen — kostprijs per product
  // ==========================================================================
  /**
   * Bereken kostprijs van één product.
   * @param {object} product { naam, productietijd_min, uurloon, regels:[{materiaal_id, hoeveelheid}] }
   * @param {Map}    matIndex  van indexMaterialen()
   * @returns {{kostprijs_materiaal:number, kostprijs_uren:number, totale_kostprijs:number, regels:Array}}
   */
  function kostprijsProduct(product, matIndex) {
    const regels = (product && product.regels) || [];
    let kostprijs_materiaal = 0;
    const regelDetail = regels.map((r) => {
      const m = matIndex.get(r.materiaal_id);
      const ppe = m ? m.prijs_per_eenheid : null;          // tab16 kol G via VLOOKUP
      const hoev = num(r.hoeveelheid);
      // sheet: IFERROR(VLOOKUP(...)*hoeveelheid,"") — onbekend materiaal telt 0
      const regelkost = (ppe === null || hoev === null) ? null : ppe * hoev;
      if (regelkost !== null) kostprijs_materiaal += regelkost;
      return {
        materiaal_id: r.materiaal_id,
        product: m ? m.product : null,
        eenheid: m ? m.eenheid : null,                     // auto eenheid-weergave (tab17 kol E)
        prijs_per_eenheid: ppe,
        hoeveelheid: hoev,
        regelkost: regelkost,
      };
    });

    const tijd = num(product && product.productietijd_min);
    const loon = num(product && product.uurloon);
    const kostprijs_uren = (tijd === null || loon === null) ? 0 : (tijd / 60) * loon;
    const totale_kostprijs = kostprijs_materiaal + kostprijs_uren;

    return {
      kostprijs_materiaal,            // tab18 → I-component (BM)
      kostprijs_uren,                 // BN — los nodig voor "marge ex. productietijd"
      totale_kostprijs,               // BO
      regels: regelDetail,
    };
  }

  // ==========================================================================
  // [18] Kost- en verkoopprijzen — verkoopprijs & marge per scenario
  // ==========================================================================
  /**
   * verkoopprijs_ex afleiden uit de scenario-invoer.
   *  - B2C       : invoer = verkoopprijs INCL btw → ex = incl / (1+btw)
   *  - B2B       : invoer = verkoopprijs EX btw (direct)
   *  - SalesAgent: invoer = verkoopprijs EX btw (direct)
   */
  function verkoopExUitScenario(scenario, invoer, btw) {
    const v = num(invoer);
    if (v === null) return null;
    if (scenario === 'B2C') {
      const b = num(btw); if (b === null) return null;
      return v / (1 + b);
    }
    return v; // B2B / SalesAgent voeren al ex-btw in
  }

  /**
   * Eén scenario doorrekenen.
   * @returns {{verkoopprijs_ex, brutowinst, marge_pct, marge_pct_ex_uren, factor}}
   */
  function scenarioResultaat(scenario, invoer, ctx) {
    // ctx = { totale_kostprijs_incl, kostprijs_uren, btw_tarief }
    const ex = verkoopExUitScenario(scenario, invoer, ctx.btw_tarief);
    if (ex === null) {
      return { verkoopprijs_ex: null, brutowinst: null, marge_pct: null, marge_pct_ex_uren: null, factor: null };
    }
    const tki = ctx.totale_kostprijs_incl;
    const brutowinst = ex - tki;                                   // L / P / U
    const marge_pct = ex === 0 ? null : brutowinst / ex;           // M / Q / V
    // "Brutowinst % (ex. productietijd)" = (ex − tki + uren) / ex  (sheet kol N)
    const marge_pct_ex_uren = ex === 0 ? null : (ex - tki + (ctx.kostprijs_uren || 0)) / ex;
    const factor = tki === 0 ? null : ex / tki;                    // B2B kol S "Factor"
    return { verkoopprijs_ex: ex, brutowinst, marge_pct, marge_pct_ex_uren, factor };
  }

  /**
   * Volledige verkoopprijs-rij voor één product (tab 18).
   * @param {object} kost  resultaat van kostprijsProduct()
   * @param {object} vp    { verpakking, import, transport, overig, btw_tarief,
   *                         scenarios:{ B2C, B2B, SalesAgent } }  // scenario-waarde = ingevulde verkoopprijs
   */
  function verkoopprijsRij(kost, vp) {
    const extra =
      (num(vp.verpakking) || 0) +
      (num(vp.import) || 0) +
      (num(vp.transport) || 0) +
      (num(vp.overig) || 0);
    const totale_kostprijs_incl = kost.totale_kostprijs + extra;   // tab18 kol I
    const ctx = {
      totale_kostprijs_incl,
      kostprijs_uren: kost.kostprijs_uren,
      btw_tarief: vp.btw_tarief,
    };
    const sc = vp.scenarios || {};
    return {
      totale_kostprijs: kost.totale_kostprijs,
      extra_kosten: extra,
      totale_kostprijs_incl,
      scenarios: {
        B2C:        scenarioResultaat('B2C',        sc.B2C,        ctx),
        B2B:        scenarioResultaat('B2B',        sc.B2B,        ctx),
        SalesAgent: scenarioResultaat('SalesAgent', sc.SalesAgent, ctx),
      },
    };
  }

  // ==========================================================================
  // Hoog-niveau: één offerteregel (de UI die Bart wil) volledig doorrekenen
  // ==========================================================================
  /**
   * Reken een product + verkoopinstellingen in één keer door tegen de
   * materialen-catalogus. Dit is wat de Projecten-tab per offerteregel aanroept.
   */
  function berekenOfferteRegel(product, vp, materialen) {
    const matIndex = materialen instanceof Map ? materialen : indexMaterialen(materialen);
    const kost = kostprijsProduct(product, matIndex);
    const verkoop = vp ? verkoopprijsRij(kost, vp) : null;
    return { product: product.naam || product.id || null, kost, verkoop };
  }

  // ==========================================================================
  // Lege stores (Fase 1 schrijft deze naar SharePoint)
  // ==========================================================================
  function legeStores() {
    return {
      materialen:   { versie: 1, items: [] },   // mt_calc_materialen.json
      producten:    { versie: 1, items: [] },   // mt_calc_producten.json
      verkoopprijzen:{ versie: 1, items: [] },  // mt_calc_verkoop.json
    };
  }

  return {
    EENHEDEN,
    // tab 16
    prijsPerEenheid, verrijktMateriaal, indexMaterialen,
    // tab 17
    kostprijsProduct,
    // tab 18
    verkoopExUitScenario, scenarioResultaat, verkoopprijsRij,
    // high-level
    berekenOfferteRegel, legeStores,
    // util (geëxporteerd voor tests)
    _num: num, _isBlank: isBlank,
  };
});
