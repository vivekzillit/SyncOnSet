import { prisma } from "../lib/prisma";
import { badRequest, notFound } from "../lib/errors";
import type { AuthUser } from "../middleware/auth";
import type { CostumeStatus, MovementAction } from "../lib/constants";
import { audit } from "./audit";
import { notify } from "./notify";
import { MANAGER_ROLES } from "../lib/constants";

/** Generate the next asset number for a project, e.g. CST-000245 */
export async function nextAssetNumber(projectId: string, prefix = "CST") {
  const last = await prisma.costume.findFirst({
    where: { projectId, assetNumber: { startsWith: `${prefix}-` } },
    orderBy: { assetNumber: "desc" },
    select: { assetNumber: true },
  });
  let n = 1;
  if (last) {
    const m = last.assetNumber.match(/(\d+)$/);
    if (m) n = Number(m[1]) + 1;
  }
  // guarantee global uniqueness (assetNumber is unique across projects)
  for (;;) {
    const candidate = `${prefix}-${String(n).padStart(6, "0")}`;
    const exists = await prisma.costume.findUnique({ where: { assetNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
    n += 1;
  }
}

export interface ActionInput {
  action: MovementAction;
  toLocation?: string | null;
  sceneId?: string | null;
  takeNumber?: number | null;
  note?: string | null;
  /** used for STATUS_CHANGE */
  toStatus?: CostumeStatus | null;
}

/** Maps an action to the resulting costume status + default location. */
function resolveTransition(current: { status: string; location: string }, input: ActionInput): { status: CostumeStatus; location: string } {
  const loc = input.toLocation || current.location;
  switch (input.action) {
    case "RECEIVED":
      return { status: "AVAILABLE", location: input.toLocation || "Warehouse" };
    case "ISSUE":
      return { status: "ISSUED", location: input.toLocation || "Actor" };
    case "TO_SET":
      return { status: "ON_SET", location: input.toLocation || "Set" };
    case "RETURN":
      return { status: "AVAILABLE", location: input.toLocation || "Wardrobe Truck" };
    case "MOVE":
      if (!input.toLocation) throw badRequest("toLocation is required for MOVE");
      return { status: current.status as CostumeStatus, location: input.toLocation };
    case "CLEANING_REQUESTED":
      return { status: "CLEANING", location: input.toLocation || "Laundry" };
    case "CLEANING_COMPLETE":
      return { status: "AVAILABLE", location: input.toLocation || "Wardrobe Truck" };
    case "ALTERATION_REQUESTED":
      return { status: "ALTERATION", location: input.toLocation || "Tailor" };
    case "ALTERATION_COMPLETE":
      return { status: "AVAILABLE", location: input.toLocation || "Wardrobe Truck" };
    case "MARK_DAMAGED":
      return { status: "DAMAGED", location: loc };
    case "REPAIRED":
      return { status: "AVAILABLE", location: input.toLocation || "Wardrobe Truck" };
    case "MARK_MISSING":
      return { status: "MISSING", location: "Unknown" };
    case "FOUND":
      return { status: "AVAILABLE", location: input.toLocation || "Wardrobe Truck" };
    case "RETURN_TO_VENDOR":
      return { status: "RETURNED_TO_VENDOR", location: "Vendor" };
    case "RETIRE":
      return { status: "RETIRED", location: loc };
    case "STATUS_CHANGE":
      if (!input.toStatus) throw badRequest("toStatus is required for STATUS_CHANGE");
      return { status: input.toStatus, location: loc };
    case "SCAN":
      return { status: current.status as CostumeStatus, location: current.location };
    default:
      throw badRequest(`Unknown action ${input.action}`);
  }
}

/** Apply a movement/action to a costume: updates status/location, writes timeline + audit. */
export async function applyCostumeAction(costumeId: string, input: ActionInput, user?: AuthUser) {
  const costume = await prisma.costume.findUnique({ where: { id: costumeId } });
  if (!costume) throw notFound("Costume");
  const next = resolveTransition(costume, input);

  const [updated, movement] = await prisma.$transaction([
    prisma.costume.update({
      where: { id: costumeId },
      data: { status: next.status, location: next.location, isRetired: next.status === "RETIRED" ? true : costume.isRetired },
    }),
    prisma.costumeMovement.create({
      data: {
        costumeId,
        action: input.action,
        fromLocation: costume.location,
        toLocation: next.location,
        fromStatus: costume.status,
        toStatus: next.status,
        sceneId: input.sceneId || null,
        takeNumber: input.takeNumber ?? null,
        note: input.note || null,
        byUserId: user?.id,
        byUserName: user?.name,
      },
    }),
  ]);

  await audit(user, costume.projectId, `COSTUME_${input.action}`, "COSTUME", costumeId, {
    from: costume.status,
    to: next.status,
    location: next.location,
  });

  if (input.action === "MARK_MISSING") {
    await prisma.missingItem.create({
      data: {
        projectId: costume.projectId,
        costumeId,
        lastSeenLocation: costume.location,
        lastAssignedTo: user?.name,
        lastScanAt: new Date(),
        notes: input.note || null,
      },
    });
    await notify({
      projectId: costume.projectId,
      type: "MISSING",
      severity: "CRITICAL",
      title: "Costume missing",
      body: `${costume.assetNumber} ${costume.name} has been marked missing (last seen: ${costume.location}).`,
      entityType: "COSTUME",
      entityId: costumeId,
      roles: MANAGER_ROLES,
    });
  }
  if (input.action === "FOUND") {
    await prisma.missingItem.updateMany({ where: { costumeId, status: "OPEN" }, data: { status: "FOUND", resolvedAt: new Date() } });
  }

  return { costume: updated, movement };
}

/** Costume timeline (movements + cleaning + alteration events merged, newest first). */
export async function costumeTimeline(costumeId: string) {
  const [movements, cleaning, alterations, damages] = await Promise.all([
    prisma.costumeMovement.findMany({ where: { costumeId }, orderBy: { createdAt: "desc" }, include: { scene: { select: { number: true, name: true } } } }),
    prisma.cleaningRequest.findMany({ where: { costumeId }, include: { logs: { orderBy: { createdAt: "asc" } } } }),
    prisma.alterationRequest.findMany({ where: { costumeId } }),
    prisma.damageReport.findMany({ where: { costumeId } }),
  ]);
  const events: { at: Date; kind: string; title: string; detail?: string | null; by?: string | null }[] = [];
  for (const m of movements) {
    events.push({
      at: m.createdAt,
      kind: "MOVEMENT",
      title: m.action === "SCAN" ? "Scanned" : `${m.action.replace(/_/g, " ")}${m.toLocation ? ` → ${m.toLocation}` : ""}`,
      detail: [m.scene ? `Scene ${m.scene.number}` : null, m.takeNumber ? `Take ${m.takeNumber}` : null, m.note].filter(Boolean).join(" · ") || null,
      by: m.byUserName,
    });
  }
  for (const c of cleaning) {
    for (const l of c.logs) {
      events.push({ at: l.createdAt, kind: "CLEANING", title: `Cleaning: ${l.toStatus.replace(/_/g, " ")}`, detail: l.note || c.problem, by: l.byUserName });
    }
  }
  for (const a of alterations) {
    events.push({ at: a.createdAt, kind: "ALTERATION", title: `Alteration requested: ${a.issue}`, detail: a.required });
    if (a.status === "COMPLETED") events.push({ at: a.updatedAt, kind: "ALTERATION", title: "Alteration completed", detail: a.required });
  }
  for (const d of damages) {
    events.push({ at: d.createdAt, kind: "DAMAGE", title: `Damage reported: ${d.description}`, detail: d.status });
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events;
}

/**
 * Suggest replacement costumes: same project, AVAILABLE, same category, then ranked by
 * type/size/color match and same character.
 */
export async function findAlternatives(costumeId: string, limit = 10) {
  const c = await prisma.costume.findUnique({ where: { id: costumeId } });
  if (!c) throw notFound("Costume");
  const candidates = await prisma.costume.findMany({
    where: { projectId: c.projectId, id: { not: c.id }, status: "AVAILABLE", isRetired: false, category: c.category },
    include: { character: { select: { id: true, name: true } } },
  });
  const norm = (s?: string | null) => (s || "").trim().toLowerCase();
  const scored = candidates.map((x) => {
    let score = 0;
    if (norm(x.type) === norm(c.type)) score += 5;
    if (norm(x.size) === norm(c.size)) score += 4;
    if (norm(x.color) === norm(c.color)) score += 3;
    if (x.characterId && x.characterId === c.characterId) score += 3;
    if (norm(x.brand) === norm(c.brand)) score += 1;
    if (norm(x.name) === norm(c.name)) score += 2;
    return { costume: x, score };
  });
  return scored
    .filter((s) => s.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ ...s.costume, matchScore: s.score }));
}
