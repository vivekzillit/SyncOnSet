import fs from "fs";
import path from "path";
import crypto from "crypto";
import { config } from "../config";
import { prisma } from "../lib/prisma";

export type DocumentKind = "SCRIPT" | "SCHEDULE" | "CALLSHEET";

/** Only these are kept; anything else (or a name we did not hand out) is ignored rather than stored. */
const EXT = /^(pdf|fdx|fountain|txt|text|csv|tsv|xlsx|xlsm)$/;
const TOKEN = /^doc-[a-f0-9]{24}\.[a-z0-9]{1,8}$/;
const MIME: Record<string, string> = { pdf: "application/pdf", fdx: "application/xml", fountain: "text/plain", txt: "text/plain", text: "text/plain", csv: "text/csv", tsv: "text/tab-separated-values", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12" };

/**
 * Set a file aside while it is being previewed. Nothing is recorded: the token only becomes a kept document when the
 * import / apply that follows sends it back. Returns null for a file type we do not keep.
 */
export async function stashUpload(file: { originalname?: string; buffer: Buffer }): Promise<string | null> {
  const ext = (path.extname(file.originalname || "").slice(1) || "").toLowerCase();
  if (!EXT.test(ext)) return null;
  const token = `doc-${crypto.randomBytes(12).toString("hex")}.${ext}`;
  try {
    await fs.promises.mkdir(config.uploadDir, { recursive: true });
    await fs.promises.writeFile(path.join(config.uploadDir, token), file.buffer);
    return token;
  } catch {
    return null; // viewing it later is a convenience; a disk problem must never block reading the file
  }
}

/** Keep a previewed file as this production's latest script / schedule / call sheet. A bad or unknown token is ignored. */
export async function keepDocument(opts: { projectId: string; kind: DocumentKind; token?: string | null; fileName?: string | null; userId?: string | null; revision?: string | null; sheetDate?: Date | null }) {
  const token = (opts.token || "").trim();
  if (!TOKEN.test(token)) return null;
  const full = path.join(config.uploadDir, token);
  const stat = await fs.promises.stat(full).catch(() => null);
  if (!stat?.isFile()) return null;
  const ext = token.split(".").pop() || "";
  return prisma.projectDocument.create({
    data: {
      projectId: opts.projectId,
      kind: opts.kind,
      fileName: (opts.fileName || token).slice(0, 200),
      url: `/uploads/${token}`,
      mimeType: MIME[ext] || null,
      size: stat.size,
      revision: opts.revision || null,
      sheetDate: opts.sheetDate || null,
      uploadedById: opts.userId || null,
    },
  });
}
