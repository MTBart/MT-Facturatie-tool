# Opdracht-inbox

Leg hier een `.md` of `.txt` bestand neer met een opdracht voor de agent.
Binnen 20 minuten pikt de agent het op (scheduled task `MT_Agent_Opdrachten`).

**Voorbeeld** — maak een bestand `vraag.txt` met:

```
Vat het laatste AI-nieuws uit de digest samen in 5 bullets.
```

De agent classificeert de opdracht zelf:
- **Lokaal** (samenvatten, analyseren, adviseren) → meteen uitgevoerd met Ollama,
  resultaat komt in `../verwerkt/`.
- **Claude nodig** (code, git, Moneybird, beslissingen) → in de wachtrij
  `../voor_claude/` en wordt opgepakt in de dagelijkse Claude-review.

Bestanden die met `README` of `_` beginnen worden genegeerd.

> Op afstand een opdracht geven kan ook per e-mail: stuur of versleep een mail
> naar de Outlook-map **MT-Agent**. Zie `Agents/MT_AUTONOMY.md`.
