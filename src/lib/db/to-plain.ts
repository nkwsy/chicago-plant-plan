/**
 * Recursively coerce Mongoose/BSON values (ObjectId, Buffer, Date, Decimal128,
 * etc.) to plain JSON-safe primitives, and drop Mongo internals (_id, __v,
 * createdAt, updatedAt) from every object in the tree.
 *
 * React Server Components reject objects with prototypes other than
 * Object.prototype or values that carry a toJSON method, so lean() output
 * alone isn't enough — its embedded ObjectIds are class instances.
 *
 * Used by the admin edit pages (plants, formulas) to sanitize DB documents
 * before they cross the server/client boundary, and by formula/loader code
 * that returns formulas to API callers.
 */
export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // ObjectId — collapse to a hex string. Parent will drop _id keys anyway.
  const maybeId = value as { toHexString?: () => string };
  if (typeof maybeId.toHexString === 'function') return maybeId.toHexString();

  // Binary Buffer
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(toPlain);

  // Anything else with a toJSON (e.g. Decimal128, Mongoose subdocs) —
  // delegate then recurse.
  const maybeJson = value as { toJSON?: () => unknown };
  if (
    typeof maybeJson.toJSON === 'function' &&
    maybeJson.toJSON !== Object.prototype.toString
  ) {
    return toPlain(maybeJson.toJSON());
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '_id' || k === '__v' || k === 'createdAt' || k === 'updatedAt') continue;
    out[k] = toPlain(v);
  }
  return out;
}
