@echo off
rem This file stays ASCII on purpose. cmd.exe parses a batch file with the
rem codepage that is active at the time it reads each line, so Cyrillic text
rem inside a .cmd gets torn apart the moment chcp changes. All the Russian
rem lives in the PowerShell script instead.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1"
