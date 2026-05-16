# ============================================================================
#  MT Night Agent - orchestrator
#  Draait de volledige keten: opdrachten -> research -> analyse -> digest ->
#  zelf-verbeteren -> dashboard. Aangestuurd door scheduled task MT_Agent_Nacht.
#
#  Handmatig draaien:  powershell -ExecutionPolicy Bypass -File run_agent.ps1
#
#  LET OP: dit bestand bewust ASCII-only houden. PowerShell 5.1 leest .ps1
#  zonder BOM als ANSI; non-ASCII tekens (em-dash e.d.) breken de parser.
# ============================================================================

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AgentsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AgentsDir
$Log   = Join-Path $AgentsDir "agent_log.txt"
$Agent = Join-Path $AgentsDir "nachtelijke_agent.py"

$start = Get-Date
"" | Out-File -LiteralPath $Log -Append -Encoding utf8
"============================================================" | Out-File -LiteralPath $Log -Append -Encoding utf8
("MT Night Agent run - " + $start.ToString('yyyy-MM-dd HH:mm:ss')) | Out-File -LiteralPath $Log -Append -Encoding utf8
"============================================================" | Out-File -LiteralPath $Log -Append -Encoding utf8

# Elke stap: script-pad (mag spaties bevatten) + optionele fase-argument.
# BELANGRIJK: script en fase apart houden - nooit samenvoegen en splitsen,
# want de paden bevatten spaties en een '&'.
$stappen = @(
  @{ naam = "fase0-opdrachten";  script = (Join-Path $AgentsDir "opdracht_verwerker.py");  fase = $null },
  @{ naam = "fase1-research";    script = $Agent; fase = "fase1" },
  @{ naam = "fase1b-broninhoud"; script = (Join-Path $AgentsDir "bron_analyse.py"); fase = $null },
  @{ naam = "fase2-github";      script = $Agent; fase = "fase2" },
  @{ naam = "fase3-analyse";     script = $Agent; fase = "fase3" },
  @{ naam = "fase4-digest";      script = $Agent; fase = "fase4" },
  @{ naam = "fase5-verbeteren";  script = $Agent; fase = "fase5" },
  @{ naam = "fase6-dashboard";   script = (Join-Path $AgentsDir "dashboard_generator.py"); fase = $null }
)

$mislukt = @()
foreach ($s in $stappen) {
  ("--- " + $s.naam + " ---") | Out-File -LiteralPath $Log -Append -Encoding utf8
  if ($null -eq $s.fase) {
    python $s.script *>&1 | Out-File -LiteralPath $Log -Append -Encoding utf8
  } else {
    python $s.script $s.fase *>&1 | Out-File -LiteralPath $Log -Append -Encoding utf8
  }
  if ($LASTEXITCODE -ne 0) { $mislukt += $s.naam }
}

$duur = [int]((Get-Date) - $start).TotalSeconds
if ($mislukt.Count -eq 0) {
  $status = "klaar"
  $samenvatting = "Alle $($stappen.Count) fases OK in $duur sec"
} else {
  $status = "deels-mislukt"
  $samenvatting = "Mislukt: " + ($mislukt -join ', ') + " (in $duur sec)"
}
("=== Run " + $status + " - " + $samenvatting + " ===") | Out-File -LiteralPath $Log -Append -Encoding utf8

# Run-historie bijwerken via Python (betrouwbare JSON, geen BOM).
python (Join-Path $AgentsDir "run_log.py") $start.ToString('yyyy-MM-dd HH:mm') $status $samenvatting *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8

# Dashboard nogmaals draaien zodat deze run in run_historie zichtbaar is.
python (Join-Path $AgentsDir "dashboard_generator.py") *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8
