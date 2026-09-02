@echo off
rem ASCII only. cmd.exe parses a batch file with the codepage active as it
rem reads each line, so Cyrillic here gets torn apart when chcp changes.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"
