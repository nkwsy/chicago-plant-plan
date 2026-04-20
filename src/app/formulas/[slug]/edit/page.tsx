/**
 * /formulas/[slug]/edit — full editor + live preview sandbox. Owner/admin only.
 *
 * Server-side permission checks:
 *   - Not signed in → redirect to /login.
 *   - Not owner (and not admin) → 404.
 *   - Built-in + non-admin → redirect to the read-only /formulas/[slug] view,
 *     which surfaces a "Clone to edit" CTA.
 *
 * The editor state + sandbox live-sync happens in FormulaEditWithPreview.
 */

import { notFound, redirect } from 'next/navigation';
import FormulaEditWithPreview from '@/components/formulas/FormulaEditWithPreview';
import { getFormula } from '@/lib/formulas/load';
import { getSessionUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export default async function EditFormulaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getSessionUser();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/formulas/${slug}/edit`)}`);
  }

  const formula = await getFormula(slug, { userId: session.userId, role: session.role });
  if (!formula) return notFound();

  const isAdmin = session.role === 'admin';
  const isOwner = formula.ownerId === session.userId;

  if (formula.isBuiltIn && !isAdmin) {
    redirect(`/formulas/${slug}`);
  }
  if (!isAdmin && !isOwner) return notFound();

  return (
    <FormulaEditWithPreview
      mode="edit"
      initial={formula}
      canEditBuiltIn={isAdmin}
      cancelHref={`/formulas/${slug}`}
      afterSavePath={(s) => `/formulas/${s}`}
    />
  );
}
