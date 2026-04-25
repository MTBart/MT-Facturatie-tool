# Migratie Analyse: Huidige → Nieuwe Mappenstructuur

**Datum:** 25 april 2026  
**Status:** Voorbereiding (niet-automatiseerbaar)

---

## Huidige Structuur

### Locaties
- `C:\....\Algemeen\1_Projecten NAS` — 88 projecten
- `C:\....\Algemeen\2_Compananny NAS` — 41 projecten
- **Totaal:** 129 projecten

### Naamvoering (INCONSISTENT)
Huidige naamgeving volgt geen patroon:
- **Persoonsnamen:** Alie de Pruyssenaere, David Vietor, Jans Landsmeer
- **Bedrijfsnamen:** Bos architecten, Herman Wesselink College, HR Timmerwerken
- **Adressen:** Fam zwart - Gruttostraat 23, Jolanda Germann - Druivenlaam 58
- **Willekeurig:** Beachclub, Burningman WTSS, Here we are
- **Archief/Util:** Afgerond, Apparatuur, CNC Test projecten, Calibreer kast

### Bestandstypes
Veel verschillende bestandstypen per project:
- 3D-bestanden: .max, .3ds, .fbx, .dwg (CAD)
- PDF's (tekeningen, offertes)
- Vectorworks-exports (CSV, etc.)
- Foto's
- Admin-documenten
- Willekeurige backup-structuren

---

## Nieuwe Structuur (DOEL)

```
Nieuwe mappenstructuur\
    [Volledige KvK naam] - [Klant-ID]\
        [Klantcode-Vestiging-Projectnaam]\
            01_Offerte\
            02_Ontwerp\
            03_Vectorworks\
            04_Holzher\
            05_Aangeleverd\
            06_Fotos\
            07_Administratie\
            08_Archief\
            09_Werktekeningen\  ← NIEUW
```

---

## Waarom NIET Automatisch

### 1. Naamvoering gekoppeld aan Moneybird
Huidige namen zijn **niet gekoppeld** aan Moneybird klant-ID.
- "Alie de Pruyssenaere" → Welke klant in Moneybird? (Nog niet aangemaakt?)
- "David Vietor" → MB ID 1273 (David Viëtor)
- Sommige zijn persoonsnamen, geen klanten

**Oplossing:** Handmatig bepalen per project

### 2. Archief-mappen vs Actieve Projecten
- Folder "Afgerond" bevat 20+ gearchiveerde projecten
- Moeten die allemaal gemigreerd worden? Of apart archiveren?

**Oplossing:** Bart bepaalt scope

### 3. Projectnaam onbekend
Huidige mapnaam is niet altijd de echte projectnaam:
- `Bettina - Studio Vacay` → Is dit klant-naam of project-naam?
- `Herman Wesselink College` → Klant of projectlocatie?

**Oplossing:** Bart vult in

### 4. Subfolders Inconsistent
Veel projecten hebben willekeurige subfolder-structuur:
- Sommige: `Project\3D-CAD\...`
- Anderen: `Project\Tekeningen\...`
- Weer anderen: `Project\[Sub-projectnamen]\...`

**Oplossing:** Alles als-is kopieren onder 08_Archief (of verdelen per type)

---

## Aanbevolen Migratie-Process

### Stap 1: Lijst Genereren
Script maakt lijst van alle projecten met:
- Oude mapnaam
- Aantal submappen
- Aantal bestanden
- Suggestie voor Moneybird-mapping

### Stap 2: Interactieve Tool (widget of form)
Per project: Bart voert in:
- [ ] Welke Moneybird klant? (dropdown uit Moneybird API)
- [ ] Echte projectnaam? (vrij tekstveld)
- [ ] Migreren? (ja/nee/skip)

### Stap 3: Batch-kopie
Voor bevestigde projecten:
1. Kopieert alle bestanden
2. Plaatst in juiste mapstructuur
3. Genereert PROJECT_INFO.txt
4. Optioneel: README per project type

### Stap 4: Validatie
User controleert:
- Naamgeving klopt
- Geen bestanden verloren
- Folder-structuur juist

---

## Extra: 09_Werktekeningen Folder

**Toevoeging:** Alle projecten krijgen nieuwe folder `09_Werktekeningen`

Update script `create-project-structure.ps1`:
```powershell
$Subfolders = @(
    "01_Offerte", "02_Ontwerp", "03_Vectorworks", "04_Holzher",
    "05_Aangeleverd", "06_Fotos", "07_Administratie", "08_Archief",
    "09_Werktekeningen"  # ← NIEUW
)
```

---

## Voorbereidingen Compleet ✓

- [x] Huidige structuur geanalyseerd
- [x] 129 projecten geteld
- [x] Naamvoering inconsistentie vastgesteld
- [x] Reden voor handmatig proces bepaald
- [x] 09_Werktekeningen-folder onderkend
- [ ] Interactive UI/form ontwerpen (avond)
- [ ] Batch-kopie-script schrijven (avond)

---

## Vanavond: Tokens Nodig Voor

1. **Migration tool widget** — Form in index-v4.html of apart script
2. **Batch-kopie-script** — PowerShell/Node voor kopieën + mapnaamgeving
3. **Validatie-rapport** — Toon wat er gemigreerd is

Volgende sessie: Bepalen wat Bart wil, dan implementeren.
