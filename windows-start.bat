@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo TaxAce Amendment Management - Windows Local Test Launcher
echo ============================================================
echo.

where powershell >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell is required but was not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-local-start.ps1"
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo The local launcher stopped with exit code %EXIT_CODE%.
  echo Review the message above, correct the issue, and run windows-start.bat again.
  pause
)

exit /b %EXIT_CODE%
