@echo off
rem ASCII only. cmd.exe re-reads a batch file with whatever codepage is
rem active as it reaches each line, so Cyrillic inside one gets shredded.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\register.ps1"
echo.
echo [exit code %ERRORLEVEL%]
pause
