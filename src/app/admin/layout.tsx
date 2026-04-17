import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Admin — Chicago Native Plant Planner',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="bg-stone-900 text-stone-100 border-b border-stone-700">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
          <span className="font-semibold">Admin</span>
          <Link href="/admin/plants" className="text-sm hover:text-white text-stone-300">Plants</Link>
          <span className="ml-auto text-xs text-stone-400">Local curation tools</span>
        </div>
      </nav>
      {children}
    </div>
  );
}
