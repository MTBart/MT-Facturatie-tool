# ============================================================================
#  MT Night Agent — orchestrator
#  Draait de volledige keten: opdrachten -> research -> analyse -> digest ->
#  zelf-verbeteren -> dashboard. Aangestuurd door de scheduled task MT_Agent.
#
#  Handmatig draaien:  powershell -ExecutionPolicy Bypass -File run_agent.ps1
# ============================================================================

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$AgentsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $AgentsDir
$Log = Join-Path $AgentsDir "agent_log.txt"
$Agent = Join-Path $AgentsDir "nachtelijke_agent.py"

$start = Get-Date
"" | Out-File -LiteralPath $Log -Append -Encoding utf8
"============================================================" | Out-File -LiteralPath $Log -Append -Encoding utf8
"  MT Night Agent run — $($start.ToString('yyyy-MM-dd HH:mm:ss'))" | Out-File -LiteralPath $Log -Append -Encoding utf8
"============================================================" | Out-File -LiteralPath $Log -Append -Encoding utf8

# Stappen: naam + commando. fase0 en fase6 zijn aparte scripts.
$stappen = @(
  @{ naam = "fase0-opdrachten"; arg = (Join-Path $AgentsDir "opdracht_verwerker.py") },
  @{ naam = "fase1-research";   arg = "$Agent fase1" },
  @{ naam = "fase2-github";     arg = "$Agent fase2" },
  @{ naam = "fase3-analyse";    arg = "$Agent fase3" },
  @{ naam = "fase4-digest";     arg = "$Agent fase4" },
  @{ naam = "fase5-verbeteren"; arg = "$Agent fase5" },
  @{ naam = "fase6-dashboard";  arg = (Join-Path $AgentsDir "dashboard_generator.py") }
)

$mislukt = @()
foreach ($s in $stappen) {
  "--- $($s.naam) ---" | Out-File -LiteralPath $Log -Append -Encoding utf8
  $argList = $s.arg -split ' ', 2
  if ($argList.Count -eq 1) {
    python $argList[0] *>&1 | Out-File -LiteralPath $Log -Append -Encoding utf8
  } else {
    python $argList[0] $argList[1] *>&1 | Out-File -LiteralPath $Log -Append -Encoding utf8
  }
  if ($LASTEXITCODE -ne 0) { $mislukt += $s.naam }
}

$eind = Get-Date
$duur = [int]($eind - $start).TotalSeconds
$status = if ($mislukt.Count -eq 0) { "klaar" } else { "deels-mislukt" }
$samenvatting = if ($mislukt.Count -eq 0) {
  "Alle 7 fases OK ($duur s)"
} else {
  "Mislukt: $($mislukt -join ', ') ($duur s)"
}
"=== Run $status — $samenvatting ===" | Out-File -LiteralPath $Log -Append -Encoding utf8

# Run-historie bijwerken (voedt het dashboard)
$histPad = Join-Path $AgentsDir "run_historie.json"
$hist = @()
if (Test-Path -LiteralPath $histPad) {
  try { $hist = @(Get-Content -LiteralPath $histPad -Raw | ConvertFrom-Json) } catch { $hist = @() }
}
$hist += [pscustomobject]@{
  tijd         = $start.ToString('yyyy-MM-dd HH:mm')
  status       = $status
  samenvatting = $samenvatting
}
if ($hist.Count -gt 60) { $hist = $hist[-60..-1] }
,$hist | ConvertTo-Json -Depth 4 | Out-File -LiteralPath $histPad -Encoding utf8

# Dashboard nogmaals draaien zodat deze run erin staat
python (Join-Path $AgentsDir "dashboard_generator.py") *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8
