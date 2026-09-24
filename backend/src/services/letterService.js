const LetterModel = require('../models/letterModel');
const UserModel = require('../models/userModel');
const FavoriteModel = require('../models/favoriteModel');
const ReadReceiptModel = require('../models/readReceiptModel');
const { LETTER_STATUS, MESSAGES } = require('../config/constants');

const LetterService = {
  sendRandom({ senderId, content }) {
    const other = UserModel.findRandomOther(senderId);
    if (!other) {
      const err = new Error(MESSAGES.NO_OTHER_USERS);
      err.code = 'NO_USERS';
      throw err;
    }
    const id = LetterModel.create({
      senderId,
      receiverId: other.id,
      parentId: null,
      content,
      status: LETTER_STATUS.DELIVERED,
      createdAt: Date.now()
    });
    return LetterModel.findById(id);
  },

  reply({ userId, parentId, content }) {
    const parent = LetterModel.findById(parentId);
    if (!parent) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const isReceiver = parent.receiver_id === userId;
    const isSender = parent.sender_id === userId;
    if (!isReceiver && !isSender) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    const receiverId = isReceiver ? parent.sender_id : parent.receiver_id;

    const rootId = LetterModel.findRootByChild(parent.id);
    const id = LetterModel.create({
      senderId: userId,
      receiverId,
      parentId: rootId,
      content,
      status: LETTER_STATUS.REPLIED,
      createdAt: Date.now()
    });
    // A reply keeps the conversation alive; skipping is terminal and
    // must never be flipped back into a live state.
    if (
      parent.status === LETTER_STATUS.DELIVERED ||
      parent.status === LETTER_STATUS.PENDING
    ) {
      LetterModel.updateStatus(parent.id, LETTER_STATUS.REPLIED);
    }
    return LetterModel.findById(id);
  },

  skip({ userId, letterId }) {
    const letter = LetterModel.findById(letterId);
    if (!letter) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (letter.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    LetterModel.updateStatus(letterId, LETTER_STATUS.SKIPPED);
    return true;
  },

  toggleFavorite({ userId, letterId }) {
    const exists = FavoriteModel.exists({ userId, letterId });
    if (exists) {
      FavoriteModel.remove({ userId, letterId });
      return { favorited: false };
    }
    FavoriteModel.add({ userId, letterId, createdAt: Date.now() });
    return { favorited: true };
  },

  isFavorited({ userId, letterId }) {
    return FavoriteModel.exists({ userId, letterId });
  },

  // Opening a conversation marks every letter addressed to the viewer
  // within that thread as read. Skipped threads stay untouched.
  markThreadRead({ userId, rootId }) {
    ReadReceiptModel.markThreadRead({
      receiverId: userId,
      rootId,
      readAt: Date.now()
    });
  },

  // Put the whole conversation back to unread for letters addressed to me.
  markThreadUnread({ userId, rootId }) {
    const root = LetterModel.findById(rootId);
    if (!root || root.parent_id !== null) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (root.sender_id !== userId && root.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }
    // Skipped or otherwise terminated threads do not participate.
    if (root.status === LETTER_STATUS.SKIPPED) {
      const err = new Error(MESSAGES.READ_STATE_UNAVAILABLE);
      err.code = 'FORBIDDEN';
      throw err;
    }
    ReadReceiptModel.removeForThread({ receiverId: userId, rootId });
    return true;
  },

  listInbox(userId) {
    const rawSent = LetterModel.listSentByUser(userId);
    const rawReceived = LetterModel.listReceivedByUser(userId);
    const rawConvos = LetterModel.listConversationsForUser(userId);
    const favorites = new Set(
      FavoriteModel.listByUser(userId).map((l) => l.id)
    );
    const unreadRoots = ReadReceiptModel.listUnreadRootIds(userId);
    const pendingRoots = ReadReceiptModel.listPendingRootIds(userId);
    const decorate = (list, role) =>
      list.map((l) => {
        const skipped = l.status === LETTER_STATUS.SKIPPED;
        // Read state only applies to live threads; skipped or otherwise
        // terminated letters do not participate.
        const unread = !skipped && unreadRoots.has(l.id);
        const pendingRead = !skipped && pendingRoots.has(l.id);
        return {
          id: l.id,
          preview: l.content.slice(0, 80),
          status: l.status,
          createdAt: l.created_at,
          replyCount: l.reply_count,
          role,
          favorited: favorites.has(l.id),
          unread,
          pendingRead
        };
      });
    return {
      sent: decorate(rawSent, 'sent'),
      received: decorate(rawReceived, 'received'),
      conversations: decorate(rawConvos, 'either')
    };
  },

  getThread({ userId, rootId }) {
    const thread = LetterModel.listThread(rootId);
    if (!thread.length) {
      const err = new Error(MESSAGES.LETTER_NOT_FOUND);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const first = thread[0];
    if (first.sender_id !== userId && first.receiver_id !== userId) {
      const err = new Error(MESSAGES.NOT_YOUR_LETTER);
      err.code = 'FORBIDDEN';
      throw err;
    }

    const skipped = first.status === LETTER_STATUS.SKIPPED;
    // Entering the conversation reads everything addressed to me,
    // unless the letter was skipped.
    if (!skipped) {
      LetterService.markThreadRead({ userId, rootId });
    }

    const readLetterIds = ReadReceiptModel.listReadLetterIds(rootId);
    const me = userId;
    return {
      rootId,
      status: first.status,
      favorited: FavoriteModel.exists({ userId, letterId: rootId }),
      messages: thread.map((m) => ({
        id: m.id,
        content: m.content,
        createdAt: m.created_at,
        fromMe: m.sender_id === me,
        // My own outgoing message: has the other traveler opened it?
        read: readLetterIds.has(m.id)
      }))
    };
  }
};

module.exports = LetterService;
