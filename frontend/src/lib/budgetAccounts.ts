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

/** Department heads of a UK feature chart of accounts ("30-000 - WARDROBE"), so lines can be read department by department. */
export const DEPARTMENTS: Record<string, string> = {
  "11": "STORY RIGHTS & CONTINUITY", "12": "PRODUCERS", "13": "DIRECTOR", "14": "CAST", "15": "ATL TRAVEL & LIVING", "19": "ATL - FRINGES",
  "20": "PRODUCTION STAFF", "21": "SUPPORTING ARTISTS", "22": "SET DESIGN", "23": "SET CONSTRUCTION", "25": "SET OPERATIONS", "26": "SPECIAL EFFECTS",
  "27": "SET DRESSING", "28": "PROPERTY", "29": "ACTION VEHICLES/ANIMALS", "30": "WARDROBE", "31": "HAIR & MAKEUP", "32": "LIGHTING", "33": "CAMERA",
  "34": "PRODUCTION SOUND", "35": "TRANSPORTATION", "36": "LOCATIONS", "37": "DAILIES & DATA MANAGEMENT", "38": "BTL TRAVEL & LIVING", "39": "OVERTIME",
  "40": "OVERSEAS UNIT", "42": "STAGES / OFFICES / STORES", "43": "SECOND UNIT", "44": "VISUAL EFFECTS PRODUCTION", "50": "POST PRODUCTION MANAGEMENT",
  "51": "EDITING", "52": "PICTURE POST PRODUCTION", "53": "SOUND POST PRODUCTION", "54": "VFX", "55": "MUSIC", "56": "CLIPS & CLEARANCES", "57": "DELIVERABLES",
  "64": "GENERAL EXPENSES", "65": "PUBLICITY", "66": "FINANCE & LEGAL", "67": "INSURANCE", "70": "RESIDUALS", "71": "FINANCE FEE", "73": "BRIDGE FEE", "74": "BOND FEE", "75": "CONTINGENCY",
};
/** "30-001" → { key: "30", title: "30-000 - WARDROBE" }; a code that does not follow the chart is its own department. */
export function departmentOf(code?: string | null) {
  const c = (code || "").trim();
  if (!c) return null;
  const head = c.split(/[-.\s]/)[0];
  const zeros = (c.split(/[-.\s]/)[1] || "000").replace(/./g, "0");
  return { key: head, title: `${head}-${zeros}${DEPARTMENTS[head] ? ` - ${DEPARTMENTS[head]}` : ""}` };
}

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
