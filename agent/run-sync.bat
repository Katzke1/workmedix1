@echo off
REM =====================================================================
REM   Workmedix  <->  OccuPlus  sync
REM   Fill in the 4 values below (between the quotes/after the =),
REM   save the file, then double-click it.
REM =====================================================================

REM 1) OccuPlus runs on THIS laptop, so leave this as-is:
set OCCUPLUS_URL=http://localhost:5100

REM 2) Your OccuPlus API key  (OccuPlus NEO -> Settings -> API Integration):
set OCCUPLUS_KEY=occu-PASTE-YOUR-KEY-HERE

REM 3) Your live website:
set WORKMEDIX_URL=https://www.workmedix.com

REM 4) The shared secret  (must MATCH the SYNC_API_KEY you set on Railway):
set SYNC_KEY=PASTE-THE-SAME-SECRET-HERE

REM ---- Optional: keep syncing every 10 minutes while this window is open.
REM ----           Delete the word REM at the start of the next line to enable.
REM set SYNC_INTERVAL_MINUTES=10

cd /d "%~dp0"
node occuplus-sync.js
echo.
echo ----- Finished. You can close this window. -----
pause
