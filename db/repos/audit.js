'use strict';

const db = require('../index');

function logAction({ actorId, action, entityTable, entityId, before, after, req }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (actor_user_id, action, entity_table, entity_id, before_json, after_json, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actorId || null,
      action,
      entityTable || null,
      entityId   || null,
      before ? JSON.stringify(before) : null,
      after  ? JSON.stringify(after)  : null,
      req ? (req.ip || req.headers['x-forwarded-for'] || null) : null,
      req ? (req.headers['user-agent'] || null) : null
    );
  } catch (e) {
    // Audit log failure must never crash the app
    console.error('[audit] failed to write:', e.message);
  }
}

module.exports = { logAction };
