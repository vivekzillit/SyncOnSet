import dotenv from "dotenv";
import path from "path";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || "uploads"),
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
};
