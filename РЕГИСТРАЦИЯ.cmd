@echo off
rem This file stays ASCII on purpose. All the Russian lives in the
rem PowerShell script, which cmd.exe never has to parse.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scriptsegister.ps1"
