'use strict';

const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'db', 'workmedix.db');
const DEST = path.join(__dirname, '..', 'db', 'backups');

fs.mkdirSync(DEST, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dst   = path.join(DEST, `workmedix-${stamp}.db`);

fs.copyFileSync(SRC, dst);
console.log(`[backup] ${dst}`);

// Prune backups older than 30 days
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
fs.readdirSync(DEST)
  .filter(f => f.startsWith('workmedix-') && f.endsWith('.db'))
  .map(f => ({ f, mtime: fs.statSync(path.join(DEST, f)).mtimeMs }))
  .filter(({ mtime }) => mtime < thirtyDaysAgo)
  .forEach(({ f }) => { fs.unlinkSync(path.join(DEST, f)); console.log(`[backup] pruned ${f}`); });
