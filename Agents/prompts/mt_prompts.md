# M&T prompt-bibliotheek

Prototype uit het nabouw-voorstel "5 Claude Prompt Categories That Replace Hours
of Work". Doel: terugkerend M&T-werk vangen in herbruikbare prompt-templates, zodat
je (of een agent) niet elke keer het wiel uitvindt.

Gebruik: kopieer een template, vul de `[...]`-velden in, plak in Claude.

---

## 1. Generator — offerteregel-tekst

> Schrijf een offerteregel voor Mortise & Tenon (maatwerkmeubels).
> Product: [omschrijving]. Materiaal: [plaat/houtsoort]. Afmetingen: [maten].
> Toon: zakelijk + vriendelijk, professioneel maar toegankelijk. Eén alinea,
> geen prijs. Noem afwerking en wat de klant kan verwachten.

## 2. Generator — concept klantmail

> Schrijf een concept-mail van Mortise & Tenon aan [klant].
> Aanleiding: [bv. offerte versturen / planning bevestigen / vraag beantwoorden].
> Kernpunten: [bullets]. Toon: zakelijk + vriendelijk, je/jij, kort.
> Eindig met een concrete vervolgstap. Lever alleen de mailtekst.

## 3. Audit — materiaallijst-check

> Controleer deze materiaallijst voor een M&T-project op volledigheid.
> Lijst: [plak lijst]. Projecttype: [kast/tafel/etc].
> Check: ontbreken kantenband, lijm, beslag, lak of schroeven? Kloppen de
> plaataantallen bij de afmetingen? Geef alleen de ontbrekende/twijfelpunten
> als bulletlijst — niets wat al klopt.

## 4. Transformer — Vectorworks naar zaagcode

> Zet deze projectnaam om naar een M&T-zaagcode: [projectnaam].
> Regels: max 20 tekens, hoofdletters, klantcode-prefix indien bekend, geen
> spaties (gebruik -). Geef alleen de code terug.

## 5. Samenvatter — projectstatus voor Bart

> Vat de status van [project] samen in 4 regels: (1) wat is af, (2) wat loopt,
> (3) wat blokkeert, (4) eerstvolgende actie. Nederlands, je/jij, geen jargon.

---

## Uitbreiden

Nieuwe template = nieuw kopje met categorie (Generator / Audit / Transformer /
Samenvatter / Systeem). Houd de instructie kort en de output-vorm expliciet —
dat maakt 'm herbruikbaar en token-zuinig.
