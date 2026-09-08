import { prisma } from "../lib/prisma";
import type { AuthUser } from "../middleware/auth";

export async function audit(
  user: AuthUser | undefined,
  projectId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  meta?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: {
      projectId,
      userId: user?.id,
      userName: user?.name,
      action,
      entityType,
      entityId,
      meta: meta ? JSON.stringify(meta) : null,
    },
  });
}
