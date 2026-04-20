/**
 * /admin/formulas — legacy path. Admins now manage formulas through the
 * unified user-facing /formulas route (with the "All" tab showing everything
 * system-wide). This stub redirects so bookmarks keep working.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AdminFormulasRedirect() {
  redirect('/formulas?tab=all');
}
