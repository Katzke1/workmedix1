# Workmedix ↔ OccuPlus Sync Agent

A small helper app that runs on the clinic network and keeps Workmedix and
OccuPlus in sync. It only makes **outbound** connections, so nothing on the
clinic PC is exposed to the internet.

Each run it:

1. Pulls the employee roster from Workmedix.
2. Makes sure each person exists as a **patient** in OccuPlus.
3. Pulls each person's latest **audio** and **spiro** result.
4. Downloads the report PDF and uploads it to Workmedix, where it appears on
   that employee's record under *My Results*.

Re-running is safe — Workmedix ignores results it has already imported.

---

## One-time setup

### 1. Install Node.js (if not already)
Download the LTS version from <https://nodejs.org> and install it. To check:
```
node --version
```
It must be **18 or higher**.

### 2. Set the secret on Railway
In your Railway project → **Variables**, add:

```
SYNC_API_KEY = (a long random secret you choose)
```

### 3. Configure the agent
In this `agent` folder, copy `.env.example` to `.env` and fill it in:

```
OCCUPLUS_URL  = http://192.168.1.38:5100      (or http://localhost:5100 if on the OccuPlus PC)
OCCUPLUS_KEY  = occu-...                        (OccuPlus NEO → Settings → API Integration)
WORKMEDIX_URL = https://www.workmedix.com
SYNC_KEY      = (the SAME secret you set on Railway)
```

### 4. Test it
Double-click **`run-sync.bat`** (or run `node occuplus-sync.js`). You should see
a log ending with `Sync done — imported X, skipped Y …`.

---

## Run it automatically (every 10 minutes)

**Option A — Windows Task Scheduler (recommended):**
1. Open **Task Scheduler** → **Create Basic Task**.
2. Name: `Workmedix OccuPlus Sync`. Trigger: **Daily**, then on the next screen
   set it to repeat **every 10 minutes** for a duration of **1 day** (indefinitely).
3. Action: **Start a program** → browse to `run-sync.bat` in this folder.
4. Finish. It now syncs in the background while the PC is on.

**Option B — keep it running in a window:**
Set `SYNC_INTERVAL_MINUTES=10` in `.env`, then run `node occuplus-sync.js`.
It will sync immediately and then every 10 minutes until you close it.

---

## Requirements for a run to succeed
- OccuPlus NEO is running and its API shows **🟢 Running on port 5100**.
- The OccuPlus database is in **multi-user mode**.
- This PC can reach both the OccuPlus PC and the internet.
