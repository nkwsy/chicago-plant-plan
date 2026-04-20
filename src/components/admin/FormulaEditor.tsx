/**
 * Compatibility re-export. The real editor lives in
 * src/components/formulas/FormulaEditor.tsx now. Admin routes were consolidated
 * into /formulas/* in the auth + user-formulas change. Kept here so stray
 * imports don't fail, but new code should import from @/components/formulas.
 */

export { default } from '@/components/formulas/FormulaEditor';
export type { FormulaEditorProps } from '@/components/formulas/FormulaEditor';
