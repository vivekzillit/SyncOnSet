import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, notFound } from "../lib/errors";
import { parse, zOptionalString } from "../lib/validate";
import { requireRole } from "../middleware/auth";
import { OPS_ROLES, REQUEST_ENTITY_TYPES, REQUEST_ROLES } from "../lib/constants";
import { notify } from "../services/notify";
import { audit } from "../services/audit";

/**
 * A production's own address book for people who never sign in — a tailor, a dyer, a hire company's driver —
 * so a request can be addressed to them beside the crew and the vendors it already knows.
 */
export const contactsRouter = Router({ mergeParams: true });

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: zOptionalString,
  role: zOptionalString,
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
  phone: zOptionalString,
  notes: zOptionalString,
});

contactsRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await prisma.externalContact.findMany({ where: { projectId: req.projectId }, orderBy: { name: "asc" } }));
  }),
);

contactsRouter.post(
  "/",
  // Anyone who can send a request can name the person it is for, or the address book is a dead end for them.
  requireRole(REQUEST_ROLES),
  wrap(async (req, res) => {
    const data = parse(contactSchema, req.body);
    const contact = await prisma.externalContact.create({ data: { ...data, email: data.email || null, projectId: req.projectId! } });
    await audit(req.user, req.projectId!, "CONTACT_CREATE", "CONTACT", contact.id);
    res.status(201).json(contact);
  }),
);

contactsRouter.patch(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const data = parse(contactSchema.partial(), req.body);
    const existing = await prisma.externalContact.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Contact");
    const contact = await prisma.externalContact.update({ where: { id: existing.id }, data: { ...data, email: data.email || null } });
    res.json(contact);
  }),
);

contactsRouter.delete(
  "/:id",
  requireRole(OPS_ROLES),
  wrap(async (req, res) => {
    const existing = await prisma.externalContact.findFirst({ where: { id: req.params.id, projectId: req.projectId } });
    if (!existing) throw notFound("Contact");
    await prisma.externalContact.delete({ where: { id: existing.id } });
    res.status(204).end();
  }),
);

/**
 * Sending a request — a return reminder, a repair, a pick-up — to whoever it concerns. Crew are on the app, so
 * they are notified in it; vendors and outside contacts are not, so their details and the written message come
 * back for the sender to pass on however they reach them.
 */
export const requestsRouter = Router({ mergeParams: true });

const sendSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  entityType: z.enum(REQUEST_ENTITY_TYPES).optional().nullable(),
  entityId: zOptionalString,
  crewUserIds: z.array(z.string()).max(200).optional(),
  vendorIds: z.array(z.string()).max(200).optional(),
  contactIds: z.array(z.string()).max(200).optional(),
});

requestsRouter.post(
  "/",
  requireRole(REQUEST_ROLES),
  wrap(async (req, res) => {
    const b = parse(sendSchema, req.body);
    const projectId = req.projectId!;
    const crewIds = b.crewUserIds || [];
    // Only people actually on this production can be written to, whoever the client asked for.
    const crew = crewIds.length
      ? await prisma.projectMember.findMany({ where: { projectId, userId: { in: crewIds } }, include: { user: { select: { id: true, name: true, email: true } } } })
      : [];
    const vendors = b.vendorIds?.length ? await prisma.vendor.findMany({ where: { projectId, id: { in: b.vendorIds } } }) : [];
    const contacts = b.contactIds?.length ? await prisma.externalContact.findMany({ where: { projectId, id: { in: b.contactIds } } }) : [];

    // Exactly the people who were picked, minus the sender: a request is addressed, not broadcast.
    const notified = crew.length
      ? await notify({
        projectId, type: "GENERAL", severity: "INFO", title: b.title, body: b.body,
        entityType: b.entityType || undefined, entityId: b.entityId || undefined,
        onlyUserIds: true, userIds: crew.map((m) => m.userId), excludeUserIds: [req.user!.id],
      })
      : 0;
    await audit(req.user, projectId, "REQUEST_SEND", b.entityType || "REQUEST", b.entityId || "bulk", {
      title: b.title, crew: crew.length, vendors: vendors.length, contacts: contacts.length,
    });

    res.status(201).json({
      // What was really written, not what was asked for.
      notified,
      // Picking yourself is common and harmless; saying nobody was picked would be a lie.
      skippedSelf: crew.some((m) => m.userId === req.user!.id),
      // Everyone the app cannot reach itself, with what is needed to reach them.
      offApp: [
        ...vendors.map((v) => ({ kind: "VENDOR" as const, id: v.id, name: v.name, email: v.email, phone: v.phone })),
        ...contacts.map((c) => ({ kind: "CONTACT" as const, id: c.id, name: c.name, email: c.email, phone: c.phone })),
      ],
    });
  }),
);
