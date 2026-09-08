import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { forbidden, unauthorized } from "../lib/errors";
import type { Role } from "../lib/constants";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Effective role within the current project (falls back to global role). */
  projectRole?: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      projectId?: string;
    }
  }
}

export function signToken(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token as string | undefined);
    if (!token) throw unauthorized("Missing token");
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw unauthorized("Invalid or expired token");
    }
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } });
    if (!user || !user.isActive) throw unauthorized("User not found or inactive");
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role as Role };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Ensures the caller can access the project in `req.params.projectId`.
 * ADMIN can access every project; everyone else must be a member.
 * Sets req.projectId and req.user.projectRole.
 */
export async function requireProject(req: Request, _res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    if (!projectId) throw forbidden("Project id missing");
    const user = req.user!;
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw forbidden("Project not found");
    if (user.role === "ADMIN") {
      req.user!.projectRole = "ADMIN";
    } else {
      const membership = await prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
      });
      if (!membership) throw forbidden("You are not a member of this project");
      req.user!.projectRole = membership.role as Role;
    }
    req.projectId = projectId;
    next();
  } catch (e) {
    next(e);
  }
}

export function effectiveRole(req: Request): Role {
  return (req.user?.projectRole || req.user?.role || "ACTOR") as Role;
}

/** Route guard: caller's effective role must be one of `roles`. */
export function requireRole(roles: readonly Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = effectiveRole(req);
    if (!roles.includes(role)) return next(forbidden(`Requires one of: ${roles.join(", ")}`));
    next();
  };
}
