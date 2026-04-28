'use client';

/**
 * Floating feedback widget — bottom-right corner on every page.
 * Mirrors the standard "Leave feedback" pattern (Linear, Vercel, GitHub):
 *  - Small button → modal popover
 *  - Category chips first (one click) so the user picks intent before typing
 *  - Comment textarea + optional follow-up email
 *  - Auto-captures current page path + user-agent server-side
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

type Category = 'bug' | 'idea' | 'praise' | 'question' | 'other';

interface CategoryDef {
  key: Category;
  label: string;
  emoji: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: 'bug', label: 'Bug', emoji: '🐛' },
  { key: 'idea', label: 'Idea', emoji: '💡' },
  { key: 'praise', label: 'Praise', emoji: '🌟' },
  { key: 'question', label: 'Question', emoji: '❓' },
  { key: 'other', label: 'Other', emoji: '💬' },
];

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('idea');
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [requestFollowup, setRequestFollowup] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hide on admin routes — admins use the dashboard, the widget would just be noise.
  const onAdminRoute = pathname?.startsWith('/admin') ?? false;

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function reset() {
    setCategory('idea');
    setComment('');
    setEmail('');
    setRequestFollowup(false);
    setError(null);
    setSubmitted(false);
  }

  function close() {
    setOpen(false);
    setTimeout(reset, 250);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pathname || '/',
          category,
          comment: comment.trim(),
          email: email.trim(),
          requestFollowup,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'Could not send feedback');
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (onAdminRoute) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium rounded-full shadow-lg px-4 py-2.5 flex items-center gap-2 transition-colors no-print"
          aria-label="Leave feedback"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          </svg>
          Feedback
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-end justify-end p-4 no-print">
          <button
            type="button"
            aria-label="Close feedback panel"
            className="absolute inset-0 bg-black/20 sm:bg-transparent"
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Leave feedback"
            className="relative bg-white rounded-xl shadow-2xl border border-stone-200 w-full max-w-sm overflow-hidden"
          >
            {submitted ? (
              <div className="p-6 text-center">
                <div className="text-3xl mb-2">🌱</div>
                <h2 className="font-semibold text-stone-900">Thanks!</h2>
                <p className="text-sm text-stone-600 mt-1">
                  Your feedback was logged{requestFollowup ? " and we'll be in touch" : ''}.
                </p>
                <button
                  onClick={close}
                  className="mt-4 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-medium rounded-md px-4 py-2"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
                  <h2 className="font-semibold text-stone-900">Leave feedback</h2>
                  <button
                    type="button"
                    onClick={close}
                    className="text-stone-400 hover:text-stone-700 text-xl leading-none"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1.5">
                      What's this about?
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {CATEGORIES.map((c) => {
                        const active = category === c.key;
                        return (
                          <button
                            type="button"
                            key={c.key}
                            onClick={() => setCategory(c.key)}
                            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                              active
                                ? 'bg-emerald-700 border-emerald-700 text-white'
                                : 'bg-white border-stone-300 text-stone-700 hover:border-stone-400'
                            }`}
                          >
                            <span className="mr-1">{c.emoji}</span>
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1.5">
                      Your message
                    </label>
                    <textarea
                      ref={textareaRef}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder={
                        category === 'bug'
                          ? 'What went wrong? What did you expect?'
                          : category === 'idea'
                            ? 'What would make this better?'
                            : category === 'praise'
                              ? 'What do you like?'
                              : category === 'question'
                                ? 'What can we help with?'
                                : 'Tell us more…'
                      }
                      rows={4}
                      maxLength={5000}
                      required
                      className="w-full border border-stone-300 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                    />
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-xs text-stone-700">
                      <input
                        type="checkbox"
                        checked={requestFollowup}
                        onChange={(e) => setRequestFollowup(e.target.checked)}
                        className="rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      I'd like a follow-up
                    </label>
                    {requestFollowup && (
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="mt-2 w-full border border-stone-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                      />
                    )}
                  </div>

                  <p className="text-[11px] text-stone-500">
                    We'll log the page you're on ({pathname || '/'}) to help us reproduce.
                  </p>

                  {error && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                      {error}
                    </p>
                  )}
                </div>

                <div className="flex justify-end gap-2 px-4 py-3 bg-stone-50 border-t border-stone-200">
                  <button
                    type="button"
                    onClick={close}
                    className="text-sm text-stone-700 hover:text-stone-900 px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!comment.trim() || submitting}
                    className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-300 text-white text-sm font-medium rounded-md px-4 py-1.5"
                  >
                    {submitting ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
