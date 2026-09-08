import { prisma } from "../lib/prisma";
import { badRequest, notFound } from "../lib/errors";
import type { AuthUser } from "../middleware/auth";
import { CLEANING_PIPELINE, CLEANING_ROLES, MANAGER_ROLES, type CleaningStatus } from "../lib/constants";
import { applyCostumeAction, findAlternatives } from "./costume";
import { notify } from "./notify";
import { audit } from "./audit";

export interface CreateCleaningInput {
  projectId: string;
  costumeId: string;
  sceneId?: string | null;
  takeNumber?: number | null;
  problem: string;
  cleaningType: string;
  priority?: string;
  isEmergency?: boolean;
  expectedReadyAt?: Date | null;
  assignedToId?: string | null;
  notes?: string | null;
}

const DEFAULT_MINUTES: Record<string, number> = {
  SPOT_CLEANING: 30,
  STEAM: 20,
  IRONING: 20,
  STAIN_REMOVAL: 45,
  FOOD_STAIN_REMOVAL: 40,
  MAKEUP_REMOVAL: 30,
  SWEAT_TREATMENT: 60,
  BLOOD_REMOVAL: 60,
  MUD_CLEANING: 90,
  HAND_WASH: 120,
  MACHINE_WASH: 150,
  DRY_CLEANING: 1440,
  SPECIAL_FABRIC: 240,
};

export async function createCleaningRequest(input: CreateCleaningInput, user?: AuthUser) {
  const costume = await prisma.costume.findUnique({ where: { id: input.costumeId } });
  if (!costume || costume.projectId !== input.projectId) throw notFound("Costume");
  if (costume.status === "CLEANING") {
    const open = await prisma.cleaningRequest.findFirst({ where: { costumeId: costume.id, status: { notIn: ["READY", "CANCELLED"] } } });
    if (open) throw badRequest(`Costume already has an open cleaning request (${open.id})`);
  }
  let assignedToName: string | undefined;
  if (input.assignedToId) {
    const u = await prisma.user.findUnique({ where: { id: input.assignedToId } });
    assignedToName = u?.name;
  }
  const priority = input.isEmergency ? "URGENT" : input.priority || "NORMAL";
  const expectedReadyAt =
    input.expectedReadyAt ?? new Date(Date.now() + (DEFAULT_MINUTES[input.cleaningType] || 60) * 60 * 1000);

  const request = await prisma.cleaningRequest.create({
    data: {
      projectId: input.projectId,
      costumeId: input.costumeId,
      sceneId: input.sceneId || null,
      takeNumber: input.takeNumber ?? null,
      problem: input.problem,
      cleaningType: input.cleaningType,
      priority,
      isEmergency: !!input.isEmergency,
      requestedById: user?.id,
      requestedByName: user?.name,
      assignedToId: input.assignedToId || null,
      assignedToName,
      expectedReadyAt,
      notes: input.notes || null,
      logs: { create: { toStatus: "REQUESTED", note: input.problem, byUserId: user?.id, byUserName: user?.name } },
    },
    include: { logs: true },
  });

  await applyCostumeAction(
    costume.id,
    { action: "CLEANING_REQUESTED", sceneId: input.sceneId, takeNumber: input.takeNumber, note: `${input.cleaningType}: ${input.problem}` },
    user,
  );

  await notify({
    projectId: input.projectId,
    type: "CLEANING",
    severity: input.isEmergency ? "CRITICAL" : priority === "HIGH" ? "WARNING" : "INFO",
    title: input.isEmergency ? "🚨 Emergency cleaning" : "Cleaning requested",
    body: `${costume.assetNumber} ${costume.name}: ${input.problem} (${input.cleaningType.replace(/_/g, " ").toLowerCase()}, ${priority})`,
    entityType: "CLEANING",
    entityId: request.id,
    roles: ["LAUNDRY", ...MANAGER_ROLES],
  });

  return request;
}

/** Advance a request to the next pipeline stage, or jump to a specific one. */
export async function advanceCleaning(id: string, user: AuthUser | undefined, opts: { toStatus?: CleaningStatus; note?: string | null; qcResult?: "PASS" | "FAIL"; qcNotes?: string | null; returnLocation?: string | null }) {
  const req = await prisma.cleaningRequest.findUnique({ where: { id }, include: { costume: true } });
  if (!req) throw notFound("Cleaning request");
  if (req.status === "READY" || req.status === "CANCELLED") throw badRequest(`Request is already ${req.status}`);

  let toStatus: CleaningStatus;
  if (opts.toStatus) {
    toStatus = opts.toStatus;
  } else {
    const idx = CLEANING_PIPELINE.indexOf(req.status as (typeof CLEANING_PIPELINE)[number]);
    toStatus = CLEANING_PIPELINE[Math.min(idx + 1, CLEANING_PIPELINE.length - 1)];
  }
  if (toStatus === "READY" && req.status === "QUALITY_CHECK" && opts.qcResult === "FAIL") {
    // failed QC: send back to CLEANING
    toStatus = "CLEANING";
  }

  const data: Record<string, unknown> = { status: toStatus };
  if (toStatus === "CLEANING" && !req.startedAt) data.startedAt = new Date();
  if (toStatus === "RECEIVED" && !req.assignedToId && user) {
    data.assignedToId = user.id;
    data.assignedToName = user.name;
  }
  if (opts.qcResult) {
    data.qcResult = opts.qcResult;
    data.qcNotes = opts.qcNotes || null;
  }
  if (toStatus === "READY") data.completedAt = new Date();

  const updated = await prisma.cleaningRequest.update({
    where: { id },
    data: {
      ...data,
      logs: { create: { fromStatus: req.status, toStatus, note: opts.note || opts.qcNotes || null, byUserId: user?.id, byUserName: user?.name } },
    },
    include: { logs: { orderBy: { createdAt: "asc" } }, costume: true, scene: true },
  });

  if (toStatus === "READY") {
    await applyCostumeAction(req.costumeId, { action: "CLEANING_COMPLETE", toLocation: opts.returnLocation || "Wardrobe Truck", note: "Cleaning completed" }, user);
    await notify({
      projectId: req.projectId,
      type: "CLEANING",
      title: "Cleaning completed",
      body: `${req.costume.assetNumber} ${req.costume.name} is ready${updated.scene ? ` for Scene ${updated.scene.number}` : ""}.`,
      entityType: "CLEANING",
      entityId: id,
      roles: CLEANING_ROLES,
    });
  } else if (toStatus === "CANCELLED") {
    await applyCostumeAction(req.costumeId, { action: "CLEANING_COMPLETE", toLocation: opts.returnLocation || "Wardrobe Truck", note: "Cleaning cancelled" }, user);
  }
  await audit(user, req.projectId, "CLEANING_ADVANCE", "CLEANING", id, { from: req.status, to: toStatus });
  if (toStatus === "READY" || toStatus === "CANCELLED") {
    return prisma.cleaningRequest.findUniqueOrThrow({ where: { id }, include: { logs: { orderBy: { createdAt: "asc" } }, costume: true, scene: true } });
  }
  return updated;
}

/**
 * Emergency on-set flow: create URGENT ticket, mark costume unavailable, alert laundry + supervisor,
 * find replacement candidates, and optionally auto-assign the best one.
 */
export async function emergencyCleaning(
  input: { projectId: string; costumeId: string; sceneId?: string | null; takeNumber?: number | null; problem: string; cleaningType?: string; autoAssignReplacement?: boolean },
  user?: AuthUser,
) {
  const request = await createCleaningRequest(
    {
      projectId: input.projectId,
      costumeId: input.costumeId,
      sceneId: input.sceneId,
      takeNumber: input.takeNumber,
      problem: input.problem,
      cleaningType: input.cleaningType || "SPOT_CLEANING",
      isEmergency: true,
    },
    user,
  );
  const alternatives = await findAlternatives(input.costumeId, 5);
  let replacement = null;
  if (input.autoAssignReplacement && alternatives.length) {
    replacement = await assignReplacement(request.id, alternatives[0].id, user);
  }
  const scene = input.sceneId ? await prisma.scene.findUnique({ where: { id: input.sceneId } }) : null;
  return { request, alternatives, replacement, scene };
}

export async function assignReplacement(requestId: string, replacementCostumeId: string, user?: AuthUser) {
  const req = await prisma.cleaningRequest.findUnique({ where: { id: requestId }, include: { costume: true } });
  if (!req) throw notFound("Cleaning request");
  const repl = await prisma.costume.findUnique({ where: { id: replacementCostumeId } });
  if (!repl || repl.projectId !== req.projectId) throw notFound("Replacement costume");
  if (repl.status !== "AVAILABLE") throw badRequest("Replacement costume is not available");

  await prisma.cleaningRequest.update({ where: { id: requestId }, data: { replacementCostumeId } });
  // Replacement inherits the original's character assignment + is issued to actor/set.
  await prisma.costume.update({ where: { id: replacementCostumeId }, data: { characterId: repl.characterId || req.costume.characterId } });
  await applyCostumeAction(
    replacementCostumeId,
    { action: "ISSUE", sceneId: req.sceneId, takeNumber: req.takeNumber, note: `Replacement for ${req.costume.assetNumber}`, toLocation: "Actor" },
    user,
  );
  await notify({
    projectId: req.projectId,
    type: "CLEANING",
    severity: "WARNING",
    title: "Replacement assigned",
    body: `${repl.assetNumber} ${repl.name} assigned as replacement for ${req.costume.assetNumber}.`,
    entityType: "COSTUME",
    entityId: repl.id,
    roles: MANAGER_ROLES,
  });
  return repl;
}
