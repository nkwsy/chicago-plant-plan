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

import { useCallback, useState } from 'react';
import FormulaEditor from './FormulaEditor';
import FormulaPreviewSandbox from './FormulaPreviewSandbox';
import type { DesignFormula, DesignFormulaInput } from '@/types/formula';

export default function FormulaEditWithPreview({
  initial,
  mode,
  editable = true,
  canEditBuiltIn,
  cancelHref,
}: {
  initial: Partial<DesignFormula>;
  mode: 'create' | 'edit';
  editable?: boolean;
  canEditBuiltIn: boolean;
  cancelHref: string;
}) {
  const [draft, setDraft] = useState<Partial<DesignFormula>>(initial);

  // CRITICAL: stabilize the onChange identity. FormulaEditor runs an effect
  // keyed on `[formula, onChange]` — if we pass a fresh arrow each render,
  // that effect fires on every parent render, calling setDraft and triggering
  // another parent render → infinite loop. That loop also thrashes the
  // sandbox's debounced fetch effect (its deps include the derived draft),
  // which in production surfaces as "Preview error: Failed to fetch".
  const onChange = useCallback((d: DesignFormulaInput) => {
    setDraft((prev) => ({ ...prev, ...d }));
  }, []);

  // Note: we intentionally don't forward an afterSavePath callback. The server
  // components that render this wrapper (/formulas/new, /formulas/[slug]/edit)
  // can't pass functions across the RSC boundary — React Server Components
  // disallow non-serializable props. FormulaEditor's internal default,
  // `/formulas/${saved.slug}`, matches what both callers want anyway.
  return (
    <FormulaEditor
      mode={mode}
      initial={initial}
      editable={editable}
      canEditBuiltIn={canEditBuiltIn}
      cancelHref={cancelHref}
      onChange={onChange}
      sidePanel={<FormulaPreviewSandbox initialFormula={initial} draft={draft} />}
    />
  );
}
