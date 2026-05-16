@echo off
set AGENTS=%~dp0
set OUTPUT=%AGENTS%task_check_output.txt

echo === SCHEDULED TASK CHECK === > "%OUTPUT%"
echo Datum: %date% %time% >> "%OUTPUT%"
echo. >> "%OUTPUT%"

echo --- Zoeken naar task MortiseTenon_NachtAgent --- >> "%OUTPUT%"
schtasks /query /tn "MortiseTenon_NachtAgent" /fo LIST /v >> "%OUTPUT%" 2>&1

echo. >> "%OUTPUT%"
echo --- Alle custom taken in root --- >> "%OUTPUT%"
schtasks /query /fo LIST /v | findstr /i "TaskName\|Status\|Last Run\|Last Result\|Next Run\|Volgende\|Laatste\|Taakn" >> "%OUTPUT%" 2>&1

echo. >> "%OUTPUT%"
echo --- Python check --- >> "%OUTPUT%"
python --version >> "%OUTPUT%" 2>&1
where python >> "%OUTPUT%" 2>&1

echo. >> "%OUTPUT%"
echo --- Agents map inhoud --- >> "%OUTPUT%"
dir "%AGENTS%" >> "%OUTPUT%" 2>&1

echo. >> "%OUTPUT%"
echo === KLAAR === >> "%OUTPUT%"

echo Output geschreven naar: %OUTPUT%
echo Je kunt dit venster sluiten.
pause
