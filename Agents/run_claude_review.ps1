# ============================================================================
#  MT Claude-review — strategische laag
#  Start een headless Claude Code-sessie die de dagelijkse review uitvoert
#  volgens Agents/claude_review.md. Aangestuurd door scheduled task
#  MT_Claude_Review (dagelijks, na de nachtrun).
# ============================================================================

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ClaudeDir = "C:\Users\BartWitte\Mortise & Tenon\Mortise & Tenon - On-Prem-Data\Applicaties\Claude"
Set-Location -LiteralPath $ClaudeDir
$Log = Join-Path $ClaudeDir "Agents\claude_review_log.txt"

"=== Claude-review $(Get-Date -Format 'yyyy-MM-dd HH:mm') ===" |
  Out-File -LiteralPath $Log -Append -Encoding utf8

$prompt = "Lees Agents/claude_review.md volledig en voer de dagelijkse review " +
          "exact uit zoals daar beschreven. Houd je strikt aan de harde grenzen."

# Headless run. bypassPermissions staat al als default in settings.local.json;
# de vlag staat er voor de zekerheid expliciet bij zodat de run nooit blijft hangen.
claude -p $prompt --permission-mode bypassPermissions --model sonnet *>&1 |
  Out-File -LiteralPath $Log -Append -Encoding utf8

"=== review klaar — exit $LASTEXITCODE ===" |
  Out-File -LiteralPath $Log -Append -Encoding utf8
