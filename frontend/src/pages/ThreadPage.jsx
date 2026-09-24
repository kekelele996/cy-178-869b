import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LABELS } from '../config/constants.js';
import { LetterApi } from '../services/letterApi.js';

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ThreadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      // Fetching the thread marks letters addressed to me as read,
      // so the inbox and this page always agree.
      const thread = await LetterApi.thread(id);
      setData(thread);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const submitReply = async () => {
    setError('');
    if (!reply.trim()) return;
    setSubmitting(true);
    try {
      await LetterApi.reply({ id, content: reply.trim() });
      setReply('');
      // The new reply arrives unread for the other side; reload so both
      // the messages and the per-message read state stay consistent.
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      await LetterApi.toggleFavorite(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const markUnread = async () => {
    try {
      await LetterApi.markUnread(id);
      navigate('/inbox');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loading">加载对话中…</div>;
  if (!data) return <div className="empty-state">{error || '无法加载对话'}</div>;

  const skipped = data.status === 'skipped';

  return (
    <div className="thread-wrap">
      <div className="thread-head">
        <h2>对话链 #{id}</h2>
        <div>
          <button
            className={`icon-btn ${data.favorited ? 'on' : ''}`}
            onClick={toggleFavorite}
          >
            {data.favorited ? `★ ${LABELS.UNFAVORITE}` : `☆ ${LABELS.FAVORITE}`}
          </button>
          {!skipped && (
            <button
              className="icon-btn"
              style={{ marginLeft: 8 }}
              onClick={markUnread}
            >
              {LABELS.MARK_UNREAD}
            </button>
          )}
          <button
            className="icon-btn"
            style={{ marginLeft: 8 }}
            onClick={() => navigate('/inbox')}
          >
            {LABELS.BACK}
          </button>
        </div>
      </div>

      <div className="message-list">
        {data.messages.map((m) => (
          <div key={m.id} className={`msg-bubble ${m.fromMe ? 'me' : 'them'}`}>
            <div>{m.content}</div>
            <div className="msg-time">
              {formatTime(m.createdAt)}
              {m.fromMe && !skipped && (
                <span className={`msg-read ${m.read ? 'read' : 'pending'}`}>
                  · {m.read ? LABELS.MESSAGE_READ : LABELS.MESSAGE_UNREAD}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="reply-box">
        <textarea
          className="reply-text"
          placeholder={LABELS.REPLY_PLACEHOLDER}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={2000}
        />
        <div className="reply-footer">
          <div className="error-text" style={{ margin: 'auto 0' }}>{error}</div>
          <button
            className="big-btn"
            onClick={submitReply}
            disabled={submitting || !reply.trim()}
          >
            {submitting ? '寄出中…' : LABELS.SUBMIT_REPLY}
          </button>
        </div>
      </div>
    </div>
  );
}
