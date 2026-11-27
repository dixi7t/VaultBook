@echo off
rem VaultBook <-> QuickBooks Desktop. Double-click with QuickBooks open; the menu: Connect to VaultBook, QuickBooks to VaultBook, VaultBook to QuickBooks, Preview, What QuickBooks has, Reports.
rem Dragging a VaultBook file onto this .cmd goes straight to Send with that file.
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1" -Mode Send -Batch "%~1"
)
pause
