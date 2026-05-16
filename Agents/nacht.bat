@echo off
setlocal

:: Night Agent — Mortise & Tenon
:: Draait alle 5 fases op volgorde.
:: Zet een scheduled task in via setup_task.ps1 (tijd: 23:00)

:: UTF-8 mode aan -- voorkomt 'charmap' codec-fouten met emoji/accenten
set PYTHONUTF8=1

set SCRIPT_DIR=%~dp0
set AGENT=%SCRIPT_DIR%nachtelijke_agent.py

echo ============================================
echo  Night Agent gestart: %date% %time%
echo ============================================
echo.

echo [1/5] RSS ophalen en scoren...
python "%AGENT%" fase1
if errorlevel 1 (
    echo FOUT in fase 1 - agent stopt.
    exit /b 1
)

echo.
echo [2/5] GitHub scanner...
python "%AGENT%" fase2
if errorlevel 1 (
    echo FOUT in fase 2 - doorgaan met fase 3...
)

echo.
echo [3/5] Eigen data analyse...
python "%AGENT%" fase3
if errorlevel 1 (
    echo FOUT in fase 3 - doorgaan met fase 4...
)

echo.
echo [4/5] Digest samenstellen...
python "%AGENT%" fase4
if errorlevel 1 (
    echo FOUT in fase 4.
)

echo.
echo [5/5] Zelf verbeteren...
python "%AGENT%" fase5
if errorlevel 1 (
    echo FOUT in fase 5.
)

echo.
echo ============================================
echo  Night Agent klaar: %date% %time%
echo  Digest: %SCRIPT_DIR%digest_%date:~6,4%-%date:~3,2%-%date:~0,2%.md
echo ============================================

endlocal
