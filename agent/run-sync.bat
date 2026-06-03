@echo off
REM =====================================================================
REM   Workmedix  <->  OccuPlus  sync
REM   1) Fill in the two keys below.
REM   2) Double-click install-agent.bat ONCE to run it silently in the
REM      background at every startup (no window, nothing to click).
REM   (Double-clicking THIS file just runs a visible test.)
REM =====================================================================

REM OccuPlus runs on THIS laptop, so leave this as-is:
set OCCUPLUS_URL=http://localhost:5100

REM Your OccuPlus API key  (OccuPlus NEO -> Settings -> API Integration):
set OCCUPLUS_KEY=occu-PASTE-YOUR-KEY-HERE

REM Your live website:
set WORKMEDIX_URL=https://www.workmedix.com

REM The shared secret  (must MATCH the SYNC_API_KEY you set on Railway):
set SYNC_KEY=PASTE-THE-SAME-SECRET-HERE

REM Re-sync automatically every 3 minutes:
set SYNC_INTERVAL_MINUTES=3

cd /d "%~dp0"
node occuplus-sync.js
REM Only pause for a visible test run (not when launched hidden by the installer):
if /I not "%~1"=="hidden" pause
