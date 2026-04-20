/**
 * Legacy redirect: /admin/formulas/new → /formulas/new (preserves ?from=).
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyAdminNewRedirect({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  redirect(`/formulas/new${from ? `?from=${encodeURIComponent(from)}` : ''}`);
}
