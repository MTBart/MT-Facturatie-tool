# Bekende problemen & open punten

> Lopende bugs, tijdelijke workarounds, bewust uitgestelde zaken.
> Bijwerken zodra iets opgelost is of nieuw ontdekt.

---

## Open punten

- [ ] **SharePoint Graph API token ontbreekt** — nodig voor uren-sync tussen apparaten (mt_uren_entries + mt_uren_planning). Workaround: per apparaat apart invullen. Wacht op Bart om token te genereren via Azure portal.
- [ ] **`openTimerProjectPicker()` gebruikt `prompt()`** — werkt maar ziet er ruw uit. Moet worden vervangen door een echte modal. Geplande fix: stap 3 (Taak-modal).
- [ ] **Preview server port 3456 conflict** — lokale dev server had port-conflict. Opgelost met `autoPort:true` in `.claude/launch.json`, geen hardcoded poort meer.
- [ ] **`renderKalender()` nog niet geschreven** — Timer-tab heeft de kalender-HTML klaarstaan maar de render-functie ontbreekt nog. Volgende stap in stap 2.

---

## Bewust uitgesteld

| Feature | Reden | Wanneer |
|---|---|---|
| PWA manifest (installeerbaar) | Niet urgent, werkt al als webapp | Stap 12 |
| Drag-to-create op timeline | Complexe implementatie | Stap 6 |
| Outlook agenda sync | API-integratie, later | Na stap 12 |
| Mobiele optimalisatie | Desktop eerst af | Stap 10 |
| Vectorworks CSV → taken koppeling | Vereist beide apps klaar | Stap 11 |

---

## Opgelost

- [x] **Takendatamodel migratie** — oude `{projectCode: [...]}` → nieuwe platte array, `migreerTaken()` aangemaakt
- [x] **Toggl-code** — volledig verwijderd, `mt_toggl_*` keys worden leeggemaakt bij load
- [x] **Port conflict preview server** — opgelost via `autoPort:true`
