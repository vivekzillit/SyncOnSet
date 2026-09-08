import { Router } from "express";
import { META } from "../lib/constants";

export const metaRouter = Router();
metaRouter.get("/", (_req, res) => res.json(META));
