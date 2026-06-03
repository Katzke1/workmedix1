@echo off
REM Removes the Workmedix background sync from startup.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
del "%STARTUP%\WorkmedixSync.vbs" 2>nul
echo  The Workmedix background sync has been removed from startup.
echo  Restart the laptop to fully stop any sync that's still running.
echo.
pause
