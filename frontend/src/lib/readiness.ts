import type { SceneCharacter } from "@/api/types";

export type Level = "READY" | "ISSUED" | "NOT_ASSIGNED" | "CLEANING" | "ALTERATION" | "DAMAGED" | "MISSING";

/** Mirrors services/readiness.ts on the server, so a scene reads the same here as it does there. */
const STATUS_TO_LEVEL: Record<string, Level> = {
  AVAILABLE: "READY", ISSUED: "READY", ON_SET: "READY",
  CLEANING: "CLEANING", ALTERATION: "ALTERATION", DAMAGED: "DAMAGED",
  MISSING: "MISSING", RETURNED_TO_VENDOR: "MISSING", RETIRED: "MISSING",
};
const SEVERITY: Level[] = ["MISSING", "DAMAGED", "ALTERATION", "CLEANING", "NOT_ASSIGNED", "ISSUED", "READY"];

export const itemLevel = (status: string): Level => STATUS_TO_LEVEL[status] || "READY";
export const worst = (levels: Level[]): Level => levels.reduce<Level>((acc, l) => (SEVERITY.indexOf(l) < SEVERITY.indexOf(acc) ? l : acc), "READY");

/** How ready one character is for a scene: the worst piece in the change they wear, and how many pieces are good. */
export function characterReadiness(sc: SceneCharacter): { level: Level; ready: number; total: number; blockers: string[] } {
  const items = sc.change?.items || [];
  if (!sc.change) return { level: "NOT_ASSIGNED", ready: 0, total: 0, blockers: ["No change assigned"] };
  if (!items.length) return { level: "NOT_ASSIGNED", ready: 0, total: 0, blockers: ["Change has no pieces"] };
  const levels = items.map((i) => itemLevel(i.costume.status));
  const blockers = items.filter((i) => itemLevel(i.costume.status) !== "READY").map((i) => `${i.costume.name || i.costume.assetNumber || "Piece"}: ${i.costume.status.replace(/_/g, " ").toLowerCase()}`);
  return { level: worst(levels), ready: levels.filter((l) => l === "READY").length, total: items.length, blockers };
}
