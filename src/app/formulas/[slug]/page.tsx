/**
 * /formulas/[slug] — read-only detail view.
 *
 * Uses the same FormulaEditor component with `editable={false}` so the layout
 * matches the edit page 1:1 (easier to grok the effect of each weight). The
 * Edit button appears only for the owner / admin.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import FormulaEditor from '@/components/formulas/FormulaEditor';
import { getFormula } from '@/lib/formulas/load';
import { getSessionUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export default async function FormulaDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSessionUser();
  const formula = await getFormula(
    slug,
    session ? { userId: session.userId, role: session.role } : undefined,
  );
  if (!formula) return notFound();

  const isAdmin = session?.role === 'admin';
  const isOwner = !!session && formula.ownerId === session.userId;
  const canEdit = isAdmin || isOwner || (isAdmin && formula.isBuiltIn);

  return (
    <div>
      {canEdit && (
        <div className="max-w-7xl mx-auto px-6 pt-6 flex items-center justify-end gap-3">
          <Link
            href={`/formulas/${formula.slug}/edit`}
            className="text-sm bg-emerald-700 hover:bg-emerald-800 text-white rounded-md px-4 py-2"
          >
            Edit this formula
          </Link>
        </div>
      )}
      <FormulaEditor
        mode="edit"
        initial={formula}
        editable={false}
        canEditBuiltIn={isAdmin}
        cancelHref="/formulas"
      />
    </div>
  );
}
