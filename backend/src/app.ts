import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import { config } from "./config";
import { errorHandler } from "./middleware/error";
import { requireAuth, requireProject } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { projectsRouter } from "./routes/projects";
import { actorsRouter } from "./routes/actors";
import { charactersRouter } from "./routes/characters";
import { scenesRouter } from "./routes/scenes";
import { changesRouter } from "./routes/changes";
import { costumesRouter } from "./routes/costumes";
import { fittingsRouter } from "./routes/fittings";
import { cleaningRouter } from "./routes/cleaning";
import { alterationsRouter } from "./routes/alterations";
import { continuityRouter } from "./routes/continuity";
import { photosRouter } from "./routes/photos";
import { damagesRouter } from "./routes/damages";
import { missingRouter } from "./routes/missing";
import { vendorsRouter, rentalsRouter } from "./routes/vendors";
import { expensesRouter } from "./routes/expenses";
import { notificationsRouter } from "./routes/notifications";
import { reportsRouter } from "./routes/reports";
import { metaRouter } from "./routes/meta";
import { cuesRouter } from "./routes/cues";
import { scheduleRouter } from "./routes/schedule";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin.includes("*") ? true : config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "costumes-and-set-api", time: new Date().toISOString() }));
  app.use("/uploads", express.static(config.uploadDir, {
    maxAge: "7d",
    setHeaders: (res, filePath) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Pictures, PDFs and media display inline; anything else downloads, so an upload can never run in this origin.
      if (!/\.(jpe?g|png|webp|heic|heif|gif|avif|pdf|mp4|mov|webm|m4a|mp3|wav)$/i.test(filePath)) res.setHeader("Content-Disposition", "attachment");
    },
  }));

  app.use("/api/meta", metaRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/projects", projectsRouter);

  // Project-scoped resources: /api/projects/:projectId/<resource>
  const scoped = express.Router({ mergeParams: true });
  scoped.use(requireAuth, requireProject);
  scoped.use("/actors", actorsRouter);
  scoped.use("/characters", charactersRouter);
  scoped.use("/scenes", scenesRouter);
  scoped.use("/changes", changesRouter);
  scoped.use("/costumes", costumesRouter);
  scoped.use("/fittings", fittingsRouter);
  scoped.use("/cleaning", cleaningRouter);
  scoped.use("/alterations", alterationsRouter);
  scoped.use("/continuity", continuityRouter);
  scoped.use("/photos", photosRouter);
  scoped.use("/damages", damagesRouter);
  scoped.use("/missing", missingRouter);
  scoped.use("/vendors", vendorsRouter);
  scoped.use("/rentals", rentalsRouter);
  scoped.use("/expenses", expensesRouter);
  scoped.use("/notifications", notificationsRouter);
  scoped.use("/reports", reportsRouter);
  scoped.use("/cues", cuesRouter);
  scoped.use("/schedule", scheduleRouter);
  app.use("/api/projects/:projectId", scoped);

  // Serve the built frontend in production if present
  const webDist = path.resolve(process.cwd(), "../frontend/dist");
  app.use(express.static(webDist));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res, next) => {
    res.sendFile(path.join(webDist, "index.html"), (err) => (err ? next() : undefined));
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}
