/**
 * /login — single-button sign-in page.
 *
 * Accepts `?next=<relative path>` so the user lands back where they were after
 * Google's OAuth round-trip. Also surfaces errors bubbled up from the callback
 * (e.g. `?error=bad_state`) as a banner.
 */

import Link from 'next/link';

interface Props {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export const metadata = {
  title: 'Sign in — Chicago Native Plant Planner',
};

export default async function LoginPage({ searchParams }: Props) {
  const { next, error } = await searchParams;
  const nextParam = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const href = `/api/auth/google/start?next=${encodeURIComponent(nextParam)}`;

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="bg-surface border border-stone-200 rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-2">Sign in</h1>
        <p className="text-sm text-stone-600 mb-6">
          Sign in to save your plans, create your own design formulas, and reuse them across projects.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
            Sign-in failed: {error}
          </div>
        )}

        <a
          href={href}
          className="flex items-center justify-center gap-3 w-full bg-white hover:bg-stone-50 border border-stone-300 rounded-lg py-2.5 text-sm font-medium text-stone-800 transition-colors"
        >
          <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.5 2.6 30.1 0 24 0 14.7 0 6.7 5.4 2.8 13.2l7.8 6C12.5 13.4 17.8 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.6c4.3-4 6.7-9.8 6.7-16.8z" />
            <path fill="#FBBC05" d="M10.6 28.8c-.5-1.5-.8-3-.8-4.8s.3-3.3.8-4.8l-7.8-6C1.1 16.5 0 20.1 0 24s1.1 7.5 2.8 10.8l7.8-6z" />
            <path fill="#34A853" d="M24 48c6.1 0 11.2-2 15-5.4l-7.3-5.6c-2 1.3-4.6 2.1-7.7 2.1-6.2 0-11.5-3.9-13.4-9.3l-7.8 6C6.7 42.6 14.7 48 24 48z" />
          </svg>
          Continue with Google
        </a>

        <p className="text-xs text-stone-500 mt-6 text-center">
          By signing in you agree to keep the gardening wholesome.
        </p>

        <div className="text-center mt-6">
          <Link href="/" className="text-xs text-stone-500 hover:text-stone-700">
            ← back to the planner
          </Link>
        </div>
      </div>
    </div>
  );
}
