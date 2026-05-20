'use strict';

const Database = require('better-sqlite3');
const path     = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'workmedix.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
