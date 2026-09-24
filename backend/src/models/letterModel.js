const db = require('../data/database');
const { LETTER_STATUS } = require('../config/constants');

// Per-card read stats over a whole conversation chain (root + its replies):
// unread_count      — letters written to me that I have not opened yet
// peer_unread_count — letters I wrote that the other side has not opened yet
// incoming_count    — letters written to me in this chain
// outgoing_count    — letters I wrote in this chain
// Skipped letters are excluded everywhere: they do not take part in read state.
const READ_STATS = `
  (SELECT COUNT(*) FROM letters c
    WHERE (c.id = l.id OR c.parent_id = l.id)
      AND c.receiver_id = ? AND c.status != '${LETTER_STATUS.SKIPPED}'
      AND c.read_at IS NULL) AS unread_count,
  (SELECT COUNT(*) FROM letters c
    WHERE (c.id = l.id OR c.parent_id = l.id)
      AND c.sender_id = ? AND c.status != '${LETTER_STATUS.SKIPPED}'
      AND c.read_at IS NULL) AS peer_unread_count,
  (SELECT COUNT(*) FROM letters c
    WHERE (c.id = l.id OR c.parent_id = l.id)
      AND c.receiver_id = ? AND c.status != '${LETTER_STATUS.SKIPPED}') AS incoming_count,
  (SELECT COUNT(*) FROM letters c
    WHERE (c.id = l.id OR c.parent_id = l.id)
      AND c.sender_id = ? AND c.status != '${LETTER_STATUS.SKIPPED}') AS outgoing_count`;

const LetterModel = {
  create({ senderId, receiverId, parentId, content, status, createdAt }) {
    const stmt = db.prepare(
      `INSERT INTO letters (sender_id, receiver_id, parent_id, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(senderId, receiverId, parentId || null, content, status, createdAt);
    return info.lastInsertRowid;
  },

  findById(id) {
    return db.prepare('SELECT * FROM letters WHERE id = ?').get(id);
  },

  findRootByChild(id) {
    const row = db
      .prepare(
        `WITH RECURSIVE chain(id, parent_id) AS (
           SELECT id, parent_id FROM letters WHERE id = ?
           UNION ALL
           SELECT l.id, l.parent_id FROM letters l
           INNER JOIN chain c ON l.id = c.parent_id
         )
         SELECT id FROM chain WHERE parent_id IS NULL`
      )
      .get(id);
    return row ? row.id : id;
  },

  updateStatus(id, status) {
    return db.prepare('UPDATE letters SET status = ? WHERE id = ?').run(status, id);
  },

  listSentByUser(userId) {
    return db
      .prepare(
        `SELECT l.*,
          (SELECT COUNT(*) FROM letters c WHERE c.parent_id = l.id) AS reply_count,
          ${READ_STATS}
         FROM letters l
         WHERE l.sender_id = ? AND l.parent_id IS NULL
         ORDER BY l.created_at DESC`
      )
      .all(userId, userId, userId, userId, userId);
  },

  listReceivedByUser(userId) {
    return db
      .prepare(
        `SELECT l.*,
          (SELECT COUNT(*) FROM letters c WHERE c.parent_id = l.id) AS reply_count,
          ${READ_STATS}
         FROM letters l
         WHERE l.receiver_id = ? AND l.parent_id IS NULL
         ORDER BY l.created_at DESC`
      )
      .all(userId, userId, userId, userId, userId);
  },

  listConversationsForUser(userId) {
    return db
      .prepare(
        `SELECT DISTINCT l.*,
          (SELECT COUNT(*) FROM letters c WHERE c.parent_id = l.id) AS reply_count,
          ${READ_STATS}
         FROM letters l
         WHERE l.parent_id IS NULL
           AND (l.sender_id = ? OR l.receiver_id = ?)
           AND EXISTS (
             SELECT 1 FROM letters c WHERE c.parent_id = l.id
           )
         ORDER BY l.created_at DESC`
      )
      .all(userId, userId, userId, userId, userId, userId);
  },

  listThread(rootId) {
    return db
      .prepare(
        `WITH RECURSIVE chain(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM letters WHERE id = ?
           UNION ALL
           SELECT l.id, l.parent_id, c.depth + 1 FROM letters l
           INNER JOIN chain c ON l.parent_id = c.id
         )
         SELECT l.* FROM letters l
         INNER JOIN chain c ON l.id = c.id
         ORDER BY c.depth ASC, l.created_at ASC`
      )
      .all(rootId);
  },

  markThreadRead({ rootId, userId, readAt }) {
    return db
      .prepare(
        `WITH RECURSIVE chain(id) AS (
           SELECT id FROM letters WHERE id = ?
           UNION ALL
           SELECT l.id FROM letters l
           INNER JOIN chain c ON l.parent_id = c.id
         )
         UPDATE letters SET read_at = ?
         WHERE receiver_id = ? AND read_at IS NULL
           AND id IN (SELECT id FROM chain)`
      )
      .run(rootId, readAt, userId);
  },

  markThreadUnread({ rootId, userId }) {
    return db
      .prepare(
        `WITH RECURSIVE chain(id) AS (
           SELECT id FROM letters WHERE id = ?
           UNION ALL
           SELECT l.id FROM letters l
           INNER JOIN chain c ON l.parent_id = c.id
         )
         UPDATE letters SET read_at = NULL
         WHERE receiver_id = ?
           AND id IN (SELECT id FROM chain)`
      )
      .run(rootId, userId);
  }
};

module.exports = LetterModel;
