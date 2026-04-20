'use client';

/**
 * Client wrapper that keeps a FormulaEditor in sync with the live preview
 * sandbox. Lives between a server page (which has session + initial formula)
 * and the editor/sandbox, which both need the current draft state.
 *
 * The server page can't own the draft state (it's not a client component), and
 * neither the editor nor the sandbox should own the other's state — so we
 * lift it here.
 */

import { useState } from 'react';
import FormulaEditor from './FormulaEditor';
import FormulaPreviewSandbox from './FormulaPreviewSandbox';
import type { DesignFormula, DesignFormulaInput } from '@/types/formula';

export default function FormulaEditWithPreview({
  initial,
  canEditBuiltIn,
  cancelHref,
  afterSavePath,
}: {
  initial: DesignFormula;
  canEditBuiltIn: boolean;
  cancelHref: string;
  afterSavePath?: (slug: string) => string;
}) {
  const [draft, setDraft] = useState<DesignFormula>(initial);

  return (
    <FormulaEditor
      mode="edit"
      initial={initial}
      editable
      canEditBuiltIn={canEditBuiltIn}
      cancelHref={cancelHref}
      afterSavePath={afterSavePath}
      onChange={(d: DesignFormulaInput) => setDraft({ ...initial, ...d } as DesignFormula)}
      sidePanel={<FormulaPreviewSandbox initialFormula={initial} draft={draft} />}
    />
  );
}
