@echo off
:: Mortise & Tenon — Cowork → Claude Code launcher
:: Pakt de taak uit HANDOFF.md en start Claude Code ermee

set CLAUDE_DIR=%~dp0
set HANDOFF=%CLAUDE_DIR%HANDOFF.md

echo.
echo === Mortise ^& Tenon: Cowork → Claude Code ===
echo.

:: Check of claude beschikbaar is
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo [FOUT] Claude Code niet gevonden in PATH.
    echo Zorg dat Claude Code geinstalleerd is: https://claude.ai/download
    pause
    exit /b 1
)

:: Lees de taak uit HANDOFF.md
echo Taak ophalen uit HANDOFF.md...
echo.

:: Start Claude Code in de Claude-map met HANDOFF als context
cd /d "%CLAUDE_DIR%"
claude --allowedTools "Bash,Read,Write,Edit,Glob,Grep" -p "Lees HANDOFF.md in de huidige map. Voer de taak uit die staat onder [TAAK]. Schrijf het resultaat terug onder [RESULTAAT] in HANDOFF.md. Zet de Status-regel op 'klaar-voor-cowork'. Voeg een regel toe aan de Log-tabel met datum, Van=ClaudeCode, Naar=Cowork, en een korte taakomschrijving."

echo.
echo === Klaar — resultaat staat in HANDOFF.md ===
echo Ga terug naar Cowork en typ: lees HANDOFF.md en verwerk het resultaat
echo.
pause
