# Voorstellen — zelf-verbeteringen van de agent

Hier komen **voorstellen** voor verbeteringen: nieuwe bronnen, prompt-aanpassingen,
config-wijzigingen of code-ideeën. De agent (of jij) zet hier een `.md`-bestand neer;
de dagelijkse Claude-review beoordeelt het.

Elk voorstel-bestand begint met:

```
# Korte titel
status: open
```

De Claude-review zet de status daarna op:
- `toegepast`  — doorgevoerd (omkeerbaar via git)
- `afgewezen`  — niet gedaan, met reden
- `voor-bart`  — te groot of te risicovol, Bart beslist

**Waarom een tussenstap?** Een lokaal model mag zichzelf niet ongecontroleerd
herschrijven — dat is het risico van een onbewaakt nachtproces. Voorstellen +
review + git houdt het zelf-verbeteren veilig en altijd terug te draaien.
