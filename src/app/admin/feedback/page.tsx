'use client';

/**
 * Admin feedback dashboard. Lists everything submitted via the floating
 * widget, lets the admin filter by category/status/follow-up, change the
 * triage status inline, and add internal notes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface FeedbackItem {
  feedbackId: string;
  page: string;
  category: 'bug' | 'idea' | 'praise' | 'question' | 'other';
  comment: string;
  email: string;
  requestFollowup: boolean;
  status: 'new' | 'in_progress' | 'resolved' | 'wontfix';
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userAgent: string | null;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_META: Record<FeedbackItem['category'], { label: string; emoji: string; color: string }> = {
  bug: { label: 'Bug', emoji: '🐛', color: 'bg-red-100 text-red-800 border-red-200' },
  idea: { label: 'Idea', emoji: '💡', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  praise: { label: 'Praise', emoji: '🌟', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  question: { label: 'Question', emoji: '❓', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  other: { label: 'Other', emoji: '💬', color: 'bg-stone-100 text-stone-800 border-stone-200' },
};

const STATUSES: FeedbackItem['status'][] = ['new', 'in_progress', 'resolved', 'wontfix'];

const STATUS_LABEL: Record<FeedbackItem['status'], string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wontfix: "Won't fix",
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackItem['status']>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FeedbackItem['category']>('all');
  const [followupOnly, setFollowupOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', { cache: 'no-store' });
      if (res.status === 403) {
        setError('Admin access required.');
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: FeedbackItem[]; error?: string };
      if (!res.ok) {
        setError(data.error || 'Failed to load feedback');
        return;
      }
      setItems(data.items || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false;
      if (followupOnly && !it.requestFollowup) return false;
      return true;
    });
  }, [items, statusFilter, categoryFilter, followupOnly]);

  const counts = useMemo(() => {
    const out = { total: items.length, new: 0, followup: 0 };
    for (const it of items) {
      if (it.status === 'new') out.new++;
      if (it.requestFollowup && it.status !== 'resolved' && it.status !== 'wontfix') out.followup++;
    }
    return out;
  }, [items]);

  async function updateStatus(feedbackId: string, status: FeedbackItem['status']) {
    setItems((prev) => prev.map((it) => (it.feedbackId === feedbackId ? { ...it, status } : it)));
    const res = await fetch(`/api/feedback/${encodeURIComponent(feedbackId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      await load();
    }
  }

  async function saveNotes(feedbackId: string, adminNotes: string) {
    const res = await fetch(`/api/feedback/${encodeURIComponent(feedbackId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes }),
    });
    if (!res.ok) {
      await load();
    }
  }

  async function deleteItem(feedbackId: string) {
    if (!confirm('Delete this feedback? This cannot be undone.')) return;
    const res = await fetch(`/api/feedback/${encodeURIComponent(feedbackId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setItems((prev) => prev.filter((it) => it.feedbackId !== feedbackId));
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold">Feedback</h1>
          <p className="text-sm text-stone-600 mt-1">
            {counts.total} total · {counts.new} new · {counts.followup} awaiting follow-up
          </p>
        </div>
        <button
          onClick={load}
          className="text-sm border border-stone-300 hover:bg-stone-50 rounded-md px-3 py-1.5"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
          {error}
        </div>
      )}

      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="border border-stone-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="all">Status: All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              Status: {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as typeof categoryFilter)}
          className="border border-stone-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="all">Category: All</option>
          {(Object.keys(CATEGORY_META) as FeedbackItem['category'][]).map((c) => (
            <option key={c} value={c}>
              Category: {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={followupOnly}
            onChange={(e) => setFollowupOnly(e.target.checked)}
            className="rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
          />
          Follow-up requested
        </label>
        <span className="text-xs text-stone-500 ml-auto">{filtered.length} shown</span>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-stone-300 rounded-md p-8 text-center text-stone-500 text-sm">
          No feedback matches.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((it) => (
            <FeedbackRow
              key={it.feedbackId}
              item={it}
              onStatusChange={updateStatus}
              onNotesSave={saveNotes}
              onDelete={deleteItem}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackRow({
  item,
  onStatusChange,
  onNotesSave,
  onDelete,
}: {
  item: FeedbackItem;
  onStatusChange: (id: string, status: FeedbackItem['status']) => void;
  onNotesSave: (id: string, notes: string) => void;
  onDelete: (id: string) => void;
}) {
  const [notes, setNotes] = useState(item.adminNotes);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const meta = CATEGORY_META[item.category];

  useEffect(() => {
    setNotes(item.adminNotes);
  }, [item.adminNotes]);

  return (
    <li className="border border-stone-200 rounded-md bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs rounded-full border px-2 py-0.5 ${meta.color}`}>
            {meta.emoji} {meta.label}
          </span>
          <code className="text-xs text-stone-600 bg-stone-100 rounded px-1.5 py-0.5">
            {item.page}
          </code>
          {item.requestFollowup && (
            <span className="text-xs rounded-full border bg-amber-50 border-amber-200 text-amber-900 px-2 py-0.5">
              ↩︎ wants follow-up
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={item.status}
            onChange={(e) => onStatusChange(item.feedbackId, e.target.value as FeedbackItem['status'])}
            className="text-xs border border-stone-300 rounded-md px-2 py-1"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            onClick={() => onDelete(item.feedbackId)}
            className="text-xs text-red-700 hover:underline"
          >
            Delete
          </button>
        </div>
      </div>

      <p className="text-sm text-stone-900 whitespace-pre-wrap mt-3">{item.comment}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500 mt-3">
        <span>{formatDate(item.createdAt)}</span>
        {item.userName || item.userEmail ? (
          <span>
            From: {item.userName || item.userEmail}
            {item.userName && item.userEmail ? ` <${item.userEmail}>` : ''}
          </span>
        ) : (
          <span>Anonymous</span>
        )}
        {item.email && item.email !== item.userEmail && <span>Reply to: {item.email}</span>}
        {item.userAgent && (
          <span className="truncate max-w-md" title={item.userAgent}>
            UA: {item.userAgent}
          </span>
        )}
      </div>

      <details className="mt-3">
        <summary className="text-xs text-stone-600 cursor-pointer hover:text-stone-900">
          Admin notes {notes ? `(${notes.length} chars)` : ''}
        </summary>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== item.adminNotes) {
              onNotesSave(item.feedbackId, notes);
              setSavedAt(Date.now());
            }
          }}
          rows={2}
          placeholder="Internal notes…"
          className="mt-2 w-full border border-stone-300 rounded-md px-3 py-2 text-sm"
        />
        {savedAt && <p className="text-[11px] text-stone-500 mt-1">Saved.</p>}
      </details>
    </li>
  );
}
