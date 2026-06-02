@echo off
REM Workmedix <-> OccuPlus sync agent launcher (Windows)
REM Double-click to run once, or point Windows Task Scheduler at this file.
cd /d "%~dp0"
node occuplus-sync.js
