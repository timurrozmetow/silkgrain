/**
 * Turning two snapshots into the pair of payloads an entry stores.
 *
 * `audit_log.before` and `.after` "hold only the fields that actually changed", says the schema
 * comment that has been there since Phase 2. This is the file that makes it true.
 *
 * Everything here is flat scalars. A snapshot is a `Record<string, string | number | boolean |
 * null>` and nothing nests, which is what lets the reading screen render a diff as a table of
 * key, was, is - and, more importantly, is why a password hash cannot arrive by accident: a
 * projector names its columns one at a time, so a field nobody listed is a field nobody stores.
 * A `{...row}` spread would have been shorter and would have archived every credential in the
 * table the first time somebody added a column.
 */

export type AuditValue = string | number | boolean | null;
export type AuditPayload = Record<string, AuditValue>;

/**
 * The fields that differ, or null when nothing did.
 *
 * Both sides carry the same key set: a key present on one side only is emitted as `null` on the
 * other, so the reader never has to decide whether a missing key means "unchanged" or "removed".
 * Null is what an empty field looks like everywhere else in this system.
 */
export function diffSnapshots(
  before: AuditPayload,
  after: AuditPayload,
): { before: AuditPayload; after: AuditPayload } | null {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedBefore: AuditPayload = {};
  const changedAfter: AuditPayload = {};

  for (const key of keys) {
    const was = before[key] ?? null;
    const is = after[key] ?? null;
    if (was === is) continue;
    changedBefore[key] = was;
    changedAfter[key] = is;
  }

  return Object.keys(changedAfter).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}

/**
 * The same, over a list of children keyed by something stable.
 *
 * A product's variants are the case: they are an array, they are reconciled rather than replaced,
 * and the interesting question is "what happened to SG-DEV-5LB", not "what happened to index 2".
 * So the key is the child's own identifier and the flattened form reads
 * `variants[SG-DEV-5LB].priceCents`, which survives reordering and tells a reader which row moved.
 *
 * A child that appears on one side only is emitted with every field null on the other, which is
 * how an added or removed variant reads in the log.
 */
export function diffChildren<T>(
  before: readonly T[],
  after: readonly T[],
  keyOf: (item: T) => string,
  project: (item: T) => AuditPayload,
  prefix: string,
): { before: AuditPayload; after: AuditPayload } {
  const index = (items: readonly T[]) => new Map(items.map((item) => [keyOf(item), item]));
  const was = index(before);
  const is = index(after);

  const changedBefore: AuditPayload = {};
  const changedAfter: AuditPayload = {};

  for (const key of new Set([...was.keys(), ...is.keys()])) {
    const left = was.get(key);
    const right = is.get(key);
    const leftPayload = left === undefined ? {} : project(left);
    const rightPayload = right === undefined ? {} : project(right);

    const delta = diffSnapshots(leftPayload, rightPayload);
    if (delta === null) continue;

    for (const [field, value] of Object.entries(delta.before)) {
      changedBefore[`${prefix}[${key}].${field}`] = value;
    }
    for (const [field, value] of Object.entries(delta.after)) {
      changedAfter[`${prefix}[${key}].${field}`] = value;
    }
  }

  return { before: changedBefore, after: changedAfter };
}

/** Merges two payload pairs, for an entity whose diff has a parent part and a children part. */
export function mergeDiff(
  left: { before: AuditPayload; after: AuditPayload } | null,
  right: { before: AuditPayload; after: AuditPayload } | null,
): { before: AuditPayload; after: AuditPayload } | null {
  if (left === null) return right;
  if (right === null) return left;
  return {
    before: { ...left.before, ...right.before },
    after: { ...left.after, ...right.after },
  };
}
