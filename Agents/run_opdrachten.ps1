# ============================================================================
#  MT Night Agent - snelle opdracht-cyclus
#  Draait alleen fase 0 (opdrachten ophalen + uitvoeren) + dashboard.
#  Aangestuurd door scheduled task MT_Agent_Opdrachten - elke 20 minuten.
#  Hierdoor worden via dispatch/mail gegeven opdrachten snel opgepakt,
#  zonder elke keer de digest-mail te sturen.
#
#  LET OP: ASCII-only houden. PowerShell 5.1 leest .ps1 zonder BOM als ANSI.
# ============================================================================

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AgentsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AgentsDir
$Log = Join-Path $AgentsDir "agent_log.txt"

("--- opdracht-cyclus " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " ---") |
  Out-File -LiteralPath $Log -Append -Encoding utf8

python (Join-Path $AgentsDir "opdracht_verwerker.py")  *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8
python (Join-Path $AgentsDir "dashboard_generator.py") *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8
