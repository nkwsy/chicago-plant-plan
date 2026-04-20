'use client';

/**
 * UserMenu — avatar + dropdown in the top-right nav.
 *
 * Fetches /api/auth/me on mount rather than taking props so the header
 * component tree doesn't need to turn server-side. The downside is a single
 * extra network round-trip on page load; fine for MVP.
 */

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Me {
  id: string;
  email: string;
  name: string;
  image: string;
  role: 'user' | 'admin';
}

export default function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        const data = (await res.json()) as { user: Me | null };
        if (!cancelled) setMe(data.user);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-stone-200 animate-pulse" aria-hidden />;
  }

  if (!me) {
    const next = pathname || '/';
    return (
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="text-sm text-foreground hover:text-primary transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const initials = (me.name || me.email).slice(0, 1).toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full hover:bg-stone-100 p-1 transition-colors"
        aria-label="User menu"
        aria-expanded={open}
      >
        {me.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.image}
            alt=""
            className="w-8 h-8 rounded-full object-cover border border-stone-200"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 bg-white border border-stone-200 rounded-lg shadow-lg py-1 z-50"
        >
          <div className="px-3 py-2 border-b border-stone-100">
            <div className="text-sm font-medium truncate">{me.name || me.email}</div>
            <div className="text-xs text-stone-500 truncate">{me.email}</div>
            {me.role === 'admin' && (
              <div className="text-[10px] uppercase tracking-wide text-emerald-700 mt-1">Admin</div>
            )}
          </div>
          <Link
            href="/formulas"
            className="block px-3 py-2 text-sm hover:bg-stone-50"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            My formulas
          </Link>
          {me.role === 'admin' && (
            <Link
              href="/admin/plants"
              className="block px-3 py-2 text-sm hover:bg-stone-50"
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              Admin
            </Link>
          )}
          <button
            onClick={async () => {
              await fetch('/api/auth/signout', { method: 'POST' });
              window.location.href = '/';
            }}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-stone-50 text-red-700"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
