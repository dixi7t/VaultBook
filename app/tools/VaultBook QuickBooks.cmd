@echo off
rem VaultBook <-> QuickBooks Desktop. Double-click with QuickBooks open; pick Read / Send / Read-send-read / Check only / Export everything / Reports and ledgers.
rem Dragging a VaultBook file onto this .cmd goes straight to Send with that file.
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1" -Mode Send -Batch "%~1"
)
pause
