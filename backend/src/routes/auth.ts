import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { wrap, unauthorized, badRequest } from "../lib/errors";
import { parse } from "../lib/validate";
import { requireAuth, signToken } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

function publicUser(u: { id: string; name: string; email: string; role: string; phone: string | null; isActive: boolean; createdAt: Date }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, isActive: u.isActive, createdAt: u.createdAt };
}

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) throw unauthorized("Invalid email or password");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");
    const memberships = await prisma.projectMember.findMany({ where: { userId: user.id }, include: { project: { select: { id: true, name: true, code: true, status: true } } } });
    res.json({ token: signToken(user), user: publicUser(user), projects: memberships.map((m) => ({ ...m.project, role: m.role })) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  wrap(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    const memberships = await prisma.projectMember.findMany({ where: { userId: user!.id }, include: { project: { select: { id: true, name: true, code: true, status: true } } } });
    res.json({ user: publicUser(user!), projects: memberships.map((m) => ({ ...m.project, role: m.role })) });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }), req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    res.json({ ok: true });
  }),
);
