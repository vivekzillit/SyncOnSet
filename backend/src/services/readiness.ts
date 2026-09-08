import { prisma } from "../lib/prisma";

export type ReadinessLevel = "READY" | "ALTERATION" | "CLEANING" | "MISSING" | "DAMAGED" | "NOT_ASSIGNED" | "ISSUED";

const STATUS_TO_LEVEL: Record<string, ReadinessLevel> = {
  AVAILABLE: "READY",
  ISSUED: "READY",
  ON_SET: "READY",
  CLEANING: "CLEANING",
  ALTERATION: "ALTERATION",
  DAMAGED: "DAMAGED",
  MISSING: "MISSING",
  RETURNED_TO_VENDOR: "MISSING",
  RETIRED: "MISSING",
};
const SEVERITY: ReadinessLevel[] = ["MISSING", "DAMAGED", "ALTERATION", "CLEANING", "NOT_ASSIGNED", "ISSUED", "READY"];

/** Per-character costume readiness for a scene, derived from the assigned change's items. */
export async function sceneReadiness(sceneId: string) {
  const scene = await prisma.scene.findUnique({
    where: { id: sceneId },
    include: {
      characters: {
        include: {
          character: { include: { actor: { select: { id: true, name: true } } } },
          change: { include: { items: { include: { costume: true } } } },
        },
      },
    },
  });
  if (!scene) return null;
  const rows = scene.characters.map((sc) => {
    if (!sc.change) {
      return { sceneCharacterId: sc.id, character: sc.character, change: null, level: "NOT_ASSIGNED" as ReadinessLevel, items: [], blockers: ["No change assigned"] };
    }
    const items = sc.change.items.map((it) => ({
      costumeId: it.costumeId,
      assetNumber: it.costume.assetNumber,
      name: it.costume.name,
      status: it.costume.status,
      location: it.costume.location,
      level: STATUS_TO_LEVEL[it.costume.status] || "READY",
      wearNotes: it.wearNotes,
    }));
    let level: ReadinessLevel = items.length ? "READY" : "NOT_ASSIGNED";
    for (const it of items) {
      if (SEVERITY.indexOf(it.level) < SEVERITY.indexOf(level)) level = it.level;
    }
    const blockers = items.filter((i) => i.level !== "READY").map((i) => `${i.assetNumber} ${i.name}: ${i.status.replace(/_/g, " ").toLowerCase()}`);
    if (!items.length) blockers.push("Change has no items");
    return { sceneCharacterId: sc.id, character: sc.character, change: { id: sc.change.id, changeNumber: sc.change.changeNumber, name: sc.change.name }, level, items, blockers };
  });
  let overall: ReadinessLevel = rows.length ? "READY" : "NOT_ASSIGNED";
  for (const r of rows) if (SEVERITY.indexOf(r.level) < SEVERITY.indexOf(overall)) overall = r.level;
  return { scene: { id: scene.id, number: scene.number, name: scene.name, shootDate: scene.shootDate, status: scene.status }, overall, characters: rows };
}
