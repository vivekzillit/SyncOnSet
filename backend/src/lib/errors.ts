import type { Request, Response, NextFunction, RequestHandler } from "express";

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);

/** Wrap async route handlers so rejections reach the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
