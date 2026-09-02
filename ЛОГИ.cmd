@echo off
rem ASCII only - see ЗАПУСК.cmd for why.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\logs.ps1"
