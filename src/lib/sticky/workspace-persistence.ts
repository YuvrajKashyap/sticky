type Document = Record<string, unknown>;
type Change = { path: string[]; value: unknown };
type PendingSave = {
  patch: Change[];
  operation: () => Promise<unknown>;
  key?: string;
  readyAt: number;
  started: boolean;
  promise: Promise<void>;
};

export async function settleWorkspaceOperations(operations: unknown[]): Promise<unknown[]> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value);
}

function object(value: unknown): value is Document {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Only the workspace's top-level record collections are keyed by ID. Arrays
// inside records (recurrence weekdays, for example) remain ordinary values.
function document(value: object): Document {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    Array.isArray(entry) ? Object.fromEntries(entry.map((row: { id: string }) => [row.id, row])) : entry,
  ]));
}

function changes(before: Document, after: Document, path: string[] = []): Change[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
    const left = before[key];
    const right = after[key];
    if (Object.is(left, right)) return [];
    if (object(left) && object(right)) return changes(left, right, [...path, key]);
    return [{ path: [...path, key], value: right }];
  });
}

function apply(value: Document, patch: Change[], collections: Set<string>): Document {
  let result = value;
  for (const change of patch) {
    // A dependent edit cannot recreate a row whose insert/delete failed.
    // Only an explicit record insertion may introduce a missing record.
    if (change.path.length > 2 && collections.has(change.path[0]) &&
      !(result[change.path[0]] as Document)?.[change.path[1]]) continue;
    result = { ...result };
    let cursor = result;
    for (const key of change.path.slice(0, -1)) {
      cursor[key] = { ...(object(cursor[key]) ? cursor[key] : {}) };
      cursor = cursor[key] as Document;
    }
    const key = change.path[change.path.length - 1];
    if (change.value === undefined) delete cursor[key];
    else cursor[key] = change.value;
  }
  return result;
}

/** Serializes writes, rebases optimistic record changes, and rejects stale reads. */
export class WorkspacePersistence<T extends object> {
  private base: Document = {};
  private pending: PendingSave[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private readRevision = 0;
  private active = true;
  private readonly collections: Set<string>;

  constructor(private readonly read: () => T, private readonly write: (value: T) => void) {
    this.collections = new Set(Object.entries(read()).filter(([, value]) => Array.isArray(value)).map(([key]) => key));
  }

  get busy() { return this.pending.length > 0; }
  async whenIdle() { await this.tail; }

  setActive(active: boolean) {
    this.active = active;
    this.readRevision += 1;
  }

  save(before: T, operation: () => Promise<unknown>, options?: { key: string; delayMs: number }): Promise<void> {
    const after = this.read();
    if (!this.busy) this.base = document(before);
    const patch = changes(document(before), document(after));
    this.revision += 1;
    const previous = this.pending.at(-1);
    if (options && previous?.key === options.key && !previous.started) {
      previous.patch.push(...patch);
      previous.operation = operation;
      previous.readyAt = Date.now() + options.delayMs;
      return previous.promise;
    }
    const entry: PendingSave = {
      patch, operation, key: options?.key,
      readyAt: Date.now() + (options?.delayMs ?? 0),
      started: false, promise: Promise.resolve(),
    };
    this.pending.push(entry);
    const run = this.tail.then(async () => {
      try {
        while (entry.readyAt > Date.now()) {
          await new Promise(resolve => setTimeout(resolve, entry.readyAt - Date.now()));
        }
        entry.started = true;
        await entry.operation();
        this.base = apply(this.base, entry.patch, this.collections);
      } finally {
        this.pending.shift();
        const next = this.pending.reduce((value, pending) => apply(value, pending.patch, this.collections), this.base);
        if (this.active) {
          this.write(Object.fromEntries(Object.entries(next).map(([key, entry]) => [key,
            Array.isArray(after[key as keyof T]) ? Object.values(entry as Document) : entry,
          ])) as T);
        }
      }
    });
    entry.promise = run;
    this.tail = run.catch(() => undefined);
    return run;
  }

  async refresh(fetchSnapshot: () => Promise<T>): Promise<boolean> {
    if (this.busy || !this.active) return false;
    const revision = this.revision;
    const readRevision = ++this.readRevision;
    const snapshot = await fetchSnapshot();
    if (!this.active || this.busy || revision !== this.revision || readRevision !== this.readRevision) return false;
    this.write(snapshot);
    return true;
  }
}
