import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/errors";
import { Prisma } from "@prisma/client";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return res.status(409).json({ error: "Duplicate value", details: err.meta });
    if (err.code === "P2025") return res.status(404).json({ error: "Record not found" });
    if (err.code === "P2003") return res.status(400).json({ error: "Related record not found", details: err.meta });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal error";
  return res.status(500).json({ error: message });
}
