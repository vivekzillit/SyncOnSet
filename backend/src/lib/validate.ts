import { z, ZodType, ZodTypeDef } from "zod";
import { badRequest } from "./errors";

export function parse<O, D extends ZodTypeDef, I>(schema: ZodType<O, D, I>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest("Validation failed", result.error.flatten());
  }
  return result.data;
}

/** Accepts ISO strings or Date and returns Date | null | undefined */
export const zDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v): Date | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) throw badRequest("Invalid date");
    return d;
  });

export const zOptionalString = z.string().trim().max(2000).optional().nullable();
export const zMoney = z.number().min(0).optional().nullable();

export function paging(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 50)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function parseJson<T = unknown>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
