import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LABELS, STATUS_TEXT } from '../config/constants.js';
import { LetterApi } from '../services/letterApi.js';

const TABS = [
  { key: 'received', label: LABELS.RECEIVED },
  { key: 'sent', label: LABELS.SENT },
  { key: 'conversations', label: LABELS.CONVERSATIONS }
];

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function LetterCard({ item, onOpen, onToggleFavorite, onSkip, onMarkUnread }) {
  const skipped = item.status === 'skipped';
  const statusClass = skipped ? 'badge skipped' : 'badge';
  // Letters addressed to me that wait for an answer; skipped threads
  // and letters I sent never carry this flag.
  const showUnread = item.unread;
  // On threads I started or write in, show whether the other traveler
  // has opened my letter(s).
  const showPendingRead = !skipped && item.pendingRead;
  const showRead =
    !skipped && !item.pendingRead && (item.role === 'sent' || item.role === 'either');

  return (
    <div
      className={`letter-card ${showUnread ? 'unread' : ''}`}
      onClick={() => onOpen(item.id)}
    >
      <div className="letter-meta">
        <span>
          {showUnread && <span className="unread-dot" title={LABELS.UNREAD} />}
          {item.role === 'sent' ? LABELS.SENT_FROM_ME : LABELS.SENT_FROM_STRANGER}
          {item.replyCount > 0 ? ` · ${item.replyCount} 封回信` : ''}
        </span>
        <span>
          {formatTime(item.createdAt)}
          {item.status && item.status !== 'delivered' && item.status !== 'pending' && (
            <>
              {' '}
              <span className={statusClass}>{STATUS_TEXT[item.status]}</span>
            </>
          )}
          {showUnread && (
            <>
              {' '}
              <span className="badge unread-badge">{LABELS.UNREAD}</span>
            </>
          )}
          {!showUnread && showPendingRead && (
            <>
              {' '}
              <span className="badge pending-badge">{LABELS.PENDING_READ}</span>
            </>
          )}
          {!showUnread && showRead && (
            <>
              {' '}
              <span className="badge read-badge">{LABELS.READ}</span>
            </>
          )}
        </span>
      </div>
      <div className="letter-preview">{item.preview}{item.preview.length >= 80 ? '…' : ''}</div>
      <div className="letter-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`icon-btn ${item.favorited ? 'on' : ''}`}
          onClick={() => onToggleFavorite(item.id)}
        >
          {item.favorited ? `★ ${LABELS.UNFAVORITE}` : `☆ ${LABELS.FAVORITE}`}
        </button>
        {!(item.role === 'sent' && item.replyCount === 0) && !skipped && (
          <button className="icon-btn" onClick={() => onMarkUnread(item.id)}>
            {LABELS.MARK_UNREAD}
          </button>
        )}
        {item.role === 'received' && !skipped && item.replyCount === 0 && (
          <button className="icon-btn" onClick={() => onSkip(item.id)}>
            {LABELS.SKIP}
          </button>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  const [tab, setTab] = useState('received');
  const [data, setData] = useState({ sent: [], received: [], conversations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const result = await LetterApi.inbox();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const toggleFavorite = async (id) => {
    try {
      await LetterApi.toggleFavorite(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const skip = async (id) => {
    try {
      await LetterApi.skip(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const markUnread = async (id) => {
    try {
      await LetterApi.markUnread(id);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const list = data[tab] || [];

  const emptyText = useMemo(() => {
    if (tab === 'sent') return LABELS.EMPTY_SENT;
    if (tab === 'received') return LABELS.EMPTY_RECEIVED;
    return LABELS.EMPTY_CONVERSATIONS;
  }, [tab]);

  return (
    <div>
      <div className="inbox-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="loading">加载中…</div>
      ) : list.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div className="letter-list">
          {list.map((item) => (
            <LetterCard
              key={item.id}
              item={item}
              onOpen={(id) => navigate(`/thread/${id}`)}
              onToggleFavorite={toggleFavorite}
              onSkip={skip}
              onMarkUnread={markUnread}
            />
          ))}
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
