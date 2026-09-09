/** -1 means the last day. Short months clamp and deduplicate selected dates. */
export function monthlyOccurrence(startsOn: string, interval: number, days: number[], after: Date, inclusive = false): Date | null {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const afterMonth = after.getUTCFullYear() * 12 + after.getUTCMonth();
  const step = Math.max(1, interval);
  let month = startMonth + Math.max(0, Math.floor((afterMonth - startMonth) / step)) * step;
  for (let attempt = 0; attempt < 3; attempt++, month += step) {
    const year = Math.floor(month / 12);
    const index = month % 12;
    const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    const dates = [...new Set(days.map(day => day === -1 ? last : Math.min(day, last)))].sort((a, b) => a - b);
    for (const day of dates) {
      const candidate = new Date(Date.UTC(year, index, day));
      if (candidate >= start && (inclusive ? candidate >= after : candidate > after)) return candidate;
    }
  }
  return null;
}

export function monthDaysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => (a === -1 ? 32 : a) - (b === -1 ? 32 : b));
  if (sorted.filter(day => day > 0).length === 31) return "every day";
  return sorted.map(day => {
    if (day === -1) return "last day";
    const suffix = day >= 11 && day <= 13 ? "th" : ({1: "st", 2: "nd", 3: "rd"} as Record<number, string>)[day % 10] ?? "th";
    return `${day}${suffix}`;
  }).join(", ");
}
