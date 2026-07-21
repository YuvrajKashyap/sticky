export type ParentDueDateIssue =
  | { code: "undated_child" }
  | { code: "child_after_parent"; latestChildDue: string }
  | null;

export function parentDueDateIssue(
  parentDueDate: string | null,
  childDueDates: Array<string | null>,
): ParentDueDateIssue {
  if (parentDueDate === null) return null;
  if (childDueDates.some((dueDate) => dueDate === null)) return { code: "undated_child" };

  const latestChildDue = childDueDates.reduce<string | null>(
    (latest, dueDate) => dueDate !== null && (latest === null || dueDate > latest) ? dueDate : latest,
    null,
  );
  return latestChildDue !== null && latestChildDue > parentDueDate
    ? { code: "child_after_parent", latestChildDue }
    : null;
}

export function reconcileParentDueDate(
  parentDueDate: string | null,
  childDueDates: Array<string | null>,
): string | null {
  if (childDueDates.some((dueDate) => dueDate === null)) return null;
  if (parentDueDate === null) return null;

  let reconciledDueDate = parentDueDate;
  for (const dueDate of childDueDates) {
    if (dueDate !== null && dueDate > reconciledDueDate) reconciledDueDate = dueDate;
  }
  return reconciledDueDate;
}
