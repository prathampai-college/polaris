/**
 * Field-level diff helper: computes patch of changed fields only.
 * Works for any plain object with primitive values.
 */
export function diff<T extends Record<string, unknown>>(oldObj: T, newObj: T): Partial<T> {
  const patch: Partial<T> = {};
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const k of keys) {
    if (oldObj[k] !== newObj[k]) {
      // @ts-ignore
      patch[k] = newObj[k];
    }
  }
  return patch;
}

export function applyPatch<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  return { ...base, ...patch };
}

/** Returns true if patch is empty (no changes) */
export function isEmptyPatch(p: Record<string, unknown>): boolean {
  return Object.keys(p).length === 0;
}
