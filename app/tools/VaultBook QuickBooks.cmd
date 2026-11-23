@echo off
rem VaultBook <-> QuickBooks Desktop. Double-click with QuickBooks open; pick Read / Send / Read-send-read / Check only / Export everything / Reports and ledgers.
rem Dragging a VaultBook file onto this .cmd goes straight to Send with that file.
if not exist "%~dp0VaultBook-QB.ps1" (
  echo VaultBook-QB.ps1 is not next to this file.
  echo If you opened it from inside the downloaded zip, close this window, right-click
  echo VaultBook-QuickBooks-Connector.zip, choose Extract All, and run it from the extracted folder.
  pause
  exit /b 1
)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VaultBook-QB.ps1" -Mode Send -Batch "%~1"
)
pause
