@echo off
REM M&T Migration Server Starter
REM Dubbelklikken om server te starten

echo.
echo ========================================
echo  M&T Migration Server
echo ========================================
echo.

REM Ga naar deze directory
cd /d "%~dp0"

REM Check of node_modules bestaat
if not exist "node_modules" (
    echo [1/3] Dependencies installeren...
    call npm install
    echo.
) else (
    echo [1/3] Dependencies al geinstalleerd
    echo.
)

echo [2/3] Server starten op http://localhost:3456...
echo.

REM Start server
node migration-server.js

REM Als server stopt, vraag om enter voordat venster sluit
pause
