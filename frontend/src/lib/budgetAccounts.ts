/**
 * The wardrobe accounts of a UK feature budget (Movie Magic chart, 30-000 WARDROBE), offered when a line is added so a code
 * fills its account name. Any other code can still be typed; codes already used on this production are offered too.
 */
export const WARDROBE_ACCOUNTS: { code: string; name: string }[] = [
  { code: "30-001", name: "COSTUME DESIGNER" },
  { code: "30-002", name: "COSTUME SUPERVISOR" },
  { code: "30-003", name: "ASSISTANT COSTUME DESIGNER" },
  { code: "30-004", name: "COSTUME STANDBYS" },
  { code: "30-005", name: "COSTUME ASSISTANTS" },
  { code: "30-020", name: "CROWD COSTUME SUPERVISOR" },
  { code: "30-026", name: "COSTUME DAILIES" },
  { code: "30-040", name: "WARDROBE CLEANING" },
  { code: "30-080", name: "WARDROBE CONSUMABLES" },
  { code: "30-090", name: "WARDROBE PURCHASES & RENTALS" },
  { code: "30-093", name: "WARDROBE LOSS & DAMAGE" },
];

/** The units a budget line is costed in, as the sheet writes them. */
export const BUDGET_UNITS = ["Weeks", "Week", "Days", "Day", "Hours", "Allow", "Fee", "Flat", "CAP", "Each", "Set", "%"];

export const CURRENCIES = ["GBP", "USD", "EUR", "INR", "BGN", "AED", "CAD", "AUD"];

/** A line's own currency, or the production's when it has none. */
export const lineCurrency = (line: { currency?: string | null }, fallback: string) => line.currency || fallback;

/** Sum lines per currency, so pounds and leva are never added together: "£58,450 + лв 2,000". */
export function sumByCurrency<T extends { amount: number; currency?: string | null }>(lines: T[], fallback: string, fmt: (n: number, currency: string) => string) {
  const by = new Map<string, number>();
  for (const l of lines) { const c = lineCurrency(l, fallback); by.set(c, (by.get(c) || 0) + l.amount); }
  if (!by.size) return fmt(0, fallback);
  return [...by.entries()].map(([c, n]) => fmt(n, c)).join(" + ");
}
