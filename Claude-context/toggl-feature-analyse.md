# Toggl Focus — Feature Analyse voor eigen tool
> Gedocumenteerd: 2026-05-12 via live schermanalyse van focus.toggl.com
> Doel: UX-patronen documenteren die we overnemen in uren-v2.html

---

## 1. Timer / Kalender view (hoofdscherm)

**Wat Toggl doet:**
- Grote prominente starttimer bovenin, altijd zichtbaar
- Lopende timer toont: projectnaam, taak, verstreken tijd (HH:MM:SS), stopknop
- Vandaag-kolom op de kalender: blokken per uur, visueel gestapeld
- "What are you working on?" invoerveld direct in de timer bar

**Wat we implementeren:**
- ✅ Sticky timer bar bovenin in donkergroen — loopt altijd door
- ✅ Recente entries snelstart: "Recent" sectie onder timer toont laatste 5 combinaties (project + taak)
- Elke recente entry heeft een ▶ knop om direct die combinatie te hervatten
- Timer bar bevat: [projectcode gold mono] [taaknaam] [HH:MM:SS] [STOP knop]

**UX-inzichten:**
- Timer mag nooit verdwijnen bij scrollen — is de kern van het product
- Recente entries verlaagt "drempel om bij te houden" enorm
- Projectcode prominenter dan taaknaam in de visuele hiërarchie

---

## 2. Timeline view

**Wat Toggl doet:**
- Horizontale tijdlijn: medewerkers als rijen, dagen als kolommen
- Planning-blokken zijn gekleurde segmenten met label
- Klikken op blok → detail panel (taak, tijdschatting, medewerker)
- Weeknavigatie: ← → knoppen + "vandaag"-snelknop
- Drag-and-drop om blokken te verplaatsen

**Wat we implementeren:**
- Timeline-tab al aanwezig in uren.html — bewaren en verbeteren
- Weekweergave met Bart + Mathijs + Arjan als rijen
- Kleur per project (uit project-definitie)
- Reistijd weergeven als apart (dunner) blok naast werkblok

**UX-inzichten:**
- Medewerker-rijen → snel overzicht wie wanneer bezet is
- Capaciteitsbalk bovenin kolom (groen = vrij, oranje = vol, rood = over)
- "Vandaag" highlight maakt het makkelijk te navigeren

---

## 3. Projects view

**Wat Toggl doet:**
- Lijst van alle projecten met: naam, kleurbol, client-naam, voortgangsbalk
- Voortgangsbalk = geregistreerde uren vs schatting
- Projectcode zichtbaar (hun eigen naamgevingsconventie)
- Filterbalk: actief / gearchiveerd / alle
- Klikken op project → detail view met taken + uren per taak

**Wat we implementeren:**
- ✅ Uren per project zichtbaar in de projectenlijst (geregistreerd / schatting)
- ✅ Voortgangsbalk breed als percentage van schatting
- Projectcode in gold DM Mono — altijd zichtbaar als primaire identifier
- Invoice status badge: geen factuur / concept / verzonden / betaald
- "1 klik naar factuur" knop vanuit project-detail

**UX-inzichten:**
- Kleur per project is essentieel — visuele herkenning bij entries
- Voortgangsbalk motiveert: je ziet hoeveel je nog hebt
- Client-naam als subtitle onder projectnaam

---

## 4. Tasks / Kanban view

**Wat Toggl doet:**
- Kolommen per status: Todo → Backlog → In Progress → Blocked → Done
- Kaarten tonen: taaknaam, projectcode (gekleurd), tags, prioriteit, assignees, tijdschatting
- Drag-and-drop tussen kolommen
- Filters: per medewerker, per tag, per project
- Subtaak-teller op kaart (bijv. "2/5 subtaken gedaan")

**Wat we implementeren:**
- Kanban-tab al aanwezig in uren.html — status-kolommen aansluiten op Toggl-model
- Prioriteit kleurcodering: grijs / blauw / oranje / rood
- Tags als kleine pills op kaart (Offerte, Productie, Montage, etc.)
- Subtaak-voortgang als teller op kaart

**UX-inzichten:**
- Blocked-status is cruciaal: "wacht op klant" / "wacht op materiaal"
- Tags vervangen categorieën — flexibeler dan vaste workflow
- Tijdschatting op kaart + voortgangsbalk geeft snel inzicht in werkdruk

---

## 5. Board / Dashboard view

**Wat Toggl doet:**
- Overzichtsscherm: mijn taken vandaag, recente activiteit, teamcapaciteit
- "My work"-sectie: taken assigned aan mij met status
- Recente uren-registraties als feed
- Capaciteitsgrafiek per medewerker (uren gepland vs max)

**Wat we implementeren:**
- Bord-tab als muurscherm/dashboard (al aanwezig in uren.html)
- Uitbreiden met: teamcapaciteit deze week, projecten met actieve timer
- "Alarm": projecten waarvan schatting overschreden wordt

**UX-inzichten:**
- Dashboard werkt het best voor de muurscherm-use-case (werkplaats-TV)
- Grote tekst, hoog contrast, geen interactie nodig
- Rode items (over budget, over tijd) direct zichtbaar

---

## 6. Reports view

**Wat Toggl doet:**
- Uren per project per periode (grafiek + tabel)
- ✅ Daggrafiek: staafjes per dag in geselecteerde periode (geïmplementeerd!)
- Filter: per persoon, per client, per project, per tag
- Exporteren als CSV / PDF
- Vergelijking: geschat vs werkelijk per project

**Wat we implementeren:**
- ✅ Daggrafiek al toegevoegd aan Rapport-tab
- Uitbreiden met: vergelijking geschat vs werkelijk
- Billable vs non-billable opsplitsing
- Export naar Moneybird als factuurregels (weekafsluiting skill)

**UX-inzichten:**
- Daggrafiek geeft in één oogopslag of je actief bent geweest die week
- Kleurcodering per project in stapelbalk → snel zien hoe tijd verdeeld is
- "This period vs last period" vergelijking is nuttig voor groeiinzicht

---

## 7. Wat Toggl BETER doet dan wij nu

| Feature | Toggl | Wij nu | Prioriteit nabouwen |
|---------|-------|--------|---------------------|
| Sticky timer altijd zichtbaar | ✅ | ❌ scrollt weg | ⭐⭐⭐ Hoog |
| Recente entries snelstart | ✅ | ❌ niet aanwezig | ⭐⭐⭐ Hoog (geïmpl.) |
| Uren zichtbaar in projectlijst | ✅ | ❌ | ⭐⭐⭐ Hoog (geïmpl.) |
| Daggrafiek in rapport | ✅ | ❌ | ⭐⭐⭐ Hoog (geïmpl.) |
| Invoice status per project | ❌ Toggl heeft dit niet | ❌ | ⭐⭐⭐ Uniek voor ons |
| Kleurcodering projecten | ✅ | ✅ gedeeltelijk | ⭐⭐ Medium |
| Drag-and-drop kanban | ✅ | ❌ | ⭐⭐ Medium |
| Subtaak-voortgang op kaart | ✅ | ❌ | ⭐ Laag |
| Muurscherm/dashboard | ❌ | ✅ (Bord-tab) | n.v.t. — ons voordeel |

---

## 8. Geïmplementeerde verbeteringen (2026-05-12)

### Verbetering 1: Daggrafiek in Rapport
- Staafdiagram bovenin de Rapport-tab
- Goud = vandaag, groen = normale dag, rood = >10 uur
- Totaaluren rechtsboven in de grafiek
- Code: toegevoegd aan `renderRapport()` vóór de projectenlijst

### Verbetering 2: Uren in projectenlijst
- Rechts van elk project: geregistreerde uren + voortgangsbalk
- Breed van balk = percentage van schatting (rood als >100%)
- Code: toegevoegd aan `renderProjectenTab()`

### Verbetering 3: Recente entries snelstart
- Sectie "Recent" direct onder de lopende timer
- Toont laatste 5 unieke project+taak combinaties van ingelogde gebruiker
- Tijdstempel: "Xm geleden" / "Xu geleden"
- ▶ knop start die combinatie direct
- Code: nieuwe functies `renderRecentEntries()` en `recentStart()`

---

## 9. Full rebuild plan — uren-v2.html

### Scope
Nieuwe file `uren-v2.html` — combineert:
- Tijdregistratie (huidige uren.html)
- Projectbeheer (Toggl-niveau)
- Facturatie integratie (huidige index-v4.html → Moneybird)

### Navigatiestructuur (sidebar)
```
⏱ Timer       ← vandaag + lopende timer
📅 Dag         ← kalender dagview
📆 Planning    ← weekoverzicht / timeline
📊 Uren        ← entries lijst + rapport
📁 Projecten   ← projectlijst + detail + factuurstatus
🧾 Facturen    ← Moneybird-integratie
📋 Bord        ← muurscherm dashboard
```

### Sticky timer bar
- Altijd bovenin, ook bij scrollen
- Donkergroen achtergrond (#2A4A38)
- Projectcode in gold DM Mono
- HH:MM:SS teller
- STOP knop rechts

### Design richting
- Claude Design prototype: `https://claude.ai/design/p/019e1e21-0096-771a-9625-9d43a1981592`
- Workshop aesthetic, warm paper background
- M&T kleuren: groen #2A4A38, goud #B8962E, off-white #F7F5F0
- Fonts: Fraunces (titels), Figtree (body), DM Mono (codes/cijfers)

### Technisch
- Single-file HTML (geen bundler, geen node_modules)
- localStorage voor offline-first
- Cloudflare Worker als API-proxy (Toggl + Moneybird)
- CORS uitgebreid voor nieuwe URL

### Fasering
1. **Fase 1:** Shell + Timer + Dag (huidige uren.html functionaliteit)
2. **Fase 2:** Projecten + invoice status badges
3. **Fase 3:** Facturen tab (Moneybird integratie)
4. **Fase 4:** Cloud sync (vervangt localStorage risico)
