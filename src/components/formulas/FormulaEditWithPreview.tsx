'use client';

/**
 * Client wrapper that keeps a FormulaEditor in sync with the live preview
 * sandbox. Lives between a server page (which has session + initial formula)
 * and the editor/sandbox, which both need the current draft state.
 *
 * The server page can't own the draft state (it's not a client component), and
 * neither the editor nor the sandbox should own the other's state — so we
 * lift it here.
 *
 * Used by three pages:
 *   - /formulas/new               (mode="create", initial may be partial/empty)
 *   - /formulas/[slug]            (mode="edit", editable=false  → read-only)
 *   - /formulas/[slug]/edit       (mode="edit", editable=true)
 *
 * The sandbox is always shown; on empty drafts it falls back to the "no
 * formula bias" path server-side, which is a useful baseline visual.
 */

import { useState } from 'react';
import FormulaEditor from './FormulaEditor';
import FormulaPreviewSandbox from './FormulaPreviewSandbox';
import type { DesignFormula, DesignFormulaInput } from '@/types/formula';

export default function FormulaEditWithPreview({
  initial,
  mode,
  editable = true,
  canEditBuiltIn,
  cancelHref,
  afterSavePath,
}: {
  initial: Partial<DesignFormula>;
  mode: 'create' | 'edit';
  editable?: boolean;
  canEditBuiltIn: boolean;
  cancelHref: string;
  afterSavePath?: (slug: string) => string;
}) {
  const [draft, setDraft] = useState<Partial<DesignFormula>>(initial);

  return (
    <FormulaEditor
      mode={mode}
      initial={initial}
      editable={editable}
      canEditBuiltIn={canEditBuiltIn}
      cancelHref={cancelHref}
      afterSavePath={afterSavePath}
      onChange={(d: DesignFormulaInput) => setDraft({ ...initial, ...d })}
      sidePanel={<FormulaPreviewSandbox initialFormula={initial} draft={draft} />}
    />
  );
}
