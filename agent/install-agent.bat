@echo off
REM =====================================================================
REM   Run this ONCE to make the Workmedix sync run silently in the
REM   background at every startup (no window, nothing to click).
REM   Make sure you've filled in your keys in run-sync.bat first.
REM =====================================================================
cd /d "%~dp0"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo Installing the Workmedix background sync...
echo.

REM Write a hidden launcher into the Startup folder (runs at every logon)
(
  echo Set sh = CreateObject("WScript.Shell"^)
  echo sh.CurrentDirectory = "%~dp0"
  echo sh.Run "cmd /c ""%~dp0run-sync.bat"" hidden", 0, False
) > "%STARTUP%\WorkmedixSync.vbs"

if not exist "%STARTUP%\WorkmedixSync.vbs" (
  echo  ERROR: couldn't write to the Startup folder.
  echo  Right-click this file and choose "Run as administrator", then try again.
  pause
  exit /b 1
)

REM Start it now (hidden) so you don't have to reboot
wscript "%STARTUP%\WorkmedixSync.vbs"

echo  Done!  The sync now runs silently in the background and starts
echo  automatically every time this laptop is switched on.
echo  No window, nothing to click.
echo.
echo  (To stop it later, double-click uninstall-agent.bat.)
echo.
pause
