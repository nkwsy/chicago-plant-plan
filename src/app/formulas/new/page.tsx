/**
 * /formulas/new — create a new formula.
 *
 * Supports `?from=<slug>` to clone an existing formula as a starting point.
 * The cloned copy strips identity fields (slug, isBuiltIn, author) so the new
 * owner puts their own stamp on it.
 *
 * Server-side guard: if nobody is signed in, redirect to /login with a
 * round-trip `next` param so we come back here after auth.
 */

import { redirect } from 'next/navigation';
import FormulaEditor from '@/components/formulas/FormulaEditor';
import { getFormula } from '@/lib/formulas/load';
import { getSessionUser } from '@/lib/auth/dal';
import type { DesignFormula } from '@/types/formula';

export const dynamic = 'force-dynamic';

export default async function NewFormulaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) {
    const next = '/formulas/new';
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { from } = await searchParams;
  let initial: Partial<DesignFormula> = {};

  if (from) {
    const source = await getFormula(from, { userId: session.userId, role: session.role });
    if (source) {
      initial = {
        ...source,
        slug: '',
        // Blank out identity fields so the user picks their own, and make it
        // clear this is a derivative of the original.
        name: `${source.name} (copy)`,
        isBuiltIn: false,
        ownerId: undefined,
        parentSlug: source.slug,
        author: session.name || '',
      };
    }
  }

  return (
    <FormulaEditor
      mode="create"
      initial={initial}
      editable
      canEditBuiltIn={session.role === 'admin'}
      cancelHref="/formulas"
    />
  );
}
