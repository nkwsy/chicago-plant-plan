/**
 * Legacy redirect: /admin/formulas/[slug] → /formulas/[slug]/edit.
 * The editor moved to the user-facing route so owners and admins share a UI.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyAdminEditRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/formulas/${slug}/edit`);
}
