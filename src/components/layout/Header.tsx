'use client';

import Link from 'next/link';
import { useState } from 'react';
import UserMenu from '@/components/nav/UserMenu';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="bg-surface border-b border-stone-200 sticky top-0 z-50 no-print">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-primary-dark">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z" />
            <path d="M7 18C4 16 3 12 5 10M17 18C20 16 21 12 19 10" strokeOpacity="0.4" />
          </svg>
          <span className="hidden sm:inline">Chicago Native Plant Planner</span>
          <span className="sm:hidden">Plant Planner</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/plan/new" className="text-foreground hover:text-primary transition-colors">
            Create Plan
          </Link>
          <Link href="/explore" className="text-foreground hover:text-primary transition-colors">
            Explore
          </Link>
          <Link href="/plants" className="text-foreground hover:text-primary transition-colors">
            Plant Guide
          </Link>
          <Link
            href="/plan/new"
            className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors font-medium"
          >
            Start Planning
          </Link>
          <UserMenu />
        </nav>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-2 -mr-2"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-stone-200 bg-surface">
          <nav className="flex flex-col p-4 gap-3">
            <Link
              href="/plan/new"
              className="text-foreground hover:text-primary py-2 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Create Plan
            </Link>
            <Link
              href="/explore"
              className="text-foreground hover:text-primary py-2 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Explore Plans
            </Link>
            <Link
              href="/plants"
              className="text-foreground hover:text-primary py-2 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              Plant Guide
            </Link>
            <Link
              href="/plan/new"
              className="bg-primary text-white px-4 py-2.5 rounded-lg text-center font-medium mt-1"
              onClick={() => setMenuOpen(false)}
            >
              Start Planning
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
