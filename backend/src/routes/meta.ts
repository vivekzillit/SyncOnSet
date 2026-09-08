import { Router } from "express";
import { META } from "../lib/constants";
import { aiEnabled, AI_MODEL, CUE_KINDS } from "../services/costumeCues";

export const metaRouter = Router();
metaRouter.get("/", (_req, res) => res.json({ ...META, cueKinds: CUE_KINDS, aiEnabled: aiEnabled(), aiModel: aiEnabled() ? AI_MODEL : null }));
