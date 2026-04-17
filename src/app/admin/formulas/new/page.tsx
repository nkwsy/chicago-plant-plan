import FormulaEditor from '@/components/admin/FormulaEditor';
import { getFormula } from '@/lib/formulas/load';
import type { DesignFormula } from '@/types/formula';

export const dynamic = 'force-dynamic';

/** Create a new design formula. `?from=<slug>` pre-fills everything except
 *  the slug/name from an existing formula (the "Clone" flow). */
export default async function NewFormulaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  let initial: Partial<DesignFormula> = {};

  if (from) {
    const source = await getFormula(from);
    if (source) {
      initial = {
        ...source,
        slug: '',
        // Blank out identity fields so the user picks their own, and make it
        // clear this is a derivative of the original.
        name: `${source.name} (copy)`,
        isBuiltIn: false,
        parentSlug: source.slug,
        author: '',
      };
    }
  }

  return <FormulaEditor mode="create" initial={initial} />;
}
