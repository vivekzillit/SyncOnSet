import { Router } from "express";
import { z } from "zod";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, paging, zMoney, zOptionalString } from "../lib/validate";
import { effectiveRole, requireRole } from "../middleware/auth";
import { COSTUME_CATEGORIES, COSTUME_SOURCES, COSTUME_STATUSES, FINANCE_ROLES, MOVEMENT_ACTIONS, OPS_ROLES, MANAGER_ROLES } from "../lib/constants";
import { audit } from "../services/audit";
import { applyCostumeAction, costumeTimeline, findAlternatives, nextAssetNumber } from "../services/costume";

export const costumesRouter = Router({ mergeParams: true });

const schema = z.object({
  assetNumber: z.string().trim().min(3).max(30).optional(),
  name: z.string().min(1),
  category: z.enum(COSTUME_CATEGORIES),
  type: zOptionalString,
  color: zOptionalString,
  brand: zOptionalString,
  size: zOptionalString,
  fabric: zOptionalString,
  quantity: z.number().int().min(1).optional(),
  source: z.enum(COSTUME_SOURCES).optional(),
  purchaseCost: zMoney,
  rentalCostPerDay: zMoney,
  vendorId: z.string().optional().nullable(),
  characterId: z.string().optional().nullable(),
  location: zOptionalString,
  careInstructions: zOptionalString,
  notes: zOptionalString,
});

/** Strip money fields for roles that shouldn't see them. */
function redact<T extends { purchaseCost?: number | null; rentalCostPerDay?: number | null }>(role: string, c: T): T {
  if (FINANCE_ROLES.includes(role as (typeof FINANCE_ROLES)[number])) return c;
  return { ...c, purchaseCost: null, rentalCostPerDay: null };
}

const listInclude = {
  character: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
};

costumesRouter.get(
  "/",
  wrap(async (req, res) => {
    const { skip, take, page, pageSize } = paging(req.query as Record<string, unknown>);
    const q = String(req.query.q || "").trim();
    const where: Record<string, unknown> = { projectId: req.projectId };
    if (req.query.status) where.status = String(req.query.status);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.characterId) where.characterId = String(req.query.characterId);
    if (req.query.source) where.source = String(req.query.source);
    if (req.query.location) where.location = String(req.query.location);
    if (req.query.includeRetired !== "true") where.isRetired = false;
    if (q) {
      where.OR = [
        { assetNumber: { contains: q } },
        { name: { contains: q } },
        { type: { contains: q } },
        { color: { contains: q } },
        { brand: { contains: q } },
        { size: { contains: q } },
        { character: { name: { contains: q } } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.costume.findMany({ where, include: listInclude, orderBy: { assetNumber: "asc" }, skip, take }),
      prisma.costume.count({ where }),
    ]);
    const role = effectiveRole(req);
    res.json({ items: items.map((c) => redact(role, c)), total, page, pageSize });
  }),
);

costumesRouter.post(
  "/",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema, req.body);
    const assetNumber = data.assetNumber?.toUpperCase() || (await nextAssetNumber(req.projectId!));
    const costume = await prisma.costume.create({
      data: { ...data, assetNumber, projectId: req.projectId!, location: data.location || "Warehouse" },
      include: listInclude,
    });
    await prisma.costumeMovement.create({
      data: { costumeId: costume.id, action: "RECEIVED", toLocation: costume.location, toStatus: "AVAILABLE", byUserId: req.user!.id, byUserName: req.user!.name, note: `Added (${costume.source.toLowerCase()})` },
    });
    if (data.purchaseCost && data.source === "PURCHASED") {
      await prisma.expense.create({
        data: { projectId: req.projectId!, category: "PURCHASE", amount: data.purchaseCost, description: `Purchase ${assetNumber} ${costume.name}`, costumeId: costume.id, characterId: costume.characterId, vendorId: costume.vendorId },
      });
    }
    await audit(req.user, req.projectId!, "COSTUME_CREATE", "COSTUME", costume.id, { assetNumber });
    res.status(201).json(redact(effectiveRole(req), costume));
  }),
);

/** Bulk create (inventory import). Body: { costumes: [...] } */
costumesRouter.post(
  "/import",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const { costumes } = parse(z.object({ costumes: z.array(schema).min(1).max(500) }), req.body);
    const created: string[] = [];
    for (const data of costumes) {
      const assetNumber = data.assetNumber?.toUpperCase() || (await nextAssetNumber(req.projectId!));
      const c = await prisma.costume.create({ data: { ...data, assetNumber, projectId: req.projectId!, location: data.location || "Warehouse" } });
      await prisma.costumeMovement.create({ data: { costumeId: c.id, action: "RECEIVED", toLocation: c.location, toStatus: "AVAILABLE", byUserId: req.user!.id, byUserName: req.user!.name, note: "Imported" } });
      created.push(assetNumber);
    }
    await audit(req.user, req.projectId!, "COSTUME_IMPORT", "COSTUME", "bulk", { count: created.length });
    res.status(201).json({ created });
  }),
);

/** Scan lookup by asset number (QR payload). */
costumesRouter.get(
  "/lookup/:assetNumber",
  wrap(async (req, res) => {
    const assetNumber = decodeURIComponent(req.params.assetNumber).trim().toUpperCase();
    const costume = await prisma.costume.findFirst({
      where: { projectId: req.projectId, assetNumber },
      include: {
        ...listInclude,
        changeItems: { include: { change: { select: { id: true, changeNumber: true, name: true, sceneCharacters: { select: { scene: { select: { id: true, number: true, shootDate: true } } } } } } } },
        cleaning: { where: { status: { notIn: ["READY", "CANCELLED"] } }, take: 1, orderBy: { createdAt: "desc" } },
        alterations: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, take: 1, orderBy: { createdAt: "desc" } },
      },
    });
    if (!costume) throw notFound(`Costume ${assetNumber}`);
    const scenes = new Map<string, { id: string; number: string; shootDate: Date | null }>();
    costume.changeItems.forEach((ci) => ci.change.sceneCharacters.forEach((sc) => scenes.set(sc.scene.id, sc.scene)));
    await prisma.costumeMovement.create({ data: { costumeId: costume.id, action: "SCAN", fromStatus: costume.status, toStatus: costume.status, fromLocation: costume.location, toLocation: costume.location, note: `Scanned at ${costume.location}`, byUserId: req.user!.id, byUserName: req.user!.name } }).catch(() => undefined);
    res.json(redact(effectiveRole(req), { ...costume, scenes: [...scenes.values()].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })) }));
  }),
);

costumesRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const costume = await prisma.costume.findFirst({
      where: { id: req.params.id, projectId: req.projectId },
      include: {
        ...listInclude,
        changeItems: { include: { change: { include: { character: { select: { id: true, name: true } }, sceneCharacters: { include: { scene: { select: { id: true, number: true, name: true, shootDate: true } } } } } } } },
        cleaning: { orderBy: { createdAt: "desc" }, take: 10, include: { logs: { orderBy: { createdAt: "asc" } } } },
        alterations: { orderBy: { createdAt: "desc" }, take: 10 },
        damages: { orderBy: { createdAt: "desc" } },
        missing: { orderBy: { createdAt: "desc" } },
        fittingItems: { include: { fitting: { select: { id: true, scheduledAt: true, status: true } } } },
        rentals: { include: { vendor: { select: { id: true, name: true } } } },
      },
    });
    if (!costume) throw notFound("Costume");
    const [timeline, photos] = await Promise.all([costumeTimeline(costume.id), prisma.photo.findMany({ where: { entityType: "COSTUME", entityId: costume.id }, orderBy: { createdAt: "desc" } })]);
    res.json(redact(effectiveRole(req), { ...costume, timeline, photos }));
  }),
);

costumesRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(schema.partial(), req.body);
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Costume");
    const costume = await prisma.costume.update({ where: { id: existing.id }, data: { ...data, assetNumber: data.assetNumber?.toUpperCase(), location: data.location || undefined }, include: listInclude });
    await audit(req.user, req.projectId!, "COSTUME_UPDATE", "COSTUME", costume.id, data as Record<string, unknown>);
    res.json(redact(effectiveRole(req), costume));
  }),
);

costumesRouter.delete(
  "/:id",
  requireRole(MANAGER_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Costume");
    await prisma.costume.delete({ where: { id: existing.id } });
    await audit(req.user, req.projectId!, "COSTUME_DELETE", "COSTUME", existing.id, { assetNumber: existing.assetNumber });
    res.json({ ok: true });
  }),
);

/** Perform a movement/action (issue, return, move, mark missing, ...). */
costumesRouter.post(
  "/:id/actions",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const body = parse(
      z.object({
        action: z.enum(MOVEMENT_ACTIONS),
        toLocation: zOptionalString,
        toStatus: z.enum(COSTUME_STATUSES).optional().nullable(),
        sceneId: z.string().optional().nullable(),
        takeNumber: z.number().int().optional().nullable(),
        note: zOptionalString,
      }),
      req.body,
    );
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Costume");
    const result = await applyCostumeAction(existing.id, body, req.user);
    res.json(result);
  }),
);

costumesRouter.get(
  "/:id/timeline",
  wrap(async (req, res) => {
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId }, select: { id: true } });
    if (!existing) throw notFound("Costume");
    res.json(await costumeTimeline(existing.id));
  }),
);

costumesRouter.get(
  "/:id/alternatives",
  wrap(async (req, res) => {
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId }, select: { id: true } });
    if (!existing) throw notFound("Costume");
    const role = effectiveRole(req);
    res.json((await findAlternatives(existing.id)).map((c) => redact(role, c)));
  }),
);

/** QR code PNG (payload = asset number). Token may be passed as ?token= for <img> tags. */
costumesRouter.get(
  "/:id/qr.png",
  wrap(async (req, res) => {
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId }, select: { assetNumber: true } });
    if (!existing) throw notFound("Costume");
    const size = Math.min(1024, Math.max(96, Number(req.query.size || 256)));
    const png = await QRCode.toBuffer(existing.assetNumber, { type: "png", width: size, margin: 1, errorCorrectionLevel: "M" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  }),
);

/** QR as SVG string, handy for label sheets. */
costumesRouter.get(
  "/:id/qr.svg",
  wrap(async (req, res) => {
    const existing = await prisma.costume.findFirst({ where: { id: req.params.id, projectId: req.projectId }, select: { assetNumber: true } });
    if (!existing) throw notFound("Costume");
    const svg = await QRCode.toString(existing.assetNumber, { type: "svg", margin: 1 });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  }),
);
