import { prisma } from "../lib/prisma";
import type { Role } from "../lib/constants";

interface NotifyInput {
  projectId: string;
  type: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  /** Deliver only to members with one of these project roles (ADMINs always included). Omit for all members. */
  roles?: readonly Role[];
  /** Deliver to specific users in addition to role targeting. */
  userIds?: string[];
}

/** Fan-out a notification to each relevant project member (one row per user so read-state is per user). */
export async function notify(input: NotifyInput) {
  const members = await prisma.projectMember.findMany({ where: { projectId: input.projectId }, select: { userId: true, role: true } });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  const targets = new Set<string>();
  for (const m of members) {
    if (!input.roles || input.roles.includes(m.role as Role)) targets.add(m.userId);
  }
  for (const a of admins) targets.add(a.id);
  for (const u of input.userIds || []) targets.add(u);
  if (targets.size === 0) return 0;
  await prisma.notification.createMany({
    data: [...targets].map((userId) => ({
      projectId: input.projectId,
      userId,
      type: input.type,
      severity: input.severity || "INFO",
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    })),
  });
  return targets.size;
}
