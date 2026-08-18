type VersionedTask = {
  id: string;
  isCompleted: boolean;
  version?: number;
};

export function reconcileWorkspaceTasks<T extends VersionedTask>(
  current: T[],
  snapshot: T[],
): T[] {
  const currentById = new Map(current.map((record) => [record.id, record]));

  return snapshot.map((record) => {
    const local = currentById.get(record.id);
    const localVersion = local?.version;
    const snapshotVersion = record.version;

    const snapshotIsBehind =
      localVersion !== undefined &&
      snapshotVersion !== undefined &&
      localVersion > snapshotVersion;
    const sameVersionConflictsWithOptimisticState =
      localVersion !== undefined &&
      snapshotVersion !== undefined &&
      localVersion === snapshotVersion &&
      local?.isCompleted !== record.isCompleted;

    if (local && (snapshotIsBehind || sameVersionConflictsWithOptimisticState)) {
      return local;
    }

    return record;
  });
}
