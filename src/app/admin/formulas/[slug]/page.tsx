import FormulaEditor from '@/components/admin/FormulaEditor';
import { getFormula } from '@/lib/formulas/load';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function EditFormulaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const formula = await getFormula(slug);
  if (!formula) return notFound();

  return <FormulaEditor mode="edit" initial={formula} />;
}
