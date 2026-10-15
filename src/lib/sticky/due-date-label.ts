import { addDays, format } from "date-fns";

/** Compare local calendar days, including month/year and daylight-saving boundaries. */
export function relativeDueDateLabel(dueDate: string, today = new Date()): string | null {
  if (dueDate === format(today, "yyyy-MM-dd")) return "Today";
  if (dueDate === format(addDays(today, -1), "yyyy-MM-dd")) return "Yesterday";
  return null;
}
