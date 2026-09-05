type Page<T> = { data: T[] | null; error: { message: string; code?: string } | null };
export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  for (;;) {
    const page = await fetchPage(rows.length, rows.length + 499);
    if (page.error) return { data: null, error: page.error };
    if (!page.data?.length) return { data: rows, error: null };
    // A short page can mean the project's row cap, not the end of the table.
    rows.push(...page.data);
  }
}
