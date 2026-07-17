import { conflict } from "./errors";

export function assertVersion(expected: number, actual: number, entity: string): void {
  if (expected !== actual) {
    throw conflict(`${entity} changed somewhere else. Refresh and try again.`, {
      expectedVersion: expected,
      actualVersion: actual,
    });
  }
}

export type FieldSnapshot<T extends Record<string, unknown>> = {
  sticky: T;
  external: T;
};

export function resolveFieldConflict<T extends Record<string, unknown>>(
  base: T,
  sticky: T,
  external: T,
  stickyUpdatedAt: string,
  externalUpdatedAt: string,
): { value: T; conflicts: string[] } {
  const value = { ...sticky };
  const conflicts: string[] = [];
  const externalWins = new Date(externalUpdatedAt).getTime() > new Date(stickyUpdatedAt).getTime();

  for (const key of Object.keys(base) as Array<keyof T>) {
    const stickyChanged = !Object.is(base[key], sticky[key]);
    const externalChanged = !Object.is(base[key], external[key]);
    if (!externalChanged) continue;
    if (stickyChanged && !Object.is(sticky[key], external[key])) conflicts.push(String(key));
    if (!stickyChanged || externalWins) value[key] = external[key];
  }

  return { value, conflicts };
}
