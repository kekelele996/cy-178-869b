const db = require('../data/database');
const { LETTER_STATUS } = require('../config/constants');

// Per-letter read state from the receiver's point of view.
// A row existing means the receiver has read that letter;
// deleting it marks the conversation back to unread.
// Read state always follows the ROOT letter: if the root was skipped
// (a terminal state), no message in the thread participates.
const LIVE_THREAD_EXCLUDE = `
  AND COALESCE(l.parent_id, l.id) IN (
    SELECT l2.id FROM letters l2
    WHERE l2.parent_id IS NULL AND l2.status != ?
  )`;

const ReadReceiptModel = {
  markRead({ receiverId, letterId, readAt }) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO read_receipts (receiver_id, letter_id, read_at)
         VALUES (?, ?, ?)`
      )
      .run(receiverId, letterId, readAt);
  },

  markThreadRead({ receiverId, rootId, readAt }) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO read_receipts (receiver_id, letter_id, read_at)
         SELECT ?, l.id, ?
         FROM letters l
         WHERE (l.id = ? OR l.parent_id = ?)
           AND l.receiver_id = ?
           AND EXISTS (
             SELECT 1 FROM letters root
             WHERE root.id = ? AND root.status != ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM read_receipts r
             WHERE r.letter_id = l.id AND r.receiver_id = l.receiver_id
           )`
      )
      .run(receiverId, readAt, rootId, rootId, receiverId, rootId, LETTER_STATUS.SKIPPED);
  },

  removeForThread({ receiverId, rootId }) {
    return db
      .prepare(
        `DELETE FROM read_receipts
         WHERE receiver_id = ?
           AND letter_id IN (
             SELECT id FROM letters WHERE id = ? OR parent_id = ?
           )`
      )
      .run(receiverId, rootId, rootId);
  },

  exists({ receiverId, letterId }) {
    const row = db
      .prepare(
        `SELECT 1 FROM read_receipts
         WHERE receiver_id = ? AND letter_id = ?`
      )
      .get(receiverId, letterId);
    return !!row;
  },

  // Roots where the viewer is the receiver and has at least one incoming
  // letter without a receipt. Skipped threads never participate.
  listUnreadRootIds(userId) {
    const rows = db
      .prepare(
        `SELECT DISTINCT COALESCE(l.parent_id, l.id) AS root_id
         FROM letters l
         WHERE l.receiver_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM read_receipts r
             WHERE r.letter_id = l.id AND r.receiver_id = l.receiver_id
           )
           ${LIVE_THREAD_EXCLUDE}`
      )
      .all(userId, LETTER_STATUS.SKIPPED);
    return new Set(rows.map((r) => r.root_id));
  },

  // Roots where the viewer is the sender and still has at least one outgoing
  // letter the other side has not opened. Skipped threads never participate.
  listPendingRootIds(userId) {
    const rows = db
      .prepare(
        `SELECT DISTINCT COALESCE(l.parent_id, l.id) AS root_id
         FROM letters l
         WHERE l.sender_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM read_receipts r
             WHERE r.letter_id = l.id AND r.receiver_id = l.receiver_id
           )
           ${LIVE_THREAD_EXCLUDE}`
      )
      .all(userId, LETTER_STATUS.SKIPPED);
    return new Set(rows.map((r) => r.root_id));
  },

  // Letter ids in a thread whose receiver has opened them.
  // Viewer-independent: works for both sides of the conversation.
  listReadLetterIds(rootId) {
    const rows = db
      .prepare(
        `SELECT r.letter_id AS id FROM read_receipts r
         WHERE r.letter_id IN (
           SELECT id FROM letters WHERE id = ? OR parent_id = ?
         )`
      )
      .all(rootId, rootId);
    return new Set(rows.map((r) => r.id));
  }
};

module.exports = ReadReceiptModel;
