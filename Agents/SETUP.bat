@echo off
:: ============================================================
:: SETUP.bat — Mortise & Tenon Night Agent
:: Dubbelklik dit bestand om de scheduled task aan te maken.
:: ============================================================

set "AGENTS=%~dp0"
set "TASKNAME=MT_NightAgent"
set "LOGFILE=%AGENTS%setup_log.txt"
set "NACHT=%AGENTS%nacht.bat"
set "AGENTLOG=%AGENTS%agent_log.txt"

echo SETUP gestart: %date% %time% > "%LOGFILE%"

:: Verwijder oude tasks
schtasks /delete /tn "%TASKNAME%" /f >> "%LOGFILE%" 2>&1
schtasks /delete /tn "MortiseTenon_NachtAgent" /f >> "%LOGFILE%" 2>&1

:: Maak nieuwe task aan via PowerShell (omzeilt & probleem in schtasks)
powershell -Command "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c \"\"' + '%NACHT%' + '\"\" >> \"' + '%AGENTLOG%' + '\" 2>&1'); $trigger = New-ScheduledTaskTrigger -Daily -At '23:00'; Register-ScheduledTask -TaskName '%TASKNAME%' -Action $action -Trigger $trigger -Force" >> "%LOGFILE%" 2>&1

if errorlevel 1 (
    echo FOUT bij aanmaken task! >> "%LOGFILE%"
    echo.
    echo ============================================
    echo  FOUT: Kijk in setup_log.txt voor details.
    echo ============================================
) else (
    echo Task aangemaakt. >> "%LOGFILE%"
    echo.
    echo ============================================
    echo  Night Agent ingepland: %TASKNAME%
    echo  Draait elke nacht om 23:00
    echo ============================================
)

echo. >> "%LOGFILE%"
schtasks /query /tn "%TASKNAME%" /fo LIST /v >> "%LOGFILE%" 2>&1

echo.
echo Log: %LOGFILE%
echo Je kunt dit venster sluiten.
pause
